import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { SAMPLE_EPISODES, SAMPLE_SERIES } from "./story-data";
import {
  advanceDaily,
  type Output,
  respondDaily,
  startDaily,
  CHECK_MS,
  type DailyVideo,
} from "./pipeline-rules";
import type { Episode } from "./story-rules";

const KEY = "ace-studio.pipeline.v3";
interface State {
  videos: DailyVideo[];
  offset: number;
}
interface Store extends State {
  now: number;
  ready: boolean;
  send: (ep: Episode, seriesTitle: string) => string;
  resubmit: (ep: Episode, seriesTitle: string, output: Partial<Output>) => string;
  respond: (id: string, action: "approve" | "reject" | "edit") => void;
  markRead: (noticeId: string) => void;
  skip: (ms: number) => void;
  reset: () => void;
  remove: (id: string) => void;
}
const Ctx = createContext<Store | null>(null);
function seed(now: number): State {
  const [ep, ep2] = SAMPLE_EPISODES;
  const series = SAMPLE_SERIES[0];
  if (!ep || !series) return { videos: [], offset: 0 };
  const waiting = advanceDaily(startDaily(ep, series.title, now - CHECK_MS), now);
  // Episode 2 now ships with sample narration and music, so "Sound present" passes.
  const second = ep2
    ? [
        respondDaily(
          advanceDaily(
            startDaily(ep2, series.title, now - CHECK_MS - 3_600_000),
            now - 3_600_000 + 1,
          ),
          "approve",
          now - 3_000_000,
        ),
      ]
    : [];
  return { videos: [waiting, ...second], offset: 0 };
}
export function PipelineProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ videos: [], offset: 0 });
  const [ready, setReady] = useState(false);
  const [clock, setClock] = useState(0);
  useEffect(() => {
    let saved = seed(Date.now());
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.videos) && Number.isFinite(parsed.offset)) saved = parsed;
      }
    } catch {
      /* invalid demo state */
    }
    setState({
      ...saved,
      videos: saved.videos.map((v) => advanceDaily(v, Date.now() + saved.offset)),
    });
    setClock(Date.now());
    setReady(true);
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const now = clock + state.offset;
  useEffect(() => {
    if (!ready) return;
    setState((s) => {
      const videos = s.videos.map((v) => advanceDaily(v, now));
      return videos.some((v, i) => v !== s.videos[i]) ? { ...s, videos } : s;
    });
  }, [now, ready]);
  useEffect(() => {
    if (ready) {
      try {
        localStorage.setItem(KEY, JSON.stringify(state));
      } catch {
        /* retain demo in memory */
      }
    }
  }, [state, ready]);
  const value = useMemo<Store>(
    () => ({
      ...state,
      ready,
      now,
      send: (ep, seriesTitle) => {
        const existing = state.videos.find(
          (v) =>
            v.episode.id === ep.id &&
            ["created", "editing", "waiting", "reminded"].includes(v.status),
        );
        if (existing) return existing.id;
        const v = startDaily(ep, seriesTitle, now);
        setState((s) => ({ ...s, videos: [v, ...s.videos] }));
        return v.id;
      },
      resubmit: (ep, seriesTitle, output) => {
        const v = startDaily(
          ep,
          seriesTitle,
          now,
          output,
          "Created — manual edit sent for all 9 checks",
        );
        setState((s) => ({ ...s, videos: [v, ...s.videos] }));
        return v.id;
      },
      respond: (id, action) =>
        setState((s) => ({
          ...s,
          videos: s.videos.map((v) => (v.id === id ? respondDaily(v, action, now) : v)),
        })),
      markRead: (id) =>
        setState((s) => ({
          ...s,
          videos: s.videos.map((v) => ({
            ...v,
            notices: v.notices.map((n) => (n.id === id ? { ...n, read: true } : n)),
          })),
        })),
      skip: (ms) => setState((s) => ({ ...s, offset: s.offset + ms })),
      remove: (id) => setState((s) => ({ ...s, videos: s.videos.filter((v) => v.id !== id) })),
      reset: () => {
        setState(seed(Date.now()));
        setClock(Date.now());
      },
    }),
    [state, ready, now],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function usePipeline() {
  const store = useContext(Ctx);
  if (!store) throw new Error("PipelineProvider required");
  return store;
}
