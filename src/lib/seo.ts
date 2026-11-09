/**
 * SEO helpers — the "your website might be invisible to AI" fix.
 *
 * What the video's point means here: AI crawlers (ChatGPT, Claude,
 * Perplexity) read the raw HTML a server sends. If a page's words only
 * appear after JavaScript runs, they may never see them. This app
 * already renders its text on the server (verified by curl against the
 * production build — every page's visible text is in the raw HTML), so
 * the missing pieces are the signposts crawlers use: a canonical URL
 * per page, an og:url, a sitemap, and robots.txt rules that welcome AI
 * crawlers.
 *
 * This module is browser-safe on purpose: a route `head` function runs
 * both on the server (SSR) and in the browser (after navigation), so
 * this file must not import anything server-only. In particular it does
 * NOT use getSiteUrl() from src/lib/supabase/env — that reads a
 * .dev.vars file with node:fs. The SITE_URL validation below mirrors
 * getSiteUrl's rules exactly (https anywhere, plain http only for
 * local hosts); the one difference is that it reads process.env only,
 * never .dev.vars. In production SITE_URL comes from hosting secrets,
 * which is the path that matters.
 *
 * When no base URL is known, callers get undefined — meaning "omit the
 * tag", never "invent a domain".
 */

/** Every page the app promises. Must match the route table pinned in
 *  src/router.test.ts — seo.test.ts checks the two agree. */
export const KNOWN_PATHS = [
  "/",
  "/create",
  "/dashboard",
  "/editor",
  "/forgot-password",
  "/library",
  "/login",
  "/narrate",
  "/reset-password",
  "/review",
  "/settings",
  "/signup",
  "/stories",
] as const;

/**
 * Pages that exist but are private — never listed in the public
 * sitemap and never given a canonical URL. /profile shows one
 * person's own account, so crawlers must not be pointed at it (the
 * page itself also carries a noindex meta tag). The route table still
 * pins these pages (see src/router.test.ts); the agreement check in
 * seo.test.ts counts KNOWN_PATHS + PRIVATE_PATHS together.
 */
export const PRIVATE_PATHS = ["/profile"] as const;

function normalizePath(pathname: string): string {
  if (pathname === "/") return "/";
  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

/**
 * Validate a SITE_URL value the same way getSiteUrl() does: https for
 * any host, plain http only for a local host. Returns the origin, or
 * undefined when the value is missing or not acceptable.
 */
export function resolveSiteBase(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return url.origin;
    if (
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]")
    ) {
      return url.origin;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * The site's public base URL, or undefined when it is not known.
 * Server: SITE_URL from the process environment (a hosting secret in
 * production). Browser: the page's own origin — the browser always
 * knows where it is.
 */
export function siteBaseUrl(): string | undefined {
  if (typeof window !== "undefined") return window.location.origin;
  return resolveSiteBase(process.env["SITE_URL"]?.trim() || undefined);
}

/**
 * The canonical URL for a page, or undefined when the page is not one
 * of the app's known pages or no base URL is known. The base is a
 * separate argument (callers pass siteBaseUrl()) so "no base known"
 * stays representable — an explicit undefined here means "unknown",
 * not "use the default".
 */
export function canonicalUrl(pathname: string, base: string | undefined): string | undefined {
  const path = normalizePath(pathname);
  if (!(KNOWN_PATHS as readonly string[]).includes(path)) return undefined;
  if (!base) return undefined;
  return `${base}${path}`;
}

/**
 * A sitemap listing every known page under `base` (an origin such as
 * https://example.com — no trailing slash). `loc` values are built
 * only from the fixed path list and a validated origin, never from
 * user input, so no escaping is needed.
 */
export function buildSitemapXml(base: string): string {
  const urls = (KNOWN_PATHS as readonly string[])
    .map((path) => {
      const loc = `${base}${path}`;
      const priority = path === "/" ? "1.0" : "0.8";
      return (
        `  <url>\n` +
        `    <loc>${loc}</loc>\n` +
        `    <changefreq>weekly</changefreq>\n` +
        `    <priority>${priority}</priority>\n` +
        `  </url>`
      );
    })
    .join("\n");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `${urls}\n` +
    `</urlset>\n`
  );
}
