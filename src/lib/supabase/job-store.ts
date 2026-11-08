/**
 * Supabase-backed job store (Phase A).
 *
 * The same JobStore interface as the local file store (src/lib/jobs/store.ts),
 * but the rows live in the Postgres `jobs` table and output files live in
 * the Supabase Storage `job-outputs` bucket (private — owner only).
 *
 * OWNERSHIP: every method runs as one user (`userId`), and Row Level
 * Security enforces it in the database: a user can only see and change
 * their own rows. Admins (`isAdmin`) can see all rows — that is how the
 * creator dashboard reads jobs later. The client passed in must already
 * carry that user's access token (createUserClient) or be the service
 * client for admin work.
 *
 * Anonymous/demo jobs keep using the file store — this store refuses to
 * create a job without an owner, instead of writing a row RLS would
 * reject. Stale queued/running jobs are marked failed on first use, the
 * same as the file store does after a restart.
 *
 * NOTE: this module must only ever be imported from server-side code.
 * Never import it from a React component or a route loader.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Job, JobOutput, JobStatus, JobStore } from "../jobs/types";
import { JOB_OUTPUTS_BUCKET } from "./env";

interface JobRow {
  id: string;
  user_id: string | null;
  kind: string;
  label: string;
  status: string;
  progress: number;
  detail: string | null;
  error: string | null;
  mock: boolean;
  output_filename: string | null;
  output_content_type: string | null;
  output_bytes: number | null;
  created_at: string;
  updated_at: string;
}

function rowToJob(row: JobRow): Job {
  const job: Job = {
    id: row.id,
    kind: row.kind as Job["kind"],
    label: row.label,
    status: row.status as JobStatus,
    progress: row.progress,
    createdAt: Date.parse(row.created_at),
    updatedAt: Date.parse(row.updated_at),
    userId: row.user_id ?? undefined,
    detail: row.detail ?? undefined,
    error: row.error ?? undefined,
    mock: row.mock || undefined,
    output:
      row.output_filename && row.output_content_type && row.output_bytes !== null
        ? {
            filename: row.output_filename,
            contentType: row.output_content_type,
            bytes: row.output_bytes,
          }
        : undefined,
  };
  return job;
}

function isSafeFilename(name: string): boolean {
  return /^[A-Za-z0-9._-]{1,128}$/.test(name) && !name.includes("..");
}

export interface SupabaseJobStoreOptions {
  /** Owner of the jobs this store touches. Null = refuse to create. */
  userId: string | null;
  /** Admins may list/get/update any user's jobs. */
  isAdmin?: boolean;
}

export class SupabaseJobStore implements JobStore {
  private client: SupabaseClient;
  private userId: string | null;
  private isAdmin: boolean;
  private reconciled = false;

  constructor(client: SupabaseClient, options: SupabaseJobStoreOptions) {
    this.client = client;
    this.userId = options.userId;
    this.isAdmin = options.isAdmin ?? false;
  }

  /** Add the owner filter to a query, unless this store is an admin store.
   *  A non-admin store with no user matches NOTHING (an impossible owner
   *  id): without this, a service client — which bypasses RLS — would
   *  read or change every user's jobs. */
  private owned<T extends { eq(column: string, value: unknown): T }>(query: T): T {
    if (this.isAdmin) return query;
    if (!this.userId) return query.eq("user_id", "00000000-0000-0000-0000-000000000000");
    return query.eq("user_id", this.userId);
  }

  /**
   * Mark stale queued/running jobs failed — but only jobs that have not
   * been touched for 30 minutes. A job whose row was updated recently is
   * genuinely running (possibly on another server instance), and this
   * instance must not kill it. Concurrent callers share one in-flight
   * reconcile instead of racing it.
   */
  private reconcilePromise: Promise<void> | null = null;
  private static readonly STALE_JOB_MS = 30 * 60 * 1000;

  private ensureReconciled(): Promise<void> {
    if (this.reconciled) return Promise.resolve();
    if (this.reconcilePromise) return this.reconcilePromise;
    this.reconcilePromise = (async () => {
      if (!this.userId && !this.isAdmin) return;
      const cutoff = new Date(Date.now() - SupabaseJobStore.STALE_JOB_MS).toISOString();
      const query = this.client
        .from("jobs")
        .update({
          status: "failed",
          error: "Server restarted while this job was running. Please start it again.",
          updated_at: new Date().toISOString(),
        })
        .in("status", ["queued", "running"])
        .lt("updated_at", cutoff);
      await this.owned(query);
    })().then(
      () => {
        this.reconciled = true;
      },
      (error: unknown) => {
        // A failed reconcile (e.g. a DB blip) must not wedge the store:
        // clear the slot so the next call retries.
        this.reconcilePromise = null;
        throw error;
      },
    );
    return this.reconcilePromise;
  }

