import { useEffect, useRef, useState } from "react";
import {
  Bookmark,
  Heart,
  MessageCircle,
  Music2,
  Pause,
  Play,
  Plus,
  Share2,
  Sparkles,
  Volume2,
  VolumeX,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCount, formatDuration, type FeedVideo } from "@/lib/feed-data";
import { narrationFor } from "@/lib/demo-audio";
import { useNarration } from "@/components/SoundButton";
import { Avatar } from "./Avatar";

interface Props {
  video: FeedVideo;
  active: boolean;
  muted: boolean;
  onToggleMute: () => void;
  onComment: (v: FeedVideo) => void;
  onShare: (v: FeedVideo) => void;
  followed: boolean;
  onFollow: (name: string) => void;
}

export function VideoCard({
  video,
  active,
  muted,
  onToggleMute,
  onComment,
  onShare,
  followed,
  onFollow,
}: Props) {
  const [playing, setPlaying] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);
  const [flash, setFlash] = useState<"play" | "pause" | null>(null);
  const last = useRef<number | null>(null);
  const flashTimerRef = useRef<number | null>(null);

  // Clear the flash-hide timer on unmount: without this, a card that
  // scrolls away mid-flash sets state on an unmounted component.
  useEffect(() => {
    return () => {
      if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
    };
  }, []);

  // Bundled sample narration for the active card; plays only while unmuted.
  useNarration(narrationFor(video.id), active && playing, muted);

  useEffect(() => {
    if (!active) {
      setElapsed(0);
      setPlaying(true);
      return;
    }
    if (!playing) return;
    let raf = 0;
    last.current = null;
    const tick = (t: number) => {
      if (last.current != null) {
        const dt = (t - last.current) / 1000;
        setElapsed((e) => (e + dt >= video.durationSec ? 0 : e + dt));
      }
      last.current = t;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, playing, video.durationSec]);

  const togglePlay = () => {
    setFlash(playing ? "pause" : "play");
    setPlaying((p) => !p);
    if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => setFlash(null), 600);
  };

  const pct = (elapsed / video.durationSec) * 100;
  const isPaused = !playing && active;

  return (
    <article
      className="relative h-full w-full snap-start snap-always overflow-hidden bg-overlay"
      aria-label={video.title}
    >
      <button
        type="button"
        onClick={togglePlay}
        className="absolute inset-0 h-full w-full"
        aria-label={playing ? "Pause video" : "Play video"}
      >
        <img
          src={video.cover}
          alt=""
          width={608}
          height={1088}
          loading="lazy"
          className={cn(
            "h-full w-full object-cover",
            active && playing && "animate-kenburns",
            isPaused && "brightness-75",
          )}
          style={{ animationPlayState: playing ? "running" : "paused" }}
        />
      </button>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-video-top" />
      <div className="pointer-events-none absolute inset-0 bg-video-bottom" />

      {(flash || isPaused) && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/90 text-primary-foreground shadow-glow animate-in zoom-in-50 fade-in">
            {isPaused ? (
              <Play className="ml-1 h-9 w-9 fill-current" />
            ) : (
              <Pause className="h-9 w-9 fill-current" />
            )}
          </div>
        </div>
      )}

      {/* Mute + duration */}
      <div className="absolute right-3 top-[132px] flex flex-col items-end gap-2">
        <button
          type="button"
          onClick={onToggleMute}
          className="glass flex h-11 w-11 items-center justify-center rounded-full text-on-video"
          aria-label={muted ? "Unmute" : "Mute"}
        >
          {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
        </button>
      </div>

      {/* Right action rail */}
      <div className="absolute bottom-[112px] right-2 flex flex-col items-center gap-4 text-on-video">
        <div className="relative mb-2">
          <Avatar creator={video.creator} size="lg" ring />
          {!video.creator.isOwner && (
            <button
              type="button"
              onClick={() => onFollow(video.creator.name)}
              aria-label={followed ? "Following" : `Follow ${video.creator.name}`}
              className={cn(
                "absolute -bottom-2.5 left-1/2 flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full",
                followed ? "bg-teal text-teal-foreground" : "bg-primary text-primary-foreground",
              )}
            >
              {followed ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-4 w-4" />}
            </button>
          )}
        </div>
        <RailButton
          label={formatCount(video.likes + (liked ? 1 : 0))}
          onClick={() => setLiked((l) => !l)}
          aria={liked ? "Unlike" : "Like"}
        >
          <Heart
            className={cn(
              "h-8 w-8 transition-colors",
              liked && "animate-pop fill-primary text-primary",
            )}
          />
        </RailButton>
        <RailButton
          label={formatCount(video.comments)}
          onClick={() => onComment(video)}
          aria="Comments"
        >
          <MessageCircle className="h-8 w-8" />
        </RailButton>
        <RailButton
          label={saved ? "Saved" : "Save"}
          onClick={() => setSaved((s) => !s)}
          aria={saved ? "Unsave" : "Save"}
        >
          <Bookmark className={cn("h-8 w-8", saved && "animate-pop fill-primary text-primary")} />
        </RailButton>
        <RailButton label={formatCount(video.shares)} onClick={() => onShare(video)} aria="Share">
          <Share2 className="h-8 w-8" />
        </RailButton>
        <div
          className={cn(
            "mt-1 flex h-11 w-11 items-center justify-center rounded-full border-4 border-card bg-secondary",
            active && playing && "animate-spin-slow",
          )}
        >
          <Music2 className="h-4 w-4 text-primary" />
        </div>
      </div>

      {/* Caption block */}
      <div className="absolute bottom-[92px] left-0 right-20 px-4 text-on-video text-shadow-video">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-primary px-2.5 py-0.5 text-xs font-bold text-primary-foreground">
            {video.category}
          </span>
          {video.aiGenerated && (
            <span className="glass inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold text-teal">
              <Sparkles className="h-3 w-3" /> AI-generated
            </span>
          )}
          <span className="glass rounded-full px-2.5 py-0.5 text-xs font-medium tabular-nums">
            {formatDuration(elapsed)} / {formatDuration(video.durationSec)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <p className="text-base font-bold">@{video.creator.name}</p>
          {!video.creator.isOwner && (
            <button
              type="button"
              onClick={() => onFollow(video.creator.name)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-bold transition-colors",
                followed
                  ? "border-border bg-secondary/70 text-muted-foreground"
                  : "border-primary text-primary",
              )}
            >
              {followed ? "Following" : "Follow"}
            </button>
          )}
        </div>
        {video.series && (
          <p className="mt-1 text-sm font-semibold text-primary">
            {video.series} · {video.episode}
          </p>
        )}
        <h2 className="font-display mt-1 text-xl font-bold leading-tight">{video.title}</h2>
        <p className="mt-1.5 line-clamp-2 text-sm text-on-video/85">{video.caption}</p>
        <p className="mt-1 text-sm font-semibold text-on-video">{video.hashtags.join(" ")}</p>
        <div className="mt-2 flex items-center gap-2 text-sm text-on-video/90">
          <Music2 className="h-4 w-4 shrink-0" />
          <span className="truncate">{video.sound}</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="absolute inset-x-0 bottom-[76px] h-1 bg-on-video/20">
        <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </article>
  );
}

function RailButton({
  children,
  label,
  onClick,
  aria,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  aria: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={aria}
      className="flex min-w-12 flex-col items-center gap-1 drop-shadow-lg"
    >
      {children}
      <span className="text-xs font-bold">{label}</span>
    </button>
  );
}
