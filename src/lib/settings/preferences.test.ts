import { beforeEach, describe, expect, it } from "vitest";
import {
  clearCachedJobData,
  DEFAULT_PREFERENCES,
  formatBytes,
  getAceStudioLocalStorageBytes,
  loadPreferences,
  PREFERENCES_STORAGE_KEY,
  savePreferences,
  updatePreference,
} from "./preferences";

describe("preferences", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("loads the defaults when nothing is saved", () => {
    expect(loadPreferences()).toEqual({
      comments: "Everyone",
      mentions: "Everyone",
      directMessages: "Everyone",
      downloads: "On",
      followingList: "Everyone",
      likedVideos: "Only you",
      privateAccount: false,
      dataSaver: false,
    });
    expect(DEFAULT_PREFERENCES.likedVideos).toBe("Only you");
  });

  it("saves and loads a full set of choices", () => {
    const prefs = {
      ...DEFAULT_PREFERENCES,
      comments: "Friends" as const,
      downloads: "Off" as const,
      followingList: "Only you" as const,
      privateAccount: true,
      dataSaver: true,
    };
    savePreferences(prefs);
    expect(loadPreferences()).toEqual(prefs);
  });

  it("falls back per-field for invalid or missing saved values", () => {
    window.localStorage.setItem(
      PREFERENCES_STORAGE_KEY,
      JSON.stringify({ comments: "Nobody", downloads: "Maybe", privateAccount: "yes" }),
    );
    const loaded = loadPreferences();
    expect(loaded.comments).toBe("Everyone");
    expect(loaded.downloads).toBe("On");
    expect(loaded.privateAccount).toBe(false);
    expect(loaded.mentions).toBe("Everyone");
  });

  it("falls back to defaults for unreadable saved data", () => {
    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, "not json {");
    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  it("updatePreference changes one field and persists it", () => {
    const next = updatePreference(DEFAULT_PREFERENCES, "mentions", "Off");
    expect(next.mentions).toBe("Off");
    expect(next.comments).toBe("Everyone");
    expect(loadPreferences().mentions).toBe("Off");
  });
});

describe("local storage use and cache clearing", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("counts only the app's own keys", () => {
    window.localStorage.setItem("ace-studio.stories.v1", "x".repeat(100));
    window.localStorage.setItem("some-other-app", "y".repeat(1000));
    const bytes = getAceStudioLocalStorageBytes();
    expect(bytes).toBe(("ace-studio.stories.v1".length + 100) * 2);
    expect(bytes).toBeLessThan(1000);
  });

  it("clearCachedJobData removes only cached job/demo keys", () => {
    window.localStorage.setItem("ace-studio.stories.v1", "drafts");
    window.localStorage.setItem("ace-studio.pipeline.v3", "pipeline");
    window.localStorage.setItem("ace-studio-theme", "light");
    window.localStorage.setItem("ace-studio-preferences", "{}");
    window.localStorage.setItem("unrelated", "keep me");

    const { removed, freedBytes } = clearCachedJobData();
    expect(removed).toContain("ace-studio.stories.v1");
    expect(removed).toContain("ace-studio.pipeline.v3");
    expect(freedBytes).toBeGreaterThan(0);
    expect(window.localStorage.getItem("ace-studio.stories.v1")).toBeNull();
    expect(window.localStorage.getItem("ace-studio.pipeline.v3")).toBeNull();
    // Settings and other apps are untouched.
    expect(window.localStorage.getItem("ace-studio-theme")).toBe("light");
    expect(window.localStorage.getItem("ace-studio-preferences")).toBe("{}");
    expect(window.localStorage.getItem("unrelated")).toBe("keep me");
  });

  it("formatBytes shows B, KB and MB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});
