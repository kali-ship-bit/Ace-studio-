/**
 * Jobs — Step 0 foundations.
 *
 * A Job is one unit of server-side work (a demo job, a narration, later a
 * video generation). The client creates a job, then polls GET /api/jobs/:id
 * until it reaches a terminal status. No video bytes, audio bytes or API keys
 * ever live in a Job record that leaves the server — only metadata.
 *
 * Storage mapping (local dev -> deployed):
 *   local dev : one JSON file per job under data/jobs/<id>.json, outputs as
 *               files under data/jobs/<id>/ (see store.ts)
 *   deployed  : the same Job record becomes a row in the Supabase Postgres
 *               `jobs` table, and each output file becomes an object in
 *               the Supabase Storage `job-outputs` bucket, keyed
 *               `<user_id>/jobs/<id>/<filename>` — the first folder is the
 *               owner, so Storage RLS lets a user touch only their own
 *               files. The JobStore interface is the seam — only the
 *               backing adapter changes, never the API routes or the UI.
 *               See src/lib/supabase/job-store.ts.
 */

export type JobStatus = "queued" | "running" | "done" | "failed";

export type JobKind = "demo" | "narration" | "post";

export interface JobOutput {
  /** File name inside the job's storage folder, e.g. "narration.mp3". */
  filename: string;
  /** MIME type, e.g. "audio/mpeg" or "text/plain". */
  contentType: string;
  /** Size in bytes. */
  bytes: number;
}

export interface Job {
  id: string;
  kind: JobKind;
  /** Owner's Supabase user id. Never sent to any user but the owner/admin. */
  userId?: string | undefined;
  /** Short human label shown in the UI, e.g. "Demo job" or the first words. */
  label: string;
  status: JobStatus;
  /** 0..100, for the progress bar. */
  progress: number;
  createdAt: number;
  updatedAt: number;
  /** Non-secret detail shown to the user, e.g. voice id, character count. */
  detail?: string | undefined;
  /** Human-readable failure reason. Never contains a key or a secret. */
  error?: string | undefined;
  /** True when the output was made by the clearly-labelled mock provider. */
  mock?: boolean | undefined;
  output?: JobOutput | undefined;
}

export type JobStatusFilter = JobStatus | "all";

/** Minimal store interface. Local dev uses the filesystem adapter in store.ts;
 *  a configured Supabase project swaps in the Postgres + Storage adapter in
 *  src/lib/supabase/job-store.ts behind this same interface. */
export interface JobStore {
  create(
    job: Omit<Job, "id" | "createdAt" | "updatedAt" | "status" | "progress"> & {
      status?: JobStatus;
      progress?: number;
      userId?: string | undefined;
    },
  ): Promise<Job>;
  get(id: string): Promise<Job | null>;
  list(limit?: number): Promise<Job[]>;
  update(
    id: string,
    patch: Partial<Pick<Job, "status" | "progress" | "error" | "detail" | "mock" | "output">>,
  ): Promise<Job | null>;
  /** Write an output file for a job. Returns the stored output descriptor. */
  writeOutput(
    id: string,
    filename: string,
    contentType: string,
    data: Uint8Array,
  ): Promise<JobOutput>;
  /** Read a job's output file bytes, or null when there is none. */
  readOutput(id: string): Promise<{ output: JobOutput; data: Uint8Array } | null>;
}

/**
 * The public shape of a Job: the record holds no secrets by
 * construction — except the owner's id, which is stripped here so one
 * user can never learn another's id from a job response. Every handler
 * that returns a job goes through this one function.
 */
export function publicJob(job: Job): Job {
  const copy = { ...job };
  delete copy.userId;
  return copy;
}
