import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestJobStore } from "./store";

describe("file job store", () => {
  let dir = "";
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ace-studio-jobs-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("creates a job queued at progress 0 with an id", async () => {
    const store = createTestJobStore(dir);
    const job = await store.create({ kind: "demo", label: "Demo job" });
    expect(job.id.length).toBeGreaterThan(8);
    expect(job.status).toBe("queued");
    expect(job.progress).toBe(0);
    expect(job.createdAt).toBeGreaterThan(0);
  });

  it("gets, lists newest first, and updates a job", async () => {
    const store = createTestJobStore(dir);
    const a = await store.create({ kind: "demo", label: "A" });
    const b = await store.create({ kind: "demo", label: "B" });
    const listed = await store.list();
    expect(listed[0]?.id).toBe(b.id);
    expect(listed[1]?.id).toBe(a.id);
    const updated = await store.update(a.id, { status: "running", progress: 50 });
    expect(updated?.status).toBe("running");
    expect(updated?.progress).toBe(50);
    expect(await store.get(a.id)).toMatchObject({ status: "running" });
    expect(await store.get("job_doesnotexist123")).toBeNull();
    expect(await store.update("job_doesnotexist123", { status: "done" })).toBeNull();
  });

  it("writes and reads back an output file", async () => {
    const store = createTestJobStore(dir);
    const job = await store.create({ kind: "narration", label: "N" });
    const out = await store.writeOutput(
      job.id,
      "narration.mp3",
      "audio/mpeg",
      new Uint8Array([1, 2, 3, 4]),
    );
    expect(out).toEqual({ filename: "narration.mp3", contentType: "audio/mpeg", bytes: 4 });
    const found = await store.readOutput(job.id);
    expect(found?.output.filename).toBe("narration.mp3");
    expect([...(found?.data ?? [])]).toEqual([1, 2, 3, 4]);
    expect(await store.readOutput(job.id)).not.toBeNull();
  });

  it("rejects path-traversal ids and filenames", async () => {
    const store = createTestJobStore(dir);
    await expect(
      store.writeOutput("../evil", "x.txt", "text/plain", new Uint8Array([1])),
    ).rejects.toThrow();
    const job = await store.create({ kind: "demo", label: "D" });
    await expect(
      store.writeOutput(job.id, "../evil.txt", "text/plain", new Uint8Array([1])),
    ).rejects.toThrow();
  });

  it("marks jobs left running by a restart as failed", async () => {
    const store = createTestJobStore(dir);
    const job = await store.create({ kind: "demo", label: "Stuck" });
    await store.update(job.id, { status: "running", progress: 40 });
    // A fresh store instance = a server restart.
    const restarted = createTestJobStore(dir);
    const after = await restarted.get(job.id);
    expect(after?.status).toBe("failed");
    expect(after?.error).toMatch(/restart/i);
  });
});
