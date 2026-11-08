/**
 * Tests for the Lagos date formatting.
 * 2026-11-07T10:00:00Z is 11:00 in Lagos (UTC+1, no daylight saving),
 * so the hour proves the Africa/Lagos timezone is applied rather than
 * whatever timezone the viewer happens to be in.
 */

import { describe, expect, it } from "vitest";
import { formatDateTime } from "./format";

describe("formatDateTime", () => {
  it("renders a UTC timestamp in Africa/Lagos time", () => {
    expect(formatDateTime("2026-11-07T10:00:00Z")).toContain("11:00");
  });

  it("keeps the Lagos date when UTC and Lagos fall on different days", () => {
    // 00:30 UTC on the 8th is still 01:30 on the 8th in Lagos,
    // but 23:30 UTC on the 7th is already the 8th in Lagos.
    expect(formatDateTime("2026-11-07T23:30:00Z")).toContain("08/11/2026");
  });

  it("returns the input unchanged when it is not a date", () => {
    expect(formatDateTime("not-a-date")).toBe("not-a-date");
  });
});
