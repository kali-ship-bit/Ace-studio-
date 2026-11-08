import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handlePostingApi, type PostingApiDeps } from "./api";
import { createTestJobStore } from "../jobs/store";
import type { JobStore } from "../jobs/types";
import { CSRF_COOKIE_NAME, issueCsrfToken } from "../security/csrf";
import { MemoryAttemptStore, POSTING_MAX_PER_MINUTE } from "../security/rate-limit";
import { resetDevVarsCache } from "../jobs/env";

const VIDEO_URL = "https://example.com/video.mp4";

function request(path: string, init?: RequestInit): Request {
  return new Request(`http://localhost${path}`, init);
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

/** A POST request with a matching CSRF cookie + _csrf body field. */
function csrfPost(path: string, body: Record<string, unknown>): Request {
  const token = issueCsrfToken();
  return request(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `${CSRF_COOKIE_NAME}=${token}`,
    },
    body: JSON.stringify({ ...body, _csrf: token }),
  });
}

/** Mock fetch that plays the Instagram container -> FINISHED -> publish flow. */
const instagramFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith("/test-ig-user-id/media") && init?.method === "POST") {
    return new Response(JSON.stringify({ id: "test-container-id" }), { status: 200 });
  }
  if (url.includes("/test-container-id?fields=status_code")) {
    return new Response(JSON.stringify({ status_code: "FINISHED" }), { status: 200 });
  }
  if (url.endsWith("/test-ig-user-id/media_publish") && init?.method === "POST") {
    return new Response(JSON.stringify({ id: "test-media-id" }), { status: 200 });
  }
  return new Response(JSON.stringify({ error: { message: "not found" } }), { status: 404 });
}) as typeof fetch;

