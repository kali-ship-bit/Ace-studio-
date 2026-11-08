/**
 * Auth API tests (Phase B).
 *
 * The Supabase client is faked in this file — a small in-memory stand-in
 * implementing only the auth methods the handler calls. No network, no
 * real project, no credentials anywhere in this file.
 */

import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { handleAuthApi, type AuthApiDeps } from "./api";
import { MemoryAttemptStore } from "../security/rate-limit";

const CSRF_TOKEN = "test-csrf-token-0123456789abcdef";

interface FakeUser {
  id: string;
  email: string;
  password: string;
}

interface FakeSession {
  access_token: string;
  refresh_token: string;
  user: { id: string; email: string };
}

function noError() {
  return { message: "fake error" };
}

/** Minimal in-memory Supabase stand-in for the auth handler. */
class FakeSupabase {
  users = new Map<string, FakeUser>();
  resetEmailsSent: string[] = [];
  signupOpen = true;
  /** When set, signUp fails with this message (infra-error simulation). */
  signupError: string | null = null;
  /** Admin sign-out calls, recorded for the logout test. */
  adminSignOutCalls: Array<{ jwt: string; scope: string | undefined }> = [];
  /** Admin password updates, recorded for the recovery-reset test. */
  adminPasswordUpdates: Array<{ id: string; password: string }> = [];
  session: FakeSession | null = null;
  private nextId = 1;
  private tokens = new Map<string, FakeUser>();

  private makeSession(user: FakeUser): FakeSession {
    const session: FakeSession = {
      access_token: `access-${user.id}`,
      refresh_token: `refresh-${user.id}`,
      user: { id: user.id, email: user.email },
    };
    this.tokens.set(session.access_token, user);
    this.tokens.set(session.refresh_token, user);
    this.session = session;
    return session;
  }

  auth = {
    signUp: async (input: { email: string; password: string }) => {
      if (this.signupError) {
        return { data: { user: null, session: null }, error: { message: this.signupError } };
      }
      if (this.users.has(input.email)) {
        return {
          data: { user: null, session: null },
          error: { message: "User already registered" },
        };
      }
      const user: FakeUser = {
        id: `user-${this.nextId}`,
        email: input.email,
        password: input.password,
      };
      this.nextId += 1;
      this.users.set(input.email, user);
      return {
        data: { user: { id: user.id, email: user.email }, session: null },
        error: null,
      };
    },

    signInWithPassword: async (input: { email: string; password: string }) => {
      const user = this.users.get(input.email);
      if (!user || user.password !== input.password) {
        return { data: { user: null, session: null }, error: noError() };
      }
      const session = this.makeSession(user);
      return { data: { user: session.user, session }, error: null };
    },

    signOut: async () => {
      this.session = null;
      return { error: null };
    },

    admin: {
      signOut: async (jwt: string, scope?: string) => {
        this.adminSignOutCalls.push({ jwt, scope });
        return { error: null };
      },

      updateUserById: async (id: string, input: { password: string }) => {
        this.adminPasswordUpdates.push({ id, password: input.password });
        const user = [...this.users.values()].find((u) => u.id === id);
        if (!user) return { data: { user: null }, error: noError() };
        user.password = input.password;
        return { data: { user: { id: user.id, email: user.email } }, error: null };
      },
    },

    resetPasswordForEmail: async (email: string) => {
      if (this.users.has(email)) this.resetEmailsSent.push(email);
      return { data: {}, error: null };
    },

    verifyOtp: async (params: {
      email?: string;
      token?: string;
      token_hash?: string;
      type: string;
    }) => {
      void params.type;
      if (params.token_hash) {
        if (params.token_hash !== "valid-token-hash") {
          return { data: { user: null, session: null }, error: noError() };
        }
        const user = [...this.users.values()][0];
        if (!user) return { data: { user: null, session: null }, error: noError() };
        const session = this.makeSession(user);
        return { data: { user: session.user, session }, error: null };
      }
      const user = params.email ? this.users.get(params.email) : undefined;
      if (!user || params.token !== "123456") {
        return { data: { user: null, session: null }, error: noError() };
      }
      const session = this.makeSession(user);
      return { data: { user: session.user, session }, error: null };
    },

    updateUser: async (input: { password: string }) => {
      const user = this.session ? this.users.get(this.session.user.email) : undefined;
      if (!user) {
        return { data: { user: null }, error: noError() };
      }
      user.password = input.password;
      return { data: { user: { id: user.id, email: user.email } }, error: null };
    },

    refreshSession: async (input: { refresh_token: string }) => {
      const user = this.tokens.get(input.refresh_token);
      if (!user) {
        return { data: { user: null, session: null }, error: noError() };
      }
      const session = this.makeSession(user);
      return { data: { user: session.user, session }, error: null };
    },

    getUser: async (token: string) => {
      const user = this.tokens.get(token);
      if (!user) return { data: { user: null }, error: noError() };
      return { data: { user: { id: user.id, email: user.email } }, error: null };
    },
  };

