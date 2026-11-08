/**
 * Creator-dashboard admin logic.
 *
 * Admin-only means TWO layers, never just hiding a button:
 *   1. This file's login check — only ONE email can ever enter (see
 *      CREATOR_ADMIN_EMAIL below): anyone else is signed out
 *      immediately after login and never sees the dashboard.
 *   2. Row Level Security in Supabase — the "profiles: read own or
 *      admin" and "app_settings: write for admins" policies decide what
 *      the database actually returns or accepts. Even if this UI check
 *      were bypassed, a non-admin still could not read other users or
 *      change a setting.
 *
 * The functions here take the Supabase client as a parameter so tests
 * can pass a mocked client — no test ever calls a real project.
 *
 * NOTE on login lockout: this dashboard signs in directly with
 * Supabase Auth (signInWithPassword) and does NOT reuse the main app's
 * 3-strike IP lockout. That lockout lives in the main app's
 * /api/auth/login route, which answers with HttpOnly session cookies for
 * the main app's own origin and never returns tokens in its JSON body —
 * so this separate app cannot call it and then setSession() with the
 * result. Brute-force protection here therefore relies on Supabase
 * Auth's own built-in sign-in rate limiting, not on the main app's
 * lockout. Do not invent a second lockout in this app without a
 * server-side store for it (the browser cannot be trusted to count
 * its own failed attempts).
 */

import { signOut, type SupabaseClient, type User } from "./supabase";

/* ------------------------------------------------------------------ */
/* Creator allowlist — exactly ONE email, ever                        */
/* ------------------------------------------------------------------ */

/**
 * The one and only email that can log in to the creator dashboard:
 * Kenneth's email. This is the single source of truth for the
 * allowlist — the same idea as the Mochris Ventures allowed-admins
 * list, but with exactly one email instead of three. There is no
 * second admin, ever.
 *
 * An email address is contact information, not a secret, so it is
 * fine to keep it in code and in docs. It is never a key, token or
 * password, and it gives nobody access on its own — the password and
 * the is_admin flag (set once in the SQL Editor, see
 * SUPABASE_SETUP.md in the main app) are still required.
 *
 * Env override: set VITE_CREATOR_ADMIN_EMAIL (in .env or in the
 * hosting dashboard) to change it without editing code. It must
 * still be exactly one email — never a list.
 */
export const CREATOR_ADMIN_EMAIL = "kennethkalizibegoddynatus@gmail.com";

/**
 * The allowlisted creator email: the VITE_CREATOR_ADMIN_EMAIL
 * override when one is set, else the code default above.
 */
export function getCreatorAdminEmail(
  env: Record<string, string | undefined> = import.meta.env,
): string {
  const override = env.VITE_CREATOR_ADMIN_EMAIL?.trim().toLowerCase();
  return override || CREATOR_ADMIN_EMAIL;
}

/**
 * Case-insensitive check against the one allowlisted creator email.
 * An empty or missing email never matches.
 */
export function isCreatorAdminEmail(
  email: string | null | undefined,
  env: Record<string, string | undefined> = import.meta.env,
): boolean {
  const candidate = (email ?? "").trim().toLowerCase();
  if (!candidate) return false;
  return candidate === getCreatorAdminEmail(env);
}

/* ------------------------------------------------------------------ */
/* Admin gate                                                         */
/* ------------------------------------------------------------------ */

export type AdminGateResult = "allowed" | "not-admin" | "no-profile";

/**
 * Pure decision: given the profile row (or null when there is none),
 * is this user allowed into the creator dashboard?
 *
 * BOTH must hold: the profile's is_admin flag (set once in the SQL
 * Editor — the database trigger stops any user setting it themselves)
 * AND the profile's email must be the one allowlisted creator email.
 * An is_admin=true row for any other email is denied: the flag is
 * only ever set for that one email (see SUPABASE_SETUP.md in the main
 * app), so a mismatch means the data is wrong, not that a second
 * admin exists.
 */
export function decideAdminGate(
  profile: { is_admin?: boolean; email?: string | null } | null,
): AdminGateResult {
  if (!profile) return "no-profile";
  if (profile.is_admin !== true) return "not-admin";
  return isCreatorAdminEmail(profile.email ?? null) ? "allowed" : "not-admin";
}

/**
 * Tri-state admin check. A database error is "error", NOT "not-admin":
 * a transient failure must never be reported as "you are not the
 * creator" (and must never sign a real admin out with that message).
 * Callers decide what to do with "error" — fail closed, but say so
 * honestly. Any error (or no row) never fails open.
 *
 * The profile row's email is read too: decideAdminGate requires the
 * is_admin flag AND the one allowlisted creator email, so this check
 * (which App.tsx re-runs on every auth state change) keeps enforcing
 * the one-email rule for as long as the session lasts.
 */
export type AdminStatus = "admin" | "not-admin" | "error";

