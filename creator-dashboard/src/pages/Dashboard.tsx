import { useEffect, useState } from "react";
import Nav, { type SectionId } from "../components/Nav";
import { loadDashboardCounts, type DashboardCounts } from "../lib/admin";
import { signOut, type SupabaseClient, type User } from "../lib/supabase";
import MoreSections from "./MoreSections";
import Overview from "./Overview";
import Settings from "./Settings";
import Users from "./Users";

interface DashboardProps {
  client: SupabaseClient;
  user: User;
  onLoggedOut: () => void;
}

export default function Dashboard({ client, user, onLoggedOut }: DashboardProps) {
  const [section, setSection] = useState<SectionId>("overview");
  const [counts, setCounts] = useState<DashboardCounts | null>(null);
  const [countsError, setCountsError] = useState("");
  const [logoutError, setLogoutError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setCountsError("");
    loadDashboardCounts(client)
      .then((c) => {
        if (!cancelled) setCounts(c);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setCountsError(err instanceof Error ? err.message : "Could not load totals.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, reloadKey]);

  async function handleLogout() {
    setLogoutError("");
    const error = await signOut(client);
    if (error) {
      // Do not pretend the logout worked: the session may still be
      // alive, so stay on the dashboard and say so.
      setLogoutError("Could not log out. Please try again.");
      return;
    }
    onLoggedOut();
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div>
          <h1>Creator dashboard — Ace Studio</h1>
          <p className="muted">Signed in as {user.email}</p>
        </div>
        <button type="button" className="secondary" onClick={() => void handleLogout()}>
          Log out
        </button>
      </header>
      {logoutError && (
        <p className="error" role="alert">
          {logoutError}
        </p>
      )}

      <div className="stat-grid header-stats">
        <div className="stat-card big">
          <span className="stat-number">{counts ? counts.userCount : "—"}</span>
          <span className="stat-label">users</span>
        </div>
        <div className="stat-card big">
          <span className="stat-number">{counts ? counts.jobCount : "—"}</span>
          <span className="stat-label">total jobs</span>
        </div>
      </div>
      {countsError && (
        <p className="error" role="alert">
          {countsError}{" "}
          <button type="button" className="secondary" onClick={() => setReloadKey((k) => k + 1)}>
            Try again
          </button>
        </p>
      )}

      <Nav active={section} onSelect={setSection} />

      <main className="section-body">
        {section === "overview" && (
          <Overview client={client} totalJobs={counts ? counts.jobCount : null} />
        )}
        {section === "users" && <Users client={client} />}
        {section === "settings" && <Settings client={client} user={user} />}
        {section === "more" && <MoreSections />}
      </main>
    </div>
  );
}
