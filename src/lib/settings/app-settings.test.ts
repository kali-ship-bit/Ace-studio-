import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPublicAppSettings, handleAppSettingsApi, resetAppSettingsCache } from "./app-settings";

function fakeClient(rows: Array<{ key: string; value: unknown }>, calls: { n: number }) {
  const client = {
    from: () => ({
      select: () => ({
        in: async () => {
          calls.n += 1;
          return { data: rows, error: null };
        },
      }),
    }),
  };
  return client as unknown as SupabaseClient;
}

function failingClient() {
  const client = {
    from: () => ({
      select: () => ({
        in: async () => ({ data: null, error: { message: "db down" } }),
      }),
    }),
  };
  return client as unknown as SupabaseClient;
}

describe("getPublicAppSettings", () => {
  it("reads maintenance mode and announcement from app_settings", async () => {
    resetAppSettingsCache();
    const calls = { n: 0 };
    const settings = await getPublicAppSettings({
      isSupabaseConfigured: () => true,
      serviceClient: fakeClient(
        [
          { key: "maintenance_mode", value: true },
          { key: "announcement", value: "New stories every morning." },
        ],
        calls,
      ),
    });
    expect(settings).toEqual({
      maintenanceMode: true,
      announcement: "New stories every morning.",
    });
  });

  it("defaults when rows are missing and caches for 30 seconds", async () => {
    resetAppSettingsCache();
    const calls = { n: 0 };
    const deps = {
      isSupabaseConfigured: () => true,
      serviceClient: fakeClient([], calls),
    };
    expect(await getPublicAppSettings(deps)).toEqual({
      maintenanceMode: false,
      announcement: "",
    });
    // Second call inside the cache window does not hit the database.
    expect(await getPublicAppSettings(deps)).toEqual({
      maintenanceMode: false,
      announcement: "",
    });
    expect(calls.n).toBe(1);
  });

  it("fails open to the defaults when the database read fails", async () => {
    resetAppSettingsCache();
    const settings = await getPublicAppSettings({
      isSupabaseConfigured: () => true,
      serviceClient: failingClient(),
    });
    expect(settings).toEqual({ maintenanceMode: false, announcement: "" });
  });

  it("fails open to the defaults when Supabase is not configured", async () => {
    resetAppSettingsCache();
    const settings = await getPublicAppSettings({ isSupabaseConfigured: () => false });
    expect(settings).toEqual({ maintenanceMode: false, announcement: "" });
  });
});

describe("GET /api/app-settings", () => {
  it("returns the public settings as JSON", async () => {
    resetAppSettingsCache();
    const calls = { n: 0 };
    const res = await handleAppSettingsApi(new Request("http://localhost/api/app-settings"), {
      isSupabaseConfigured: () => true,
      serviceClient: fakeClient([{ key: "announcement", value: "Hello." }], calls),
    });
    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({ maintenanceMode: false, announcement: "Hello." });
  });

  it("returns null for other paths", async () => {
    expect(await handleAppSettingsApi(new Request("http://localhost/api/other"))).toBeNull();
  });
});
