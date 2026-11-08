/**
 * Client-safe auth helpers for the auth pages (Phase B).
 *
 * These run in the browser: they only call the /api/auth/* routes, never
 * Supabase directly, and never touch a password or a token — the session
 * lives in HttpOnly cookies the page cannot read.
 */

/** Sign out (fetches a CSRF token first), then the caller redirects. */
export async function logout(): Promise<boolean> {
  try {
    const csrfToken = await fetchCsrf();
    const res = await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({ _csrf: csrfToken }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Get a CSRF token for a form: GET /api/auth/csrf sets the rk_csrf cookie
 * and returns the same token to send back in the x-csrf-token header.
 */
export async function fetchCsrf(): Promise<string> {
  const res = await fetch("/api/auth/csrf", { credentials: "same-origin" });
  if (!res.ok) throw new Error("Could not start a secure form. Refresh the page.");
  const data = (await res.json()) as { csrfToken?: string };
  if (!data.csrfToken) throw new Error("Could not start a secure form. Refresh the page.");
  return data.csrfToken;
}

let cachedCsrfToken: string | null = null;

/**
 * fetch() for a state-changing request: attaches the CSRF token for
 * non-GET requests, and retries once with a fresh token if the server
 * says the token expired. GET/HEAD requests pass through untouched.
 * Use this for every POST/PUT/DELETE to /api/* from a page.
 */
export async function fetchWithCsrf(path: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") {
    return fetch(path, { credentials: "same-origin", ...init });
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!cachedCsrfToken) cachedCsrfToken = await fetchCsrf();
    const res = await fetch(path, {
      credentials: "same-origin",
      ...init,
      headers: { "x-csrf-token": cachedCsrfToken, ...(init.headers ?? {}) },
    });
    if (res.status !== 403 || attempt === 1) return res;
    const data = (await res
      .clone()
      .json()
      .catch(() => ({}))) as { error?: string };
    if (data.error !== "csrf_invalid") return res;
    cachedCsrfToken = null;
  }
  throw new Error("Could not send a secure form. Refresh the page.");
}

/** Read the short public message from a failed auth API call. */
export function apiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

/**
 * POST to an /api/auth/* route: fetches a fresh CSRF token, sends it in
 * the x-csrf-token header (and the _csrf body field), and throws an Error
 * with the server's short public message when the call fails.
 */
export async function postAuth<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const csrfToken = await fetchCsrf();
  const res = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      "x-csrf-token": csrfToken,
    },
    body: JSON.stringify({ ...body, _csrf: csrfToken }),
  });
  const data = (await res.json().catch(() => ({}))) as { message?: string } & T;
  if (!res.ok) throw new Error(data.message ?? `Request failed (${res.status})`);
  return data as T;
}
