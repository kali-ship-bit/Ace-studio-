/**
 * Profile API — server-side only.
 *
 * Routes (wired in by whoever owns src/server.ts — this file only
 * implements the handler, it does not register itself):
 *   GET   /api/settings/profile   the logged-in user's profile fields
 *   PATCH /api/settings/profile   update display name / username / bio
 *
 * Security rules enforced here (same shape as avatar-api.ts):
 * - Logged in only: the session cookie must belong to a real Supabase
 *   user, or the request is rejected (401) before any row is touched.
 * - CSRF-verified on PATCH (header token, see src/lib/security/csrf.ts).
 * - Validation runs before rate limiting: junk never burns quota.
 * - The read/update go through a client built with the USER's own
 *   access token, so Supabase RLS enforces ownership: the row read or
 *   written can only be that user's own ("profiles: read own or
 *   admin" / "profiles: update own"). The is_admin guard trigger in
 *   migration 001 still blocks privilege escalation, and this handler
 *   never accepts is_admin, email, phone or country in a write — only
 *   the three fields below.
 * - A username is unique across all users (partial unique index in
 *   migration 003). A taken name is reported as 409 username_taken
 *   with a plain message, both from the pre-check and from the
 *   database's own unique-violation (the race window between the two).
 * - Supabase not configured -> 503 profile_not_configured (the demo
 *   parts of the app keep working; the profile page shows its
 *   signed-out state instead).
 * - No key, token, or other user's data ever appears in a response
 *   or a log.
 *
 * Deps are injectable so tests can pass a mocked Supabase client and a
 * fake logged-in user instead of a real project.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createUserClient, getAuthUserFromRequest } from "../supabase/client";
import { isSupabaseConfigured } from "../supabase/env";
import { getSessionTokens } from "../security/session";
import { csrfInvalidResponse, verifyCsrfToken } from "../security/csrf";
import { errorResponse, jsonResponse, readJsonBody, tooManyResponse } from "../security/http";
import { checkApiRateLimit, PROFILE_MAX_PER_MINUTE } from "../security/rate-limit";
import { getDefaultAttemptStore } from "../supabase/rate-limit-store";

/** A logged-in user, with the access token their calls run as. */
export interface ProfileUser {
  id: string;
  email: string;
  accessToken: string;
}

export interface ProfileApiDeps {
  /** Who is logged in on this request (default: the Supabase session). */
  getUser?: (request: Request) => Promise<ProfileUser | null>;
  /** Client that acts AS one user (default: createUserClient). */
  createUserClient?: (accessToken: string) => SupabaseClient;
  /** Is a Supabase project configured (default: isSupabaseConfigured). */
  isSupabaseConfigured?: () => boolean;
}

const PROFILE_PATH = "/api/settings/profile";

/** Longest display name the Profile page accepts (mirrored in the DB check). */
export const PROFILE_DISPLAY_NAME_MAX = 50;
/** Longest bio the Profile page accepts (mirrored in the DB check). */
export const PROFILE_BIO_MAX = 160;
/** Usernames: 3–30 lowercase letters, numbers or _ (mirrored in the DB check). */
export const USERNAME_PATTERN = /^[a-z0-9_]{3,30}$/;

export interface ProfileFields {
  displayName: string | null;
  username: string | null;
  bio: string | null;
}

export interface ProfileResponse extends ProfileFields {
  email: string;
  country: string | null;
  avatarUrl: string | null;
}

