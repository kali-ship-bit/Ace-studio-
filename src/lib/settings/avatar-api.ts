/**
 * Profile-picture API — Phase D settings (server-side only).
 *
 * Routes (wired in by whoever owns src/server.ts — this file only
 * implements the handler, it does not register itself):
 *   GET  /api/settings/avatar   the logged-in user's picture URL, or null
 *   POST /api/settings/avatar   upload a new picture (multipart, "avatar")
 *
 * Security rules enforced here:
 * - Logged in only: the session cookie must belong to a real Supabase
 *   user, or the request is rejected (401) before any file is touched.
 * - CSRF-verified on POST (double-submit cookie + header or form field,
 *   see src/lib/security/csrf.ts). GET issues a fresh CSRF cookie when
 *   the browser does not have one yet, so the page can read it and send
 *   it back with the upload.
 * - The file is validated server-side with validateUpload (max 2 MB,
 *   image/jpeg|png|webp only) AND by its real first bytes
 *   (isRealImageBytes) — the MIME type is only a label the browser
 *   chose, so a script relabelled as a picture is rejected. The page's
 *   own checks are only for a nicer experience and are never trusted.
 * - The upload goes through a client built with the USER's own access
 *   token, so Supabase Storage RLS enforces ownership: the file can only
 *   land under <userId>/avatar.<ext> in the "avatars" bucket, and the
 *   profile row update can only touch that user's own row.
 * - Supabase not configured -> 503 avatar_not_configured (the demo parts
 *   of the app keep working; pictures just are not available yet).
 * - No key, token, or file bytes ever appear in a response or a log.
 *
 * Deps are injectable so tests can pass a mocked Supabase client and a
 * fake logged-in user instead of a real project.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createUserClient, getAuthUserFromRequest } from "../supabase/client";
import { AVATARS_BUCKET, isSupabaseConfigured } from "../supabase/env";
import { getSessionTokens, isSecureRequest } from "../security/session";
import { csrfCookieHeader, getOrIssueCsrfToken, verifyCsrfToken } from "../security/csrf";
import { errorResponse, jsonResponse, tooManyResponse } from "../security/http";
import { checkApiRateLimit, AVATAR_MAX_PER_MINUTE } from "../security/rate-limit";
import { getDefaultAttemptStore } from "../supabase/rate-limit-store";
import {
  AVATAR_ALLOWED_MIMES,
  AVATAR_MAX_BYTES,
  isRealImageBytes,
  validateUpload,
} from "../security/validation";

/** Multipart overhead (boundaries + the _csrf field) above the 2 MB file cap. */
const AVATAR_BODY_SLACK_BYTES = 64 * 1024;

/** A logged-in user, with the access token their Storage calls run as. */
export interface AvatarUser {
  id: string;
  accessToken: string;
}

export interface AvatarApiDeps {
  /** Who is logged in on this request (default: the Supabase session). */
  getUser?: (request: Request) => Promise<AvatarUser | null>;
  /** Client that acts AS one user (default: createUserClient). */
  createUserClient?: (accessToken: string) => SupabaseClient;
  /** Is a Supabase project configured (default: isSupabaseConfigured). */
  isSupabaseConfigured?: () => boolean;
}

const AVATAR_PATH = "/api/settings/avatar";

async function defaultGetUser(request: Request): Promise<AvatarUser | null> {
  const { accessToken } = getSessionTokens(request);
  if (!accessToken) return null;
  try {
    const user = await getAuthUserFromRequest(request);
    return user ? { id: user.id, accessToken } : null;
  } catch {
    return null;
  }
}

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Read a multipart body with a hard size cap enforced WHILE streaming.
 *
 * `request.formData()` buffers the whole body before anything checks its
 * size, and the Content-Length pre-check above is useless when the
 * client sends chunked encoding (no Content-Length at all) — a huge
 * chunked upload would be fully buffered into memory first. Reading
 * the stream chunk by chunk and aborting over the cap closes that
 * memory-DoS gap; the capped bytes are then re-parsed as multipart
 * from a fresh Request, which is the only standards-based way to parse
 * multipart without a library.
 */
class BodyTooLargeError extends Error {}

async function readCappedFormData(request: Request, maxBytes: number): Promise<FormData> {
  const stream = request.body;
  if (!stream) throw new Error("request has no body");
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new BodyTooLargeError("body exceeds the allowed size");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  const buffered = new Request(request.url, {
    method: "POST",
    headers: { "content-type": request.headers.get("content-type") ?? "" },
    body,
  });
  return buffered.formData();
}

function isFileLike(value: unknown): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as File).size === "number" &&
    typeof (value as File).type === "string" &&
    typeof (value as File).arrayBuffer === "function"
  );
}

/**
 * Handle GET/POST /api/settings/avatar. Returns null for any other path
 * so the caller (src/server.ts) can fall through to the next handler.
 */
