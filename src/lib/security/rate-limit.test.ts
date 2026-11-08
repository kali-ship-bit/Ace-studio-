import { describe, expect, it } from "vitest";
import {
  attemptKey,
  checkApiRateLimit,
  checkLocked,
  checkWindowLimit,
  getMemoryAttemptStore,
  LOGIN_LOCKOUT_MS,
  LOGIN_MAX_ATTEMPTS,
  MemoryAttemptStore,
  NARRATE_MAX_PER_MINUTE,
  POSTING_MAX_PER_MINUTE,
  recordFailure,
  resetAttempts,
} from "./rate-limit";

describe("rate limiting — 3 failed logins, then a 15-minute lockout", () => {
  it("allows the first two failures, locks on the third", async () => {
    const store = getMemoryAttemptStore();
    const key = attemptKey("login", "203.0.113.7");
    const first = await recordFailure(store, key, LOGIN_MAX_ATTEMPTS, LOGIN_LOCKOUT_MS, 1_000);
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(2);
    const second = await recordFailure(store, key, LOGIN_MAX_ATTEMPTS, LOGIN_LOCKOUT_MS, 2_000);
    expect(second.remaining).toBe(1);
    const third = await recordFailure(store, key, LOGIN_MAX_ATTEMPTS, LOGIN_LOCKOUT_MS, 3_000);
    expect(third.allowed).toBe(false);
    expect(third.lockedUntil).toBe(3_000 + LOGIN_LOCKOUT_MS);
    expect(third.retryAfterSeconds).toBe(15 * 60);
  });

  it("reports the lockout before another attempt and clears on success", async () => {
    const store = getMemoryAttemptStore();
    const key = attemptKey("login", "198.51.100.9");
    await recordFailure(store, key, LOGIN_MAX_ATTEMPTS, LOGIN_LOCKOUT_MS, 1_000);
    await recordFailure(store, key, LOGIN_MAX_ATTEMPTS, LOGIN_LOCKOUT_MS, 2_000);
    await recordFailure(store, key, LOGIN_MAX_ATTEMPTS, LOGIN_LOCKOUT_MS, 3_000);
    const locked = await checkLocked(store, key, 4_000);
    expect(locked.allowed).toBe(false);
    expect(locked.retryAfterSeconds).toBeGreaterThan(0);
    // After the lockout expires, the user can try again.
    const after = await checkLocked(store, key, 3_000 + LOGIN_LOCKOUT_MS + 1_000);
    expect(after.allowed).toBe(true);
    // A successful login clears the count entirely.
    await resetAttempts(store, key);
    expect(await store.get(key)).toBeNull();
  });

  it("starts counting fresh after a lockout expires — one more failure does not instantly re-lock", async () => {
    const store = new MemoryAttemptStore();
    const key = attemptKey("login", "203.0.113.99");
    await recordFailure(store, key, LOGIN_MAX_ATTEMPTS, LOGIN_LOCKOUT_MS, 1_000);
    await recordFailure(store, key, LOGIN_MAX_ATTEMPTS, LOGIN_LOCKOUT_MS, 2_000);
    await recordFailure(store, key, LOGIN_MAX_ATTEMPTS, LOGIN_LOCKOUT_MS, 3_000);
    // Lockout has expired; the next failure is failure #1 again, not #4.
    const afterExpiry = await recordFailure(
      store,
      key,
      LOGIN_MAX_ATTEMPTS,
      LOGIN_LOCKOUT_MS,
      3_000 + LOGIN_LOCKOUT_MS + 1_000,
    );
    expect(afterExpiry.allowed).toBe(true);
    expect(afterExpiry.remaining).toBe(2);
  });

  it("checkLocked reports remaining against the caller's max (reset codes allow 5)", async () => {
    const store = new MemoryAttemptStore();
    const key = "reset-code:test@example.com";
    await recordFailure(store, key, 5, LOGIN_LOCKOUT_MS, 1_000);
    await recordFailure(store, key, 5, LOGIN_LOCKOUT_MS, 2_000);
    const check = await checkLocked(store, key, 3_000, 5);
    expect(check.allowed).toBe(true);
    expect(check.remaining).toBe(3);
  });

  it("clientIp trusts the LAST x-forwarded-for entry, not the spoofable first one", async () => {
    // The test setup sets TRUST_PROXY=1 (tests simulate a deployment
    // behind a trusted edge proxy, as in production).
    const { clientIp } = await import("./rate-limit");
    const req = new Request("http://localhost/api/auth/login", {
      headers: { "x-forwarded-for": "203.0.113.1, 198.51.100.2, 192.0.2.3" },
    });
    expect(clientIp(req)).toBe("192.0.2.3");
    const single = new Request("http://localhost/api/auth/login", {
      headers: { "x-forwarded-for": "203.0.113.1" },
    });
    expect(clientIp(single)).toBe("203.0.113.1");
  });

  it("clientIp ignores proxy headers when no proxy is trusted (spoof-proof)", async () => {
    const { clientIp } = await import("./rate-limit");
    const saved = process.env["TRUST_PROXY"];
    delete process.env["TRUST_PROXY"];
    try {
      const req = new Request("http://localhost/api/auth/login", {
        headers: {
          "x-forwarded-for": "203.0.113.1, 198.51.100.2",
          "x-real-ip": "203.0.113.1",
        },
      });
      expect(clientIp(req)).toBe("unknown");
    } finally {
      if (saved !== undefined) process.env["TRUST_PROXY"] = saved;
    }
  });

  it("MemoryAttemptStore evicts the oldest entries past its cap", async () => {
    const store = new MemoryAttemptStore();
    for (let i = 0; i < 10_050; i++) {
      await store.set(`k${i}`, { count: 1, lockedUntil: 0, windowStart: 1_000 });
    }
    expect(await store.get("k0")).toBeNull();
    expect(await store.get("k10049")).not.toBeNull();
  });
});

