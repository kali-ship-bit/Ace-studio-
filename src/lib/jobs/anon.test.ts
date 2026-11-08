import { describe, expect, it } from "vitest";
import {
  ANON_COOKIE_NAME,
  anonCookieHeader,
  getAnonId,
  isOwnJob,
  ownerIdForRead,
  ownerIdForRequest,
} from "./anon";

const UUID = "11111111-2222-3333-4444-555555555555";

function req(cookieValue?: string): Request {
  return new Request(
    "http://localhost/api/jobs",
    cookieValue ? { headers: { cookie: `${ANON_COOKIE_NAME}=${cookieValue}` } } : {},
  );
}

describe("anonymous job ownership", () => {
  it("reads a well-formed anonymous id from the cookie", () => {
    expect(getAnonId(req(UUID))).toBe(UUID);
  });

  it("ignores a missing or malformed anonymous id", () => {
    expect(getAnonId(req())).toBeUndefined();
    const bad = new Request("http://localhost/api/jobs", {
      headers: { cookie: `${ANON_COOKIE_NAME}=not-a-uuid` },
    });
    expect(getAnonId(bad)).toBeUndefined();
  });

  it("issues a fresh id with a cookie on first use, then reuses it", async () => {
    const first = await ownerIdForRequest(req());
    expect(first.ownerId).toMatch(/^anon:[0-9a-f-]{36}$/i);
    expect(first.setCookie).toContain(`${ANON_COOKIE_NAME}=`);
    expect(first.setCookie).toContain("HttpOnly");
    // A request carrying the issued cookie keeps the same owner, and
    // no new cookie is issued.
    const withCookie = new Request("http://localhost/api/jobs", {
      headers: { cookie: first.setCookie?.split(";")[0] ?? "" },
    });
    const again = await ownerIdForRequest(withCookie);
    expect(again.ownerId).toBe(first.ownerId);
    expect(again.setCookie).toBeNull();
  });

  it("reads never issue a cookie, and a reader with no id owns nothing", async () => {
    expect(await ownerIdForRead(req())).toBeNull();
    expect(await ownerIdForRead(req(UUID))).toBe(`anon:${UUID}`);
  });

  it("isOwnJob matches only the exact owner", () => {
    expect(isOwnJob(`anon:${UUID}`, `anon:${UUID}`)).toBe(true);
    expect(isOwnJob(`anon:${UUID}`, "anon:other")).toBe(false);
    expect(isOwnJob(undefined, `anon:${UUID}`)).toBe(false);
    expect(isOwnJob(`anon:${UUID}`, null)).toBe(false);
  });

  it("anonCookieHeader is HttpOnly, SameSite=Lax, and Secure on https", () => {
    expect(anonCookieHeader(UUID, false)).toContain("HttpOnly");
    expect(anonCookieHeader(UUID, false)).toContain("SameSite=Lax");
    expect(anonCookieHeader(UUID, false)).not.toContain("Secure");
    expect(anonCookieHeader(UUID, true)).toContain("Secure");
  });
});
