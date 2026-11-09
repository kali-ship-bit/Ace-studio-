/**
 * Rate limiting + IP lockout (Phase A/B).
 *
 * KENNETH'S RULE: after 3 failed logins from the same IP address, that
 * address is blocked. The lockout lasts 15 minutes — a standard length:
 * long enough to stop password guessing, short enough that a real user who
 * mistyped is not locked out all day. Every failed attempt after the
 * lockout starts does NOT extend it (so an attacker cannot lock a victim
 * out forever by retrying).
 *
 * Raw IP addresses are never stored: the key is a SHA-256 hash of the IP,
 * so the table holds hashes only. Behind a hosting proxy the IP comes from
 * `x-forwarded-for` — but only the LAST entry is trusted: each proxy
 * appends the address it saw, so the last entry is the one added by the
 * edge proxy closest to this server, while entries to its left are
 * client-controlled and can be faked.
 *
 * Proxy headers are ONLY trusted when the app runs behind a proxy it
 * controls: production (NODE_ENV=production, e.g. Vercel — Vercel
 * appends the real client IP as the last x-forwarded-for entry) or when
 * TRUST_PROXY=1 is set explicitly. Anywhere else — local dev, or any
 * server with no proxy in front — x-forwarded-for / x-real-ip are
 * client-controlled and ignored, so a spoofed header cannot dodge a
 * login lockout or a signup burst limit. Without a trusted proxy every
 * request shares the "unknown" bucket (correct for single-user dev).
 *
 * Two stores behind one interface:
 *   - MemoryAttemptStore: in-process, for local dev and single-instance
 *     runs. A restart clears it.
 *   - SupabaseAttemptStore (src/lib/supabase/rate-limit-store.ts): the
 *     `auth_attempts` table, so the lockout survives restarts and works
 *     across instances once Supabase is configured.
 */

import { createHash } from "node:crypto";

/** Login lockout: 3 failed attempts, then blocked for 15 minutes. */
export const LOGIN_MAX_ATTEMPTS = 3;
export const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;
/** Signup: at most 5 new accounts per hour from one IP. */
export const SIGNUP_MAX_PER_HOUR = 5;
export const SIGNUP_WINDOW_MS = 60 * 60 * 1000;
/** Password reset: at most 3 reset emails per hour, per email + per IP. */
export const RESET_MAX_PER_HOUR = 3;
export const RESET_WINDOW_MS = 60 * 60 * 1000;
/** Reset-code guesses: 5 wrong codes, then the code is dead. */
export const RESET_CODE_MAX_ATTEMPTS = 5;
/** Generic API abuse guard: 60 requests a minute per IP per route group. */
export const API_MAX_PER_MINUTE = 60;
export const API_WINDOW_MS = 60 * 1000;

/** Avatar uploads are heavy (up to 2 MB into Storage): 10 a minute. */
export const AVATAR_MAX_PER_MINUTE = 10;
/** Profile edits are small but write to the database: 10 a minute. */
export const PROFILE_MAX_PER_MINUTE = 10;
/**
 * Paid / publishing routes get a stricter guard: narration burns the
 * Speechify allowance (2,000 chars a request) and a post publishes to a
 * connected social account, so 10 a minute per IP is plenty for a real
 * user and far too slow to drain a quota or spam an account.
 */
export const NARRATE_MAX_PER_MINUTE = 10;
export const POSTING_MAX_PER_MINUTE = 10;

export interface AttemptState {
  count: number;
  /** Epoch ms until which the key is locked, 0 when not locked. */
  lockedUntil: number;
  /** Epoch ms the current counting window started. */
  windowStart: number;
}

export interface AttemptStore {
  get(key: string): Promise<AttemptState | null>;
  set(key: string, state: AttemptState): Promise<void>;
  remove(key: string): Promise<void>;
}

/** SHA-256 of the IP — the stored key, never the raw address. */
export function hashIp(ip: string): string {
  return createHash("sha256").update(`ace-studio-ip:${ip}`).digest("hex");
}

/** True only when proxy headers may be trusted (see the module comment):
 * production behind a controlled edge proxy, or TRUST_PROXY=1. */
export function trustProxyHeaders(): boolean {
  return process.env["TRUST_PROXY"] === "1" || process.env["NODE_ENV"] === "production";
}

/**
 * Best-effort client IP: when proxy headers are trusted, the LAST entry
 * of x-forwarded-for (the one the edge proxy appended — entries to its
 * left are client-controlled), else x-real-ip; when they are not trusted
 * (local dev, no proxy) the header is ignored and the answer is
 * "unknown". Never returns a client-supplied value untrusted.
 */
export function clientIp(request: Request): string {
  if (!trustProxyHeaders()) return "unknown";
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const entries = forwarded
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);
    const last = entries[entries.length - 1];
    if (last) return last;
  }
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real;
  return "unknown";
}

export function attemptKey(kind: string, ip: string): string {
  return `${kind}:${hashIp(ip)}`;
}

export function emailAttemptKey(kind: string, email: string): string {
  return `${kind}:${createHash("sha256").update(`ace-studio-email:${email.toLowerCase()}`).digest("hex")}`;
}

export interface LimitCheck {
  allowed: boolean;
  /** Failed attempts left before a lockout (login-style limits). */
  remaining: number;
  /** Seconds to wait when not allowed. */
  retryAfterSeconds: number;
  /** Epoch ms the lockout ends, 0 when there is none. */
  lockedUntil: number;
}

