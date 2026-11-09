import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { handleApiRequest } from "./lib/jobs/api";
import { handleAuthApi } from "./lib/auth/api";
import { handlePostingApi } from "./lib/posting/api";
import { handleAvatarApi } from "./lib/settings/avatar-api";
import { handleProfileApi } from "./lib/settings/profile-api";
import { getPublicAppSettings, handleAppSettingsApi } from "./lib/settings/app-settings";
import { buildSitemapXml } from "./lib/seo";
import { getSiteUrl } from "./lib/supabase/env";
import { isSecureRequest } from "./lib/security/session";
import { errorResponse } from "./lib/security/http";
import { withSecurityHeaders, type HeaderOptions } from "./lib/security/headers";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

/** Local hosts never get the HTTPS redirect (local dev runs on http). */
function isLocalHost(request: Request): boolean {
  const host = new URL(request.url).hostname;
  return (
    host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost")
  );
}

function headerOptions(): HeaderOptions {
  return { isDev: process.env["NODE_ENV"] !== "production" };
}

/** The page shown while the creator dashboard's maintenance mode is on. */
function renderMaintenancePage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Under maintenance — Ace Studio</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f0f12;color:#f7f7f8;font-family:system-ui,sans-serif;text-align:center;padding:24px}h1{font-size:28px;margin:0 0 12px}p{color:#a1a1aa;margin:0}</style>
</head>
<body>
<main>
<h1>Ace Studio is under maintenance</h1>
<p>We are making things better. Please check back in a little while.</p>
</main>
</body>
</html>`;
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      // Force HTTPS everywhere except local dev: a plain-http request for
      // a real host is upgraded before anything else runs. (HSTS in the
      // response headers makes the browser remember this for a year.)
      if (!isSecureRequest(request) && !isLocalHost(request)) {
        const url = new URL(request.url);
        url.protocol = "https:";
        return withSecurityHeaders(
          new Response(null, { status: 308, headers: { location: url.toString() } }),
          headerOptions(),
        );
      }

      // API handlers, in order. Each returns null when the path is not
      // theirs, so the next one gets a turn. The jobs handler is last of
      // the API handlers because it answers 404 for any /api/* path it
      // does not recognise.
      //   /api/auth/*           login, signup, reset, CSRF token, logout
      //   /api/post/*           social posting (Instagram first)
      //   /api/settings/avatar  profile-picture upload
      //   /api/settings/profile profile fields (display name, username, bio)
      //   /api/app-settings     public switches (maintenance, announcement)
      //   /api/jobs, /api/narrate, /api/voices, /api/settings/keys
      const authResponse = await handleAuthApi(request);
      if (authResponse) return withSecurityHeaders(authResponse, headerOptions());
      const postingResponse = await handlePostingApi(request);
      if (postingResponse) return withSecurityHeaders(postingResponse, headerOptions());
      const avatarResponse = await handleAvatarApi(request);
      if (avatarResponse) return withSecurityHeaders(avatarResponse, headerOptions());
      const profileResponse = await handleProfileApi(request);
      if (profileResponse) return withSecurityHeaders(profileResponse, headerOptions());
      const appSettingsResponse = await handleAppSettingsApi(request);
      if (appSettingsResponse) {
        return withSecurityHeaders(appSettingsResponse, headerOptions());
      }
      const apiResponse = await handleApiRequest(request);
      if (apiResponse) return withSecurityHeaders(apiResponse, headerOptions());
      // /sitemap.xml is served here, not as a static file in public/:
      // a sitemap's URLs must be absolute, and there is no production
      // domain to hard-code yet — a static file would have to invent
      // one. The base is SITE_URL when it is set (hosting secret in
      // production), otherwise the address this request came in on
      // (for a sitemap that is the site's own address, not a token
      // link, so the request origin is safe to use here).
      if (new URL(request.url).pathname === "/sitemap.xml") {
        const base = getSiteUrl() ?? new URL(request.url).origin;
        return withSecurityHeaders(
          new Response(buildSitemapXml(base), {
            status: 200,
            headers: {
              "content-type": "application/xml; charset=utf-8",
              "cache-control": "public, max-age=3600",
            },
          }),
          headerOptions(),
        );
      }
      // Maintenance mode (creator dashboard toggle): when it is on, page
      // requests get a maintenance page instead of the app. API routes
      // above stay live, so the dashboard can turn it back off, and
      // static files (robots, sitemap, favicon) are unaffected. A
      // database failure reads as "not in maintenance" — an outage must
      // not be able to switch the app off by itself.
      if (request.method === "GET" && !new URL(request.url).pathname.startsWith("/api/")) {
        const settings = await getPublicAppSettings();
        if (settings.maintenanceMode) {
          return withSecurityHeaders(
            new Response(renderMaintenancePage(), {
              status: 503,
              headers: {
                "content-type": "text/html; charset=utf-8",
                "retry-after": "3600",
              },
            }),
            headerOptions(),
          );
        }
      }
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return withSecurityHeaders(await normalizeCatastrophicSsrResponse(response), headerOptions());
    } catch (error) {
      console.error(error);
      // An API client expects JSON, not the HTML error page — a page
      // client expects the opposite. Answer in the caller's language.
      if (new URL(request.url).pathname.startsWith("/api/")) {
        return withSecurityHeaders(
          errorResponse(500, "server_error", "Something went wrong. Try again in a moment."),
          headerOptions(),
        );
      }
      return withSecurityHeaders(
        new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
        headerOptions(),
      );
    }
  },
};
