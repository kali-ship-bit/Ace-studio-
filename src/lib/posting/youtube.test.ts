import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createUploadSession,
  publishYouTubeVideo,
  refreshAccessToken,
  uploadVideoBytes,
  type YouTubeConfig,
} from "./youtube";

const CONFIG: YouTubeConfig = {
  clientId: "test-yt-client-id",
  clientSecret: "test-yt-client-secret",
  refreshToken: "test-yt-refresh-token",
};

const VIDEO_URL = "https://example.com/video.mp4";
const VIDEO_BYTES = new Uint8Array([9, 8, 7, 6]);
const SESSION_URL = "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=session-1";

interface Call {
  url: string;
  method: string;
  body: string;
}

function youtubeFetch(calls: Call[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === "string" ? init.body : "";
    calls.push({ url, method: init?.method ?? "GET", body });
    if (url === VIDEO_URL) {
      return new Response(VIDEO_BYTES as unknown as BodyInit, { status: 200 });
    }
    if (url === "https://oauth2.googleapis.com/token") {
      return new Response(JSON.stringify({ access_token: "test-yt-access-token" }), {
        status: 200,
      });
    }
    // The session URL is itself a googleapis upload URL, so it must be
    // matched BEFORE the session-creation branch below.
    if (url === SESSION_URL) {
      return new Response(JSON.stringify({ id: "test-yt-video-id" }), { status: 200 });
    }
    if (url.startsWith("https://www.googleapis.com/upload/youtube/v3/videos")) {
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { location: SESSION_URL },
      });
    }
    return new Response(JSON.stringify({ error: { message: "not found" } }), { status: 404 });
  }) as typeof fetch;
}

describe("youtube posting", () => {
  beforeEach(() => {
    delete process.env["YOUTUBE_CLIENT_ID"];
    delete process.env["YOUTUBE_CLIENT_SECRET"];
    delete process.env["YOUTUBE_REFRESH_TOKEN"];
  });
  afterEach(() => {
    delete process.env["YOUTUBE_CLIENT_ID"];
    delete process.env["YOUTUBE_CLIENT_SECRET"];
    delete process.env["YOUTUBE_REFRESH_TOKEN"];
  });

  it("refreshes the access token with the refresh-token grant", async () => {
    const calls: Call[] = [];
    const token = await refreshAccessToken({ fetchImpl: youtubeFetch(calls), config: CONFIG });
    expect(token).toBe("test-yt-access-token");
    expect(calls[0]?.url).toBe("https://oauth2.googleapis.com/token");
    expect(calls[0]?.method).toBe("POST");
    const params = new URLSearchParams(calls[0]?.body ?? "");
    expect(params.get("grant_type")).toBe("refresh_token");
    expect(params.get("client_id")).toBe("test-yt-client-id");
    expect(params.get("refresh_token")).toBe("test-yt-refresh-token");
  });

  it("creates a resumable session with snippet/status metadata and uploads the bytes", async () => {
    const calls: Call[] = [];
    const fetchImpl = youtubeFetch(calls);
    const sessionUrl = await createUploadSession(
      { title: "My title", description: "My caption", tags: [] },
      "test-yt-access-token",
      VIDEO_BYTES.byteLength,
      { fetchImpl, config: CONFIG },
    );
    expect(sessionUrl).toBe(SESSION_URL);
    expect(calls[0]?.url).toBe(
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    );
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      snippet: { title: "My title", description: "My caption", tags: [] },
      status: { privacyStatus: "public" },
    });
    const videoId = await uploadVideoBytes(SESSION_URL, VIDEO_BYTES, "test-yt-access-token", {
      fetchImpl,
      config: CONFIG,
    });
    expect(videoId).toBe("test-yt-video-id");
    expect(calls[1]?.method).toBe("PUT");
  });

  it("publishYouTubeVideo runs token -> session -> upload end to end", async () => {
    const calls: Call[] = [];
    const result = await publishYouTubeVideo(
      VIDEO_URL,
      { title: "My title", description: "My caption", tags: [] },
      {
        fetchImpl: youtubeFetch(calls),
        config: CONFIG,
        // Fake DNS: the test must not depend on the real network.
        resolveHost: async () => ["93.184.216.34"],
      },
    );
    expect(result).toEqual({
      videoId: "test-yt-video-id",
      watchUrl: "https://www.youtube.com/watch?v=test-yt-video-id",
    });
    expect(calls.map((c) => c.url)).toEqual([
      VIDEO_URL,
      "https://oauth2.googleapis.com/token",
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
      SESSION_URL,
    ]);
  });

  it("fails without config, naming the missing vars and making no request", async () => {
    const calls: Call[] = [];
    await expect(refreshAccessToken({ fetchImpl: youtubeFetch(calls) })).rejects.toThrow(
      "YouTube is not connected yet — set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET and YOUTUBE_REFRESH_TOKEN",
    );
    expect(calls).toHaveLength(0);
  });
});
