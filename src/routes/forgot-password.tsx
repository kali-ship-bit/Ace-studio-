import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2, MailCheck, Send } from "lucide-react";
import { apiErrorMessage, postAuth } from "@/lib/auth/session";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({
    meta: [
      { title: "Forgot password — Ace Studio" },
      {
        name: "description",
        content: "Get a code by email to reset your Ace Studio password.",
      },
      { property: "og:title", content: "Forgot password — Ace Studio" },
      {
        property: "og:description",
        content: "Get a code by email to reset your Ace Studio password.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError("Enter your email address.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await postAuth<{ message: string }>("/api/auth/forgot-password", {
        email: email.trim(),
      });
      setDone(true);
    } catch (err) {
      const message = apiErrorMessage(err, "Could not send the email. Try again.");
      setError(message);
      toast.error("Could not send the email", { description: message });
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <main className="mx-auto max-w-[480px] px-4 pb-32 pt-5">
        <div className="mt-5 rounded-2xl border border-border bg-card p-4 text-center">
          <MailCheck className="mx-auto h-10 w-10 text-teal" />
          <h1 className="font-display mt-3 text-2xl font-bold">Check your email</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            If an account uses that email, a code was sent. Enter the 6-digit code from that email
            on the next page.
          </p>
          <Link
            to="/reset-password"
            search={{ email: email.trim() }}
            className="mt-5 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-primary font-bold text-primary-foreground shadow-glow"
          >
            Enter the code
          </Link>
          <Link to="/login" className="mt-3 block text-center text-sm font-semibold text-teal">
            Back to sign in
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[480px] px-4 pb-32 pt-5">
      <h1 className="font-display text-3xl font-bold text-gradient-create">Forgot password?</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Enter the email you signed up with and we will send you a 6-digit code to reset your
        password.
      </p>

      <form
        onSubmit={(e) => void submit(e)}
        className="mt-5 rounded-2xl border border-border bg-card p-4"
      >
        <label htmlFor="forgot-email" className="text-sm font-bold">
          Email
        </label>
        <input
          id="forgot-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
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
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
          {busy ? "Sending…" : "Send the code"}
        </button>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          Remembered it?{" "}
          <Link to="/login" className="font-semibold text-teal">
            Sign in
          </Link>
        </p>
      </form>
    </main>
  );
}
