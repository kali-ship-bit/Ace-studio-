import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleApiRequest, type ApiDeps } from "./api";
import { createTestJobStore } from "./store";
import { clearSessionVault } from "./byok";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "../security/csrf";
import { MemoryAttemptStore, NARRATE_MAX_PER_MINUTE } from "../security/rate-limit";

const FAKE_KEY = "test-key-placeholder";
const SESSION = "sess_testsession123";
const CSRF_TOKEN = "csrf-test-token-1234567890";

function request(path: string, init?: RequestInit): Request {
  // Mutating requests carry a valid CSRF token, like the pages send
  // (see fetchWithCsrf in src/lib/auth/session.ts). GETs need none.
  const method = (init?.method ?? "GET").toUpperCase();
  const headers = new Headers(init?.headers);
  if (method !== "GET" && method !== "HEAD") {
    headers.set("cookie", `${CSRF_COOKIE_NAME}=${CSRF_TOKEN}`);
    headers.set(CSRF_HEADER_NAME, CSRF_TOKEN);
  }
  return new Request(`http://localhost${path}`, { ...init, headers });
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

/** Carry the rk_anon cookie from a create response into later requests, like a browser would. */
function anonCookieFrom(res: Response | null): string {
  const setCookie = res?.headers.getSetCookie().find((c) => c.startsWith("rk_anon="));
  return setCookie?.split(";")[0] ?? "";
}

/** Mock fetch that accepts any Speechify key. */
const okFetch = (async (url: string | URL | Request) => {
  const target = String(url);
  if (target.includes("/v1/voices"))
    return new Response(
      JSON.stringify({ voices: [{ id: "elijah", display_name: "Elijah", locale: "en-NG" }] }),
      { status: 200 },
    );
  return new Response(JSON.stringify({ message: "not found" }), { status: 404 });
}) as typeof fetch;

describe("jobs API routes", () => {
  let dir = "";
  let deps: ApiDeps;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ace-studio-api-"));
    deps = {
      store: createTestJobStore(dir),
      fetchImpl: okFetch,
      attemptStore: new MemoryAttemptStore(),
    };
    clearSessionVault();
    delete process.env["SPEECHIFY_MOCK"];
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    delete process.env["SPEECHIFY_MOCK"];
  });

  it("returns null for non-API paths", async () => {
    expect(await handleApiRequest(request("/"), deps)).toBeNull();
    expect(await handleApiRequest(request("/create"), deps)).toBeNull();
  });

  it("rejects a state-changing request without a CSRF token (403)", async () => {
    const noCsrf = await handleApiRequest(
      new Request("http://localhost/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "demo", label: "No token" }),
      }),
      deps,
    );
    expect(noCsrf?.status).toBe(403);
    expect((await json(noCsrf as Response))["error"]).toBe("csrf_invalid");
  });

  it("runs a demo job end to end: create -> poll -> done -> download output", async () => {
    const created = await handleApiRequest(
      request("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "demo", label: "Demo job" }),
      }),
      deps,
    );
    expect(created?.status).toBe(201);
    const createdBody = await json(created as Response);
    const job = createdBody["job"] as { id: string; status: string };
    expect(job.status).toBe("queued");
    // The create response issues the anonymous owner cookie; the poll
    // and download carry it back, like a browser would.
    const ownerCookie = anonCookieFrom(created);
    expect(ownerCookie).toContain("rk_anon=");

    // The demo job transitions queued -> running -> done in ~1.4s.
    await new Promise((resolve) => setTimeout(resolve, 2200));
    const polled = await handleApiRequest(
      request(`/api/jobs/${job.id}`, { headers: { cookie: ownerCookie } }),
      deps,
    );
    const polledBody = await json(polled as Response);
    const done = polledBody["job"] as {
      status: string;
      progress: number;
      output?: { filename: string };
    };
    expect(done.status).toBe("done");
    expect(done.progress).toBe(100);
    expect(done.output?.filename).toBe("output.txt");

    const out = await handleApiRequest(
      request(`/api/jobs/${job.id}/output`, { headers: { cookie: ownerCookie } }),
      deps,
    );
    expect(out?.status).toBe(200);
    expect(out?.headers.get("content-type")).toBe("text/plain");
    expect(await (out as Response).text()).toContain("demo job");
  });

  it("a second anonymous visitor cannot list, read, or download another visitor's job", async () => {
    const created = await handleApiRequest(
      request("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "demo", label: "Someone else's job" }),
      }),
      deps,
    );
    expect(created?.status).toBe(201);
    const job = (await json(created as Response))["job"] as { id: string };
    const ownerCookie = anonCookieFrom(created);
    await new Promise((resolve) => setTimeout(resolve, 2200));

    // A different visitor (no cookie at all) sees nothing — not even
    // that the job exists.
    const strangerList = await handleApiRequest(request("/api/jobs"), deps);
    expect((await json(strangerList as Response))["jobs"]).toEqual([]);
    const strangerGet = await handleApiRequest(request(`/api/jobs/${job.id}`), deps);
    expect(strangerGet?.status).toBe(404);
    const strangerOut = await handleApiRequest(request(`/api/jobs/${job.id}/output`), deps);
    expect(strangerOut?.status).toBe(404);

    // The owner still can, with the cookie the create response set.
    const ownGet = await handleApiRequest(
      request(`/api/jobs/${job.id}`, { headers: { cookie: ownerCookie } }),
      deps,
    );
    expect(ownGet?.status).toBe(200);
    const ownOut = await handleApiRequest(
      request(`/api/jobs/${job.id}/output`, { headers: { cookie: ownerCookie } }),
      deps,
    );
    expect(ownOut?.status).toBe(200);
  });

  it("lists jobs and 404s for unknown ids", async () => {
    const list = await handleApiRequest(request("/api/jobs"), deps);
    expect(await json(list as Response)).toEqual({ jobs: [] });
    const missing = await handleApiRequest(request("/api/jobs/job_doesnotexist123"), deps);
    expect(missing?.status).toBe(404);
  });

  it("rejects narration without a key (503) and never exposes key material", async () => {
    const res = await handleApiRequest(
      request("/api/narrate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "Hello", voiceId: "elijah" }),
      }),
      deps,
    );
    expect(res?.status).toBe(503);
    const body = await json(res as Response);
    expect(body["error"]).toBe("speechify_key_missing");
  });

  it("rejects over-long narration text", async () => {
    const res = await handleApiRequest(
      request("/api/narrate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "x".repeat(2001), voiceId: "elijah" }),
      }),
      deps,
    );
    expect(res?.status).toBe(400);
    expect((await json(res as Response))["error"]).toBe("text_too_long");
  });

  it("rate-limits narration: the 11th request in a minute is 429 (Phase C)", async () => {
    let last: Response | null = null;
    for (let i = 0; i < NARRATE_MAX_PER_MINUTE + 1; i++) {
      last = await handleApiRequest(
        request("/api/narrate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: "Hello world", voiceId: "elijah" }),
        }),
        deps,
      );
    }
    expect(last?.status).toBe(429);
    const body = await json(last as Response);
    expect(body["error"]).toBe("too_many_requests");
    expect(typeof body["retryAfterSeconds"]).toBe("number");
  });

  it("runs a clearly-labelled mock narration end to end when SPEECHIFY_MOCK=1", async () => {
    process.env["SPEECHIFY_MOCK"] = "1";
    const created = await handleApiRequest(
      request("/api/narrate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "Hello mock world", voiceId: "elijah" }),
      }),
      deps,
    );
    expect(created?.status).toBe(202);
    const createdBody = await json(created as Response);
    const job = createdBody["job"] as { id: string; mock: boolean };
    expect(job.mock).toBe(true);
    const ownerCookie = anonCookieFrom(created);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const polled = await handleApiRequest(
      request(`/api/jobs/${job.id}`, { headers: { cookie: ownerCookie } }),
      deps,
    );
    const done = (await json(polled as Response))["job"] as {
      status: string;
      output?: { filename: string; contentType: string };
    };
    expect(done.status).toBe("done");
    expect(done.output?.filename).toBe("narration.mp3");
    expect(done.output?.contentType).toBe("audio/mpeg");
    const out = await handleApiRequest(
      request(`/api/jobs/${job.id}/output`, { headers: { cookie: ownerCookie } }),
      deps,
    );
    expect(out?.status).toBe(200);
    expect(out?.headers.get("content-type")).toBe("audio/mpeg");
    const bytes = new Uint8Array(await (out as Response).arrayBuffer());
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it("saves a BYOK key masked, lists it masked, and removes it — never echoing the key", async () => {
    const saved = await handleApiRequest(
      request("/api/settings/keys", {
        method: "POST",
        headers: { "content-type": "application/json", "x-ace-studio-session": SESSION },
        body: JSON.stringify({ provider: "speechify", key: FAKE_KEY }),
      }),
      deps,
    );
    expect(saved?.status).toBe(200);
    const savedBody = await json(saved as Response);
    expect((savedBody["key"] as { masked: string }).masked).toBe("••••••••lder");
    expect(JSON.stringify(savedBody)).not.toContain("test-key-placeholder");

    const listed = await handleApiRequest(
      request("/api/settings/keys", { headers: { "x-ace-studio-session": SESSION } }),
      deps,
    );
    const listedBody = await json(listed as Response);
    expect(JSON.stringify(listedBody)).not.toContain("test-key-placeholder");
    expect((listedBody["keys"] as { masked: string }[]).map((k) => k.masked)).toEqual([
      "••••••••lder",
    ]);

    const removed = await handleApiRequest(
      request(`/api/settings/keys?provider=speechify`, {
        method: "DELETE",
        headers: { "x-ace-studio-session": SESSION },
      }),
      deps,
    );
    expect((await json(removed as Response))["removed"]).toBe(true);
    const listedAfter = await handleApiRequest(
      request("/api/settings/keys", { headers: { "x-ace-studio-session": SESSION } }),
      deps,
    );
    expect((await json(listedAfter as Response))["keys"]).toEqual([]);
  });

  it("rejects a bad BYOK key without storing or echoing it", async () => {
    const badFetch = (async () =>
      new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 })) as typeof fetch;
    const res = await handleApiRequest(
      request("/api/settings/keys", {
        method: "POST",
        headers: { "content-type": "application/json", "x-ace-studio-session": SESSION },
        body: JSON.stringify({ provider: "speechify", key: FAKE_KEY }),
      }),
      { ...deps, fetchImpl: badFetch },
    );
    expect(res?.status).toBe(400);
    const body = await json(res as Response);
    expect(JSON.stringify(body)).not.toContain("test-key-placeholder");
    const listed = await handleApiRequest(
      request("/api/settings/keys", { headers: { "x-ace-studio-session": SESSION } }),
      deps,
    );
    expect((await json(listed as Response))["keys"]).toEqual([]);
  });

  it("lists voices through a session key", async () => {
    await handleApiRequest(
      request("/api/settings/keys", {
        method: "POST",
        headers: { "content-type": "application/json", "x-ace-studio-session": SESSION },
        body: JSON.stringify({ provider: "speechify", key: FAKE_KEY }),
      }),
      deps,
    );
    const res = await handleApiRequest(
      request("/api/voices", { headers: { "x-ace-studio-session": SESSION } }),
      deps,
    );
    expect(res?.status).toBe(200);
    const body = await json(res as Response);
    expect((body["voices"] as { id: string }[]).map((v) => v.id)).toContain("elijah");
    expect(JSON.stringify(body)).not.toContain("test-key-placeholder");
  });
});
