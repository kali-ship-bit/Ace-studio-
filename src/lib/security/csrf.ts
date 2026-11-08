/**
 * CSRF protection — "cfr protection" in Kenneth's words (Phase A/B).
 *
 * WHAT IT IS, IN PLAIN WORDS: another website could try to make your
 * browser send a request to Ace Studio without you knowing — for example a
 * hidden form on a bad page that posts "change my password" while you are
 * logged in. The browser would send your login cookie along, so the server
 * would think it was you. CSRF protection stops that.
 *
 * HOW IT WORKS (double-submit cookie): the server gives the browser a
 * random token in a cookie. Every form that changes something must send
 * that same token back in a header. A bad site on another domain cannot
 * read the cookie, so it cannot send the matching token, and the server
 * rejects the request. SameSite=Lax on the cookie is a second layer.
 *
 * No server-side storage is needed: the token in the cookie IS the secret
 * to match against. Tokens are random 32-byte values, compared with a
 * timing-safe compare, and the cookie lasts 24 hours.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import { errorResponse } from "./http";
import { parseCookies } from "./session";

export const CSRF_COOKIE_NAME = "rk_csrf";
export const CSRF_HEADER_NAME = "x-csrf-token";
export const CSRF_FORM_FIELD = "_csrf";
const CSRF_COOKIE_MAX_AGE_SECONDS = 24 * 60 * 60; // 24 hours

/** A fresh random token (base64url, 43 characters). */
export function issueCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Set-Cookie value for the token. `secure` adds the Secure flag — on when
 * the request came over HTTPS, off on plain http (local dev), because a
 * Secure cookie is never sent over http at all.
 */
export function csrfCookieHeader(token: string, secure: boolean): string {
  const parts = [
    `${CSRF_COOKIE_NAME}=${token}`,
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${CSRF_COOKIE_MAX_AGE_SECONDS}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/** Read one named cookie from a request. A malformed value (bare `%`) is
 *  treated as missing, never a crash — decodeURIComponent throws on it.
 *  One parser serves the whole app (see parseCookies in session.ts); this
 *  is just the single-cookie view of it. */
export function readCookie(request: Request, name: string): string | undefined {
  return parseCookies(request)[name];
}

/** The standard 403 for a missing or mismatched CSRF token — one wording
 *  everywhere, so a client never has to guess which message it will get. */
export function csrfInvalidResponse(): Response {
  return errorResponse(
    403,
    "csrf_invalid",
    "That form has expired. Refresh the page and try again.",
  );
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf-8");
  const bufB = Buffer.from(b, "utf-8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Check a state-changing request. The token must arrive twice and match:
 * once in the `rk_csrf` cookie and once in the `x-csrf-token` header (or
 * the `_csrf` field of a JSON body). GET/HEAD requests do not change
 * anything, so they are not checked.
 */
export function verifyCsrfToken(request: Request, body?: Record<string, unknown>): boolean {
  if (request.method === "GET" || request.method === "HEAD") return true;
  const fromCookie = readCookie(request, CSRF_COOKIE_NAME);
  if (!fromCookie) return false;
  const fromHeader = request.headers.get(CSRF_HEADER_NAME)?.trim();
  const fromBody = typeof body?.[CSRF_FORM_FIELD] === "string" ? body[CSRF_FORM_FIELD] : "";
  const candidate = fromHeader || fromBody;
  if (!candidate) return false;
  return safeEqual(fromCookie, candidate);
}

/**
 * Get the token the browser should send back: the one already in its
 * cookie, or a fresh one (the caller then sets it with csrfCookieHeader).
 */
export function getOrIssueCsrfToken(request: Request): { token: string; fresh: boolean } {
  const existing = readCookie(request, CSRF_COOKIE_NAME);
  if (existing && existing.length >= 20) return { token: existing, fresh: false };
  return { token: issueCsrfToken(), fresh: true };
}
