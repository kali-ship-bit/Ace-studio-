/**
 * Facebook Page video posting (Phase F). Server-side only.
 *
 * Graph API (v21.0): POST /{page-id}/videos with the video's public URL
 * and a description. Returns the published video id. The Page access token
 * must come from a Page the app's Meta app manages, with the
 * pages_manage_posts permission granted.
 *
 * The video MUST be at a publicly reachable URL (for example a Supabase
 * Storage signed URL for the finished job output) — Meta's servers fetch
 * it themselves, so a localhost or private URL will not work.
 *
 * Gating: every call needs FACEBOOK_PAGE_ID and FACEBOOK_PAGE_ACCESS_TOKEN.
 * When either is missing the call throws a clear "not configured" error
 * naming the missing vars, and never touches the network. Values arrive
 * as function arguments and are never logged, stored, or returned.
 */

import { timedFetch } from "./download";
import { resolveEnvConfig, sanitiseProviderMessage } from "./provider";

export const FACEBOOK_GRAPH_API_BASE = "https://graph.facebook.com/v21.0";

export interface FacebookConfig {
  pageId: string;
  pageAccessToken: string;
}

export interface FacebookDeps {
  fetchImpl?: typeof fetch;
  /** Test/route-supplied config. When omitted, reads FACEBOOK_* from the server env. */
  config?: FacebookConfig | undefined;
}

export class FacebookNotConfiguredError extends Error {
  missing: string[];
  constructor(missing: string[]) {
    super(`Facebook is not connected yet — set ${missing.join(" and ")}`);
    this.name = "FacebookNotConfiguredError";
    this.missing = missing;
  }
}

export class FacebookApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "FacebookApiError";
    this.status = status;
  }
}

function resolveConfig(deps: FacebookDeps): FacebookConfig {
  if (deps.config) return deps.config;
  const values = resolveEnvConfig(
    ["FACEBOOK_PAGE_ID", "FACEBOOK_PAGE_ACCESS_TOKEN"],
    (missing) => new FacebookNotConfiguredError(missing),
  );
  return {
    pageId: values["FACEBOOK_PAGE_ID"] as string,
    pageAccessToken: values["FACEBOOK_PAGE_ACCESS_TOKEN"] as string,
  };
}

function sanitiseFacebookError(status: number, bodyText: string): FacebookApiError {
  return new FacebookApiError(status, sanitiseProviderMessage("Facebook", status, bodyText));
}

/**
 * Publish a video to the Page. Returns the published video id.
 */
export async function publishPageVideo(
  videoUrl: string,
  description: string,
  deps: FacebookDeps = {},
): Promise<string> {
  const config = resolveConfig(deps);
  const fetchImpl = deps.fetchImpl ?? fetch;
  const response = await timedFetch(
    fetchImpl,
    `${FACEBOOK_GRAPH_API_BASE}/${config.pageId}/videos`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_url: videoUrl,
        description,
        access_token: config.pageAccessToken,
      }),
    },
  );
  if (!response.ok) {
    throw sanitiseFacebookError(response.status, await response.text());
  }
  const data = (await response.json()) as { id?: unknown };
  if (typeof data.id !== "string" || !data.id) {
    throw new FacebookApiError(502, "Facebook returned no video id");
  }
  return data.id;
}
