/**
 * Small HTTP helpers shared by API handlers (Phase A).
 *
 * - JSON bodies are capped at 1 MB so a giant body cannot exhaust memory.
 * - Error responses never leak internals: a short public message plus a
 *   machine-readable code. Details go to the server log, not the client.
 */

const MAX_JSON_BODY_BYTES = 1024 * 1024; // 1 MB

export function jsonResponse(data: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(extraHeaders ?? {}),
    },
  });
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  extraHeaders?: HeadersInit,
  extraBody?: Record<string, unknown>,
): Response {
  return jsonResponse({ error: code, message, ...(extraBody ?? {}) }, status, extraHeaders);
}

/**
 * Read a JSON object body. Returns null when the body is not a JSON object
 * (empty, malformed, too big, or an array). Callers turn null into a 400.
 */
export async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).length > MAX_JSON_BODY_BYTES) return null;
    if (!text.trim()) return {};
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/** Append Set-Cookie values to a response's headers. */
export function withCookies(response: Response, cookies: string[]): Response {
  const headers = new Headers(response.headers);
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * The standard 429 (rate limit) response: the JSON body carries
 * `retryAfterSeconds` for the app's own clients, and the `Retry-After`
 * header carries the same number of seconds for any standard HTTP
 * client. Four handlers used to build this three different ways, two
 * of them without the header.
 */
export function tooManyResponse(retryAfterSeconds: number, message: string): Response {
  return errorResponse(
    429,
    "too_many_requests",
    message,
    { "retry-after": String(Math.max(0, Math.ceil(retryAfterSeconds))) },
    { retryAfterSeconds },
  );
}
