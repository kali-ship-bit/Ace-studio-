import { useEffect, useState } from "react";
import { checkAdminStatus } from "./lib/admin";
import {
  getSessionUser,
  getSupabaseClient,
  signOut,
  type SupabaseClient,
  type User,
} from "./lib/supabase";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";

export default function App() {
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [checkedSession, setCheckedSession] = useState(false);

  // On load: if a session already exists, keep it only for an admin.
  // Admin status is re-checked on every auth state change (sign-in,
  // token refresh), not just once at load — so an admin flag revoked
  // while the tab is open takes effect at the next refresh instead of
  // never. A transient database error ("error") leaves the session
  // alone: it is not proof the user stopped being an admin.
  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setCheckedSession(true);
      return;
    }
    setClient(supabase);
    let cancelled = false;

    // A const arrow function (not a hoisted function declaration) so
    // TypeScript keeps the non-null narrowing of `supabase` inside it.
    const revalidate = async (sessionUser: User): Promise<void> => {
      const status = await checkAdminStatus(supabase, sessionUser.id);
      if (cancelled) return;
      if (status === "admin") {
        setUser(sessionUser);
      } else if (status === "not-admin") {
        await signOut(supabase);
        setUser(null);
      }
      // status === "error": transient — keep the session; the next
      // sign-in or token refresh re-checks.
    };

    getSessionUser(supabase)
      .then(async (sessionUser) => {
        if (!sessionUser) return;
        await revalidate(sessionUser);
      })
      .catch(() => {
        // A bad session just means "not logged in".
      })
      .finally(() => {
        if (!cancelled) setCheckedSession(true);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        setUser(null);
        return;
      }
      if ((event === "SIGNED_IN" || event === "TOKEN_REFRESHED") && session?.user) {
        void revalidate(session.user);
      }
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  if (!checkedSession) {
    return (
      <main className="center-page">
        <p className="muted">Loading…</p>
      </main>
    );
  }

  if (!user) {
    return <Login onLoggedIn={setUser} />;
  }

  if (!client) {
    // Cannot happen while logged in, but never crash if it does.
    return (
      <main className="center-page">
        <p className="error" role="alert">
          Supabase is not configured.
        </p>
      </main>
    );
  }

  return <Dashboard client={client} user={user} onLoggedOut={() => setUser(null)} />;
}
