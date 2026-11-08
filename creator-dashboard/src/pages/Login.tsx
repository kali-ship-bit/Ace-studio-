import { useState, type FormEvent } from "react";
import { authenticateAdmin } from "../lib/admin";
import { getSupabaseClient, isSupabaseConfigured, type User } from "../lib/supabase";

interface LoginProps {
  onLoggedIn: (user: User) => void;
}

export default function Login({ onLoggedIn }: LoginProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const configured = isSupabaseConfigured();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const client = getSupabaseClient();
    if (!client) {
      setError(
        "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see README.md).",
      );
      return;
    }
    setBusy(true);
    try {
      const result = await authenticateAdmin(client, email.trim(), password);
      if (result.outcome === "allowed" && result.user) {
        onLoggedIn(result.user);
      } else {
        setError(result.message);
      }
    } catch {
      setError("Something went wrong signing in. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="center-page">
      <section className="card login-card">
        <h1>Creator dashboard</h1>
        <p className="muted">Ace Studio — for the creator only.</p>

        {!configured && (
          <p className="error" role="alert">
            Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in a{" "}
            <code>.env</code> file (see README.md). Nothing here can work until the Supabase project
            exists.
          </p>
        )}

        <form onSubmit={handleSubmit}>
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="you@example.com"
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              placeholder="Your password"
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="primary" disabled={busy || !configured}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="muted small">
          Only an admin account can enter. Other users are signed out immediately with “This
          dashboard is for the creator only.”
        </p>
      </section>
    </main>
  );
}
