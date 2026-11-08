/**
 * Bot-protection tests (Video 1 checklist item 12).
 *
 * The honeypot rule: the real auth forms never send a `website` field,
 * so a filled one means a bot filling fields blindly. Missing, empty,
 * or whitespace-only is a normal human request.
 */

import { describe, expect, it } from "vitest";
import { HONEYPOT_FIELD, isHoneypotFilled, SIGNUP_BURST_MAX, SIGNUP_BURST_WINDOW_MS } from "./bot";

describe("isHoneypotFilled", () => {
  it("is false when the field is missing (the real forms never send it)", () => {
    expect(isHoneypotFilled({ email: "ada@example.com" })).toBe(false);
    expect(isHoneypotFilled({})).toBe(false);
    expect(isHoneypotFilled(null)).toBe(false);
    expect(isHoneypotFilled(undefined)).toBe(false);
  });

  it("is false when the field is empty or whitespace only", () => {
    expect(isHoneypotFilled({ [HONEYPOT_FIELD]: "" })).toBe(false);
    expect(isHoneypotFilled({ [HONEYPOT_FIELD]: "   " })).toBe(false);
  });

  it("is true when the field has any real value (a bot filled it)", () => {
    expect(isHoneypotFilled({ [HONEYPOT_FIELD]: "https://spam.example" })).toBe(true);
    expect(isHoneypotFilled({ [HONEYPOT_FIELD]: "x" })).toBe(true);
  });

  it("ignores a non-string value — only a typed string counts as filled", () => {
    expect(isHoneypotFilled({ [HONEYPOT_FIELD]: 123 })).toBe(false);
    expect(isHoneypotFilled({ [HONEYPOT_FIELD]: true })).toBe(false);
  });

  it("keeps the burst limit strict: 2 signups per 10 minutes per IP", () => {
    expect(SIGNUP_BURST_MAX).toBe(2);
    expect(SIGNUP_BURST_WINDOW_MS).toBe(10 * 60 * 1000);
  });
});
