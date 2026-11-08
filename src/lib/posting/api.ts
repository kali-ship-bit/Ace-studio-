/**
 * Posting API routes (Phase F). Server-side only.
 *
 * Wired in by src/server.ts (another agent owns that file) — this module
 * only exports handlePostingApi(), following the jobs/api.ts pattern:
 * it returns a Response for its own /api/post/* paths and null otherwise.
 *
 * Routes:
 *   GET    /api/post/platforms     registry + per-platform configured/missing
 *   POST   /api/post/:platform     create a "post" job, publish async
 *   GET    /api/post/jobs/:id      one post job's status (via the job store)
 *
 * Security rules enforced here:
 * - POST requires a valid CSRF token (cookie + header or _csrf body field).
 * - POST is rate-limited per IP (10 a minute): a post publishes to a
 *   connected social account, so hammering the endpoint must be cut off
 *   before it can spam an account. (Rate limiting slows abuse; it does
 *   not replace login — see SECURITY.md.)
 * - Server validation on every field: videoUrl must be https, caption
 *   ≤ 2200 chars, title ≤ 100 chars.
 * - No secret value ever appears in a response, a Job record, or a log
 *   line. GET /api/post/platforms reports only configured booleans and
 *   the NAMES of missing env vars. A failed post job names the missing
 *   vars, never their values.
 * - No live platform call is ever made from a test path: tests inject a
 *   mocked fetchImpl. In production the platform modules call the real
 *   APIs with the server's configured credentials.
 */

import { getJobStoreForRequest } from "../jobs/store";
import { publicJob, type Job, type JobStore } from "../jobs/types";
import { isOwnJob, ownerIdForRead, ownerIdForRequest } from "../jobs/anon";
import {
  errorResponse,
  jsonResponse,
  readJsonBody,
  tooManyResponse,
  withCookies,
} from "../security/http";
import { csrfInvalidResponse, verifyCsrfToken } from "../security/csrf";
import {
  checkApiRateLimit,
  POSTING_MAX_PER_MINUTE,
  type AttemptStore,
} from "../security/rate-limit";
import { getDefaultAttemptStore } from "../supabase/rate-limit-store";
import { PLATFORMS, getPlatform, isPlatformId, type PlatformId } from "./registry";
import { getPostingConfig, getPostingValues } from "./env";
import { publishReel } from "./instagram";
import { publishPageVideo } from "./facebook";
import { publishTikTokVideo } from "./tiktok";
import { publishYouTubeVideo } from "./youtube";
import { checklistSummary } from "./others";

export interface PostingApiDeps {
  store?: JobStore;
  fetchImpl?: typeof fetch;
  /** Rate-limit store (tests pass a fresh one; default is process memory). */
  attemptStore?: AttemptStore;
}

const MAX_CAPTION_CHARS = 2200;
const MAX_TITLE_CHARS = 100;

