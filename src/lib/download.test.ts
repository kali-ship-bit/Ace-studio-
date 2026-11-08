import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { saveToDevice } from "./download";

describe("saveToDevice reports whether the cover made it into the zip", () => {
  beforeEach(() => {
    URL.createObjectURL = () => "blob:fake";
    URL.revokeObjectURL = () => {};
    // The download triggers an anchor click; jsdom would try to navigate.
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("still saves details when the cover download fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    await expect(
      saveToDevice("Test video", "https://example.com/cover.jpg", ["Episode 1"]),
    ).resolves.toEqual({ coverIncluded: false });
  });

  it("includes the cover when its download succeeds", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({ blob: async () => new Blob(["fake-image"], { type: "image/jpeg" }) }),
    );
    await expect(
      saveToDevice("Test video", "https://example.com/cover.jpg", ["Episode 1"]),
    ).resolves.toEqual({ coverIncluded: true });
  });

  it("reports no cover when none was requested", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(saveToDevice("Test video", null, ["Episode 1"])).resolves.toEqual({
      coverIncluded: false,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
