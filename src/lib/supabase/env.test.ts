import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getSiteUrl, getSupabaseConfig, isSupabaseConfigured } from "./env";
import { resetDevVarsCache } from "../jobs/env";

const KEYS = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SITE_URL"];

describe("Supabase config", () => {
  beforeEach(() => {
    resetDevVarsCache();
    for (const key of KEYS) delete process.env[key];
  });
  afterEach(() => {
    resetDevVarsCache();
    for (const key of KEYS) delete process.env[key];
  });

  it("is not configured when nothing is set", () => {
    expect(getSupabaseConfig()).toBeNull();
    expect(isSupabaseConfigured()).toBe(false);
  });

  it("reads URL + publishable key from env, service key optional", () => {
    process.env["SUPABASE_URL"] = "https://abcdef.supabase.co";
    process.env["SUPABASE_ANON_KEY"] = "anon-key";
    expect(getSupabaseConfig()).toEqual({
      url: "https://abcdef.supabase.co",
      anonKey: "anon-key",
      serviceRoleKey: undefined,
    });
    expect(isSupabaseConfigured()).toBe(true);
  });

  it("accepts any https URL (hosted, custom-domain, or self-hosted)", () => {
    process.env["SUPABASE_URL"] = "https://db.example.com";
    process.env["SUPABASE_ANON_KEY"] = "anon-key";
    expect(getSupabaseConfig()?.url).toBe("https://db.example.com");
  });

  it("accepts a local http URL for development, rejects other http URLs", () => {
    process.env["SUPABASE_URL"] = "http://localhost:54321";
    process.env["SUPABASE_ANON_KEY"] = "anon-key";
    expect(getSupabaseConfig()?.url).toBe("http://localhost:54321");

    process.env["SUPABASE_URL"] = "http://evil.example.com";
    expect(getSupabaseConfig()).toBeNull();
  });

  it("rejects a value that is not a URL at all", () => {
    process.env["SUPABASE_URL"] = "not-a-url";
    process.env["SUPABASE_ANON_KEY"] = "anon-key";
    expect(getSupabaseConfig()).toBeNull();
  });

  it("reads the service key when present", () => {
    process.env["SUPABASE_URL"] = "https://abcdef.supabase.co";
    process.env["SUPABASE_ANON_KEY"] = "anon-key";
    process.env["SUPABASE_SERVICE_ROLE_KEY"] = "service-key";
    expect(getSupabaseConfig()?.serviceRoleKey).toBe("service-key");
  });
});

describe("getSiteUrl — reset links never come from the request Host header", () => {
  it("returns the configured https origin", () => {
    process.env["SITE_URL"] = "https://ace-studio.example.com";
    expect(getSiteUrl()).toBe("https://ace-studio.example.com");
  });

  it("accepts http only for localhost, and returns undefined when unset or invalid", () => {
    process.env["SITE_URL"] = "http://localhost:5173";
    expect(getSiteUrl()).toBe("http://localhost:5173");
    process.env["SITE_URL"] = "http://evil.example.com";
    expect(getSiteUrl()).toBeUndefined();
    process.env["SITE_URL"] = "not-a-url";
    expect(getSiteUrl()).toBeUndefined();
    delete process.env["SITE_URL"];
    expect(getSiteUrl()).toBeUndefined();
  });
});
