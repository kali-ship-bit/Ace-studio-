import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  Pause,
  Play,
  Plus,
  Save,
  Trash2,
  Upload,
} from "lucide-react";
import { useStories } from "@/lib/story-store";
import { SAMPLE_IMAGES } from "@/lib/story-data";
import { SendToPipeline } from "@/components/pipeline";
import {
  CLIPS_PER_EPISODE,
  CLIP_MAX_SEC,
  CLIP_MIN_SEC,
  EPISODE_MAX_SEC,
  EPISODE_MIN_SEC,
  checkEpisode,
  clampClipDuration,
  moveItem,
  uid,
  type Episode,
} from "@/lib/story-rules";

interface CreateSearch {
  episode?: string | undefined;
  series?: string | undefined;
}

export const Route = createFileRoute("/create")({
  validateSearch: (s: Record<string, unknown>): CreateSearch => ({
    episode: typeof s["episode"] === "string" ? s["episode"] : undefined,
    series: typeof s["series"] === "string" ? s["series"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Create — Ace Studio" },
      {
        name: "description",
        content:
          "Build an episode step by step: first frame, five 9:16 clips and a 30–40 second preview.",
      },
      { property: "og:title", content: "Create — Ace Studio" },
      {
        property: "og:description",
        content:
          "Build an episode step by step: first frame, five 9:16 clips and a 30–40 second preview.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CreatePage,
});

const STEPS = ["Episode", "First frame", "Clips", "Preview"];

function CreatePage() {
  const store = useStories();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Episode | null>(null);
  const handled = useRef<string | null>(null);

  useEffect(() => {
    const key = `${search.episode ?? ""}|${search.series ?? ""}`;
    if (handled.current === key) return;
    if (search.episode) {
      const ep = store.getEpisode(search.episode);
      if (ep) {
        handled.current = key;
        setDraft(structuredClone(ep));
        setStep(1);
      }
    } else if (search.series && store.getSeries(search.series)) {
      handled.current = key;
      const ep = store.createEpisode(search.series);
      setDraft(ep);
      setStep(1);
      navigate({ to: "/create", search: { episode: ep.id }, replace: true });
      handled.current = `${ep.id}|`;
    }
  }, [search, store, navigate]);

  const update = (patch: Partial<Episode>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const save = () => {
    if (!draft) return;
    if (store.saveEpisode(draft)) {
      toast.success("Saved as draft", {
        description: `Episode ${draft.number} · stored on this device`,
      });
    } else {
      toast.error("Draft could not be saved", {
        description: "Browser storage may be full. Free some space and try again.",
      });
    }
  };

  return (
    <main className="mx-auto max-w-[480px] px-4 pb-32 pt-5">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-bold text-gradient-create">Create</h1>
        {draft && (
          <button
            onClick={save}
            className="flex h-11 items-center gap-2 rounded-full bg-secondary px-4 text-sm font-semibold"
          >
            <Save className="h-4 w-4 text-primary" /> Save draft
          </button>
        )}
      </div>

      <ol className="mt-4 grid grid-cols-4 gap-2">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button
              disabled={!draft && i > 0}
              onClick={() => setStep(i)}
              className="w-full text-left disabled:opacity-40"
            >
              <div
                className={`h-1.5 rounded-full ${i <= step ? "bg-gradient-primary" : "bg-muted"}`}
              />
              <span
                className={`mt-1.5 block text-xs font-semibold ${i === step ? "text-primary" : "text-muted-foreground"}`}
              >
                {i + 1}. {s}
              </span>
            </button>
          </li>
        ))}
      </ol>

      <div className="mt-6">
        {step === 0 && (
          <PickStep
            onPick={(ep) => {
              setDraft(structuredClone(ep));
              setStep(1);
              navigate({ to: "/create", search: { episode: ep.id }, replace: true });
            }}
            currentId={draft?.id}
          />
        )}
        {step === 1 && draft && <FrameStep draft={draft} update={update} />}
        {step === 2 && draft && <ClipsStep draft={draft} update={update} />}
        {step === 3 && draft && <PreviewStep draft={draft} onSave={save} />}
      </div>
      {draft && step > 0 && (
        <Link
          to="/editor"
          search={{ episode: draft.id }}
          onClick={() => save()}
          className="mt-4 flex h-12 items-center justify-center rounded-2xl bg-secondary font-semibold text-teal"
        >
          Edit in Editor (trim, text, audio)
        </Link>
      )}

      {draft && (
        <div className="mt-8 flex gap-3">
          <button
            disabled={step === 0}
            onClick={() => setStep((s) => s - 1)}
            className="flex h-14 flex-1 items-center justify-center gap-1 rounded-2xl bg-secondary font-semibold disabled:opacity-40"
          >
            <ChevronLeft className="h-5 w-5" /> Back
          </button>
          {step < 3 && (
            <button
              onClick={() => setStep((s) => s + 1)}
              className="flex h-14 flex-[2] items-center justify-center gap-1 rounded-2xl bg-gradient-primary font-bold text-primary-foreground shadow-glow"
            >
              Next: {STEPS[step + 1]} <ChevronRight className="h-5 w-5" />
            </button>
          )}
        </div>
      )}
      <div className="mt-8 rounded-2xl border border-border bg-card p-4">
        <h2 className="font-bold">Create a voice for your video</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Type your story lines, pick a voice, and Ace Studio creates the narration audio to add to
          your video.
        </p>
        <div className="mt-3 flex gap-2">
          <Link
            to="/narrate"
            className="flex h-12 flex-1 items-center justify-center rounded-2xl bg-gradient-primary text-sm font-bold text-primary-foreground shadow-glow"
          >
            Create a voice
          </Link>
          <Link
            to="/settings"
            className="flex h-12 flex-1 items-center justify-center rounded-2xl bg-secondary text-sm font-semibold"
          >
            API keys
          </Link>
        </div>
      </div>
    </main>
  );
}

function PickStep({
  onPick,
  currentId,
}: {
  onPick: (ep: Episode) => void;
  currentId?: string | undefined;
}) {
  const store = useStories();
  return (
    <div className="space-y-6">
      {store.series.map((s) => (
        <section key={s.id}>
          <div className="flex items-center gap-3">
            <img src={s.cover} alt="" className="h-14 w-14 rounded-2xl object-cover" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-primary">{s.genre}</p>
              <h2 className="truncate font-bold">{s.title}</h2>
            </div>
          </div>
          <ul className="mt-3 space-y-2">
            {store.episodesFor(s.id).map((ep) => {
              const c = checkEpisode(ep);
              return (
                <li key={ep.id}>
                  <button
                    onClick={() => onPick(ep)}
                    className={`flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl border bg-card px-4 py-3 text-left ${ep.id === currentId ? "border-primary" : "border-border"}`}
                  >
                    <span className="min-w-0">
                      <span className="block text-xs text-muted-foreground">
                        Episode {ep.number} · {ep.status === "sample" ? "Sample" : "Draft"}
                      </span>
                      <span className="block truncate font-semibold">
                        {ep.title || "Untitled episode"}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 text-xs font-semibold ${c.complete ? "text-teal" : "text-primary"}`}
                    >
                      {c.total}s
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <button
            onClick={() => onPick(store.createEpisode(s.id))}
            className="mt-3 flex h-14 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-primary/60 font-bold text-primary"
          >
            <Plus className="h-5 w-5" /> New episode
          </button>
        </section>
      ))}
    </div>
  );
}

function FrameStep({ draft, update }: { draft: Episode; update: (p: Partial<Episode>) => void }) {
  const store = useStories();
  const series = store.getSeries(draft.seriesId);
  const fileRef = useRef<HTMLInputElement>(null);
  const onFile = (f?: File) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      toast.error("Please choose an image file");
      return;
    }
    if (f.size > 4 * 1024 * 1024) {
      toast.error("Image must be under 4 MB");
      return;
    }
    const r = new FileReader();
    r.onload = () => update({ firstFrame: String(r.result) });
    r.readAsDataURL(f);
  };
  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-semibold text-primary">
          {series?.title} · Episode {draft.number}
        </p>
        <input
          value={draft.title}
          onChange={(e) => update({ title: e.target.value })}
          placeholder="Episode title"
          className="mt-2 h-14 w-full rounded-2xl border border-input bg-card px-4 text-lg font-bold outline-none focus:ring-2 focus:ring-ring"
        />
        <textarea
          value={draft.summary}
          onChange={(e) => update({ summary: e.target.value })}
          placeholder="One-line summary"
          rows={2}
          className="mt-3 w-full resize-none rounded-2xl border border-input bg-card p-4 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      <div>
        <h2 className="text-sm font-bold">
          Character description{" "}
          <span className="font-normal text-muted-foreground">(auto-filled from series)</span>
        </h2>
        <textarea
          value={draft.characterDescription}
          onChange={(e) => update({ characterDescription: e.target.value })}
          rows={3}
          className="mt-2 w-full resize-none rounded-2xl border border-input bg-card p-4 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        {series && draft.characterDescription !== series.characterDescription && (
          <button
            onClick={() => update({ characterDescription: series.characterDescription })}
            className="mt-1 text-xs font-semibold text-teal"
          >
            Reset to series character
          </button>
        )}
      </div>
      <div>
        <h2 className="text-sm font-bold">First-frame image</h2>
        <div className="mt-2 flex gap-4">
          <div className="aspect-[9/16] w-32 shrink-0 overflow-hidden rounded-2xl border border-border bg-card">
            {draft.firstFrame ? (
              <img
                src={draft.firstFrame}
                alt="First frame"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <ImagePlus className="h-8 w-8 text-muted-foreground" />
              </div>
            )}
          </div>
          <div className="flex flex-1 flex-col gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-teal font-bold text-teal-foreground"
            >
              <Upload className="h-5 w-5" /> Upload image
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                // Clear the input so picking the same image twice still
                // fires onChange — otherwise a re-pick is silently ignored.
                onFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <p className="text-xs text-muted-foreground">
              Vertical 9:16 works best. Stays on this device.
            </p>
          </div>
        </div>
        <p className="mt-4 text-xs font-semibold text-muted-foreground">Or use a sample</p>
        <div className="no-scrollbar mt-2 flex gap-2 overflow-x-auto">
          {SAMPLE_IMAGES.map((img) => (
            <button
              key={img.id}
              onClick={() => update({ firstFrame: img.src })}
              className={`aspect-[9/16] w-16 shrink-0 overflow-hidden rounded-xl border-2 ${draft.firstFrame === img.src ? "border-primary" : "border-transparent"}`}
            >
              <img src={img.src} alt={img.label} className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ClipsStep({ draft, update }: { draft: Episode; update: (p: Partial<Episode>) => void }) {
  const check = checkEpisode(draft);
  const setClip = (i: number, patch: Partial<Episode["clips"][number]>) =>
    update({ clips: draft.clips.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const inRange = check.total >= EPISODE_MIN_SEC && check.total <= EPISODE_MAX_SEC;
  return (
    <div>
      <div className="sticky top-0 z-10 -mx-4 bg-background/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between text-sm font-semibold">
          <span>
            {draft.clips.length}/{CLIPS_PER_EPISODE} clips · 9:16
          </span>
          <span className={inRange ? "text-teal" : "text-primary"}>
            {check.total}s / {EPISODE_MIN_SEC}–{EPISODE_MAX_SEC}s
          </span>
        </div>
        <div className="mt-2 flex h-2 gap-1">
          {draft.clips.map((c) => (
            <div
              key={c.id}
              style={{ flexGrow: c.durationSec }}
              className="rounded-full bg-gradient-primary"
            />
          ))}
        </div>
      </div>
      <ol className="mt-3 space-y-3">
        {draft.clips.map((c, i) => (
          <li key={c.id} className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 font-bold">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-primary text-sm text-primary-foreground">
                  {i + 1}
                </span>{" "}
                Clip {i + 1}
              </span>
              <div className="flex gap-1">
                <IconBtn
                  label="Move up"
                  disabled={i === 0}
                  onClick={() => update({ clips: moveItem(draft.clips, i, i - 1) })}
                >
                  <ArrowUp className="h-4 w-4" />
                </IconBtn>
                <IconBtn
                  label="Move down"
                  disabled={i === draft.clips.length - 1}
                  onClick={() => update({ clips: moveItem(draft.clips, i, i + 1) })}
                >
                  <ArrowDown className="h-4 w-4" />
                </IconBtn>
                <IconBtn
                  label="Delete clip"
                  disabled={draft.clips.length <= 1}
                  onClick={() => {
                    if (draft.clips.length > 1)
                      update({ clips: draft.clips.filter((_, j) => j !== i) });
                  }}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </IconBtn>
              </div>
            </div>
            <textarea
              value={c.prompt}
              onChange={(e) => setClip(i, { prompt: e.target.value })}
              rows={3}
              placeholder="What happens in this clip?"
              className="mt-3 w-full resize-none rounded-xl border border-input bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="mt-3 flex items-center gap-3">
              <input
                type="range"
                min={CLIP_MIN_SEC}
                max={CLIP_MAX_SEC}
                step={1}
                value={c.durationSec}
                aria-label={`Clip ${i + 1} length`}
                onChange={(e) =>
                  setClip(i, { durationSec: clampClipDuration(Number(e.target.value)) })
                }
                className="flex-1 accent-primary"
              />
              <span className="w-10 text-right text-sm font-bold">{c.durationSec}s</span>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              + character description attached automatically
            </p>
          </li>
        ))}
      </ol>
      {draft.clips.length < CLIPS_PER_EPISODE && (
        <button
          onClick={() =>
            update({ clips: [...draft.clips, { id: uid("clip"), prompt: "", durationSec: 7 }] })
          }
          className="mt-3 flex h-14 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-primary/60 font-bold text-primary"
        >
          <Plus className="h-5 w-5" /> Add clip
        </button>
      )}
    </div>
  );
}

function IconBtn({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function PreviewStep({ draft, onSave }: { draft: Episode; onSave: () => void }) {
  const stories = useStories();
  const check = checkEpisode(draft);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const total = check.total || 1;

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(
      () =>
        setT((x) => {
          if (x + 0.1 >= total) {
            setPlaying(false);
            return 0;
          }
          return x + 0.1;
        }),
      100,
    );
    return () => clearInterval(id);
  }, [playing, total]);

  let acc = 0;
  let idx = 0;
  draft.clips.forEach((c, i) => {
    if (t >= acc) idx = i;
    acc += c.durationSec;
  });
  const clip = draft.clips[idx];

  return (
    <div>
      <div className="relative mx-auto aspect-[9/16] w-full max-w-[300px] overflow-hidden rounded-3xl border border-border bg-card shadow-glow">
        {draft.firstFrame && (
          <img
            key={idx}
            src={draft.firstFrame}
            alt=""
            className={`h-full w-full object-cover ${playing ? "animate-kenburns" : ""}`}
          />
        )}
        <div className="absolute inset-0 bg-video-bottom" />
        <div className="absolute inset-x-3 top-3 flex gap-1">
          {(() => {
            let a = 0;
            return draft.clips.map((c) => {
              const p = Math.min(1, Math.max(0, (t - a) / c.durationSec));
              a += c.durationSec;
              return (
                <div
                  key={c.id}
                  style={{ flexGrow: c.durationSec }}
                  className="h-1 overflow-hidden rounded-full bg-on-video/30"
                >
                  <div className="h-full bg-primary" style={{ width: `${p * 100}%` }} />
                </div>
              );
            });
          })()}
        </div>
        <span className="glass absolute right-3 top-6 rounded-full px-2.5 py-1 text-[11px] font-semibold text-on-video">
          Demo preview
        </span>
        {clip && (
          <div className="absolute inset-x-4 bottom-4 text-on-video">
            <p className="text-xs font-semibold text-primary">
              Clip {idx + 1} · {clip.durationSec}s
            </p>
            <p className="mt-1 text-sm text-shadow-video">{clip.prompt || "No prompt yet"}</p>
          </div>
        )}
        <button
          aria-label={playing ? "Pause" : "Play"}
          onClick={() => setPlaying((p) => !p)}
          className="absolute inset-0 flex items-center justify-center"
        >
          {!playing && (
            <span className="glass flex h-16 w-16 items-center justify-center rounded-full">
              <Play className="h-8 w-8 text-on-video" />
            </span>
          )}
          {playing && <Pause className="sr-only" />}
        </button>
      </div>
      <p className="mt-3 text-center text-sm text-muted-foreground">
        {draft.title || "Untitled"} · {check.total}s assembled from {draft.clips.length} clips
      </p>

      <div className={`mt-5 rounded-2xl p-4 ${check.complete ? "bg-teal/10" : "bg-primary/10"}`}>
        {check.complete ? (
          <p className="flex items-center gap-2 font-semibold text-teal">
            <Check className="h-5 w-5" /> Episode is complete and ready.
          </p>
        ) : (
          <ul className="space-y-1 text-sm text-primary">
            {check.issues.map((x) => (
              <li key={x}>• {x}</li>
            ))}
          </ul>
        )}
      </div>
      <button
        onClick={onSave}
        className="mt-5 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-primary font-bold text-primary-foreground shadow-glow"
      >
        <Save className="h-5 w-5" /> Save as draft
      </button>
      <Link
        to="/stories"
        className="mt-3 flex h-12 w-full items-center justify-center rounded-2xl bg-secondary text-sm font-semibold"
      >
        Go to Stories
      </Link>
      <SendToPipeline
        episode={draft}
        seriesTitle={stories.getSeries(draft.seriesId)?.title ?? "Story"}
        beforeSend={onSave}
      />
      <p className="mt-3 text-center text-xs text-muted-foreground">
        Sample only — no real video is generated or posted.
      </p>
    </div>
  );
}
