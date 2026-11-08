/**
 * Tests for the creator-dashboard admin gate and app-settings logic.
 * Every test uses a mocked Supabase client — no test ever calls a real
 * project, and no real credential appears anywhere in this file.
 */

import { describe, expect, it, vi } from "vitest";
import {
  ANNOUNCEMENT_MAX_LENGTH,
  authenticateAdmin,
  checkAdminStatus,
  CREATOR_ADMIN_EMAIL,
  decideAdminGate,
  displayProfileEmail,
  getCreatorAdminEmail,
  isCreatorAdminEmail,
  loadAppSettings,
  loadDashboardCounts,
  loadJobStatusCounts,
  loadProfilesPage,
  saveAppSetting,
  type ProfileRow,
} from "./admin";
import type { SupabaseClient } from "./supabase";

/* ------------------------------------------------------------------ */
/* Fake Supabase client                                                */
/* ------------------------------------------------------------------ */

interface FakeQueryResult {
  data?: unknown;
  error?: { message: string } | null;
  count?: number | null;
}

type FakeTableEntry = FakeQueryResult | ((q: FakeQuery) => FakeQueryResult);

class FakeQuery {
  result: FakeQueryResult;
  resolver?: (q: FakeQuery) => FakeQueryResult;
  updated: Record<string, unknown> | null = null;
  upserted: Record<string, unknown> | null = null;
  upsertOptions: Record<string, unknown> | null = null;
  eqKey: string | null = null;
  eqValue: unknown = null;
  rangeFrom: number | null = null;
  rangeTo: number | null = null;
  orCondition: string | null = null;
  ilikeColumn: string | null = null;
  ilikePattern: string | null = null;

  constructor(entry: FakeTableEntry | undefined) {
    if (typeof entry === "function") {
      this.resolver = entry;
      this.result = { data: null, error: null };
    } else {
      this.result = entry ?? { data: null, error: null };
    }
  }

  resolve(): FakeQueryResult {
    return this.resolver ? this.resolver(this) : this.result;
  }

  select(): this {
    return this;
  }

  eq(key: string, value: unknown): this {
    this.eqKey = key;
    this.eqValue = value;
    return this;
  }

  order(): this {
    return this;
  }

  limit(): this {
    return this;
  }

  range(from: number, to: number): this {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }

  or(condition: string): this {
    this.orCondition = condition;
    return this;
  }

  ilike(column: string, pattern: string): this {
    this.ilikeColumn = column;
    this.ilikePattern = pattern;
    return this;
  }

  update(payload: Record<string, unknown>): this {
    this.updated = payload;
    return this;
  }

  upsert(payload: Record<string, unknown>, options: Record<string, unknown>): this {
    this.upserted = payload;
    this.upsertOptions = options;
    return this;
  }

  async maybeSingle(): Promise<FakeQueryResult> {
    return this.resolve();
  }

  async single(): Promise<FakeQueryResult> {
    return this.resolve();
  }

  // Makes `await query` resolve to the preset result.
  then(
    onFulfilled: (value: FakeQueryResult) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ): Promise<unknown> {
    return Promise.resolve(this.resolve()).then(onFulfilled, onRejected);
  }
}

interface FakeClientOptions {
  tables?: Record<string, FakeTableEntry>;
  signIn?: {
    user: { id: string; email?: string } | null;
    error: { message: string } | null;
  };
  getUser?: { id: string } | null;
}

function fakeClient(options: FakeClientOptions = {}) {
  const queries: FakeQuery[] = [];
  const signOut = vi.fn().mockResolvedValue({ error: null });
  const signInWithPassword = vi.fn().mockResolvedValue({
    data: { user: options.signIn?.user ?? null },
    error: options.signIn?.error ?? null,
  });
  const getUser = vi.fn().mockResolvedValue({
    data: { user: options.getUser ?? null },
    error: null,
  });
  const client = {
    __queries: queries,
    __signOut: signOut,
    auth: { signInWithPassword, signOut, getUser },
    from(table: string): FakeQuery {
      const q = new FakeQuery(options.tables?.[table]);
      queries.push(q);
      return q;
    },
  };
  return client as unknown as SupabaseClient & {
    __queries: FakeQuery[];
    __signOut: ReturnType<typeof vi.fn>;
  };
}

