/**
 * Instagram posting (Phase F). Server-side only.
 *
 * Instagram Graph API (v21.0) Reel flow:
 *   1. createMediaContainer — POST /{ig-user-id}/media with the video URL,
 *      caption and media_type "REELS". Returns a container id.
 *   2. checkContainerStatus — GET /{container-id}?fields=status_code.
 *      The container must reach status_code "FINISHED" before publishing.
 *   3. publishContainer — POST /{ig-user-id}/media_publish with the
 *      container id. Returns the published media id.
 *
 * The video MUST be at a publicly reachable URL (for example a Supabase
 * Storage signed URL for the finished job output) — Meta's servers fetch
 * it themselves, so a localhost or private URL will not work.
 *
 * Gating: every call needs IG_USER_ID and IG_ACCESS_TOKEN. When either is
 * missing the call throws a clear "not configured" error naming the
 * missing vars, and never touches the network. Values arrive as function
 * arguments (from src/lib/posting/env.ts in the API route, or as test
 * placeholders in tests) and are never logged, stored, or returned.
 */

import { timedFetch } from "./download";
import { resolveEnvConfig, sanitiseProviderMessage } from "./provider";

export const INSTAGRAM_GRAPH_API_BASE = "https://graph.facebook.com/v21.0";

export interface InstagramConfig {
  igUserId: string;
  igAccessToken: string;
}

export interface InstagramDeps {
  fetchImpl?: typeof fetch;
  /** Test/route-supplied config. When omitted, reads IG_* from the server env. */
  config?: InstagramConfig | undefined;
}

export class InstagramNotConfiguredError extends Error {
  missing: string[];
  constructor(missing: string[]) {
    super(`Instagram is not connected yet — set ${missing.join(" and ")}`);
    this.name = "InstagramNotConfiguredError";
    this.missing = missing;
  }
}

export class InstagramApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "InstagramApiError";
    this.status = status;
  }
}

type FetchFn = typeof fetch;

function resolveConfig(deps: InstagramDeps): InstagramConfig {
  if (deps.config) return deps.config;
  const values = resolveEnvConfig(
    ["IG_USER_ID", "IG_ACCESS_TOKEN"],
    (missing) => new InstagramNotConfiguredError(missing),
  );
  return {
    igUserId: values["IG_USER_ID"] as string,
    igAccessToken: values["IG_ACCESS_TOKEN"] as string,
  };
}

function sanitiseInstagramError(status: number, bodyText: string): InstagramApiError {
  return new InstagramApiError(status, sanitiseProviderMessage("Instagram", status, bodyText));
}

async function graphPost(
  fetchImpl: FetchFn,
  path: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await timedFetch(fetchImpl, `${INSTAGRAM_GRAPH_API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw sanitiseInstagramError(response.status, await response.text());
  }
  return (await response.json()) as Record<string, unknown>;
}

async function graphGet(
  fetchImpl: FetchFn,
  path: string,
  accessToken: string,
): Promise<Record<string, unknown>> {
  // The access token travels in the Authorization header, never in the
  // URL — a token in a query string can land in server logs.
  const response = await timedFetch(fetchImpl, `${INSTAGRAM_GRAPH_API_BASE}${path}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw sanitiseInstagramError(response.status, await response.text());
  }
  return (await response.json()) as Record<string, unknown>;
}

/**
 * Step 1: create the Reel media container. Returns the container id.
 * The video must already be at a publicly reachable https URL.
 */
export async function createMediaContainer(
  videoUrl: string,
  caption: string,
  deps: InstagramDeps = {},
): Promise<string> {
  const config = resolveConfig(deps);
  const fetchImpl = deps.fetchImpl ?? fetch;
  const data = await graphPost(fetchImpl, `/${config.igUserId}/media`, {
    video_url: videoUrl,
    caption,
    media_type: "REELS",
    access_token: config.igAccessToken,
  });
  if (typeof data["id"] !== "string" || !data["id"]) {
    throw new InstagramApiError(502, "Instagram returned no media container id");
  }
  return data["id"] as string;
}

/** Step 2: read the container's processing status ("IN_PROGRESS" | "FINISHED" | "ERROR"). */
export async function checkContainerStatus(
  creationId: string,
  deps: InstagramDeps = {},
): Promise<string> {
  const config = resolveConfig(deps);
  const fetchImpl = deps.fetchImpl ?? fetch;
  const data = await graphGet(fetchImpl, `/${creationId}?fields=status_code`, config.igAccessToken);
  return typeof data["status_code"] === "string" ? (data["status_code"] as string) : "UNKNOWN";
}

/**
 * Step 3: publish a FINISHED container. Returns the published media id.
 */
export async function publishContainer(
  creationId: string,
  deps: InstagramDeps = {},
): Promise<string> {
  const config = resolveConfig(deps);
  const fetchImpl = deps.fetchImpl ?? fetch;
  const data = await graphPost(fetchImpl, `/${config.igUserId}/media_publish`, {
    creation_id: creationId,
    access_token: config.igAccessToken,
  });
  if (typeof data["id"] !== "string" || !data["id"]) {
    throw new InstagramApiError(502, "Instagram returned no published media id");
  }
  return data["id"] as string;
}

export interface PublishReelResult {
  containerId: string;
  mediaId: string;
}

/**
 * Full Reel flow: create the container, wait until it is FINISHED, then
 * publish it. `pollDelayMs` / `maxPolls` are injectable so tests run fast;
 * production defaults wait up to ~2 minutes for Meta to process the video.
 */
export async function publishReel(
  videoUrl: string,
  caption: string,
  deps: InstagramDeps & { pollDelayMs?: number; maxPolls?: number } = {},
): Promise<PublishReelResult> {
  const containerId = await createMediaContainer(videoUrl, caption, deps);
  const pollDelayMs = deps.pollDelayMs ?? 5000;
  const maxPolls = deps.maxPolls ?? 24;
  for (let attempt = 0; attempt < maxPolls; attempt++) {
    const status = await checkContainerStatus(containerId, deps);
    if (status === "FINISHED") {
      const mediaId = await publishContainer(containerId, deps);
      return { containerId, mediaId };
    }
    if (status === "ERROR") {
      throw new InstagramApiError(502, "Instagram failed to process the video");
    }
    // EXPIRED (containers live 24 h) and any status we do not recognise
    // are terminal too — looping the full poll window would only report
    // the misleading "did not finish processing in time".
    if (status === "EXPIRED") {
      throw new InstagramApiError(502, "Instagram container expired before it finished");
    }
    if (status !== "IN_PROGRESS") {
      throw new InstagramApiError(502, `Instagram container in unexpected status: ${status}`);
    }
    if (attempt < maxPolls - 1 && pollDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, pollDelayMs));
    }
  }
  throw new InstagramApiError(502, "Instagram did not finish processing the video in time");
}
