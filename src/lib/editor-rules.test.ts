import { describe, expect, it } from "vitest";
import { SAMPLE_EPISODES } from "./story-data";
import { checkEpisode, moveItem } from "./story-rules";
import {
  advanceDaily,
  allPassed,
  CHECK_MS,
  GRACE_MS,
  respondDaily,
  startDaily,
  WAIT_MS,
} from "./pipeline-rules";
import {
  clampToSafe,
  deleteClip,
  duplicateClip,
  fromEpisode,
  hasSound,
  isValidEditorDraft,
  lengthWarning,
  splitAt,
  toEpisode,
  total,
  trimClip,
} from "./editor-rules";

const base = SAMPLE_EPISODES[0];
if (!base) throw new Error("Missing sample episode");
const project = () => fromEpisode(base, "The Phone That Knew Tomorrow");

describe("manual editing limits", () => {
  it("never trims below 1 second", () => {
    const p = project();
    const id = p.clips[0]?.id ?? "";
    expect(trimClip(p, id, "end", -100).clips[0]?.duration).toBe(1);
    expect(trimClip(p, id, "start", 100).clips[0]?.duration).toBe(1);
  });
  it("cannot extend past source boundaries", () => {
    const p = project();
    const id = p.clips[0]?.id ?? "";
    const trimmed = trimClip(p, id, "start", 2);
    expect(trimClip(trimmed, id, "end", 100).clips[0]?.duration).toBe(6);
    expect(trimClip(trimmed, id, "start", -100).clips[0]?.trimStart).toBe(0);
    expect(trimClip(trimmed, id, "start", -100).clips[0]?.duration).toBe(8);
  });
  it("only splits with at least 1 second on both sides", () => {
    const p = project();
    expect(splitAt(p, 0.9)).toBe(p);
    expect(splitAt(p, 7.1)).toBe(p);
    const split = splitAt(p, 3);
    expect(split.clips.length).toBe(6);
    expect(total(split)).toBe(38);
    expect(split.clips[1]?.trimStart).toBe(3);
    expect(split.texts.some((t) => t.clipId === split.clips[1]?.id)).toBe(true);
  });
  it("duplicates clips with independent captions and preserves reorder data", () => {
    const p = project();
    const id = p.clips[0]?.id ?? "";
    const duplicated = duplicateClip(p, id);
    expect(duplicated.clips.length).toBe(6);
    expect(total(duplicated)).toBe(46);
    expect(duplicated.texts.some((t) => t.clipId === duplicated.clips[1]?.id)).toBe(true);
    expect(moveItem(p.clips, 0, 4)[4]?.id).toBe(id);
  });
  it("retains the last clip and removes deleted clip captions", () => {
    const p = project();
    const id = p.clips[0]?.id ?? "";
    const deleted = deleteClip(p, id);
    expect(deleted.clips.length).toBe(4);
    expect(deleted.texts.some((t) => t.clipId === id)).toBe(false);
    const single = { ...p, clips: p.clips.slice(0, 1) };
    expect(deleteClip(single, id)).toBe(single);
  });
  it("requires five clips of 5–8s and an exact 30–40s total after editing", () => {
    const p = project();
    const id = p.clips[0]?.id ?? "";
    const invalid = toEpisode(trimClip(p, id, "end", -3.1), base);
    expect(invalid.episode.clips[0]?.durationSec).toBe(4.9);
    expect(checkEpisode(invalid.episode).complete).toBe(false);
    expect(checkEpisode(toEpisode(splitAt(p, 3), base).episode).complete).toBe(false);
    expect(checkEpisode(toEpisode(deleteClip(p, id), base).episode).complete).toBe(false);
    expect(lengthWarning({ clips: p.clips.map((c) => ({ ...c, duration: 6 })) })).toBeNull();
    expect(lengthWarning({ clips: p.clips.map((c) => ({ ...c, duration: 8 })) })).toBeNull();
    expect(lengthWarning({ clips: p.clips.map((c) => ({ ...c, duration: 5.9 })) })).toContain(
      "Too short",
    );
    expect(lengthWarning({ clips: p.clips.map((c) => ({ ...c, duration: 8.1 })) })).toContain(
      "Too long",
    );
  });
  it("keeps text and overlays inside safe positions", () => {
    expect(clampToSafe(-50, 150)).toEqual({ x: 12, y: 88 });
    expect(clampToSafe(100, 0)).toEqual({ x: 88, y: 10 });
  });
  it("accepts a well-formed saved editor draft and rejects malformed ones", () => {
    const p = project();
    expect(isValidEditorDraft(structuredClone(p))).toBe(true);
    expect(isValidEditorDraft(null)).toBe(false);
    expect(isValidEditorDraft("nope")).toBe(false);
    expect(isValidEditorDraft({ ...p, clips: [] })).toBe(false);
    expect(isValidEditorDraft({ ...p, clips: [{ id: 7, prompt: "x" }] })).toBe(false);
    expect(isValidEditorDraft({ ...p, clips: p.clips.map((c) => ({ ...c, duration: "7" })) })).toBe(
      false,
    );
    expect(isValidEditorDraft({ ...p, clips: p.clips.map((c) => ({ ...c, duration: -2 })) })).toBe(
      false,
    );
    expect(isValidEditorDraft({ ...p, aspect: "4:3" })).toBe(false);
    expect(isValidEditorDraft({ ...p, texts: [{ id: "t", text: 5 }] })).toBe(false);
    expect(isValidEditorDraft({ ...p, overlays: "none" })).toBe(false);
    expect(isValidEditorDraft({ ...p, music: { id: "a1" } })).toBe(false);
    expect(isValidEditorDraft({ ...p, coverTime: Number.NaN })).toBe(false);
  });
  it("fails sound when every clip and music are muted", () => {
    const p = project();
    const muted = { ...p, clips: p.clips.map((c) => ({ ...c, muted: true })), musicVolume: 0 };
    expect(hasSound(muted)).toBe(false);
    expect(hasSound({ ...muted, musicVolume: 40 })).toBe(true);
    expect(hasSound({ ...muted, music: null })).toBe(false);
  });
  it("snapshots all edits and preserves exact duration and selected cover", () => {
    const p = project();
    p.coverTime = 9;
    const second = p.clips[1];
    if (second) second.image = "second-cover";
    const edited = trimClip(p, p.clips[0]?.id ?? "", "end", -0.5);
    const converted = toEpisode(edited, base);
    expect(converted.output.duration).toBe(37.5);
    expect(converted.output.cover).toBe("second-cover");
    p.texts = [];
    expect(converted.output.edit?.texts.length).toBe(6);
  });
});

