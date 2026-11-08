/**
 * Auth API routes (Phase B). Server-side only.
 *
 * Wired into src/server.ts by the agent that owns that file, which calls
 * handleAuthApi() for /api/auth/* requests before the TanStack handler
 * runs — the same pattern as handleApiRequest() in src/lib/jobs/api.ts.
 *
 * Routes:
 *   GET    /api/auth/csrf            issue/refresh the rk_csrf cookie
 *   POST   /api/auth/signup          create an account (email confirm)
 *   POST   /api/auth/login           sign in, sets session cookies
 *   POST   /api/auth/logout          sign out, clears session cookies
 *   POST   /api/auth/refresh         trade the refresh cookie for new tokens
 *   POST   /api/auth/forgot-password send a reset email (generic reply)
 *   POST   /api/auth/reset-password  reset with a 6-digit code, a link
 *     token, or a recovery session token from the email link's URL hash
 *   GET    /api/auth/me              who is signed in, from the session cookie
 *
 * Security rules enforced here:
 * - Server-side validation on EVERY field (security/validation.ts). The
 *   page's checks are only for a nicer experience.
 * - CSRF double-submit on every POST (security/csrf.ts): missing or
 *   mismatched token is a 403, before anything else happens.
 * - Login: 3 failed attempts from one IP locks that IP for 15 minutes
 *   (checked BEFORE the password is tried). A wrong password is always
 *   the same generic 401 — never "wrong email" vs "wrong password".
 * - Signup requires an adult (18+) confirmation, checked server-side:
 *   the page's checkbox is convenience only, the API rejects a signup
 *   without `ageConfirmed: true`.
 * - Signup and forgot-password never reveal whether an email already
 *   exists: the reply is the same generic success either way.
 * - Passwords are hashed by Supabase Auth (bcrypt). This file never sees
 *   a plain password in a log, and never stores one anywhere.
 * - No Supabase project yet (see SUPABASE_SETUP.md): when Supabase is
 *   not configured every route except CSRF and logout answers 503
 *   auth_not_configured instead of crashing.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { COUNTRIES } from "../countries";
import {
  csrfCookieHeader,
  csrfInvalidResponse,
  getOrIssueCsrfToken,
  verifyCsrfToken,
} from "../security/csrf";
import {
  errorResponse,
  jsonResponse,
  readJsonBody,
  tooManyResponse,
  withCookies,
} from "../security/http";
import {
  attemptKey,
  checkLocked,
  checkWindowLimit,
  emailAttemptKey,
  getMemoryAttemptStore,
  LOGIN_LOCKOUT_MS,
  LOGIN_MAX_ATTEMPTS,
  recordFailure,
  RESET_CODE_MAX_ATTEMPTS,
  RESET_MAX_PER_HOUR,
  RESET_WINDOW_MS,
  resetAttempts,
  SIGNUP_MAX_PER_HOUR,
  SIGNUP_WINDOW_MS,
  clientIp,
  type AttemptStore,
} from "../security/rate-limit";
import {
  buildSessionCookies,
  clearSessionCookies,
  getSessionTokens,
  isSecureRequest,
} from "../security/session";
import { isHoneypotFilled, SIGNUP_BURST_MAX, SIGNUP_BURST_WINDOW_MS } from "../security/bot";
import {
  validateEmail,
  validatePassword,
  validatePhoneNumber,
  validateResetCode,
} from "../security/validation";
import {
  createPublicClient,
  createServiceClient,
  createUserClient,
  isAdminUser,
} from "../supabase/client";
import { getSiteUrl, isSupabaseConfigured } from "../supabase/env";
import { SupabaseAttemptStore } from "../supabase/rate-limit-store";

/** Injectable deps — tests pass a fake Supabase client and a memory store. */
export interface AuthApiDeps {
  publicClient?: SupabaseClient;
  serviceClient?: SupabaseClient;
  /** Build a client acting AS one user (default: createUserClient). */
  createUserClient?: (accessToken: string) => SupabaseClient;
  store?: AttemptStore;
}

