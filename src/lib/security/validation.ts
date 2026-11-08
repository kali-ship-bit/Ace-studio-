/**
 * Server-side validation (Phase A security foundation).
 *
 * RULE: every form is checked HERE, on the server, before anything is
 * trusted. What the page checks in the browser is only for a nicer
 * experience — an attacker can skip the page entirely and call the API
 * directly, so the server is the only check that counts.
 *
 * These are pure functions (no I/O), so they are easy to test and safe to
 * reuse from any API handler. Client-safe: no secrets, no node APIs.
 */

import { COUNTRIES } from "../countries";

/** Result of one field check. `error` is the plain-words message for the user. */
export type FieldResult = { ok: true; value: string } | { ok: false; error: string };

function fail(error: string): FieldResult {
  return { ok: false, error };
}

/**
 * Email address. Checked with a strict-enough shape plus a length cap.
 * Supabase Auth checks it again on signup — this check is so a bad address
 * never reaches the database call.
 */
export function validateEmail(raw: unknown): FieldResult {
  if (typeof raw !== "string") return fail("Enter an email address.");
  const email = raw.trim().toLowerCase();
  if (!email) return fail("Enter an email address.");
  if (email.length > 254) return fail("That email address is too long.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return fail("That email address does not look right. Check it and try again.");
  }
  return { ok: true, value: email };
}

/**
 * Password rule, exactly as Kenneth specified: no less than 6 characters
 * and no more than 8. Enforced here on the server.
 *
 * NOTE (flagged for Kenneth, not changed): an 8-character maximum is
 * weaker than modern practice — most services allow long passwords because
 * length is what makes guessing hard. This implements his 6–8 rule as
 * asked; raising the maximum later is a one-line change here.
 */
export const PASSWORD_MIN_LENGTH = 6;
export const PASSWORD_MAX_LENGTH = 8;

export function validatePassword(raw: unknown): FieldResult {
  if (typeof raw !== "string") return fail("Enter a password.");
  if (!raw.trim()) return fail("Enter a password.");
  if (raw.length < PASSWORD_MIN_LENGTH) {
    return fail(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  }
  if (raw.length > PASSWORD_MAX_LENGTH) {
    return fail(`Password must be no more than ${PASSWORD_MAX_LENGTH} characters.`);
  }
  return { ok: true, value: raw };
}

/** A country dial code is valid only when it is on our list. */
export function isKnownDialCode(code: string): boolean {
  return COUNTRIES.some((c) => c.dialCode === code);
}

/**
 * Phone number: a dial code from the picker plus the number the user typed.
 * Returns the full number in international form, e.g. +2348028289087.
 * The national part must be digits only, 7–15 digits once joined.
 */
export function validatePhoneNumber(dialCodeRaw: unknown, nationalRaw: unknown): FieldResult {
  if (typeof dialCodeRaw !== "string" || !isKnownDialCode(dialCodeRaw)) {
    return fail("Pick your country code first.");
  }
  if (typeof nationalRaw !== "string") return fail("Enter a phone number.");
  const national = nationalRaw.replace(/[\s\-().]/g, "");
  if (!national) return fail("Enter a phone number.");
  if (!/^\d+$/.test(national)) {
    return fail("A phone number has digits only — no letters.");
  }
  const full = `${dialCodeRaw}${national.replace(/^0+/, "")}`;
  const digits = full.replace("+", "");
  if (digits.length < 7 || digits.length > 15) {
    return fail("That phone number is too short or too long.");
  }
  return { ok: true, value: full };
}

/** Upload rules. `maxBytes` and the allowed MIME types are per-upload. */
export interface UploadCheck {
  size: number;
  mime: string;
}

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
export const AVATAR_ALLOWED_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;

export function validateUpload(
  file: UploadCheck,
  maxBytes: number,
  allowedMimes: readonly string[],
  label: string,
): FieldResult {
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return fail(`That ${label} looks empty. Try again.`);
  }
  if (file.size > maxBytes) {
    return fail(
      `That ${label} is too big — keep it under ${Math.round(maxBytes / 1024 / 1024)} MB.`,
    );
  }
  if (!allowedMimes.includes(file.mime.toLowerCase())) {
    return fail(`That file type is not allowed for a ${label}.`);
  }
  return { ok: true, value: file.mime.toLowerCase() };
}

/**
 * Magic-byte check: the file's first bytes must match the picture type
 * the browser claimed. The MIME type in a multipart upload is only a
 * label the sender chose — without this, a script or HTML file labelled
 * "image/png" would pass validateUpload and land in the public avatars
 * bucket. JPEG starts FF D8 FF, PNG starts with its 8-byte signature,
 * WebP starts "RIFF" and has "WEBP" at offset 8.
 */
export function isRealImageBytes(bytes: Uint8Array, mime: string): boolean {
  const type = mime.toLowerCase();
  if (type === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (type === "image/png") {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return bytes.length >= 8 && signature.every((byte, i) => bytes[i] === byte);
  }
  if (type === "image/webp") {
    return (
      bytes.length >= 12 &&
      bytes[0] === 0x52 && // R
      bytes[1] === 0x49 && // I
      bytes[2] === 0x46 && // F
      bytes[3] === 0x46 && // F
      bytes[8] === 0x57 && // W
      bytes[9] === 0x45 && // E
      bytes[10] === 0x42 && // B
      bytes[11] === 0x50 // P
    );
  }
  return false;
}

/**
 * Post-login redirect target. Only a same-site path is allowed — never a
 * full URL to another site (that trick is called an "open redirect").
 */
export function isSafeRedirect(raw: unknown): raw is string {
  return (
    typeof raw === "string" &&
    raw.startsWith("/") &&
    !raw.startsWith("//") &&
    !raw.includes("\\") &&
    raw.length <= 200
  );
}

/** A Supabase reset/verification code: 6 digits, nothing else. */
export function validateResetCode(raw: unknown): FieldResult {
  if (typeof raw !== "string") return fail("Enter the 6-digit code from your email.");
  const code = raw.trim();
  if (!/^\d{6}$/.test(code)) return fail("The code is 6 digits. Check your email and try again.");
  return { ok: true, value: code };
}
