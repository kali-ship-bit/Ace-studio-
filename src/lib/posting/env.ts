/**
 * Posting environment (Phase F). Server-side only.
 *
 * HARD RULE — same as the jobs env (src/lib/jobs/env.ts):
 * - A value is read ONLY from the server process environment
 *   (process.env.<NAME>) or, for local development, from a gitignored
 *   `.dev.vars` file in the project root (parsed by readDevVars).
 * - A value is NEVER read from client code, NEVER bundled (no VITE_ var),
 *   NEVER written into a Job record, NEVER logged, and NEVER returned in
 *   any API response. getPostingConfig() returns only booleans and the
 *   NAMES of missing vars — never a secret value.
 * - The platform modules take their values as function arguments from
 *   here (via getPostingValues), use them in one request, and never store
 *   them. Tests pass obviously-fake placeholder values instead.
 */

import { readDevVars } from "../jobs/env";
import { getPlatform, type PlatformId } from "./registry";

export interface PostingConfig {
  configured: boolean;
  /** Names of the env vars still missing for this platform. Never values. */
  missing: string[];
}

/** The posting env vars, with values — server-side only, never returned by an API. */
export type PostingValues = Record<string, string>;

function readPostingVar(name: string): string | undefined {
  const fromEnv = process.env[name]?.trim();
  if (fromEnv) return fromEnv;
  const fromDevVars = readDevVars()[name]?.trim();
  return fromDevVars || undefined;
}

/**
 * Which posting env vars are set, for one platform. Returns only the
 * platform's configured/missing state — never any secret value.
 *
 * A checklist-only platform is never "configured": it has no route to
 * configure, even when its required-env list is empty (Kick) or fully
 * set (X) — reporting it as configured would promise a post that can
 * never happen.
 */
export function getPostingConfig(platform: PlatformId): PostingConfig {
  const entry = getPlatform(platform);
  const required = entry?.requiredEnv ?? [];
  if (entry?.status === "checklist-only") {
    return { configured: false, missing: required };
  }
  const missing = required.filter((name) => !readPostingVar(name));
  return { configured: missing.length === 0, missing };
}

/**
 * The actual values for one platform's required vars, for the platform
 * module to use in a single request. Returns undefined when any required
 * var is missing — callers must fail with the missing-names error first.
 * Server-side only: never pass the result to a response, a Job, or a log.
 */
export function getPostingValues(platform: PlatformId): PostingValues | undefined {
  const config = getPostingConfig(platform);
  if (!config.configured) return undefined;
  const entry = getPlatform(platform);
  const values: PostingValues = {};
  for (const name of entry?.requiredEnv ?? []) {
    const value = readPostingVar(name);
    if (!value) return undefined;
    values[name] = value;
  }
  return values;
}
