/**
 * Local filesystem job store (Step 0).
 *
 * Local dev backing for the JobStore interface: one JSON file per job under
 *   data/jobs/<id>.json
 * and output files under
 *   data/jobs/<id>/<filename>
 *
 * The `data/` directory is gitignored (see .gitignore) — job records and
 * generated audio never enter version control. When the app is deployed
 * with a Supabase project, logged-in users' jobs use the Supabase store
 * instead (src/lib/supabase/job-store.ts: Postgres rows + Storage files
 * behind the same interface). Anonymous/demo jobs keep using this file
 * store. Nothing else in the app needs to change for that swap.
 *
 * NOTE: this module uses node:fs and must only ever be imported from
 * server-side code (src/server.ts, src/lib/jobs/api.ts). Never import it
 * from a React component or a route loader — loaders run in the browser on
 * navigation, and filesystem code must never ship to the client.
 */

import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Job, JobOutput, JobStore } from "./types";
import { getSessionTokens } from "../security/session";
import { createUserClient, getAuthUserFromRequest } from "../supabase/client";
import { isSupabaseConfigured } from "../supabase/env";
import { createSupabaseJobStore } from "../supabase/job-store";

export function jobsDataDir(): string {
  // Overridable for tests. Default is <project root>/data/jobs.
  // process.cwd() is the project root when the dev server / build runs.
  const base = process.env["ACE_STUDIO_JOBS_DIR"]?.trim();
  if (base) return base;
  return join(process.cwd(), "data", "jobs");
}

function jobFile(dir: string, id: string): string {
  return join(dir, `${id}.json`);
}

function jobOutputDir(dir: string, id: string): string {
  return join(dir, id);
}

function isSafeId(id: string): boolean {
  // Job ids are server-generated; reject anything that could escape the dir.
  return /^[A-Za-z0-9_-]{8,64}$/.test(id);
}

function isSafeFilename(name: string): boolean {
  return /^[A-Za-z0-9._-]{1,128}$/.test(name) && !name.includes("..");
}

let jobSeq = 0;

function newJobId(): string {
  // Monotonic per-process sequence: two jobs created in the same
  // millisecond still sort newest-first (the list() tiebreaker compares
  // ids, and a random suffix alone has no creation order in it). The
  // random tail is a cryptographic UUID fragment, not Math.random, so
  // ids cannot be guessed by counting.
  const seq = String(jobSeq++).padStart(6, "0");
  return `job_${Date.now().toString(36)}_${seq}_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

async function readJob(dir: string, id: string): Promise<Job | null> {
  if (!isSafeId(id)) return null;
  try {
    const raw = await readFile(jobFile(dir, id), "utf-8");
    const job = JSON.parse(raw) as Job;
    if (!job || job.id !== id) return null;
    return job;
  } catch {
    return null;
  }
}

async function writeJob(dir: string, job: Job): Promise<void> {
  await mkdir(dir, { recursive: true });
  // Unique tmp name per call: two concurrent writes for the same job
  // (e.g. a status update racing an output write) used to share one tmp
  // file, so the second rename failed with ENOENT.
  const tmp = `${jobFile(dir, job.id)}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  await writeFile(tmp, JSON.stringify(job, null, 2), "utf-8");
  await rename(tmp, jobFile(dir, job.id));
}

/**
 * Jobs left in a non-terminal state by a server restart can never finish
 * (their timers died with the old process). Mark them failed so the UI
 * never polls forever.
 */
async function reconcileStale(dir: string, jobs: Job[]): Promise<void> {
  const stale = jobs.filter((j) => j.status === "queued" || j.status === "running");
  for (const job of stale) {
    await writeJob(dir, {
      ...job,
      status: "failed",
      progress: job.progress,
      error: "Server restarted while this job was running. Please start it again.",
      updatedAt: Date.now(),
    });
  }
}

class FileJobStore implements JobStore {
  private dir: string;
  private cache = new Map<string, Job>();
  private reconciled = false;
  private reconcilePromise: Promise<void> | null = null;

  constructor(dir: string) {
    this.dir = dir;
  }

  private ensureReconciled(): Promise<void> {
    if (this.reconciled) return Promise.resolve();
    if (this.reconcilePromise) return this.reconcilePromise;
    this.reconcilePromise = (async () => {
      const jobs = await this.listFromDisk();
      await reconcileStale(this.dir, jobs);
      for (const job of jobs) {
        if (job.status === "queued" || job.status === "running") {
          this.cache.set(job.id, {
            ...job,
            status: "failed",
            error: "Server restarted while this job was running. Please start it again.",
            updatedAt: Date.now(),
          });
        }
      }
    })().then(
      () => {
        this.reconciled = true;
      },
      (error: unknown) => {
        this.reconcilePromise = null;
        throw error;
      },
    );
    return this.reconcilePromise;
  }