describe("manual edits never bypass nine checks", () => {
  it("only allows repaired edits to wait and approve after rechecking", () => {
    const p = project();
    const converted = toEpisode(p, base);
    const sent = startDaily(converted.episode, "Phone", 0, converted.output);
    expect(sent.checks).toEqual([]);
    const checked = advanceDaily(sent, CHECK_MS);
    expect(checked.checks).toHaveLength(9);
    expect(allPassed(checked)).toBe(true);
    expect(respondDaily(checked, "approve", CHECK_MS + 1).status).toBe("approved");
  });
  it.each(["ratio", "sound", "captions", "empty"])(
    "holds %s failures and never posts after timers expire",
    (failure) => {
      const p = project();
      if (failure === "ratio") p.aspect = "1:1";
      if (failure === "sound") {
        p.clips = p.clips.map((c) => ({ ...c, muted: true }));
        p.music = null;
      }
      if (failure === "captions") p.texts = p.texts.filter((t) => t.kind !== "caption");
      if (failure === "empty") p.clips = p.clips.map((c) => ({ ...c, image: null }));
      const converted = toEpisode(p, base);
      const sent = startDaily(converted.episode, "Phone", 0, converted.output);
      const held = advanceDaily(sent, CHECK_MS);
      expect(held.status).toBe("needs-edit");
      expect(respondDaily(held, "approve", CHECK_MS + 1).postedAt).toBeUndefined();
      expect(advanceDaily(held, CHECK_MS + WAIT_MS + GRACE_MS).postedAt).toBeUndefined();
    },
  );
});
