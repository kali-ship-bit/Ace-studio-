/**
 * Theme (dark / light) for Ace Studio — Phase D settings.
 *
 * Plain words: the app is dark by default. This remembers the choice in
 * the browser (localStorage) and switches it by adding or removing the
 * `dark` class on <html>, which is what Tailwind's dark variant reads
 * (see src/styles.css: `@custom-variant dark (&:is(.dark *))`).
 *
 * Client-safe: no secrets, no network. On the server there is no
 * document/localStorage, so every helper falls back to "dark" and does
 * nothing instead of crashing.
 */

import { useCallback, useEffect, useState } from "react";

export type Theme = "dark" | "light";

export const THEME_STORAGE_KEY = "ace-studio-theme";
export const DEFAULT_THEME: Theme = "dark";

export function isTheme(value: unknown): value is Theme {
  return value === "dark" || value === "light";
}

/** The saved theme, or "dark" when nothing (or nothing valid) is saved. */
export function getTheme(): Theme {
  if (typeof window === "undefined") return DEFAULT_THEME;
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(raw) ? raw : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/**
 * Apply a theme to the page right now: `dark` class on <html> when dark,
 * removed when light. Safe to call on the server (no-op there).
 */
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
}

/** Save a theme and apply it immediately. */
export function setTheme(theme: Theme): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Storage full or blocked: the page still switches, it just
      // will not remember the choice next time.
    }
  }
  applyTheme(theme);
}

/**
 * React hook for the Settings page: the current theme, kept in sync with
 * what is saved, plus a setter that persists and applies it.
 */
export function useTheme(): { theme: Theme; setTheme: (theme: Theme) => void } {
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME);

  useEffect(() => {
    const stored = getTheme();
    setThemeState(stored);
    applyTheme(stored);
  }, []);

  const set = useCallback((next: Theme) => {
    setThemeState(next);
    setTheme(next);
  }, []);

  return { theme, setTheme: set };
}
