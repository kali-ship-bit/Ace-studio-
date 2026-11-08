import { Link } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";

export function ComingSoon({
  title,
  blurb,
  icon: Icon,
  titleClassName = "",
}: {
  title: string;
  blurb: string;
  icon: LucideIcon;
  titleClassName?: string;
}) {
  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-[480px] flex-col items-center justify-center px-6 pb-28 text-center">
      <div className="flex h-24 w-24 items-center justify-center rounded-3xl border border-border bg-card shadow-glow">
        <Icon className="h-11 w-11 text-primary" />
      </div>
      <h1 className={`font-display mt-8 text-3xl font-bold ${titleClassName}`}>{title}</h1>
      <p className="mt-3 text-base text-muted-foreground">{blurb}</p>
      <span className="mt-6 rounded-full bg-teal/15 px-4 py-2 text-sm font-semibold text-teal">
        Coming in the next step
      </span>
      <Link
        to="/"
        className="mt-8 inline-flex h-12 items-center rounded-full bg-gradient-primary px-7 text-base font-bold text-primary-foreground shadow-glow"
      >
        Back to Home feed
      </Link>
    </main>
  );
}
