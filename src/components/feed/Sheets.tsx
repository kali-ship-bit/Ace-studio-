import { useState } from "react";
import { Copy, Heart, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Drawer, DrawerContent, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { SAMPLE_COMMENTS, formatCount, type FeedVideo } from "@/lib/feed-data";
import { Avatar } from "./Avatar";

const sheetClass =
  "border-border bg-card text-card-foreground shadow-sheet mx-auto max-w-[480px] rounded-t-3xl";

export function CommentsSheet({
  video,
  onClose,
}: {
  video: FeedVideo | null;
  onClose: () => void;
}) {
  const [extra, setExtra] = useState<Record<string, string[]>>({});
  const [text, setText] = useState("");
  const mine = video ? (extra[video.id] ?? []) : [];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!video || !text.trim()) return;
    setExtra((x) => ({ ...x, [video.id]: [text.trim().slice(0, 300), ...(x[video.id] ?? [])] }));
    setText("");
  };

  return (
    <Drawer open={!!video} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent className={sheetClass}>
        <div className="flex items-center justify-between px-5 pb-2 pt-3">
          <DrawerTitle className="font-display text-lg">
            {video ? formatCount(video.comments + mine.length) : 0} comments
          </DrawerTitle>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <DrawerDescription className="sr-only">Sample comments</DrawerDescription>
        <ul className="max-h-[50vh] space-y-4 overflow-y-auto px-5 py-2">
          {mine.map((t, i) => (
            <CommentRow
              key={`m${i}`}
              name="Kenneth (you)"
              initials="KS"
              color="bg-avatar-1"
              text={t}
              likes={0}
            />
          ))}
          {SAMPLE_COMMENTS.map((c) => (
            <CommentRow key={c.name} {...c} />
          ))}
        </ul>
        <form onSubmit={submit} className="flex items-center gap-2 border-t border-border p-4">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Add a comment…"
            maxLength={300}
            className="h-12 flex-1 rounded-full bg-secondary px-5 text-base outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
          />
          <button
            type="submit"
            aria-label="Send comment"
            className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground"
          >
            <Send className="h-5 w-5" />
          </button>
        </form>
      </DrawerContent>
    </Drawer>
  );
}

function CommentRow({
  name,
  initials,
  color,
  text,
  likes,
}: {
  name: string;
  initials: string;
  color: string;
  text: string;
  likes: number;
}) {
  const [liked, setLiked] = useState(false);
  return (
    <li className="flex gap-3">
      <Avatar creator={{ name, initials, color }} size="sm" />
      <div className="flex-1">
        <p className="text-sm font-semibold text-muted-foreground">{name}</p>
        <p className="text-base">{text}</p>
      </div>
      <button
        onClick={() => setLiked((l) => !l)}
        className="flex flex-col items-center text-xs text-muted-foreground"
        aria-label="Like comment"
      >
        <Heart className={liked ? "h-5 w-5 fill-primary text-primary" : "h-5 w-5"} />
        {likes + (liked ? 1 : 0)}
      </button>
    </li>
  );
}

const TARGETS = ["Facebook", "Instagram", "TikTok", "YouTube"] as const;

export function ShareSheet({ video, onClose }: { video: FeedVideo | null; onClose: () => void }) {
  const copy = () => {
    if (!video) return;
    // No video-detail page exists yet, so the link opens the app's own
    // feed (with the video id in the address for later deep-linking) —
    // never an invented domain. The old "storyreel.studio" address was
    // a leftover that pointed nowhere. Home reads ?video= and scrolls
    // to that video.
    const url = `${window.location.origin}/?video=${video.id}`;
    // Toast only after the copy actually succeeds — a failed or
    // unavailable clipboard used to report success anyway.
    if (!navigator.clipboard) {
      toast.error("Could not copy the link");
      onClose();
      return;
    }
    navigator.clipboard.writeText(url).then(
      () => toast.success("Link copied"),
      () => toast.error("Could not copy the link"),
    );
    onClose();
  };
  return (
    <Drawer open={!!video} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent className={sheetClass}>
        <div className="px-5 pb-8 pt-3">
          <DrawerTitle className="font-display text-lg">Share</DrawerTitle>
          <DrawerDescription className="mt-1 text-sm text-muted-foreground">
            Demo only — nothing is posted yet.
          </DrawerDescription>
          <div className="mt-5 grid grid-cols-5 gap-3">
            <ShareTile label="Copy link" onClick={copy} accent>
              <Copy className="h-6 w-6" />
            </ShareTile>
            {TARGETS.map((t) => (
              <ShareTile
                key={t}
                label={t}
                onClick={() => {
                  toast(`${t} sharing is a demo`, {
                    description: "Real posting arrives in a later step.",
                  });
                  onClose();
                }}
              >
                <span className="font-display text-lg font-bold">{t[0]}</span>
              </ShareTile>
            ))}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function ShareTile({
  children,
  label,
  onClick,
  accent,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  accent?: boolean;
}) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-2">
      <span
        className={
          accent
            ? "flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground"
            : "flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary text-teal"
        }
      >
        {children}
      </span>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
    </button>
  );
}