const sampleProfiles: ProfileRow[] = [
  {
    id: "1",
    email: "ada@example.com",
    phone: "+2348012345678",
    country: "Nigeria",
    dial_code: "+234",
    is_admin: false,
    created_at: "2026-11-07T00:00:00Z",
  },
  {
    id: "2",
    email: "bob@example.com",
    phone: "+447700900123",
    country: "United Kingdom",
    dial_code: "+44",
    is_admin: true,
    created_at: "2026-11-06T00:00:00Z",
  },
];

/* ------------------------------------------------------------------ */
/* Admin gate                                                          */
/* ------------------------------------------------------------------ */

describe("decideAdminGate", () => {
  it("refuses when there is no profile row", () => {
    expect(decideAdminGate(null)).toBe("no-profile");
  });

  it("refuses a non-admin profile, even for the creator email", () => {
    expect(decideAdminGate({ is_admin: false, email: CREATOR_ADMIN_EMAIL })).toBe("not-admin");
  });

  it("allows the creator: admin flag AND the one allowlisted email", () => {
    expect(decideAdminGate({ is_admin: true, email: CREATOR_ADMIN_EMAIL })).toBe("allowed");
  });

  it("refuses an admin flag on any other email — there is no second admin", () => {
    expect(decideAdminGate({ is_admin: true, email: "bob@example.com" })).toBe("not-admin");
  });

  it("refuses an admin flag with no email on the row", () => {
    expect(decideAdminGate({ is_admin: true })).toBe("not-admin");
    expect(decideAdminGate({ is_admin: true, email: null })).toBe("not-admin");
  });

  it("matches the creator email case-insensitively", () => {
    expect(
      decideAdminGate({ is_admin: true, email: "  KennethKalizibeGoddyNatus@Gmail.com " }),
    ).toBe("allowed");
  });
});

describe("creator allowlist", () => {
  it("allows exactly Kenneth's email", () => {
    expect(isCreatorAdminEmail(CREATOR_ADMIN_EMAIL)).toBe(true);
    expect(isCreatorAdminEmail("kennethkalizibegoddynatus@gmail.com")).toBe(true);
  });

  it("matches case-insensitively and ignores surrounding spaces", () => {
    expect(isCreatorAdminEmail("  KENNETHKALIZIBEGODDYNATUS@GMAIL.COM ")).toBe(true);
  });

  it("denies every other email", () => {
    expect(isCreatorAdminEmail("bob@example.com")).toBe(false);
    expect(isCreatorAdminEmail("admin@ace-studio.app")).toBe(false);
    expect(isCreatorAdminEmail("kennethkalizibegoddynatus@gmail.com.evil.com")).toBe(false);
  });

  it("denies empty or missing emails", () => {
    expect(isCreatorAdminEmail("")).toBe(false);
    expect(isCreatorAdminEmail("   ")).toBe(false);
    expect(isCreatorAdminEmail(null)).toBe(false);
    expect(isCreatorAdminEmail(undefined)).toBe(false);
  });

  it("defaults to Kenneth's email and honours the env override", () => {
    expect(getCreatorAdminEmail({})).toBe(CREATOR_ADMIN_EMAIL);
    expect(getCreatorAdminEmail({ VITE_CREATOR_ADMIN_EMAIL: "  Other@Example.com " })).toBe(
      "other@example.com",
    );
    expect(
      isCreatorAdminEmail("other@example.com", {
        VITE_CREATOR_ADMIN_EMAIL: "other@example.com",
      }),
    ).toBe(true);
    expect(
      isCreatorAdminEmail(CREATOR_ADMIN_EMAIL, {
        VITE_CREATOR_ADMIN_EMAIL: "other@example.com",
      }),
    ).toBe(false);
  });
});

describe("checkAdminStatus", () => {
  it("returns admin for the creator's row: admin flag AND his email", async () => {
    const client = fakeClient({
      tables: {
        profiles: { data: { is_admin: true, email: CREATOR_ADMIN_EMAIL }, error: null },
      },
    });
    await expect(checkAdminStatus(client, "admin-1")).resolves.toBe("admin");
  });

  it("returns not-admin for a non-admin row or no row", async () => {
    const notAdmin = fakeClient({
      tables: {
        profiles: { data: { is_admin: false, email: CREATOR_ADMIN_EMAIL }, error: null },
      },
    });
    await expect(checkAdminStatus(notAdmin, "user-1")).resolves.toBe("not-admin");
    const noRow = fakeClient({
      tables: { profiles: { data: null, error: null } },
    });
    await expect(checkAdminStatus(noRow, "user-1")).resolves.toBe("not-admin");
  });

  it("returns not-admin when the admin flag sits on any other email", async () => {
    const client = fakeClient({
      tables: { profiles: { data: { is_admin: true, email: "bob@example.com" }, error: null } },
    });
    await expect(checkAdminStatus(client, "user-2")).resolves.toBe("not-admin");
  });

  it("returns error — not not-admin — when the database errors", async () => {
    const client = fakeClient({
      tables: { profiles: { data: null, error: { message: "connection lost" } } },
    });
    await expect(checkAdminStatus(client, "admin-1")).resolves.toBe("error");
  });
});