  private async listFromDisk(): Promise<Job[]> {
    await mkdir(this.dir, { recursive: true });
    const names = await readdir(this.dir);
    const jobs: Job[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const id = name.slice(0, -".json".length);
      const job = await readJob(this.dir, id);
      if (job) jobs.push(job);
    }
    // Newest first. The id tiebreaker is a plain string comparison, not
    // localeCompare: ids are ASCII (job_<time>_<zero-padded seq>_<rand>),
    // so byte order equals creation order in every locale.
    jobs.sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
    return jobs;
  }

  async create(
    input: Omit<Job, "id" | "createdAt" | "updatedAt" | "status" | "progress"> & {
      status?: Job["status"];
      progress?: number;
    },
  ): Promise<Job> {
    await this.ensureReconciled();
    const now = Date.now();
    const job: Job = {
      id: newJobId(),
      kind: input.kind,
      // The owner id is what keeps one anonymous browser from reading
      // another's jobs (see src/lib/jobs/anon.ts). It used to be
      // dropped here, so file-store jobs belonged to nobody.
      userId: input.userId,
      label: input.label,
      detail: input.detail,
      error: input.error,
      mock: input.mock,
      output: input.output,
      status: input.status ?? "queued",
      progress: input.progress ?? 0,
      createdAt: now,
      updatedAt: now,
    };
    await writeJob(this.dir, job);
    this.cache.set(job.id, job);
    return job;
  }

  async get(id: string): Promise<Job | null> {
    await this.ensureReconciled();
    const cached = this.cache.get(id);
    if (cached) return { ...cached };
    const job = await readJob(this.dir, id);
    if (job) this.cache.set(id, job);
    return job ? { ...job } : null;
  }

  async list(limit = 20): Promise<Job[]> {
    await this.ensureReconciled();
    const jobs = await this.listFromDisk();
    for (const job of jobs) this.cache.set(job.id, job);
    return jobs.slice(0, Math.max(1, Math.min(100, limit)));
  }

  async update(
    id: string,
    patch: Partial<Pick<Job, "status" | "progress" | "error" | "detail" | "mock" | "output">>,
  ): Promise<Job | null> {
    await this.ensureReconciled();
    const current = await this.get(id);
    if (!current) return null;
    const updated: Job = { ...current, ...patch, updatedAt: Date.now() };
    await writeJob(this.dir, updated);
    this.cache.set(id, updated);
    return { ...updated };
  }

  async writeOutput(
    id: string,
    filename: string,
    contentType: string,
    data: Uint8Array,
  ): Promise<JobOutput> {
    if (!isSafeId(id)) throw new Error("Invalid job id");
    if (!isSafeFilename(filename)) throw new Error("Invalid output filename");
    const outDir = jobOutputDir(this.dir, id);
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, filename), data);
    const output: JobOutput = { filename, contentType, bytes: data.byteLength };
    await this.update(id, { output });
    return output;
  }

  async readOutput(id: string): Promise<{ output: JobOutput; data: Uint8Array } | null> {
    const job = await this.get(id);
    if (!job || !job.output) return null;
    if (!isSafeFilename(job.output.filename)) return null;
    const path = join(jobOutputDir(this.dir, id), job.output.filename);
    try {
      await stat(path);
    } catch {
      return null;
    }
    const data = await readFile(path);
    return { output: job.output, data: new Uint8Array(data) };
  }
}

let singleton: FileJobStore | null = null;

/** The store used by the API routes. One per server process. */
export function getJobStore(): JobStore {
  if (!singleton) singleton = new FileJobStore(jobsDataDir());
  return singleton;
}

/**
 * The job store for one request. A signed-in user gets the Supabase
 * store (their jobs live in Postgres + Storage, under RLS, and survive
 * restarts); everyone else — anonymous/demo use — keeps the local file
 * store. Never throws: any auth or config problem falls back to the
 * file store, so a Supabase outage can never break demo jobs.
 */
export async function getJobStoreForRequest(request: Request): Promise<JobStore> {
  if (!isSupabaseConfigured()) return getJobStore();
  try {
    const user = await getAuthUserFromRequest(request);
    if (!user) return getJobStore();
    const { accessToken } = getSessionTokens(request);
    if (!accessToken) return getJobStore();
    return createSupabaseJobStore(createUserClient(accessToken), { userId: user.id });
  } catch {
    return getJobStore();
  }
}

/** Test helper: a store rooted at a throwaway directory. */
export function createTestJobStore(dir: string): JobStore {
  return new FileJobStore(dir);
}