  async create(
    input: Omit<Job, "id" | "createdAt" | "updatedAt" | "status" | "progress"> & {
      status?: JobStatus;
      progress?: number;
      userId?: string | undefined;
    },
  ): Promise<Job> {
    // The owner is always this store's user. A caller-supplied userId is
    // honoured only for an admin store — otherwise anyone could create a
    // job under another user's id.
    const owner = this.isAdmin && input.userId ? input.userId : this.userId;
    if (!owner) {
      throw new Error("A Supabase job needs an owner. Log in first, or use the local job store.");
    }
    await this.ensureReconciled();
    const { data, error } = await this.client
      .from("jobs")
      .insert({
        user_id: owner,
        kind: input.kind,
        label: input.label,
        status: input.status ?? "queued",
        progress: input.progress ?? 0,
        detail: input.detail ?? null,
        error: input.error ?? null,
        mock: input.mock ?? false,
      })
      .select()
      .single();
    if (error || !data) {
      throw new Error(`Could not create the job: ${error?.message ?? "unknown error"}`);
    }
    return rowToJob(data as JobRow);
  }

  async get(id: string): Promise<Job | null> {
    await this.ensureReconciled();
    const { data, error } = await this.owned(
      this.client.from("jobs").select("*").eq("id", id),
    ).maybeSingle();
    if (error || !data) return null;
    return rowToJob(data as JobRow);
  }

  async list(limit = 20): Promise<Job[]> {
    await this.ensureReconciled();
    const safeLimit = Math.max(1, Math.min(100, limit));
    const { data, error } = await this.owned(
      this.client
        .from("jobs")
        .select("*")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(safeLimit),
    );
    if (error || !data) return [];
    return (data as JobRow[]).map(rowToJob);
  }

  async update(
    id: string,
    patch: Partial<Pick<Job, "status" | "progress" | "error" | "detail" | "mock" | "output">>,
  ): Promise<Job | null> {
    await this.ensureReconciled();
    const rowPatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.status !== undefined) rowPatch["status"] = patch.status;
    if (patch.progress !== undefined) rowPatch["progress"] = patch.progress;
    if (patch.error !== undefined) rowPatch["error"] = patch.error;
    if (patch.detail !== undefined) rowPatch["detail"] = patch.detail;
    if (patch.mock !== undefined) rowPatch["mock"] = patch.mock;
    if (patch.output !== undefined) {
      rowPatch["output_filename"] = patch.output.filename;
      rowPatch["output_content_type"] = patch.output.contentType;
      rowPatch["output_bytes"] = patch.output.bytes;
    }
    const { data, error } = await this.owned(this.client.from("jobs").update(rowPatch).eq("id", id))
      .select()
      .single();
    if (error || !data) return null;
    return rowToJob(data as JobRow);
  }

  async writeOutput(
    id: string,
    filename: string,
    contentType: string,
    data: Uint8Array,
  ): Promise<JobOutput> {
    if (!isSafeFilename(filename)) throw new Error("Invalid output filename");
    const job = await this.get(id);
    if (!job) throw new Error("No job with that id");
    const owner = job.userId ?? this.userId;
    if (!owner) throw new Error("A Supabase job output needs an owner.");
    // First folder is the owner id — Storage RLS enforces it (see migration 001).
    const path = `${owner}/jobs/${id}/${filename}`;
    const { error } = await this.client.storage
      .from(JOB_OUTPUTS_BUCKET)
      .upload(path, data as unknown as BlobPart, { contentType, upsert: true });
    if (error) throw new Error(`Could not store the job output: ${error.message}`);
    const output: JobOutput = { filename, contentType, bytes: data.byteLength };
    await this.update(id, { output });
    return output;
  }

  async readOutput(id: string): Promise<{ output: JobOutput; data: Uint8Array } | null> {
    const job = await this.get(id);
    if (!job || !job.output) return null;
    if (!isSafeFilename(job.output.filename)) return null;
    const owner = job.userId ?? this.userId;
    if (!owner) return null;
    const path = `${owner}/jobs/${id}/${job.output.filename}`;
    const { data, error } = await this.client.storage.from(JOB_OUTPUTS_BUCKET).download(path);
    if (error || !data) return null;
    const buf = await data.arrayBuffer();
    return { output: job.output, data: new Uint8Array(buf) };
  }
}

/** Build a Supabase job store for one request's user. */
export function createSupabaseJobStore(
  client: SupabaseClient,
  options: SupabaseJobStoreOptions,
): JobStore {
  return new SupabaseJobStore(client, options);
}
