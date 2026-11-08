import { describe, expect, it } from "vitest";
import { COUNTRIES } from "./countries";

describe("countries", () => {
  it("starts with Nigeria and has no duplicate ISO codes", () => {
    expect(COUNTRIES[0]?.code).toBe("NG");
    const codes = COUNTRIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("covers the West African neighbours", () => {
    for (const code of [
      "BJ",
      "TG",
      "NE",
      "TD",
      "ML",
      "BF",
      "GN",
      "SL",
      "LR",
      "GM",
      "GW",
      "CV",
      "MR",
    ]) {
      expect(COUNTRIES.some((c) => c.code === code)).toBe(true);
    }
  });

  it("gives the US and Canada distinct values to pick by", () => {
    // The signup country picker must use the ISO code as its value:
    // +1 is shared, so a dial-code value could never select Canada.
    const us = COUNTRIES.find((c) => c.code === "US");
    const ca = COUNTRIES.find((c) => c.code === "CA");
    expect(us?.dialCode).toBe("+1");
    expect(ca?.dialCode).toBe("+1");
    expect(us?.code).not.toBe(ca?.code);
  });
});