describe("authenticateAdmin", () => {
  it("refuses a non-admin: signs them out immediately and says so", async () => {
    const client = fakeClient({
      signIn: { user: { id: "user-1" }, error: null },
      tables: { profiles: { data: { is_admin: false }, error: null } },
    });
    const result = await authenticateAdmin(client, "user@example.com", "password");
    expect(result.outcome).toBe("not-admin");
    expect(result.user).toBeNull();
    expect(result.message).toBe("This dashboard is for the creator only.");
    expect(client.__signOut).toHaveBeenCalledTimes(1);
  });

  it("refuses a user with no profile row", async () => {
    const client = fakeClient({
      signIn: { user: { id: "user-1" }, error: null },
      tables: { profiles: { data: null, error: null } },
    });
    const result = await authenticateAdmin(client, "user@example.com", "password");
    expect(result.outcome).toBe("not-admin");
    expect(client.__signOut).toHaveBeenCalledTimes(1);
  });

  it("lets the creator in and does NOT sign them out", async () => {
    const client = fakeClient({
      signIn: { user: { id: "admin-1", email: CREATOR_ADMIN_EMAIL }, error: null },
      tables: { profiles: { data: { is_admin: true, email: CREATOR_ADMIN_EMAIL }, error: null } },
    });
    const result = await authenticateAdmin(client, CREATOR_ADMIN_EMAIL, "password");
    expect(result.outcome).toBe("allowed");
    expect(result.user?.id).toBe("admin-1");
    expect(client.__signOut).not.toHaveBeenCalled();
  });

  it("refuses a valid login from any other email even when the profile says admin", async () => {
    const client = fakeClient({
      signIn: { user: { id: "user-2", email: "bob@example.com" }, error: null },
      tables: { profiles: { data: { is_admin: true, email: "bob@example.com" }, error: null } },
    });
    const result = await authenticateAdmin(client, "bob@example.com", "password");
    expect(result.outcome).toBe("not-admin");
    expect(result.user).toBeNull();
    expect(result.message).toBe("This dashboard is for the creator only.");
    expect(client.__signOut).toHaveBeenCalledTimes(1);
  });

  it("judges by the signed-in account's email, not what was typed", async () => {
    const client = fakeClient({
      signIn: { user: { id: "user-2", email: "bob@example.com" }, error: null },
      tables: { profiles: { data: { is_admin: true, email: CREATOR_ADMIN_EMAIL }, error: null } },
    });
    const result = await authenticateAdmin(client, CREATOR_ADMIN_EMAIL, "password");
    expect(result.outcome).toBe("not-admin");
    expect(result.user).toBeNull();
    expect(client.__signOut).toHaveBeenCalledTimes(1);
  });

  it("gives no access without a login and never reads the profiles table", async () => {
    const client = fakeClient({
      signIn: { user: null, error: { message: "Invalid login credentials" } },
    });
    const result = await authenticateAdmin(client, CREATOR_ADMIN_EMAIL, "wrong");
    expect(result.outcome).toBe("login-failed");
    expect(result.user).toBeNull();
    expect(client.__queries).toHaveLength(0);
    expect(client.__signOut).not.toHaveBeenCalled();
  });

  it("reports a failed login with a generic message, not the raw auth error", async () => {
    const client = fakeClient({
      signIn: { user: null, error: { message: "Email not confirmed" } },
    });
    const result = await authenticateAdmin(client, "user@example.com", "wrong");
    expect(result.outcome).toBe("login-failed");
    expect(result.message).toBe("Email or password is wrong.");
    expect(result.message).not.toContain("Email not confirmed");
    expect(client.__signOut).not.toHaveBeenCalled();
  });

  it("reports a database error honestly instead of calling the user a non-admin", async () => {
    const client = fakeClient({
      signIn: { user: { id: "admin-1", email: CREATOR_ADMIN_EMAIL }, error: null },
      tables: { profiles: { data: null, error: { message: "connection lost" } } },
    });
    const result = await authenticateAdmin(client, CREATOR_ADMIN_EMAIL, "password");
    expect(result.outcome).toBe("error");
    expect(result.message).toBe(
      "Could not check whether this account is an admin. Please try again.",
    );
    expect(client.__signOut).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------ */
/* App settings                                                        */
/* ------------------------------------------------------------------ */

describe("saveAppSetting", () => {
  const savedRow = {
    data: { updated_at: "2026-11-07T12:00:00Z", updated_by: "admin-1" },
    error: null,
  };

  it("upserts with the right key and value, records who saved it, and returns the server timestamp", async () => {
    const client = fakeClient({ tables: { app_settings: savedRow } });
    const result = await saveAppSetting(client, "signup_open", false, "admin-1");
    const upsertQuery = client.__queries[0];
    expect(upsertQuery.upserted?.key).toBe("signup_open");
    expect(upsertQuery.upserted?.value).toBe(false);
    expect(upsertQuery.upserted?.updated_by).toBe("admin-1");
    // updated_at is NOT sent: the database trigger stamps it from the
    // database clock (migration 002), so the admin's device clock can
    // never write a wrong timestamp.
    expect(upsertQuery.upserted).not.toHaveProperty("updated_at");
    expect(upsertQuery.upsertOptions).toEqual({ onConflict: "key" });
    // The second query re-reads the row; the returned time is the server's, not the client's.
    const rereadQuery = client.__queries[1];
    expect(rereadQuery.eqKey).toBe("key");
    expect(rereadQuery.eqValue).toBe("signup_open");
    expect(result).toEqual({
      key: "signup_open",
      value: false,
      updatedAt: "2026-11-07T12:00:00Z",
      updatedBy: "admin-1",
    });
  });

  it("saves an announcement string under the announcement key", async () => {
    const client = fakeClient({ tables: { app_settings: savedRow } });
    const result = await saveAppSetting(client, "announcement", "Hello, creators!", "admin-1");
    expect(client.__queries[0].upserted?.value).toBe("Hello, creators!");
    expect(client.__queries[0].upserted?.key).toBe("announcement");
    expect(result.value).toBe("Hello, creators!");
  });

  it("does not send updated_by when no admin id is given", async () => {
    const client = fakeClient({ tables: { app_settings: savedRow } });
    await saveAppSetting(client, "maintenance_mode", true);
    expect(client.__queries[0].upserted).not.toHaveProperty("updated_by");
  });

  it("rejects an announcement over the limit without touching the database", async () => {
    const client = fakeClient({ tables: { app_settings: savedRow } });
    const tooLong = "x".repeat(ANNOUNCEMENT_MAX_LENGTH + 1);
    await expect(saveAppSetting(client, "announcement", tooLong, "admin-1")).rejects.toThrow(
      "500 characters or fewer",
    );
    expect(client.__queries).toHaveLength(0);
  });

  it("accepts an announcement exactly at the limit", async () => {
    const client = fakeClient({ tables: { app_settings: savedRow } });
    const atLimit = "x".repeat(ANNOUNCEMENT_MAX_LENGTH);
    const result = await saveAppSetting(client, "announcement", atLimit, "admin-1");
    expect(result.value).toBe(atLimit);
  });

  it("throws when the database rejects the write (RLS for non-admins)", async () => {
    const client = fakeClient({
      tables: { app_settings: { data: null, error: { message: "row-level security" } } },
    });
    await expect(saveAppSetting(client, "maintenance_mode", true, "user-1")).rejects.toThrow(
      "row-level security",
    );
  });
});

describe("loadAppSettings", () => {
  it("applies stored rows over the defaults and reports the latest update", async () => {
    const client = fakeClient({
      tables: {
        app_settings: {
          data: [
            { key: "signup_open", value: false, updated_at: "2026-11-07T10:00:00Z" },
            { key: "announcement", value: "New feature!", updated_at: "2026-11-07T12:00:00Z" },
          ],
          error: null,
        },
      },
    });
    const { settings, updatedAt } = await loadAppSettings(client);
    expect(settings.signup_open).toBe(false);
    expect(settings.maintenance_mode).toBe(false); // default kept
    expect(settings.announcement).toBe("New feature!");
    expect(updatedAt).toBe("2026-11-07T12:00:00Z");
  });

  it("returns defaults when there are no rows", async () => {
    const client = fakeClient({ tables: { app_settings: { data: [], error: null } } });
    const { settings, updatedAt } = await loadAppSettings(client);
    expect(settings).toEqual({ signup_open: true, maintenance_mode: false, announcement: "" });
    expect(updatedAt).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Dashboard data                                                      */
/* ------------------------------------------------------------------ */

describe("loadDashboardCounts", () => {
  it("returns the exact user and job counts", async () => {
    const client = fakeClient({
      tables: {
        profiles: { count: 12, error: null },
        jobs: { count: 34, error: null },
      },
    });
    await expect(loadDashboardCounts(client)).resolves.toEqual({
      userCount: 12,
      jobCount: 34,
    });
  });
});

describe("loadProfilesPage", () => {
  it("fetches the first page with an exact total, no search filter", async () => {
    const client = fakeClient({
      tables: { profiles: { data: sampleProfiles, count: 57, error: null } },
    });
    const page = await loadProfilesPage(client, {});
    expect(page).toEqual({ rows: sampleProfiles, total: 57 });
    const query = client.__queries[0];
    expect(query.rangeFrom).toBe(0);
    expect(query.rangeTo).toBe(24);
    expect(query.orCondition).toBeNull();
  });

  it("pages with .range() — page 2 of 10 per page asks for rows 20-29", async () => {
    const client = fakeClient({
      tables: { profiles: { data: [], count: 57, error: null } },
    });
    await loadProfilesPage(client, { page: 2, pageSize: 10 });
    const query = client.__queries[0];
    expect(query.rangeFrom).toBe(20);
    expect(query.rangeTo).toBe(29);
  });

  it("searches server-side with ilike on email or phone", async () => {
    const client = fakeClient({
      tables: { profiles: { data: [sampleProfiles[0]], count: 1, error: null } },
    });
    const page = await loadProfilesPage(client, { query: "ada" });
    expect(page.total).toBe(1);
    expect(client.__queries[0].orCondition).toBe("email.ilike.%ada%,phone.ilike.%ada%");
  });

  it("escapes LIKE wildcards in the search term so they match literally", async () => {
    const client = fakeClient({
      tables: { profiles: { data: [], count: 0, error: null } },
    });
    await loadProfilesPage(client, { query: "100%_x" });
    expect(client.__queries[0].orCondition).toBe(
      "email.ilike.%100\\%\\_x%,phone.ilike.%100\\%\\_x%",
    );
  });

  it("falls back to an email-only search when the term would break or() syntax", async () => {
    const client = fakeClient({
      tables: { profiles: { data: [], count: 0, error: null } },
    });
    await loadProfilesPage(client, { query: "last, first" });
    const query = client.__queries[0];
    expect(query.orCondition).toBeNull();
    expect(query.ilikeColumn).toBe("email");
    expect(query.ilikePattern).toBe("%last, first%");
  });

  it("throws when the database rejects the query", async () => {
    const client = fakeClient({
      tables: { profiles: { data: null, count: null, error: { message: "db down" } } },
    });
    await expect(loadProfilesPage(client, {})).rejects.toThrow("db down");
  });
});

describe("loadJobStatusCounts", () => {
  it("counts jobs per status with exact-count queries and fetches no rows", async () => {
    const perStatus: Record<string, number> = { queued: 2, running: 1, done: 5, failed: 0 };
    const client = fakeClient({
      tables: {
        jobs: (q) => ({ count: perStatus[q.eqValue as string] ?? 0, error: null }),
      },
    });
    await expect(loadJobStatusCounts(client)).resolves.toEqual({
      queued: 2,
      running: 1,
      done: 5,
      failed: 0,
    });
    expect(client.__queries).toHaveLength(4);
    for (const q of client.__queries) {
      expect(q.eqKey).toBe("status");
    }
    expect(client.__queries.map((q) => q.eqValue).sort()).toEqual([
      "done",
      "failed",
      "queued",
      "running",
    ]);
  });

  it("throws when any status count query fails", async () => {
    const client = fakeClient({
      tables: { jobs: { count: null, error: { message: "db down" } } },
    });
    await expect(loadJobStatusCounts(client)).rejects.toThrow("db down");
  });
});

describe("displayProfileEmail", () => {
  it("shows the email when present", () => {
    expect(displayProfileEmail(sampleProfiles[0])).toBe("ada@example.com");
  });

  it("shows the user id when the email is blank or whitespace", () => {
    expect(displayProfileEmail({ id: "user-9", email: "" })).toBe("user-9");
    expect(displayProfileEmail({ id: "user-9", email: "   " })).toBe("user-9");
  });
});
