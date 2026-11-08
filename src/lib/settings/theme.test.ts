import { beforeEach, describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  applyTheme,
  DEFAULT_THEME,
  getTheme,
  setTheme,
  THEME_STORAGE_KEY,
  useTheme,
} from "./theme";

describe("theme helpers", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.add("dark");
  });

  it("defaults to dark when nothing is saved", () => {
    expect(getTheme()).toBe("dark");
    expect(DEFAULT_THEME).toBe("dark");
  });

  it("falls back to dark for an invalid saved value", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "sepia");
    expect(getTheme()).toBe("dark");
  });

  it("persists the chosen theme and applies it to <html>", () => {
    setTheme("light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    setTheme("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("applyTheme only toggles the dark class", () => {
    applyTheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    applyTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("useTheme reads the saved theme and switches it", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    act(() => {
      result.current.setTheme("dark");
    });
    expect(result.current.theme).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