export async function handleAvatarApi(
  request: Request,
  deps: AvatarApiDeps = {},
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== AVATAR_PATH) return null;
  if (request.method !== "GET" && request.method !== "POST") {
    return errorResponse(405, "method_not_allowed", "Method not allowed for this route");
  }

  const configured = deps.isSupabaseConfigured ?? isSupabaseConfigured;
  if (!configured()) {
    return errorResponse(
      503,
      "avatar_not_configured",
      "Profile pictures need the account server, which is not set up yet.",
    );
  }
  const getUser = deps.getUser ?? defaultGetUser;
  const buildClient = deps.createUserClient ?? createUserClient;

  // GET: read the picture URL — and hand the browser a CSRF token for
  // the upload, when it does not have one yet.
  if (request.method === "GET") {
    const user = await getUser(request);
    if (!user) {
      return errorResponse(401, "auth_required", "Log in to see your profile picture.");
    }
    const client = buildClient(user.accessToken);
    const { data, error } = await client
      .from("profiles")
      .select("avatar_url")
      .eq("id", user.id)
      .maybeSingle();
    if (error) {
      return errorResponse(502, "profile_read_failed", "Could not read your profile. Try again.");
    }
    const avatarUrl =
      data && typeof (data as { avatar_url?: unknown }).avatar_url === "string"
        ? (data as { avatar_url: string }).avatar_url
        : null;
    const { token, fresh } = getOrIssueCsrfToken(request);
    const extra = fresh
      ? { "set-cookie": csrfCookieHeader(token, isSecureRequest(request)) }
      : undefined;
    return jsonResponse({ avatarUrl }, 200, extra);
  }

  // POST: upload a new picture.
  // Order matters: reject an oversized body and check CSRF + login
  // BEFORE parsing the multipart body into memory — parsing first
  // would let anyone burn memory with a giant upload.
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > AVATAR_MAX_BYTES + AVATAR_BODY_SLACK_BYTES) {
    return errorResponse(413, "avatar_too_big", "That picture is too big. Keep it under 2 MB.");
  }

  // CSRF via the header can be checked without touching the body. A
  // form-field token is checked after parsing, below.
  const headerCsrfOk = verifyCsrfToken(request);

  const user = await getUser(request);
  if (!user) {
    return errorResponse(401, "auth_required", "Log in to change your profile picture.");
  }

  const limited = await checkApiRateLimit(
    request,
    "avatar",
    AVATAR_MAX_PER_MINUTE,
    getDefaultAttemptStore(),
  );
  if (!limited.allowed) {
    return tooManyResponse(
      limited.retryAfterSeconds,
      "Too many picture uploads. Try again in a moment.",
    );
  }

  let form: FormData;
  try {
    // Capped streaming read: a chunked upload with no Content-Length
    // is stopped at the cap instead of being buffered whole into memory.
    form = await readCappedFormData(request, AVATAR_MAX_BYTES + AVATAR_BODY_SLACK_BYTES);
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return errorResponse(413, "avatar_too_big", "That picture is too big. Keep it under 2 MB.");
    }
    return errorResponse(400, "bad_request", "Send the picture as a form upload.");
  }

  const csrfField = form.get("_csrf");
  const csrfOk =
    headerCsrfOk ||
    verifyCsrfToken(request, typeof csrfField === "string" ? { _csrf: csrfField } : undefined);
  if (!csrfOk) {
    return errorResponse(
      403,
      "csrf_invalid",
      "That upload could not be verified. Reload the page and try again.",
    );
  }

  const file = form.get("avatar");
  if (!isFileLike(file)) {
    return errorResponse(400, "avatar_missing", "Pick a picture file first.");
  }

  const checked = validateUpload(
    { size: file.size, mime: file.type },
    AVATAR_MAX_BYTES,
    AVATAR_ALLOWED_MIMES,
    "profile picture",
  );
  if (!checked.ok) {
    return errorResponse(400, "avatar_invalid", checked.error);
  }
  const mime = checked.value;
  // The MIME type is only a label the browser chose — check the file's
  // real first bytes before it goes into the public avatars bucket.
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isRealImageBytes(bytes, mime)) {
    return errorResponse(
      400,
      "avatar_invalid",
      "That file is not a real JPG, PNG or WebP picture. Try a different file.",
    );
  }
  const ext = MIME_TO_EXT[mime] ?? "jpg";
  const path = `${user.id}/avatar.${ext}`;

  const client = buildClient(user.accessToken);
  const { error: uploadError } = await client.storage.from(AVATARS_BUCKET).upload(path, file, {
    upsert: true,
    contentType: mime,
  });
  if (uploadError) {
    return errorResponse(502, "avatar_upload_failed", "Could not save the picture. Try again.");
  }

  const { data: urlData } = client.storage.from(AVATARS_BUCKET).getPublicUrl(path);
  const avatarUrl = urlData.publicUrl;
  // Ask for the row back: without .select(), an update that matches no
  // row (e.g. the profile row does not exist yet) succeeds silently and
  // the picture would never be stored.
  const { data: updated, error: updateError } = await client
    .from("profiles")
    .update({ avatar_url: avatarUrl })
    .eq("id", user.id)
    .select("id")
    .single();
  if (updateError || !updated) {
    // The file is already in the bucket but the profile does not point
    // at it: remove it again, so a failed save never leaves an orphan.
    try {
      await client.storage.from(AVATARS_BUCKET).remove([path]);
    } catch {
      // Best effort — the orphan is logged by the storage layer, and the
      // user can simply upload again.
    }
    return errorResponse(
      502,
      "profile_update_failed",
      "The picture was saved but your profile could not be updated. Try again.",
    );
  }
  return jsonResponse({ avatarUrl });
}
