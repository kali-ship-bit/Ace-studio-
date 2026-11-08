import { describe, expect, it } from "vitest";
import { SAMPLE_EPISODES } from "./story-data";
import {
  advanceDaily,
  allPassed,
  CHECK_MS,
  GRACE_MS,
  inspectOutput,
  respondDaily,
  startDaily,
  WAIT_MS,
} from "./pipeline-rules";

const episode = SAMPLE_EPISODES[0];
if (!episode) throw new Error("Missing sample episode");
const start = () => startDaily(episode, "The Phone That Knew Tomorrow", 0);
const waiting = () => advanceDaily(start(), CHECK_MS);
describe("daily pipeline safety and timing", () => {
  it("only accepts completed five-clip episodes", () => {
    expect(() =>
      startDaily({ ...episode, clips: episode.clips.slice(0, 4) }, "Phone", 0),
    ).toThrow();
  });
  it("checks all nine requirements before waiting", () => {
    const v = waiting();
    expect(v.status).toBe("waiting");
    expect(v.checks.length).toBe(9);
    expect(allPassed(v)).toBe(true);
  });
  it("waits exactly two hours before sending reminder and never posts during the wait", () => {
    expect(WAIT_MS).toBe(7200000);
    expect(advanceDaily(waiting(), CHECK_MS + 7199999).status).toBe("waiting");
    const v = advanceDaily(waiting(), CHECK_MS + 7200000);
    expect(v.status).toBe("reminded");
    expect(v.notices.length).toBe(1);
    expect(v.reminderAt).toBe(CHECK_MS + 7200000);
  });
  it("waits exactly 30 minutes after reminder before auto-post", () => {
    expect(GRACE_MS).toBe(1800000);
    const v = advanceDaily(waiting(), CHECK_MS + WAIT_MS);
    expect(advanceDaily(v, CHECK_MS + WAIT_MS + 1799999).status).toBe("reminded");
    expect(advanceDaily(v, CHECK_MS + WAIT_MS + 1800000).status).toBe("auto");
  });
  it("gives a full grace period when reopened after being closed", () => {
    const now = CHECK_MS + WAIT_MS + GRACE_MS * 3;
    const v = advanceDaily(waiting(), now);
    expect(v.status).toBe("reminded");
    expect(v.reminderAt).toBe(now);
    expect(advanceDaily(v, now + GRACE_MS - 1).status).toBe("reminded");
  });
  const failures = [
    "length",
    "format",
    "playable",
    "sound",
    "watermark",
    "empty",
    "captions",
    "title",
    "character",
  ];
  failures.forEach((id) =>
    it(`blocks posting when ${id} check fails`, () => {
      const v = start();
      const out = { ...v.output };
      if (id === "length") out.duration = 41;
      if (id === "format") out.aspect = "16:9";
      if (id === "playable") out.playable = false;
      if (id === "sound") out.sound = false;
      if (id === "watermark") out.watermarkFree = false;
      if (id === "empty") out.nonEmpty = false;
      if (id === "captions") out.captions = false;
      if (id === "title") out.title = "";
      if (id === "character") out.characterPrompts = [];
      expect(inspectOutput(v.episode, out).find((c) => c.id === id)?.pass).toBe(false);
      const held = advanceDaily({ ...v, output: out }, CHECK_MS + WAIT_MS + GRACE_MS);
      expect(held.status).toBe("needs-edit");
      expect(held.notices.length).toBe(1);
      expect(advanceDaily(held, 999999999).status).toBe("needs-edit");
    }),
  );
  it("rechecks failed outputs before auto-post even if old checks passed", () => {
    const v = advanceDaily(waiting(), CHECK_MS + WAIT_MS);
    expect(
      advanceDaily({ ...v, output: { ...v.output, sound: false } }, CHECK_MS + WAIT_MS + GRACE_MS)
        .status,
    ).toBe("needs-edit");
  });
  it("approves immediately in demo and stops further automation", () => {
    const v = respondDaily(waiting(), "approve", CHECK_MS + 100);
    expect(v.status).toBe("approved");
    expect(v.postedAt).toBe(CHECK_MS + 100);
    expect(advanceDaily(v, 999999999).status).toBe("approved");
  });
  it.each(["reject", "edit"] as const)("%s stops automation", (action) => {
    const v = respondDaily(waiting(), action, CHECK_MS + 100);
    expect(v.status).toBe(action === "reject" ? "rejected" : "needs-edit");
    expect(advanceDaily(v, 999999999).postedAt).toBeUndefined();
  });
  it("never approves failed checks", () => {
    const v = waiting();
    expect(
      respondDaily({ ...v, output: { ...v.output, captions: false } }, "approve", CHECK_MS + 1)
        .status,
    ).toBe("needs-edit");
  });
});
