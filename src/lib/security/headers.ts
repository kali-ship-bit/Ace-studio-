/**
 * Security response headers (Phase A/C).
 *
 * Applied to EVERY response in src/server.ts. In plain words:
 *   - HSTS: "only ever talk to this site over HTTPS" — the browser
 *     remembers it for a year, so even a mistyped http:// link is
 *     upgraded to https:// before anything is sent.
 *   - Content-Security-Policy: which places the page may load scripts,
 *     styles, images and data from. Anything else is blocked by the
 *     browser. This is the net that catches an XSS attempt even if a bad
 *     string slips through: a stolen script from another site cannot run.
 *     `unsafe-inline` is allowed for scripts and styles because TanStack
 *     Start injects small inline scripts/styles of its own; the real XSS
 *     defence stays React escaping + never using dangerouslySetInnerHTML
 *     (see SECURITY.md).
 *   - X-Content-Type-Options: stops the browser guessing a file's type
 *     (which attackers abuse to run uploads as scripts).
 *   - X-Frame-Options + frame-ancestors: the site cannot be framed inside
 *     another page (clickjacking defence).
 *   - Referrer-Policy: other sites do not learn which page you came from.
 *   - Permissions-Policy: the page never asks for camera, microphone or
 *     location.
 */

export interface HeaderOptions {
  /** Dev mode: allow the Vite HMR websocket on localhost. */
  isDev: boolean;
}

export function securityHeaders(options: HeaderOptions): Record<string, string> {
  const connectSrc = options.isDev
    ? "'self' https://*.supabase.co wss://*.supabase.co ws://127.0.0.1:* ws://localhost:*"
    : "'self' https://*.supabase.co wss://*.supabase.co";
  return {
    "strict-transport-security": "max-age=31536000; includeSubDomains",
    "content-security-policy": [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      `connect-src ${connectSrc}`,
      "media-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
    ].join("; "),
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
  };
}

/** Return a copy of `response` with the security headers added. */
export function withSecurityHeaders(response: Response, options: HeaderOptions): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(securityHeaders(options))) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