  from = (table: string) => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: async () => {
        if (table === "app_settings") {
          return { data: { value: this.signupOpen }, error: null };
        }
        if (table === "profiles") {
          return { data: { is_admin: false }, error: null };
        }
        return { data: null, error: null };
      },
      upsert: async () => ({ error: null }),
      delete: () => builder,
    };
    return builder;
  };
}

function makeDeps(fake: FakeSupabase, extra?: Partial<AuthApiDeps>): AuthApiDeps {
  return {
    publicClient: fake as unknown as SupabaseClient,
    store: new MemoryAttemptStore(),
    ...extra,
  };
}

function csrfHeaders(ip?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    cookie: `rk_csrf=${CSRF_TOKEN}`,
    "x-csrf-token": CSRF_TOKEN,
  };
  if (ip) headers["x-forwarded-for"] = ip;
  return headers;
}

async function call(
  path: string,
  deps: AuthApiDeps,
  init?: { method?: string; body?: unknown; headers?: Record<string, string> },
): Promise<Response> {
  const res = await handleAuthApi(
    new Request(`http://localhost${path}`, {
      method: init?.method ?? "POST",
      headers: init?.headers ?? csrfHeaders(),
      body: init?.body === undefined ? "{}" : JSON.stringify(init.body),
    }),
    deps,
  );
  if (!res) throw new Error(`handler returned null for ${path}`);
  return res;
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

function cookieHeader(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0] as string)
    .join("; ");
}

const SIGNUP_BODY = {
  email: "ada@example.com",
  password: "secret1",
  confirmPassword: "secret1",
  phone: "8028289087",
  dialCode: "+234",
  country: "Nigeria",
  ageConfirmed: true,
};

async function signedUpFake(): Promise<{ fake: FakeSupabase; deps: AuthApiDeps }> {
  const fake = new FakeSupabase();
  const deps = makeDeps(fake);
  const res = await call("/api/auth/signup", deps, { body: SIGNUP_BODY });
  expect(res.status).toBe(200);
  return { fake, deps };
}

