import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { canonicalUrl, siteBaseUrl } from "../lib/seo";
import { getTheme, type Theme } from "../lib/settings/theme";
import { Toaster } from "sonner";
import { BottomNav } from "../components/BottomNav";
import { StoryProvider } from "../lib/story-store";
import { PipelineProvider } from "../lib/pipeline-store";

function NotFoundComponent() {
  return (
    <div className="mx-auto flex min-h-screen max-w-[480px] items-center justify-center px-4 pb-32 pt-5">
      <div className="w-full text-center">
        <p className="font-display text-7xl font-bold text-gradient-create">404</p>
        <h1 className="font-display mt-4 text-2xl font-bold text-foreground">
          404 — Page not found
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This page does not exist in Ace Studio, or it has been moved. Head back and keep
          creating.
        </p>
        <div className="mt-6 flex flex-col gap-3">
          <Link
            to="/"
            className="flex h-14 w-full items-center justify-center rounded-2xl bg-gradient-primary font-bold text-primary-foreground shadow-glow"
          >
            Home
          </Link>
          <Link
            to="/create"
            className="flex h-14 w-full items-center justify-center rounded-2xl bg-secondary font-semibold"
          >
            Create
          </Link>
          <Link
            to="/settings"
            className="flex h-14 w-full items-center justify-center rounded-2xl bg-secondary font-semibold"
          >
            Settings
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: ({ matches }) => {
    // Canonical + og:url for the page actually showing: the deepest
    // matched route's path. A 404 only matches the root route, so it
    // gets no canonical (its address is not a real page). The base
    // comes from SITE_URL on the server, or the browser's own origin
    // after navigation; when neither is known the tags are omitted
    // rather than pointing at an invented domain (see src/lib/seo.ts).
    const leaf = matches.at(-1);
    const canonical =
      leaf !== undefined && leaf.routeId !== "__root__"
        ? canonicalUrl(leaf.pathname, siteBaseUrl())
        : undefined;
    return {
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { name: "theme-color", content: "#0F0F12" },
        ...(canonical ? [{ property: "og:url", content: canonical }] : []),
      ],
      links: [
        {
          rel: "stylesheet",
          href: appCss,
        },
        { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
        { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
        ...(canonical ? [{ rel: "canonical", href: canonical }] : []),
      ],
    };
  },
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

/**
 * Runs before first paint: reads the saved theme ("ace-studio-theme",
 * see src/lib/settings/theme.ts) and puts the `dark` class on <html>
 * before anything renders, so there is no flash of the wrong theme.
 * The default is dark, matching DEFAULT_THEME there.
 */
const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem("ace-studio-theme");var light=t==="light";var el=document.documentElement;el.classList.toggle("dark",!light);el.style.colorScheme=light?"light":"dark";var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",light?"#F7F7F8":"#0F0F12");}catch(e){}})();`;

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

/**
 * The theme as the page actually shows it: reads the `dark` class on
 * <html> and follows it if Settings changes it, so the Toaster matches
 * the current theme without a reload.
 */
function useHtmlTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(() => getTheme());

  useEffect(() => {
    const read = () => {
      setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  return theme;
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const theme = useHtmlTheme();
  // The creator dashboard's announcement (GET /api/app-settings): a
  // short message shown to every visitor. Fetched once — the root
  // layout stays mounted while the user navigates between tabs.
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    let cancelled = false;
    fetch("/api/app-settings", { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { announcement?: unknown } | null) => {
        if (!cancelled && typeof data?.announcement === "string") {
          setAnnouncement(data.announcement);
        }
      })
      .catch(() => {
        // No announcement is not an error worth showing the user.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <StoryProvider>
        <PipelineProvider>
          {announcement ? (
            <div role="status" className="mx-auto max-w-[480px] px-4 pt-3">
              <p className="rounded-2xl bg-secondary px-4 py-3 text-center text-sm font-semibold">
                {announcement}
              </p>
            </div>
          ) : null}
          <Outlet />
        </PipelineProvider>
      </StoryProvider>
      <BottomNav />
      <Toaster theme={theme} position="top-center" />
    </QueryClientProvider>
  );
}
