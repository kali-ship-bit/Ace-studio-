import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPE } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Copy,
  ImageIcon,
  Music,
  Pause,
  Play,
  Plus,
  Redo2,
  Save,
  Scissors,
  Send,
  Sparkles,
  Trash2,
  Type,
  Undo2,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useStories } from "@/lib/story-store";
import { usePipeline } from "@/lib/pipeline-store";
import { SAMPLE_IMAGES } from "@/lib/story-data";
import { inspectOutput } from "@/lib/pipeline-rules";
import { CardActions } from "@/components/CardActions";
import { RecordRow } from "@/components/pipeline";
import { MuteButton, useNarration } from "@/components/SoundButton";
import { narrationFor } from "@/lib/demo-audio";
import { checkEpisode, moveItem, uid, type Episode } from "@/lib/story-rules";
import {
  CAPTION_Y,
  captionLeft,
  clipFilterCss,
  SAMPLE_AUDIO,
  clampToSafe,
  clipAt,
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
  updateClip,
  type Aspect,
  type EClip,
  type EffectId,
  type FilterId,
  type Project,
  type TransitionId,
} from "@/lib/editor-rules";

export const Route = createFileRoute("/editor")({
  validateSearch: (
    s: Record<string, unknown>,
  ): { episode?: string | undefined; video?: string | undefined } => ({
    episode: typeof s["episode"] === "string" ? s["episode"] : undefined,
    video: typeof s["video"] === "string" ? s["video"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Editor — Ace Studio" },
      {
        name: "description",
        content:
          "Manual editor to fix a failed check: trim, split, text, audio, overlays, filters, cover and transitions.",
      },
      { property: "og:title", content: "Editor — Ace Studio" },
      {
        property: "og:description",
        content:
          "Manual editor to fix a failed check: trim, split, text, audio, overlays, filters, cover and transitions.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: EditorPage,
});

const DKEY = "ace-studio.editor.v1";
const fmt = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function EditorPage() {
  const { episode: epId, video: videoId } = Route.useSearch();
  const stories = useStories();
  const pipeline = usePipeline();
  const video = videoId ? pipeline.videos.find((v) => v.id === videoId) : undefined;
  const base: Episode | undefined = video?.episode ?? (epId ? stories.getEpisode(epId) : undefined);
  if (!base) return <Picker />;
  const seriesTitle = video?.seriesTitle ?? stories.getSeries(base.seriesId)?.title ?? "Series";
  return (
    <Editor
      key={base.id + (videoId ?? "")}
      base={base}
      seriesTitle={seriesTitle}
      previousEdit={video?.output.edit}
      failedSound={video?.output.sound === false}
      failed={video?.checks.filter((c) => !c.pass).map((c) => c.label) ?? []}
    />
  );
}

function Picker() {
  const stories = useStories();
  const pipeline = usePipeline();
  return (
    <main className="mx-auto max-w-[480px] px-4 pb-32 pt-5">
      <h1 className="font-display text-3xl font-bold text-gradient-editor">Editor</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Optional fallback: fix a video or make a small change. The daily flow stays automatic.
      </p>
      <section className="mt-6">
        <h2 className="font-bold text-pink">Episodes</h2>
        <ul className="mt-3 space-y-3">
          {stories.episodes.map((e) => (
            <li key={e.id} className="rounded-2xl border border-pink/30 bg-card p-3">
              <Link to="/editor" search={{ episode: e.id }} className="flex gap-3">
                <img
                  src={e.firstFrame ?? undefined}
                  alt="Cover"
                  className="h-20 w-12 rounded-lg bg-muted object-cover"
                />
                <div>
                  <p className="text-xs text-primary">Episode {e.number} · cover</p>
                  <p className="font-bold">{e.title || "Untitled"}</p>
                  <p className="text-xs text-muted-foreground">
                    {e.clips.length} clips · {e.clips.reduce((s, c) => s + c.durationSec, 0)}s
                  </p>
                </div>
              </Link>
              <CardActions
                title={e.title || "Untitled episode"}
                cover={e.firstFrame}
                edit={{ episode: e.id }}
                onDelete={() => stories.deleteEpisode(e.id)}
                details={[
                  `Episode ${e.number}: ${e.title}`,
                  `Summary: ${e.summary}`,
                  `Character: ${e.characterDescription}`,
                  "",
                  ...e.clips.map((c, i) => `${i + 1}. (${c.durationSec}s) ${c.prompt}`),
                ]}
              />
            </li>
          ))}
        </ul>
      </section>
      {pipeline.videos.length > 0 && (
        <section className="mt-6">
          <h2 className="font-bold text-violet">Daily videos</h2>
          <ul className="mt-3 space-y-3">
            {pipeline.videos.map((v) => (
              <li key={v.id}>
                <RecordRow video={v} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

type Tool =
  | "edit"
  | "audio"
  | "text"
  | "effects"
  | "overlay"
  | "captions"
  | "filters"
  | "adjust"
  | "stickers"
  | "cover"
  | "transitions"
  | "ratio";
const TOOLS: [Tool, string][] = [
  ["edit", "Edit"],
  ["audio", "Audio"],
  ["text", "Text"],
  ["effects", "Effects"],
  ["overlay", "Overlay"],
  ["captions", "Captions"],
  ["filters", "Filters"],
  ["adjust", "Adjust"],
  ["stickers", "Stickers"],
  ["cover", "Cover"],
  ["transitions", "Transitions"],
  ["ratio", "Ratio"],
];

function useHistory(initial: Project) {
  const [h, setH] = useState({ past: [] as Project[], present: initial, future: [] as Project[] });
  return {
    p: h.present,
    canUndo: h.past.length > 0,
    canRedo: h.future.length > 0,
    set: (fn: (p: Project) => Project, merge = false) =>
      setH((s) => {
        const n = fn(s.present);
        if (n === s.present) return s;
        // Merged (continuous) edits — drags, sliders, typing — update the project
        // without pushing a history entry each step, so one undo reverts the whole
        // gesture back to the state pushed by mark() at its start (or the last
        // discrete edit). Discrete edits still push to history.
        return merge
          ? { ...s, present: n, future: [] }
          : { past: [...s.past, s.present].slice(-60), present: n, future: [] };
      }),
    mark: () =>
      setH((s) => ({ past: [...s.past, s.present].slice(-60), present: s.present, future: [] })),
    undo: () =>
      setH((s) => {
        const previous = s.past.at(-1);
        return previous
          ? { past: s.past.slice(0, -1), present: previous, future: [s.present, ...s.future] }
          : s;
      }),
    redo: () =>
      setH((s) => {
        const next = s.future[0];
        return next
          ? { past: [...s.past, s.present], present: next, future: s.future.slice(1) }
          : s;
      }),
    reset: (p: Project) => setH({ past: [], present: p, future: [] }),
  };
}

function initialProject(base: Episode, seriesTitle: string): Project {
  // Clips keep the episode's own first-frame image (fromEpisode); never swap
  // in sample images — a swapped image could leak into the episode cover.
  return fromEpisode(base, seriesTitle);
}

function Editor({
  base,
  seriesTitle,
  failed,
  previousEdit,
  failedSound,
}: {
  base: Episode;
  seriesTitle: string;
  failed: string[];
  previousEdit?: Project | undefined;
  failedSound: boolean;
}) {
  const stories = useStories();
  const pipeline = usePipeline();
  const navigate = useNavigate();
  const fresh = useMemo(() => {
    if (previousEdit) return structuredClone(previousEdit);
    const initial = initialProject(base, seriesTitle);
    return failedSound
      ? { ...initial, music: null, clips: initial.clips.map((c) => ({ ...c, muted: true })) }
      : initial;
  }, [base, seriesTitle, previousEdit, failedSound]);
  const h = useHistory(fresh);
  const p = h.p;
  // The approval window is cancelled only once the user actually edits — not
  // when the editor merely opens. baseline tracks the unedited project (fresh
  // load, or a restored draft), so opening or restoring never counts as an edit.
  const baselineRef = useRef(JSON.stringify(fresh));
  const notifiedRef = useRef(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DKEY);
      const d = raw ? JSON.parse(raw)[base.id] : null;
      if (isValidEditorDraft(d)) {
        h.reset(d);
        baselineRef.current = JSON.stringify(d);
      }
    } catch {
      /* ignore bad draft data */
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (notifiedRef.current || JSON.stringify(p) === baselineRef.current) return;
    const record = pipeline.videos.find(
      (v) => v.episode.id === base.id && (v.status === "waiting" || v.status === "reminded"),
    );
    if (record) {
      pipeline.respond(record.id, "edit");
      notifiedRef.current = true;
    }
  }, [p, base.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [sel, setSel] = useState<string | null>(p.clips[0]?.id ?? null);
  const [tool, setTool] = useState<Tool>("edit");
  const [selText, setSelText] = useState<string | null>(null);
  const len = total(p);
  const cur = clipAt(p, Math.min(t, Math.max(0, len - 0.01)));
  const clip = p.clips[cur.index];
  const selClip = p.clips.find((c) => c.id === sel) ?? clip;
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let raf = 0;
    const step = (n: number) => {
      const delta = (n - last) / 1000;
      last = n;
      setT((x) => {
        const y = x + delta;
        if (y >= len) {
          setPlaying(false);
          return len;
        }
        return y;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, len]);
  useEffect(() => {
    if (t > len) setT(len);
  }, [len, t]);

  const { episode, output } = toEpisode(p, base);
  const sound = hasSound(p);
  const [muted, setMuted] = useState(false);
  useNarration(narrationFor(base.id), playing && sound, muted);
  const checks = inspectOutput(episode, {
    duration: len,
    aspect: p.aspect,
    playable: true,
    sound,
    watermarkFree: true,
    nonEmpty: true,
    captions: false,
    title: p.title,
    cover: episode.firstFrame,
    characterPrompts: [],
    ...output,
  });
  const ready = checkEpisode(episode).complete;
  const warn = lengthWarning(p);

  function saveDraft() {
    try {
      const all = JSON.parse(localStorage.getItem(DKEY) ?? "{}");
      all[base.id] = p;
      localStorage.setItem(DKEY, JSON.stringify(all));
      toast.success("Draft saved — pipeline unchanged");
    } catch {
      toast.error("Draft could not be saved. Free some browser storage and try again.");
    }
  }
  function discard() {
    h.reset(fresh);
    // Discarding returns to the unedited project — reset the baseline
    // too, or the "first edit cancels the approval window" effect would
    // fire on a discard even though the user changed nothing.
    baselineRef.current = JSON.stringify(fresh);
    try {
      const all = JSON.parse(localStorage.getItem(DKEY) ?? "{}");
      delete all[base.id];
      localStorage.setItem(DKEY, JSON.stringify(all));
    } catch {
      /* ignore */
    }
    toast("Changes discarded");
  }
  function sendBack() {
    if (!ready || !pipeline.ready) return;
    stories.saveEpisode(episode);
    const id = pipeline.resubmit(episode, seriesTitle, output);
    navigate({ to: "/review", search: { video: id } });
  }

  const filterCss = (c: EClip) => clipFilterCss(c);
  const previewRef = useRef<HTMLDivElement>(null);
  function dragIn(e: RPE, onMove: (x: number, y: number) => void) {
    e.stopPropagation();
    h.mark();
    const box = previewRef.current?.getBoundingClientRect();
    if (!box) return;
    const move = (ev: PointerEvent) => {
      const s = clampToSafe(
        ((ev.clientX - box.left) / box.width) * 100,
        ((ev.clientY - box.top) / box.height) * 100,
      );
      onMove(s.x, s.y);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }
  const pps = 14 * zoom;
  const trackRef = useRef<HTMLDivElement>(null);
  function scrub(e: RPE) {
    const box = trackRef.current?.getBoundingClientRect();
    if (!box) return;
    const set = (x: number) =>
      setT(Math.max(0, Math.min(len, (x - box.left + (trackRef.current?.scrollLeft ?? 0)) / pps)));
    set(e.clientX);
    const move = (ev: PointerEvent) => set(ev.clientX);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }
  function trimDrag(e: RPE, id: string, edge: "start" | "end") {
    e.stopPropagation();
    h.mark();
    let lastX = e.clientX;
    const move = (ev: PointerEvent) => {
      const d = (ev.clientX - lastX) / pps;
      if (Math.abs(d) < 0.1) return;
      lastX = ev.clientX;
      h.set((q) => trimClip(q, id, edge, d), true);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }
  const dragFrom = useRef<number | null>(null);
  const aspectCls =
    p.aspect === "9:16"
      ? "aspect-[9/16] max-w-[260px]"
      : p.aspect === "1:1"
        ? "aspect-square max-w-[320px]"
        : "aspect-video max-w-[420px]";
  const colorCls = { white: "text-on-video", yellow: "text-primary", teal: "text-teal" } as const;
  const curText = p.texts.find((x) => x.id === selText);

  return (
    <main className="mx-auto max-w-[720px] px-3 pb-36 pt-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-primary">
            {seriesTitle} · Episode {base.number}
          </p>
          <h1 className="truncate font-display text-xl font-bold">{p.title || "Untitled"}</h1>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="icon"
            className="h-11 w-11 rounded-full"
            aria-label="Undo"
            disabled={!h.canUndo}
            onClick={h.undo}
          >
            <Undo2 />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            className="h-11 w-11 rounded-full"
            aria-label="Redo"
            disabled={!h.canRedo}
            onClick={h.redo}
          >
            <Redo2 />
          </Button>
        </div>
      </div>
      {failed.length > 0 && (
        <div className="mt-3 rounded-2xl border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <p className="flex items-center gap-2 font-bold text-destructive">
            <AlertTriangle className="h-4 w-4" />
            Failed auto-checks to fix
          </p>
          <ul className="mt-1 list-disc pl-5">
            {failed.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}
      {p.aspect !== "9:16" && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-2xl bg-primary/10 p-3 text-sm text-primary">
          <span>9:16 is the posting format for reels.</span>
          <Button
            size="sm"
            className="rounded-full"
            onClick={() => h.set((q) => ({ ...q, aspect: "9:16" }))}
          >
            Return to 9:16
          </Button>
        </div>
      )}

      <div
        ref={previewRef}
        className={`relative mx-auto mt-3 w-full overflow-hidden rounded-2xl bg-card ${aspectCls}`}
        onClick={() => setPlaying((x) => !x)}
      >
        {clip?.image && (
          <img
            key={clip.id}
            src={clip.image}
            alt={`Clip ${cur.index + 1}`}
            style={{ filter: filterCss(clip) }}
            className={`h-full w-full object-cover ${clip.transitionIn === "fade" ? "animate-in fade-in duration-500" : clip.transitionIn === "slide" ? "animate-in slide-in-from-right duration-500" : ""}`}
          />
        )}
        {clip?.effect === "vignette" && (
          <div className="editor-vignette pointer-events-none absolute inset-0" />
        )}
        {clip?.effect === "glow" && (
          <div className="pointer-events-none absolute inset-0 bg-primary/10 mix-blend-soft-light" />
        )}
        {clip?.effect === "grain" && (
          <div className="editor-grain pointer-events-none absolute inset-0" />
        )}
        <div className="pointer-events-none absolute inset-[8%_10%] rounded-lg border border-dashed border-on-video/20" />
        <span className="glass absolute left-2 top-2 rounded-full px-2 py-0.5 text-xs text-on-video">
          AI-generated
        </span>
        {p.texts
          .filter((x) => !x.clipId || x.clipId === clip?.id)
          .map((x) => (
            <p
              key={x.id}
              onPointerDown={(e) => {
                setSelText(x.id);
                setTool("text");
                dragIn(e, (nx, ny) =>
                  h.set(
                    (q) => ({
                      ...q,
                      texts: q.texts.map((y) => (y.id === x.id ? { ...y, x: nx, y: ny } : y)),
                    }),
                    true,
                  ),
                );
              }}
              onClick={(e) => e.stopPropagation()}
              style={{ left: `${captionLeft(x.x)}%`, top: `${x.y}%`, fontSize: x.size }}
              className={`absolute w-[84%] max-w-[84%] -translate-x-1/2 -translate-y-1/2 whitespace-normal [overflow-wrap:anywhere] cursor-move touch-none break-words text-center font-bold leading-tight text-shadow-video ${colorCls[x.color]} ${x.kind === "caption" ? "glass rounded-lg p-1.5" : "font-display"} ${selText === x.id ? "ring-2 ring-primary" : ""}`}
            >
              {x.text}
            </p>
          ))}
        {p.overlays.map((o) => (
          <div
            key={o.id}
            onPointerDown={(e) =>
              dragIn(e, (nx, ny) =>
                h.set(
                  (q) => ({
                    ...q,
                    overlays: q.overlays.map((y) => (y.id === o.id ? { ...y, x: nx, y: ny } : y)),
                  }),
                  true,
                ),
              )
            }
            onClick={(e) => e.stopPropagation()}
            style={{ left: `${o.x}%`, top: `${o.y}%`, width: `${o.size}%` }}
            className="absolute -translate-x-1/2 -translate-y-1/2 cursor-move touch-none select-none text-center"
          >
            {o.kind === "sticker" ? (
              <span style={{ fontSize: o.size * 1.6 }}>{o.content}</span>
            ) : (
              <img src={o.content} alt="Overlay" draggable={false} className="w-full rounded-lg" />
            )}
          </div>
        ))}
        <MuteButton
          muted={muted || !sound}
          onToggle={() => setMuted((m) => !m)}
          className="absolute right-2 top-2 z-10"
        />
        {!playing && (
          <span className="glass pointer-events-none absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-on-video">
            <Play />
          </span>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <Button
          size="icon"
          className="h-12 w-12 rounded-full"
          aria-label={playing ? "Pause" : "Play"}
          onClick={() => {
            if (t >= len) setT(0);
            setPlaying((x) => !x);
          }}
        >
          {playing ? <Pause /> : <Play />}
        </Button>
        <p className="font-mono text-sm tabular-nums">
          {fmt(t)} / {fmt(len)}
        </p>
        <span
          className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold ${sound ? "bg-teal/15 text-teal" : "bg-destructive/15 text-destructive"}`}
        >
          {sound ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          {sound ? "Sound present" : "Muted — fails check"}
        </span>
      </div>
      <p
        className={`mt-2 text-center text-sm font-semibold ${warn ? "text-destructive" : "text-teal"}`}
      >
        {warn ?? `Length ${len}s · within 30–40s`} · {p.clips.length} clips
        {p.clips.length !== 5 ? " (needs exactly 5)" : ""}
      </p>

      <div className="mt-3 flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Zoom out"
          onClick={() => setZoom((z) => Math.max(0.5, z / 1.5))}
        >
          <ZoomOut />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Zoom in"
          onClick={() => setZoom((z) => Math.min(4, z * 1.5))}
        >
          <ZoomIn />
        </Button>
      </div>
      <div ref={trackRef} className="no-scrollbar relative overflow-x-auto rounded-2xl bg-card p-2">
        <div className="relative" style={{ width: len * pps + 16 }}>
          <div className="h-5 touch-none" onPointerDown={scrub}>
            {Array.from({ length: Math.ceil(len / 5) + 1 }, (_, i) => (
              <span
                key={i}
                className="absolute text-[11px] text-muted-foreground"
                style={{ left: i * 5 * pps }}
              >
                {i * 5}s
              </span>
            ))}
          </div>
          <div className="flex h-16">
            {p.clips.map((c, i) => (
              <div
                key={c.id}
                draggable
                onDragStart={() => {
                  dragFrom.current = i;
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  const f = dragFrom.current;
                  if (f !== null) h.set((q) => ({ ...q, clips: moveItem(q.clips, f, i) }));
                  dragFrom.current = null;
                }}
                onClick={() => setSel(c.id)}
                style={{ width: c.duration * pps }}
                className={`relative shrink-0 overflow-hidden rounded-lg border-2 ${sel === c.id ? "border-primary" : "border-transparent"}`}
              >
                {c.image && (
                  <img
                    src={c.image}
                    alt=""
                    draggable={false}
                    className="h-full w-full object-cover opacity-70"
                  />
                )}
                <span className="absolute left-1 top-1 rounded bg-overlay/70 px-1 text-[11px] text-on-video">
                  {i + 1} · {c.duration}s
                </span>
                {c.transitionIn !== "none" && (
                  <span className="absolute bottom-1 left-1 rounded bg-teal px-1 text-[10px] text-teal-foreground">
                    {c.transitionIn}
                  </span>
                )}
                {sel === c.id && (
                  <>
                    <span
                      onPointerDown={(e) => trimDrag(e, c.id, "start")}
                      className="absolute inset-y-0 left-0 w-3 cursor-ew-resize touch-none bg-primary"
                      aria-label="Trim start"
                    />
                    <span
                      onPointerDown={(e) => trimDrag(e, c.id, "end")}
                      className="absolute inset-y-0 right-0 w-3 cursor-ew-resize touch-none bg-primary"
                      aria-label="Trim end"
                    />
                  </>
                )}
              </div>
            ))}
          </div>
          <div className="mt-1 flex h-8">
            {p.clips.map((c) => (
              <div
                key={c.id}
                style={{ width: c.duration * pps }}
                className={`shrink-0 border-r border-background ${c.muted ? "bg-muted" : "bg-teal/40"}`}
              />
            ))}
          </div>
          {p.music && (
            <div
              className="mt-1 flex h-6 items-center rounded bg-primary/30 px-2 text-[11px]"
              style={{ width: len * pps }}
            >
              <Music className="mr-1 h-3 w-3" />
              {p.music.name}
            </div>
          )}
          <div
            className="pointer-events-none absolute inset-y-0 w-0.5 bg-primary"
            style={{ left: t * pps }}
          />
        </div>
      </div>

      <div className="no-scrollbar mt-4 flex gap-2 overflow-x-auto pb-1">
        {TOOLS.map(([id, label]) => (
          <Button
            key={id}
            variant={tool === id ? "default" : "secondary"}
            className="h-11 shrink-0 rounded-full px-4"
            onClick={() => setTool(id)}
          >
            {label}
          </Button>
        ))}
        <Button
          variant="outline"
          className="h-11 shrink-0 rounded-full text-teal"
          onClick={() => {
            setTool("audio");
            h.set((q) => ({
              ...q,
              music: SAMPLE_AUDIO[0] ?? null,
              musicVolume: q.musicVolume || 40,
            }));
          }}
        >
          <Plus />
          Add audio
        </Button>
        <Button
          variant="outline"
          className="h-11 shrink-0 rounded-full text-teal"
          onClick={() => {
            const id = uid("text");
            setTool("text");
            setSelText(id);
            h.set((q) => ({
              ...q,
              texts: [
                ...q.texts,
                {
                  id,
                  text: "New text",
                  kind: "label",
                  size: 18,
                  color: "yellow",
                  x: 50,
                  y: CAPTION_Y,
                },
              ],
            }));
          }}
        >
          <Type />
          Add text
        </Button>
      </div>

      <section className="mt-3 rounded-2xl border border-border bg-card p-4">
        {tool === "edit" && selClip && (
          <div className="space-y-3">
            <p className="font-bold">
              Clip {p.clips.indexOf(selClip) + 1} · {selClip.duration}s
            </p>
            <div className="grid grid-cols-3 gap-2">
              <Button
                variant="secondary"
                className="h-12"
                onClick={() => h.set((q) => splitAt(q, t))}
              >
                <Scissors />
                Split
              </Button>
              <Button
                variant="secondary"
                className="h-12"
                onClick={() => h.set((q) => duplicateClip(q, selClip.id))}
              >
                <Copy />
                Duplicate
              </Button>
              <Button
                variant="secondary"
                className="h-12 text-destructive"
                onClick={() => h.set((q) => deleteClip(q, selClip.id))}
              >
                <Trash2 />
                Delete
              </Button>
              <Button
                variant="secondary"
                className="h-12"
                aria-label="Move clip left"
                onClick={() =>
                  h.set((q) => {
                    const i = q.clips.indexOf(selClip);
                    return { ...q, clips: moveItem(q.clips, i, i - 1) };
                  })
                }
              >
                <ArrowLeft />
                Move
              </Button>
              <Button
                variant="secondary"
                className="h-12"
                aria-label="Move clip right"
                onClick={() =>
                  h.set((q) => {
                    const i = q.clips.indexOf(selClip);
                    return { ...q, clips: moveItem(q.clips, i, i + 1) };
                  })
                }
              >
                Move
                <ArrowRight />
              </Button>
              <Button
                variant="secondary"
                className="h-12"
                onClick={() => h.set((q) => trimClip(q, selClip.id, "end", -0.5))}
              >
                Trim −0.5s
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Drag the lemon-green edges on the timeline to trim, drag clips to reorder. Split cuts
              at the playhead.
            </p>
            <textarea
              value={selClip.prompt}
              onChange={(e) =>
                h.set((q) => updateClip(q, selClip.id, { prompt: e.target.value }), true)
              }
              className="min-h-20 w-full rounded-xl bg-input p-3 text-sm"
              aria-label="Clip prompt"
            />
          </div>
        )}
        {tool === "audio" && (
          <div className="space-y-4">
            {p.clips.map((c, i) => (
              <div key={c.id} className="flex items-center gap-3">
                <Button
                  variant={c.muted ? "destructive" : "secondary"}
                  className="h-11 w-36 shrink-0"
                  onClick={() => h.set((q) => updateClip(q, c.id, { muted: !c.muted }))}
                >
                  {c.muted ? (
                    <>
                      <VolumeX />
                      Unmute clip {i + 1}
                    </>
                  ) : (
                    <>
                      <Volume2 />
                      Mute clip {i + 1}
                    </>
                  )}
                </Button>
                <Slider
                  value={[c.volume]}
                  max={100}
                  onValueChange={([v]) =>
                    h.set((q) => updateClip(q, c.id, { volume: v ?? 0 }), true)
                  }
                />
              </div>
            ))}
            <div>
              <p className="mb-2 text-sm font-semibold">
                Music bed {p.music ? `· ${p.music.name}` : "· none"} · {p.musicVolume}%
              </p>
              <Slider
                aria-label="Music volume"
                value={[p.musicVolume]}
                max={100}
                onValueChange={([v]) => h.set((q) => ({ ...q, musicVolume: v ?? 0 }), true)}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-5 w-5 accent-primary"
                checked={p.duck}
                onChange={(e) => h.set((q) => ({ ...q, duck: e.target.checked }))}
              />
              Duck music under narration
            </label>
            <div className="flex flex-wrap gap-2">
              {SAMPLE_AUDIO.map((a) => (
                <Button
                  key={a.id}
                  variant={p.music?.id === a.id ? "default" : "secondary"}
                  className="h-11 rounded-full"
                  onClick={() => h.set((q) => ({ ...q, music: a }))}
                >
                  <Music />
                  {a.name}
                </Button>
              ))}
              <Button
                variant="ghost"
                className="h-11"
                onClick={() => h.set((q) => ({ ...q, music: null }))}
              >
                Remove music
              </Button>
            </div>
          </div>
        )}
        {tool === "text" && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {p.texts
                .filter((x) => x.kind !== "caption")
                .map((x) => (
                  <Button
                    key={x.id}
                    variant={selText === x.id ? "default" : "secondary"}
                    className="h-10 rounded-full"
                    onClick={() => setSelText(x.id)}
                  >
                    {x.kind}: {x.text.slice(0, 14)}
                  </Button>
                ))}
            </div>
            {curText ? (
              <TextControls
                text={curText}
                onChange={(patch, merge) =>
                  h.set(
                    (q) => ({
                      ...q,
                      title:
                        curText.kind === "title" && patch.text !== undefined ? patch.text : q.title,
                      texts: q.texts.map((y) => (y.id === curText.id ? { ...y, ...patch } : y)),
                    }),
                    merge,
                  )
                }
                onDelete={() => {
                  h.set((q) => ({ ...q, texts: q.texts.filter((y) => y.id !== curText.id) }));
                  setSelText(null);
                }}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Tap text on the preview or use “Add text”.
              </p>
            )}
          </div>
        )}
        {tool === "captions" && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Captions sit in the middle-lower third by default, one per clip.
            </p>
            {p.clips.map((c, i) => {
              const cap = p.texts.find((x) => x.kind === "caption" && x.clipId === c.id);
              return cap ? (
                <div key={c.id} className="flex gap-2">
                  <input
                    value={cap.text}
                    onChange={(e) =>
                      h.set(
                        (q) => ({
                          ...q,
                          texts: q.texts.map((y) =>
                            y.id === cap.id ? { ...y, text: e.target.value } : y,
                          ),
                        }),
                        true,
                      )
                    }
                    className="h-11 flex-1 rounded-xl bg-input px-3 text-sm"
                    aria-label={`Caption clip ${i + 1}`}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Delete caption"
                    onClick={() =>
                      h.set((q) => ({ ...q, texts: q.texts.filter((y) => y.id !== cap.id) }))
                    }
                  >
                    <Trash2 />
                  </Button>
                </div>
              ) : (
                <Button
                  key={c.id}
                  variant="secondary"
                  className="h-11 w-full"
                  onClick={() =>
                    h.set((q) => ({
                      ...q,
                      texts: [
                        ...q.texts,
                        {
                          id: uid("text"),
                          text: c.prompt,
                          kind: "caption",
                          size: 14,
                          color: "white",
                          x: 50,
                          y: CAPTION_Y,
                          clipId: c.id,
                        },
                      ],
                    }))
                  }
                >
                  <Plus />
                  Caption for clip {i + 1}
                </Button>
              );
            })}
          </div>
        )}
        {(tool === "filters" || tool === "effects" || tool === "transitions") && selClip && (
          <div>
            <p className="mb-3 text-sm font-semibold">
              Clip {p.clips.indexOf(selClip) + 1}
              {tool === "transitions" ? " · transition in from previous clip" : ""}
            </p>
            <div className="flex flex-wrap gap-2">
              {(tool === "filters"
                ? (["none", "bright", "warm", "clean", "cool"] as FilterId[])
                : tool === "effects"
                  ? (["none", "glow", "vignette", "grain"] as EffectId[])
                  : (["none", "fade", "slide"] as TransitionId[])
              ).map((v) => {
                const key =
                  tool === "filters" ? "filter" : tool === "effects" ? "effect" : "transitionIn";
                const on = selClip[key] === v;
                return (
                  <Button
                    key={v}
                    variant={on ? "default" : "secondary"}
                    className="h-11 rounded-full capitalize"
                    onClick={() =>
                      h.set((q) => updateClip(q, selClip.id, { [key]: v } as Partial<EClip>))
                    }
                  >
                    {v === "none" ? (tool === "transitions" ? "Remove" : "None") : v}
                  </Button>
                );
              })}
            </div>
          </div>
        )}
        {tool === "adjust" && selClip && (
          <div className="space-y-4">
            {(["brightness", "contrast", "saturation"] as const).map((k) => (
              <div key={k}>
                <p className="mb-2 text-sm capitalize">
                  {k} · {selClip.adjust[k]}
                </p>
                <Slider
                  value={[selClip.adjust[k]]}
                  min={-30}
                  max={30}
                  onValueChange={([v]) =>
                    h.set(
                      (q) =>
                        updateClip(q, selClip.id, { adjust: { ...selClip.adjust, [k]: v ?? 0 } }),
                      true,
                    )
                  }
                />
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Kept subtle (±30) so faces and the story stay clear.
            </p>
          </div>
        )}
        {(tool === "overlay" || tool === "stickers") && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {tool === "stickers"
                ? ["📱", "⏰", "🚌", "❓", "🔥", "✨"].map((s) => (
                    <Button
                      key={s}
                      variant="secondary"
                      className="h-12 w-12 text-2xl"
                      onClick={() =>
                        h.set((q) => ({
                          ...q,
                          overlays: [
                            ...q.overlays,
                            { id: uid("ov"), kind: "sticker", content: s, x: 70, y: 30, size: 14 },
                          ],
                        }))
                      }
                    >
                      {s}
                    </Button>
                  ))
                : SAMPLE_IMAGES.map((img) => (
                    <Button
                      variant="secondary"
                      key={img.id}
                      onClick={() =>
                        h.set((q) => ({
                          ...q,
                          overlays: [
                            ...q.overlays,
                            {
                              id: uid("ov"),
                              kind: "image",
                              content: img.src,
                              x: 70,
                              y: 30,
                              size: 30,
                            },
                          ],
                        }))
                      }
                      className="h-16 w-12 overflow-hidden rounded-lg p-0"
                      aria-label={`Add ${img.label} overlay`}
                    >
                      <img src={img.src} alt="" className="h-full w-full object-cover" />
                    </Button>
                  ))}
            </div>
            {p.overlays.map((o) => (
              <div key={o.id} className="flex items-center gap-3">
                {o.kind === "sticker" ? (
                  <span className="text-2xl">{o.content}</span>
                ) : (
                  <ImageIcon className="h-5 w-5" />
                )}
                <Slider
                  value={[o.size]}
                  min={8}
                  max={60}
                  onValueChange={([v]) =>
                    h.set(
                      (q) => ({
                        ...q,
                        overlays: q.overlays.map((y) =>
                          y.id === o.id ? { ...y, size: v ?? 10 } : y,
                        ),
                      }),
                      true,
                    )
                  }
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Delete overlay"
                  onClick={() =>
                    h.set((q) => ({ ...q, overlays: q.overlays.filter((y) => y.id !== o.id) }))
                  }
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Drag on the preview to move; slider to resize.
            </p>
          </div>
        )}
        {tool === "cover" && (
          <div className="flex items-center gap-4">
            <img
              src={p.clips[clipAt(p, p.coverTime).index]?.image ?? undefined}
              alt="Current cover"
              className="h-28 w-16 rounded-lg object-cover"
            />
            <div>
              <p className="text-sm">Cover at {fmt(p.coverTime)}</p>
              <Button
                className="mt-2 h-12 rounded-full"
                onClick={() => h.set((q) => ({ ...q, coverTime: t }))}
              >
                <ImageIcon />
                Cover — use this frame
              </Button>
            </div>
          </div>
        )}
        {tool === "ratio" && (
          <div className="flex gap-2">
            {(["9:16", "1:1", "16:9"] as Aspect[]).map((a) => (
              <Button
                key={a}
                variant={p.aspect === a ? "default" : "secondary"}
                className="h-12 flex-1"
                onClick={() => h.set((q) => ({ ...q, aspect: a }))}
              >
                {a}
              </Button>
            ))}
          </div>
        )}
      </section>

      <section className="mt-4 rounded-2xl border border-border bg-card p-4">
        <p className="flex items-center gap-2 font-bold">
          <Sparkles className="h-4 w-4 text-teal" />
          Check preview · {checks.filter((c) => c.pass).length}/9
        </p>
        <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
          {checks.map((c) => (
            <li key={c.id} className={c.pass ? "text-teal" : "text-destructive"}>
              {c.pass ? "✓" : "✗"} {c.label}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">
          Review runs all 9 checks again after you send it back — a manual edit never skips them.
        </p>
      </section>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button variant="secondary" className="h-12 rounded-2xl" onClick={saveDraft}>
          <Save />
          Save draft
        </Button>
        <Button variant="outline" className="h-12 rounded-2xl" onClick={discard}>
          Discard changes
        </Button>
        <Button
          disabled={!ready || !pipeline.ready}
          className="col-span-2 h-14 rounded-2xl bg-gradient-primary text-base font-bold shadow-glow"
          onClick={sendBack}
        >
          <Send />
          Send back to Review
        </Button>
      </div>
      {!ready && (
        <p className="mt-2 text-center text-sm text-destructive">
          {checkEpisode(episode).issues[0]}
        </p>
      )}
    </main>
  );
}

function TextControls({
  text,
  onChange,
  onDelete,
}: {
  text: Project["texts"][number];
  onChange: (p: Partial<Project["texts"][number]>, merge?: boolean) => void;
  onDelete: () => void;
}) {
  return (
    <div className="space-y-3">
      <input
        value={text.text}
        onChange={(e) => onChange({ text: e.target.value }, true)}
        className="h-12 w-full rounded-xl bg-input px-3"
        aria-label="Text"
      />
      <div>
        <p className="mb-2 text-sm">Size · {text.size}px</p>
        <Slider
          value={[text.size]}
          min={12}
          max={32}
          onValueChange={([v]) => onChange({ size: v ?? 16 }, true)}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {(["white", "yellow", "teal"] as const).map((c) => (
          <Button
            key={c}
            variant={text.color === c ? "default" : "secondary"}
            className="h-10 rounded-full capitalize"
            onClick={() => onChange({ color: c })}
          >
            {c === "yellow" ? "Lime" : c}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["Top", 16],
            ["Middle", 50],
            ["Lower third", CAPTION_Y],
            ["Bottom", 86],
          ] as const
        ).map(([l, y]) => (
          <Button
            key={l}
            variant="secondary"
            className="h-10 rounded-full"
            onClick={() => onChange({ x: 50, y })}
          >
            {l}
          </Button>
        ))}
      </div>
      <Button variant="ghost" className="h-11 text-destructive" onClick={onDelete}>
        <Trash2 />
        Delete text
      </Button>
    </div>
  );
}
