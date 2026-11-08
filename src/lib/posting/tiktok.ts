/**
 * TikTok posting (Phase F). Server-side only.
 *
 * TikTok Content Posting API flow, as specified in the public TikTok
 * developer docs ("Content Posting API" — TikTok for Developers):
 *   0. queryCreatorInfo — POST /v2/post/publish/creator_info/query/.
 *      MANDATORY before every post: the privacy_level sent at init must
 *      be one of the privacy_level_options this returns, or init fails
 *      with privacy_level_option_mismatch. Valid values are
 *      PUBLIC_TO_EVERYONE, MUTUAL_FOLLOW_FRIENDS, FOLLOWER_OF_CREATOR
 *      and SELF_ONLY. Unaudited clients may only use SELF_ONLY.
 *   1. initialise — POST /v2/post/publish/video/init/ with post_info
 *      (title, privacy level, duet/comment/stitch settings) and
 *      source_info (source "FILE_UPLOAD", video size, chunk size, chunk
 *      count). Returns a publish_id and an upload_url.
 *   2. upload — PUT the video bytes to the returned upload_url with a
 *      Content-Range header. This build uploads in a single chunk.
 *   3. confirm — POST /v2/post/publish/status/fetch/ with the publish_id
 *      and wait until the status is PUBLISHED. There is no separate
 *      "publish" call in the Content Posting API: once the upload
 *      finishes, TikTok publishes the video and the status endpoint is
 *      how the app confirms it.
 *
 * CONFIRM BEFORE ENABLING LIVE: the shapes above are taken from the
 * public docs, but the live flow has NOT been verified against a real
 * TikTok developer app in this build (no TikTok credentials exist yet).
 * Before the first real post, confirm the init body, the upload
 * Content-Range handling and the status values against the current
 * TikTok developer docs and run one test upload from a throwaway clip.
 *
 * TikTok also needs a developer app + Login Kit + the video.upload scope
 * approved before any of this works — see CREDENTIALS.md.
 *
 * Gating: every call needs TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET and
 * TIKTOK_ACCESS_TOKEN. When any is missing the call throws a clear "not
 * configured" error naming the missing vars, and never touches the
 * network. Values arrive as function arguments and are never logged,
 * stored, or returned. The client key/secret are used for the OAuth
 * setup; the access token is the Bearer token on the API calls.
 */

import {
  assertUploadUrl,
  fetchPublicVideoBytes,
  TIKTOK_UPLOAD_HOST_SUFFIXES,
  timedFetch,
  type ResolveHost,
} from "./download";
import { resolveEnvConfig, sanitiseProviderMessage } from "./provider";

export const TIKTOK_API_BASE = "https://open.tiktokapis.com/v2";

export interface TikTokConfig {
  clientKey: string;
  clientSecret: string;
  accessToken: string;
}

export interface TikTokDeps {
  fetchImpl?: typeof fetch;
  /** Test/route-supplied config. When omitted, reads TIKTOK_* from the server env. */
  config?: TikTokConfig | undefined;
  /** Host resolver for the SSRF check on the video URL (tests inject a fake). */
  resolveHost?: ResolveHost;
}

export class TikTokNotConfiguredError extends Error {
  missing: string[];
  constructor(missing: string[]) {
    super(`TikTok is not connected yet — set ${missing.join(" and ")}`);
    this.name = "TikTokNotConfiguredError";
    this.missing = missing;
  }
}

export class TikTokApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "TikTokApiError";
    this.status = status;
  }
}

function resolveConfig(deps: TikTokDeps): TikTokConfig {
  if (deps.config) return deps.config;
  const values = resolveEnvConfig(
    ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "TIKTOK_ACCESS_TOKEN"],
    (missing) => new TikTokNotConfiguredError(missing),
  );
  return {
    clientKey: values["TIKTOK_CLIENT_KEY"] as string,
    clientSecret: values["TIKTOK_CLIENT_SECRET"] as string,
    accessToken: values["TIKTOK_ACCESS_TOKEN"] as string,
  };
}

