import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  fetchPublishStatus,
  initVideoPublish,
  publishTikTokVideo,
  uploadVideoBytes,
  type TikTokConfig,
} from "./tiktok";

const CONFIG: TikTokConfig = {
  clientKey: "test-tiktok-client-key",
  clientSecret: "test-tiktok-client-secret",
  accessToken: "test-tiktok-access-token",
};

const VIDEO_URL = "https://example.com/video.mp4";
const VIDEO_BYTES = new Uint8Array([1, 2, 3, 4, 5]);

interface Call {
  url: string;
  method: string;
  body: string;
}

function tiktokFetch(calls: Call[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    let body = "";
    if (typeof init?.body === "string") body = init.body;
    calls.push({ url, method: init?.method ?? "GET", body });
    if (url === VIDEO_URL) {
      return new Response(VIDEO_BYTES as unknown as BodyInit, { status: 200 });
    }
    if (url.endsWith("/post/publish/creator_info/query/")) {
      return new Response(
        JSON.stringify({
          data: {
            creator_nickname: "test-creator",
            privacy_level_options: ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "SELF_ONLY"],
            max_video_post_duration_sec: 600,
          },
        }),
        { status: 200 },
      );
    }
    if (url.endsWith("/post/publish/video/init/")) {
      return new Response(
        JSON.stringify({
          data: {
            publish_id: "test-publish-id",
            upload_url: "https://open-upload.tiktokapis.com/upload/tk-1",
          },
        }),
        { status: 200 },
      );
    }
    if (url === "https://open-upload.tiktokapis.com/upload/tk-1") {
      return new Response("", { status: 201 });
    }
    if (url.endsWith("/post/publish/status/fetch/")) {
      return new Response(JSON.stringify({ data: { status: "PUBLISHED" } }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: { message: "not found" } }), { status: 404 });
  }) as typeof fetch;
}

describe("tiktok posting", () => {
  beforeEach(() => {
    delete process.env["TIKTOK_CLIENT_KEY"];
    delete process.env["TIKTOK_CLIENT_SECRET"];
    delete process.env["TIKTOK_ACCESS_TOKEN"];
  });
  afterEach(() => {
    delete process.env["TIKTOK_CLIENT_KEY"];
    delete process.env["TIKTOK_CLIENT_SECRET"];
    delete process.env["TIKTOK_ACCESS_TOKEN"];
  });

  it("initialises with the documented post_info/source_info shape", async () => {
    const calls: Call[] = [];
    const result = await initVideoPublish("My title", VIDEO_BYTES.byteLength, {
      fetchImpl: tiktokFetch(calls),
      config: CONFIG,
    });
    expect(result).toEqual({
      publishId: "test-publish-id",
      uploadUrl: "https://open-upload.tiktokapis.com/upload/tk-1",
    });
    expect(calls[0]?.url).toBe("https://open.tiktokapis.com/v2/post/publish/video/init/");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      post_info: {
        title: "My title",
        privacy_level: "PUBLIC_TO_EVERYONE",
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
        video_cover_timestamp_ms: 1000,
      },
      source_info: {
        source: "FILE_UPLOAD",
        video_size: 5,
        chunk_size: 5,
        total_chunk_count: 1,
      },
    });
  });

  it("uploads bytes to the returned upload URL and confirms PUBLISHED", async () => {
    const calls: Call[] = [];
    const fetchImpl = tiktokFetch(calls);
    await uploadVideoBytes("https://open-upload.tiktokapis.com/upload/tk-1", VIDEO_BYTES, {
      fetchImpl,
      config: CONFIG,
    });
    expect(calls[0]?.method).toBe("PUT");
    const status = await fetchPublishStatus("test-publish-id", { fetchImpl, config: CONFIG });
    expect(status).toBe("PUBLISHED");
  });

  it("publishTikTokVideo runs init -> upload -> status end to end", async () => {
    const calls: Call[] = [];
    const result = await publishTikTokVideo(VIDEO_URL, "My title", {
      fetchImpl: tiktokFetch(calls),
      config: CONFIG,
      pollDelayMs: 0,
      // Fake DNS: the test must not depend on the real network.
      resolveHost: async () => ["93.184.216.34"],
    });
    expect(result).toEqual({ publishId: "test-publish-id" });
    expect(calls.map((c) => c.url)).toEqual([
      VIDEO_URL,
      "https://open.tiktokapis.com/v2/post/publish/creator_info/query/",
      "https://open.tiktokapis.com/v2/post/publish/video/init/",
      "https://open-upload.tiktokapis.com/upload/tk-1",
      "https://open.tiktokapis.com/v2/post/publish/status/fetch/",
    ]);
  });

  it("publishTikTokVideo falls back to SELF_ONLY when TikTok offers nothing public", async () => {
    const calls: Call[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      let body = "";
      if (typeof init?.body === "string") body = init.body;
      calls.push({ url, method: init?.method ?? "GET", body });
      if (url === VIDEO_URL) {
        return new Response(VIDEO_BYTES as unknown as BodyInit, { status: 200 });
      }
      if (url.endsWith("/post/publish/creator_info/query/")) {
        // Unaudited client: only private posting is allowed.
        return new Response(JSON.stringify({ data: { privacy_level_options: ["SELF_ONLY"] } }), {
          status: 200,
        });
      }
      if (url.endsWith("/post/publish/video/init/")) {
        return new Response(
          JSON.stringify({
            data: {
              publish_id: "test-publish-id",
              upload_url: "https://open-upload.tiktokapis.com/upload/tk-1",
            },
          }),
          { status: 200 },
        );
      }
      if (url === "https://open-upload.tiktokapis.com/upload/tk-1") {
        return new Response("", { status: 201 });
      }
      if (url.endsWith("/post/publish/status/fetch/")) {
        return new Response(JSON.stringify({ data: { status: "PUBLISHED" } }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: { message: "not found" } }), { status: 404 });
    }) as typeof fetch;
    const result = await publishTikTokVideo(VIDEO_URL, "My title", {
      fetchImpl,
      config: CONFIG,
      pollDelayMs: 0,
      resolveHost: async () => ["93.184.216.34"],
    });
    expect(result).toEqual({ publishId: "test-publish-id" });
    const initCall = calls.find((c) => c.url.endsWith("/post/publish/video/init/"));
    expect(JSON.parse(initCall?.body ?? "{}").post_info.privacy_level).toBe("SELF_ONLY");
  });

  it("fails without config, naming the missing vars and making no request", async () => {
    const calls: Call[] = [];
    await expect(
      initVideoPublish("My title", 5, { fetchImpl: tiktokFetch(calls) }),
    ).rejects.toThrow(
      "TikTok is not connected yet — set TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET and TIKTOK_ACCESS_TOKEN",
    );
    expect(calls).toHaveLength(0);
  });
});
