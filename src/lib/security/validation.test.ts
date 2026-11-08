import { describe, expect, it } from "vitest";
import {
  AVATAR_ALLOWED_MIMES,
  AVATAR_MAX_BYTES,
  isRealImageBytes,
  isSafeRedirect,
  validateEmail,
  validatePassword,
  validatePhoneNumber,
  validateResetCode,
  validateUpload,
} from "./validation";

describe("validateEmail", () => {
  it("accepts a normal address and lowercases it", () => {
    expect(validateEmail("Kenneth@Example.com")).toEqual({
      ok: true,
      value: "kenneth@example.com",
    });
  });
  it("rejects missing @, missing domain and non-strings", () => {
    expect(validateEmail("not-an-email").ok).toBe(false);
    expect(validateEmail("a@b").ok).toBe(false);
    expect(validateEmail("").ok).toBe(false);
    expect(validateEmail(42).ok).toBe(false);
  });
});

describe("validatePassword — Kenneth's rule: 6 to 8 characters", () => {
  it("accepts 6, 7 and 8 characters", () => {
    expect(validatePassword("123456").ok).toBe(true);
    expect(validatePassword("1234567").ok).toBe(true);
    expect(validatePassword("12345678").ok).toBe(true);
  });
  it("rejects 5 and 9 characters", () => {
    expect(validatePassword("12345").ok).toBe(false);
    expect(validatePassword("123456789").ok).toBe(false);
  });
  it("rejects empty and blank passwords", () => {
    expect(validatePassword("").ok).toBe(false);
    expect(validatePassword("   ").ok).toBe(false);
  });
});

describe("validatePhoneNumber", () => {
  it("joins Nigeria +234 with the typed number and strips a leading 0", () => {
    expect(validatePhoneNumber("+234", "08028289087")).toEqual({
      ok: true,
      value: "+2348028289087",
    });
  });
  it("accepts numbers typed with spaces and dashes", () => {
    expect(validatePhoneNumber("+233", "024 123-4567").ok).toBe(true);
  });
  it("rejects an unknown dial code, letters, and too-short numbers", () => {
    expect(validatePhoneNumber("+999", "08012345678").ok).toBe(false);
    expect(validatePhoneNumber("+234", "abc").ok).toBe(false);
    expect(validatePhoneNumber("+234", "123").ok).toBe(false);
  });
});

describe("validateUpload", () => {
  it("accepts a small jpg avatar", () => {
    expect(
      validateUpload(
        { size: 100_000, mime: "image/jpeg" },
        AVATAR_MAX_BYTES,
        AVATAR_ALLOWED_MIMES,
        "profile picture",
      ),
    ).toEqual({ ok: true, value: "image/jpeg" });
  });
  it("rejects oversized files and disallowed types", () => {
    expect(
      validateUpload(
        { size: AVATAR_MAX_BYTES + 1, mime: "image/jpeg" },
        AVATAR_MAX_BYTES,
        AVATAR_ALLOWED_MIMES,
        "profile picture",
      ).ok,
    ).toBe(false);
    expect(
      validateUpload(
        { size: 100, mime: "application/x-msdownload" },
        AVATAR_MAX_BYTES,
        AVATAR_ALLOWED_MIMES,
        "profile picture",
      ).ok,
    ).toBe(false);
  });
});

describe("isSafeRedirect", () => {
  it("allows same-site paths only", () => {
    expect(isSafeRedirect("/dashboard")).toBe(true);
    expect(isSafeRedirect("https://evil.example.com")).toBe(false);
    expect(isSafeRedirect("//evil.example.com")).toBe(false);
    expect(isSafeRedirect("/\\evil")).toBe(false);
  });
});

describe("validateResetCode", () => {
  it("accepts exactly 6 digits", () => {
    expect(validateResetCode("123456")).toEqual({ ok: true, value: "123456" });
    expect(validateResetCode("12345").ok).toBe(false);
    expect(validateResetCode("12345a").ok).toBe(false);
  });
});

describe("isRealImageBytes — the file's first bytes must match its claimed type", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const webp = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2, 3,
  ]);
  const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");

  it("accepts real JPEG, PNG and WebP bytes", () => {
    expect(isRealImageBytes(jpeg, "image/jpeg")).toBe(true);
    expect(isRealImageBytes(png, "image/png")).toBe(true);
    expect(isRealImageBytes(webp, "image/webp")).toBe(true);
  });

  it("rejects a script relabelled as a picture, and mismatched types", () => {
    expect(isRealImageBytes(html, "image/png")).toBe(false);
    expect(isRealImageBytes(html, "image/jpeg")).toBe(false);
    expect(isRealImageBytes(png, "image/jpeg")).toBe(false);
    expect(isRealImageBytes(jpeg, "image/png")).toBe(false);
    expect(isRealImageBytes(new Uint8Array([1, 2, 3]), "image/png")).toBe(false);
    expect(isRealImageBytes(png, "image/gif")).toBe(false);
  });
});
