import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2, LogIn } from "lucide-react";
import { isSafeRedirect } from "@/lib/security/validation";
import { apiErrorMessage, postAuth } from "@/lib/auth/session";

export const Route = createFileRoute("/login")({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    next?: string | undefined;
    switched?: string | undefined;
  } => ({
    next: typeof search["next"] === "string" ? search["next"] : undefined,
    // ?switched=1 comes from Settings → Switch account: the user just
    // signed out to pick a different account.
    switched: search["switched"] === "1" ? "1" : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Sign in — Ace Studio" },
      {
        name: "description",
        content: "Sign in to Ace Studio to create voices and videos.",
      },
      { property: "og:title", content: "Sign in — Ace Studio" },
      {
        property: "og:description",
        content: "Sign in to Ace Studio to create voices and videos.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { next, switched } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await postAuth<{ user: { id: string; email: string } }>("/api/auth/login", {
        email: email.trim(),
        password,
      });
      toast.success("Welcome back");
      // A full reload makes sure the new session cookies apply everywhere.
      window.location.assign(next && isSafeRedirect(next) ? next : "/");
    } catch (err) {
      const message = apiErrorMessage(err, "Could not sign in. Try again.");
      setError(message);
      toast.error("Could not sign in", { description: message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-[480px] px-4 pb-32 pt-5">
      <h1 className="font-display text-3xl font-bold text-gradient-create">Welcome back</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Sign in to Ace Studio to create voices and videos.
      </p>
      {switched && (
        <p className="mt-3 rounded-2xl bg-teal/10 p-3 text-sm text-teal">
          Signed out. Sign in with a different account — or the same one.
        </p>
      )}

      <form
        onSubmit={(e) => void submit(e)}
        className="mt-5 rounded-2xl border border-border bg-card p-4"
      >
        <label htmlFor="login-email" className="text-sm font-bold">
          Email
        </label>
        <input
          id="login-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="mt-2 h-14 w-full rounded-2xl border border-input bg-background px-4 text-sm font-semibold outline-none focus:ring-2 focus:ring-ring"
        />

        <label htmlFor="login-password" className="mt-4 block text-sm font-bold">
          Password
        </label>
        <input
          id="login-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Your password"
          className="mt-2 h-14 w-full rounded-2xl border border-input bg-background px-4 text-sm font-semibold outline-none focus:ring-2 focus:ring-ring"
        />

        {error && (
          <p className="mt-3 rounded-2xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-primary font-bold text-primary-foreground shadow-glow disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <LogIn className="h-5 w-5" />}
          {busy ? "Signing in…" : "Sign in"}
        </button>

        <div className="mt-4 flex items-center justify-between text-sm">
          <Link to="/forgot-password" className="font-semibold text-teal">
            Forgot password?
          </Link>
          <Link to="/signup" className="font-semibold text-teal">
            Create an account
          </Link>
        </div>
      </form>
    </main>
  );
}
