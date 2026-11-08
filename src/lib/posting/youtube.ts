/**
 * YouTube posting (Phase F). Server-side only.
 *
 * YouTube Data API v3 resumable-upload flow:
 *   1. refreshAccessToken — POST oauth2.googleapis.com/token with the
 *      stored refresh token (grant_type "refresh_token"). Returns a
 *      short-lived access token. The refresh token itself never leaves
 *      the server and is never logged or returned.
 *   2. createUploadSession — POST
 *      www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable
 *      &part=snippet,status with the video metadata
 *      ({snippet: {title, description, tags}, status:
 *      {privacyStatus: "public"}}). Returns the resumable session URL
 *      from the Location response header.
 *   3. uploadVideoBytes — PUT the video bytes to the session URL.
 *      Returns the uploaded video id.
 *
 * Gating: every call needs YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET and
 * YOUTUBE_REFRESH_TOKEN. When any is missing the call throws a clear
 * "not configured" error naming the missing vars, and never touches the
 * network. Values arrive as function arguments and are never logged,
 * stored, or returned.
 */

import {
  assertUploadUrl,
  fetchPublicVideoBytes,
  timedFetch,
  YOUTUBE_UPLOAD_HOST_SUFFIXES,
  type ResolveHost,
} from "./download";
import { resolveEnvConfig, sanitiseProviderMessage } from "./provider";

export const YOUTUBE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const YOUTUBE_UPLOAD_BASE =
  "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";

export interface YouTubeConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface YouTubeDeps {
  fetchImpl?: typeof fetch;
  /** Test/route-supplied config. When omitted, reads YOUTUBE_* from the server env. */
  config?: YouTubeConfig | undefined;
  /** Host resolver for the SSRF check on the video URL (tests inject a fake). */
  resolveHost?: ResolveHost;
}

export class YouTubeNotConfiguredError extends Error {
  missing: string[];
  constructor(missing: string[]) {
    super(`YouTube is not connected yet — set ${missing.join(" and ")}`);
    this.name = "YouTubeNotConfiguredError";
    this.missing = missing;
  }
}

export class YouTubeApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "YouTubeApiError";
    this.status = status;
  }
}

function resolveConfig(deps: YouTubeDeps): YouTubeConfig {
  if (deps.config) return deps.config;
  const values = resolveEnvConfig(
    ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "YOUTUBE_REFRESH_TOKEN"],
    (missing) => new YouTubeNotConfiguredError(missing),
  );
  return {
    clientId: values["YOUTUBE_CLIENT_ID"] as string,
    clientSecret: values["YOUTUBE_CLIENT_SECRET"] as string,
    refreshToken: values["YOUTUBE_REFRESH_TOKEN"] as string,
  };
}

/** YouTube's detail is error.message, or error_description when there is no error object. */
function youTubeDetail(parsed: unknown): string {
  if (!parsed || typeof parsed !== "object") return "";
  const p = parsed as { error?: unknown; error_description?: unknown };
  if (typeof p.error === "object" && p.error !== null) {
    const message = (p.error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return typeof p.error_description === "string" ? p.error_description : "";
}

function sanitiseYouTubeError(status: number, bodyText: string): YouTubeApiError {
  return new YouTubeApiError(
    status,
    sanitiseProviderMessage("YouTube", status, bodyText, youTubeDetail),
  );
}

/**
 * Step 1: exchange the stored refresh token for a short-lived access
 * token. The access token is returned to the caller for the upload calls
 * only — it is never written to a Job, a log, or a response.
 */
export async function refreshAccessToken(deps: YouTubeDeps = {}): Promise<string> {
  const config = resolveConfig(deps);
  const fetchImpl = deps.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
    grant_type: "refresh_token",
  });
  const response = await timedFetch(fetchImpl, YOUTUBE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!response.ok) {
    throw sanitiseYouTubeError(response.status, await response.text());
  }
  const data = (await response.json()) as { access_token?: unknown };
  if (typeof data.access_token !== "string" || !data.access_token) {
    throw new YouTubeApiError(502, "YouTube returned no access token");
  }
  return data.access_token;
}

