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
