import { describe, expect, it } from "vitest";
import { parseRecoveryHash } from "./recovery-hash";

describe("parseRecoveryHash", () => {
  it("returns the access token from a recovery hash", () => {
    expect(parseRecoveryHash("#access_token=tok-123&token_type=bearer&type=recovery")).toBe(
      "tok-123",
    );
  });

  it("ignores a hash that is not a recovery session", () => {
    expect(parseRecoveryHash("#access_token=tok-123&type=signup")).toBeNull();
    expect(parseRecoveryHash("#access_token=tok-123&type=magiclink")).toBeNull();
  });

  it("returns null with no hash, an empty hash, or no token", () => {
    expect(parseRecoveryHash("")).toBeNull();
    expect(parseRecoveryHash("#type=recovery")).toBeNull();
    expect(parseRecoveryHash("?token_hash=abc")).toBeNull();
  });
});
