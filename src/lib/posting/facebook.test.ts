import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { publishPageVideo, type FacebookConfig } from "./facebook";

const CONFIG: FacebookConfig = {
  pageId: "test-page-id",
  pageAccessToken: "test-page-access-token",
};

describe("facebook posting", () => {
  beforeEach(() => {
    delete process.env["FACEBOOK_PAGE_ID"];
    delete process.env["FACEBOOK_PAGE_ACCESS_TOKEN"];
  });
  afterEach(() => {
    delete process.env["FACEBOOK_PAGE_ID"];
    delete process.env["FACEBOOK_PAGE_ACCESS_TOKEN"];
  });

  it("publishes a page video with the exact Graph API call", async () => {
    const calls: { url: string; method: string; body: string }[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : "",
      });
      return new Response(JSON.stringify({ id: "test-video-id" }), { status: 200 });
    }) as typeof fetch;

    const videoId = await publishPageVideo("https://example.com/video.mp4", "Hello", {
      fetchImpl,
      config: CONFIG,
    });
    expect(videoId).toBe("test-video-id");
    expect(calls).toEqual([
      {
        url: "https://graph.facebook.com/v21.0/test-page-id/videos",
        method: "POST",
        body: JSON.stringify({
          file_url: "https://example.com/video.mp4",
          description: "Hello",
          access_token: "test-page-access-token",
        }),
      },
    ]);
  });

  it("fails without config, naming the missing vars and making no request", async () => {
    const calls: unknown[] = [];
    const fetchImpl = (async () => {
      calls.push(1);
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    await expect(
      publishPageVideo("https://example.com/video.mp4", "Hello", { fetchImpl }),
    ).rejects.toThrow(
      "Facebook is not connected yet — set FACEBOOK_PAGE_ID and FACEBOOK_PAGE_ACCESS_TOKEN",
    );
    expect(calls).toHaveLength(0);
  });

  it("surfaces a Graph API error", async () => {
    const failing = (async () =>
      new Response(JSON.stringify({ error: { message: "Permissions error" } }), {
        status: 403,
      })) as typeof fetch;
    await expect(
      publishPageVideo("https://example.com/video.mp4", "Hello", {
        fetchImpl: failing,
        config: CONFIG,
      }),
    ).rejects.toThrow("Facebook: Permissions error");
  });
});
