import { describe, expect, it } from "vitest";
import {
  ACCESS_TOKEN_COOKIE,
  buildSessionCookies,
  clearSessionCookies,
  getSessionTokens,
  isSecureRequest,
  parseCookies,
  REFRESH_TOKEN_COOKIE,
} from "./session";
import { securityHeaders, withSecurityHeaders } from "./headers";

function req(url: string, cookie?: string): Request {
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  return new Request(url, { headers });
}

describe("session cookies", () => {
  it("sets HttpOnly + SameSite=Lax, and Secure only over HTTPS", () => {
    const [access, refresh] = buildSessionCookies(
      { accessToken: "a-token", refreshToken: "r-token" },
      true,
    );
    expect(access).toContain(`${ACCESS_TOKEN_COOKIE}=a-token`);
    expect(access).toContain("HttpOnly");
    expect(access).toContain("SameSite=Lax");
    expect(access).toContain("Secure");
    expect(access).toContain("Max-Age=3600");
    expect(refresh).toContain(`${REFRESH_TOKEN_COOKIE}=r-token`);
    expect(refresh).toContain("Max-Age=2592000");
    const [plain] = buildSessionCookies({ accessToken: "a", refreshToken: "r" }, false);
    expect(plain).not.toContain("Secure");
  });

  it("clears both cookies on logout and reads them back from a request", () => {
    const cleared = clearSessionCookies(true);
    expect(cleared[0]).toContain("Max-Age=0");
    const tokens = getSessionTokens(
      req("https://example.com/", `${ACCESS_TOKEN_COOKIE}=aaa; ${REFRESH_TOKEN_COOKIE}=rrr`),
    );
    expect(tokens).toEqual({ accessToken: "aaa", refreshToken: "rrr" });
    expect(getSessionTokens(req("https://example.com/"))).toEqual({
      accessToken: undefined,
      refreshToken: undefined,
    });
  });

  it("detects HTTPS directly and behind a proxy", () => {
    expect(isSecureRequest(req("https://example.com/"))).toBe(true);
    expect(isSecureRequest(req("http://example.com/"))).toBe(false);
    const viaProxy = new Request("http://example.com/", {
      headers: { "x-forwarded-proto": "https" },
    });
    expect(isSecureRequest(viaProxy)).toBe(true);
  });

  it("trusts the LAST x-forwarded-proto entry, not a spoofed first one", () => {
    const lastHttps = new Request("http://example.com/", {
      headers: { "x-forwarded-proto": "http, https" },
    });
    expect(isSecureRequest(lastHttps)).toBe(true);
    const spoofed = new Request("http://example.com/", {
      headers: { "x-forwarded-proto": "https, http" },
    });
    expect(isSecureRequest(spoofed)).toBe(false);
  });

  it("a malformed cookie value (bare %) is skipped, never a crash", () => {
    const bad = req("http://localhost/", "rk_access_token=%; rk_refresh_token=ok%20token");
    expect(() => parseCookies(bad)).not.toThrow();
    expect(parseCookies(bad)).toEqual({ rk_refresh_token: "ok token" });
    expect(getSessionTokens(bad).refreshToken).toBe("ok token");
  });
});

describe("security headers", () => {
  it("sets HSTS, CSP, nosniff, DENY framing and a locked-down permissions policy", () => {
    const headers = securityHeaders({ isDev: false });
    expect(headers["strict-transport-security"]).toContain("max-age=31536000");
    expect(headers["content-security-policy"]).toContain("default-src 'self'");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["content-security-policy"]).toContain("https://*.supabase.co");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["permissions-policy"]).toContain("camera=()");
    // Dev mode allows the local HMR websocket; production does not.
    expect(securityHeaders({ isDev: true })["content-security-policy"]).toContain("ws://127.0.0.1");
    expect(securityHeaders({ isDev: false })["content-security-policy"]).not.toContain(
      "ws://127.0.0.1",
    );
  });

  it("withSecurityHeaders copies the headers onto a response", () => {
    const out = withSecurityHeaders(new Response("ok"), { isDev: false });
    expect(out.headers.get("strict-transport-security")).toContain("max-age=31536000");
    expect(out.status).toBe(200);
  });
});
