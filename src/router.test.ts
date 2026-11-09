import { describe, expect, it } from "vitest";
import { getRouter } from "./router";

/**
 * Route table: every page the app promises must actually be registered.
 * A renamed or deleted route file silently drops its page (TanStack
 * Start is file-based), and a typo'd Link would 404 — this test pins
 * the 14 pages so a missing one fails the suite instead of the user.
 */
const EXPECTED_PATHS = [
  "/",
  "/create",
  "/dashboard",
  "/editor",
  "/forgot-password",
  "/library",
  "/login",
  "/narrate",
  "/profile",
  "/reset-password",
  "/review",
  "/settings",
  "/signup",
  "/stories",
];

describe("route table", () => {
  it("registers every page route", () => {
    const router = getRouter();
    const paths = Object.keys(router.routesByPath);
    for (const expected of EXPECTED_PATHS) {
      expect(paths).toContain(expected);
    }
  });
});
