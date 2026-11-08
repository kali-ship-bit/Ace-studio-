/**
 * Public app settings — the switches the creator dashboard changes
 * (server-side only).
 *
 * The dashboard's Maintenance mode and Announcement toggles used to
 * write rows nobody read: flipping Maintenance mode on changed nothing,
 * and an announcement was stored but never shown. This module is the
 * reader that makes both toggles real:
 *   - `maintenance_mode` is checked in src/server.ts before any page
 *     renders (API routes stay live, so the dashboard can turn it off).
 *   - `announcement` is served by GET /api/app-settings and shown as a
 *     banner by the root layout.
 *
 * Reads run through the SERVICE client: the app_settings RLS policy
 * only lets signed-in users read, so the anonymous key cannot see these
 * rows at all. Results are cached in memory for 30 seconds — a page
 * load must not hit the database every time, and a toggle flip shows up
 * within half a minute.
 *
 * Fail-open to the defaults when Supabase is not configured or the read
 * fails: a database outage must not take the whole app down, and a
 * missing row means "never set", not "broken".
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "../supabase/client";
import { isSupabaseConfigured } from "../supabase/env";

export interface PublicAppSettings {
  maintenanceMode: boolean;
  announcement: string;
}

export const PUBLIC_APP_SETTINGS_DEFAULTS: PublicAppSettings = {
  maintenanceMode: false,
  announcement: "",
};

/** Cache lifetime: a dashboard toggle shows up within this long. */
const SETTINGS_CACHE_MS = 30_000;

export interface AppSettingsDeps {
  /** Client that can read app_settings (default: the service client). */
  serviceClient?: SupabaseClient;
  /** Is Supabase configured (default: isSupabaseConfigured). */
  isSupabaseConfigured?: () => boolean;
}

let cached: { at: number; value: PublicAppSettings } | null = null;

/** Forget the cached settings (tests, and any future admin "apply now"). */
export function resetAppSettingsCache(): void {
  cached = null;
}

export async function getPublicAppSettings(deps: AppSettingsDeps = {}): Promise<PublicAppSettings> {
  const now = Date.now();
  if (cached && now - cached.at < SETTINGS_CACHE_MS) return cached.value;
  const value = await readPublicAppSettings(deps);
  cached = { at: now, value };
  return value;
}

async function readPublicAppSettings(deps: AppSettingsDeps): Promise<PublicAppSettings> {
  const configured = deps.isSupabaseConfigured ?? isSupabaseConfigured;
  if (!configured()) return { ...PUBLIC_APP_SETTINGS_DEFAULTS };
  try {
    const buildClient = deps.serviceClient
      ? () => deps.serviceClient as SupabaseClient
      : () => createServiceClient();
    const client = buildClient();
    const { data, error } = await client
      .from("app_settings")
      .select("key, value")
      .in("key", ["maintenance_mode", "announcement"]);
    if (error) {
      console.error("Ace Studio settings: could not read app_settings, using defaults.", error);
      return { ...PUBLIC_APP_SETTINGS_DEFAULTS };
    }
    const settings: PublicAppSettings = { ...PUBLIC_APP_SETTINGS_DEFAULTS };
    for (const row of (data ?? []) as { key?: string; value?: unknown }[]) {
      if (row.key === "maintenance_mode" && typeof row.value === "boolean") {
        settings.maintenanceMode = row.value;
      } else if (row.key === "announcement" && typeof row.value === "string") {
        settings.announcement = row.value;
      }
    }
    return settings;
  } catch (error) {
    console.error("Ace Studio settings: could not read app_settings, using defaults.", error);
    return { ...PUBLIC_APP_SETTINGS_DEFAULTS };
  }
}

/**
 * GET /api/app-settings — the public switches, for the root layout's
 * announcement banner. No auth: the values are meant to be shown to
 * every visitor. Returns null for any other path so the server can
 * fall through to the next handler.
 */
export async function handleAppSettingsApi(
  request: Request,
  deps: AppSettingsDeps = {},
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/app-settings") return null;
  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }
  const settings = await getPublicAppSettings(deps);
  return new Response(
    JSON.stringify({
      maintenanceMode: settings.maintenanceMode,
      announcement: settings.announcement,
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );
}