describe("signup", () => {
  it("rejects a password shorter than 6 characters", async () => {
    const fake = new FakeSupabase();
    const deps = makeDeps(fake);
    const res = await call("/api/auth/signup", deps, {
      body: { ...SIGNUP_BODY, password: "abc", confirmPassword: "abc" },
    });
    expect(res.status).toBe(400);
    expect((await readJson(res))["error"]).toBe("bad_password");
  });

  it("rejects a password longer than 8 characters", async () => {
    const fake = new FakeSupabase();
    const deps = makeDeps(fake);
    const res = await call("/api/auth/signup", deps, {
      body: { ...SIGNUP_BODY, password: "toolongpass", confirmPassword: "toolongpass" },
    });
    expect(res.status).toBe(400);
    expect((await readJson(res))["error"]).toBe("bad_password");
  });

  it("rejects signup without the 18+ confirmation", async () => {
    const fake = new FakeSupabase();
    const deps = makeDeps(fake);
    const missing = await call("/api/auth/signup", deps, {
      body: { ...SIGNUP_BODY, ageConfirmed: undefined },
    });
    expect(missing.status).toBe(400);
    expect((await readJson(missing))["error"]).toBe("age_not_confirmed");
    // A "false" is not a confirmation either — the server needs `true`.
    const unchecked = await call("/api/auth/signup", deps, {
      body: { ...SIGNUP_BODY, ageConfirmed: false },
    });
    expect(unchecked.status).toBe(400);
    expect((await readJson(unchecked))["error"]).toBe("age_not_confirmed");
    expect(fake.users.size).toBe(0);
  });

  it("rejects mismatched confirmation and a bad phone number", async () => {
    const fake = new FakeSupabase();
    const deps = makeDeps(fake);
    const mismatch = await call("/api/auth/signup", deps, {
      body: { ...SIGNUP_BODY, confirmPassword: "secret2" },
    });
    expect(mismatch.status).toBe(400);
    const badPhone = await call("/api/auth/signup", deps, {
      body: { ...SIGNUP_BODY, phone: "not-a-number" },
    });
    expect(badPhone.status).toBe(400);
  });

  it("returns the same generic success for a new and an existing email", async () => {
    const fake = new FakeSupabase();
    const deps = makeDeps(fake);
    const first = await call("/api/auth/signup", deps, { body: SIGNUP_BODY });
    expect(first.status).toBe(200);
    expect((await readJson(first))["message"]).toBe("Check your email to confirm your account.");
    const second = await call("/api/auth/signup", deps, { body: SIGNUP_BODY });
    expect(second.status).toBe(200);
    expect((await readJson(second))["message"]).toBe("Check your email to confirm your account.");
  });

  it("answers 503 when Supabase cannot create the account, instead of a fake success", async () => {
    const fake = new FakeSupabase();
    fake.signupError = "email rate limit exceeded";
    const deps = makeDeps(fake);
    const res = await call("/api/auth/signup", deps, { body: SIGNUP_BODY });
    expect(res.status).toBe(503);
    expect((await readJson(res))["error"]).toBe("signup_unavailable");
    expect(fake.users.size).toBe(0);
  });

  it("rejects signup when the creator has closed signups", async () => {
    const fake = new FakeSupabase();
    fake.signupOpen = false;
    const deps = makeDeps(fake, {
      serviceClient: fake as unknown as SupabaseClient,
    });
    const res = await call("/api/auth/signup", deps, { body: SIGNUP_BODY });
    expect(res.status).toBe(403);
    expect((await readJson(res))["error"]).toBe("signup_closed");
  });
});

describe("login lockout", () => {
  it("locks the IP on the 3rd failed login and answers 429 after that", async () => {
    const { deps } = await signedUpFake();
    const wrong = { email: "ada@example.com", password: "wrong123" };
    const first = await call("/api/auth/login", deps, { body: wrong });
    expect(first.status).toBe(401);
    expect((await readJson(first))["message"]).toBe("Email or password is wrong.");
    const second = await call("/api/auth/login", deps, { body: wrong });
    expect(second.status).toBe(401);
    const third = await call("/api/auth/login", deps, { body: wrong });
    expect(third.status).toBe(429);
    const fourth = await call("/api/auth/login", deps, { body: wrong });
    expect(fourth.status).toBe(429);
    expect((await readJson(fourth))["retryAfterSeconds"]).toBeGreaterThan(0);
    // Even the right password is refused while the IP is locked.
    const right = await call("/api/auth/login", deps, {
      body: { email: "ada@example.com", password: "secret1" },
    });
    expect(right.status).toBe(429);
  });

  it("signs in on the right password and sets session cookies", async () => {
    const { deps } = await signedUpFake();
    const res = await call("/api/auth/login", deps, {
      body: { email: "ada@example.com", password: "secret1" },
    });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect((body["user"] as { email?: string })["email"]).toBe("ada@example.com");
    const cookies = res.headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith("rk_access_token="))).toBe(true);
    expect(cookies.some((c) => c.startsWith("rk_refresh_token="))).toBe(true);
  });
});

