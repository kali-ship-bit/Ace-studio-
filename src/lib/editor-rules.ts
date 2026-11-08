import {
  buildClipPrompt,
  EPISODE_MAX_SEC,
  EPISODE_MIN_SEC,
  uid,
  type Episode,
} from "./story-rules";
import type { Output } from "./pipeline-rules";

export type FilterId = "none" | "bright" | "warm" | "clean" | "cool";
export type EffectId = "none" | "glow" | "vignette" | "grain";
export type TransitionId = "none" | "fade" | "slide";
export type Aspect = "9:16" | "1:1" | "16:9";
export interface Adjust {
  brightness: number;
  contrast: number;
  saturation: number;
}
export interface EClip {
  id: string;
  prompt: string;
  image: string | null;
  duration: number;
  source: number;
  trimStart: number;
  muted: boolean;
  volume: number;
  filter: FilterId;
  effect: EffectId;
  adjust: Adjust;
  transitionIn: TransitionId;
}
export interface EText {
  id: string;
  text: string;
  kind: "title" | "caption" | "label";
  size: number;
  color: "white" | "yellow" | "teal";
  x: number;
  y: number;
  clipId?: string | undefined;
}
export interface EOverlay {
  id: string;
  kind: "sticker" | "image";
  content: string;
  x: number;
  y: number;
  size: number;
}
export interface Project {
  episodeId: string;
  seriesTitle: string;
  title: string;
  characterDescription: string;
  summary: string;
  clips: EClip[];
  texts: EText[];
  overlays: EOverlay[];
  music: { id: string; name: string } | null;
  musicVolume: number;
  duck: boolean;
  coverTime: number;
  aspect: Aspect;
}

export const MIN_CLIP = 1;
export const CAPTION_Y = 72; // middle-lower third
export const SAFE = { minX: 12, maxX: 88, minY: 10, maxY: 88 };
export const FILTERS: Record<FilterId, string> = {
  none: "",
  bright: "brightness(1.08)",
  warm: "sepia(0.18) saturate(1.1)",
  clean: "contrast(1.05) saturate(0.95)",
  cool: "hue-rotate(-8deg) saturate(0.95)",
};

/**
 * The CSS filter string for a clip: its named filter plus
 * brightness/contrast/saturation. Shared by the editor and the preview so
 * the two never drift apart (they used to build the same string twice).
 */
export function clipFilterCss(clip: Pick<EClip, "filter" | "adjust">): string {
  return `${FILTERS[clip.filter]} brightness(${1 + clip.adjust.brightness / 100}) contrast(${1 + clip.adjust.contrast / 100}) saturate(${1 + clip.adjust.saturation / 100})`;
}
export const SAMPLE_AUDIO = [
  { id: "a1", name: "Yaba Night Pulse (demo)" },
  { id: "a2", name: "Soft Mystery Keys (demo)" },
  { id: "a3", name: "Danfo Groove Loop (demo)" },
];

const r1 = (n: number) => Math.round(n * 10) / 10;
export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
/** Keeps an 84%-wide text box fully inside the frame, so captions wrap instead of being cut at the edge. */
export function captionLeft(x: number) {
  return clamp(x, 42, 58);
}
export function clampToSafe(x: number, y: number) {
  return { x: clamp(x, SAFE.minX, SAFE.maxX), y: clamp(y, SAFE.minY, SAFE.maxY) };
}
export function total(p: Pick<Project, "clips">) {
  return r1(p.clips.reduce((s, c) => s + c.duration, 0));
}
export function lengthWarning(p: Pick<Project, "clips">) {
  const t = total(p);
  return t < EPISODE_MIN_SEC
    ? `Too short: ${t}s (needs ${EPISODE_MIN_SEC}–${EPISODE_MAX_SEC}s)`
    : t > EPISODE_MAX_SEC
      ? `Too long: ${t}s (needs ${EPISODE_MIN_SEC}–${EPISODE_MAX_SEC}s)`
      : null;
}
export function clipAt(p: Pick<Project, "clips">, t: number) {
  let start = 0;
  for (let i = 0; i < p.clips.length; i++) {
    const c = p.clips[i];
    if (!c) continue;
    if (t < start + c.duration || i === p.clips.length - 1)
      return { index: i, start, local: t - start };
    start += c.duration;
  }
  return { index: -1, start: 0, local: 0 };
}
export function hasSound(p: Pick<Project, "clips" | "music" | "musicVolume">) {
  return p.clips.some((c) => !c.muted && c.volume > 0) || (p.music !== null && p.musicVolume > 0);
}

