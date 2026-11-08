import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSessionVault,
  getSessionKey,
  listSessionKeys,
  maskKey,
  newSessionId,
  removeSessionKey,
  saveSessionKey,
  sessionVaultSize,
} from "./byok";

const FAKE_KEY = "test-key-placeholder";

/** Mock fetch that accepts any key (200 with an empty voice list). */
const okFetch = (async () =>
  new Response(JSON.stringify({ voices: [] }), { status: 200 })) as typeof fetch;
/** Mock fetch that rejects the key (401). */
const badFetch = (async () =>
  new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 })) as typeof fetch;

describe("BYOK masking", () => {
  it("shows only the last 4 characters", () => {
    expect(maskKey(FAKE_KEY)).toBe("••••••••lder");
    expect(maskKey("ab")).toBe("••••");
    expect(maskKey("  test-key-placeholder  ")).toBe("••••••••lder");
  });
});

describe("session-only BYOK vault", () => {
  beforeEach(() => clearSessionVault());

  it("validates a key, stores it in memory, and only ever shows it masked", async () => {
    const sessionId = newSessionId();
    const stored = await saveSessionKey(sessionId, "speechify", FAKE_KEY, okFetch);
    expect(stored).toEqual({
      provider: "speechify",
      masked: "••••••••lder",
      validatedAt: expect.any(Number),
    });
    // The full key is retrievable server-side (to make the API call) ...
    expect(getSessionKey(sessionId, "speechify")).toBe(FAKE_KEY);
    // ... but the list the browser sees contains only the masked display.
    const listed = listSessionKeys(sessionId);
    expect(JSON.stringify(listed)).not.toContain("test-key-placeholder");
    expect(listed).toEqual([
      { provider: "speechify", masked: "••••••••lder", validatedAt: expect.any(Number) },
    ]);
    expect(sessionVaultSize()).toBe(1);
  });

  it("refuses a rejected key and stores nothing", async () => {
    const sessionId = newSessionId();
    await expect(saveSessionKey(sessionId, "speechify", FAKE_KEY, badFetch)).rejects.toThrow(
      /rejected/,
    );
    expect(getSessionKey(sessionId, "speechify")).toBeUndefined();
    expect(listSessionKeys(sessionId)).toEqual([]);
  });

  it("refuses empty keys and bad sessions", async () => {
    await expect(saveSessionKey(newSessionId(), "speechify", "   ", okFetch)).rejects.toThrow(
      /empty/,
    );
    await expect(saveSessionKey("bad id!!", "speechify", FAKE_KEY, okFetch)).rejects.toThrow(
      /session/,
    );
    expect(listSessionKeys("bad id!!")).toEqual([]);
  });

  it("removes a key and keeps sessions separate", async () => {
    const a = newSessionId();
    const b = newSessionId();
    await saveSessionKey(a, "speechify", FAKE_KEY, okFetch);
    await saveSessionKey(b, "speechify", "test-key-other-place", okFetch);
    expect(removeSessionKey(a, "speechify")).toBe(true);
    expect(getSessionKey(a, "speechify")).toBeUndefined();
    expect(getSessionKey(b, "speechify")).toBe("test-key-other-place");
    expect(removeSessionKey(a, "speechify")).toBe(false);
  });

  it("makes unguessable session ids", () => {
    const a = newSessionId();
    const b = newSessionId();
    expect(a).toMatch(/^sess_[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });

  it("forgets a key after 24 hours", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-07T00:00:00Z"));
      const sessionId = newSessionId();
      await saveSessionKey(sessionId, "speechify", FAKE_KEY, okFetch);
      expect(getSessionKey(sessionId, "speechify")).toBe(FAKE_KEY);
      // 24 hours and a second later the key is gone.
      vi.setSystemTime(new Date("2026-11-08T00:00:01Z"));
      expect(getSessionKey(sessionId, "speechify")).toBeUndefined();
      expect(listSessionKeys(sessionId)).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
