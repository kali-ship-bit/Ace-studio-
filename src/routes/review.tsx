import { createFileRoute } from "@tanstack/react-router";
import { usePipeline } from "@/lib/pipeline-store";
import {
  DailyDetail,
  DemoClock,
  isWaiting,
  PipelineHeader,
  RecordRow,
  ReminderBanner,
  WaitingActions,
} from "@/components/pipeline";

export const Route = createFileRoute("/review")({
  validateSearch: (s: Record<string, unknown>): { video?: string | undefined } => ({
    video: typeof s["video"] === "string" ? s["video"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Review — Ace Studio" },
      {
        name: "description",
        content:
          "Review daily demo videos, all nine checks, approval countdowns and the complete workflow timeline.",
      },
      { property: "og:title", content: "Review — Ace Studio" },
      {
        property: "og:description",
        content:
          "Review daily demo videos, all nine checks, approval countdowns and the complete workflow timeline.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReviewPage,
});

function ReviewPage() {
  const pipeline = usePipeline();
  const { video: selectedId } = Route.useSearch();
  const selected = selectedId
    ? pipeline.videos.find((v) => v.id === selectedId)
    : pipeline.videos[0];
  const missing = selectedId !== undefined && !selected;
  const waiting = pipeline.videos.filter((v) => isWaiting(v) && v.id !== selected?.id);
  const history = pipeline.videos.filter(
    (v) => !["created", "editing", "waiting", "reminded"].includes(v.status),
  );
  return (
    <main className="mx-auto max-w-[480px] px-4 pb-32 pt-5">
      <PipelineHeader title="Review" subtitle="Daily videos · demo posting only" />
      <ReminderBanner />
      {!pipeline.ready ? (
        <p className="py-10 text-center text-muted-foreground">Loading daily videos…</p>
      ) : missing ? (
        <p className="py-10 text-center text-muted-foreground">
          That daily video no longer exists. It may have been deleted or reset.
        </p>
      ) : selected ? (
        <>
          <p className="mb-3 text-xs font-bold uppercase text-muted-foreground">
            {selectedId ? "Daily video record" : "Today's daily video"}
          </p>
          <DailyDetail video={selected} />
        </>
      ) : (
        <p className="py-10 text-center text-muted-foreground">No daily video yet.</p>
      )}
      {waiting.length > 0 && (
        <section className="mt-8 border-t border-border pt-6">
          <h2 className="text-lg font-bold">Other waiting videos</h2>
          <div className="mt-3 space-y-3">
            {waiting.map((v) => (
              <div key={v.id}>
                <RecordRow video={v} />
                <WaitingInline videoId={v.id} />
              </div>
            ))}
          </div>
        </section>
      )}
      <section className="mt-8 border-t border-border pt-6">
        <h2 className="text-lg font-bold">Past daily videos</h2>
        {history.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Finished and held videos will appear here.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {history.map((v) => (
              <li key={v.id}>
                <RecordRow video={v} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <DemoClock />
    </main>
  );
}

function WaitingInline({ videoId }: { videoId: string }) {
  const pipeline = usePipeline();
  const video = pipeline.videos.find((v) => v.id === videoId);
  return video ? <WaitingActions video={video} /> : null;
}
