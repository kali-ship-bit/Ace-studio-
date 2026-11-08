import { useEffect, useRef } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";

/** Plays the bundled sample narration while `playing` and not muted. */
export function useNarration(src: string, playing: boolean, muted: boolean) {
  const ref = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    const a = new Audio(src);
    a.loop = true;
    a.preload = "auto";
    ref.current = a;
    return () => {
      a.pause();
      ref.current = null;
    };
  }, [src]);
  useEffect(() => {
    const a = ref.current;
    if (!a) return;
    a.muted = muted;
    if (playing && !muted) a.play().catch(() => undefined);
    else a.pause();
  }, [playing, muted, src]);
}

export function MuteButton({
  muted,
  onToggle,
  className,
}: {
  muted: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-label={muted ? "Unmute narration" : "Mute narration"}
      className={cn(
        "glass flex h-11 items-center gap-1.5 rounded-full px-3 text-xs font-bold text-on-video",
        className,
      )}
    >
      {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5 text-teal" />}
      {muted ? "Muted" : "Sound on"}
    </button>
  );
}
