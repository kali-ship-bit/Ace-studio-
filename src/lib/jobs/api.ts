/**
 * Jobs API routes (Steps 0–2). Server-side only.
 *
 * Wired into src/server.ts, which calls handleApiRequest() for every
 * request whose path starts with /api/ before the TanStack handler runs.
 * That keeps these routes working identically in `bun run dev` and in the
 * Nitro node-server production build, without depending on a
 * particular TanStack Start API-route convention.
 *
 * Routes:
 *   POST   /api/jobs                 create a job (kind "demo" for now)
 *   GET    /api/jobs                 list recent jobs (newest first)
 *   GET    /api/jobs/:id             one job's status
 *   GET    /api/jobs/:id/output      download a finished job's output file
 *   POST   /api/narrate              create narration audio (Speechify)
 *   GET    /api/voices               voice picker list (Speechify catalog)
 *   POST   /api/settings/keys        save + validate a BYOK key (session-only)
 *   GET    /api/settings/keys        masked keys held for this session
 *   DELETE /api/settings/keys        remove a session key
 *
 * Security rules enforced here:
 * - No key ever appears in a response, a Job record, or a log line. The
 *   only key-shaped thing a client sees is a masked display (••••last4).
 * - A pasted BYOK key is sent by the browser once (over HTTPS in
 *   production), validated server-side, then held in server memory only.
 * - Mutating routes are rate-limited per IP (see
 *   ../security/rate-limit.ts): narration and key saves are the
 *   cost-bearing ones, so they get the stricter cap.
 * - Session keys are addressed by a client-made session id sent in the
 *   `x-ace-studio-session` header (or `sessionId` in the body/query).
 * - Speechify errors are sanitised server-side (see speechify.ts).
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getJobStoreForRequest } from "./store";
import type { JobStore } from "./types";
import { isOwnJob, ownerIdForRead, ownerIdForRequest } from "./anon";
import { csrfInvalidResponse, verifyCsrfToken } from "../security/csrf";
import {
  errorResponse,
  jsonResponse,
  readJsonBody,
  tooManyResponse,
  withCookies,
} from "../security/http";
import {
  API_MAX_PER_MINUTE,
  checkApiRateLimit,
  NARRATE_MAX_PER_MINUTE,
  type AttemptStore,
} from "../security/rate-limit";
import { getDefaultAttemptStore } from "../supabase/rate-limit-store";
import {
  describeKeySource,
  getAppSpeechifyKey,
  isMockSpeechify,
  SPEECHIFY_MAX_CHARS_PER_REQUEST,
} from "./env";
import {
  getSessionKey,
  isKeyProviderId,
  KEY_PROVIDERS,
  listSessionKeys,
  newSessionId,
  removeSessionKey,
  saveSessionKey,
} from "./byok";
import { listSpeechifyVoices, synthesizeSpeech } from "./speechify";
import { publicJob, type Job } from "./types";

export interface ApiDeps {
  store?: JobStore;
  fetchImpl?: typeof fetch;
  /** Rate-limit store (tests pass a fresh one; default is process memory). */
  attemptStore?: AttemptStore;
}

const SESSION_HEADER = "x-ace-studio-session";

function sessionIdFrom(request: Request, body?: Record<string, unknown>): string | undefined {
  // Header first, then the JSON body. Never the query string: a session
  // id in a URL lands in server logs and browser history, and it is the
  // handle for this tab's pasted API keys.
  const fromHeader = request.headers.get(SESSION_HEADER)?.trim();
  if (fromHeader) return fromHeader;
  const fromBody = body?.["sessionId"];
  if (typeof fromBody === "string" && fromBody.trim()) return fromBody.trim();
  return undefined;
}

/** Run a demo job through its status transitions (local dev only).
 *  In production this is replaced by a queue consumer: a worker enqueues,
 *  a consumer updates the Supabase row. The transitions here are simulated
 *  in-process with timers, which is why a server restart marks stale
 *  running jobs as failed (see store.ts). */
