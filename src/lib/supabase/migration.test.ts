import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Tripwire tests for the migration SQL. The migration itself can only be
 * proved live once the Supabase project exists, but these tests make sure
 * nobody accidentally deletes the security guards while editing the file.
 * They read the SQL as text — they do not run a database.
 */
const SQL = readFileSync(
  join(process.cwd(), "supabase/migrations/001_ace-studio_foundation.sql"),
  "utf-8",
);

const SQL_003 = readFileSync(
  join(process.cwd(), "supabase/migrations/003_profile_fields.sql"),
  "utf-8",
);

describe("migration 001 — security tripwires", () => {
  it("blocks ordinary users from granting themselves admin (trigger)", () => {
    expect(SQL).toContain("prevent_is_admin_change");
    expect(SQL).toContain("profiles_guard_is_admin");
    expect(SQL).toContain("before insert or update on public.profiles");
    expect(SQL).toContain("is_admin is distinct from old.is_admin");
    // Only the database owner (SQL Editor) or the service role may do it.
    expect(SQL).toContain("current_user not in ('postgres', 'service_role')");
  });

  it("gives every trigger function a fixed search_path", () => {
    // set_updated_at() was missing this once — the search-path hijack
    // surface. Check each function definition carries it.
    const updatedAt = SQL.slice(SQL.indexOf("function public.set_updated_at()"));
    expect(updatedAt.slice(0, 200)).toContain("set search_path = public");
    const guard = SQL.slice(SQL.indexOf("function public.prevent_is_admin_change()"));
    expect(guard.slice(0, 200)).toContain("set search_path = public");
  });

  it("enables RLS on every table", () => {
    for (const table of ["profiles", "jobs", "app_settings", "auth_attempts"]) {
      expect(SQL).toContain(`alter table public.${table} enable row level security`);
    }
  });

  it("has no dead updated_at column on auth_attempts (nothing maintains it)", () => {
    const block = SQL.slice(SQL.indexOf("create table if not exists public.auth_attempts"));
    expect(block.slice(0, 600)).not.toContain("updated_at");
  });
});

describe("migration 003 — profile fields", () => {
  it("adds display_name, username and bio to profiles", () => {
    for (const column of ["display_name", "username", "bio"]) {
      expect(SQL_003).toContain(`add column if not exists ${column} text`);
    }
  });

  it("caps the field lengths in the database, not just the UI", () => {
    expect(SQL_003).toContain("char_length(display_name) <= 50");
    expect(SQL_003).toContain("char_length(bio) <= 160");
    expect(SQL_003).toContain("username ~ '^[a-z0-9_]{3,30}$'");
  });

  it("keeps usernames unique without blocking users who have none yet", () => {
    expect(SQL_003).toContain("profiles_username_unique_idx");
    expect(SQL_003).toContain("create unique index");
    expect(SQL_003).toContain("where username is not null");
  });
});
