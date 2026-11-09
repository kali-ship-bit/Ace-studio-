import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Film, LogIn, MapPin, Pencil, Settings, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { FEED, filterFeed, formatCount, formatDuration } from "@/lib/feed-data";
import { fetchWithCsrf } from "@/lib/auth/session";
import { AVATAR_ALLOWED_MIMES, AVATAR_MAX_BYTES } from "@/lib/security/validation";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "Profile — Ace Studio" },
      {
        name: "description",
        content: "Your Ace Studio profile — your picture, your videos and your account.",
      },
      // A profile page is one person's own account: never indexed,
      // never in the public sitemap (see PRIVATE_PATHS in lib/seo).
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Profile — Ace Studio" },
      {
        property: "og:description",
        content: "Your Ace Studio profile — your picture, your videos and your account.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProfilePage,
});

/**
 * Who is signed in, from the session cookie — one call,
 * GET /api/settings/profile, gives the login state, the email, the
 * picture and the profile fields (display name, username, bio,
 * country). 401 means signed out. The phone number is never shown
 * on this page.
 */
type ProfilePageState =
  | { status: "loading" }
  | { status: "signedOut" }
  | {
      status: "signedIn";
      email: string;
      displayName: string | null;
      username: string | null;
      bio: string | null;
      country: string | null;
      avatarUrl: string | null;
    };

type ProfileJson = {
  email?: string;
  displayName?: string | null;
  username?: string | null;
  bio?: string | null;
  country?: string | null;
  avatarUrl?: string | null;
};

const BIO_MAX = 160;

function displayNameOf(email: string, displayName: string | null): string {
  if (displayName) return displayName;
  const prefix = email.split("@")[0] ?? "";
  if (!prefix) return "Ace Studio";
  return prefix.charAt(0).toUpperCase() + prefix.slice(1);
}

