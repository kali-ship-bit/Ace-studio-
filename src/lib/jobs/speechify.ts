/**
 * Speechify API client (Step 1). Server-side only.
 *
 * Calls https://api.speechify.ai/v1/* with a Bearer key that the caller
 * supplies. This module never reads a key from anywhere itself — the key
 * arrives as a function argument from env.ts / byok.ts, is used in one
 * request, and is never stored, logged, or returned. Error messages are
 * sanitised: they carry the HTTP status and Speechify's public error text
 * only, never the key and never request headers.
 */

import { SPEECHIFY_API_BASE, SPEECHIFY_MODEL } from "./env";
import { sanitiseProviderMessage } from "../posting/provider";

export interface SpeechifyVoiceSummary {
  id: string;
  displayName: string;
  locale: string;
  gender?: string | undefined;
  previewAudio?: string | undefined;
}

export interface SpeechifySynthesis {
  /** Raw MP3 bytes. */
  audio: Uint8Array;
  audioFormat: string;
  billableCharacters: number;
}

export class SpeechifyError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "SpeechifyError";
    this.status = status;
  }
}

type FetchFn = typeof fetch;

interface SpeechifyVoiceRaw {
  id?: unknown;
  display_name?: unknown;
  locale?: unknown;
  gender?: unknown;
  preview_audio?: unknown;
}

/** Speechify returns JSON like {"message": "..."} — keep only that text, truncated. */
function speechifyDetail(parsed: unknown): string {
  if (!parsed || typeof parsed !== "object") return "";
  const p = parsed as { message?: unknown; error?: unknown };
  if (typeof p.message === "string") return p.message;
  if (typeof p.error === "string") return p.error;
  return "";
}

function sanitiseSpeechifyError(status: number, bodyText: string): SpeechifyError {
  return new SpeechifyError(
    status,
    sanitiseProviderMessage("Speechify", status, bodyText, speechifyDetail),
  );
}

async function speechifyFetch(
  fetchImpl: FetchFn,
  path: string,
  apiKey: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    return await fetchImpl(`${SPEECHIFY_API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${apiKey}`,
      },
      // Never follow redirects with a credential attached.
      redirect: "manual",
    });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Cheap validation call for a pasted BYOK key: list voices. A 200 means the
 * key is accepted; 401/403 means it is not. Used by Step 2.
 */
export async function validateSpeechifyKey(
  apiKey: string,
  fetchImpl: FetchFn = fetch,
): Promise<boolean> {
  let response: Response;
  try {
    response = await speechifyFetch(
      fetchImpl,
      `/v1/voices?model=${encodeURIComponent(SPEECHIFY_MODEL)}&locale=en`,
      apiKey,
      { method: "GET" },
    );
  } catch {
    return false;
  }
  return response.status === 200;
}

/**
 * List catalog voices (id, display name, locale) for the voice picker.
 * Only public voice metadata is returned — no key material.
 */
export async function listSpeechifyVoices(
  apiKey: string,
  fetchImpl: FetchFn = fetch,
): Promise<SpeechifyVoiceSummary[]> {
  const response = await speechifyFetch(
    fetchImpl,
    `/v1/voices?model=${encodeURIComponent(SPEECHIFY_MODEL)}&locale=en`,
    apiKey,
    { method: "GET" },
  );
  if (!response.ok) {
    throw sanitiseSpeechifyError(response.status, await response.text());
  }
  const data = (await response.json()) as { voices?: SpeechifyVoiceRaw[] };
  const voices = Array.isArray(data.voices) ? data.voices : [];
  return voices
    .filter((v) => typeof v.id === "string" && v.id.length > 0)
    .map((v) => ({
      id: v.id as string,
      displayName:
        typeof v.display_name === "string" && v.display_name ? v.display_name : (v.id as string),
      locale: typeof v.locale === "string" && v.locale ? v.locale : "en",
      gender: typeof v.gender === "string" ? v.gender : undefined,
      previewAudio: typeof v.preview_audio === "string" ? v.preview_audio : undefined,
    }));
}

export interface SynthesizeOptions {
  input: string;
  voiceId: string;
  /** BCP-47 language, e.g. "en-US". Defaults to the voice's locale. */
  language?: string | undefined;
  /** SSML prosody rate, e.g. "-5%". Applied only to plain text. */
  rate?: string | undefined;
  apiKey: string;
  fetchImpl?: FetchFn;
}

/**
 * Synthesize one narration clip. Returns raw MP3 bytes plus the billable
 * character count (Speechify bills per spoken character; SSML tags are not
 * counted). The caller saves the bytes into the job's file storage.
 */
export async function synthesizeSpeech(options: SynthesizeOptions): Promise<SpeechifySynthesis> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const input = options.input.trim();
  if (!input) throw new Error("Narration text is empty");
  // The voice id goes straight into the provider payload, so it must be
  // a plain identifier — never a string that could smuggle SSML or a URL.
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(options.voiceId)) {
    throw new Error("Invalid voice");
  }
  if (options.language !== undefined && !/^[A-Za-z]{2,3}(-[A-Za-z]{2})?$/.test(options.language)) {
    throw new Error("Invalid language");
  }
  const payload: Record<string, unknown> = {
    input,
    voice_id: options.voiceId,
    model: SPEECHIFY_MODEL,
    audio_format: "mp3",
  };
  if (options.language) payload["language"] = options.language;
  // The narration text is ALWAYS plain text, never SSML: escape it and
  // wrap it in <speak> ourselves. Text starting with "<speak" used to be
  // sent to Speechify raw, which let arbitrary SSML (another voice,
  // <audio> fetches, long breaks) through as if it were the story. The
  // pace value is allow-listed too — it is interpolated into the SSML,
  // so only a plain "-5%"-shaped value is accepted, clamped to ±50%
  // (beyond that Speechify's voice turns unusable, and an extreme value
  // is a sign the caller is not the narration page).
  const paceMatch = options.rate === undefined ? null : /^(-?\d{1,3})%$/.exec(options.rate);
  if (options.rate !== undefined && !paceMatch) {
    throw new Error("Invalid narration pace");
  }
  const pace = paceMatch ? Number(paceMatch[1]) : 0;
  if (pace < -50 || pace > 50) {
    throw new Error("Invalid narration pace");
  }
  const escaped = input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  payload["input"] = options.rate
    ? `<speak><prosody rate="${options.rate}">${escaped}</prosody></speak>`
    : `<speak>${escaped}</speak>`;
  const response = await speechifyFetch(fetchImpl, "/v1/audio/speech", options.apiKey, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw sanitiseSpeechifyError(response.status, await response.text());
  }
  const data = (await response.json()) as {
    audio_data?: unknown;
    audio_format?: unknown;
    billable_characters_count?: unknown;
  };
  if (typeof data.audio_data !== "string" || !data.audio_data) {
    throw new SpeechifyError(502, "Speechify returned no audio");
  }
  const bytes = Buffer.from(data.audio_data, "base64");
  // A valid base64 string can still decode to zero bytes (e.g. junk
  // characters are silently dropped) — that is not a narration.
  if (bytes.length === 0) {
    throw new SpeechifyError(502, "Speechify returned no audio");
  }
  return {
    audio: new Uint8Array(bytes),
    audioFormat: typeof data.audio_format === "string" ? data.audio_format : "mp3",
    billableCharacters:
      typeof data.billable_characters_count === "number"
        ? data.billable_characters_count
        : input.length,
  };
}
