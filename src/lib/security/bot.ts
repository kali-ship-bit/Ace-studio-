/**
 * Bot protection for the auth routes (Video 1 checklist item 12).
 *
 * There is no CAPTCHA here on purpose: a CAPTCHA needs a third-party
 * account, a site key in the page, and a secret key on the server, and
 * Kenneth has approved $0 spend and no new accounts. Instead the server
 * uses two measures that need no form change and no new service:
 *
 *   1. Honeypot field. The real signup / login / forgot-password forms
 *      never send a field called `website`. A bot that fills every field
 *      it finds will fill it. When it is filled, the request is answered
 *      with the SAME generic reply a real request gets — a bot must never
 *      learn it was spotted — but no account is created, no password is
 *      tried, no reset email is sent, and no rate-limit quota is burned
 *      (so a bot cannot lock real users out by burning their shared-IP
 *      quota either).
 *      WARNING to future form work: never add a real `website` field to
 *      any auth form. If a real website field is ever needed, pick a
 *      different honeypot name here first.
 *   2. Signup burst limit. On top of the existing 5 signups/hour per IP,
 *      at most 2 signups per 10 minutes per IP. A real person signs up
 *      once; a bot hammering the endpoint hits this within seconds.
 *
 * What this does NOT do: it does not stop a human attacker, and it does
 * not stop a bot smart enough to leave unknown fields blank. The login
 * lockout (3 strikes, 15 minutes), the per-IP rate limits, and CSRF are
 * the layers that catch those. If bots ever become a real problem, the
 * next step is a proper CAPTCHA (e.g. Cloudflare Turnstile, which has a
 * free tier) — that needs Kenneth's say-so first.
 */

/** The honeypot field name. The real forms never send this field. */
export const HONEYPOT_FIELD = "website";

/** Signup burst limit: at most 2 signups per 10 minutes from one IP. */
export const SIGNUP_BURST_MAX = 2;
export const SIGNUP_BURST_WINDOW_MS = 10 * 60 * 1000;

/**
 * True when the request looks bot-made: the honeypot field arrived with
 * a non-empty value. A missing field, an empty string, or whitespace
 * only is a normal human request — the real forms never send the field
 * at all, so anything in it came from something filling fields blindly.
 */
export function isHoneypotFilled(body: Record<string, unknown> | null | undefined): boolean {
  if (!body) return false;
  const value = body[HONEYPOT_FIELD];
  return typeof value === "string" && value.trim().length > 0;
}