interface ResolvedClients {
  publicClient: SupabaseClient;
  /** Undefined when no service key is set — settings reads are skipped then. */
  serviceClient: SupabaseClient | undefined;
  store: AttemptStore;
}

const AUTH_NOT_CONFIGURED_MESSAGE =
  "Accounts are not set up yet. The creator needs to finish the Supabase setup first (see SUPABASE_SETUP.md).";

/** Build the real clients, or null when Supabase is not configured. */
let serviceKeyWarningLogged = false;

function resolveClients(deps: AuthApiDeps): ResolvedClients | null {
  if (!deps.publicClient && !isSupabaseConfigured()) return null;
  const publicClient = deps.publicClient ?? createPublicClient();
  let serviceClient = deps.serviceClient;
  if (!serviceClient && !deps.publicClient) {
    // The service key is optional: without it the signup-open check is
    // skipped (signups stay open) and attempts fall back to memory.
    try {
      serviceClient = createServiceClient();
    } catch {
      serviceClient = undefined;
      // Say so loudly — but once per process, not on every request:
      // a silent fallback would leave lockouts per-process (lost on
      // restart, useless across instances) with nobody noticing.
      if (!serviceKeyWarningLogged) {
        serviceKeyWarningLogged = true;
        console.warn(
          "Ace Studio auth: SUPABASE_SERVICE_ROLE_KEY is not set — login lockouts use in-process memory only.",
        );
      }
    }
  }
  const store =
    deps.store ??
    (serviceClient ? new SupabaseAttemptStore(serviceClient) : getMemoryAttemptStore());
  return { publicClient, serviceClient, store };
}

/** Is signup open? Read from app_settings when a service client exists.
 *  Fail CLOSED: if the setting cannot be read, signups are closed — a
 *  database error must never silently reopen signups the creator closed. */
async function isSignupOpen(serviceClient: SupabaseClient | undefined): Promise<boolean> {
  if (!serviceClient) return true;
  try {
    const { data, error } = await serviceClient
      .from("app_settings")
      .select("value")
      .eq("key", "signup_open")
      .maybeSingle();
    if (error || !data) {
      console.error("Ace Studio auth: could not read signup_open, failing closed.", error ?? null);
      return false;
    }
    return (data as { value?: unknown }).value !== false;
  } catch (error) {
    console.error("Ace Studio auth: could not read signup_open, failing closed.", error);
    return false;
  }
}

