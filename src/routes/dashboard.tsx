import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Activity, Check, ChevronRight, Clock, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePipeline } from "@/lib/pipeline-store";
import { autoPostTime } from "@/lib/pipeline-rules";
import {
  countdown,
  dateTime,
  DemoClock,
  isWaiting,
  Notifications,
  PipelineHeader,
  RecordRow,
  ReminderBanner,
  StatusBadge,
  time,
} from "@/components/pipeline";

export const Route = createFileRoute("/dashboard")({
  validateSearch: (s: Record<string, unknown>): { notifications?: boolean | undefined } => ({
    notifications: s["notifications"] === true || s["notifications"] === "true" ? true : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Dashboard — Ace Studio" },
      {
        name: "description",
        content:
          "Track daily demo video records, approval stages, check results, recent activity and reminders.",
      },
      { property: "og:title", content: "Dashboard — Ace Studio" },
      {
        property: "og:description",
        content:
          "Track daily demo video records, approval stages, check results, recent activity and reminders.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Dashboard,
});

const FILTERS = ["All", "Waiting", "Posted", "Failed"] as const;
function Dashboard() {
  const pipeline = usePipeline();
  const search = Route.useSearch();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (search.notifications && pipeline.ready)
      document.getElementById("notifications")?.scrollIntoView({ behavior: "smooth" });
  }, [search.notifications, pipeline.ready]);
  const current = pipeline.videos[0];
  const failed = (v: typeof current) => Boolean(v && v.checks.some((c) => !c.pass));
  const records = pipeline.videos.filter((v) => {
    const matches =
      filter === "All" ||
      (filter === "Waiting" && isWaiting(v)) ||
      (filter === "Posted" && ["auto", "approved"].includes(v.status)) ||
      (filter === "Failed" && failed(v));
    return matches && `${v.title} ${v.episode.title}`.toLowerCase().includes(query.toLowerCase());
  });
  const metrics = [
    [
      "Created this week",
      pipeline.videos.filter((v) => v.createdAt >= pipeline.now - 7 * 86400000).length,
    ],
    ["Waiting approval", pipeline.videos.filter(isWaiting).length],
    ["Posted (auto)", pipeline.videos.filter((v) => v.status === "auto").length],
    ["Approved", pipeline.videos.filter((v) => v.status === "approved").length],
    ["Failed a check", pipeline.videos.filter(failed).length],
  ] as const;
  const activities = pipeline.videos
    .flatMap((v) => v.events.map((e) => ({ ...e, title: `Episode ${v.episode.number}` })))
    .sort((a, b) => b.at - a.at);
  const stage = current
    ? ["created", "editing", "waiting", "waiting", "reminded", "auto"].indexOf(current.status)
    : -1;
  const activeStage =
    current?.status === "approved"
      ? 5
      : current?.status === "waiting"
        ? 3
        : current?.status === "rejected"
          ? 3
          : current?.status === "needs-edit"
            ? 2
            : stage;
  return (
    <main className="mx-auto max-w-[480px] px-4 pb-32 pt-5">
      <PipelineHeader title="Dashboard" subtitle="Your daily studio, at a glance" />
      <ReminderBanner />
      <section>
        <h2 className="text-lg font-bold">Today at a glance</h2>
        {current && (
          <div className="mt-3 border-l-4 border-primary pl-4">
            <p className="text-sm font-semibold">{current.title}</p>
            <div className="mt-2">
              <StatusBadge video={current} />
            </div>
          </div>
        )}
        <div className="mt-4 grid grid-cols-2 gap-3">
          {metrics.map(([label, value], i) => (
            <div
              key={label}
              className={`rounded-2xl border bg-card p-4 ${["border-primary/40", "border-pink/40", "border-teal/40", "border-violet/40", "border-orange/40"][i]}`}
            >
              <p
                className={`font-display text-3xl font-bold ${["text-primary", "text-pink", "text-teal", "text-violet", "text-orange"][i]}`}
              >
                {value}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="mt-8 border-t border-border pt-6">
        <h2 className="text-lg font-bold">Workflow pipeline</h2>
        <ol className="mt-4">
          {[
            "Created",
            "Auto-edited",
            "Checks",
            "Waiting (2h)",
            "Reminder sent",
            "Posted (auto) / Approved",
          ].map((label, i) => (
            <li
              key={label}
              className={`flex items-center gap-3 border-l-2 py-3 pl-4 ${i === activeStage ? "border-primary bg-primary/10" : "border-border"}`}
            >
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${i < activeStage ? "bg-teal/15 text-teal" : i === activeStage ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"}`}
              >
                {i < activeStage ? <Check className="h-4 w-4" /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-semibold ${i === activeStage ? "text-primary" : ""}`}>
                  {label}
                </p>
                {i === activeStage && current && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {current.status === "needs-edit"
                      ? "Held — posting blocked"
                      : current.status === "rejected"
                        ? "Rejected — posting stopped"
                        : isWaiting(current)
                          ? countdown((autoPostTime(current) ?? pipeline.now) - pipeline.now)
                          : dateTime(current.events.at(-1)?.at ?? current.createdAt)}
                  </p>
                )}
              </div>
              {i === activeStage && <ChevronRight className="h-4 w-4 text-primary" />}
            </li>
          ))}
        </ol>
        {current && isWaiting(current) && (
          <p className="mt-3 flex items-center gap-2 text-sm text-primary">
            <Clock className="h-4 w-4" />
            Auto-post at {time(autoPostTime(current))}
          </p>
        )}
        {current && (
          <div className="mt-4">
            <RecordRow video={current} />
          </div>
        )}
      </section>
      <section className="mt-8 border-t border-border pt-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Records</h2>
          <span className="text-xs text-muted-foreground">
            {pipeline.videos.length} daily videos
          </span>
        </div>
        <label className="mt-4 flex h-12 items-center gap-2 rounded-xl border border-input bg-card px-3">
          <Search className="h-5 w-5 text-muted-foreground" />
          <input
            aria-label="Search records by title"
            placeholder="Search by title"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </label>
        <div
          className="no-scrollbar mt-3 flex gap-2 overflow-x-auto"
          aria-label="Record status filters"
        >
          {FILTERS.map((f) => (
            <Button
              key={f}
              aria-pressed={filter === f}
              variant={filter === f ? "default" : "secondary"}
              className="h-11 shrink-0 rounded-full px-4"
              onClick={() => setFilter(f)}
            >
              {f}
            </Button>
          ))}
        </div>
        <ul className="mt-4 space-y-3">
          {records.map((v) => (
            <li key={v.id}>
              <RecordRow video={v} />
            </li>
          ))}
        </ul>
        {records.length === 0 && (
          <p className="mt-5 text-center text-sm text-muted-foreground">
            No matching daily records.
          </p>
        )}
      </section>
      <section className="mt-8 border-t border-border pt-6">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <Activity className="h-5 w-5 text-teal" />
          Recent activity
        </h2>
        <ol className="mt-4 divide-y divide-border">
          {activities.map((e) => (
            <li key={e.id} className="py-3">
              <p className="text-xs text-muted-foreground">
                {dateTime(e.at)} · {e.title}
              </p>
              <p className="mt-1 text-sm">{e.text}</p>
            </li>
          ))}
        </ol>
      </section>
      <Notifications />
      <DemoClock />
    </main>
  );
}
