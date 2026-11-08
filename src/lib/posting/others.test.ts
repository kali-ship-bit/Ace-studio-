import { describe, expect, it } from "vitest";
import { CHECKLIST_PLATFORMS, checklistSummary, describeChecklistPlatform } from "./others";

describe("checklist-only platforms", () => {
  it("covers all six checklist-only platforms", () => {
    expect(CHECKLIST_PLATFORMS.map((p) => p.id)).toEqual([
      "x",
      "snapchat",
      "twitch",
      "kick",
      "rumble",
      "dailymotion",
    ]);
  });

  it("describes each platform honestly with what is needed", () => {
    for (const platform of CHECKLIST_PLATFORMS) {
      expect(platform.state.length).toBeGreaterThan(0);
      expect(platform.needed.length).toBeGreaterThan(0);
      expect(platform.notReadyMessage.length).toBeGreaterThan(0);
    }
  });

  it("states Twitch is live-streaming with VODs from streams, not uploads", () => {
    const twitch = describeChecklistPlatform("twitch");
    expect(twitch?.state).toMatch(/live-streaming/i);
    expect(twitch?.state).toMatch(/VOD/);
  });

  it("states Kick has no public upload API", () => {
    const kick = describeChecklistPlatform("kick");
    expect(kick?.state).toMatch(/no public upload API/i);
  });

  it("states X needs OAuth plus chunked media upload", () => {
    const x = describeChecklistPlatform("x");
    expect(x?.state).toMatch(/OAuth/);
    expect(x?.state).toMatch(/chunked media upload/i);
  });

  it("checklistSummary is a short public failure message, and unknown ids are safe", () => {
    expect(checklistSummary("kick")).toMatch(/Kick has no public upload API/);
    expect(checklistSummary("nope")).toBe("This platform is not supported yet.");
    expect(describeChecklistPlatform("instagram")).toBeUndefined();
  });
});
