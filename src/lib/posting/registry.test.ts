import { describe, expect, it } from "vitest";
import { PLATFORMS } from "./registry";

describe("posting registry", () => {
  it("lists all 10 platforms", () => {
    expect(PLATFORMS).toHaveLength(10);
    expect(PLATFORMS.map((p) => p.id)).toEqual([
      "instagram",
      "facebook",
      "tiktok",
      "youtube",
      "x",
      "snapchat",
      "twitch",
      "kick",
      "rumble",
      "dailymotion",
    ]);
  });

  it("has an id, label, description, monetisation note, status and requiredEnv per platform", () => {
    for (const platform of PLATFORMS) {
      expect(platform.id.length).toBeGreaterThan(0);
      expect(platform.label.length).toBeGreaterThan(0);
      expect(platform.description.length).toBeGreaterThan(0);
      expect(platform.monetisation.length).toBeGreaterThan(0);
      expect(["ready-when-configured", "checklist-only"]).toContain(platform.status);
      expect(Array.isArray(platform.requiredEnv)).toBe(true);
    }
  });

  it("marks the four implemented platforms ready-when-configured and the rest checklist-only", () => {
    const ready = PLATFORMS.filter((p) => p.status === "ready-when-configured").map((p) => p.id);
    expect(ready).toEqual(["instagram", "facebook", "tiktok", "youtube"]);
    const checklist = PLATFORMS.filter((p) => p.status === "checklist-only").map((p) => p.id);
    expect(checklist).toEqual(["x", "snapchat", "twitch", "kick", "rumble", "dailymotion"]);
  });

  it("names the exact env vars the implemented routes need", () => {
    const byId = Object.fromEntries(PLATFORMS.map((p) => [p.id, p.requiredEnv]));
    expect(byId["instagram"]).toEqual(["IG_USER_ID", "IG_ACCESS_TOKEN"]);
    expect(byId["facebook"]).toEqual(["FACEBOOK_PAGE_ID", "FACEBOOK_PAGE_ACCESS_TOKEN"]);
    expect(byId["tiktok"]).toEqual([
      "TIKTOK_CLIENT_KEY",
      "TIKTOK_CLIENT_SECRET",
      "TIKTOK_ACCESS_TOKEN",
    ]);
    expect(byId["youtube"]).toEqual([
      "YOUTUBE_CLIENT_ID",
      "YOUTUBE_CLIENT_SECRET",
      "YOUTUBE_REFRESH_TOKEN",
    ]);
  });

  it("never states a specific payout rate", () => {
    for (const platform of PLATFORMS) {
      expect(platform.monetisation).toContain("Nigeria eligibility varies");
      expect(platform.monetisation).not.toMatch(/\$\d/);
      expect(platform.monetisation).not.toMatch(/\d+%/);
    }
  });

  it("contains no secret values anywhere in the registry", () => {
    const text = JSON.stringify(PLATFORMS);
    expect(text).not.toContain("token-");
    expect(text).not.toContain("secret");
  });
});
