/**
 * On-device preferences for Ace Studio — Phase D settings.
 *
 * Plain words: these are the privacy/interaction choices from the
 * Settings page (who can comment, who can mention you, downloads on or
 * off, and so on). They are saved in this browser only (localStorage)
 * for now — the page says so, and account sync comes in a later step.
 * Nothing here is sent to a server.
 *
 * Client-safe: no secrets, no network. Every load validates each field
 * and falls back to the default for anything missing or invalid, so a
 * hand-edited or older saved value can never break the page.
 */

export type Audience = "Everyone" | "Friends" | "Off";
export type Visibility = "Everyone" | "Only you";
export type OnOff = "On" | "Off";

export interface Preferences {
  comments: Audience;
  mentions: Audience;
  directMessages: Audience;
  downloads: OnOff;
  followingList: Visibility;
  likedVideos: Visibility;
  privateAccount: boolean;
  dataSaver: boolean;
}

export const PREFERENCES_STORAGE_KEY = "ace-studio-preferences";

export const DEFAULT_PREFERENCES: Preferences = {
  comments: "Everyone",
  mentions: "Everyone",
  directMessages: "Everyone",
  downloads: "On",
  followingList: "Everyone",
  likedVideos: "Only you",
  privateAccount: false,
  dataSaver: false,
};

const AUDIENCES: readonly string[] = ["Everyone", "Friends", "Off"];
const VISIBILITIES: readonly string[] = ["Everyone", "Only you"];
const ON_OFFS: readonly string[] = ["On", "Off"];

function pick<T>(value: unknown, allowed: readonly string[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value) ? (value as T) : fallback;
}

/** Load the saved preferences, with defaults for anything missing/invalid. */
export function loadPreferences(): Preferences {
  if (typeof window === "undefined") return { ...DEFAULT_PREFERENCES };
  try {
    const raw = window.localStorage.getItem(PREFERENCES_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFERENCES };
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_PREFERENCES };
    return {
      comments: pick(parsed.comments, AUDIENCES, DEFAULT_PREFERENCES.comments),
      mentions: pick(parsed.mentions, AUDIENCES, DEFAULT_PREFERENCES.mentions),
      directMessages: pick(parsed.directMessages, AUDIENCES, DEFAULT_PREFERENCES.directMessages),
      downloads: pick(parsed.downloads, ON_OFFS, DEFAULT_PREFERENCES.downloads),
      followingList: pick(parsed.followingList, VISIBILITIES, DEFAULT_PREFERENCES.followingList),
      likedVideos: pick(parsed.likedVideos, VISIBILITIES, DEFAULT_PREFERENCES.likedVideos),
      privateAccount:
        typeof parsed.privateAccount === "boolean"
          ? parsed.privateAccount
          : DEFAULT_PREFERENCES.privateAccount,
      dataSaver:
        typeof parsed.dataSaver === "boolean" ? parsed.dataSaver : DEFAULT_PREFERENCES.dataSaver,
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

/** Save a full preferences object to this device. */
export function savePreferences(prefs: Preferences): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Storage full or blocked: the page keeps the new values in memory
    // for this visit, they just will not survive a reload.
  }
}

/** Change one preference, save it, and return the new full object. */
export function updatePreference<K extends keyof Preferences>(
  prefs: Preferences,
  key: K,
  value: Preferences[K],
): Preferences {
  const next = { ...prefs, [key]: value };
  savePreferences(next);
  return next;
}

// ---------------------------------------------------------------------------
// Local storage used by the app — for the "Free up space" row.
// ---------------------------------------------------------------------------

/** Every localStorage key the app owns starts with this prefix. */
export const APP_LOCALSTORAGE_PREFIX = "ace-studio";

/**
 * Cached job/demo data only — the keys "Free up space" is allowed to
 * remove. Deliberately NOT the theme, NOT these preferences, and NOT
 * anything else: clearing the cache must never log anyone out or reset
 * their settings.
 */
export const APP_CACHE_KEYS: readonly string[] = [
  "ace-studio.pipeline.v3", // daily-pipeline demo state
  "ace-studio.stories.v1", // story drafts (demo)
  "ace-studio.stories.deleted.v1", // deleted-story ids (demo)
  "ace-studio.editor.v1", // manual-editor drafts
];

/** Rough size of the app's localStorage use, in bytes (UTF-16 estimate). */
export function getAceStudioLocalStorageBytes(): number {
  if (typeof window === "undefined") return 0;
  let bytes = 0;
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith(APP_LOCALSTORAGE_PREFIX)) continue;
      const value = window.localStorage.getItem(key) ?? "";
      bytes += (key.length + value.length) * 2;
    }
  } catch {
    return 0;
  }
  return bytes;
}

/**
 * Remove ONLY the cached job/demo keys. Returns what was removed and how
 * many bytes that freed. Never touches the account, the server, the
 * theme, or these preferences.
 */
export function clearCachedJobData(): { removed: string[]; freedBytes: number } {
  if (typeof window === "undefined") return { removed: [], freedBytes: 0 };
  const removed: string[] = [];
  let freedBytes = 0;
  try {
    for (const key of APP_CACHE_KEYS) {
      const value = window.localStorage.getItem(key);
      if (value === null) continue;
      freedBytes += (key.length + value.length) * 2;
      window.localStorage.removeItem(key);
      removed.push(key);
    }
  } catch {
    // A blocked storage still leaves the in-memory page working.
  }
  return { removed, freedBytes };
}

/** "1.2 KB" / "345 B" style display for a byte count. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
