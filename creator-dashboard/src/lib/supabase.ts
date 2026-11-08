/**
 * Supabase client for the Creator Dashboard.
 *
 * SEPARATE app, SAME Supabase project as the main Ace Studio app.
 * Only two values are ever used here, both public by design:
 *   VITE_SUPABASE_URL       e.g. https://<ref>.supabase.co
 *   VITE_SUPABASE_ANON_KEY  the publishable key. It is useless without
 *                           Row Level Security, which is ON for every
 *                           table (see supabase/migrations/
 *                           001_ace-studio_foundation.sql in the main app).
 *
 * The service-role (secret) key is NEVER used in this app. It bypasses
 * Row Level Security, so it must never appear in a browser app, in code,
 * in a test, in a log, or in git. Every read and write below goes
 * through RLS as the logged-in user.
 *
 * When the env vars are missing, there is no client at all:
 * getSupabaseClient() returns null and the UI shows
 * "Supabase is not configured" instead of crashing.
 */

import {
  createClient,
  type AuthError,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";

export type { SupabaseClient, User };

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

/**
 * The configured Supabase project, or null when it is not set up yet.
 * Reads import.meta.env so tests can control it via vitest env handling;
 * in the browser Vite injects the VITE_ vars at build time.
 *
 * URL rule (mirrors the main app's src/lib/supabase/env.ts): any https
 * URL works — hosted Supabase, a custom domain, or a self-hosted
 * instance — plus plain http only for a local Supabase (localhost /
 * 127.0.0.1 / [::1]) during development. Anything else is not a usable
 * Supabase URL and counts as "not configured".
 */
export function getSupabaseConfig(
  env: Record<string, string | undefined> = import.meta.env,
): SupabaseConfig | null {
  const url = env.VITE_SUPABASE_URL?.trim();
  const anonKey = env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const isLocalHttp =
    parsed.protocol === "http:" &&
    (parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "[::1]");
  if (parsed.protocol !== "https:" && !isLocalHttp) return null;
  return { url: parsed.origin, anonKey };
}

/** True when a Supabase project is configured (URL + publishable key). */
export function isSupabaseConfigured(): boolean {
  return getSupabaseConfig() !== null;
}

let clientSingleton: SupabaseClient | null | undefined;

/** The shared client, or null when Supabase is not configured. */
export function getSupabaseClient(): SupabaseClient | null {
  if (clientSingleton !== undefined) return clientSingleton;
  const config = getSupabaseConfig();
  if (!config) {
    clientSingleton = null;
    return null;
  }
  clientSingleton = createClient(config.url, config.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return clientSingleton;
}

/**
 * Test-only reset for the client singleton. The singleton caches null
 * forever once read, so a test that changes the env (or a test that runs
 * after one that already read a null config) must clear it first, or it
 * would keep seeing the stale cached value. Never called by app code.
 */
export function resetSupabaseClientForTests(): void {
  clientSingleton = undefined;
}

/** Who is logged in right now, or null (not logged in / session expired). */
export async function getSessionUser(client: SupabaseClient): Promise<User | null> {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}

/** Log out the current user. Returns the error, if any. */
export async function signOut(client: SupabaseClient): Promise<AuthError | null> {
  const { error } = await client.auth.signOut();
  return error;
}
