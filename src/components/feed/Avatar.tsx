import { cn } from "@/lib/utils";

export function Avatar({
  creator,
  size = "md",
  ring,
}: {
  creator: { initials: string; color: string; name: string };
  size?: "sm" | "md" | "lg";
  ring?: boolean;
}) {
  return (
    <div
      aria-label={creator.name}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-bold text-primary-foreground",
        creator.color,
        size === "sm" && "h-9 w-9 text-xs",
        size === "md" && "h-11 w-11 text-sm",
        size === "lg" && "h-14 w-14 text-base",
        ring && "ring-2 ring-on-video",
      )}
    >
      {creator.initials}
    </div>
  );
}