/**
 * Login-style limit: count failures; at the max, lock for `lockoutMs`.
 * Call after a FAILED attempt. A successful login must call `resetAttempts`.
 */
export async function recordFailure(
  store: AttemptStore,
  key: string,
  maxAttempts: number,
  lockoutMs: number,
  now = Date.now(),
): Promise<LimitCheck> {
  const current = (await store.get(key)) ?? { count: 0, lockedUntil: 0, windowStart: now };
  if (current.lockedUntil > now) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil((current.lockedUntil - now) / 1000),
      lockedUntil: current.lockedUntil,
    };
  }
  // The lockout has expired (or there never was one): start counting
  // fresh. Without this, one more failure after the lockout ends would
  // immediately re-lock, because the old count was never cleared.
  const fresh = current.lockedUntil > 0 && current.lockedUntil <= now;
  const base = fresh ? { count: 0, windowStart: now } : current;
  const count = base.count + 1;
  if (count >= maxAttempts) {
    const lockedUntil = now + lockoutMs;
    await store.set(key, { count, lockedUntil, windowStart: base.windowStart });
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil(lockoutMs / 1000),
      lockedUntil,
    };
  }
  await store.set(key, { count, lockedUntil: 0, windowStart: base.windowStart });
  return { allowed: true, remaining: maxAttempts - count, retryAfterSeconds: 0, lockedUntil: 0 };
}

/** Is this key currently locked out? (Checked BEFORE trying the password.) */
export async function checkLocked(
  store: AttemptStore,
  key: string,
  now = Date.now(),
  maxAttempts: number = LOGIN_MAX_ATTEMPTS,
): Promise<LimitCheck> {
  const current = await store.get(key);
  if (current && current.lockedUntil > now) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil((current.lockedUntil - now) / 1000),
      lockedUntil: current.lockedUntil,
    };
  }
  const remaining = current ? Math.max(0, maxAttempts - current.count) : maxAttempts;
  return { allowed: true, remaining, retryAfterSeconds: 0, lockedUntil: 0 };
}

/** Clear the failure count — call on a successful login. */
export async function resetAttempts(store: AttemptStore, key: string): Promise<void> {
  await store.remove(key);
}

/**
 * Window limit (signup / reset / generic API): at most `max` events per
 * `windowMs`. The window is fixed: it starts at the first event and resets
 * after `windowMs` — no sliding window, so a burst right at the boundary
 * can briefly allow up to 2x the cap (documented, accepted).
 *
 * Check-then-set, not atomic: two requests arriving at the same instant
 * can both read the same count and both be allowed, so a cap can be
 * exceeded by a few under heavy concurrency (worse with the Supabase
 * store across instances). That is accepted here: the caps are abuse
 * brakes, not exact quotas — the lockout still engages on the next
 * check, and making this atomic would need a database-side increment
 * (an RPC) for every limit. Revisit if auth traffic grows.
 */
export async function checkWindowLimit(
  store: AttemptStore,
  key: string,
  max: number,
  windowMs: number,
  now = Date.now(),
): Promise<LimitCheck> {
  const current = await store.get(key);
  if (!current || now - current.windowStart >= windowMs) {
    await store.set(key, { count: 1, lockedUntil: 0, windowStart: now });
    return { allowed: true, remaining: max - 1, retryAfterSeconds: 0, lockedUntil: 0 };
  }
  if (current.count >= max) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil((current.windowStart + windowMs - now) / 1000),
      lockedUntil: 0,
    };
  }
  await store.set(key, {
    count: current.count + 1,
    lockedUntil: 0,
    windowStart: current.windowStart,
  });
  return {
    allowed: true,
    remaining: max - current.count - 1,
    retryAfterSeconds: 0,
    lockedUntil: 0,
  };
}

/** In-process store. Fine for local dev; a restart clears it. */
export class MemoryAttemptStore implements AttemptStore {
  private map = new Map<string, AttemptState>();
  /** Hard cap so the map cannot grow forever under attack. */
  private static readonly MAX_ENTRIES = 10_000;

  async get(key: string): Promise<AttemptState | null> {
    return this.map.get(key) ?? null;
  }

  async set(key: string, state: AttemptState): Promise<void> {
    this.map.set(key, state);
    // Evict the oldest entries (Map keeps insertion order) when over cap.
    while (this.map.size > MemoryAttemptStore.MAX_ENTRIES) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  async remove(key: string): Promise<void> {
    this.map.delete(key);
  }
}

let memoryStore: MemoryAttemptStore | null = null;

/** The process-wide in-memory store (used when Supabase is not configured). */
export function getMemoryAttemptStore(): MemoryAttemptStore {
  if (!memoryStore) memoryStore = new MemoryAttemptStore();
  return memoryStore;
}

/**
 * Per-IP rate limit for a mutating API route group ("jobs", "narrate",
 * "post", "keys"). Call AFTER the CSRF check and BEFORE doing the work,
 * so hammering the endpoint — valid requests or not — is cut off.
 *
 * The store is in-process memory by default (one limit per server
 * instance; a restart clears it). Callers that already have a durable
 * store pass it in. Returns the same LimitCheck shape as the login
 * lockout, so callers answer 429 with `retryAfterSeconds`.
 */
export async function checkApiRateLimit(
  request: Request,
  group: string,
  maxPerMinute: number,
  store: AttemptStore = getMemoryAttemptStore(),
): Promise<LimitCheck> {
  return checkWindowLimit(
    store,
    attemptKey(`api:${group}`, clientIp(request)),
    maxPerMinute,
    API_WINDOW_MS,
  );
}
