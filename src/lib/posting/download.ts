/**
 * Hardened download of a user-supplied video URL (SSRF defence).
 *
 * The posting routes take a video URL from the user. Fetching it naively
 * would let an attacker point the server at its own internal services
 * (an SSRF attack: the server fetches a private address and hands the
 * bytes to TikTok/YouTube), or at a multi-gigabyte file that fills the
 * server's memory. This module is the one place that downloads such a
 * URL, and it enforces, in order:
 *   1. https only (no http, no other scheme);
 *   2. the host resolves (DNS) to public IP addresses only — private,
 *      loopback, link-local, CGNAT and documentation ranges are refused;
 *   3. redirects are followed manually, at most 5, and every hop is
 *      re-checked (a public URL must not redirect to an internal one);
 *   4. the download is streamed with a byte cap (default 200 MB) and a
 *      60-second timeout — the body is never buffered unbounded;
 *   5. the content type must look like a video (when the server sends
 *      one), never an HTML page.
 *
 * Residual risk, documented honestly: DNS is checked before the fetch,
 * so a hostile DNS that changes its answer between the check and the
 * fetch (rebinding) could still slip through. A full fix needs
 * IP-pinned connections; in practice the check and the fetch happen
 * milliseconds apart. The video URL in this app comes from the creator
 * (or a signed Storage URL), not from arbitrary users.
 *
 * Also in this file: `timedFetch`, the shared request timeout used by
 * every platform module so a hung platform call cannot stall a job
 * forever, and `assertUploadUrl`, which checks that a server-returned
 * upload URL points at the platform it claims to (TikTok's upload host
 * is open-upload.tiktokapis.com; YouTube's is *.googleapis.com).
 */

import { lookup } from "node:dns/promises";

/** Largest video the server will download (200 MB — a 60 s 1080p clip is far smaller). */
export const VIDEO_DOWNLOAD_MAX_BYTES = 200 * 1024 * 1024;
/** Whole-download timeout, including redirect hops. */
export const VIDEO_DOWNLOAD_TIMEOUT_MS = 60_000;
/** Default per-request timeout for platform API calls. */
export const PLATFORM_FETCH_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;

export class VideoDownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoDownloadError";
  }
}

export type ResolveHost = (hostname: string) => Promise<string[]>;

async function defaultResolveHost(hostname: string): Promise<string[]> {
  const records = await lookup(hostname, { all: true });
  return records.map((r) => r.address);
}

function isPublicIpv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b, c] = nums as [number, number, number, number];
  if (a === 0) return false; // 0.0.0.0/8 — "this network"
  if (a === 10) return false; // 10.0.0.0/8 — private
  if (a === 127) return false; // 127.0.0.0/8 — loopback
  if (a === 169 && b === 254) return false; // 169.254.0.0/16 — link-local (cloud metadata lives here)
  if (a === 172 && b >= 16 && b <= 31) return false; // 172.16.0.0/12 — private
  if (a === 192 && b === 0 && c === 0) return false; // 192.0.0.0/24 — IETF assignment
  if (a === 192 && b === 0 && c === 2) return false; // 192.0.2.0/24 — documentation
  if (a === 192 && b === 168) return false; // 192.168.0.0/16 — private
  if (a === 198 && b === 51 && c === 100) return false; // 198.51.100.0/24 — documentation
  if (a === 203 && b === 0 && c === 113) return false; // 203.0.113.0/24 — documentation
  if (a === 100 && b >= 64 && b <= 127) return false; // 100.64.0.0/10 — CGNAT
  if (a === 198 && b >= 18 && b <= 19) return false; // 198.18.0.0/15 — benchmarking
  if (a >= 224) return false; // 224.0.0.0/4 multicast, 240.0.0.0/4 reserved
  return true;
}

function isPublicIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  // IPv4-mapped IPv6, e.g. ::ffff:192.0.2.1 — judge the embedded IPv4.
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped?.[1]) return isPublicIpv4(mapped[1]);
  if (lower === "::1" || lower === "::") return false; // loopback / unspecified
  if (/^fe[89ab]/.test(lower)) return false; // fe80::/10 — link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return false; // fc00::/7 — unique-local
  if (lower.startsWith("ff")) return false; // ff00::/8 — multicast
  // 2001:db8::/32 — documentation. The first two hextets must be
  // exactly 2001:0db8: a prefix test would also block 2001:db80::/33
  // and friends, which are real address space.
  const groups = lower.split(":");
  if (groups[0] === "2001" && (groups[1] === "db8" || groups[1] === "0db8")) return false;
  return true;
}

/** True only for a public, internet-routable IP address. */
export function isPublicIp(ip: string): boolean {
  return ip.includes(":") ? isPublicIpv6(ip) : isPublicIpv4(ip);
}

/**
 * Check that a URL is safe for this server to fetch: https, and a host
 * that resolves only to public IPs. Returns the parsed URL.
 */