export async function checkAdminStatus(
  client: SupabaseClient,
  userId: string,
): Promise<AdminStatus> {
  const { data, error } = await client
    .from("profiles")
    .select("is_admin, email")
    .eq("id", userId)
    .maybeSingle();
  if (error) return "error";
  return decideAdminGate(data) === "allowed" ? "admin" : "not-admin";
}

export interface AdminLoginResult {
  outcome: "allowed" | "not-admin" | "login-failed" | "error";
  user: User | null;
  message: string;
}

/**
 * Log in with email + password, then check the creator allowlist and
 * the admin flag. A non-creator (or a user with no profile row) is
 * signed out immediately and refused with "This dashboard is for the
 * creator only." A database error while checking the admin flag signs
 * the user out too (fail closed), but says so honestly instead of
 * pretending they are not the creator.
 *
 * The login-failed message is deliberately generic: the raw Supabase
 * auth error is never shown, because it can disclose account state
 * (e.g. whether the email exists or is unconfirmed).
 */
export async function authenticateAdmin(
  client: SupabaseClient,
  email: string,
  password: string,
): Promise<AdminLoginResult> {
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.user) {
    return {
      outcome: "login-failed",
      user: null,
      message: "Email or password is wrong.",
    };
  }
  // First gate: the signed-in account must be the one creator email.
  // This runs before any database read — a valid login from any other
  // email is refused immediately, even if that account somehow had
  // is_admin set. The auth user's email is authoritative; the typed
  // email is only a fallback (after a successful sign-in they are the
  // same address).
  if (!isCreatorAdminEmail(data.user.email ?? email)) {
    await signOut(client);
    return {
      outcome: "not-admin",
      user: null,
      message: "This dashboard is for the creator only.",
    };
  }
  const status = await checkAdminStatus(client, data.user.id);
  if (status === "admin") {
    return { outcome: "allowed", user: data.user, message: "" };
  }
  await signOut(client);
  if (status === "error") {
    return {
      outcome: "error",
      user: null,
      message: "Could not check whether this account is an admin. Please try again.",
    };
  }
  return {
    outcome: "not-admin",
    user: null,
    message: "This dashboard is for the creator only.",
  };
}

/* ------------------------------------------------------------------ */
/* Dashboard data — every read/write goes through RLS as this user    */
/* ------------------------------------------------------------------ */

export interface ProfileRow {
  id: string;
  email: string;
  phone: string | null;
  country: string | null;
  dial_code: string | null;
  is_admin: boolean;
  created_at: string;
}

/** What to show in the email cell when the stored email is blank. */
export function displayProfileEmail(profile: Pick<ProfileRow, "id" | "email">): string {
  const email = (profile.email ?? "").trim();
  return email ? email : profile.id;
}

export interface DashboardCounts {
  userCount: number;
  jobCount: number;
}

/** Total users + total jobs (exact counts; no rows are fetched). */
export async function loadDashboardCounts(client: SupabaseClient): Promise<DashboardCounts> {
  const [{ count: userCount, error: userError }, { count: jobCount, error: jobError }] =
    await Promise.all([
      client.from("profiles").select("id", { count: "exact", head: true }),
      client.from("jobs").select("id", { count: "exact", head: true }),
    ]);
  if (userError) throw new Error(userError.message);
  if (jobError) throw new Error(jobError.message);
  return { userCount: userCount ?? 0, jobCount: jobCount ?? 0 };
}

export const PROFILES_PAGE_SIZE = 25;

export interface ProfilesPage {
  rows: ProfileRow[];
  /** Exact total across all pages (from the server count, not the page). */
  total: number;
}

export interface LoadProfilesOptions {
  page?: number;
  pageSize?: number;
  /** Server-side search on email or phone; empty means no filter. */
  query?: string;
}

/** Escape the LIKE wildcards in a user search term so it matches literally. */
function escapeIlikePattern(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/**
 * One page of profiles, newest first, with server-side search and an
 * exact total. Search runs in the database (ilike on email or phone),
 * so it searches every user, not just the page already loaded.
 * Note: a search term containing a comma, parenthesis or quote would
 * break PostgREST's or() syntax, so such terms fall back to matching
 * the email only — still server-side, just narrower.
 */
export async function loadProfilesPage(
  client: SupabaseClient,
  options: LoadProfilesOptions = {},
): Promise<ProfilesPage> {
  const page = Math.max(0, options.page ?? 0);
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? PROFILES_PAGE_SIZE));
  const q = (options.query ?? "").trim();
  let query = client
    .from("profiles")
    .select("id, email, phone, country, dial_code, is_admin, created_at", { count: "exact" })
    .order("created_at", { ascending: false });
  if (q) {
    const pattern = `%${escapeIlikePattern(q)}%`;
    if (/[,()"']/.test(q)) {
      query = query.ilike("email", pattern);
    } else {
      query = query.or(`email.ilike.${pattern},phone.ilike.${pattern}`);
    }
  }
  const { data, error, count } = await query.range(page * pageSize, page * pageSize + pageSize - 1);
  if (error) throw new Error(error.message);
  return { rows: (data ?? []) as ProfileRow[], total: count ?? 0 };
}

