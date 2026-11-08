import { CardActions } from "@/components/CardActions";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  ChevronLeft,
  Clock,
  Lock,
  LockOpen,
  Pencil,
  Plus,
  Film,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { useStories } from "@/lib/story-store";
import { checkEpisode, type Episode } from "@/lib/story-rules";
import { SendToPipeline } from "@/components/pipeline";

export const Route = createFileRoute("/stories")({
  head: () => ({
    meta: [
      { title: "Stories — Ace Studio" },
      {
        name: "description",
        content: "Manage your story series, locked characters and episodes in Ace Studio.",
      },
      { property: "og:title", content: "Stories — Ace Studio" },
      {
        property: "og:description",
        content: "Manage your story series, locked characters and episodes in Ace Studio.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: StoriesPage,
});

function StatusPill({ ep }: { ep: Episode }) {
  const ok = checkEpisode(ep).complete;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${ok ? "bg-teal/15 text-teal" : "bg-primary/15 text-primary"}`}
    >
      {ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
      {ep.status === "sample" ? "Sample" : "Draft"} · {ok ? "Ready" : "Incomplete"}
    </span>
  );
}

function StoriesPage() {
  const store = useStories();
  const [seriesId, setSeriesId] = useState<string | null>(null);
  const [episodeId, setEpisodeId] = useState<string | null>(null);
  const [locked, setLocked] = useState(true);

  const series = seriesId ? store.getSeries(seriesId) : undefined;
  const episode = episodeId ? store.getEpisode(episodeId) : undefined;

  if (episode && series) {
    const check = checkEpisode(episode);
    return (
      <main className="mx-auto max-w-[480px] px-4 pb-32 pt-5">
        <button
          onClick={() => setEpisodeId(null)}
          className="flex h-11 items-center gap-1 text-sm font-semibold text-muted-foreground"
        >
          <ChevronLeft className="h-5 w-5" /> {series.title}
        </button>
        <div className="mt-2 flex gap-4">
          <div className="aspect-[9/16] w-24 shrink-0 overflow-hidden rounded-2xl bg-card">
            {episode.firstFrame && (
              <img src={episode.firstFrame} alt="" className="h-full w-full object-cover" />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-primary">Episode {episode.number}</p>
            <h1 className="font-display text-2xl font-bold">
              {episode.title || "Untitled episode"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">{episode.summary}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusPill ep={episode} />
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                {check.total}s · 9:16
              </span>
            </div>
          </div>
        </div>

        <section className="mt-5 rounded-2xl border border-border bg-card p-4">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <Lock className="h-4 w-4 text-teal" /> Character (attached to every clip)
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">{episode.characterDescription}</p>
        </section>

        <h2 className="mt-6 text-lg font-bold">{episode.clips.length} clip prompts</h2>
        <ol className="mt-3 space-y-3">
          {episode.clips.map((c, i) => (
            <li key={c.id} className="flex gap-3 rounded-2xl border border-border bg-card p-4">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-primary text-sm font-bold text-primary-foreground">
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="text-sm">
                  {c.prompt || <span className="text-muted-foreground">No prompt yet</span>}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {c.durationSec}s · vertical 9:16
                </p>
              </div>
            </li>
          ))}
        </ol>
        {!check.complete && (
          <ul className="mt-4 space-y-1 rounded-2xl bg-primary/10 p-4 text-sm text-primary">
            {check.issues.map((x) => (
              <li key={x}>• {x}</li>
            ))}
          </ul>
        )}
        <Link
          to="/create"
          search={{ episode: episode.id }}
          className="mt-6 flex h-14 items-center justify-center gap-2 rounded-2xl bg-gradient-primary text-base font-bold text-primary-foreground shadow-glow"
        >
          <Pencil className="h-5 w-5" /> Edit in Create
        </Link>
        <Link
          to="/editor"
          search={{ episode: episode.id }}
          className="mt-3 flex h-14 items-center justify-center gap-2 rounded-2xl bg-secondary text-base font-bold text-teal"
        >
          <Film className="h-5 w-5" /> Open in Editor
        </Link>
        <SendToPipeline episode={episode} seriesTitle={series.title} />
      </main>
    );
  }

  if (series) {
    const eps = store.episodesFor(series.id);
    return (
      <main className="mx-auto max-w-[480px] pb-32">
        <div className="relative h-56 overflow-hidden">
          <img src={series.cover} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-video-bottom" />
          <button
            onClick={() => setSeriesId(null)}
            className="glass absolute left-3 top-3 flex h-11 items-center gap-1 rounded-full px-4 text-sm font-semibold text-on-video"
          >
            <ChevronLeft className="h-5 w-5" /> Series
          </button>
          <div className="absolute inset-x-4 bottom-4 text-on-video">
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">
              {series.genre}
            </p>
            <h1 className="font-display text-2xl font-bold text-shadow-video">{series.title}</h1>
          </div>
        </div>
        <div className="px-4">
          <p className="mt-4 text-sm text-muted-foreground">{series.logline}</p>

          <section className="mt-5 rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-bold">
                {locked ? (
                  <Lock className="h-4 w-4 text-teal" />
                ) : (
                  <LockOpen className="h-4 w-4 text-primary" />
                )}{" "}
                Locked character
              </h2>
              <button
                onClick={() => setLocked((l) => !l)}
                className="h-9 rounded-full bg-secondary px-4 text-xs font-semibold"
              >
                {locked ? "Unlock to edit" : "Lock"}
              </button>
            </div>
            <textarea
              value={series.characterDescription}
              readOnly={locked}
              onChange={(e) => store.updateSeriesCharacter(series.id, e.target.value)}
              rows={4}
              className={`mt-3 w-full resize-none rounded-xl border border-input bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-ring ${locked ? "text-muted-foreground" : ""}`}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Auto-fills every new episode. You can still tweak it per episode in Create.
            </p>
          </section>

          <div className="mt-6 flex items-center justify-between">
            <h2 className="text-lg font-bold">Episodes ({eps.length})</h2>
            <Link
              to="/create"
              search={{ series: series.id }}
              className="flex h-10 items-center gap-1 rounded-full bg-gradient-primary px-4 text-sm font-bold text-primary-foreground"
            >
              <Plus className="h-4 w-4" /> New episode
            </Link>
          </div>
          <ul className="mt-3 space-y-3">
            {eps.map((ep) => (
              <li key={ep.id}>
                <button
                  onClick={() => setEpisodeId(ep.id)}
                  className="flex w-full gap-3 rounded-2xl border border-border bg-card p-3 text-left transition active:scale-[0.99]"
                >
                  <div className="aspect-[9/16] w-14 shrink-0 overflow-hidden rounded-xl bg-muted">
                    {ep.firstFrame ? (
                      <img src={ep.firstFrame} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <Film className="m-auto mt-6 h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-primary">Episode {ep.number}</p>
                    <p className="truncate font-bold">{ep.title || "Untitled episode"}</p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <StatusPill ep={ep} />
                      <span className="text-xs text-muted-foreground">
                        {checkEpisode(ep).total}s
                      </span>
                    </div>
                  </div>
                </button>
                <CardActions
                  title={ep.title || "Untitled episode"}
                  cover={ep.firstFrame}
                  edit={{ episode: ep.id }}
                  onDelete={() => store.deleteEpisode(ep.id)}
                  details={[
                    `Episode ${ep.number}: ${ep.title}`,
                    `Summary: ${ep.summary}`,
                    `Character: ${ep.characterDescription}`,
                    "",
                    ...ep.clips.map((c, i) => `${i + 1}. (${c.durationSec}s) ${c.prompt}`),
                  ]}
                />
              </li>
            ))}
          </ul>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[480px] px-4 pb-32 pt-6">
      <h1 className="font-display text-3xl font-bold text-gradient-stories">Stories</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Your series, characters and episodes. Demo data only.
      </p>
      <ul className="mt-6 space-y-4">
        {store.series.map((s) => {
          const eps = store.episodesFor(s.id);
          return (
            <li key={s.id}>
              <button
                onClick={() => setSeriesId(s.id)}
                className="relative block h-64 w-full overflow-hidden rounded-3xl text-left shadow-glow transition active:scale-[0.99]"
              >
                <img src={s.cover} alt="" className="absolute inset-0 h-full w-full object-cover" />
                <div className="absolute inset-0 bg-video-bottom" />
                <div className="absolute inset-x-4 bottom-4 text-on-video">
                  <span className="rounded-full bg-primary px-2.5 py-1 text-xs font-bold text-primary-foreground">
                    {s.genre}
                  </span>
                  <h2 className="font-display mt-2 text-2xl font-bold text-shadow-video">
                    {s.title}
                  </h2>
                  <p className="mt-1 text-sm opacity-85">
                    {eps.length} episodes · {eps.reduce((n, e) => n + e.clips.length, 0)} clips
                  </p>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-6 rounded-2xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
        More series coming in a later step.
      </p>
    </main>
  );
}