describe("window limits (signup / reset)", () => {
  it("allows up to the max per window, then blocks until the window ends", async () => {
    const store = getMemoryAttemptStore();
    const key = "signup:test-window";
    const windowMs = 60_000;
    expect((await checkWindowLimit(store, key, 2, windowMs, 1_000)).allowed).toBe(true);
    expect((await checkWindowLimit(store, key, 2, windowMs, 2_000)).allowed).toBe(true);
    const third = await checkWindowLimit(store, key, 2, windowMs, 3_000);
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSeconds).toBeGreaterThan(0);
    // A new window starts fresh.
    expect((await checkWindowLimit(store, key, 2, windowMs, 1_000 + windowMs + 1)).allowed).toBe(
      true,
    );
  });
});

describe("checkApiRateLimit — mutating API routes (Phase C)", () => {
  it("allows up to the per-minute max, then blocks with a retry delay", async () => {
    const store = new MemoryAttemptStore();
    const req = new Request("http://localhost/api/narrate", { method: "POST" });
    for (let i = 0; i < NARRATE_MAX_PER_MINUTE; i++) {
      expect((await checkApiRateLimit(req, "narrate", NARRATE_MAX_PER_MINUTE, store)).allowed).toBe(
        true,
      );
    }
    const blocked = await checkApiRateLimit(req, "narrate", NARRATE_MAX_PER_MINUTE, store);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("limits each route group separately", async () => {
    const store = new MemoryAttemptStore();
    const req = new Request("http://localhost/api/narrate", { method: "POST" });
    for (let i = 0; i < NARRATE_MAX_PER_MINUTE; i++) {
      await checkApiRateLimit(req, "narrate", NARRATE_MAX_PER_MINUTE, store);
    }
    expect((await checkApiRateLimit(req, "post", POSTING_MAX_PER_MINUTE, store)).allowed).toBe(
      true,
    );
  });
});
