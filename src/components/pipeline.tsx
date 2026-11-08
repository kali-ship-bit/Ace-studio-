import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Bell,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  FastForward,
  Film,
  Mail,
  Pause,
  Play,
  RotateCcw,
  Scissors,
  Send,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { usePipeline } from "@/lib/pipeline-store";
import { useStories } from "@/lib/story-store";
import {
  allPassed,
  autoPostTime,
  deadline,
  GRACE_MS,
  STATUS_LABELS,
  WAIT_MS,
  type DailyVideo,
} from "@/lib/pipeline-rules";
import { checkEpisode, type Episode } from "@/lib/story-rules";
import { EditedPreview } from "@/components/EditedPreview";
import { CardActions } from "@/components/CardActions";
import { MuteButton, useNarration } from "@/components/SoundButton";
import { narrationFor } from "@/lib/demo-audio";

export function time(at?: number) {
  return at === undefined
    ? "—"
    : new Date(at).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
}
export function dateTime(at: number) {
  return new Date(at).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
export function countdown(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 3600)
    .toString()
    .padStart(2, "0")}:${Math.floor((s / 60) % 60)
    .toString()
    .padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
}
export const isWaiting = (v: DailyVideo) => v.status === "waiting" || v.status === "reminded";
export function StatusBadge({ video }: { video: DailyVideo }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ${video.status === "rejected" ? "bg-destructive/15 text-destructive" : video.status === "needs-edit" ? "bg-orange/15 text-orange" : video.status === "auto" || video.status === "approved" ? "bg-teal/15 text-teal" : "bg-primary/15 text-primary"}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {video.status === "needs-edit" ? "Held · not posted" : STATUS_LABELS[video.status]}
    </span>
  );
}
export function SendToPipeline({
  episode,
  seriesTitle,
  beforeSend,
}: {
  episode: Episode;
  seriesTitle: string;
  beforeSend?: () => void;
}) {
  const pipeline = usePipeline();
  const navigate = useNavigate();
  return (
    <Button
      disabled={!pipeline.ready || !checkEpisode(episode).complete}
      className="mt-3 h-14 w-full whitespace-normal rounded-2xl bg-gradient-primary text-base font-bold shadow-glow"
      onClick={() => {
        beforeSend?.();
        const video = pipeline.send(episode, seriesTitle);
        navigate({ to: "/review", search: { video } });
      }}
    >
      <Send />
      Send to auto-edit
    </Button>
  );
}
export function PipelineHeader({ title, subtitle }: { title: string; subtitle: string }) {
  const pipeline = usePipeline();
  const unread = pipeline.videos.flatMap((v) => v.notices).filter((n) => !n.read).length;
  return (
    <header className="mb-6">
      <div className="flex items-center justify-between gap-3">
        <h1
          className={`font-display text-3xl font-bold ${title === "Review" ? "text-gradient-review" : "text-gradient-dashboard"}`}
        >
          {title}
        </h1>
        {title !== "Review" && (
          <div className="flex gap-2">
            <Button asChild variant="secondary" className="h-11 rounded-full">
              <Link to="/review" search={{}}>
                <Film />
                Review
              </Link>
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="relative h-11 w-11 rounded-full"
              aria-label="Notifications"
              onClick={() =>
                document.getElementById("notifications")?.scrollIntoView({ behavior: "smooth" })
              }
            >
              <Bell />
              {unread > 0 && (
                <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-destructive" />
              )}
            </Button>
          </div>
        )}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
    </header>
  );
}
export function ReminderBanner({ compact = false }: { compact?: boolean }) {
  const pipeline = usePipeline();
  const video = pipeline.videos.find((v) => v.status === "reminded");
  if (!video) return null;
  return (
    <div
      className={`border border-primary/40 bg-background/95 ${compact ? "mx-3 mt-2 rounded-2xl p-3" : "mb-5 rounded-2xl p-4"}`}
    >
      <Link to="/review" search={{ video: video.id }} className="flex items-start gap-3">
        <Bell className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="min-w-0">
          <p className="text-sm font-bold text-primary">Approval reminder</p>
          <p className="mt-1 text-sm">{video.title} passed all 9 checks.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Auto-post shortly if no response · {time(autoPostTime(video))}
          </p>
        </div>
        <ChevronRight className="mt-1 h-5 w-5 shrink-0" />
      </Link>
    </div>
  );
}
export function CheckList({ video }: { video: DailyVideo }) {
  const count = video.checks.filter((c) => c.pass).length;
  return (
    <section className="mt-6">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-bold">
          <ShieldCheck className="h-5 w-5 text-teal" />
          Auto-check
        </h3>
        <span className={`text-sm font-bold ${count === 9 ? "text-teal" : "text-destructive"}`}>
          {video.checks.length ? `${count}/9 passed` : "Pending"}
        </span>
      </div>
      {video.checks.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Checks start after auto-edit finishes.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {video.checks.map((c) => (
            <li key={c.id} className="flex items-center gap-3 py-2.5 text-sm">
              {c.pass ? (
                <Check className="h-5 w-5 shrink-0 text-teal" />
              ) : (
                <X className="h-5 w-5 shrink-0 text-destructive" />
              )}
              <span className={c.pass ? "text-foreground" : "font-semibold text-destructive"}>
                {c.label}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        Sample output checks · no real file or audio is generated.
      </p>
    </section>
  );
}
export function DailyTimeline({ video }: { video: DailyVideo }) {
  return (
    <section className="mt-6">
      <h3 className="font-bold">Full timeline</h3>
      <ol className="mt-4 border-l border-border pl-5">
        {video.events.map((e) => (
          <li key={e.id} className="relative pb-5 last:pb-0">
            <span className="absolute -left-[25px] top-1.5 h-2 w-2 rounded-full bg-teal" />
            <p className="text-xs text-muted-foreground">{dateTime(e.at)}</p>
            <p className="mt-1 text-sm">{e.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
export function DailyPreview({ video }: { video: DailyVideo }) {
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [muted, setMuted] = useState(false);
  useNarration(narrationFor(video.episode.id), playing && video.output.sound, muted);
  useEffect(() => {
    setPlaying(false);
    setElapsed(0);
  }, [video.id]);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(
      () => setElapsed((t) => (t + 0.1) % (video.output.duration || 1)),
      100,
    );
    return () => clearInterval(timer);
  }, [playing, video.output.duration]);
  let accumulated = 0;
  let index = 0;
  video.episode.clips.forEach((c, i) => {
    if (elapsed >= accumulated) index = i;
    accumulated += c.durationSec;
  });
  const clip = video.episode.clips[index];
  const edited = video.output.edit;
  const aspectClass =
    edited?.aspect === "1:1"
      ? "aspect-square"
      : edited?.aspect === "16:9"
        ? "aspect-video"
        : "aspect-[9/16]";
  return (
    <div>
      <div
        className={`relative mx-auto w-full max-w-[280px] overflow-hidden rounded-2xl bg-card ${aspectClass}`}
      >
        {edited ? (
          <>
            <EditedPreview project={edited} elapsed={elapsed} />
            <Button
              variant="ghost"
              size="icon"
              aria-label={playing ? "Pause edited preview" : "Play edited preview"}
              onClick={() => setPlaying((p) => !p)}
              className="glass absolute left-1/2 top-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-full text-on-video"
            >
              {playing ? <Pause /> : <Play />}
            </Button>
          </>
        ) : (
          <>
            {video.output.cover && (
              <img
                key={index}
                src={video.output.cover}
                alt={`Cover for ${video.title}`}
                className={`h-full w-full object-cover transition-opacity duration-500 ${playing ? "motion-safe:animate-kenburns" : ""}`}
              />
            )}
            <div className="absolute inset-0 bg-video-bottom" />
            <div className="absolute inset-0 bg-video-top" />
            <div className="absolute inset-x-3 top-3">
              <div className="flex items-center justify-between gap-2">
                <span className="glass rounded-full px-2 py-1 text-xs text-on-video">
                  AI-generated
                </span>
                <span className="glass rounded-full px-2 py-1 text-xs text-on-video">
                  9:16 · {video.output.duration}s
                </span>
              </div>
              <p className="mt-4 text-center font-display text-lg font-bold text-on-video text-shadow-video">
                {video.episode.title || video.title}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label={playing ? "Pause edited preview" : "Play edited preview"}
              onClick={() => setPlaying((p) => !p)}
              className="glass absolute left-1/2 top-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-full text-on-video"
            >
              {playing ? <Pause /> : <Play />}
            </Button>
            <div className="absolute inset-x-4 bottom-5 text-on-video">
              <p className="mb-2 text-xs font-bold text-primary">
                Clip {index + 1} / 5 · Demo preview
              </p>
              {video.output.captions && (
                <p key={index} className="glass rounded-lg p-2 text-center text-sm leading-relaxed">
                  {clip?.prompt}
                </p>
              )}
              <div className="mt-3 grid grid-cols-5 gap-1">
                {video.episode.clips.map((c, i) => (
                  <span
                    key={c.id}
                    className={`h-1 rounded-full ${i <= index ? "bg-primary" : "bg-on-video/30"}`}
                  />
                ))}
              </div>
              <p className="mt-2 text-center text-xs">
                {Math.floor(elapsed)} / {video.output.duration}s
              </p>
            </div>
          </>
        )}
        <MuteButton
          muted={muted || !video.output.sound}
          onToggle={() => setMuted((m) => !m)}
          className="absolute right-2 top-12 z-10"
        />
      </div>
      <p className="mt-3 flex items-center justify-center gap-2 text-sm font-semibold text-teal">
        <Sparkles className="h-4 w-4" />
        {edited
          ? "Manually edited · demo"
          : video.status === "created"
            ? "Auto-editing…"
            : "Auto-edited"}
      </p>
    </div>
  );
}
export function WaitingActions({ video }: { video: DailyVideo }) {
  const pipeline = usePipeline();
  const stories = useStories();
  const navigate = useNavigate();
  function back(action: "reject" | "edit") {
    pipeline.respond(video.id, action);
    if (action === "reject") toast("Video rejected");
    stories.saveEpisode(video.episode);
    navigate({ to: "/create", search: { episode: video.episode.id } });
  }
  if (!isWaiting(video) && video.status !== "needs-edit") return null;
  return (
    <div className="mt-5 space-y-3">
      {isWaiting(video) && (
        <>
          <Button
            disabled={!allPassed(video)}
            className="h-14 w-full rounded-2xl bg-gradient-primary text-base font-bold shadow-glow"
            onClick={() => {
              pipeline.respond(video.id, "approve");
              toast.success("Video approved");
            }}
          >
            <CheckCircle2 />
            Approve now
          </Button>
          <Button
            variant="outline"
            className="h-12 w-full rounded-2xl text-destructive"
            onClick={() => back("reject")}
          >
            <X />
            Reject
          </Button>
        </>
      )}
      <Button
        className="h-14 w-full rounded-2xl bg-teal text-base font-bold text-teal-foreground hover:bg-teal/90"
        onClick={() => {
          navigate({ to: "/editor", search: { video: video.id } });
        }}
      >
        <Scissors />
        Open in Editor
      </Button>
      <Button
        variant="secondary"
        className="h-12 w-full rounded-2xl text-teal"
        onClick={() => back("edit")}
      >
        <Film />
        Edit in Create
      </Button>
    </div>
  );
}
export function DailyDetail({ video }: { video: DailyVideo }) {
  const pipeline = usePipeline();
  const end = deadline(video);
  return (
    <div>
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-primary">
            {video.seriesTitle} · Episode {video.episode.number}
          </p>
          <h2 className="mt-1 font-display text-2xl font-bold">
            {video.episode.title || "Untitled episode"}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {dateTime(video.createdAt)} · Platform: demo
          </p>
        </div>
      </div>
      <DailyPreview video={video} />
      <div className="mt-5 flex justify-center">
        <StatusBadge video={video} />
      </div>
      {isWaiting(video) && end !== undefined && (
        <div className="mt-5 border-y border-border py-5 text-center">
          <p className="text-sm text-muted-foreground">
            {video.status === "waiting" ? "Approval window remaining" : "Grace period remaining"}
          </p>
          <p className="mt-1 font-display text-4xl font-bold tabular-nums text-primary">
            {countdown(end - pipeline.now)}
          </p>
          <p className="mt-2 text-sm">
            {video.status === "waiting" ? "Reminder" : "Auto-post"} at {dateTime(end)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Auto-post at {dateTime(autoPostTime(video) ?? end)} · only if all checks pass
          </p>
        </div>
      )}
      {(video.status === "created" || video.status === "editing") && (
        <div className="mt-5 rounded-2xl bg-primary/10 p-4">
          <p className="font-semibold text-primary">
            {video.status === "created"
              ? "Auto-editing 5 clips in order…"
              : "Checking all 9 requirements…"}
          </p>
          <p className="mt-2 text-sm">
            Trimming ends · smooth transitions · captions · title · cover · normalised audio · AI
            label
          </p>
        </div>
      )}
      {video.status === "needs-edit" && (
        <p className="mt-5 rounded-2xl bg-destructive/10 p-4 text-sm font-semibold text-destructive">
          Posting blocked. Fix the failed checks in the Editor or Create and resend.
        </p>
      )}
      {(video.status === "auto" || video.status === "approved") && (
        <p className="mt-4 text-center text-sm text-teal">
          Posted at {time(video.postedAt)} · demo only
        </p>
      )}
      <WaitingActions video={video} />
      <details className="mt-5 border-y border-border py-3">
        <summary className="cursor-pointer text-sm font-semibold">
          5 input clips · {video.output.duration}s
        </summary>
        <ol className="mt-3 space-y-3">
          {video.episode.clips.map((c, i) => (
            <li key={c.id} className="text-sm">
              <span className="font-bold text-primary">
                {i + 1}. {c.durationSec}s
              </span>
              <p className="mt-1 text-muted-foreground">{c.prompt}</p>
            </li>
          ))}
        </ol>
      </details>
      <CheckList video={video} />
      <section className="mt-6">
        <h3 className="flex items-center gap-2 font-bold">
          <Mail className="h-5 w-5 text-teal" />
          Email reminder
        </h3>
        <div className="mt-3 rounded-2xl border border-border bg-card p-4">
          <p className="text-xs font-bold uppercase text-muted-foreground">
            {video.reminderAt === undefined
              ? "Designed · not sent"
              : "Demo reminder · no email sent"}
          </p>
          <p className="mt-3 text-sm font-bold">Subject: Approval needed — {video.title}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Your video passed all 9 checks. It will auto-post shortly if there is still no response.
          </p>
          <p className="mt-2 text-sm text-primary">
            Auto-post: {time(autoPostTime(video))} · 30-minute grace
          </p>
          {video.reminderAt !== undefined && (
            <p className="mt-2 text-xs text-muted-foreground">
              Reminder logged at {dateTime(video.reminderAt)}
            </p>
          )}
        </div>
      </section>
      <DailyTimeline video={video} />
    </div>
  );
}
export function RecordRow({ video }: { video: DailyVideo }) {
  const pipeline = usePipeline();
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <Link to="/review" search={{ video: video.id }} className="flex items-start gap-3 text-left">
        <img
          src={video.output.cover ?? undefined}
          alt=""
          className="h-20 w-12 shrink-0 rounded-lg object-cover"
        />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">
            {dateTime(video.createdAt)} · {video.output.duration}s · Demo
          </p>
          <p className="mt-1 text-sm font-bold">{video.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {video.episode.title} ·{" "}
            {video.checks.length
              ? `${video.checks.filter((c) => c.pass).length}/9 checks`
              : "Checks pending"}
          </p>
          <div className="mt-2">
            <StatusBadge video={video} />
          </div>
        </div>
        <ChevronRight className="mt-6 h-5 w-5 shrink-0" />
      </Link>
      <CardActions
        title={video.title}
        cover={video.output.cover}
        edit={{ video: video.id }}
        onDelete={() => pipeline.remove(video.id)}
        details={[
          `Series: ${video.seriesTitle}`,
          `Episode ${video.episode.number}: ${video.episode.title}`,
          `Created: ${dateTime(video.createdAt)}`,
          `Length: ${video.output.duration}s · ${video.output.aspect}`,
          `Status: ${STATUS_LABELS[video.status]}`,
          "",
          "Checks:",
          ...video.checks.map((c) => `${c.pass ? "✓" : "✗"} ${c.label}`),
          "",
          "Clips:",
          ...video.episode.clips.map((c, i) => `${i + 1}. (${c.durationSec}s) ${c.prompt}`),
        ]}
      />
    </div>
  );
}
export function Notifications() {
  const pipeline = usePipeline();
  const notices = pipeline.videos
    .flatMap((v) => v.notices.map((n) => ({ ...n, video: v.id })))
    .sort((a, b) => b.at - a.at);
  return (
    <section id="notifications" className="mt-8 scroll-mt-5">
      <h2 className="flex items-center gap-2 text-lg font-bold">
        <Bell className="h-5 w-5 text-primary" />
        Notifications
        <span className="text-sm text-muted-foreground">
          {notices.filter((n) => !n.read).length} unread
        </span>
      </h2>
      {notices.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No pipeline notifications yet.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {notices.map((n) => (
            <li key={n.id} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-center justify-between">
                <span
                  className={`text-xs font-bold ${n.read ? "text-muted-foreground" : "text-destructive"}`}
                >
                  {n.read ? "Read" : "● Unread"}
                </span>
                <span className="text-xs text-muted-foreground">{time(n.at)}</span>
              </div>
              <Link to="/review" search={{ video: n.video }} className="mt-2 block text-sm">
                {n.text}
              </Link>
              {!n.read && (
                <Button
                  variant="secondary"
                  className="mt-3 h-11 rounded-xl"
                  onClick={() => pipeline.markRead(n.id)}
                >
                  <Check />
                  Mark as read
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
export function DemoClock() {
  const pipeline = usePipeline();
  const [confirmReset, setConfirmReset] = useState(false);
  return (
    <details className="mt-8 border-t border-border pt-4">
      <summary className="cursor-pointer text-sm font-semibold text-muted-foreground">
        Demo time controls
      </summary>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="secondary"
          className="h-12 rounded-xl"
          onClick={() => pipeline.skip(WAIT_MS)}
        >
          <FastForward />
          +2 hours
        </Button>
        <Button
          variant="secondary"
          className="h-12 rounded-xl"
          onClick={() => pipeline.skip(GRACE_MS)}
        >
          <FastForward />
          +30 minutes
        </Button>
        <Button variant="outline" className="h-12 rounded-xl" onClick={() => setConfirmReset(true)}>
          <RotateCcw />
          Reset demo
        </Button>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Demo clock: {dateTime(pipeline.now)} · 30-minute grace period is provisional.
      </p>
      {confirmReset && (
        <div className="mt-3">
          <p className="text-sm">Reset all daily records and notifications?</p>
          <div className="mt-2 flex gap-2">
            <Button
              variant="destructive"
              onClick={() => {
                pipeline.reset();
                setConfirmReset(false);
              }}
            >
              Reset
            </Button>
            <Button variant="secondary" onClick={() => setConfirmReset(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </details>
  );
}
export function HomeDailyEntry() {
  const pipeline = usePipeline();
  const latest = pipeline.videos[0];
  return (
    <>
      <div className="mt-1 flex items-center justify-between gap-2 px-3">
        {latest && (
          <Button asChild variant="secondary" className="h-10 min-w-0 rounded-full text-xs">
            <Link to="/review" search={{ video: latest.id }}>
              <Clock />
              <span className="truncate">Daily video · {STATUS_LABELS[latest.status]}</span>
              <ChevronRight />
            </Link>
          </Button>
        )}
      </div>
      <ReminderBanner compact />
    </>
  );
}
