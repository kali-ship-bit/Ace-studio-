/**
 * Client-side session id for BYOK (Step 2).
 *
 * The browser makes up one random id per tab (sessionStorage — it dies
 * when the tab closes) and sends it with API calls in the
 * `x-ace-studio-session` header. The server uses it ONLY to find the keys
 * this tab pasted, which live in server memory. The id itself is not a
 * secret and not a login — it is just the handle for "this session's keys".
 * Client-safe: no secrets, no filesystem, safe to import from components.
 */

const SESSION_KEY = "ace-studio-session-id";

export function getSessionId(): string {
  if (typeof window === "undefined") return "";
  let id = window.sessionStorage.getItem(SESSION_KEY) ?? "";
  if (!id) {
    // Cryptographically random: a timestamp + Math.random id could be
    // guessed by counting, and this id addresses the server's key vault.
    id = `sess_${window.crypto.randomUUID().replace(/-/g, "")}`;
    window.sessionStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

export function sessionHeaders(): Record<string, string> {
  const id = getSessionId();
  return id ? { "x-ace-studio-session": id } : {};
}
