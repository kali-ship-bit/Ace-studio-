import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createFakeSupabaseClient } from "../../test/fake-supabase";
import { SupabaseJobStore } from "./job-store";

const USER_A = "user-aaaa";
const USER_B = "user-bbbb";

function storeFor(userId: string | null, isAdmin = false) {
  const fake = createFakeSupabaseClient();
  const client = fake as unknown as SupabaseClient;
  return { fake, store: new SupabaseJobStore(client, { userId, isAdmin }) };
}

function twoUserStores() {
  // One shared fake client: both users live in the same database, so ids
  // are unique and the ownership filter is what separates their rows.
  const fake = createFakeSupabaseClient();
  const client = fake as unknown as SupabaseClient;
  return {
    fake,
    store: new SupabaseJobStore(client, { userId: USER_A }),
    storeB: new SupabaseJobStore(client, { userId: USER_B }),
  };
}

describe("SupabaseJobStore", () => {
  it("refuses to create a job with no owner", async () => {
    const { store } = storeFor(null);
    await expect(store.create({ kind: "demo", label: "No owner" })).rejects.toThrow(/owner/i);
  });

  it("a store with no user sees nothing, even without RLS in the way", async () => {
    const { fake } = storeFor(USER_A);
    const seeded = await new SupabaseJobStore(fake as unknown as SupabaseClient, {
      userId: USER_A,
    }).create({ kind: "demo", label: "Mine" });
    expect(seeded.userId).toBe(USER_A);
    const nobody = new SupabaseJobStore(fake as unknown as SupabaseClient, { userId: null });
    expect(await nobody.list()).toHaveLength(0);
    expect(await nobody.get(seeded.id)).toBeNull();
  });

  it("a caller cannot create a job under another user's id", async () => {
    const { store } = storeFor(USER_A);
    const job = await store.create({ kind: "demo", label: "Spoof?", userId: USER_B });
    expect(job.userId).toBe(USER_A);
  });

  it("creates, gets and lists only the owner's jobs", async () => {
    const { store, storeB } = twoUserStores();
    const mine = await store.create({ kind: "narration", label: "My voice" });
    await storeB.create({ kind: "narration", label: "Someone else's voice" });

    expect(mine.userId).toBe(USER_A);
    expect(await store.get(mine.id)).toMatchObject({ label: "My voice" });
    // Another user cannot see it — it looks as if it does not exist.
    expect(await storeB.get(mine.id)).toBeNull();
    const myJobs = await store.list();
    expect(myJobs).toHaveLength(1);
    expect(myJobs[0]?.label).toBe("My voice");
  });

  it("lets an admin see every user's jobs", async () => {
    const { fake, store } = storeFor(USER_A);
    await store.create({ kind: "demo", label: "A job" });
    const admin = new SupabaseJobStore(fake as unknown as SupabaseClient, {
      userId: null,
      isAdmin: true,
    });
    const all = await admin.list();
    expect(all).toHaveLength(1);
    expect(all[0]?.label).toBe("A job");
  });

  it("updates status and progress, and marks stale jobs failed", async () => {
    const { fake, store } = storeFor(USER_A);
    const job = await store.create({ kind: "demo", label: "Stale?" });
    const updated = await store.update(job.id, { status: "running", progress: 50 });
    expect(updated?.status).toBe("running");
    expect(updated?.progress).toBe(50);

    // A job left running by a crashed server is failed on next use —
    // but only when it is actually stale (untouched for 30 minutes). A
    // job running right now may belong to another live server instance.
    const staleAt = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    const jobsTable = fake.tables.get("jobs");
    jobsTable?.rows.push({
      id: "job_stale",
      user_id: USER_A,
      kind: "demo",
      label: "Crashed job",
      status: "running",
      progress: 10,
      detail: null,
      error: null,
      mock: false,
      output_filename: null,
      output_content_type: null,
      output_bytes: null,
      created_at: staleAt,
      updated_at: staleAt,
    });
    jobsTable?.rows.push({
      id: "job_live",
      user_id: USER_A,
      kind: "demo",
      label: "Live job",
      status: "running",
      progress: 10,
      detail: null,
      error: null,
      mock: false,
      output_filename: null,
      output_content_type: null,
      output_bytes: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const fresh = new SupabaseJobStore(fake as unknown as SupabaseClient, { userId: USER_A });
    const stale = await fresh.get("job_stale");
    expect(stale?.status).toBe("failed");
    expect(stale?.error).toMatch(/restarted/i);
    // The live job is untouched by the same reconcile.
    const live = await fresh.get("job_live");
    expect(live?.status).toBe("running");
  });

  it("stores output files under the owner's folder and reads them back", async () => {
    const { fake, store } = storeFor(USER_A);
    const job = await store.create({ kind: "narration", label: "Voice" });
    const bytes = new TextEncoder().encode("fake-audio-bytes");
    const output = await store.writeOutput(job.id, "narration.mp3", "audio/mpeg", bytes);
    expect(output).toEqual({
      filename: "narration.mp3",
      contentType: "audio/mpeg",
      bytes: bytes.byteLength,
    });
    // Storage path is <user>/jobs/<id>/<file> — the owner folder is the RLS check.
    const bucket = fake.buckets.get("job-outputs");
    expect([...(bucket?.files.keys() ?? [])]).toEqual([`${USER_A}/jobs/${job.id}/narration.mp3`]);
    const back = await store.readOutput(job.id);
    expect(back?.output.filename).toBe("narration.mp3");
    expect(new TextDecoder().decode(back?.data)).toBe("fake-audio-bytes");
  });

  it("rejects an unsafe output filename", async () => {
    const { store } = storeFor(USER_A);
    const job = await store.create({ kind: "demo", label: "Bad name" });
    await expect(
      store.writeOutput(job.id, "../evil.mp4", "video/mp4", new Uint8Array([1])),
    ).rejects.toThrow(/filename/i);
  });
});