/** Read a POST body and check its CSRF token. Returns the body, or a Response to send. */
async function readCheckedBody(
  request: Request,
): Promise<{ body: Record<string, unknown> } | { response: Response }> {
  const body = await readJsonBody(request);
  if (body === null) {
    return {
      response: errorResponse(400, "bad_json", "Request body must be a JSON object."),
    };
  }
  if (!verifyCsrfToken(request, body)) {
    return { response: csrfInvalidResponse() };
  }
  return { body };
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export async function handleAuthApi(
  request: Request,
  deps: AuthApiDeps = {},
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/auth/")) return null;
  const secure = isSecureRequest(request);

  // --- CSRF token (no Supabase needed — the token lives in a cookie) ------
  if (path === "/api/auth/csrf" && request.method === "GET") {
    const { token } = getOrIssueCsrfToken(request);
    return withCookies(jsonResponse({ csrfToken: token }), [csrfCookieHeader(token, secure)]);
  }

  // --- Logout (works without Supabase too — clearing cookies is local) ----
  if (path === "/api/auth/logout" && request.method === "POST") {
    const checked = await readCheckedBody(request);
    if ("response" in checked) return checked.response;
    const resolved = resolveClients(deps);
    if (resolved) {
      // Clearing cookies alone does NOT end the session: the refresh
      // token stays usable for up to 30 days. Revoke it server-side.
      // With a service key, sign out globally by the user's access
      // token — Supabase revokes every refresh token for that user, so
      // a stolen token dies at logout too. Without a service key there
      // is no server-side revocation available, so the best effort is
      // the public sign-out plus the cookie clearing below.
      const { accessToken } = getSessionTokens(request);
      try {
        if (resolved.serviceClient && accessToken) {
          await resolved.serviceClient.auth.admin.signOut(accessToken, "global");
        } else {
          await resolved.publicClient.auth.signOut();
        }
      } catch {
        // Best effort: the cookies are cleared below either way.
      }
    }
    return withCookies(jsonResponse({ ok: true }), clearSessionCookies(secure));
  }

  const resolved = resolveClients(deps);
  if (!resolved) {
    return errorResponse(503, "auth_not_configured", AUTH_NOT_CONFIGURED_MESSAGE);
  }
  const { publicClient, serviceClient, store } = resolved;
  const ip = clientIp(request);

  try {
    // --- Signup -------------------------------------------------------------
    if (path === "/api/auth/signup" && request.method === "POST") {
      const checked = await readCheckedBody(request);
      if ("response" in checked) return checked.response;
      const body = checked.body;

      // Bot check (honeypot): the real form never sends a `website`
      // field. A filled one means a bot filling fields blindly — answer
      // with the SAME generic success a real signup gets, but create no
      // account and burn no quota, so the bot never learns it was caught.
      if (isHoneypotFilled(body)) {
        return jsonResponse({ message: "Check your email to confirm your account." });
      }

      // Validate FIRST, then rate-limit: junk requests must not burn the
      // 5/hour signup quota (an attacker could otherwise deny signups to
      // everyone sharing an IP with junk requests).
      const email = validateEmail(body["email"]);
      if (!email.ok) return errorResponse(400, "bad_email", email.error);
      const password = validatePassword(body["password"]);
      if (!password.ok) return errorResponse(400, "bad_password", password.error);
      if (asString(body["confirmPassword"]) !== password.value) {
        return errorResponse(400, "password_mismatch", "The two passwords do not match.");
      }
      const dialCode = asString(body["dialCode"]);
      const phone = validatePhoneNumber(dialCode, body["phone"]);
      if (!phone.ok) return errorResponse(400, "bad_phone", phone.error);
      // The country may arrive as its ISO code ("NG") or its display name
      // ("Nigeria") — the page sends the code, older clients sent the name.
      // Match on either, and store the canonical display name.
      const countryInput = asString(body["country"]);
      const countryEntry = COUNTRIES.find(
        (c) => c.code === countryInput || c.name === countryInput,
      );
      if (!countryEntry || countryEntry.dialCode !== dialCode) {
        return errorResponse(400, "bad_country", "Pick your country from the list.");
      }
      const country = countryEntry.name;
      // Age gate: the account is for adults only (18+). A checkbox on
      // the page is not enough — anyone can call this API directly, so
      // the server must see the confirmation too. No date of birth is
      // collected or stored; only the yes/no confirmation.
      if (body["ageConfirmed"] !== true) {
        return errorResponse(
          400,
          "age_not_confirmed",
          "Please confirm you are 18 years or older to create an account.",
        );
      }

      // Bot check (burst) first, so a burst-blocked request does not burn
      // the hourly quota: a real person signs up once. Two signups in 10
      // minutes from one IP is bot behaviour, on top of the 5/hour cap.
      const signupBurst = await checkWindowLimit(
        store,
        attemptKey("signup-burst", ip),
        SIGNUP_BURST_MAX,
        SIGNUP_BURST_WINDOW_MS,
      );
      if (!signupBurst.allowed) {
        return tooManyResponse(
          signupBurst.retryAfterSeconds,
          "Too many accounts created from this device. Try again later.",
        );
      }

      const signupWindow = await checkWindowLimit(
        store,
        attemptKey("signup", ip),
        SIGNUP_MAX_PER_HOUR,
        SIGNUP_WINDOW_MS,
      );
      if (!signupWindow.allowed) {
        return tooManyResponse(
          signupWindow.retryAfterSeconds,
          "Too many accounts created from this device. Try again later.",
        );
      }

      if (!(await isSignupOpen(serviceClient))) {
        return errorResponse(403, "signup_closed", "Signups are closed right now.");
      }

      // The reply is the same whether or not this email already has an
      // account — Supabase may return an error for a duplicate, and we
      // deliberately do not pass that on. But a REAL failure (Supabase
      // rate limit, outage) must not be reported as success: the user
      // would wait forever for a confirmation email that never comes.
      // Only the duplicate case keeps the generic success; anything
      // else is an honest retryable 503.
      const { error: signupError } = await publicClient.auth.signUp({
        email: email.value,
        password: password.value,
        options: {
          data: { phone: phone.value, country, dial_code: dialCode, age_confirmed: true },
        },
      });
      if (signupError) {
        if (/already registered/i.test(signupError.message)) {
          return jsonResponse({ message: "Check your email to confirm your account." });
        }
        console.error("Ace Studio auth: signup failed:", signupError.message);
        return errorResponse(
          503,
          "signup_unavailable",
          "Could not create the account right now. Try again in a few minutes.",
        );
      }
      return jsonResponse({ message: "Check your email to confirm your account." });
    }

    // --- Login --------------------------------------------------------------
    if (path === "/api/auth/login" && request.method === "POST") {
      const checked = await readCheckedBody(request);
      if ("response" in checked) return checked.response;
      const body = checked.body;

      // Bot check (honeypot): same generic 401 a wrong password gets,
      // without recording a failure — a bot must not be able to lock a
      // real user out by burning their shared-IP lockout quota.
      if (isHoneypotFilled(body)) {
        return jsonResponse(
          { error: "wrong_credentials", message: "Email or password is wrong." },
          401,
        );
      }

      const loginKey = attemptKey("login", ip);

      // Lockout first: a locked IP never gets to try a password.
      const locked = await checkLocked(store, loginKey);
      if (!locked.allowed) {
        return tooManyResponse(
          locked.retryAfterSeconds,
          "Too many wrong passwords. Try again in a few minutes.",
        );
      }

      const email = validateEmail(body["email"]);
      if (!email.ok) return errorResponse(400, "bad_email", email.error);
      const password = validatePassword(body["password"]);
      if (!password.ok) return errorResponse(400, "bad_password", password.error);

      const { data, error } = await publicClient.auth.signInWithPassword({
        email: email.value,
        password: password.value,
      });
      if (error || !data.session || !data.user) {
        const failure = await recordFailure(store, loginKey, LOGIN_MAX_ATTEMPTS, LOGIN_LOCKOUT_MS);
        if (!failure.allowed) {
          return tooManyResponse(
            failure.retryAfterSeconds,
            "Too many wrong passwords. Try again in a few minutes.",
          );
        }
        return jsonResponse(
          {
            error: "wrong_credentials",
            message: "Email or password is wrong.",
          },
          401,
        );
      }

      await resetAttempts(store, loginKey);
      const cookies = buildSessionCookies(
        {
          accessToken: data.session.access_token,
          refreshToken: data.session.refresh_token,
        },
        secure,
      );
      return withCookies(
        jsonResponse({ user: { id: data.user.id, email: data.user.email ?? email.value } }),
        cookies,
      );
    }

    // --- Refresh ------------------------------------------------------------
    if (path === "/api/auth/refresh" && request.method === "POST") {
      const checked = await readCheckedBody(request);
      if ("response" in checked) return checked.response;
      const { refreshToken } = getSessionTokens(request);
      if (!refreshToken) {
        return withCookies(
          errorResponse(401, "not_signed_in", "Your session has ended. Sign in again."),
          clearSessionCookies(secure),
        );
      }
      const { data, error } = await publicClient.auth.refreshSession({
        refresh_token: refreshToken,
      });
      if (error || !data.session || !data.user) {
        return withCookies(
          errorResponse(401, "session_expired", "Your session has ended. Sign in again."),
          clearSessionCookies(secure),
        );
      }
      const cookies = buildSessionCookies(
        {
          accessToken: data.session.access_token,
          refreshToken: data.session.refresh_token,
        },
        secure,
      );
      return withCookies(
        jsonResponse({ user: { id: data.user.id, email: data.user.email ?? "" } }),
        cookies,
      );
    }

    // --- Forgot password ----------------------------------------------------
    if (path === "/api/auth/forgot-password" && request.method === "POST") {
      const checked = await readCheckedBody(request);
      if ("response" in checked) return checked.response;
      const body = checked.body;

      // Bot check (honeypot): same generic reply as a real request, but
      // no reset email is sent and no quota is burned.
      if (isHoneypotFilled(body)) {
        return jsonResponse({ message: "If an account uses that email, a code was sent." });
      }

      const email = validateEmail(body["email"]);
      if (!email.ok) return errorResponse(400, "bad_email", email.error);

      const perEmail = await checkWindowLimit(
        store,
        emailAttemptKey("reset", email.value),
        RESET_MAX_PER_HOUR,
        RESET_WINDOW_MS,
      );
      if (!perEmail.allowed) {
        return tooManyResponse(
          perEmail.retryAfterSeconds,
          "Too many reset emails. Try again later.",
        );
      }
      const perIp = await checkWindowLimit(
        store,
        attemptKey("reset", ip),
        RESET_MAX_PER_HOUR,
        RESET_WINDOW_MS,
      );
      if (!perIp.allowed) {
        return tooManyResponse(perIp.retryAfterSeconds, "Too many reset emails. Try again later.");
      }

      // Generic reply either way: never reveal whether the email has an
      // account. A failure to send is swallowed for the same reason.
      // The reset link is built from the configured SITE_URL, never from
      // the request's Host header (an attacker controls that header, and
      // the link carries a recovery token). Without SITE_URL, Supabase
      // uses its own dashboard-configured site URL.
      try {
        const siteUrl = getSiteUrl();
        await publicClient.auth.resetPasswordForEmail(
          email.value,
          siteUrl ? { redirectTo: `${siteUrl}/reset-password` } : undefined,
        );
      } catch {
        // Deliberately ignored — see above.
      }
      return jsonResponse({ message: "If an account uses that email, a code was sent." });
    }

    // --- Reset password -----------------------------------------------------
    if (path === "/api/auth/reset-password" && request.method === "POST") {
      const checked = await readCheckedBody(request);
      if ("response" in checked) return checked.response;
      const body = checked.body;

      const tokenHash = asString(body["tokenHash"]);
      const newPassword = validatePassword(body["newPassword"]);
      if (!newPassword.ok) return errorResponse(400, "bad_password", newPassword.error);
      if (asString(body["confirmPassword"]) !== newPassword.value) {
        return errorResponse(400, "password_mismatch", "The two passwords do not match.");
      }

      // Link flow: the email link carried a long random token hash, which
      // cannot be guessed, so no guess counting is needed for this path.
      if (tokenHash) {
        const { data, error } = await publicClient.auth.verifyOtp({
          token_hash: tokenHash,
          type: "recovery",
        });
        if (error || !data.session) {
          return errorResponse(
            400,
            "bad_reset_link",
            "That reset link is wrong or has expired. Ask for a new one.",
          );
        }
        const updated = await publicClient.auth.updateUser({
          password: newPassword.value,
        });
        if (updated.error) {
          return errorResponse(
            400,
            "reset_failed",
            "Could not change the password. Ask for a new reset email.",
          );
        }
        return jsonResponse({ message: "Your password is changed. Sign in with it." });
      }

      // Recovery-session flow: the real reset email link lands the user
      // on /reset-password with a recovery session in the URL hash
      // (#access_token=...&type=recovery) — never as ?token_hash= and
      // never as a 6-digit code. The page reads that hash and sends the
      // token here; the token itself proves the recovery session, so no
      // guess counting is needed for this path, and only that account's
      // password can change.
      const recoveryAccessToken = asString(body["recoveryAccessToken"]);
      if (recoveryAccessToken) {
        const buildUserClient = deps.createUserClient ?? createUserClient;
        const userClient = buildUserClient(recoveryAccessToken);
        const { data: authed, error: authError } =
          await userClient.auth.getUser(recoveryAccessToken);
        if (authError || !authed.user) {
          return errorResponse(
            400,
            "bad_reset_link",
            "That reset link is wrong or has expired. Ask for a new one.",
          );
        }
        // updateUser() on this client CANNOT work: the client holds no
        // session - the token only travels in the Authorization header,
        // and updateUser needs a session (real Supabase rejects it with
        // "Auth session missing"). Change the password with the Admin API
        // instead. The token above already proved this request belongs
        // to this user, so only that user's password can change.
        if (!serviceClient) {
          return errorResponse(
            503,
            "auth_unavailable",
            "Password reset is unavailable right now. Try again in a few minutes.",
          );
        }
        const sessionUpdated = await serviceClient.auth.admin.updateUserById(authed.user.id, {
          password: newPassword.value,
        });
        if (sessionUpdated.error) {
          return errorResponse(
            400,
            "reset_failed",
            "Could not change the password. Ask for a new reset email.",
          );
        }
        return jsonResponse({ message: "Your password is changed. Sign in with it." });
      }

      // Code flow: a 6-digit code from the email, guess-limited per email.
      const email = validateEmail(body["email"]);
      if (!email.ok) return errorResponse(400, "bad_email", email.error);
      const code = validateResetCode(body["code"]);
      if (!code.ok) return errorResponse(400, "bad_code", code.error);

      const guessKey = emailAttemptKey("reset-code", email.value);
      // Pass the reset-code limit (5), not the login limit (3), so the
      // "remaining" count in the lockout check is right for this flow.
      const locked = await checkLocked(store, guessKey, Date.now(), RESET_CODE_MAX_ATTEMPTS);
      if (!locked.allowed) {
        return tooManyResponse(
          locked.retryAfterSeconds,
          "Too many wrong codes. Ask for a new reset email.",
        );
      }

      const { data, error } = await publicClient.auth.verifyOtp({
        email: email.value,
        token: code.value,
        type: "recovery",
      });
      if (error || !data.session) {
        // A 6th wrong guess (5 allowed) locks code guesses for this email.
        // The lockout length is the same 15 minutes as logins.
        const failure = await recordFailure(
          store,
          guessKey,
          RESET_CODE_MAX_ATTEMPTS,
          LOGIN_LOCKOUT_MS,
        );
        if (!failure.allowed) {
          return tooManyResponse(
            failure.retryAfterSeconds,
            "Too many wrong codes. Ask for a new reset email.",
          );
        }
        return errorResponse(
          400,
          "bad_code",
          "That code is wrong or has expired. Check your email and try again.",
        );
      }

      const updated = await publicClient.auth.updateUser({
        password: newPassword.value,
      });
      if (updated.error) {
        return errorResponse(
          400,
          "reset_failed",
          "Could not change the password. Ask for a new reset email.",
        );
      }
      await resetAttempts(store, guessKey);
      return jsonResponse({ message: "Your password is changed. Sign in with it." });
    }

    // --- Me -----------------------------------------------------------------
    if (path === "/api/auth/me" && request.method === "GET") {
      const { accessToken } = getSessionTokens(request);
      if (!accessToken) {
        return errorResponse(401, "not_signed_in", "Sign in to continue.");
      }
      const { data, error } = await publicClient.auth.getUser(accessToken);
      if (error || !data.user) {
        return errorResponse(401, "not_signed_in", "Sign in to continue.");
      }
      // The admin check runs as the user (RLS sees their identity). In
      // tests the injected public client stands in for the user client.
      const userClient = deps.publicClient ?? createUserClient(accessToken);
      const isAdmin = await isAdminUser(userClient, data.user.id);
      return jsonResponse({
        user: { id: data.user.id, email: data.user.email ?? "", isAdmin },
      });
    }

    if (path.startsWith("/api/auth/")) {
      return errorResponse(404, "not_found", "No such auth route.");
    }
    return null;
  } catch (error) {
    // A store/database failure (e.g. the lockout table is unreachable)
    // must never become a bare 500 or a bypassed lockout: answer 503 so
    // the user can retry, and log the cause server-side.
    console.error("Ace Studio auth: request failed:", error);
    return errorResponse(
      503,
      "auth_unavailable",
      "Accounts are temporarily unavailable. Try again in a moment.",
    );
  }
}
