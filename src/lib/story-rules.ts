export const CLIPS_PER_EPISODE = 5;
export const CLIP_MIN_SEC = 5;
export const CLIP_MAX_SEC = 8;
export const EPISODE_MIN_SEC = 30;
export const EPISODE_MAX_SEC = 40;
export const ASPECT = "9:16";

export interface Clip {
  id: string;
  prompt: string;
  durationSec: number;
}

export interface Episode {
  id: string;
  seriesId: string;
  number: number;
  title: string;
  summary: string;
  characterDescription: string;
  firstFrame: string | null;
  clips: Clip[];
  status: "draft" | "sample";
  updatedAt: number;
}

export interface Series {
  id: string;
  title: string;
  genre: string;
  logline: string;
  characterDescription: string;
  cover: string;
}

export function clampClipDuration(sec: number): number {
  if (!Number.isFinite(sec)) return CLIP_MIN_SEC;
  return Math.min(CLIP_MAX_SEC, Math.max(CLIP_MIN_SEC, Math.round(sec)));
}

export function totalDuration(clips: Clip[]): number {
  return clips.reduce((s, c) => s + c.durationSec, 0);
}

export interface EpisodeCheck {
  complete: boolean;
  issues: string[];
  total: number;
}

export function checkEpisode(
  ep: Pick<Episode, "clips" | "characterDescription" | "firstFrame">,
): EpisodeCheck {
  const issues: string[] = [];
  const total = totalDuration(ep.clips);
  if (ep.clips.length !== CLIPS_PER_EPISODE)
    issues.push(`Needs exactly ${CLIPS_PER_EPISODE} clips (has ${ep.clips.length})`);
  ep.clips.forEach((c, i) => {
    if (!c.prompt.trim()) issues.push(`Clip ${i + 1} needs a prompt`);
    if (
      !Number.isFinite(c.durationSec) ||
      c.durationSec < CLIP_MIN_SEC ||
      c.durationSec > CLIP_MAX_SEC
    )
      issues.push(`Clip ${i + 1} must be ${CLIP_MIN_SEC}–${CLIP_MAX_SEC}s`);
  });
  if (total < EPISODE_MIN_SEC || total > EPISODE_MAX_SEC)
    issues.push(`Episode must total ${EPISODE_MIN_SEC}–${EPISODE_MAX_SEC}s (now ${total}s)`);
  if (!ep.characterDescription.trim()) issues.push("Character description is empty");
  if (!ep.firstFrame) issues.push("Add a first-frame image");
  return { complete: issues.length === 0, issues, total };
}

/** Full prompt sent per clip: locked character description is always attached. */
export function buildClipPrompt(characterDescription: string, clip: Clip): string {
  return `${clip.prompt.trim()}\n\nCharacter (keep consistent): ${characterDescription.trim()}\nFormat: vertical ${ASPECT}, ${clip.durationSec}s`;
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

let counter = 0;
export function uid(prefix = "id"): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter}`;
}

export function blankClips(): Clip[] {
  return Array.from({ length: CLIPS_PER_EPISODE }, () => ({
    id: uid("clip"),
    prompt: "",
    durationSec: 7,
  }));
}
