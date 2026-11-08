import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDevVarsCache } from "../jobs/env";
import { getPostingConfig, getPostingValues } from "./env";

const POSTING_VARS = [
  "META_APP_ID",
  "META_APP_SECRET",
  "IG_USER_ID",
  "IG_ACCESS_TOKEN",
  "FACEBOOK_PAGE_ID",
  "FACEBOOK_PAGE_ACCESS_TOKEN",
  "TIKTOK_CLIENT_KEY",
  "TIKTOK_CLIENT_SECRET",
  "TIKTOK_ACCESS_TOKEN",
  "YOUTUBE_CLIENT_ID",
  "YOUTUBE_CLIENT_SECRET",
  "YOUTUBE_REFRESH_TOKEN",
  "X_API_KEY",
  "X_API_SECRET",
  "X_ACCESS_TOKEN",
  "X_ACCESS_TOKEN_SECRET",
];

describe("posting env", () => {
  beforeEach(() => {
    resetDevVarsCache();
    for (const name of POSTING_VARS) delete process.env[name];
  });
  afterEach(() => {
    for (const name of POSTING_VARS) delete process.env[name];
    resetDevVarsCache();
  });

  it("reports instagram unconfigured with the missing var names when nothing is set", () => {
    expect(getPostingConfig("instagram")).toEqual({
      configured: false,
      missing: ["IG_USER_ID", "IG_ACCESS_TOKEN"],
    });
  });

  it("reports configured once all required vars are set", () => {
    process.env["IG_USER_ID"] = "test-ig-user-id";
    process.env["IG_ACCESS_TOKEN"] = "test-ig-access-token";
    expect(getPostingConfig("instagram")).toEqual({ configured: true, missing: [] });
  });

  it("reports only the still-missing vars when partly configured", () => {
    process.env["YOUTUBE_CLIENT_ID"] = "test-yt-client-id";
    expect(getPostingConfig("youtube")).toEqual({
      configured: false,
      missing: ["YOUTUBE_CLIENT_SECRET", "YOUTUBE_REFRESH_TOKEN"],
    });
  });

  it("never returns a secret value — only configured/missing names", () => {
    process.env["IG_USER_ID"] = "test-ig-user-id";
    process.env["IG_ACCESS_TOKEN"] = "test-ig-access-token";
    const text = JSON.stringify(getPostingConfig("instagram"));
    expect(text).not.toContain("test-ig-access-token");
    expect(text).not.toContain("test-ig-user-id");
  });

  it("never reports a checklist-only platform as configured", () => {
    // Kick has no required env vars at all, so the old "missing is
    // empty" test called it configured — promising a post that can
    // never happen. Checklist-only means no route exists, full stop.
    expect(getPostingConfig("kick")).toEqual({ configured: false, missing: [] });
    // X has required vars: setting them all must still not make it
    // look ready, because there is no X route either.
    process.env["X_API_KEY"] = "x-key";
    process.env["X_API_SECRET"] = "x-secret";
    process.env["X_ACCESS_TOKEN"] = "x-token";
    process.env["X_ACCESS_TOKEN_SECRET"] = "x-token-secret";
    expect(getPostingConfig("x")).toEqual({
      configured: false,
      missing: ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET"],
    });
  });

  it("getPostingValues returns undefined when unconfigured and values when configured", () => {
    expect(getPostingValues("facebook")).toBeUndefined();
    process.env["FACEBOOK_PAGE_ID"] = "test-page-id";
    process.env["FACEBOOK_PAGE_ACCESS_TOKEN"] = "test-page-token";
    expect(getPostingValues("facebook")).toEqual({
      FACEBOOK_PAGE_ID: "test-page-id",
      FACEBOOK_PAGE_ACCESS_TOKEN: "test-page-token",
    });
  });
});
