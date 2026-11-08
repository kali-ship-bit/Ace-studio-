import ep1 from "@/assets/audio/ep1_narration.mp3";
import ep2 from "@/assets/audio/ep2_narration.mp3";
import feed from "@/assets/audio/feed_narration.mp3";

/** Pre-recorded sample narration + music bundled with the app. No voice API is ever called. */
export const NARRATION: Record<string, string> = { ep1, ep2, v1: ep1, v8: ep2 };
export function narrationFor(id: string | undefined) {
  return (id && NARRATION[id]) || feed;
}