function runDemoJob(store: JobStore, job: Job): void {
  const outputText = [
    "Ace Studio — demo job",
    `Job: ${job.id}`,
    `Label: ${job.label}`,
    "This is the Step 0 proof job: it moves queued -> running -> done and",
    "writes one output file, so the status UI and the download can be",
    "checked end to end before any real AI work is wired in.",
    "",
  ].join("\n");
  // A failed store write must mark the job failed, never reject into the
  // void: this runs fire-and-forget, so an unhandled rejection would
  // crash the process and leave the job "running" forever.
  const fail = (message: string): void => {
    void store.update(job.id, { status: "failed", error: message }).catch(() => {});
  };
  setTimeout(() => {
    void store
      .update(job.id, { status: "running", progress: 50 })
      .then(() => {
        setTimeout(() => {
          void (async () => {
            try {
              await store.writeOutput(
                job.id,
                "output.txt",
                "text/plain",
                new TextEncoder().encode(outputText),
              );
              await store.update(job.id, { status: "done", progress: 100 });
            } catch {
              fail("The demo job could not write its output.");
            }
          })();
        }, 700);
      })
      .catch(() => fail("The demo job could not start."));
  }, 700);
}

async function runNarrationJob(
  store: JobStore,
  job: Job,
  input: {
    text: string;
    voiceId: string;
    language?: string | undefined;
    rate?: string | undefined;
    apiKey?: string | undefined;
    mock: boolean;
  },
  fetchImpl: typeof fetch,
): Promise<void> {
  await store.update(job.id, { status: "running", progress: 25, mock: input.mock });
  try {
    let audio: Uint8Array;
    let billable = input.text.length;
    if (input.mock) {
      // Clearly-labelled mock: reuse the bundled sample narration MP3 so the
      // preview/download flow can be proved without a key. The job carries
      // mock: true and the UI says so — this is never presented as a real
      // generation. Dev-only: enabled only with SPEECHIFY_MOCK=1.
      const samplePath = join(process.cwd(), "src", "assets", "audio", "feed_narration.mp3");
      const buf = await readFile(samplePath);
      audio = new Uint8Array(buf);
      billable = 0;
    } else {
      if (!input.apiKey) throw new Error("No Speechify key available");
      const result = await synthesizeSpeech({
        input: input.text,
        voiceId: input.voiceId,
        language: input.language,
        rate: input.rate ?? "-5%",
        apiKey: input.apiKey,
        fetchImpl,
      });
      audio = result.audio;
      billable = result.billableCharacters;
    }
    await store.update(job.id, { status: "running", progress: 75 });
    await store.writeOutput(job.id, "narration.mp3", "audio/mpeg", audio);
    await store.update(job.id, {
      status: "done",
      progress: 100,
      detail: `${billable} characters spoken · voice ${input.voiceId}${input.mock ? " · MOCK — not a real generation" : ""}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Narration failed";
    await store.update(job.id, { status: "failed", error: message.slice(0, 300) });
  }
}

export async function handleApiRequest(
  request: Request,
  deps: ApiDeps = {},
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/")) return null;
  // A signed-in user gets the Supabase job store (durable, under RLS);
  // anonymous/demo use keeps the local file store.
  const store = deps.store ?? (await getJobStoreForRequest(request));
  const fetchImpl = deps.fetchImpl ?? fetch;
  // Rate limits live in Supabase when configured (they survive a
  // restart); otherwise in process memory. Tests inject their own.
  const attemptStore = deps.attemptStore ?? getDefaultAttemptStore();

  /** 429 when this IP has used up its per-minute allowance for a group. */
  async function rateLimited(group: string, maxPerMinute: number): Promise<Response | null> {
    const check = await checkApiRateLimit(request, group, maxPerMinute, attemptStore);
    if (check.allowed) return null;
    return tooManyResponse(check.retryAfterSeconds, "Too many requests. Try again in a moment.");
  }

  // --- Jobs ---------------------------------------------------------------
  if (path === "/api/jobs" && request.method === "POST") {
    const body = await readJsonBody(request);
    if (body === null) return errorResponse(400, "bad_json", "Request body must be a JSON object");
    if (!verifyCsrfToken(request, body)) return csrfInvalidResponse();
    // Validate before rate-limiting: junk requests must not burn the
    // per-minute quota (an attacker could otherwise deny jobs to
    // everyone sharing an IP with junk requests).
    const kind = body["kind"];
    if (kind !== "demo")
      return errorResponse(400, "bad_kind", 'Only kind "demo" is supported in this step');
    const blocked = await rateLimited("jobs", API_MAX_PER_MINUTE);
    if (blocked) return blocked;
    const label =
      typeof body["label"] === "string" && body["label"].trim()
        ? body["label"].trim().slice(0, 120)
        : "Demo job";
    // The job belongs to this requester (signed-in user id, or an
    // anonymous cookie id issued here). Without this, any visitor could
    // list and download anyone else's demo jobs.
    const { ownerId, setCookie } = await ownerIdForRequest(request);
    const job = await store.create({ kind: "demo", label, userId: ownerId });
    runDemoJob(store, job);
    return withCookies(jsonResponse({ job: publicJob(job) }, 201), setCookie ? [setCookie] : []);
  }

  if (path === "/api/jobs" && request.method === "GET") {
    // Only this requester's jobs: a visitor with no id owns nothing.
    const ownerId = await ownerIdForRead(request);
    if (!ownerId) return jsonResponse({ jobs: [] });
    const jobs = await store.list(20);
    return jsonResponse({ jobs: jobs.filter((j) => j.userId === ownerId).map(publicJob) });
  }

  const jobMatch = path.match(/^\/api\/jobs\/([^/]+)(\/output)?$/);
  if (jobMatch) {
    const jobId = jobMatch[1] as string;
    if (request.method === "GET" && !jobMatch[2]) {
      const job = await store.get(jobId);
      // 404 either way: never confirm that someone else's job exists.
      const ownerId = await ownerIdForRead(request);
      if (!job || !isOwnJob(job.userId, ownerId)) {
        return errorResponse(404, "job_not_found", "No job with that id");
      }
      return jsonResponse({ job: publicJob(job) });
    }
    if (request.method === "GET" && jobMatch[2] === "/output") {
      const ownerId = await ownerIdForRead(request);
      const job = await store.get(jobId);
      if (!job || !isOwnJob(job.userId, ownerId)) {
        return errorResponse(404, "output_not_found", "This job has no output file yet");
      }
      const found = await store.readOutput(jobId);
      if (!found) return errorResponse(404, "output_not_found", "This job has no output file yet");
      return new Response(found.data as BodyInit, {
        status: 200,
        headers: {
          "content-type": found.output.contentType,
          "content-disposition": `attachment; filename="${found.output.filename}"`,
          "content-length": String(found.output.bytes),
          "cache-control": "no-store",
        },
      });
    }
    return errorResponse(405, "method_not_allowed", "Method not allowed for this route");
  }

  // --- Voices (picker) ----------------------------------------------------
  if (path === "/api/voices" && request.method === "GET") {
    const sessionId = sessionIdFrom(request);
    const sessionKey = sessionId ? getSessionKey(sessionId, "speechify") : undefined;
    const appKey = getAppSpeechifyKey();
    if (isMockSpeechify() && !sessionKey && !appKey) {
      return jsonResponse({
        mock: true,
        voices: [
          { id: "elijah", displayName: "Elijah (mock)", locale: "en-NG" },
          { id: "beatrice", displayName: "Beatrice (mock)", locale: "en-GB" },
          { id: "alec", displayName: "Alec (mock)", locale: "en-GB" },
        ],
      });
    }
    const key = sessionKey ?? appKey;
    if (!key) {
      return errorResponse(
        503,
        "speechify_key_missing",
        "No Speechify key is set. Add one in Settings, or set SPEECHIFY_API_KEY on the server.",
      );
    }
    try {
      const voices = await listSpeechifyVoices(key, fetchImpl);
      return jsonResponse({ voices });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load voices";
      const status = /401|403/.test(message) ? 401 : 502;
      return errorResponse(status, "speechify_error", message.slice(0, 300));
    }
  }

  // --- Narration ----------------------------------------------------------
  if (path === "/api/narrate" && request.method === "POST") {
    const body = await readJsonBody(request);
    if (body === null) return errorResponse(400, "bad_json", "Request body must be a JSON object");
    if (!verifyCsrfToken(request, body)) return csrfInvalidResponse();
    // Validate before rate-limiting: narration burns the Speechify
    // allowance, so its strict cap must be spent only on real requests.
    const text = typeof body["text"] === "string" ? body["text"] : "";
    const voiceId = typeof body["voiceId"] === "string" ? body["voiceId"].trim() : "";
    const language = typeof body["language"] === "string" ? body["language"].trim() : undefined;
    const rate = typeof body["rate"] === "string" ? body["rate"].trim() : undefined;
    if (!text.trim())
      return errorResponse(400, "empty_text", "Type or paste the words to speak first");
    if (text.length > SPEECHIFY_MAX_CHARS_PER_REQUEST) {
      return errorResponse(
        400,
        "text_too_long",
        `Keep it to ${SPEECHIFY_MAX_CHARS_PER_REQUEST} characters per request (yours is ${text.length}). Split longer scripts into parts.`,
      );
    }
    if (!voiceId) return errorResponse(400, "missing_voice", "Pick a voice first");
    const blocked = await rateLimited("narrate", NARRATE_MAX_PER_MINUTE);
    if (blocked) return blocked;
    const sessionId = sessionIdFrom(request, body);
    const sessionKey = sessionId ? getSessionKey(sessionId, "speechify") : undefined;
    const appKey = getAppSpeechifyKey();
    const source = describeKeySource(Boolean(sessionKey), Boolean(appKey));
    if (source === "none") {
      return errorResponse(
        503,
        "speechify_key_missing",
        "No Speechify key is set. Add one in Settings (it stays in server memory for this session only), or set SPEECHIFY_API_KEY on the server.",
      );
    }
    const label = text.trim().split(/\s+/).slice(0, 6).join(" ");
    const { ownerId, setCookie } = await ownerIdForRequest(request);
    const job = await store.create({
      kind: "narration",
      label: `Narration: ${label}${text.trim().length > label.length ? "…" : ""}`,
      detail: `${text.length} characters · voice ${voiceId} · key: ${source}`,
      mock: source === "mock",
      userId: ownerId,
    });
    // Fire and forget: the client polls GET /api/jobs/:id for the result.
    // A failure outside the job's own try/catch (e.g. the store going
    // down) must still mark the job failed, never reject into the void.
    void runNarrationJob(
      store,
      job,
      { text, voiceId, language, rate, apiKey: sessionKey ?? appKey, mock: source === "mock" },
      fetchImpl,
    ).catch(async (error: unknown) => {
      const message = error instanceof Error ? error.message : "Narration failed";
      await store
        .update(job.id, { status: "failed", error: message.slice(0, 300) })
        .catch(() => {});
    });
    return withCookies(jsonResponse({ job: publicJob(job) }, 202), setCookie ? [setCookie] : []);
  }

  // --- BYOK settings ------------------------------------------------------
  if (path === "/api/settings/keys" && request.method === "POST") {
    const body = await readJsonBody(request);
    if (body === null) return errorResponse(400, "bad_json", "Request body must be a JSON object");
    if (!verifyCsrfToken(request, body)) return csrfInvalidResponse();
    // Validate before rate-limiting, as on the other mutating routes.
    const provider = body["provider"];
    if (!isKeyProviderId(provider)) {
      return errorResponse(
        400,
        "unknown_provider",
        `Unknown provider. Supported: ${Object.keys(KEY_PROVIDERS).join(", ")}`,
      );
    }
    const key = typeof body["key"] === "string" ? body["key"] : "";
    if (!key.trim()) return errorResponse(400, "empty_key", "Paste a key first");
    const blocked = await rateLimited("keys", API_MAX_PER_MINUTE);
    if (blocked) return blocked;
    let sessionId = sessionIdFrom(request, body);
    if (!sessionId) sessionId = newSessionId();
    try {
      const stored = await saveSessionKey(sessionId, provider, key, fetchImpl);
      return jsonResponse({ sessionId, key: stored });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Key could not be saved";
      return errorResponse(400, "key_rejected", message.slice(0, 300));
    }
  }

  if (path === "/api/settings/keys" && request.method === "GET") {
    const sessionId = sessionIdFrom(request);
    return jsonResponse({
      keys: sessionId ? listSessionKeys(sessionId) : [],
      appKeyConfigured: Boolean(getAppSpeechifyKey()),
      providers: Object.values(KEY_PROVIDERS).map((p) => ({
        id: p.id,
        label: p.label,
        hint: p.hint,
      })),
    });
  }

  if (path === "/api/settings/keys" && request.method === "DELETE") {
    if (!verifyCsrfToken(request)) return csrfInvalidResponse();
    const provider = url.searchParams.get("provider");
    const sessionId = sessionIdFrom(request);
    if (!sessionId || !isKeyProviderId(provider))
      return errorResponse(400, "bad_request", "Pass a valid session id and provider");
    const blocked = await rateLimited("keys", API_MAX_PER_MINUTE);
    if (blocked) return blocked;
    const removed = removeSessionKey(sessionId, provider);
    return jsonResponse({ removed });
  }

  if (path.startsWith("/api/")) {
    return errorResponse(404, "not_found", "No such API route");
  }
  return null;
}
