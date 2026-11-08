/**
 * Supabase configuration (Phase A).
 *
 * The app talks to Supabase only through these names — nothing is pasted
 * into code:
 *   SUPABASE_URL             e.g. https://<ref>.supabase.co
 *   SUPABASE_ANON_KEY        the publishable key (safe to ship in the
 *                            browser — Supabase designed it that way; it
 *                            is useless without Row Level Security, which
 *                            is why RLS is on every table).
 *   SUPABASE_SERVICE_ROLE_KEY  the secret key. SERVER ONLY. It bypasses
 *                            Row Level Security, so it must never appear
 *                            in a component, a VITE_ variable, a log, a
 *                            test, or git. Local dev reads it from a
 *                            gitignored .dev.vars file; in production it
 *                            comes from hosting secrets.
 *
 * Resolution order: real process env first, then .dev.vars (local dev).
 * When Supabase is not configured, auth and the Supabase job store answer
 * with a clear "not configured" error instead of crashing — the demo
 * parts of the app keep working.
 */

import { readDevVars } from "../jobs/env";

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  /** Undefined when no secret key is configured (normal for the browser). */
  serviceRoleKey: string | undefined;
}

function readVar(name: string): string | undefined {
  const fromEnv = process.env[name]?.trim();
  if (fromEnv) return fromEnv;
  return readDevVars()[name]?.trim() || undefined;
}

/** The Supabase URL must be an https URL (any host, so self-hosted and
 *  custom-domain projects work) or a local http URL for development. */
export function getSupabaseConfig(): SupabaseConfig | null {
  const url = readVar("SUPABASE_URL");
  const anonKey = readVar("SUPABASE_ANON_KEY");
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
  return { url: parsed.origin, anonKey, serviceRoleKey: readVar("SUPABASE_SERVICE_ROLE_KEY") };
}

/** True when a Supabase project is configured (URL + publishable key). */
export function isSupabaseConfigured(): boolean {
  return getSupabaseConfig() !== null;
}

/**
 * The site's own public URL (SITE_URL), used to build password-reset
 * links. Never derived from the request's Host header — an attacker
 * controls that header, and a reset link carrying a token must only ever
 * point at this site. Returns undefined when not configured; callers
 * then let Supabase use its own dashboard-configured site URL.
 */
export function getSiteUrl(): string | undefined {
  const raw = process.env["SITE_URL"]?.trim() || readDevVars()["SITE_URL"]?.trim() || undefined;
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol === "https:") return url.origin;
    // Plain http is only acceptable for local development.
    if (
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]")
    ) {
      return url.origin;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** Storage bucket names (created by migration 001). */
export const AVATARS_BUCKET = "avatars";
export const JOB_OUTPUTS_BUCKET = "job-outputs";
