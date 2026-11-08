import { describe, expect, it } from "vitest";
import { errorMessageDetail, resolveEnvConfig, sanitiseProviderMessage } from "./provider";

describe("resolveEnvConfig", () => {
  it("returns trimmed values and names every missing var", () => {
    process.env["TEST_A"] = "  a-value ";
    delete process.env["TEST_B"];
    delete process.env["TEST_C"];
    expect(resolveEnvConfig(["TEST_A"], () => new Error("missing"))).toEqual({
      TEST_A: "a-value",
    });
    expect(() =>
      resolveEnvConfig(["TEST_A", "TEST_B", "TEST_C"], (missing) => new Error(missing.join(","))),
    ).toThrow("TEST_B,TEST_C");
    delete process.env["TEST_A"];
  });
});

describe("sanitiseProviderMessage", () => {
  it("pulls the detail out of { error: { message } }", () => {
    expect(
      sanitiseProviderMessage("Instagram", 400, JSON.stringify({ error: { message: "Bad id" } })),
    ).toBe("Instagram: Bad id");
  });

  it("falls back to the HTTP status when the body has no detail", () => {
    expect(sanitiseProviderMessage("TikTok", 500, JSON.stringify({ error: {} }))).toBe(
      "TikTok request failed (HTTP 500)",
    );
  });

  it("falls back to the raw body text when the body is not JSON", () => {
    expect(sanitiseProviderMessage("Facebook", 502, "  gateway blew up  ")).toBe(
      "Facebook: gateway blew up",
    );
  });

  it("truncates a long detail to 200 characters", () => {
    const long = "x".repeat(500);
    expect(
      sanitiseProviderMessage("YouTube", 400, JSON.stringify({ error: { message: long } })).length,
    ).toBe("YouTube: ".length + 200);
  });

  it("errorMessageDetail accepts a custom extractor shape", () => {
    expect(errorMessageDetail({ error: { message: "hi" } })).toBe("hi");
    expect(errorMessageDetail({ error: "plain" })).toBe("");
    expect(errorMessageDetail(null)).toBe("");
  });
});