export function fromEpisode(ep: Episode, seriesTitle: string): Project {
  const clips: EClip[] = ep.clips.map((c, i) => ({
    id: c.id,
    prompt: c.prompt,
    image: ep.firstFrame,
    duration: c.durationSec,
    source: c.durationSec,
    trimStart: 0,
    muted: false,
    volume: 80,
    filter: "none",
    effect: "none",
    adjust: { brightness: 0, contrast: 0, saturation: 0 },
    transitionIn: i === 0 ? "none" : "fade",
  }));
  return {
    episodeId: ep.id,
    seriesTitle,
    title: ep.title,
    summary: ep.summary,
    characterDescription: ep.characterDescription,
    clips,
    texts: [
      {
        id: uid("text"),
        text: ep.title || "Untitled",
        kind: "title",
        size: 22,
        color: "white",
        x: 50,
        y: 16,
      },
      ...clips.map((c) => ({
        id: uid("text"),
        text: c.prompt,
        kind: "caption" as const,
        size: 14,
        color: "white" as const,
        x: 50,
        y: CAPTION_Y,
        clipId: c.id,
      })),
    ],
    overlays: [],
    music: SAMPLE_AUDIO[1] ?? null,
    musicVolume: 40,
    duck: true,
    coverTime: 0,
    aspect: "9:16",
  };
}

/** Trim start (moves in) or end of a clip; never longer than the source and never below 1s. */
export function trimClip(p: Project, id: string, edge: "start" | "end", delta: number): Project {
  return {
    ...p,
    clips: p.clips.map((c) => {
      if (c.id !== id) return c;
      if (edge === "end")
        return { ...c, duration: r1(clamp(c.duration + delta, MIN_CLIP, c.source - c.trimStart)) };
      const trimStart = r1(clamp(c.trimStart + delta, 0, c.trimStart + c.duration - MIN_CLIP));
      return { ...c, trimStart, duration: r1(c.duration - (trimStart - c.trimStart)) };
    }),
  };
}
export function splitAt(p: Project, t: number): Project {
  const { index, local } = clipAt(p, t);
  const c = p.clips[index];
  if (!c || local < MIN_CLIP || c.duration - local < MIN_CLIP) return p;
  const a: EClip = { ...c, duration: r1(local), source: r1(c.trimStart + local) };
  const b: EClip = {
    ...c,
    id: uid("clip"),
    trimStart: r1(c.trimStart + local),
    duration: r1(c.duration - local),
    transitionIn: "none",
  };
  const clips = p.clips.slice();
  clips.splice(index, 1, a, b);
  const texts = [
    ...p.texts,
    ...p.texts
      .filter((text) => text.clipId === c.id)
      .map((text) => ({ ...text, id: uid("text"), clipId: b.id })),
  ];
  return { ...p, clips, texts };
}
export function duplicateClip(p: Project, id: string): Project {
  const i = p.clips.findIndex((c) => c.id === id);
  const original = p.clips[i];
  if (!original) return p;
  const copy = { ...original, id: uid("clip") };
  const clips = p.clips.slice();
  clips.splice(i + 1, 0, copy);
  const texts = [
    ...p.texts,
    ...p.texts
      .filter((text) => text.clipId === id)
      .map((text) => ({ ...text, id: uid("text"), clipId: copy.id })),
  ];
  return { ...p, clips, texts };
}
export function deleteClip(p: Project, id: string): Project {
  return p.clips.length <= 1
    ? p
    : {
        ...p,
        clips: p.clips.filter((c) => c.id !== id),
        texts: p.texts.filter((text) => text.clipId !== id),
      };
}
export function updateClip(p: Project, id: string, patch: Partial<EClip>): Project {
  return { ...p, clips: p.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) };
}