export interface YouTubeMetadata {
  title: string;
  description: string;
  tags: string[];
}

/**
 * Step 2: create the resumable upload session. Returns the session URL
 * from the Location header.
 */
export async function createUploadSession(
  metadata: YouTubeMetadata,
  accessToken: string,
  videoBytesLength: number,
  deps: YouTubeDeps = {},
): Promise<string> {
  resolveConfig(deps);
  const fetchImpl = deps.fetchImpl ?? fetch;
  const response = await timedFetch(fetchImpl, YOUTUBE_UPLOAD_BASE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=utf-8",
      "X-Upload-Content-Length": String(videoBytesLength),
      "X-Upload-Content-Type": "video/mp4",
    },
    body: JSON.stringify({
      snippet: {
        title: metadata.title,
        description: metadata.description,
        tags: metadata.tags,
      },
      status: { privacyStatus: "public" },
    }),
  });
  if (!response.ok) {
    throw sanitiseYouTubeError(response.status, await response.text());
  }
  const sessionUrl = response.headers.get("location");
  if (!sessionUrl) {
    throw new YouTubeApiError(502, "YouTube returned no upload session URL");
  }
  // The session URL comes from YouTube's response: it must point at
  // Google's upload host, never at an attacker's server (the upload
  // carries a Bearer token with it).
  try {
    assertUploadUrl(sessionUrl, YOUTUBE_UPLOAD_HOST_SUFFIXES, "YouTube");
  } catch (error) {
    throw new YouTubeApiError(502, error instanceof Error ? error.message : "Bad upload URL");
  }
  return sessionUrl;
}

/** Step 3: PUT the video bytes to the session URL. Returns the video id. */
export async function uploadVideoBytes(
  sessionUrl: string,
  videoBytes: Uint8Array,
  accessToken: string,
  deps: YouTubeDeps = {},
): Promise<string> {
  resolveConfig(deps);
  // Defensive re-check: the session URL carries a Bearer token, so it
  // must be a Google upload host even if the caller built it elsewhere.
  try {
    assertUploadUrl(sessionUrl, YOUTUBE_UPLOAD_HOST_SUFFIXES, "YouTube");
  } catch (error) {
    throw new YouTubeApiError(502, error instanceof Error ? error.message : "Bad upload URL");
  }
  const fetchImpl = deps.fetchImpl ?? fetch;
  const response = await timedFetch(fetchImpl, sessionUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "video/mp4",
      "Content-Length": String(videoBytes.byteLength),
    },
    body: videoBytes as unknown as BodyInit,
  });
  if (!response.ok) {
    throw sanitiseYouTubeError(response.status, await response.text());
  }
  const data = (await response.json()) as { id?: unknown };
  if (typeof data.id !== "string" || !data.id) {
    throw new YouTubeApiError(502, "YouTube returned no video id");
  }
  return data.id;
}

export interface PublishYouTubeResult {
  videoId: string;
  watchUrl: string;
}

/**
 * Full YouTube flow: fetch the video bytes from its public URL, refresh
 * the access token, create the resumable session, then upload the bytes.
 */
export async function publishYouTubeVideo(
  videoUrl: string,
  metadata: YouTubeMetadata,
  deps: YouTubeDeps = {},
): Promise<PublishYouTubeResult> {
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
    throw new YouTubeApiError(
      502,
      error instanceof Error ? error.message : "Could not download the video to upload",
    );
  }
  const accessToken = await refreshAccessToken({ ...deps, config });
  const sessionUrl = await createUploadSession(metadata, accessToken, videoBytes.byteLength, {
    ...deps,
    config,
  });
  const videoId = await uploadVideoBytes(sessionUrl, videoBytes, accessToken, {
    ...deps,
    config,
  });
  return { videoId, watchUrl: `https://www.youtube.com/watch?v=${videoId}` };
}
