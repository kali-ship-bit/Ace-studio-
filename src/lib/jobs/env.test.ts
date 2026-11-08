import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { describeKeySource, isMockSpeechify, resetDevVarsCache } from "./env";

describe("isMockSpeechify", () => {
  const savedNodeEnv = process.env["NODE_ENV"];
  const savedMock = process.env["SPEECHIFY_MOCK"];

  beforeEach(() => {
    resetDevVarsCache();
  });

  afterEach(() => {
    if (savedNodeEnv === undefined) delete process.env["NODE_ENV"];
    else process.env["NODE_ENV"] = savedNodeEnv;
    if (savedMock === undefined) delete process.env["SPEECHIFY_MOCK"];
    else process.env["SPEECHIFY_MOCK"] = savedMock;
    resetDevVarsCache();
  });

  it("is on in development when SPEECHIFY_MOCK=1", () => {
    process.env["NODE_ENV"] = "development";
    process.env["SPEECHIFY_MOCK"] = "1";
    expect(isMockSpeechify()).toBe(true);
  });

  it("is off in production even when SPEECHIFY_MOCK=1", () => {
    process.env["NODE_ENV"] = "production";
    process.env["SPEECHIFY_MOCK"] = "1";
    expect(isMockSpeechify()).toBe(false);
  });

  it("is off when the flag is unset", () => {
    delete process.env["SPEECHIFY_MOCK"];
    expect(isMockSpeechify()).toBe(false);
  });
});

describe("describeKeySource", () => {
  const savedMock = process.env["SPEECHIFY_MOCK"];

  beforeEach(() => {
    resetDevVarsCache();
  });

  afterEach(() => {
    if (savedMock === undefined) delete process.env["SPEECHIFY_MOCK"];
    else process.env["SPEECHIFY_MOCK"] = savedMock;
    resetDevVarsCache();
  });

  it("prefers a session key, then the app key, then mock", () => {
    process.env["SPEECHIFY_MOCK"] = "1";
    expect(describeKeySource(true, true)).toBe("session");
    // A real app key must win over mock: mock is a fallback for having
    // no key at all, never a silent replacement for a real generation.
    expect(describeKeySource(false, true)).toBe("app");
    expect(describeKeySource(false, false)).toBe("mock");
  });

  it("returns none when there is no key and mock is off", () => {
    delete process.env["SPEECHIFY_MOCK"];
    expect(describeKeySource(false, false)).toBe("none");
  });
});
