import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkContainerStatus,
  createMediaContainer,
  publishContainer,
  publishReel,
  type InstagramConfig,
} from "./instagram";

const CONFIG: InstagramConfig = {
  igUserId: "test-ig-user-id",
  igAccessToken: "test-ig-access-token",
};

interface Call {
  url: string;
  method: string;
  body: string;
  /** Authorization header, when the call sent one. */
  auth?: string | undefined;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status });
}

/** Mock fetch that plays the container -> FINISHED -> publish flow. */
function instagramFetch(calls: Call[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === "string" ? init.body : "";
    const headers = new Headers(init?.headers);
    calls.push({
      url,
      method: init?.method ?? "GET",
      body,
      auth: headers.get("authorization") ?? undefined,
    });
    if (url.endsWith(`/${CONFIG.igUserId}/media`) && init?.method === "POST") {
      return jsonResponse({ id: "test-container-id" });
    }
    if (url.includes("/test-container-id?fields=status_code")) {
      return jsonResponse({ status_code: "FINISHED" });
    }
    if (url.endsWith(`/${CONFIG.igUserId}/media_publish`) && init?.method === "POST") {
      return jsonResponse({ id: "test-media-id" });
    }
    return jsonResponse({ error: { message: "not found" } }, 404);
  }) as typeof fetch;
}

describe("instagram posting", () => {
  beforeEach(() => {
    delete process.env["IG_USER_ID"];
    delete process.env["IG_ACCESS_TOKEN"];
  });
  afterEach(() => {
    delete process.env["IG_USER_ID"];
    delete process.env["IG_ACCESS_TOKEN"];
  });

  it("creates a container, checks status, and publishes with the exact Graph API calls", async () => {
    const calls: Call[] = [];
    const fetchImpl = instagramFetch(calls);

    const containerId = await createMediaContainer("https://example.com/video.mp4", "Hello", {
      fetchImpl,
      config: CONFIG,
    });
    expect(containerId).toBe("test-container-id");
    expect(calls[0]).toEqual({
      url: "https://graph.facebook.com/v21.0/test-ig-user-id/media",
      method: "POST",
      body: JSON.stringify({
        video_url: "https://example.com/video.mp4",
        caption: "Hello",
        media_type: "REELS",
        access_token: "test-ig-access-token",
      }),
    });

    const status = await checkContainerStatus(containerId, { fetchImpl, config: CONFIG });
    expect(status).toBe("FINISHED");
    // The token travels in the Authorization header now, never in the URL.
    expect(calls[1]?.url).toBe(
      "https://graph.facebook.com/v21.0/test-container-id?fields=status_code",
    );
    expect(calls[1]?.url).not.toContain("access_token");
    expect(calls[1]?.auth).toBe("Bearer test-ig-access-token");

    const mediaId = await publishContainer(containerId, { fetchImpl, config: CONFIG });
    expect(mediaId).toBe("test-media-id");
    expect(calls[2]).toEqual({
      url: "https://graph.facebook.com/v21.0/test-ig-user-id/media_publish",
      method: "POST",
      body: JSON.stringify({
        creation_id: "test-container-id",
        access_token: "test-ig-access-token",
      }),
    });
  });

  it("publishReel runs the full flow end to end", async () => {
    const calls: Call[] = [];
    const result = await publishReel("https://example.com/video.mp4", "Hello", {
      fetchImpl: instagramFetch(calls),
      config: CONFIG,
      pollDelayMs: 0,
    });
    expect(result).toEqual({ containerId: "test-container-id", mediaId: "test-media-id" });
    expect(calls).toHaveLength(3);
  });

  it("publishReel fails fast on an EXPIRED container instead of polling the full window", async () => {
    const calls: Call[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const body = typeof init?.body === "string" ? init.body : "";
      calls.push({ url, method: init?.method ?? "GET", body });
      if (url.endsWith(`/${CONFIG.igUserId}/media`) && init?.method === "POST") {
        return jsonResponse({ id: "test-container-id" });
      }
      if (url.includes("/test-container-id?fields=status_code")) {
        return jsonResponse({ status_code: "EXPIRED" });
      }
      return jsonResponse({ error: { message: "not found" } }, 404);
    }) as typeof fetch;
    await expect(
      publishReel("https://example.com/video.mp4", "Hello", {
        fetchImpl,
        config: CONFIG,
        pollDelayMs: 0,
      }),
    ).rejects.toThrow("Instagram container expired before it finished");
    // Create + exactly one status check: no pointless polling.
    expect(calls).toHaveLength(2);
  });

  it("fails without config, naming the missing vars and making no request", async () => {
    const calls: Call[] = [];
    const fetchImpl = instagramFetch(calls);
    await expect(
      createMediaContainer("https://example.com/video.mp4", "Hello", { fetchImpl }),
    ).rejects.toThrow("Instagram is not connected yet — set IG_USER_ID and IG_ACCESS_TOKEN");
    expect(calls).toHaveLength(0);
  });

  it("surfaces a Graph API error without leaking anything else", async () => {
    const failing = (async () =>
      jsonResponse({ error: { message: "Invalid OAuth access token" } }, 400)) as typeof fetch;
    await expect(
      createMediaContainer("https://example.com/video.mp4", "Hello", {
        fetchImpl: failing,
        config: CONFIG,
      }),
    ).rejects.toThrow("Instagram: Invalid OAuth access token");
  });
});