function ProfilePage() {
  const [profile, setProfile] = useState<ProfilePageState>({ status: "loading" });
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftUsername, setDraftUsername] = useState("");
  const [draftBio, setDraftBio] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/settings/profile", {
          credentials: "same-origin",
        });
        if (!res.ok) {
          if (!cancelled) setProfile({ status: "signedOut" });
          return;
        }
        const data = (await res.json()) as ProfileJson;
        if (!cancelled) {
          setProfile({
            status: "signedIn",
            email: typeof data.email === "string" ? data.email : "",
            displayName: data.displayName ?? null,
            username: data.username ?? null,
            bio: data.bio ?? null,
            country: data.country ?? null,
            avatarUrl: data.avatarUrl ?? null,
          });
        }
      } catch {
        if (!cancelled) setProfile({ status: "signedOut" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const startEditing = () => {
    if (profile.status !== "signedIn") return;
    setDraftName(profile.displayName ?? "");
    setDraftUsername(profile.username ?? "");
    setDraftBio(profile.bio ?? "");
    setFormError(null);
    setEditing(true);
  };

  const saveProfile = async () => {
    if (profile.status !== "signedIn") return;
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetchWithCsrf("/api/settings/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: draftName,
          username: draftUsername,
          bio: draftBio,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as ProfileJson & {
        error?: string;
        message?: string;
      };
      if (res.status === 401) {
        setProfile({ status: "signedOut" });
        throw new Error("Your session expired. Sign in again to edit your profile.");
      }
      if (!res.ok) throw new Error(data.message ?? `Could not save (${res.status})`);
      setProfile({
        status: "signedIn",
        email: typeof data.email === "string" ? data.email : profile.email,
        displayName: data.displayName ?? null,
        username: data.username ?? null,
        bio: data.bio ?? null,
        country: data.country ?? null,
        avatarUrl: data.avatarUrl ?? null,
      });
      setEditing(false);
      toast.success("Profile updated");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Try again.";
      // A taken username gets its own plain line under the field; any
      // other failure is a toast, like the rest of the app.
      if (message.startsWith("That username is taken")) setFormError(message);
      else toast.error("Could not save your profile", { description: message });
    } finally {
      setSaving(false);
    }
  };

  // Picture upload — the same upload Settings uses (POST a form to
  // /api/settings/avatar, JPEG/PNG/WebP up to 2 MB). The picture on
  // this page updates straight away, with no reload.
  const uploadAvatar = async (file: File) => {
    if (!(AVATAR_ALLOWED_MIMES as readonly string[]).includes(file.type)) {
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
        setProfile({ status: "signedOut" });
        throw new Error("Your session expired. Sign in again to change your picture.");
      }
      if (!res.ok) throw new Error(data.message ?? `Upload failed (${res.status})`);
      if (profile.status === "signedIn") {
        setProfile({ ...profile, avatarUrl: data.avatarUrl ?? null });
      }
      toast.success("Profile picture updated");
    } catch (error) {
      toast.error("Could not update your picture", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    } finally {
      setUploadingAvatar(false);
    }
  };

  // "My Videos" is the same list the Home feed's "My Videos" tab
  // shows: the demo feed's owner videos (creator.isOwner). No new
  // data source — the counts below are sums of this same list.
  const myVideos = useMemo(() => filterFeed(FEED, "mine", null), []);
  const totalLikes = useMemo(() => myVideos.reduce((n, v) => n + v.likes, 0), [myVideos]);
  const totalComments = useMemo(() => myVideos.reduce((n, v) => n + v.comments, 0), [myVideos]);

  const signedIn = profile.status === "signedIn";
  const name = signedIn ? displayNameOf(profile.email, profile.displayName) : "";

  return (
    <main className="mx-auto max-w-[480px] px-4 pb-32 pt-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-bold">Profile</h1>
        {signedIn && (
          <Link
            to="/settings"
            aria-label="Settings"
            className="flex h-11 w-11 items-center justify-center rounded-full bg-secondary text-foreground"
          >
            <Settings className="h-5 w-5" />
          </Link>
        )}
      </div>

      {profile.status === "loading" && (
        <p className="mt-6 text-sm text-muted-foreground">Loading your profile…</p>
      )}

      {profile.status === "signedOut" && (
        <section className="mt-6 rounded-2xl border border-border bg-card p-5 text-center">
          <p className="font-bold">Sign in to see your profile</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Your picture, your videos and your account live here once you sign in.
          </p>
          <Link
            to="/login"
            className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-primary text-base font-bold text-primary-foreground shadow-glow"
          >
            <LogIn className="h-5 w-5" /> Sign in
          </Link>
          <Link
            to="/signup"
            className="mt-3 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-secondary text-base font-bold text-teal"
          >
            <UserPlus className="h-5 w-5" /> Create an account
          </Link>
        </section>
      )}

      {signedIn && (
        <>
          <section className="mt-6 flex items-center gap-4">
            <button
              type="button"
              onClick={() => avatarInputRef.current?.click()}
              disabled={uploadingAvatar}
              aria-label="Change profile picture"
              className="relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-primary text-3xl font-bold text-primary-foreground disabled:opacity-60"
            >
              {profile.avatarUrl ? (
                <img src={profile.avatarUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <span aria-hidden="true">{name.charAt(0).toUpperCase()}</span>
              )}
              <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-black/50 py-1 text-[10px] font-bold text-white">
                <Camera className="h-3 w-3" />
                {uploadingAvatar ? "Uploading…" : "Change"}
              </span>
            </button>
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
            <div className="min-w-0">
              <h2 className="font-display truncate text-2xl font-bold">{name}</h2>
              {profile.username ? (
                <p className="truncate text-sm font-semibold text-primary">@{profile.username}</p>
              ) : null}
              <p className="truncate text-sm text-muted-foreground">{profile.email}</p>
              {profile.country ? (
                <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5" /> {profile.country}
                </p>
              ) : null}
              <button
                type="button"
                onClick={startEditing}
                className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-full bg-secondary px-4 text-xs font-semibold"
              >
                <Pencil className="h-4 w-4" /> Edit profile
              </button>
            </div>
          </section>

          {profile.bio ? <p className="mt-4 text-sm leading-relaxed">{profile.bio}</p> : null}

          {editing && (
            <section className="mt-6 rounded-2xl border border-border bg-card p-4">
              <h2 className="text-sm font-bold">Edit profile</h2>
              <label htmlFor="profile-display-name" className="mt-4 block text-sm font-bold">
                Display name
              </label>
              <input
                id="profile-display-name"
                type="text"
                value={draftName}
                maxLength={50}
                placeholder={displayNameOf(profile.email, null)}
                onChange={(e) => setDraftName(e.target.value)}
                className="mt-1 h-12 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <label htmlFor="profile-username" className="mt-4 block text-sm font-bold">
                Username
              </label>
              <div className="mt-1 flex h-12 items-center rounded-xl border border-input bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
                <span className="text-sm font-semibold text-muted-foreground">@</span>
                <input
                  id="profile-username"
                  type="text"
                  value={draftUsername}
                  maxLength={30}
                  autoCapitalize="off"
                  autoCorrect="off"
                  placeholder="your_handle"
                  onChange={(e) =>
                    setDraftUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))
                  }
                  className="h-full w-full bg-transparent px-1 text-sm outline-none"
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                3–30 lowercase letters, numbers or _. Leave it empty for no @username.
              </p>
              {formError ? (
                <p className="mt-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
                  {formError}
                </p>
              ) : null}
              <label htmlFor="profile-bio" className="mt-4 block text-sm font-bold">
                Bio
              </label>
              <textarea
                id="profile-bio"
                value={draftBio}
                maxLength={BIO_MAX}
                rows={3}
                placeholder="A short line about you."
                onChange={(e) => setDraftBio(e.target.value)}
                className="mt-1 w-full resize-none rounded-xl border border-input bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <p className="mt-1 text-right text-xs text-muted-foreground">
                {draftBio.length}/{BIO_MAX}
              </p>
              <div className="mt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => void saveProfile()}
                  disabled={saving}
                  className="flex h-12 flex-1 items-center justify-center rounded-2xl bg-gradient-primary text-base font-bold text-primary-foreground shadow-glow disabled:opacity-40"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setFormError(null);
                  }}
                  disabled={saving}
                  className="flex h-12 items-center justify-center gap-1 rounded-2xl bg-secondary px-5 text-base font-bold disabled:opacity-40"
                >
                  <X className="h-4 w-4" /> Cancel
                </button>
              </div>
            </section>
          )}

          <section className="mt-6 grid grid-cols-3 gap-3">
            <div className="rounded-2xl border border-border bg-card p-4 text-center">
              <p className="font-display text-xl font-bold">{myVideos.length}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Videos</p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4 text-center">
              <p className="font-display text-xl font-bold">{formatCount(totalLikes)}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Likes</p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4 text-center">
              <p className="font-display text-xl font-bold">{formatCount(totalComments)}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Comments</p>
            </div>
          </section>

          <h2 className="mt-8 text-lg font-bold">My Videos ({myVideos.length})</h2>
          {myVideos.length === 0 ? (
            <section className="mt-3 rounded-2xl border border-dashed border-border p-5 text-center">
              <Film className="mx-auto h-6 w-6 text-muted-foreground" />
              <p className="mt-2 text-sm font-semibold">No videos yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Make your first episode and it will show up here.
              </p>
              <Link
                to="/create"
                className="mt-4 flex h-12 w-full items-center justify-center rounded-2xl bg-gradient-primary text-base font-bold text-primary-foreground shadow-glow"
              >
                Create a video
              </Link>
            </section>
          ) : (
            <ul className="mt-3 space-y-3">
              {myVideos.map((v) => (
                <li key={v.id}>
                  <Link
                    to="/"
                    search={{ video: v.id }}
                    className="flex w-full gap-3 rounded-2xl border border-border bg-card p-3 text-left transition active:scale-[0.99]"
                  >
                    <div className="aspect-[9/16] w-14 shrink-0 overflow-hidden rounded-xl bg-muted">
                      <img src={v.cover} alt="" className="h-full w-full object-cover" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-primary">
                        {v.series ? `${v.series} · ` : ""}
                        {v.episode ?? v.category}
                      </p>
                      <p className="truncate font-bold">{v.title}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatDuration(v.durationSec)} · {formatCount(v.likes)} likes ·{" "}
                        {formatCount(v.comments)} comments
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