function sanitiseTikTokError(status: number, bodyText: string): TikTokApiError {
  return new TikTokApiError(status, sanitiseProviderMessage("TikTok", status, bodyText));
}

interface TikTokInitResult {
  publishId: string;
  uploadUrl: string;
}

export interface TikTokCreatorInfo {
  /** Privacy levels this creator may post with, from creator_info/query. */
  privacyLevelOptions: string[];
  creatorNickname?: string | undefined;
  maxVideoPostDurationSec?: number | undefined;
}

/**
 * Step 0 (mandatory): ask TikTok which privacy levels this creator may
 * use. The init call must send one of the returned options — sending any
 * other value fails with privacy_level_option_mismatch.
 */
export async function queryCreatorInfo(deps: TikTokDeps = {}): Promise<TikTokCreatorInfo> {
  const config = resolveConfig(deps);
  const fetchImpl = deps.fetchImpl ?? fetch;
  const response = await timedFetch(
    fetchImpl,
    `${TIKTOK_API_BASE}/post/publish/creator_info/query/`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({}),
    },
  );
  if (!response.ok) {
    throw sanitiseTikTokError(response.status, await response.text());
  }
  const data = (await response.json()) as {
    data?: {
      privacy_level_options?: unknown;
      creator_nickname?: unknown;
      max_video_post_duration_sec?: unknown;
    };
  };
  const options = data.data?.privacy_level_options;
  if (!Array.isArray(options) || options.some((o) => typeof o !== "string")) {
    throw new TikTokApiError(502, "TikTok returned no privacy level options");
  }
  return {
    privacyLevelOptions: options as string[],
    creatorNickname:
      typeof data.data?.creator_nickname === "string"
        ? (data.data.creator_nickname as string)
        : undefined,
    maxVideoPostDurationSec:
      typeof data.data?.max_video_post_duration_sec === "number"
        ? (data.data.max_video_post_duration_sec as number)
        : undefined,
  };
}

/** Step 1: initialise the video post. Returns the publish id + upload URL. */
export async function initVideoPublish(
  title: string,
  videoSize: number,
  deps: TikTokDeps & { privacyLevel?: string } = {},
): Promise<TikTokInitResult> {
  const config = resolveConfig(deps);
  const fetchImpl = deps.fetchImpl ?? fetch;
  // Default is the public value for an audited account. Callers that know
  // the creator's options (publishTikTokVideo queries them first) pass the
  // exact value; unaudited clients must pass SELF_ONLY.
  const privacyLevel = deps.privacyLevel ?? "PUBLIC_TO_EVERYONE";
  const response = await timedFetch(fetchImpl, `${TIKTOK_API_BASE}/post/publish/video/init/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      post_info: {
        title,
        privacy_level: privacyLevel,
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
        video_cover_timestamp_ms: 1000,
      },
      source_info: {
        source: "FILE_UPLOAD",
        video_size: videoSize,
        chunk_size: videoSize,
        total_chunk_count: 1,
      },
    }),
  });
  if (!response.ok) {
    throw sanitiseTikTokError(response.status, await response.text());
  }
  const data = (await response.json()) as {
    data?: { publish_id?: unknown; upload_url?: unknown };
  };
  const publishId = data.data?.publish_id;
  const uploadUrl = data.data?.upload_url;
  if (typeof publishId !== "string" || !publishId || typeof uploadUrl !== "string" || !uploadUrl) {
    throw new TikTokApiError(502, "TikTok returned no publish id or upload URL");
  }
  return { publishId, uploadUrl };
}

/** Step 2: upload the video bytes to the URL from init (single chunk). */
export async function uploadVideoBytes(
  uploadUrl: string,
  videoBytes: Uint8Array,
  deps: TikTokDeps = {},
): Promise<void> {
  // Config is resolved (and the not-configured error thrown) even though
  // the upload itself carries no credential — a publish is one flow.
  resolveConfig(deps);
  // The upload URL comes from TikTok's init response: it must point at
  // TikTok's own upload host, never at an attacker's server.
  try {
    assertUploadUrl(uploadUrl, TIKTOK_UPLOAD_HOST_SUFFIXES, "TikTok");
  } catch (error) {
    throw new TikTokApiError(502, error instanceof Error ? error.message : "Bad TikTok upload URL");
  }
  const fetchImpl = deps.fetchImpl ?? fetch;
  const response = await timedFetch(fetchImpl, uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "video/mp4",
      "Content-Range": `bytes 0-${videoBytes.byteLength - 1}/${videoBytes.byteLength}`,
      "Content-Length": String(videoBytes.byteLength),
    },
    body: videoBytes as unknown as BodyInit,
  });
  if (!response.ok) {
    throw sanitiseTikTokError(response.status, await response.text());
  }
}

/**
 * Step 3: check the publish status for a publish id.
 * Returns the raw status string, e.g. "PROCESSING_UPLOAD", "PROCESSING",
 * "PUBLISHED" or "FAILED".
 */
export async function fetchPublishStatus(
  publishId: string,
  deps: TikTokDeps = {},
): Promise<string> {
  const config = resolveConfig(deps);
  const fetchImpl = deps.fetchImpl ?? fetch;
  const response = await timedFetch(fetchImpl, `${TIKTOK_API_BASE}/post/publish/status/fetch/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ publish_id: publishId }),
  });
  if (!response.ok) {
    throw sanitiseTikTokError(response.status, await response.text());
  }
  const data = (await response.json()) as { data?: { status?: unknown } };
  return typeof data.data?.status === "string" ? (data.data.status as string) : "UNKNOWN";
}

