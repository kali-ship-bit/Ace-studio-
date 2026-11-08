/**
 * Client auth helper tests (Phase B). The browser fetch is stubbed —
 * these tests prove the helpers call the right routes and read the
 * right fields, not that a server is running.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCsrf, logout } from "./session";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(handler: (url: string, init?: RequestInit) => { ok: boolean; body: unknown }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const result = handler(url, init);
      return {
        ok: result.ok,
        json: async () => result.body,
      };
    }),
  );
}

describe("fetchCsrf", () => {
  it("returns the token from GET /api/auth/csrf", async () => {
    stubFetch((url) => {
      expect(url).toBe("/api/auth/csrf");
      return { ok: true, body: { csrfToken: "abc-token-123" } };
    });
    await expect(fetchCsrf()).resolves.toBe("abc-token-123");
  });

  it("throws when the CSRF call fails", async () => {
    stubFetch(() => ({ ok: false, body: {} }));
    await expect(fetchCsrf()).rejects.toThrow();
  });
});

describe("logout", () => {
  it("fetches a CSRF token, then posts to /api/auth/logout", async () => {
    const seen: string[] = [];
    stubFetch((url, init) => {
      seen.push(url);
      if (url === "/api/auth/csrf") return { ok: true, body: { csrfToken: "tok-1" } };
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({ "x-csrf-token": "tok-1" });
      return { ok: true, body: { ok: true } };
    });
    await expect(logout()).resolves.toBe(true);
    expect(seen).toEqual(["/api/auth/csrf", "/api/auth/logout"]);
  });
});