export type JobStatus = "queued" | "running" | "done" | "failed";
export type JobStatusCounts = Record<JobStatus, number>;

export const JOB_STATUSES: JobStatus[] = ["queued", "running", "done", "failed"];

/**
 * How many jobs are in each status (admin sees every user's jobs).
 * One exact-count query per status — no job rows are fetched, so the
 * counts stay correct (and cheap) past 5,000 jobs.
 */
export async function loadJobStatusCounts(client: SupabaseClient): Promise<JobStatusCounts> {
  const results = await Promise.all(
    JOB_STATUSES.map((status) =>
      client.from("jobs").select("id", { count: "exact", head: true }).eq("status", status),
    ),
  );
  const counts: JobStatusCounts = { queued: 0, running: 0, done: 0, failed: 0 };
  for (let i = 0; i < JOB_STATUSES.length; i++) {
    const { count, error } = results[i];
    if (error) throw new Error(error.message);
    counts[JOB_STATUSES[i]] = count ?? 0;
  }
  return counts;
}

/* ------------------------------------------------------------------ */
/* App settings — the "change things in the app" part                 */
/* ------------------------------------------------------------------ */

export type AppSettingKey = "signup_open" | "maintenance_mode" | "announcement";

export interface AppSettings {
  signup_open: boolean;
  maintenance_mode: boolean;
  announcement: string;
}

export const APP_SETTING_DEFAULTS: AppSettings = {
  signup_open: true,
  maintenance_mode: false,
  announcement: "",
};

/** Longest announcement the app will store — enforced here, not just in the textarea. */
export const ANNOUNCEMENT_MAX_LENGTH = 500;

/** Read the app_settings rows. Defaults apply when a row is missing. */
export async function loadAppSettings(
  client: SupabaseClient,
): Promise<{ settings: AppSettings; updatedAt: string | null }> {
  const { data, error } = await client.from("app_settings").select("key, value, updated_at");
  if (error) throw new Error(error.message);
  const settings: AppSettings = { ...APP_SETTING_DEFAULTS };
  let updatedAt: string | null = null;
  for (const row of (data ?? []) as {
    key?: string;
    value?: unknown;
    updated_at?: string | null;
  }[]) {
    if (row.key === "signup_open" && typeof row.value === "boolean") {
      settings.signup_open = row.value;
    } else if (row.key === "maintenance_mode" && typeof row.value === "boolean") {
      settings.maintenance_mode = row.value;
    } else if (row.key === "announcement" && typeof row.value === "string") {
      settings.announcement = row.value;
    }
    if (row.updated_at && (!updatedAt || row.updated_at > updatedAt)) {
      updatedAt = row.updated_at;
    }
  }
  return { settings, updatedAt };
}

export interface SaveSettingResult {
  key: AppSettingKey;
  value: boolean | string;
  /** The row's updated_at as the server stored it — never the client clock. */
  updatedAt: string;
  /** Who last saved it (app_settings.updated_by), if the row carries it. */
  updatedBy: string | null;
}

/**
 * Save one app setting. Writes through the anon client, so the RLS
 * policy "app_settings: write for admins" is what actually allows it —
 * a non-admin's write is rejected by the database, not just by the UI.
 *
 * Uses upsert, not update: a plain update silently succeeds when the
 * row does not exist (zero rows matched, no error), so a missing row
 * used to look like a saved setting. Upsert creates the row when it is
 * missing. The row is then re-read, so the returned updatedAt is the
 * server's timestamp and updatedBy is who saved it.
 *
 * @param updatedBy the admin's user id, recorded in app_settings.updated_by.
 */
export async function saveAppSetting(
  client: SupabaseClient,
  key: AppSettingKey,
  value: boolean | string,
  updatedBy?: string | null,
): Promise<SaveSettingResult> {
  if (
    key === "announcement" &&
    typeof value === "string" &&
    value.length > ANNOUNCEMENT_MAX_LENGTH
  ) {
    throw new Error(`Announcement must be ${ANNOUNCEMENT_MAX_LENGTH} characters or fewer.`);
  }
  // updated_at is NOT sent: the database trigger set_updated_at()
  // stamps it from the database clock (migration 002). Sending the
  // admin device's clock here used to store wrong timestamps.
  const payload: Record<string, unknown> = {
    key,
    value,
  };
  if (updatedBy) payload.updated_by = updatedBy;
  const { error } = await client.from("app_settings").upsert(payload, { onConflict: "key" });
  if (error) throw new Error(error.message);
  const { data, error: readError } = await client
    .from("app_settings")
    .select("updated_at, updated_by")
    .eq("key", key)
    .single();
  if (readError) throw new Error(readError.message);
  const row = (data ?? {}) as { updated_at?: string; updated_by?: string | null };
  return {
    key,
    value,
    updatedAt: row.updated_at ?? new Date().toISOString(),
    updatedBy: row.updated_by ?? null,
  };
}
