import { useEffect, useState } from "react";
import {
  ANNOUNCEMENT_MAX_LENGTH,
  loadAppSettings,
  saveAppSetting,
  type AppSettings,
  type AppSettingKey,
} from "../lib/admin";
import { formatDateTime } from "../lib/format";
import type { SupabaseClient, User } from "../lib/supabase";

interface SettingsProps {
  client: SupabaseClient;
  /** The signed-in admin — recorded as updated_by on every save. */
  user: User;
}

export default function Settings({ client, user }: SettingsProps) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [announcementDraft, setAnnouncementDraft] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<AppSettingKey | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    loadAppSettings(client)
      .then(({ settings: loaded, updatedAt: at }) => {
        if (cancelled) return;
        setSettings(loaded);
        setAnnouncementDraft(loaded.announcement);
        setUpdatedAt(at);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load settings.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, reloadKey]);

  async function save(key: AppSettingKey, value: boolean | string) {
    setError("");
    setNotice("");
    setSaving(key);
    try {
      // The server's updated_at comes back from the re-read row — the
      // "Last updated" line below is the database clock, not this device's.
      const result = await saveAppSetting(client, key, value, user.id);
      setUpdatedAt(result.updatedAt);
      if (settings) setSettings({ ...settings, [key]: value });
      setNotice(`Saved “${key}”. Last updated ${formatDateTime(result.updatedAt)}.`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not save that setting.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <section>
      <h2>App settings</h2>
      <p className="muted">
        These switches change the main Ace Studio app. Only an admin can save them — the database
        enforces that, not just this page.
      </p>
      {loading && <p className="muted">Loading settings…</p>}
      {error && (
        <p className="error" role="alert">
          {error}{" "}
          <button type="button" className="secondary" onClick={() => setReloadKey((k) => k + 1)}>
            Try again
          </button>
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {settings && (
        <div className="settings-list">
          <div className="setting-row">
            <div>
              <strong>Signups open</strong>
              <p className="muted small">When off, new users cannot sign up in the app.</p>
            </div>
            <button
              type="button"
              className={settings.signup_open ? "toggle on" : "toggle off"}
              aria-pressed={settings.signup_open}
              disabled={saving !== null}
              onClick={() => void save("signup_open", !settings.signup_open)}
            >
              {settings.signup_open ? "On" : "Off"}
            </button>
          </div>

          <div className="setting-row">
            <div>
              <strong>Maintenance mode</strong>
              <p className="muted small">
                When on, the app shows a maintenance message instead of working normally.
              </p>
            </div>
            <button
              type="button"
              className={settings.maintenance_mode ? "toggle on" : "toggle off"}
              aria-pressed={settings.maintenance_mode}
              disabled={saving !== null}
              onClick={() => void save("maintenance_mode", !settings.maintenance_mode)}
            >
              {settings.maintenance_mode ? "On" : "Off"}
            </button>
          </div>

          <div className="setting-row column">
            <div>
              <strong>Announcement</strong>
              <p className="muted small">
                A short message shown to users in the app. Leave empty for no announcement.
              </p>
            </div>
            <textarea
              value={announcementDraft}
              onChange={(e) => setAnnouncementDraft(e.target.value)}
              rows={3}
              maxLength={ANNOUNCEMENT_MAX_LENGTH}
              placeholder="e.g. New voices are coming this week!"
            />
            <button
              type="button"
              className="primary"
              disabled={saving !== null || announcementDraft === settings.announcement}
              onClick={() => void save("announcement", announcementDraft)}
            >
              {saving === "announcement" ? "Saving…" : "Save announcement"}
            </button>
          </div>

          {updatedAt && <p className="muted small">Last updated: {formatDateTime(updatedAt)}</p>}
        </div>
      )}
    </section>
  );
}