export interface PublishTikTokResult {
  publishId: string;
}

/**
 * Full TikTok flow: fetch the video bytes from its public URL, initialise
 * the post, upload the bytes, then wait until TikTok reports PUBLISHED.
 * `pollDelayMs` / `maxPolls` are injectable so tests run fast.
 */
export async function publishTikTokVideo(
  videoUrl: string,
  title: string,
  deps: TikTokDeps & { pollDelayMs?: number; maxPolls?: number } = {},
): Promise<PublishTikTokResult> {
  const config = resolveConfig(deps);
  // The video URL is user-supplied: it is downloaded through the
  // hardened downloader (https only, public IPs only, size-capped,
  // timed out) so it can never make the server fetch an internal address.
  let videoBytes: Uint8Array;
  try {
    videoBytes = await fetchPublicVideoBytes(videoUrl, {
      fetchImpl: deps.fetchImpl,
      resolveHost: deps.resolveHost,
    });
  } catch (error) {
    throw new TikTokApiError(
      502,
      error instanceof Error ? error.message : "Could not download the video to upload",
    );
  }
  // Mandatory first step: ask TikTok what this creator may post with.
  // Prefer the public value on an audited account; otherwise use the
  // first option TikTok offers (SELF_ONLY on an unaudited client).
  const creatorInfo = await queryCreatorInfo({ ...deps, config });
  const privacyLevel = creatorInfo.privacyLevelOptions.includes("PUBLIC_TO_EVERYONE")
    ? "PUBLIC_TO_EVERYONE"
    : creatorInfo.privacyLevelOptions[0];
  if (!privacyLevel) {
    throw new TikTokApiError(502, "TikTok returned no privacy level options");
  }
  const { publishId, uploadUrl } = await initVideoPublish(title, videoBytes.byteLength, {
    ...deps,
    config,
    privacyLevel,
  });
  await uploadVideoBytes(uploadUrl, videoBytes, { ...deps, config });
  const pollDelayMs = deps.pollDelayMs ?? 5000;
  const maxPolls = deps.maxPolls ?? 24;
  for (let attempt = 0; attempt < maxPolls; attempt++) {
    const status = await fetchPublishStatus(publishId, { ...deps, config });
    if (status === "PUBLISHED") return { publishId };
    if (status === "FAILED") {
      throw new TikTokApiError(502, "TikTok failed to publish the video");
    }
    if (attempt < maxPolls - 1 && pollDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, pollDelayMs));
    }
  }
  throw new TikTokApiError(502, "TikTok did not finish publishing the video in time");
}
