import { Link } from "@tanstack/react-router";
import {
  BookOpen,
  Clapperboard,
  Home,
  Library,
  PlusSquare,
  ClipboardCheck,
  LayoutDashboard,
} from "lucide-react";

const ITEMS = [
  {
    to: "/",
    label: "Home",
    icon: Home,
    tone: "hover:text-primary data-[status=active]:text-primary",
  },
  {
    to: "/stories",
    label: "Stories",
    icon: BookOpen,
    tone: "hover:text-pink data-[status=active]:text-pink",
  },
  {
    to: "/create",
    label: "Create",
    icon: PlusSquare,
    tone: "hover:text-orange data-[status=active]:text-orange",
  },
  {
    to: "/review",
    label: "Review",
    icon: ClipboardCheck,
    tone: "hover:text-teal data-[status=active]:text-teal",
  },
  {
    to: "/library",
    label: "Library",
    icon: Library,
    tone: "hover:text-violet data-[status=active]:text-violet",
  },
  {
    to: "/editor",
    label: "Editor",
    icon: Clapperboard,
    tone: "hover:text-avatar-4 data-[status=active]:text-avatar-4",
  },
  {
    to: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    tone: "hover:text-avatar-5 data-[status=active]:text-avatar-5",
  },
] as const;

export function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 mx-auto h-[76px] max-w-[480px] border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <ul className="grid h-full grid-cols-7">
        {ITEMS.map(({ to, label, icon: Icon, tone }) => (
          <li key={to}>
            <Link
              to={to}
              activeOptions={{ exact: true }}
              className={`flex h-full flex-col items-center justify-center gap-1 text-muted-foreground ${tone}`}
            >
              {to === "/create" ? (
                <span className="flex h-8 w-11 items-center justify-center rounded-xl bg-gradient-primary text-primary-foreground">
                  <Icon className="h-5 w-5" />
                </span>
              ) : (
                <Icon className="h-6 w-6" />
              )}
              <span className="text-[10px] font-semibold">{label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
