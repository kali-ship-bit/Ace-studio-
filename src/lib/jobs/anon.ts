/**
 * Anonymous job ownership (server-side only).
 *
 * The problem: demo/narration/post jobs used to belong to nobody — any
 * visitor could list every anonymous job and download its output, just
 * by calling GET /api/jobs. Signed-in users were already safe (the
 * Supabase store scopes by user id under RLS), but anonymous jobs were
 * not owned by anyone.
 *
 * The fix: every job now has an owner id.
 *   - Signed-in users own by their Supabase user id.
 *   - Anonymous browsers get a random id in an HttpOnly `rk_anon`
 *     cookie (first-party, SameSite=Lax, 1 year). It identifies the
 *     browser, not a person — it is not an account, and it carries no
 *     personal data.
 * The API only ever returns jobs whose owner id matches the requester,
 * and a job with no owner (created before this fix) is visible to
 * nobody. Job ids are still unguessable, but the list endpoint no
 * longer enumerates other people's work.
 */

import { randomUUID } from "node:crypto";
import { isSecureRequest, parseCookies } from "../security/session";
import { getAuthUserFromRequest } from "../supabase/client";

export const ANON_COOKIE_NAME = "rk_anon";
export const ANON_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60; // 1 year

/** Set-Cookie value for a fresh anonymous id. */
export function anonCookieHeader(anonId: string, secure: boolean): string {
  const parts = [
    `${ANON_COOKIE_NAME}=${encodeURIComponent(anonId)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${ANON_COOKIE_MAX_AGE_SECONDS}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/** The anonymous id from the request cookie, if it looks like a UUID we issued. */
export function getAnonId(request: Request): string | undefined {
  const raw = parseCookies(request)[ANON_COOKIE_NAME];
  if (!raw) return undefined;
  // randomUUID() output: 8-4-4-4-12 hex with dashes. Anything else is
  // not an id we issued — ignore it rather than trusting it.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
    return undefined;
  }
  return raw;
}

/**
 * Owner id for a request that creates a job. Signed-in users own by
 * their Supabase user id; anonymous browsers by `anon:<cookie id>`,
 * issuing a fresh cookie id (returned as `setCookie`) when the browser
 * has none yet. Callers must send `setCookie` back on the response.
 */
export async function ownerIdForRequest(request: Request): Promise<{
  ownerId: string;
  setCookie: string | null;
}> {
  try {
    const user = await getAuthUserFromRequest(request);
    if (user) return { ownerId: user.id, setCookie: null };
  } catch {
    // Fall through to anonymous ownership.
  }
  const existing = getAnonId(request);
  if (existing) return { ownerId: `anon:${existing}`, setCookie: null };
  const fresh = randomUUID();
  return {
    ownerId: `anon:${fresh}`,
    setCookie: anonCookieHeader(fresh, isSecureRequest(request)),
  };
}

/**
 * Owner id for a read (list / get / download). Never issues a cookie:
 * a requester with no id owns nothing, so the answer is null and the
 * caller returns an empty list / 404.
 */
export async function ownerIdForRead(request: Request): Promise<string | null> {
  try {
    const user = await getAuthUserFromRequest(request);
    if (user) return user.id;
  } catch {
    // Fall through to anonymous ownership.
  }
  const anon = getAnonId(request);
  return anon ? `anon:${anon}` : null;
}

/** True when the job belongs to this requester (or the requester owns nothing). */
export function isOwnJob(jobUserId: string | undefined, ownerId: string | null): boolean {
  return ownerId !== null && jobUserId === ownerId;
}
