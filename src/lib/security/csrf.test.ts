import { describe, expect, it } from "vitest";
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  csrfCookieHeader,
  getOrIssueCsrfToken,
  issueCsrfToken,
  verifyCsrfToken,
} from "./csrf";

function requestWith(method: string, cookie: string | null, header: string | null): Request {
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  if (header) headers.set(CSRF_HEADER_NAME, header);
  return new Request("https://example.com/api/login", { method, headers });
}

describe("CSRF double-submit", () => {
  it("issues a random token and accepts it when cookie and header match", () => {
    const token = issueCsrfToken();
    expect(token.length).toBeGreaterThan(20);
    expect(issueCsrfToken()).not.toBe(token);
    const req = requestWith("POST", `${CSRF_COOKIE_NAME}=${token}`, token);
    expect(verifyCsrfToken(req)).toBe(true);
  });

  it("rejects a missing token, a mismatched token, and a missing cookie", () => {
    const token = issueCsrfToken();
    expect(verifyCsrfToken(requestWith("POST", `${CSRF_COOKIE_NAME}=${token}`, null))).toBe(false);
    expect(verifyCsrfToken(requestWith("POST", `${CSRF_COOKIE_NAME}=${token}`, "other"))).toBe(
      false,
    );
    expect(verifyCsrfToken(requestWith("POST", null, token))).toBe(false);
  });

  it("accepts the token from the JSON body field as well as the header", () => {
    const token = issueCsrfToken();
    const req = requestWith("POST", `${CSRF_COOKIE_NAME}=${token}`, null);
    expect(verifyCsrfToken(req, { _csrf: token })).toBe(true);
    expect(verifyCsrfToken(req, { _csrf: "wrong" })).toBe(false);
  });

  it("does not check GET requests", () => {
    expect(verifyCsrfToken(requestWith("GET", null, null))).toBe(true);
  });

  it("sets Secure only when asked, and getOrIssue reuses an existing token", () => {
    expect(csrfCookieHeader("tok", true)).toContain("Secure");
    expect(csrfCookieHeader("tok", false)).not.toContain("Secure");
    const req = requestWith("GET", `${CSRF_COOKIE_NAME}=abcdefghijklmnopqrst`, null);
    const got = getOrIssueCsrfToken(req);
    expect(got).toEqual({ token: "abcdefghijklmnopqrst", fresh: false });
    expect(getOrIssueCsrfToken(requestWith("GET", null, null)).fresh).toBe(true);
  });

  it("a malformed cookie value (bare %) is treated as missing, never a crash", () => {
    const req = requestWith("POST", `${CSRF_COOKIE_NAME}=%`, "x-csrf-token");
    expect(() => verifyCsrfToken(req)).not.toThrow();
    expect(verifyCsrfToken(req)).toBe(false);
  });
});
