import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createFakeSupabaseClient } from "../../test/fake-supabase";
import { SupabaseAttemptStore } from "./rate-limit-store";

describe("SupabaseAttemptStore", () => {
  it("saves, reads and clears an attempt record (upsert, not duplicates)", async () => {
    const fake = createFakeSupabaseClient();
    const store = new SupabaseAttemptStore(fake as unknown as SupabaseClient);
    const key = "login:abc123";
    const now = Date.now();

    expect(await store.get(key)).toBeNull();
    await store.set(key, { count: 1, lockedUntil: 0, windowStart: now });
    expect(await store.get(key)).toEqual({ count: 1, lockedUntil: 0, windowStart: now });

    await store.set(key, { count: 3, lockedUntil: 2_000, windowStart: now });
    expect(await store.get(key)).toEqual({ count: 3, lockedUntil: 2_000, windowStart: now });
    expect(fake.tables.get("auth_attempts")?.rows).toHaveLength(1);

    await store.remove(key);
    expect(await store.get(key)).toBeNull();
  });

  it("cleans up attempt rows older than a day when saving", async () => {
    const fake = createFakeSupabaseClient();
    const store = new SupabaseAttemptStore(fake as unknown as SupabaseClient);
    const oldKey = "login:old";
    const freshKey = "login:fresh";
    // Seed a row from 25 hours ago directly: a row that old is
    // housekeeping, not a live lockout.
    fake.from("auth_attempts");
    const table = fake.tables.get("auth_attempts");
    table?.rows.push({
      key: oldKey,
      attempts: 3,
      locked_until: null,
      window_start: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    });
    expect(await store.get(oldKey)).not.toBeNull();
    // Saving a fresh row sweeps the stale one away.
    await store.set(freshKey, { count: 1, lockedUntil: 0, windowStart: Date.now() });
    expect(await store.get(oldKey)).toBeNull();
    expect(await store.get(freshKey)).not.toBeNull();
  });
});
