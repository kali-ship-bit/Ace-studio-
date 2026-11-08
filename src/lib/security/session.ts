/**
 * Session cookies (Phase A/B).
 *
 * WHAT THIS IS, IN PLAIN WORDS: after you log in, the server gives your
 * browser two small tokens in cookies — one that proves who you are for
 * the next hour, and a longer-lived one that quietly gets you a fresh
 * hourly token without asking for your password again. The cookies are:
 *   - HttpOnly: JavaScript on the page cannot read them, so a bad script
 *     cannot steal them (this is the main defence against XSS token theft).
 *   - Secure: only ever sent over HTTPS, never over plain http.
 *     (Off on local http dev, or the browser would refuse the cookie.)
 *   - SameSite=Lax: the browser does not send them on requests that start
 *     from another site — a second layer against CSRF.
 *   - Path=/: sent on every page of the app.
 *
 * The tokens themselves are Supabase Auth tokens (see
 * src/lib/supabase/client.ts). Passwords are never stored in a cookie, and
 * Supabase hashes passwords with bcrypt — the app never sees or stores a
 * plain password.
 */

import { trustProxyHeaders } from "./rate-limit";

export const ACCESS_TOKEN_COOKIE = "rk_access_token";
export const REFRESH_TOKEN_COOKIE = "rk_refresh_token";
export const ACCESS_TOKEN_MAX_AGE_SECONDS = 60 * 60; // 1 hour (Supabase default)
export const REFRESH_TOKEN_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

/** True when this request arrived over HTTPS (directly or via a proxy).
 *  Like clientIp, x-forwarded-proto is only trusted behind a proxy the
 *  app controls — see trustProxyHeaders() in security/rate-limit.ts. */
export function isSecureRequest(request: Request): boolean {
  const url = new URL(request.url);
  if (url.protocol === "https:") return true;
  if (!trustProxyHeaders()) return false;
  const forwarded = request.headers.get("x-forwarded-proto");
  if (!forwarded) return false;
  const entries = forwarded
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  return entries[entries.length - 1] === "https";
}

function cookieValue(name: string, value: string, maxAge: number, secure: boolean): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/** Set-Cookie headers to send after a successful login / token refresh. */
export function buildSessionCookies(
  tokens: { accessToken: string; refreshToken: string },
  secure: boolean,
): string[] {
  return [
    cookieValue(ACCESS_TOKEN_COOKIE, tokens.accessToken, ACCESS_TOKEN_MAX_AGE_SECONDS, secure),
    cookieValue(REFRESH_TOKEN_COOKIE, tokens.refreshToken, REFRESH_TOKEN_MAX_AGE_SECONDS, secure),
  ];
}

/** Set-Cookie headers that delete both session cookies (logout). */
export function clearSessionCookies(secure: boolean): string[] {
  const parts = ["Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) parts.push("Secure");
  return [
    `${ACCESS_TOKEN_COOKIE}=; ${parts.join("; ")}`,
    `${REFRESH_TOKEN_COOKIE}=; ${parts.join("; ")}`,
  ];
}

/** Parse the Cookie header into a name -> value map. Malformed values
 *  (bare `%`) are skipped, never a crash. */
export function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get("cookie");
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      // Skip this cookie; a bad value must not break the whole request.
    }
  }
  return out;
}

/** The session tokens from the request cookies, if the user is logged in. */
export function getSessionTokens(request: Request): {
  accessToken: string | undefined;
  refreshToken: string | undefined;
} {
  const cookies = parseCookies(request);
  return {
    accessToken: cookies[ACCESS_TOKEN_COOKIE],
    refreshToken: cookies[REFRESH_TOKEN_COOKIE],
  };
}
