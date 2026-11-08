/**
 * Session-only BYOK vault (Step 2).
 *
 * A user pastes their own provider API key in Settings. The server:
 *   1. validates it immediately with a cheap server-side call
 *      (Speechify: GET /v1/voices),
 *   2. holds it in memory ONLY, keyed by a session id the browser made up
 *      (stored in sessionStorage — it dies when the tab closes),
 *   3. never writes it to disk, never puts it in a database, never logs it,
 *      never returns it — the client only ever sees a masked display.
 *   4. Entries expire after 24 hours and the vault is capped, so a
 *      forgotten tab cannot hold a key (or memory) forever.
 *
 * A server restart wipes every key (by design: nothing to steal at rest).
 * There is no login in this app yet, so there is no user id to attach a
 * key to — that is exactly why session-only comes first. When auth exists,
 * this same provider registry gains a persisted, encrypted store behind
 * it (AES-256-GCM in D1, master key in a server secret); the API routes
 * and the UI do not change.
 *
 * Provider registry: each provider declares how to validate a pasted key.
 * Speechify is the first entry; Omni/Seedance/Kie plug in here in later
 * steps behind the same interface.
 */

import { randomUUID } from "node:crypto";
import { validateSpeechifyKey } from "./speechify";

export type KeyProviderId = "speechify";

export interface KeyProvider {
  id: KeyProviderId;
  label: string;
  /** Cheap read used to prove a pasted key works, without spending money. */
  validate: (apiKey: string, fetchImpl?: typeof fetch) => Promise<boolean>;
  /** Short hint shown under the paste box. */
  hint: string;
}

export const KEY_PROVIDERS: Record<KeyProviderId, KeyProvider> = {
  speechify: {
    id: "speechify",
    label: "Speechify (voices)",
    validate: (apiKey, fetchImpl) => validateSpeechifyKey(apiKey, fetchImpl),
    hint: "Paste a key from platform.speechify.ai → API Keys. It is checked once, then held in this server's memory for this session only.",
  },
};

export function isKeyProviderId(value: unknown): value is KeyProviderId {
  return typeof value === "string" && value in KEY_PROVIDERS;
}

/** Masked display: the last 4 characters only, e.g. "••••••••3f9a". */
export function maskKey(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (trimmed.length <= 4) return "••••";
  return `••••••••${trimmed.slice(-4)}`;
}

export interface StoredSessionKey {
  provider: KeyProviderId;
  /** Masked display only. The full key is never in this object. */
  masked: string;
  validatedAt: number;
}

interface VaultEntry {
  key: string;
  masked: string;
  validatedAt: number;
}

/** sessionId -> provider -> entry. In-memory only, per server process. */
const vault = new Map<string, Map<KeyProviderId, VaultEntry>>();

/** A pasted key is forgotten after a day, even if the tab stays open. */
const SESSION_KEY_TTL_MS = 24 * 60 * 60 * 1000;
/** Upper bound on sessions held, so the vault cannot grow without limit. */
const MAX_VAULT_SESSIONS = 500;

function isUsableSessionId(sessionId: string): boolean {
  // Client-generated UUID-ish token. Reject empty / absurd values so a
  // bad header can never address another session's keys.
  return /^[A-Za-z0-9_-]{8,128}$/.test(sessionId);
}

export function newSessionId(): string {
  // Cryptographically random: unlike a timestamp + Math.random id, this
  // cannot be guessed by counting.
  return `sess_${randomUUID().replace(/-/g, "")}`;
}

/** Drop expired sessions, and evict the oldest when over the cap. */
function pruneVault(): void {
  const now = Date.now();
  for (const [sessionId, perSession] of vault) {
    for (const [provider, entry] of perSession) {
      if (now - entry.validatedAt >= SESSION_KEY_TTL_MS) perSession.delete(provider);
    }
    if (perSession.size === 0) vault.delete(sessionId);
  }
  while (vault.size > MAX_VAULT_SESSIONS) {
    const oldest = vault.keys().next().value;
    if (oldest === undefined) break;
    vault.delete(oldest);
  }
}

function isExpired(entry: VaultEntry): boolean {
  return Date.now() - entry.validatedAt >= SESSION_KEY_TTL_MS;
}

/**
 * Validate a pasted key server-side, then hold it in memory for the session.
 * Returns the masked display. Throws when the provider is unknown, the key
 * is empty, or the provider rejects the key.
 */
export async function saveSessionKey(
  sessionId: string,
  providerId: KeyProviderId,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StoredSessionKey> {
  if (!isUsableSessionId(sessionId)) throw new Error("Invalid session");
  const provider = KEY_PROVIDERS[providerId];
  if (!provider) throw new Error("Unknown provider");
  const key = apiKey.trim();
  if (!key) throw new Error("Key is empty");
  const ok = await provider.validate(key, fetchImpl);
  if (!ok)
    throw new Error("That key was rejected. Check it came from the provider's own keys page.");
  pruneVault();
  let perSession = vault.get(sessionId);
  if (!perSession) {
    perSession = new Map();
    vault.set(sessionId, perSession);
  }
  const stored: StoredSessionKey = {
    provider: providerId,
    masked: maskKey(key),
    validatedAt: Date.now(),
  };
  perSession.set(providerId, { key, masked: stored.masked, validatedAt: stored.validatedAt });
  return stored;
}

/** The full key for a session+provider, or undefined. Server-side only. */
export function getSessionKey(sessionId: string, providerId: KeyProviderId): string | undefined {
  if (!isUsableSessionId(sessionId)) return undefined;
  const entry = vault.get(sessionId)?.get(providerId);
  if (!entry || isExpired(entry)) return undefined;
  return entry.key;
}

/** Masked keys held for a session — safe to send to the browser. */
export function listSessionKeys(sessionId: string): StoredSessionKey[] {
  if (!isUsableSessionId(sessionId)) return [];
  const perSession = vault.get(sessionId);
  if (!perSession) return [];
  return [...perSession.entries()]
    .filter(([, entry]) => !isExpired(entry))
    .map(([provider, entry]) => ({
      provider,
      masked: entry.masked,
      validatedAt: entry.validatedAt,
    }));
}

export function removeSessionKey(sessionId: string, providerId: KeyProviderId): boolean {
  if (!isUsableSessionId(sessionId)) return false;
  return vault.get(sessionId)?.delete(providerId) ?? false;
}

/** Test helper: wipe the whole vault. */
export function clearSessionVault(): void {
  vault.clear();
}

/** How many keys are held in memory right now (count only — no values). */
export function sessionVaultSize(): number {
  let n = 0;
  for (const perSession of vault.values()) n += perSession.size;
  return n;
}