async function defaultGetUser(request: Request): Promise<ProfileUser | null> {
  const { accessToken } = getSessionTokens(request);
  if (!accessToken) return null;
  try {
    const user = await getAuthUserFromRequest(request);
    return user ? { id: user.id, email: user.email ?? "", accessToken } : null;
  } catch {
    return null;
  }
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Clean one PATCH body into the three writable fields. Only keys the
 * caller actually sent are changed — an absent key leaves the stored
 * value alone. An empty string clears a field back to "not set".
 */
export function normalizeProfileInput(
  body: Record<string, unknown>,
): { ok: true; value: Partial<ProfileFields> } | { ok: false; error: string } {
  const value: Partial<ProfileFields> = {};
  if ("displayName" in body) {
    const raw = asString(body["displayName"]);
    if (raw === null) return { ok: false, error: "Display name must be text." };
    const trimmed = raw.trim();
    if (trimmed.length > PROFILE_DISPLAY_NAME_MAX) {
      return { ok: false, error: "Display name is too long. Keep it under 50 characters." };
    }
    value.displayName = trimmed === "" ? null : trimmed;
  }
  if ("username" in body) {
    const raw = asString(body["username"]);
    if (raw === null) return { ok: false, error: "Username must be text." };
    const cleaned = raw.trim().toLowerCase();
    if (cleaned !== "" && !USERNAME_PATTERN.test(cleaned)) {
      return {
        ok: false,
        error: "Usernames use 3–30 lowercase letters, numbers or _.",
      };
    }
    value.username = cleaned === "" ? null : cleaned;
  }
  if ("bio" in body) {
    const raw = asString(body["bio"]);
    if (raw === null) return { ok: false, error: "Bio must be text." };
    const trimmed = raw.trim();
    if (trimmed.length > PROFILE_BIO_MAX) {
      return { ok: false, error: "Bio is too long. Keep it under 160 characters." };
    }
    value.bio = trimmed === "" ? null : trimmed;
  }
  return { ok: true, value };
}

type ProfileRow = {
  display_name?: string | null;
  username?: string | null;
  bio?: string | null;
  country?: string | null;
  avatar_url?: string | null;
};

function toResponse(row: ProfileRow | null, email: string): ProfileResponse {
  return {
    email,
    displayName:
      typeof row?.display_name === "string" && row.display_name !== "" ? row.display_name : null,
    username: typeof row?.username === "string" && row.username !== "" ? row.username : null,
    bio: typeof row?.bio === "string" && row.bio !== "" ? row.bio : null,
    country: typeof row?.country === "string" && row.country !== "" ? row.country : null,
    avatarUrl: typeof row?.avatar_url === "string" && row.avatar_url !== "" ? row.avatar_url : null,
  };
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  const message = (error as { message?: unknown }).message;
  return (
    code === "23505" ||
    (typeof message === "string" && message.includes("profiles_username_unique_idx"))
  );
}

/**
 * Handle GET/PATCH /api/settings/profile. Returns null for any other
 * path so the caller (src/server.ts) can fall through to the next handler.
 */
export async function handleProfileApi(
  request: Request,
  deps: ProfileApiDeps = {},
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== PROFILE_PATH) return null;
  if (request.method !== "GET" && request.method !== "PATCH") {
    return errorResponse(405, "method_not_allowed", "Method not allowed for this route");
  }

  const configured = deps.isSupabaseConfigured ?? isSupabaseConfigured;
  if (!configured()) {
    return errorResponse(
      503,
      "profile_not_configured",
      "Profiles need the account server, which is not set up yet.",
    );
  }
  const getUser = deps.getUser ?? defaultGetUser;
  const buildClient = deps.createUserClient ?? createUserClient;

  if (request.method === "GET") {
    const user = await getUser(request);
    if (!user) {
      return errorResponse(401, "auth_required", "Log in to see your profile.");
    }
    const client = buildClient(user.accessToken);
    const { data, error } = await client
      .from("profiles")
      .select("display_name, username, bio, country, avatar_url")
      .eq("id", user.id)
      .maybeSingle();
    if (error) {
      return errorResponse(502, "profile_read_failed", "Could not read your profile. Try again.");
    }
    return jsonResponse(toResponse((data as ProfileRow | null) ?? null, user.email));
  }

  // PATCH: update display name / username / bio.
  // Order matters: parse + CSRF + login + validation BEFORE rate
  // limiting, so junk never burns quota and strangers never learn
  // whether a name is taken from a rate-limit response.
  const body = await readJsonBody(request);
  if (body === null) {
    return errorResponse(400, "bad_json", "Request body must be a JSON object.");
  }
  if (!verifyCsrfToken(request, body)) return csrfInvalidResponse();

  const user = await getUser(request);
  if (!user) {
    return errorResponse(401, "auth_required", "Log in to change your profile.");
  }

  const cleaned = normalizeProfileInput(body);
  if (!cleaned.ok) {
    return errorResponse(400, "profile_invalid", cleaned.error);
  }
  const updates: Record<string, string | null> = {};
  if ("displayName" in cleaned.value) updates["display_name"] = cleaned.value.displayName ?? null;
  if ("username" in cleaned.value) updates["username"] = cleaned.value.username ?? null;
  if ("bio" in cleaned.value) updates["bio"] = cleaned.value.bio ?? null;
  if (Object.keys(updates).length === 0) {
    return errorResponse(400, "profile_invalid", "Nothing to update.");
  }

  const limited = await checkApiRateLimit(
    request,
    "profile",
    PROFILE_MAX_PER_MINUTE,
    getDefaultAttemptStore(),
  );
  if (!limited.allowed) {
    return tooManyResponse(
      limited.retryAfterSeconds,
      "Too many profile edits. Try again in a moment.",
    );
  }

  const client = buildClient(user.accessToken);

  // Friendly "taken" answer before writing: the update below still
  // catches the race (two people grabbing the same name at once).
  if (typeof updates["username"] === "string" && updates["username"] !== "") {
    const { data: taken, error: takenError } = await client
      .from("profiles")
      .select("id")
      .eq("username", updates["username"])
      .neq("id", user.id)
      .maybeSingle();
    if (takenError) {
      return errorResponse(502, "profile_read_failed", "Could not check that username. Try again.");
    }
    if (taken) {
      return errorResponse(409, "username_taken", "That username is taken, try another.");
    }
  }

  // Ask for the row back: without .select(), an update that matches no
  // row (e.g. the profile row does not exist yet) succeeds silently and
  // the edit would never be stored.
  const { data: updated, error: updateError } = await client
    .from("profiles")
    .update(updates)
    .eq("id", user.id)
    .select("display_name, username, bio, country, avatar_url")
    .single();
  if (updateError) {
    if (isUniqueViolation(updateError)) {
      return errorResponse(409, "username_taken", "That username is taken, try another.");
    }
    // .single() errors PGRST116 when no row matches: the profile row
    // does not exist yet, so say so plainly instead of a generic save
    // failure.
    if ((updateError as { code?: unknown }).code === "PGRST116") {
      return errorResponse(
        502,
        "profile_update_failed",
        "Your profile could not be found. Sign out and back in, then try again.",
      );
    }
    return errorResponse(502, "profile_update_failed", "Could not save your profile. Try again.");
  }
  if (!updated) {
    return errorResponse(
      502,
      "profile_update_failed",
      "Your profile could not be found. Sign out and back in, then try again.",
    );
  }
  return jsonResponse(toResponse(updated as ProfileRow, user.email));
}
