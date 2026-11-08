/**
 * Server-side environment for the jobs API (Step 1 + Step 2).
 *
 * HARD RULE — keys live here and nowhere else:
 * - A key is read ONLY from the server process environment
 *   (`process.env.SPEECHIFY_API_KEY`) or, for local development, from a
 *   gitignored `.dev.vars` file in the project root (see `.env.example`
 *   for the full list of names — it is the only template).
 * - `.dev.vars` is already in .gitignore, and this project has no git repo
 *   yet, so the file also never leaves this machine through any other path.
 * - A key is NEVER read from client code, NEVER bundled (no VITE_ var),
 *   NEVER written into a Job record, NEVER logged, and NEVER returned in
 *   any API response. The only thing the client ever sees is a masked
 *   display (`••••` + last 4) from the BYOK vault (see byok.ts).
 * - In production the same value comes from the hosting environment
 *   (hosting dashboard secrets or the server's env), still read from
 *   process.env under the same name `SPEECHIFY_API_KEY`.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

export { SPEECHIFY_MAX_CHARS_PER_REQUEST, SPEECHIFY_FREE_TIER_MONTHLY_CHARS } from "./limits";

/**
 * Speechify model for narration. A named constant on purpose: the research
 * warns Simba 3.5's free allowance halves (500,000 -> 250,000 chars/month)
 * and its list price doubles after 21 Nov 2026. Change this one line to
 * switch model (e.g. "simba-3.2" for English-only narration at the old rate).
 */
export const SPEECHIFY_MODEL = "simba-3.5";

/** Speechify API base. The current host per the official docs. */
export const SPEECHIFY_API_BASE = "https://api.speechify.ai";

let devVarsCache: Record<string, string> | null = null;

/**
 * Parse a `.dev.vars` file (KEY=VALUE lines, # comments, optional quotes).
 * Local development only — in production the values come from real secrets.
 */
export function readDevVars(): Record<string, string> {
  if (devVarsCache) return devVarsCache;
  const out: Record<string, string> = {};
  // Tests never read the real local secrets file: a test that assumes
  // "nothing is set" must not pick up a developer's real .dev.vars, and
  // a failing test must never print a live key into test output. The
  // test setup file (src/test/setup.ts) sets this flag; production
  // never does. Real process env still works when the flag is set.
  if (process.env["ACE_STUDIO_NO_DEV_VARS"]) {
    devVarsCache = out;
    return out;
  }
  try {
    const raw = readFileSync(join(process.cwd(), ".dev.vars"), "utf-8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      out[key] = value;
    }
  } catch {
    // No .dev.vars file — that is normal. The app key is simply unset.
  }
  devVarsCache = out;
  return out;
}

/** Test helper: forget the cached .dev.vars so tests can re-read. */
export function resetDevVarsCache(): void {
  devVarsCache = null;
}

/**
 * The app's own Speechify key, for the server only. Resolution order:
 *   1. process.env.SPEECHIFY_API_KEY (shell env / hosting secret)
 *   2. .dev.vars SPEECHIFY_API_KEY (local development, gitignored)
 * Returns undefined when no app key is configured — callers must then use
 * a session BYOK key, mock mode, or return a clear "key missing" error.
 */
export function getAppSpeechifyKey(): string | undefined {
  const fromEnv = process.env["SPEECHIFY_API_KEY"]?.trim();
  if (fromEnv) return fromEnv;
  const fromDevVars = readDevVars()["SPEECHIFY_API_KEY"]?.trim();
  return fromDevVars || undefined;
}

/**
 * Mock mode is a development-only escape hatch (SPEECHIFY_MOCK=1). When on,
 * /api/narrate returns a clearly-labelled mock job instead of calling
 * Speechify, so the full flow can be proved without a key. It never
 * pretends to be a real generation: the job and the response carry
 * mock: true. It is OFF in production no matter what the env says, and a
 * real key always wins over it — mock must never silently replace a
 * paid-for generation.
 */
export function isMockSpeechify(): boolean {
  if (process.env["NODE_ENV"] === "production") return false;
  return process.env["SPEECHIFY_MOCK"] === "1" || readDevVars()["SPEECHIFY_MOCK"] === "1";
}

/** Resolve which key source the server will use for a narration request.
 *  A session BYOK key wins, then the app key, then mock. Returns the
 *  source name only — never the key itself. */
export function describeKeySource(
  hasSessionKey: boolean,
  hasAppKey: boolean,
): "session" | "app" | "mock" | "none" {
  if (hasSessionKey) return "session";
  if (hasAppKey) return "app";
  if (isMockSpeechify()) return "mock";
  return "none";
}
