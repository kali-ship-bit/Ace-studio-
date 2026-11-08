/**
 * Supabase clients (Phase A).
 *
 * Three clients, three jobs — never mix them up:
 *   - Public client (publishable/anon key): what the browser and the
 *     login/signup flows use. It can only do what Row Level Security
 *     allows — that is the whole point.
 *   - Service client (secret service_role key): SERVER ONLY. It bypasses
 *     RLS, so it is used only for admin work the database cannot do
 *     through RLS (login-attempt lockout rows, first-run admin checks).
 *     It throws if it is ever built in a browser.
 *   - User client (publishable key + one user's access token): used
 *     server-side to act AS that user, so RLS sees their identity and
 *     they can only touch their own rows.
 *
 * Passwords are hashed by Supabase Auth (bcrypt) — the app never hashes,
 * stores, or sees a plain password.
 */

import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { getSupabaseConfig } from "./env";
import { getSessionTokens } from "../security/session";

export type { SupabaseClient, User };

function requireConfig() {
  const config = getSupabaseConfig();
  if (!config) {
    throw new Error(
      "Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY on the server (see SUPABASE_SETUP.md).",
    );
  }
  return config;
}

/** Public client: publishable key. Safe to use anywhere, RLS still applies. */
export function createPublicClient(): SupabaseClient {
  const config = requireConfig();
  return createClient(config.url, config.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Service client: secret key. SERVER ONLY — it bypasses Row Level
 * Security. Throws in a browser and when the secret key is not set.
 */
export function createServiceClient(): SupabaseClient {
  if (typeof window !== "undefined") {
    throw new Error("The Supabase service key must never be used in the browser.");
  }
  const config = requireConfig();
  if (!config.serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set on the server. Admin work that needs it cannot run.",
    );
  }
  return createClient(config.url, config.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * A client that acts as one user: the publishable key plus that user's
 * access token, so every query runs under RLS as them.
 */
export function createUserClient(accessToken: string): SupabaseClient {
  const config = requireConfig();
  return createClient(config.url, config.anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Who is logged in on this request, from the session cookie? Returns the
 * Supabase user or null (not logged in, token expired, or Supabase not
 * configured). Never throws for a bad token — a bad token just means
 * "not logged in".
 */
export async function getAuthUserFromRequest(request: Request): Promise<User | null> {
  const { accessToken } = getSessionTokens(request);
  if (!accessToken) return null;
  try {
    const client = createUserClient(accessToken);
    const { data, error } = await client.auth.getUser(accessToken);
    if (error || !data.user) return null;
    return data.user;
  } catch {
    return null;
  }
}

/** Is this user an admin? Read from their profile row (RLS-guarded). */
export async function isAdminUser(client: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await client
    .from("profiles")
    .select("is_admin")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) return false;
  return (data as { is_admin?: boolean }).is_admin === true;
}