/** Converts the edit back into an episode + output metadata. The pipeline still runs all 9 checks. */
export function toEpisode(
  p: Project,
  base: Episode,
): { episode: Episode; output: Partial<Output> } {
  const cover = p.clips[clipAt(p, p.coverTime).index]?.image ?? base.firstFrame;
  const episode: Episode = {
    ...base,
    title: p.title,
    summary: p.summary,
    characterDescription: p.characterDescription,
    firstFrame: cover,
    clips: p.clips.map((c) => ({ id: c.id, prompt: c.prompt, durationSec: c.duration })),
    updatedAt: Date.now(),
  };
  return {
    episode,
    output: {
      duration: total(p),
      aspect: p.aspect,
      sound: hasSound(p),
      nonEmpty: p.clips.every((c) => Boolean(c.image && c.prompt.trim())),
      edit: structuredClone(p),
      captions: p.texts.some((t) => t.kind === "caption" && t.text.trim()),
      title: p.title,
      cover,
      characterPrompts: episode.clips.map((c) => buildClipPrompt(p.characterDescription, c)),
    },
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isEnum = <T extends string>(v: unknown, values: readonly T[]): v is T =>
  typeof v === "string" && (values as readonly string[]).includes(v);
/** Read one field off an untyped record (dot access is banned on index signatures here). */
const field = (o: Record<string, unknown>, key: string): unknown => o[key];
const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.length > 0;

function isValidClip(c: unknown): c is EClip {
  if (!isRecord(c)) return false;
  const duration = field(c, "duration");
  const image = field(c, "image");
  const adjust = field(c, "adjust");
  return (
    isNonEmptyString(field(c, "id")) &&
    typeof field(c, "prompt") === "string" &&
    (typeof image === "string" || image === null) &&
    isFiniteNumber(duration) &&
    duration > 0 &&
    isFiniteNumber(field(c, "source")) &&
    isFiniteNumber(field(c, "trimStart")) &&
    typeof field(c, "muted") === "boolean" &&
    isFiniteNumber(field(c, "volume")) &&
    isEnum(field(c, "filter"), ["none", "bright", "warm", "clean", "cool"]) &&
    isEnum(field(c, "effect"), ["none", "glow", "vignette", "grain"]) &&
    isEnum(field(c, "transitionIn"), ["none", "fade", "slide"]) &&
    isRecord(adjust) &&
    isFiniteNumber(field(adjust, "brightness")) &&
    isFiniteNumber(field(adjust, "contrast")) &&
    isFiniteNumber(field(adjust, "saturation"))
  );
}

function isValidText(t: unknown): t is EText {
  if (!isRecord(t)) return false;
  const clipId = field(t, "clipId");
  return (
    isNonEmptyString(field(t, "id")) &&
    typeof field(t, "text") === "string" &&
    isEnum(field(t, "kind"), ["title", "caption", "label"]) &&
    isFiniteNumber(field(t, "size")) &&
    isEnum(field(t, "color"), ["white", "yellow", "teal"]) &&
    isFiniteNumber(field(t, "x")) &&
    isFiniteNumber(field(t, "y")) &&
    (clipId === undefined || typeof clipId === "string")
  );
}

function isValidOverlay(o: unknown): o is EOverlay {
  if (!isRecord(o)) return false;
  return (
    isNonEmptyString(field(o, "id")) &&
    isEnum(field(o, "kind"), ["sticker", "image"]) &&
    typeof field(o, "content") === "string" &&
    isFiniteNumber(field(o, "x")) &&
    isFiniteNumber(field(o, "y")) &&
    isFiniteNumber(field(o, "size"))
  );
}

/**
 * Validates a saved editor draft before it is restored. A malformed draft
 * (bad shape, wrong types, missing clips) is rejected instead of crashing
 * the editor or silently producing a broken project.
 */
export function isValidEditorDraft(d: unknown): d is Project {
  if (!isRecord(d)) return false;
  const clips = field(d, "clips");
  const texts = field(d, "texts");
  const overlays = field(d, "overlays");
  const music = field(d, "music");
  const coverTime = field(d, "coverTime");
  if (!isNonEmptyString(field(d, "episodeId"))) return false;
  if (
    typeof field(d, "seriesTitle") !== "string" ||
    typeof field(d, "title") !== "string" ||
    typeof field(d, "characterDescription") !== "string" ||
    typeof field(d, "summary") !== "string"
  )
    return false;
  if (!Array.isArray(clips) || clips.length < MIN_CLIP || !clips.every(isValidClip)) return false;
  if (!Array.isArray(texts) || !texts.every(isValidText)) return false;
  if (!Array.isArray(overlays) || !overlays.every(isValidOverlay)) return false;
  if (!(
    music === null ||
    (isRecord(music) &&
      typeof field(music, "id") === "string" &&
      typeof field(music, "name") === "string")
  ))
    return false;
  if (!isFiniteNumber(field(d, "musicVolume")) || typeof field(d, "duck") !== "boolean")
    return false;
  if (!isFiniteNumber(coverTime) || coverTime < 0) return false;
  if (!isEnum(field(d, "aspect"), ["9:16", "1:1", "16:9"])) return false;
  return true;
}