function captionExcerpt(caption: string): string {
  const trimmed = caption.trim();
  if (!trimmed) return "No caption";
  return trimmed.length > 120 ? `${trimmed.slice(0, 120)}…` : trimmed;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

interface PostInput {
  videoUrl: string;
  caption: string;
  title?: string | undefined;
}

/**
 * Publish one video to one platform and update the job. Runs
 * fire-and-forget from the POST handler — the client polls
 * GET /api/post/jobs/:id for the result.
 */
async function runPostJob(
  store: JobStore,
  job: Job,
  platform: PlatformId,
  input: PostInput,
  fetchImpl: typeof fetch,
): Promise<void> {
  // The first status update is inside the try too: this runs
  // fire-and-forget, so a store failure there must mark the job failed,
  // never reject into the void.
  try {
    await store.update(job.id, { status: "running", progress: 25 });
    const entry = getPlatform(platform);
    const label = entry?.label ?? platform;
    if (entry?.status === "checklist-only") {
      throw new Error(checklistSummary(platform));
    }
    const config = getPostingConfig(platform);
    if (!config.configured) {
      throw new Error(`${label} is not connected yet — set ${config.missing.join(" and ")}`);
    }
    const values = getPostingValues(platform);
    if (!values) {
      throw new Error(`${label} is not connected yet — set ${config.missing.join(" and ")}`);
    }
    let doneDetail: string;
    if (platform === "instagram") {
      const result = await publishReel(input.videoUrl, input.caption, {
        fetchImpl,
        config: {
          igUserId: values["IG_USER_ID"] as string,
          igAccessToken: values["IG_ACCESS_TOKEN"] as string,
        },
      });
      doneDetail = `Posted to Instagram · media id ${result.mediaId}`;
    } else if (platform === "facebook") {
      const videoId = await publishPageVideo(input.videoUrl, input.caption, {
        fetchImpl,
        config: {
          pageId: values["FACEBOOK_PAGE_ID"] as string,
          pageAccessToken: values["FACEBOOK_PAGE_ACCESS_TOKEN"] as string,
        },
      });
      doneDetail = `Posted to Facebook · video id ${videoId}`;
    } else if (platform === "tiktok") {
      const result = await publishTikTokVideo(input.videoUrl, input.title ?? input.caption, {
        fetchImpl,
        config: {
          clientKey: values["TIKTOK_CLIENT_KEY"] as string,
          clientSecret: values["TIKTOK_CLIENT_SECRET"] as string,
          accessToken: values["TIKTOK_ACCESS_TOKEN"] as string,
        },
      });
      doneDetail = `Posted to TikTok · publish id ${result.publishId}`;
    } else if (platform === "youtube") {
      // A missing title falls back to the caption (or a plain default):
      // the old `?? "Ace Studio video"` after slice() was dead code — a
      // string slice never returns null or undefined.
      const title = (input.title ?? input.caption.trim().slice(0, 100)).trim();
      const result = await publishYouTubeVideo(
        input.videoUrl,
        { title: title || "Ace Studio video", description: input.caption, tags: [] },
        {
          fetchImpl,
          config: {
            clientId: values["YOUTUBE_CLIENT_ID"] as string,
            clientSecret: values["YOUTUBE_CLIENT_SECRET"] as string,
            refreshToken: values["YOUTUBE_REFRESH_TOKEN"] as string,
          },
        },
      );
      doneDetail = `Posted to YouTube · ${result.watchUrl}`;
    } else {
      throw new Error(checklistSummary(platform));
    }
    await store.update(job.id, { status: "done", progress: 100, detail: doneDetail });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Posting failed";
    await store.update(job.id, { status: "failed", error: message.slice(0, 300) });
  }
}

export async function handlePostingApi(
  request: Request,
  deps: PostingApiDeps = {},
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/post")) return null;
  // A signed-in user gets the Supabase job store (durable, under RLS);
  // anonymous/demo use keeps the local file store.
  const store = deps.store ?? (await getJobStoreForRequest(request));
  const fetchImpl = deps.fetchImpl ?? fetch;
  const attemptStore = deps.attemptStore ?? getDefaultAttemptStore();

  // --- Platform catalogue -----------------------------------------------
  if (path === "/api/post/platforms" && request.method === "GET") {
    const platforms = PLATFORMS.map((entry) => {
      const config = getPostingConfig(entry.id);
      return {
        id: entry.id,
        label: entry.label,
        description: entry.description,
        monetisation: entry.monetisation,
        status: entry.status,
        requiredEnv: entry.requiredEnv,
        configured: config.configured,
        missing: config.missing,
      };
    });
    return jsonResponse({ platforms });
  }

  // --- One post job's status (reuses the job store) ----------------------
  const postJobMatch = path.match(/^\/api\/post\/jobs\/([^/]+)$/);
  if (postJobMatch) {
    const jobId = postJobMatch[1] as string;
    if (request.method === "GET") {
      const job = await store.get(jobId);
      // 404 either way: never confirm that someone else's job exists.
      const ownerId = await ownerIdForRead(request);
      if (!job || !isOwnJob(job.userId, ownerId)) {
        return errorResponse(404, "job_not_found", "No job with that id");
      }
      return jsonResponse({ job: publicJob(job) });
    }
    return errorResponse(405, "method_not_allowed", "Method not allowed for this route");
  }

  // --- Post to a platform ------------------------------------------------
  const postMatch = path.match(/^\/api\/post\/([^/]+)$/);
  if (postMatch) {
    const platform = postMatch[1] as string;
    if (request.method !== "POST") {
      return errorResponse(405, "method_not_allowed", "Method not allowed for this route");
    }
    const body = await readJsonBody(request);
    if (body === null) {
      return errorResponse(400, "bad_json", "Request body must be a JSON object");
    }
    if (!verifyCsrfToken(request, body)) {
      return csrfInvalidResponse();
    }
    // Validate before rate-limiting: junk requests must not burn the
    // strict posting cap (an attacker could otherwise deny posts to
    // everyone sharing an IP with junk requests).
    if (!isPlatformId(platform)) {
      return errorResponse(400, "unknown_platform", `Unknown platform: ${platform}`);
    }
    const videoUrl = typeof body["videoUrl"] === "string" ? body["videoUrl"].trim() : "";
    const caption = typeof body["caption"] === "string" ? body["caption"] : "";
    const title =
      typeof body["title"] === "string" && body["title"].trim() ? body["title"].trim() : undefined;
    if (!videoUrl) {
      return errorResponse(400, "missing_video_url", "Provide the video URL to post");
    }
    if (!isHttpsUrl(videoUrl)) {
      return errorResponse(400, "bad_video_url", "The video URL must start with https://");
    }
    if (caption.length > MAX_CAPTION_CHARS) {
      return errorResponse(
        400,
        "caption_too_long",
        `Keep the caption to ${MAX_CAPTION_CHARS} characters (yours is ${caption.length}).`,
      );
    }
    if (title !== undefined && title.length > MAX_TITLE_CHARS) {
      return errorResponse(
        400,
        "title_too_long",
        `Keep the title to ${MAX_TITLE_CHARS} characters (yours is ${title.length}).`,
      );
    }
    // Publishing to a connected account is the highest-stakes action in
    // this API, so it gets the strict per-IP cap (10 a minute).
    const limited = await checkApiRateLimit(request, "post", POSTING_MAX_PER_MINUTE, attemptStore);
    if (!limited.allowed) {
      return tooManyResponse(
        limited.retryAfterSeconds,
        "Too many posts in a short time. Try again in a moment.",
      );
    }
    const entry = getPlatform(platform);
    const label = entry?.label ?? platform;
    const { ownerId, setCookie } = await ownerIdForRequest(request);
    const job = await store.create({
      kind: "post",
      label: `Post to ${label}`,
      detail: captionExcerpt(caption),
      userId: ownerId,
    });
    // Fire and forget: the client polls GET /api/post/jobs/:id. A failure
    // outside runPostJob's own try/catch still marks the job failed.
    void runPostJob(store, job, platform, { videoUrl, caption, title }, fetchImpl).catch(
      async (error: unknown) => {
        const message = error instanceof Error ? error.message : "Posting failed";
        await store
          .update(job.id, { status: "failed", error: message.slice(0, 300) })
          .catch(() => {});
      },
    );
    return withCookies(jsonResponse({ job: publicJob(job) }, 202), setCookie ? [setCookie] : []);
  }

  if (path.startsWith("/api/post")) {
    return errorResponse(404, "not_found", "No such API route");
  }
  return null;
}
