import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CATEGORIES,
  FEED,
  SAMPLE_NOTIFICATIONS,
  filterFeed,
  type Category,
  type FeedTab,
  type FeedVideo,
} from "@/lib/feed-data";
import { VideoCard } from "@/components/feed/VideoCard";
import { CommentsSheet, ShareSheet } from "@/components/feed/Sheets";
import { HomeDailyEntry, Notifications } from "@/components/pipeline";
import { usePipeline } from "@/lib/pipeline-store";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { video?: string | undefined } => ({
    video: typeof search["video"] === "string" ? search["video"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Ace Studio — Your For You feed" },
      {
        name: "description",
        content: "Watch AI stories, comedy, music, food and more in a smooth vertical video feed.",
      },
      { property: "og:title", content: "Ace Studio — Your For You feed" },
      {
        property: "og:description",
        content: "Scroll a vertical feed of stories and creator videos on Ace Studio.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

const TABS: { id: FeedTab; label: string }[] = [
  { id: "following", label: "Following" },
  { id: "foryou", label: "For You" },
  { id: "mine", label: "My Videos" },
];

function Home() {
  const pipeline = usePipeline();
  const unread = pipeline.videos.flatMap((v) => v.notices).filter((n) => !n.read).length;
  const [tab, setTab] = useState<FeedTab>("foryou");
  const [category, setCategory] = useState<Category | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [muted, setMuted] = useState(true);
  const [followed, setFollowed] = useState<Set<string>>(new Set());
  const [commentFor, setCommentFor] = useState<FeedVideo | null>(null);
  const [shareFor, setShareFor] = useState<FeedVideo | null>(null);
  const [panel, setPanel] = useState<"search" | "notifications" | null>(null);
  const [query, setQuery] = useState("");
  const [pendingScrollId, setPendingScrollId] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const videos = useMemo(
    () => filterFeed(FEED, tab, category, followed),
    [tab, category, followed],
  );

  // A shared link carries ?video=<id> (see the share sheet): open the
  // feed on that video. Unknown ids are ignored — the feed just shows.
  const deepLinkedVideo = Route.useSearch().video;
  useEffect(() => {
    if (!deepLinkedVideo) return;
    if (!FEED.some((v) => v.id === deepLinkedVideo)) return;
    setTab("foryou");
    setCategory(null);
    setPendingScrollId(deepLinkedVideo);
  }, [deepLinkedVideo]);

  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    root.scrollTo({ top: 0 });
    setActiveId(videos[0]?.id ?? null);
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          if (e.isIntersecting) setActiveId((e.target as HTMLElement).dataset["id"] ?? null);
      },
      { root, threshold: 0.6 },
    );
    root.querySelectorAll("[data-id]").forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [videos]);

  // Scroll to a search result only after the feed has re-rendered with it —
  // no timeout race: the effect runs once the target row exists in the DOM.
  useEffect(() => {
    if (!pendingScrollId) return;
    scroller.current?.querySelector(`[data-id="${pendingScrollId}"]`)?.scrollIntoView();
    setPendingScrollId(null);
  }, [pendingScrollId, videos]);

  const toggleFollow = (name: string) =>
    setFollowed((s) => {
      const n = new Set(s);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      return n;
    });

  const results = query.trim()
    ? FEED.filter((v) =>
        `${v.title} ${v.creator.name} ${v.category} ${v.hashtags.join(" ")}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      )
    : [];

  return (
    <main className="relative mx-auto h-[100dvh] max-w-[480px] overflow-hidden bg-overlay">
      {/* Top overlay */}
      <header className="bg-home-header absolute inset-x-0 top-0 z-30 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-between px-3 pt-3">
          <IconBtn label="Search" onClick={() => setPanel("search")}>
            <Search className="h-6 w-6" />
          </IconBtn>
          <nav className="flex items-center gap-5" aria-label="Feed tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "relative py-2 text-base font-bold text-shadow-video transition-colors",
                  tab === t.id ? "text-on-video" : "text-on-video/60",
                )}
              >
                {t.label}
                {tab === t.id && (
                  <span className="absolute -bottom-0.5 left-1/2 h-1 w-6 -translate-x-1/2 rounded-full bg-primary" />
                )}
              </button>
            ))}
          </nav>
          <IconBtn label="Notifications" onClick={() => setPanel("notifications")}>
            <Bell className="h-6 w-6" />
            {unread > 0 && (
              <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </IconBtn>
        </div>
        <div className="no-scrollbar mt-2 flex gap-2 overflow-x-auto px-3 pb-2">
          <Chip active={category === null} onClick={() => setCategory(null)}>
            All
          </Chip>
          {CATEGORIES.map((c) => (
            <Chip
              key={c}
              active={category === c}
              onClick={() => setCategory(category === c ? null : c)}
            >
              {c}
            </Chip>
          ))}
        </div>
        <HomeDailyEntry />
      </header>

      <div
        ref={scroller}
        className="no-scrollbar h-full snap-y snap-mandatory overflow-y-scroll overscroll-contain"
      >
        {videos.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-8 text-center">
            <p className="font-display text-2xl font-bold">Nothing here yet</p>
            <p className="mt-2 text-muted-foreground">
              No videos in this category for this tab. Try another category.
            </p>
            <button
              onClick={() => setCategory(null)}
              className="mt-6 h-12 rounded-full bg-primary px-6 font-bold text-primary-foreground"
            >
              Show all
            </button>
          </div>
        ) : (
          videos.map((v) => (
            <div key={v.id} data-id={v.id} className="h-full snap-start snap-always">
              <VideoCard
                video={v}
                active={activeId === v.id}
                muted={muted}
                onToggleMute={() => setMuted((m) => !m)}
                onComment={setCommentFor}
                onShare={setShareFor}
                followed={followed.has(v.creator.name)}
                onFollow={toggleFollow}
              />
            </div>
          ))
        )}
      </div>

      {panel && (
        <div className="absolute inset-0 z-40 overflow-y-auto bg-background/97 px-4 pb-24 pt-4 backdrop-blur animate-in fade-in slide-in-from-top-4">
          <div className="flex items-center gap-2">
            {panel === "search" ? (
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search stories, creators, hashtags…"
                className="h-12 flex-1 rounded-full bg-card px-5 text-base outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
              />
            ) : (
              <h2 className="font-display flex-1 text-2xl font-bold">Notifications</h2>
            )}
            <IconBtn label="Close" onClick={() => setPanel(null)}>
              <X className="h-6 w-6" />
            </IconBtn>
          </div>
          {panel === "notifications" && <Notifications />}
          <ul className="mt-5 space-y-3">
            {panel === "notifications" &&
              SAMPLE_NOTIFICATIONS.map((n) => (
                <li key={n.id} className="rounded-2xl border border-border bg-card p-4">
                  <p className="text-base">{n.text}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{n.time}</p>
                </li>
              ))}
            {panel === "search" && query && results.length === 0 && (
              <li className="text-muted-foreground">No demo results.</li>
            )}
            {panel === "search" &&
              results.map((v) => (
                <li key={v.id}>
                  <button
                    onClick={() => {
                      setTab("foryou");
                      setCategory(null);
                      setPanel(null);
                      setPendingScrollId(v.id);
                    }}
                    className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-2 text-left"
                  >
                    <img
                      src={v.cover}
                      alt=""
                      width={608}
                      height={1088}
                      loading="lazy"
                      className="h-20 w-12 rounded-xl object-cover"
                    />
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{v.title}</p>
                      <p className="text-sm text-muted-foreground">
                        @{v.creator.name} · {v.category}
                      </p>
                    </div>
                  </button>
                </li>
              ))}
            {panel === "search" && !query && (
              <li className="text-muted-foreground">
                Try "Lagos", "Jollof" or "Comedy". Demo search only.
              </li>
            )}
          </ul>
        </div>
      )}

      <CommentsSheet video={commentFor} onClose={() => setCommentFor(null)} />
      <ShareSheet video={shareFor} onClose={() => setShareFor(null)} />
    </main>
  );
}

function IconBtn({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="glass relative flex h-11 w-11 items-center justify-center rounded-full text-on-video"
    >
      {children}
    </button>
  );
}

function Chip({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "h-9 shrink-0 rounded-full px-4 text-sm font-semibold transition-colors",
        active
          ? "bg-gradient-primary text-primary-foreground shadow-glow"
          : "glass border border-pink/50 text-on-video",
      )}
    >
      {children}
    </button>
  );
}
