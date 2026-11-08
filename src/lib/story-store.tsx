import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { SAMPLE_EPISODES, SAMPLE_SERIES } from "./story-data";
import { blankClips, uid, type Episode, type Series } from "./story-rules";

const KEY = "ace-studio.stories.v1";
const DELETED_KEY = "ace-studio.stories.deleted.v1";

interface State {
  series: Series[];
  episodes: Episode[];
}

interface Store extends State {
  episodesFor: (seriesId: string) => Episode[];
  getEpisode: (id: string) => Episode | undefined;
  getSeries: (id: string) => Series | undefined;
  createEpisode: (seriesId: string) => Episode;
  saveEpisode: (ep: Episode) => boolean;
  deleteEpisode: (id: string) => void;
  updateSeriesCharacter: (seriesId: string, text: string) => void;
}

const Ctx = createContext<Store | null>(null);
const initial: State = { series: SAMPLE_SERIES, episodes: SAMPLE_EPISODES };

/** Writes the persisted slice (drafts only) to localStorage. Returns false when the write fails. */
function persistStories(state: State): boolean {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        series: state.series,
        episodes: state.episodes.filter((e) => e.status === "draft"),
      }),
    );
    return true;
  } catch {
    return false;
  }
}

export function StoryProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(initial);
  const [loaded, setLoaded] = useState(false);
  const loadedRef = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<State>;
        setState({
          series: SAMPLE_SERIES.map((s) => ({
            ...s,
            ...(saved.series?.find((x) => x.id === s.id) ?? {}),
            cover: s.cover,
          })),
          episodes: (() => {
            const drafts = (saved.episodes ?? []).filter((e) => e.status === "draft");
            const gone: string[] = JSON.parse(localStorage.getItem(DELETED_KEY) ?? "[]");
            return [
              ...SAMPLE_EPISODES.filter(
                (s) => !gone.includes(s.id) && !drafts.some((d) => d.id === s.id),
              ),
              ...drafts,
            ];
          })(),
        });
      }
    } catch {
      /* ignore bad demo data */
    }
    setLoaded(true);
    loadedRef.current = true;
  }, []);

  useEffect(() => {
    if (!loaded) return;
    persistStories(state);
  }, [state, loaded]);

  const episodesFor = useCallback(
    (seriesId: string) =>
      state.episodes.filter((e) => e.seriesId === seriesId).sort((a, b) => a.number - b.number),
    [state.episodes],
  );

  const createEpisode = useCallback(
    (seriesId: string) => {
      const s = state.series.find((x) => x.id === seriesId);
      if (!s) throw new Error("Series not found");
      const nums = state.episodes.filter((e) => e.seriesId === seriesId).map((e) => e.number);
      const ep: Episode = {
        id: uid("ep"),
        seriesId,
        number: (nums.length ? Math.max(...nums) : 0) + 1,
        title: "",
        summary: "",
        characterDescription: s.characterDescription,
        firstFrame: null,
        clips: blankClips(),
        status: "draft",
        updatedAt: Date.now(),
      };
      setState((st) => ({ ...st, episodes: [...st.episodes, ep] }));
      return ep;
    },
    [state],
  );

  const value = useMemo<Store>(
    () => ({
      ...state,
      episodesFor,
      getEpisode: (id) => state.episodes.find((e) => e.id === id),
      getSeries: (id) => state.series.find((s) => s.id === id),
      createEpisode,
      saveEpisode: (ep) => {
        // Persist synchronously so the caller knows whether the save really landed.
        // Before the saved state has loaded, the effect above persists the update
        // once loading finishes, so report success and let it do its job.
        const next: State = {
          ...state,
          episodes: state.episodes.map((e) =>
            e.id === ep.id ? { ...ep, status: "draft", updatedAt: Date.now() } : e,
          ),
        };
        const ok = loadedRef.current ? persistStories(next) : true;
        setState(next);
        return ok;
      },
      deleteEpisode: (id) => {
        try {
          const gone: string[] = JSON.parse(localStorage.getItem(DELETED_KEY) ?? "[]");
          localStorage.setItem(DELETED_KEY, JSON.stringify([...new Set([...gone, id])]));
        } catch {
          /* demo only */
        }
        setState((st) => ({ ...st, episodes: st.episodes.filter((e) => e.id !== id) }));
      },
      updateSeriesCharacter: (seriesId, text) =>
        setState((st) => ({
          ...st,
          series: st.series.map((s) =>
            s.id === seriesId ? { ...s, characterDescription: text } : s,
          ),
        })),
    }),
    [state, episodesFor, createEpisode],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStories(): Store {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStories must be used inside StoryProvider");
  return v;
}
