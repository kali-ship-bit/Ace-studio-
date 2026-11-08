import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  AtSign,
  ArrowLeftRight,
  Ban,
  Camera,
  Check,
  ChevronRight,
  Download,
  Droplet,
  HelpCircle,
  History,
  Info,
  KeyRound,
  Loader2,
  Lock,
  LogOut,
  MessageCircle,
  Moon,
  Music,
  Send,
  ShieldCheck,
  Sun,
  Trash2,
  User,
  Users,
  Heart,
  X,
  type LucideIcon,
} from "lucide-react";
import { getSessionId, sessionHeaders } from "@/lib/jobs/session";
import { fetchWithCsrf, logout as signOut } from "@/lib/auth/session";
import type { Job } from "@/lib/jobs/types";
import { useTheme, type Theme } from "@/lib/settings/theme";
import {
  clearCachedJobData,
  formatBytes,
  getAceStudioLocalStorageBytes,
  loadPreferences,
  updatePreference,
  type Audience,
  type OnOff,
  type Preferences,
  type Visibility,
} from "@/lib/settings/preferences";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Ace Studio" },
      {
        name: "description",
        content:
          "Your Ace Studio settings: appearance, profile picture, privacy, storage, and your API keys.",
      },
      { property: "og:title", content: "Settings — Ace Studio" },
      {
        property: "og:description",
        content:
          "Your Ace Studio settings: appearance, profile picture, privacy, storage, and your API keys.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SettingsPage,
});

interface ProviderInfo {
  id: string;
  label: string;
  hint: string;
}

interface HeldKey {
  provider: string;
  masked: string;
  validatedAt: number;
}

const AVATAR_MAX_BYTES = 2 * 1024 * 1024; // 2 MB — matches the server check
const AVATAR_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetchWithCsrf(path, {
    ...init,
    headers: { "content-type": "application/json", ...sessionHeaders(), ...(init?.headers ?? {}) },
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string } & T;
  if (!res.ok) throw new Error(data.message ?? `Request failed (${res.status})`);
  return data as T;
}

// --- Small building blocks -------------------------------------------------

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      <div className="mt-2 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        {children}
      </div>
      {note && <p className="mt-2 px-1 text-xs text-muted-foreground">{note}</p>}
    </section>
  );
}

function Row({
  icon: Icon,
  label,
  value,
  onClick,
  to,
  danger,
}: {
  icon: LucideIcon;
  label: string;
  value?: string;
  onClick?: () => void;
  /**
   * When a row is really navigation (not an action that opens a sheet),
   * it renders as a real link so crawlers — and anyone without
   * JavaScript — can follow it, instead of a button that only a click
   * handler understands.
   */
  to?: string;
  danger?: boolean;
}) {
  const className =
    "flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-secondary/50";
  const content = (
    <>
      <Icon
        className={`h-5 w-5 shrink-0 ${danger ? "text-destructive" : "text-muted-foreground"}`}
      />
      <span
        className={`min-w-0 flex-1 text-[15px] font-medium ${danger ? "text-destructive" : ""}`}
      >
        {label}
      </span>
      {value && <span className="shrink-0 text-sm text-muted-foreground">{value}</span>}
      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/60" />
    </>
  );
  if (to) {
    return (
      <Link to={to} className={className}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={className}>
      {content}
    </button>
  );
}

function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60"
      />
      <div className="relative max-h-[85vh] w-full max-w-[480px] overflow-y-auto rounded-t-3xl border border-border bg-card p-5 pb-8">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  );
}

