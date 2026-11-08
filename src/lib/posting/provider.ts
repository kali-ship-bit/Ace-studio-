/**
 * Shared helpers for the platform posting modules (Instagram, Facebook,
 * TikTok, YouTube) and Speechify narration.
 *
 * Four modules each had their own near-identical `resolveConfig` (read
 * required env vars, throw naming the missing ones) and `sanitise*Error`
 * (turn a provider's error body into a short public message, truncated,
 * never echoing anything that could contain a credential). The only real
 * differences are the env var names, the error class, and how the detail
 * string is pulled out of the provider's JSON — so those stay with the
 * caller and the shared shape lives here.
 */

/** Read required env vars; throw the caller's error naming the missing ones. */
export function resolveEnvConfig(
  names: string[],
  makeError: (missing: string[]) => Error,
): Record<string, string> {
  const values: Record<string, string> = {};
  const missing: string[] = [];
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (!value) missing.push(name);
    else values[name] = value;
  }
  if (missing.length > 0) throw makeError(missing);
  return values;
}

export type ProviderDetailExtractor = (parsed: unknown) => string;

/** The common provider shape: `{ "error": { "message": "..." } }`. */
export function errorMessageDetail(parsed: unknown): string {
  if (!parsed || typeof parsed !== "object") return "";
  const err = (parsed as { error?: unknown }).error;
  if (err && typeof err === "object") {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
}

/**
 * One sanitised provider error message: "Provider: <detail>" (detail
 * truncated to 200 chars), or "Provider request failed (HTTP n)" when
 * the body carries no usable detail. A body that is not JSON falls back
 * to its own trimmed text. Nothing longer than 200 chars of provider
 * text ever reaches a user or a log.
 */
export function sanitiseProviderMessage(
  provider: string,
  status: number,
  bodyText: string,
  extractDetail: ProviderDetailExtractor = errorMessageDetail,
): string {
  let message = `${provider} request failed (HTTP ${status})`;
  try {
    const detail = extractDetail(JSON.parse(bodyText) as unknown);
    if (detail) message = `${provider}: ${detail.slice(0, 200)}`;
  } catch {
    if (bodyText.trim()) message = `${provider}: ${bodyText.trim().slice(0, 200)}`;
  }
  return message;
}