export async function assertFetchableUrl(
  rawUrl: string,
  resolveHost: ResolveHost = defaultResolveHost,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new VideoDownloadError("The video URL is not a valid URL.");
  }
  if (url.protocol !== "https:") {
    throw new VideoDownloadError("The video URL must be an https URL.");
  }
  let addresses: string[];
  try {
    addresses = await resolveHost(url.hostname);
  } catch {
    throw new VideoDownloadError("Could not resolve the video URL host.");
  }
  if (addresses.length === 0) {
    throw new VideoDownloadError("Could not resolve the video URL host.");
  }
  for (const address of addresses) {
    if (!isPublicIp(address)) {
      throw new VideoDownloadError(
        "The video URL points to a private or internal address, which the server will not fetch.",
      );
    }
  }
  return url;
}

export interface DownloadOptions {
  fetchImpl?: typeof fetch | undefined;
  resolveHost?: ResolveHost | undefined;
  maxBytes?: number | undefined;
  timeoutMs?: number | undefined;
}

/**
 * Download a user-supplied video URL with all the guards above.
 * Redirects are followed manually (at most 5) with every hop re-checked.
 */
export async function fetchPublicVideoBytes(
  rawUrl: string,
  opts: DownloadOptions = {},
): Promise<Uint8Array> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const resolveHost = opts.resolveHost ?? defaultResolveHost;
  const maxBytes = opts.maxBytes ?? VIDEO_DOWNLOAD_MAX_BYTES;
  const timeoutMs = opts.timeoutMs ?? VIDEO_DOWNLOAD_TIMEOUT_MS;
  // One deadline for the whole download, including redirect hops: the
  // per-hop timeout used to restart on every hop, so 6 hops could take
  // 6 minutes against a "60-second" limit.
  const startedAt = Date.now();

  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertFetchableUrl(current, resolveHost);
    const remainingMs = timeoutMs - (Date.now() - startedAt);
    if (remainingMs <= 0) {
      throw new VideoDownloadError("The video download timed out.");
    }
    const response = await fetchImpl(url.toString(), {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(remainingMs),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new VideoDownloadError("The video URL redirected without a destination.");
      }
      if (hop === MAX_REDIRECTS) {
        throw new VideoDownloadError("The video URL redirected too many times.");
      }
      current = new URL(location, url).toString();
      continue;
    }
    if (!response.ok) {
      throw new VideoDownloadError(
        `Could not download the video to upload (HTTP ${response.status}).`,
      );
    }
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (
      contentType &&
      contentType !== "application/octet-stream" &&
      !contentType.startsWith("video/")
    ) {
      throw new VideoDownloadError(`The video URL returned ${contentType}, not a video file.`);
    }
    // Stream with a byte cap — never buffer an unbounded body.
    if (response.body) {
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          throw new VideoDownloadError(
            `The video file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`,
          );
        }
        chunks.push(value);
      }
      const out = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.byteLength;
      }
      if (out.byteLength === 0) {
        throw new VideoDownloadError("The video file is empty.");
      }
      return out;
    }
    // Fallback for fetch implementations without a streamable body
    // (test doubles): read it whole, then check the size.
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0) {
      throw new VideoDownloadError("The video file is empty.");
    }
    if (bytes.byteLength > maxBytes) {
      throw new VideoDownloadError(
        `The video file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`,
      );
    }
    return bytes;
  }
  throw new VideoDownloadError("The video URL redirected too many times.");
}

/**
 * Check that a server-returned upload URL really points at the platform
 * it claims to. A compromised or mocked API response must not be able to
 * redirect video bytes (and, for YouTube, a Bearer token) to an attacker's
 * host. `allowedSuffixes` are bare domains: the host must equal one or
 * be a subdomain of one.
 */
export function assertUploadUrl(rawUrl: string, allowedSuffixes: string[], label: string): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`${label}: the upload URL is not a valid URL.`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`${label}: the upload URL must be an https URL.`);
  }
  const host = url.hostname.toLowerCase();
  const ok = allowedSuffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  if (!ok) {
    throw new Error(`${label}: unexpected upload host ${host}.`);
  }
}

/** TikTok's dedicated upload domain (per TikTok's Content Posting API docs). */
export const TIKTOK_UPLOAD_HOST_SUFFIXES = ["tiktokapis.com"];
/** YouTube resumable-upload sessions live on *.googleapis.com. */
export const YOUTUBE_UPLOAD_HOST_SUFFIXES = ["googleapis.com"];

/**
 * Fetch with a timeout, so a hung platform call cannot stall a job
 * forever. Every platform module should use this instead of raw fetch.
 */
export async function timedFetch(
  fetchImpl: typeof fetch,
  input: string,
  init: RequestInit = {},
  timeoutMs: number = PLATFORM_FETCH_TIMEOUT_MS,
): Promise<Response> {
  return fetchImpl(input, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}
