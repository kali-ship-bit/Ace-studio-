import { describe, expect, it } from "vitest";
import {
  buildClipPrompt,
  checkEpisode,
  clampClipDuration,
  moveItem,
  type Clip,
} from "./story-rules";
import { SAMPLE_EPISODES } from "./story-data";

const clips = (secs: number[]): Clip[] =>
  secs.map((d, i) => ({ id: String(i), prompt: "x", durationSec: d }));
const base = { characterDescription: "Amara", firstFrame: "img" };

describe("story rules", () => {
  it("clamps clip length to 5–8 seconds", () => {
    expect(clampClipDuration(3)).toBe(5);
    expect(clampClipDuration(10)).toBe(8);
    expect(clampClipDuration(6)).toBe(6);
  });
  it("requires exactly five clips", () => {
    expect(checkEpisode({ ...base, clips: clips([8, 8, 8, 8]) }).complete).toBe(false);
    expect(checkEpisode({ ...base, clips: clips([7, 7, 7, 7, 7]) }).complete).toBe(true);
  });
  it("requires 30–40 seconds total", () => {
    expect(checkEpisode({ ...base, clips: clips([5, 5, 5, 5, 5]) }).complete).toBe(false); // 25s
    expect(checkEpisode({ ...base, clips: clips([6, 6, 6, 6, 6]) }).complete).toBe(true); // 30s
    expect(checkEpisode({ ...base, clips: clips([8, 8, 8, 8, 8]) }).complete).toBe(true); // 40s
  });
  it("rejects a clip longer than 8 seconds", () => {
    expect(checkEpisode({ ...base, clips: clips([9, 7, 7, 7, 7]) }).complete).toBe(false);
  });
  it("attaches the character description to every prompt", () => {
    expect(
      buildClipPrompt("Amara in blue hoodie", { id: "a", prompt: "Walks", durationSec: 7 }),
    ).toContain("Amara in blue hoodie");
  });
  it("reorders clips", () => {
    expect(moveItem([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
  });
  it("sample episodes are complete", () => {
    SAMPLE_EPISODES.forEach((e) => expect(checkEpisode(e).complete).toBe(true));
  });
});