describe("CSRF", () => {
  it("rejects a POST with no CSRF token (403)", async () => {
    const { deps } = await signedUpFake();
    const res = await call("/api/auth/login", deps, {
      body: { email: "ada@example.com", password: "secret1" },
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(403);
    expect((await readJson(res))["error"]).toBe("csrf_invalid");
  });

  it("issues a token from GET /api/auth/csrf", async () => {
    const res = await handleAuthApi(
      new Request("http://localhost/api/auth/csrf", { method: "GET" }),
      makeDeps(new FakeSupabase()),
    );
    expect(res).not.toBeNull();
    expect(res?.status).toBe(200);
    const body = (await res?.json()) as { csrfToken?: string };
    expect(typeof body.csrfToken).toBe("string");
    expect((body.csrfToken ?? "").length).toBeGreaterThan(20);
  });
});

describe("forgot password", () => {
  it("never reveals whether the email exists", async () => {
    const { fake, deps } = await signedUpFake();
    const known = await call("/api/auth/forgot-password", deps, {
      body: { email: "ada@example.com" },
    });
    expect(known.status).toBe(200);
    const knownBody = await readJson(known);
    const unknown = await call("/api/auth/forgot-password", deps, {
      body: { email: "nobody@example.com" },
    });
    expect(unknown.status).toBe(200);
    const unknownBody = await readJson(unknown);
    expect(knownBody).toEqual(unknownBody);
    expect(knownBody["message"]).toBe("If an account uses that email, a code was sent.");
    expect(fake.resetEmailsSent).toEqual(["ada@example.com"]);
  });
});

describe("reset password", () => {
  it("fails with a wrong code and succeeds with the right one", async () => {
    const { deps } = await signedUpFake();
    const wrong = await call("/api/auth/reset-password", deps, {
      body: {
        email: "ada@example.com",
        code: "000000",
        newPassword: "newpass1",
        confirmPassword: "newpass1",
      },
    });
    expect(wrong.status).toBe(400);
    expect((await readJson(wrong))["error"]).toBe("bad_code");

    const right = await call("/api/auth/reset-password", deps, {
      body: {
        email: "ada@example.com",
        code: "123456",
        newPassword: "newpass1",
        confirmPassword: "newpass1",
      },
    });
    expect(right.status).toBe(200);

    // The new password now signs in.
    const login = await call("/api/auth/login", deps, {
      body: { email: "ada@example.com", password: "newpass1" },
    });
    expect(login.status).toBe(200);
  });

  it("locks code guesses after 5 wrong codes", async () => {
    const { deps } = await signedUpFake();
    const body = {
      email: "ada@example.com",
      code: "000000",
      newPassword: "newpass1",
      confirmPassword: "newpass1",
    };
    for (let i = 0; i < 4; i += 1) {
      expect((await call("/api/auth/reset-password", deps, { body })).status).toBe(400);
    }
    expect((await call("/api/auth/reset-password", deps, { body })).status).toBe(429);
    expect((await call("/api/auth/reset-password", deps, { body })).status).toBe(429);
  });

  it("accepts a valid link token and rejects a bad one", async () => {
    const { deps } = await signedUpFake();
    const bad = await call("/api/auth/reset-password", deps, {
      body: {
        tokenHash: "not-a-real-token",
        newPassword: "newpass1",
        confirmPassword: "newpass1",
      },
    });
    expect(bad.status).toBe(400);
    const good = await call("/api/auth/reset-password", deps, {
      body: {
        tokenHash: "valid-token-hash",
        newPassword: "newpass1",
        confirmPassword: "newpass1",
      },
    });
    expect(good.status).toBe(200);
  });

  it("accepts a recovery session token from the email link hash and rejects a bad one", async () => {
    const { fake, deps } = await signedUpFake();
    // Log in to hold a real session token, the way the email link's
    // URL hash (#access_token=...&type=recovery) hands one to the page.
    const login = await call("/api/auth/login", deps, {
      body: { email: "ada@example.com", password: "secret1" },
    });
    expect(login.status).toBe(200);
    const match = /rk_access_token=([^;]+)/.exec(cookieHeader(login));
    expect(match?.[1]).toBeTruthy();
    const accessToken = decodeURIComponent(match?.[1] as string);
    const recoveryDeps: AuthApiDeps = {
      ...deps,
      serviceClient: fake as unknown as SupabaseClient,
      createUserClient: () => fake as unknown as SupabaseClient,
    };

    const bad = await call("/api/auth/reset-password", recoveryDeps, {
      body: {
        recoveryAccessToken: "not-a-real-token",
        newPassword: "newpass1",
        confirmPassword: "newpass1",
      },
    });
    expect(bad.status).toBe(400);
    expect((await readJson(bad))["error"]).toBe("bad_reset_link");

    const good = await call("/api/auth/reset-password", recoveryDeps, {
      body: {
        recoveryAccessToken: accessToken,
        newPassword: "newpass1",
        confirmPassword: "newpass1",
      },
    });
    expect(good.status).toBe(200);
    // The password changed through the Admin API, for the token owner's
    // id only — never through the session-less user client.
    expect(fake.adminPasswordUpdates).toEqual([{ id: "user-1", password: "newpass1" }]);

    // The new password now signs in.
    const relogin = await call("/api/auth/login", deps, {
      body: { email: "ada@example.com", password: "newpass1" },
    });
    expect(relogin.status).toBe(200);
  });
});

describe("session routes", () => {
  it("answers 401 on /me with no session, and the user after login", async () => {
    const { deps } = await signedUpFake();
    const anon = await handleAuthApi(new Request("http://localhost/api/auth/me"), deps);
    expect(anon?.status).toBe(401);

    const login = await call("/api/auth/login", deps, {
      body: { email: "ada@example.com", password: "secret1" },
    });
    const cookies = cookieHeader(login);
    const me = await handleAuthApi(
      new Request("http://localhost/api/auth/me", { headers: { cookie: cookies } }),
      deps,
    );
    expect(me?.status).toBe(200);
    const body = (await me?.json()) as { user?: { email?: string; isAdmin?: boolean } };
    expect(body.user?.email).toBe("ada@example.com");
    expect(body.user?.isAdmin).toBe(false);
  });

  it("refreshes the session from the refresh cookie", async () => {
    const { deps } = await signedUpFake();
    const login = await call("/api/auth/login", deps, {
      body: { email: "ada@example.com", password: "secret1" },
    });
    const cookies = cookieHeader(login);
    const res = await call("/api/auth/refresh", deps, {
      headers: { ...csrfHeaders(), cookie: `${cookies}; rk_csrf=${CSRF_TOKEN}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().some((c) => c.startsWith("rk_access_token="))).toBe(true);
  });

  it("logs out and clears the session cookies", async () => {
    const { deps } = await signedUpFake();
    const login = await call("/api/auth/login", deps, {
      body: { email: "ada@example.com", password: "secret1" },
    });
    const cookies = cookieHeader(login);
    const res = await call("/api/auth/logout", deps, {
      headers: { ...csrfHeaders(), cookie: `${cookies}; rk_csrf=${CSRF_TOKEN}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().some((c) => c.includes("Max-Age=0"))).toBe(true);
  });

  it("revokes the session server-side on logout (admin sign-out, global scope)", async () => {
    const { fake, deps } = await signedUpFake();
    const login = await call("/api/auth/login", deps, {
      body: { email: "ada@example.com", password: "secret1" },
    });
    const cookies = cookieHeader(login);
    const accessToken = fake.session?.access_token;
    expect(accessToken).toBeTruthy();
    const res = await call(
      "/api/auth/logout",
      { ...deps, serviceClient: fake as unknown as SupabaseClient },
      { headers: { ...csrfHeaders(), cookie: `${cookies}; rk_csrf=${CSRF_TOKEN}` } },
    );
    expect(res.status).toBe(200);
    // The user's tokens are revoked on the server, not just deleted
    // from this browser — a stolen refresh token dies at logout too.
    expect(fake.adminSignOutCalls).toHaveLength(1);
    expect(fake.adminSignOutCalls[0]?.jwt).toBe(accessToken);
    expect(fake.adminSignOutCalls[0]?.scope).toBe("global");
  });
});

describe("bot protection (honeypot + signup burst)", () => {
  it("signup with the honeypot filled gets the generic success but creates no account", async () => {
    const fake = new FakeSupabase();
    const deps = makeDeps(fake);
    const res = await call("/api/auth/signup", deps, {
      body: { ...SIGNUP_BODY, website: "https://spam.example" },
    });
    expect(res.status).toBe(200);
    expect((await readJson(res))["message"]).toBe("Check your email to confirm your account.");
    expect(fake.users.size).toBe(0);
    // And it burned no quota: a real signup from the same IP still works.
    const real = await call("/api/auth/signup", deps, { body: SIGNUP_BODY });
    expect(real.status).toBe(200);
    expect(fake.users.size).toBe(1);
  });

  it("login with the honeypot filled gets a generic 401 and records no failure", async () => {
    const { fake, deps } = await signedUpFake();
    void fake;
    const botBody = {
      email: "ada@example.com",
      password: "wrong123",
      website: "https://spam.example",
    };
    for (let i = 0; i < 3; i += 1) {
      const res = await call("/api/auth/login", deps, { body: botBody });
      expect(res.status).toBe(401);
    }
    // No lockout was recorded: the real password still signs in.
    const real = await call("/api/auth/login", deps, {
      body: { email: "ada@example.com", password: "secret1" },
    });
    expect(real.status).toBe(200);
  });

  it("forgot-password with the honeypot filled sends no reset email", async () => {
    const { fake, deps } = await signedUpFake();
    const res = await call("/api/auth/forgot-password", deps, {
      body: { email: "ada@example.com", website: "https://spam.example" },
    });
    expect(res.status).toBe(200);
    expect((await readJson(res))["message"]).toBe(
      "If an account uses that email, a code was sent.",
    );
    expect(fake.resetEmailsSent).toEqual([]);
  });

  it("blocks a 3rd signup within 10 minutes from one IP (burst limit)", async () => {
    const fake = new FakeSupabase();
    const deps = makeDeps(fake);
    const first = await call("/api/auth/signup", deps, { body: SIGNUP_BODY });
    expect(first.status).toBe(200);
    const second = await call("/api/auth/signup", deps, {
      body: { ...SIGNUP_BODY, email: "second@example.com" },
    });
    expect(second.status).toBe(200);
    const third = await call("/api/auth/signup", deps, {
      body: { ...SIGNUP_BODY, email: "third@example.com" },
    });
    expect(third.status).toBe(429);
    expect((await readJson(third))["error"]).toBe("too_many_requests");
    expect(fake.users.size).toBe(2);
  });
});

describe("not configured", () => {
  it("answers 503 when no Supabase project is configured", async () => {
    const savedUrl = process.env["SUPABASE_URL"];
    const savedAnon = process.env["SUPABASE_ANON_KEY"];
    delete process.env["SUPABASE_URL"];
    delete process.env["SUPABASE_ANON_KEY"];
    try {
      const res = await handleAuthApi(
        new Request("http://localhost/api/auth/login", {
          method: "POST",
          headers: csrfHeaders(),
          body: JSON.stringify({ email: "ada@example.com", password: "secret1" }),
        }),
        {},
      );
      expect(res?.status).toBe(503);
      expect(((await res?.json()) as { error?: string })["error"]).toBe("auth_not_configured");
    } finally {
      if (savedUrl !== undefined) process.env["SUPABASE_URL"] = savedUrl;
      if (savedAnon !== undefined) process.env["SUPABASE_ANON_KEY"] = savedAnon;
    }
  });
});