function InfoParagraphs({ paragraphs }: { paragraphs: string[] }) {
  return (
    <div className="space-y-3 text-sm text-muted-foreground">
      {/* Key by index: these are static info-sheet paragraphs in a fixed
          order, and two of them share their first 24 characters, so a
          text-prefix key collides and drops one paragraph. */}
      {paragraphs.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </div>
  );
}

// --- Choice sheets ---------------------------------------------------------

interface ChoiceOption {
  value: string;
  label: string;
  hint?: string;
}

type PreferenceKey =
  | "comments"
  | "mentions"
  | "directMessages"
  | "downloads"
  | "followingList"
  | "likedVideos"
  | "privateAccount"
  | "dataSaver";

interface ChoiceSheetState {
  key: PreferenceKey;
  title: string;
  options: ChoiceOption[];
  current: string;
}

const AUDIENCE_OPTIONS: ChoiceOption[] = [
  { value: "Everyone", label: "Everyone", hint: "Anyone can do this." },
  { value: "Friends", label: "Friends", hint: "Only people you follow can do this." },
  { value: "Off", label: "Off", hint: "Nobody can do this." },
];

const VISIBILITY_OPTIONS: ChoiceOption[] = [
  { value: "Everyone", label: "Everyone", hint: "Anyone can see this list." },
  { value: "Only you", label: "Only you", hint: "Nobody else can see this list." },
];

const ON_OFF_OPTIONS: ChoiceOption[] = [
  { value: "On", label: "On" },
  { value: "Off", label: "Off" },
];

const PRIVATE_OPTIONS: ChoiceOption[] = [
  { value: "On", label: "On", hint: "Only people you approve can see your videos." },
  { value: "Off", label: "Off", hint: "Anyone can see your videos." },
];

const DATA_SAVER_OPTIONS: ChoiceOption[] = [
  { value: "On", label: "On", hint: "Use less mobile data — videos load at lower quality." },
  { value: "Off", label: "Off", hint: "Videos load at full quality." },
];

const INFO_SHEETS: Record<string, { title: string; paragraphs: string[] }> = {
  account: {
    title: "Account",
    paragraphs: [
      "Your Ace Studio account is the email and password you signed up with. Your profile picture and your videos belong to that account.",
      "Changing your email, phone number, or password is not in Settings yet — that comes with the account work. For now, Settings only changes the picture and the choices on this page.",
    ],
  },
  security: {
    title: "Security & permissions",
    paragraphs: [
      "Passwords are hashed by Supabase (bcrypt). Ace Studio never sees or stores your plain password.",
      "After 3 failed logins from one address, that address is blocked for 15 minutes. A successful login clears the count.",
      "Your login lasts 1 hour, then quietly refreshes for up to 30 days — you stay logged in without typing your password again.",
      "Your API keys (Settings → API keys) are held in the server's memory for this session only. They are never saved to a file or a database.",
    ],
  },
  blocked: {
    title: "Blocked accounts",
    paragraphs: [
      "None — you have not blocked anyone.",
      "Blocking is a later step. There is no list to show yet, and nothing is hidden from you here.",
    ],
  },
  music: {
    title: "Music",
    paragraphs: [
      "Narration in this app is made with Speechify voices — pick one on the Create a voice page, and the voice reads your story lines.",
      "Music is not added in Settings. It is added by the platform you post to, or in the video step when the video is built.",
    ],
  },
  help: {
    title: "Help Center",
    paragraphs: [
      "Ace Studio helps you make story videos: write your lines, create a voice for them, then build the video.",
      "To create a voice: open Create a voice, type or paste your lines (up to 2,000 characters per request), pick a voice, and tap Create voice. You can listen and download the audio.",
      "To use your own Speechify key: open Settings → API keys, paste the key, and it is checked once on the server, then held in the server's memory for this session only.",
      "If a job fails, check the error shown under the job on the Create a voice page, then try again. Running a demo job there proves the jobs system is working.",
    ],
  },
  privacy: {
    title: "Privacy Center",
    paragraphs: [
      "What Ace Studio stores: your account (email and phone) and your profile picture in Supabase, and your jobs and videos.",
      "Your API keys are held in the server's memory for this session only — never in a file or a database — and are never shown in full.",
      "The choices on this Settings page (comments, downloads, and the rest) are saved in this browser only for now. Account sync comes next.",
      "Passwords are hashed by Supabase. Ace Studio does not sell your data.",
    ],
  },
  terms: {
    title: "Terms and Policies",
    paragraphs: [
      "In plain words: use Ace Studio to make your own videos. Do not upload other people's work as your own, and do not use the app to break the law.",
      "Your API keys are yours — keep them private. Never paste a key where anyone else can see it.",
      "Ace Studio is still being built, so features may change. The demo stories and pipeline on this device are test data, not real posts.",
    ],
  },
};

function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [prefs, setPrefs] = useState<Preferences>(() => loadPreferences());
  const [choiceSheet, setChoiceSheet] = useState<ChoiceSheetState | null>(null);
  const [infoSheet, setInfoSheet] = useState<string | null>(null);
  const [spaceSheet, setSpaceSheet] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  // Profile picture
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarState, setAvatarState] = useState<"loading" | "ready" | "unavailable" | "signedOut">(
    "loading",
  );
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  // Jobs (Activity center / Offline videos)
  const [jobs, setJobs] = useState<Job[]>([]);
  const [storageBytes, setStorageBytes] = useState(0);

  // BYOK keys (kept from the previous Settings page)
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [held, setHeld] = useState<HeldKey[]>([]);
  const [appKeyConfigured, setAppKeyConfigured] = useState(false);
  const [provider, setProvider] = useState("speechify");
  const [keyInput, setKeyInput] = useState("");
  const [loadingKeys, setLoadingKeys] = useState(true);
  const [savingKey, setSavingKey] = useState(false);
  const [removingKey, setRemovingKey] = useState<string | null>(null);

  const [loggingOut, setLoggingOut] = useState(false);

  const loadKeys = useCallback(async () => {
    setLoadingKeys(true);
    try {
      const data = await api<{
        keys: HeldKey[];
        appKeyConfigured: boolean;
        providers: ProviderInfo[];
      }>("/api/settings/keys");
      setHeld(data.keys);
      setAppKeyConfigured(data.appKeyConfigured);
      setProviders(data.providers);
      if (data.providers.length > 0) setProvider(data.providers[0]?.id ?? "speechify");
    } catch (error) {
      toast.error("Could not load settings", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    } finally {
      setLoadingKeys(false);
    }
  }, []);

  const loadAvatar = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/avatar");
      if (res.status === 401) {
        // Session expired: its own state, with a sign-in link, not a
        // generic error — the picture section explains it below.
        setAvatarState("signedOut");
        setAvatarUrl(null);
        return;
      }
      if (!res.ok) {
        setAvatarState("unavailable");
        return;
      }
      const data = (await res.json()) as { avatarUrl?: string | null };
      setAvatarUrl(data.avatarUrl ?? null);
      setAvatarState("ready");
    } catch {
      setAvatarState("unavailable");
    }
  }, []);

  const loadJobs = useCallback(async () => {
    try {
      const data = await api<{ jobs: Job[] }>("/api/jobs");
      setJobs(data.jobs);
    } catch {
      // Jobs counts are a nicety; a failure here must not block Settings.
    }
  }, []);

  useEffect(() => {
    void loadKeys();
    void loadAvatar();
    void loadJobs();
    setStorageBytes(getAceStudioLocalStorageBytes());
  }, [loadKeys, loadAvatar, loadJobs]);

  // --- Preferences ---------------------------------------------------------

  const applyChoice = (sheet: ChoiceSheetState, value: string) => {
    let next = prefs;
    if (sheet.key === "comments" || sheet.key === "mentions" || sheet.key === "directMessages") {
      next = updatePreference(prefs, sheet.key, value as Audience);
    } else if (sheet.key === "downloads") {
      next = updatePreference(prefs, sheet.key, value as OnOff);
    } else if (sheet.key === "followingList" || sheet.key === "likedVideos") {
      next = updatePreference(prefs, sheet.key, value as Visibility);
    } else if (sheet.key === "privateAccount" || sheet.key === "dataSaver") {
      next = updatePreference(prefs, sheet.key, value === "On");
    }
    setPrefs(next);
    setChoiceSheet(null);
    toast.success("Saved", { description: `${sheet.title}: ${value}.` });
  };

  const openChoice = (key: PreferenceKey, title: string, options: ChoiceOption[]) => {
    const current =
      key === "privateAccount"
        ? prefs.privateAccount
          ? "On"
          : "Off"
        : key === "dataSaver"
          ? prefs.dataSaver
            ? "On"
            : "Off"
          : String(prefs[key]);
    setChoiceSheet({ key, title, options, current });
  };

  // --- Profile picture -----------------------------------------------------

  const uploadAvatar = async (file: File) => {
    if (!AVATAR_MIME_TYPES.includes(file.type)) {
      toast.error("That file type is not allowed", {
        description: "Pick a JPEG, PNG, or WebP picture.",
      });
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      toast.error("That picture is too big", {
        description: "Keep it under 2 MB.",
      });
      return;
    }
    const form = new FormData();
    form.append("avatar", file);
    setUploadingAvatar(true);
    try {
      const res = await fetchWithCsrf("/api/settings/avatar", {
        method: "POST",
        body: form,
      });
      const data = (await res.json().catch(() => ({}))) as {
        avatarUrl?: string;
        message?: string;
      };
      if (res.status === 401) {
        setAvatarState("signedOut");
        throw new Error("Your session expired. Sign in again to change your picture.");
      }
      if (!res.ok) throw new Error(data.message ?? `Upload failed (${res.status})`);
      setAvatarUrl(data.avatarUrl ?? null);
      setAvatarState("ready");
      toast.success("Profile picture updated");
    } catch (error) {
      toast.error("Could not update your picture", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    } finally {
      setUploadingAvatar(false);
    }
  };

  // --- BYOK keys (unchanged behaviour) --------------------------------------

  const saveKey = async () => {
    if (!keyInput.trim()) {
      toast.error("Paste a key first");
      return;
    }
    setSavingKey(true);
    try {
      const data = await api<{ key: HeldKey }>("/api/settings/keys", {
        method: "POST",
        body: JSON.stringify({ provider, key: keyInput, sessionId: getSessionId() }),
      });
      setKeyInput("");
      toast.success("Key saved for this session", {
        description: `${data.key.masked} — checked and working.`,
      });
      await loadKeys();
    } catch (error) {
      toast.error("That key was rejected", {
        description: error instanceof Error ? error.message : "Check the key and try again.",
      });
    } finally {
      setSavingKey(false);
    }
  };

  const removeKey = async (providerId: string) => {
    setRemovingKey(providerId);
    try {
      await api(`/api/settings/keys?provider=${encodeURIComponent(providerId)}`, {
        method: "DELETE",
      });
      toast.success("Key removed");
      await loadKeys();
    } catch (error) {
      toast.error("Could not remove the key", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    } finally {
      setRemovingKey(null);
    }
  };

  const heldFor = (providerId: string) => held.find((k) => k.provider === providerId);

  // --- Log out / switch account ---------------------------------------------
  // Switch account signs out first, then opens the sign-in page with a
  // hint (?switched=1) so the user can pick a different account. Log out
  // just signs out and opens the plain sign-in page.

  const handleLogout = async (switched: boolean) => {
    setLoggingOut(true);
    try {
      const ok = await signOut();
      if (!ok) throw new Error("Log out failed. Try again.");
      window.location.href = switched ? "/login?switched=1" : "/login";
    } catch (error) {
      toast.error("Could not log out", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    } finally {
      setLoggingOut(false);
    }
  };

  // --- Derived values ---------------------------------------------------------

  const doneJobs = jobs.filter((j) => j.status === "done" && j.output);
  const onOff = (on: boolean) => (on ? "On" : "Off");
  const themeLabel = (t: Theme) => (t === "dark" ? "Dark" : "Light");

  return (
    <main className="mx-auto max-w-[480px] px-4 pb-32 pt-5">
      <h1 className="font-display text-3xl font-bold text-gradient-dashboard">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Appearance, profile, privacy, storage, and your API keys.
      </p>

      {/* Appearance — dark / light mode */}
      <section className="mt-5 rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-bold">
            {theme === "dark" ? (
              <Moon className="h-5 w-5 text-primary" />
            ) : (
              <Sun className="h-5 w-5 text-primary" />
            )}
            Appearance
          </h2>
          <span className="text-sm font-semibold text-muted-foreground">{themeLabel(theme)}</span>
        </div>
        <div className="mt-3 flex items-center gap-3 rounded-2xl bg-secondary/60 px-4 py-3">
          <User className="h-5 w-5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            This is how a row looks in {themeLabel(theme).toLowerCase()} mode
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label="Theme">
          {(["dark", "light"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTheme(t)}
              aria-pressed={theme === t}
              className={`flex h-12 items-center justify-center gap-2 rounded-2xl text-sm font-bold ${
                theme === t
                  ? "bg-gradient-primary text-primary-foreground shadow-glow"
                  : "bg-secondary text-foreground"
              }`}
            >
              {t === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
              {themeLabel(t)}
              {theme === t && <Check className="h-4 w-4" />}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Saved on this device — it stays the way you left it next time you open the app.
        </p>
      </section>

      {/* Profile picture */}
      <section className="mt-5 rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => avatarInputRef.current?.click()}
            disabled={uploadingAvatar || avatarState === "signedOut"}
            aria-label="Change profile picture"
            className="relative shrink-0 disabled:opacity-60"
          >
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt="Your profile picture"
                className="h-16 w-16 rounded-full object-cover"
              />
            ) : (
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-primary text-2xl font-bold text-primary-foreground">
                R
              </span>
            )}
            <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-card bg-secondary">
              <Camera className="h-3.5 w-3.5" />
            </span>
          </button>
          <div className="min-w-0">
            <p className="font-bold">Profile picture</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {uploadingAvatar
                ? "Uploading…"
                : avatarState === "loading"
                  ? "Loading…"
                  : avatarState === "signedOut"
                    ? "Your session expired — sign in again to change your picture."
                    : avatarState === "unavailable"
                      ? "Pictures need the account server, which is not set up yet."
                      : avatarUrl
                        ? "Tap the picture to change it. JPEG, PNG, or WebP, up to 2 MB."
                        : "No picture yet — tap to add one. JPEG, PNG, or WebP, up to 2 MB."}
            </p>
            {avatarState === "signedOut" && (
              <Link
                to="/login"
                search={{ next: "/settings" }}
                className="mt-1 inline-block text-sm font-semibold text-teal"
              >
                Sign in again
              </Link>
            )}
          </div>
        </div>
        <input
          ref={avatarInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          aria-label="Choose a profile picture"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void uploadAvatar(file);
          }}
        />
        <button
          type="button"
          onClick={() => avatarInputRef.current?.click()}
          disabled={uploadingAvatar || avatarState === "signedOut"}
          className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-secondary text-sm font-semibold disabled:opacity-40"
        >
          <Camera className="h-4 w-4" /> {uploadingAvatar ? "Uploading…" : "Change picture"}
        </button>
      </section>

      {/* Account */}
      <Section title="Account" note="Saved on this device for now — account sync comes next.">
        <Row icon={User} label="Account" onClick={() => setInfoSheet("account")} />
        <Row
          icon={ShieldCheck}
          label="Security & permissions"
          onClick={() => setInfoSheet("security")}
        />
        <Row
          icon={Lock}
          label="Private account"
          value={onOff(prefs.privateAccount)}
          onClick={() => openChoice("privateAccount", "Private account", PRIVATE_OPTIONS)}
        />
        <Row
          icon={Ban}
          label="Blocked accounts"
          value="None"
          onClick={() => setInfoSheet("blocked")}
        />
      </Section>

      {/* Interactions */}
      <Section title="Interactions">
        <Row
          icon={MessageCircle}
          label="Comments"
          value={prefs.comments}
          onClick={() => openChoice("comments", "Comments", AUDIENCE_OPTIONS)}
        />
        <Row
          icon={AtSign}
          label="Mentions"
          value={prefs.mentions}
          onClick={() => openChoice("mentions", "Mentions", AUDIENCE_OPTIONS)}
        />
        <Row
          icon={Send}
          label="Direct messages"
          value={prefs.directMessages}
          onClick={() => openChoice("directMessages", "Direct messages", AUDIENCE_OPTIONS)}
        />
        <Row
          icon={Download}
          label="Downloads"
          value={prefs.downloads}
          onClick={() => openChoice("downloads", "Downloads", ON_OFF_OPTIONS)}
        />
        <Row
          icon={Users}
          label="Following list"
          value={prefs.followingList}
          onClick={() => openChoice("followingList", "Following list", VISIBILITY_OPTIONS)}
        />
        <Row
          icon={Heart}
          label="Liked videos"
          value={prefs.likedVideos}
          onClick={() => openChoice("likedVideos", "Liked videos", VISIBILITY_OPTIONS)}
        />
      </Section>

      {/* Content & Display */}
      <Section title="Content & Display">
        <Row icon={Music} label="Music" onClick={() => setInfoSheet("music")} />
        <Row
          icon={History}
          label="Activity center"
          value={
            jobs.length === 0
              ? "No jobs yet"
              : `${jobs.length} recent job${jobs.length === 1 ? "" : "s"}`
          }
          to="/narrate"
        />
      </Section>

      {/* Cache & Cellular */}
      <Section title="Cache & Cellular">
        <Row
          icon={Download}
          label="Offline videos"
          value={doneJobs.length === 0 ? "None yet" : `${doneJobs.length} finished`}
          onClick={() => setInfoSheet("offline")}
        />
        <Row
          icon={Trash2}
          label="Free up space"
          value={formatBytes(storageBytes)}
          onClick={() => {
            setConfirmClear(false);
            setSpaceSheet(true);
          }}
        />
        <Row
          icon={Droplet}
          label="Data Saver"
          value={onOff(prefs.dataSaver)}
          onClick={() => openChoice("dataSaver", "Data Saver", DATA_SAVER_OPTIONS)}
        />
      </Section>

      {/* API keys — BYOK, behaviour unchanged from the previous page */}
      <Section title="API keys">
        <div className="p-4">
          <h3 className="flex items-center gap-2 font-bold">
            <ShieldCheck className="h-5 w-5 text-teal" /> How your keys are kept
          </h3>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            <li>
              • A key you paste here is checked once on the server, then held in the server's memory
              for this session only.
            </li>
            <li>
              • It is never saved to a file or a database, and it is never shown in full — only the
              last 4 characters, like ••••3f9a.
            </li>
            <li>
              • Close the tab, or restart the server, and the key is gone. Paste it again next time.
            </li>
            <li>• The website itself never sees your key — only the server does.</li>
          </ul>
          <p className="mt-3 text-sm">
            App key on the server:{" "}
            <span className="font-semibold text-foreground">
              {appKeyConfigured ? "set (used when you have no session key)" : "not set"}
            </span>
          </p>
        </div>
      </Section>

      {loadingKeys ? (
        <p className="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      ) : (
        <section className="mt-5 rounded-2xl border border-border bg-card p-4">
          <h2 className="flex items-center gap-2 font-bold">
            <KeyRound className="h-5 w-5 text-primary" /> Bring your own key
          </h2>
          <label htmlFor="settings-provider" className="mt-3 block text-sm font-bold">
            Service
          </label>
          <select
            id="settings-provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="mt-2 h-14 w-full rounded-2xl border border-input bg-background px-4 text-sm font-semibold outline-none focus:ring-2 focus:ring-ring"
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          {providers.find((p) => p.id === provider) && (
            <p className="mt-2 text-xs text-muted-foreground">
              {providers.find((p) => p.id === provider)?.hint}
            </p>
          )}
          {heldFor(provider) ? (
            <div className="mt-4 rounded-2xl bg-teal/10 p-4">
              <p className="text-sm font-semibold text-teal">Key saved for this session</p>
              <p className="mt-1 font-mono text-sm">{heldFor(provider)?.masked}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Checked {new Date(heldFor(provider)?.validatedAt ?? 0).toLocaleTimeString()} · held
                in server memory only
              </p>
              <button
                onClick={() => void removeKey(provider)}
                disabled={removingKey === provider}
                className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-destructive/15 text-sm font-semibold text-destructive disabled:opacity-40"
              >
                <Trash2 className="h-4 w-4" />{" "}
                {removingKey === provider ? "Removing…" : "Remove this key"}
              </button>
            </div>
          ) : (
            <>
              <label htmlFor="settings-key" className="mt-4 block text-sm font-bold">
                Your key
              </label>
              <input
                id="settings-key"
                type="password"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder="Paste your key here"
                autoComplete="off"
                className="mt-2 h-14 w-full rounded-2xl border border-input bg-background px-4 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                onClick={() => void saveKey()}
                disabled={savingKey || !keyInput.trim()}
                className="mt-3 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-primary font-bold text-primary-foreground shadow-glow disabled:opacity-40"
              >
                <KeyRound className="h-5 w-5" /> {savingKey ? "Checking…" : "Save and check key"}
              </button>
            </>
          )}
          {held.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-bold">Keys held this session</h3>
              <ul className="mt-2 space-y-2">
                {held.map((k) => (
                  <li
                    key={k.provider}
                    className="flex items-center justify-between rounded-xl bg-secondary/60 px-3 py-2 text-sm"
                  >
                    <span className="font-semibold">{k.provider}</span>
                    <span className="font-mono">{k.masked}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Support & About */}
      <Section title="Support & About">
        <Row icon={HelpCircle} label="Help Center" onClick={() => setInfoSheet("help")} />
        <Row icon={Lock} label="Privacy Center" onClick={() => setInfoSheet("privacy")} />
        <Row icon={Info} label="Terms and Policies" onClick={() => setInfoSheet("terms")} />
      </Section>

      {/* Login */}
      <Section title="Login">
        <Row icon={ArrowLeftRight} label="Switch account" onClick={() => void handleLogout(true)} />
        <Row icon={LogOut} label="Log out" danger onClick={() => void handleLogout(false)} />
      </Section>
      {loggingOut && (
        <p className="mt-3 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Logging out…
        </p>
      )}

      <Link
        to="/narrate"
        className="mt-5 flex h-14 w-full items-center justify-center rounded-2xl bg-gradient-primary font-bold text-primary-foreground shadow-glow"
      >
        Create a voice
      </Link>
      <p className="mt-3 text-center text-xs text-muted-foreground">
        Paid video generators (Step 3 and later) will ask for their keys here too — one key per
        service, same rules.
      </p>

      {/* Choice sheet */}
      {choiceSheet && (
        <Sheet title={choiceSheet.title} onClose={() => setChoiceSheet(null)}>
          <ul className="space-y-2">
            {choiceSheet.options.map((option) => {
              const selected = choiceSheet.current === option.value;
              return (
                <li key={option.value}>
                  <button
                    type="button"
                    onClick={() => applyChoice(choiceSheet, option.value)}
                    aria-pressed={selected}
                    className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left ${
                      selected ? "border-primary bg-primary/10" : "border-border bg-secondary/40"
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold">{option.label}</span>
                      {option.hint && (
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {option.hint}
                        </span>
                      )}
                    </span>
                    {selected && <Check className="h-5 w-5 shrink-0 text-primary" />}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            Saved on this device for now — account sync comes next.
          </p>
        </Sheet>
      )}

      {/* Info sheet */}
      {infoSheet && infoSheet !== "offline" && INFO_SHEETS[infoSheet] && (
        <Sheet title={INFO_SHEETS[infoSheet]?.title ?? ""} onClose={() => setInfoSheet(null)}>
          <InfoParagraphs paragraphs={INFO_SHEETS[infoSheet]?.paragraphs ?? []} />
          {infoSheet === "music" && (
            <Link
              to="/narrate"
              className="mt-4 flex h-12 w-full items-center justify-center rounded-2xl bg-gradient-primary text-sm font-bold text-primary-foreground shadow-glow"
            >
              Create a voice
            </Link>
          )}
        </Sheet>
      )}

      {/* Offline videos sheet */}
      {infoSheet === "offline" && (
        <Sheet title="Offline videos" onClose={() => setInfoSheet(null)}>
          <InfoParagraphs
            paragraphs={[
              doneJobs.length === 0
                ? "No finished jobs yet — nothing to watch offline. When a voice or video job finishes, it will be counted here."
                : `${doneJobs.length} finished job${doneJobs.length === 1 ? "" : "s"} with an output file.`,
              "Downloading finished videos for offline watching is a later step. For now, download them from the Create a voice page.",
            ]}
          />
          <Link
            to="/narrate"
            className="mt-4 flex h-12 w-full items-center justify-center rounded-2xl bg-gradient-primary text-sm font-bold text-primary-foreground shadow-glow"
          >
            Open Create a voice
          </Link>
        </Sheet>
      )}

      {/* Free up space sheet */}
      {spaceSheet && (
        <Sheet
          title="Free up space"
          onClose={() => {
            setSpaceSheet(false);
            setConfirmClear(false);
          }}
        >
          <p className="text-sm text-muted-foreground">
            Ace Studio is using about{" "}
            <span className="font-semibold text-foreground">{formatBytes(storageBytes)}</span> of
            this device's storage for saved demo stories, pipeline drafts, and editor drafts.
          </p>
          {!confirmClear ? (
            <>
              <p className="mt-3 text-sm text-muted-foreground">
                Clearing removes only those cached drafts from this device. It never touches your
                account, the server, or your settings.
              </p>
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-destructive/15 text-sm font-semibold text-destructive"
              >
                <Trash2 className="h-4 w-4" /> Clear cached data
              </button>
            </>
          ) : (
            <>
              <p className="mt-3 text-sm font-semibold">
                Are you sure? This removes the saved demo stories and drafts on this device. Your
                account and your jobs on the server are untouched.
              </p>
              <button
                type="button"
                disabled={clearing}
                onClick={() => {
                  setClearing(true);
                  const { removed, freedBytes } = clearCachedJobData();
                  setStorageBytes(getAceStudioLocalStorageBytes());
                  setClearing(false);
                  setSpaceSheet(false);
                  setConfirmClear(false);
                  toast.success(
                    removed.length === 0
                      ? "Nothing to clear"
                      : `Cleared ${formatBytes(freedBytes)} of cached data`,
                    {
                      description:
                        removed.length === 0
                          ? "There was no cached demo data on this device."
                          : "Only cached demo data was removed — your account and settings are untouched.",
                    },
                  );
                }}
                className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-destructive text-sm font-bold text-destructive-foreground disabled:opacity-40"
              >
                <Trash2 className="h-4 w-4" /> {clearing ? "Clearing…" : "Yes, clear it"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="mt-2 flex h-12 w-full items-center justify-center rounded-2xl bg-secondary text-sm font-semibold"
              >
                Keep it
              </button>
            </>
          )}
        </Sheet>
      )}
    </main>
  );
}
