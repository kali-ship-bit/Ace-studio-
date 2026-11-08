/**
 * Supabase-backed login-attempt store (Phase A).
 *
 * The same AttemptStore interface as the in-memory store
 * (src/lib/security/rate-limit.ts), but the rows live in the
 * `auth_attempts` table, so a lockout survives a server restart and works
 * across instances. The table holds SHA-256 hashes of IPs, never raw
 * addresses, and RLS is on with NO policies — only the service key can
 * read or write it. Always build it with the service client.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AttemptState, AttemptStore } from "../security/rate-limit";
import { getMemoryAttemptStore } from "../security/rate-limit";
import { createServiceClient } from "./client";

interface AttemptRow {
  key: string;
  attempts: number;
  locked_until: string | null;
  window_start: string;
}

function rowToState(row: AttemptRow): AttemptState {
  return {
    count: row.attempts,
    lockedUntil: row.locked_until ? Date.parse(row.locked_until) : 0,
    windowStart: Date.parse(row.window_start),
  };
}

export class SupabaseAttemptStore implements AttemptStore {
  private client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  async get(key: string): Promise<AttemptState | null> {
    const { data, error } = await this.client
      .from("auth_attempts")
      .select("key, attempts, locked_until, window_start")
      .eq("key", key)
      .maybeSingle();
    // maybeSingle() returns { data: null, error: null } when no row
    // exists — that is the "no attempts yet" case, not an error. Any
    // real error must throw: a lockout that cannot be read must not
    // silently become "not locked". (PGRST116 is the error code for
    // single(), not maybeSingle() — an old comment blamed the wrong one.)
    if (error) {
      throw new Error(`Could not read the login-attempt record: ${error.message}`);
    }
    if (!data) return null;
    return rowToState(data as AttemptRow);
  }

  async set(key: string, state: AttemptState): Promise<void> {
    const row: AttemptRow = {
      key,
      attempts: state.count,
      locked_until: state.lockedUntil > 0 ? new Date(state.lockedUntil).toISOString() : null,
      window_start: new Date(state.windowStart).toISOString(),
    };
    const { error } = await this.client.from("auth_attempts").upsert(row, { onConflict: "key" });
    if (error) throw new Error(`Could not save the login-attempt record: ${error.message}`);
    // Best-effort cleanup so the table does not grow forever. A failure
    // here must never break the login flow.
    try {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      await this.client.from("auth_attempts").delete().lt("window_start", cutoff);
    } catch {
      // Ignore — cleanup is housekeeping, not part of the request.
    }
  }

  async remove(key: string): Promise<void> {
    await this.client.from("auth_attempts").delete().eq("key", key);
  }
}

let defaultStore: AttemptStore | null = null;

/**
 * The attempt store API handlers use when tests don't inject one:
 * Supabase (lockouts survive a restart and work across instances) when
 * the service key is configured, otherwise the in-process memory store.
 * Cached per process — building a client per request would be wasteful.
 */
export function getDefaultAttemptStore(): AttemptStore {
  if (!defaultStore) {
    try {
      defaultStore = new SupabaseAttemptStore(createServiceClient());
    } catch {
      // No Supabase / no service key: lockouts live in process memory.
      defaultStore = getMemoryAttemptStore();
    }
  }
  return defaultStore;
}
