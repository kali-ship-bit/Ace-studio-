/**
 * Tests for the Supabase config rule and client singleton.
 * No test ever calls a real project, and no real credential appears
 * anywhere in this file.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { getSupabaseClient, getSupabaseConfig, resetSupabaseClientForTests } from "./supabase";

afterEach(() => {
  vi.unstubAllEnvs();
  resetSupabaseClientForTests();
});

describe("getSupabaseConfig", () => {
  it("returns null when the env vars are missing", () => {
    expect(getSupabaseConfig({})).toBeNull();
    expect(getSupabaseConfig({ VITE_SUPABASE_URL: "https://abc.supabase.co" })).toBeNull();
    expect(getSupabaseConfig({ VITE_SUPABASE_ANON_KEY: "some-key" })).toBeNull();
  });

  it("accepts a hosted Supabase project URL", () => {
    expect(
      getSupabaseConfig({
        VITE_SUPABASE_URL: "https://abc.supabase.co",
        VITE_SUPABASE_ANON_KEY: "some-key",
      }),
    ).toEqual({ url: "https://abc.supabase.co", anonKey: "some-key" });
  });

  it("accepts any https URL, so self-hosted and custom-domain projects work", () => {
    expect(
      getSupabaseConfig({
        VITE_SUPABASE_URL: "https://supabase.example.com",
        VITE_SUPABASE_ANON_KEY: "some-key",
      }),
    ).toEqual({ url: "https://supabase.example.com", anonKey: "some-key" });
  });

  it("accepts plain http only for a local Supabase", () => {
    for (const url of ["http://localhost:54321", "http://127.0.0.1:54321", "http://[::1]:54321"]) {
      expect(
        getSupabaseConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: "some-key" }),
      ).not.toBeNull();
    }
  });

  it("rejects plain http for a non-local host", () => {
    expect(
      getSupabaseConfig({
        VITE_SUPABASE_URL: "http://example.com",
        VITE_SUPABASE_ANON_KEY: "some-key",
      }),
    ).toBeNull();
  });

  it("rejects a value that is not a URL at all", () => {
    expect(
      getSupabaseConfig({
        VITE_SUPABASE_URL: "not-a-url",
        VITE_SUPABASE_ANON_KEY: "some-key",
      }),
    ).toBeNull();
  });
});

describe("getSupabaseClient", () => {
  it("returns null when Supabase is not configured", () => {
    expect(getSupabaseClient()).toBeNull();
  });

  it("builds a client once configured, and the reset clears the cached one", () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://abc.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "some-key");
    const first = getSupabaseClient();
    expect(first).not.toBeNull();
    expect(getSupabaseClient()).toBe(first);
    resetSupabaseClientForTests();
    const second = getSupabaseClient();
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
  });

  it("returns null again after a reset when the env is gone", () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://abc.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "some-key");
    expect(getSupabaseClient()).not.toBeNull();
    vi.unstubAllEnvs();
    resetSupabaseClientForTests();
    expect(getSupabaseClient()).toBeNull();
  });
});
