import { buildClipPrompt, checkEpisode, totalDuration, uid, type Episode } from "./story-rules";
import type { Project } from "./editor-rules";

export const WAIT_MS = 2 * 60 * 60 * 1000;
export const GRACE_MS = 30 * 60 * 1000;
export const EDIT_MS = 3000;
export const CHECK_MS = 6000;
export type PipelineStatus =
  "created" | "editing" | "waiting" | "reminded" | "auto" | "approved" | "rejected" | "needs-edit";
export interface CheckItem {
  id: string;
  label: string;
  pass: boolean;
}
export interface Event {
  id: string;
  at: number;
  text: string;
}
export interface Notice {
  id: string;
  at: number;
  text: string;
  read: boolean;
  kind: "reminder" | "failure";
}
export interface Output {
  edit?: Project | undefined;
  duration: number;
  aspect: string;
  playable: boolean;
  sound: boolean;
  watermarkFree: boolean;
  nonEmpty: boolean;
  captions: boolean;
  title: string;
  cover: string | null;
  characterPrompts: string[];
}
export interface DailyVideo {
  id: string;
  episode: Episode;
  seriesTitle: string;
  title: string;
  createdAt: number;
  status: PipelineStatus;
  output: Output;
  checks: CheckItem[];
  events: Event[];
  notices: Notice[];
  waitingAt?: number | undefined;
  reminderAt?: number | undefined;
  postedAt?: number | undefined;
}
export const STATUS_LABELS: Record<PipelineStatus, string> = {
  created: "Created",
  editing: "Auto-edited",
  waiting: "Waiting for approval",
  reminded: "Reminder sent",
  auto: "Posted (auto)",
  approved: "Approved",
  rejected: "Rejected",
  "needs-edit": "Needs manual edit",
};
export function inspectOutput(ep: Episode, out: Output): CheckItem[] {
  return [
    {
      id: "length",
      label: "Length is 30–40 seconds",
      pass: Number.isFinite(out.duration) && out.duration >= 30 && out.duration <= 40,
    },
    { id: "format", label: "Vertical 9:16", pass: out.aspect === "9:16" },
    {
      id: "playable",
      label: "Complete and plays",
      pass: out.playable && checkEpisode(ep).complete,
    },
    { id: "sound", label: "Sound present", pass: out.sound },
    { id: "watermark", label: "No watermark problem", pass: out.watermarkFree },
    {
      id: "empty",
      label: "No black or empty clip",
      pass: out.nonEmpty && ep.clips.every((c) => Boolean(c.prompt.trim())),
    },
    { id: "captions", label: "Captions present", pass: out.captions },
    { id: "title", label: "Title and cover present", pass: Boolean(out.title.trim() && out.cover) },
    {
      id: "character",
      label: "Character used on all 5 clips",
      pass:
        Boolean(ep.characterDescription.trim()) &&
        out.characterPrompts.length === 5 &&
        out.characterPrompts.every((p) =>
          p.includes(`Character (keep consistent): ${ep.characterDescription.trim()}`),
        ),
    },
  ];
}
export function allPassed(v: DailyVideo) {
  return (
    v.checks.length === 9 &&
    v.checks.every((c) => c.pass) &&
    inspectOutput(v.episode, v.output).every((c) => c.pass)
  );
}
function event(at: number, text: string): Event {
  return { id: uid("event"), at, text };
}
export function startDaily(
  ep: Episode,
  seriesTitle: string,
  now: number,
  override: Partial<Output> = {},
  note = "Created — 5 clips sent to auto-edit",
): DailyVideo {
  if (!checkEpisode(ep).complete) throw new Error("Complete the five-clip episode first.");
  return {
    id: uid("daily"),
    episode: structuredClone(ep),
    seriesTitle,
    title: `${seriesTitle} — Episode ${ep.number}`,
    createdAt: now,
    status: "created",
    output: {
      duration: totalDuration(ep.clips),
      aspect: "9:16",
      playable: true,
      sound: true,
      watermarkFree: true,
      nonEmpty: true,
      captions: true,
      title: ep.title,
      cover: ep.firstFrame,
      characterPrompts: ep.clips.map((c) => buildClipPrompt(ep.characterDescription, c)),
      ...override,
    },
    checks: [],
    events: [event(now, note)],
    notices: [],
  };
}
export function advanceDaily(video: DailyVideo, now: number): DailyVideo {
  let v = video;
  if (v.status === "created" && now >= v.createdAt + EDIT_MS) {
    v = {
      ...v,
      status: "editing",
      events: [
        ...v.events,
        event(
          v.createdAt + EDIT_MS,
          "Auto-edited — trimmed, merged, transitions, captions, title, cover and audio normalised",
        ),
      ],
    };
  }
  if (v.status === "editing" && now >= v.createdAt + CHECK_MS) {
    const checks = inspectOutput(v.episode, v.output);
    const pass = checks.every((c) => c.pass);
    const at = v.createdAt + CHECK_MS;
    v = {
      ...v,
      checks,
      status: pass ? "waiting" : "needs-edit",
      waitingAt: pass ? at : undefined,
      events: [
        ...v.events,
        event(
          at,
          pass
            ? "Checks passed 9/9"
            : `Checks failed — ${checks
                .filter((c) => !c.pass)
                .map((c) => c.label)
                .join(", ")}`,
        ),
        event(
          at,
          pass ? "Waiting for approval — 2 hours" : "Needs manual edit — returned to Create",
        ),
      ],
      notices: pass
        ? v.notices
        : [
            ...v.notices,
            {
              id: uid("notice"),
              at,
              kind: "failure",
              read: false,
              text: `${v.title}: checks failed. Needs manual edit in Create.`,
            },
          ],
    };
  }
  // Revalidate before every automatic transition: failed outputs can never post.
  if ((v.status === "waiting" || v.status === "reminded") && !allPassed(v)) {
    const checks = inspectOutput(v.episode, v.output);
    return {
      ...v,
      status: "needs-edit",
      checks,
      // Clear the waiting/reminder timestamps: a demoted video is no
      // longer counting down to anything, and stale values would mislead
      // the next reader (and the next transition) about its state.
      waitingAt: undefined,
      reminderAt: undefined,
      events: [...v.events, event(now, "Checks failed — Needs manual edit; posting blocked")],
      notices: [
        ...v.notices,
        {
          id: uid("notice"),
          at: now,
          kind: "failure",
          read: false,
          text: `${v.title}: checks failed. Fix in Create.`,
        },
      ],
    };
  }
  if (v.status === "waiting" && v.waitingAt !== undefined && now >= v.waitingAt + WAIT_MS) {
    v = {
      ...v,
      status: "reminded",
      reminderAt: now,
      events: [...v.events, event(now, "Reminder sent — 30-minute grace period started")],
      notices: [
        ...v.notices,
        {
          id: uid("notice"),
          at: now,
          kind: "reminder",
          read: false,
          text: `${v.title} passed all 9 checks. It will auto-post shortly, in 30 minutes, if there is still no response.`,
        },
      ],
    };
  }
  if (v.status === "reminded" && v.reminderAt !== undefined && now >= v.reminderAt + GRACE_MS) {
    v = {
      ...v,
      status: "auto",
      postedAt: v.reminderAt + GRACE_MS,
      events: [
        ...v.events,
        event(
          v.reminderAt + GRACE_MS,
          `Auto-posted after no response — reminder sent at ${new Date(v.reminderAt).toLocaleString()}`,
        ),
      ],
    };
  }
  return v;
}
export function respondDaily(
  v: DailyVideo,
  action: "approve" | "reject" | "edit",
  now: number,
): DailyVideo {
  if (
    v.status !== "waiting" &&
    v.status !== "reminded" &&
    !(action === "edit" && v.status === "needs-edit")
  )
    return v;
  if (action === "approve" && !allPassed(v)) return advanceDaily(v, now);
  return {
    ...v,
    status: action === "approve" ? "approved" : action === "reject" ? "rejected" : "needs-edit",
    postedAt: action === "approve" ? now : undefined,
    events: [
      ...v.events,
      event(
        now,
        action === "approve"
          ? "Approved — posted immediately (demo)"
          : action === "reject"
            ? "Rejected — stopped; returned to Create"
            : "Needs manual edit — stopped; returned to Create",
      ),
    ],
  };
}
export function deadline(v: DailyVideo) {
  return v.reminderAt !== undefined
    ? v.reminderAt + GRACE_MS
    : v.waitingAt !== undefined
      ? v.waitingAt + WAIT_MS
      : undefined;
}
export function autoPostTime(v: DailyVideo) {
  return v.reminderAt !== undefined
    ? v.reminderAt + GRACE_MS
    : v.waitingAt !== undefined
      ? v.waitingAt + WAIT_MS + GRACE_MS
      : undefined;
}