async function waitForTerminal(
  store: JobStore,
  jobId: string,
  timeoutMs = 5000,
): Promise<{ status: string; detail: string | undefined; error: string | undefined }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = await store.get(jobId);
    if (job && (job.status === "done" || job.status === "failed")) {
      return { status: job.status, detail: job.detail, error: job.error };
    }
    if (Date.now() > deadline) throw new Error(`Job ${jobId} did not finish in time`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("posting API routes", () => {
  let dir = "";
  let store: JobStore;
  let deps: PostingApiDeps;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ace-studio-post-"));
    store = createTestJobStore(dir);
    deps = { store, fetchImpl: instagramFetch, attemptStore: new MemoryAttemptStore() };
    resetDevVarsCache();
    process.env["IG_USER_ID"] = "test-ig-user-id";
    process.env["IG_ACCESS_TOKEN"] = "test-ig-access-token";
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    delete process.env["IG_USER_ID"];
    delete process.env["IG_ACCESS_TOKEN"];
    delete process.env["TIKTOK_CLIENT_KEY"];
    delete process.env["TIKTOK_CLIENT_SECRET"];
    delete process.env["TIKTOK_ACCESS_TOKEN"];
    resetDevVarsCache();
  });

  it("returns null for paths outside /api/post", async () => {
    expect(await handlePostingApi(request("/"), deps)).toBeNull();
    expect(await handlePostingApi(request("/api/jobs"), deps)).toBeNull();
  });

  it("GET /api/post/platforms lists all 10 with configured/missing and no secret values", async () => {
    const res = await handlePostingApi(request("/api/post/platforms"), deps);
    expect(res?.status).toBe(200);
    const body = await json(res as Response);
    const platforms = body["platforms"] as {
      id: string;
      configured: boolean;
      missing: string[];
    }[];
    expect(platforms).toHaveLength(10);
    const instagram = platforms.find((p) => p.id === "instagram");
    expect(instagram).toMatchObject({ configured: true, missing: [] });
    const tiktok = platforms.find((p) => p.id === "tiktok");
    expect(tiktok).toMatchObject({
      configured: false,
      missing: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "TIKTOK_ACCESS_TOKEN"],
    });
    expect(JSON.stringify(body)).not.toContain("test-ig-access-token");
    expect(JSON.stringify(body)).not.toContain("test-ig-user-id");
  });

  it("POST /api/post/instagram creates a post job and publishes it", async () => {
    const created = await handlePostingApi(
      csrfPost("/api/post/instagram", { videoUrl: VIDEO_URL, caption: "Hello #test" }),
      deps,
    );
    expect(created?.status).toBe(202);
    const createdBody = await json(created as Response);
    const job = createdBody["job"] as { id: string; kind: string; label: string; status: string };
    expect(job.kind).toBe("post");
    expect(job.label).toBe("Post to Instagram");
    expect(job.status).toBe("queued");
    // The create response issues the anonymous owner cookie; the poll
    // carries it back, like a browser would.
    const ownerCookie =
      created?.headers
        .getSetCookie()
        .find((c) => c.startsWith("rk_anon="))
        ?.split(";")[0] ?? "";

    const terminal = await waitForTerminal(store, job.id);
    expect(terminal.status).toBe("done");
    expect(terminal.detail).toContain("test-media-id");

    const polled = await handlePostingApi(
      request(`/api/post/jobs/${job.id}`, { headers: { cookie: ownerCookie } }),
      deps,
    );
    expect(polled?.status).toBe(200);
    const polledBody = await json(polled as Response);
    expect((polledBody["job"] as { status: string }).status).toBe("done");
  });

  it("GET /api/post/jobs/:id returns 404 for a missing job", async () => {
    const res = await handlePostingApi(request("/api/post/jobs/job_doesnotexist123"), deps);
    expect(res?.status).toBe(404);
  });

  it("POST with an unknown platform returns 400", async () => {
    const res = await handlePostingApi(
      csrfPost("/api/post/myspace", { videoUrl: VIDEO_URL, caption: "Hi" }),
      deps,
    );
    expect(res?.status).toBe(400);
    expect((await json(res as Response))["error"]).toBe("unknown_platform");
  });

  it("POST with an http video URL returns 400", async () => {
    const res = await handlePostingApi(
      csrfPost("/api/post/instagram", {
        videoUrl: "http://example.com/video.mp4",
        caption: "Hi",
      }),
      deps,
    );
    expect(res?.status).toBe(400);
    expect((await json(res as Response))["error"]).toBe("bad_video_url");
  });

  it("POST with a caption over 2200 chars returns 400", async () => {
    const res = await handlePostingApi(
      csrfPost("/api/post/instagram", { videoUrl: VIDEO_URL, caption: "x".repeat(2201) }),
      deps,
    );
    expect(res?.status).toBe(400);
    expect((await json(res as Response))["error"]).toBe("caption_too_long");
  });

  it("POST with a title over 100 chars returns 400", async () => {
    const res = await handlePostingApi(
      csrfPost("/api/post/instagram", {
        videoUrl: VIDEO_URL,
        caption: "Hi",
        title: "t".repeat(101),
      }),
      deps,
    );
    expect(res?.status).toBe(400);
    expect((await json(res as Response))["error"]).toBe("title_too_long");
  });

  it("POST without a CSRF token returns 403 and creates no job", async () => {
    const res = await handlePostingApi(
      request("/api/post/instagram", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoUrl: VIDEO_URL, caption: "Hi" }),
      }),
      deps,
    );
    expect(res?.status).toBe(403);
    expect((await json(res as Response))["error"]).toBe("csrf_invalid");
    expect(await store.list()).toHaveLength(0);
  });

  it("POST with no platform configured fails the job naming the missing vars", async () => {
    delete process.env["IG_USER_ID"];
    delete process.env["IG_ACCESS_TOKEN"];
    const created = await handlePostingApi(
      csrfPost("/api/post/instagram", { videoUrl: VIDEO_URL, caption: "Hi" }),
      deps,
    );
    expect(created?.status).toBe(202);
    const job = (await json(created as Response))["job"] as { id: string };
    const terminal = await waitForTerminal(store, job.id);
    expect(terminal.status).toBe("failed");
    expect(terminal.error).toContain("IG_USER_ID");
    expect(terminal.error).toContain("IG_ACCESS_TOKEN");
  });

  it("POST to a checklist-only platform fails the job with the checklist summary", async () => {
    const created = await handlePostingApi(
      csrfPost("/api/post/kick", { videoUrl: VIDEO_URL, caption: "Hi" }),
      deps,
    );
    expect(created?.status).toBe(202);
    const job = (await json(created as Response))["job"] as { id: string };
    const terminal = await waitForTerminal(store, job.id);
    expect(terminal.status).toBe("failed");
    expect(terminal.error).toMatch(/no public upload API/i);
  });

  it("rate-limits posting: the 11th post in a minute is 429 (Phase C)", async () => {
    let last: Response | null = null;
    for (let i = 0; i < POSTING_MAX_PER_MINUTE + 1; i++) {
      last = await handlePostingApi(
        csrfPost("/api/post/instagram", { videoUrl: VIDEO_URL, caption: "Hi" }),
        deps,
      );
    }
    expect(last?.status).toBe(429);
    expect((await json(last as Response))["error"]).toBe("too_many_requests");
  });
});
