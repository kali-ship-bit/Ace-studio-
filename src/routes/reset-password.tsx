import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { CheckCircle2, KeyRound, Loader2 } from "lucide-react";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { parseRecoveryHash } from "@/lib/auth/recovery-hash";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/security/validation";
import { apiErrorMessage, postAuth } from "@/lib/auth/session";

export const Route = createFileRoute("/reset-password")({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    code?: string | undefined;
    token_hash?: string | undefined;
    email?: string | undefined;
  } => ({
    code: typeof search["code"] === "string" ? search["code"] : undefined,
    token_hash: typeof search["token_hash"] === "string" ? search["token_hash"] : undefined,
    email: typeof search["email"] === "string" ? search["email"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Reset password — Ace Studio" },
      {
        name: "description",
        content: "Set a new Ace Studio password with the code from your email.",
      },
      { property: "og:title", content: "Reset password — Ace Studio" },
      {
        property: "og:description",
        content: "Set a new Ace Studio password with the code from your email.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPasswordPage,
});

function isSixDigits(value: string | undefined): value is string {
  return typeof value === "string" && /^\d{6}$/.test(value);
}

function ResetPasswordPage() {
  const search = Route.useSearch();
  // The email link can carry the 6-digit code (?code=123456) or a link
  // token (?token_hash=...). A token means the code box is not needed.
  const [email, setEmail] = useState(search.email ?? "");
  const [code, setCode] = useState(isSixDigits(search.code) ? search.code : "");
  const [tokenHash, setTokenHash] = useState(search.token_hash ?? "");
  // The real reset email link carries the recovery session in the URL
  // hash (#access_token=...&type=recovery). Read it once on mount —
  // the server validates the token before changing any password — then
  // clear it from the address bar so it does not linger in history.
  const [recoveryAccessToken, setRecoveryAccessToken] = useState("");
  useEffect(() => {
    const token = parseRecoveryHash(window.location.hash);
    if (token) {
      setRecoveryAccessToken(token);
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, []);

  const linkFlow = tokenHash.length > 0 || recoveryAccessToken.length > 0;
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const passwordOk =
    newPassword.length >= PASSWORD_MIN_LENGTH && newPassword.length <= PASSWORD_MAX_LENGTH;
  const passwordsMatch = confirmPassword.length > 0 && confirmPassword === newPassword;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkFlow && code.length !== 6) {
      setError("Enter the 6-digit code from your email.");
      return;
    }
    if (!passwordOk) {
      setError(`Password must be ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters.`);
      return;
    }
    if (!passwordsMatch) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await postAuth<{ message: string }>(
        "/api/auth/reset-password",
        recoveryAccessToken
          ? { recoveryAccessToken, newPassword, confirmPassword }
          : linkFlow
            ? { tokenHash, newPassword, confirmPassword }
            : { email: email.trim(), code, newPassword, confirmPassword },
      );
      setDone(true);
    } catch (err) {
      const message = apiErrorMessage(err, "Could not reset the password. Try again.");
      setError(message);
      toast.error("Could not reset the password", { description: message });
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <main className="mx-auto max-w-[480px] px-4 pb-32 pt-5">
        <div className="mt-5 rounded-2xl border border-border bg-card p-4 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-teal" />
          <h1 className="font-display mt-3 text-2xl font-bold">Password changed</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your password is changed. Sign in with it.
          </p>
          <Link
            to="/login"
            className="mt-5 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-primary font-bold text-primary-foreground shadow-glow"
          >
            Go to sign in
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[480px] px-4 pb-32 pt-5">
      <h1 className="font-display text-3xl font-bold text-gradient-create">Set a new password</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {linkFlow
          ? "You came from your reset email link. Pick a new password below."
          : "Enter the 6-digit code from your reset email, then pick a new password."}
      </p>

      <form
        onSubmit={(e) => void submit(e)}
        className="mt-5 rounded-2xl border border-border bg-card p-4"
      >
        {!linkFlow && (
          <>
            <label htmlFor="reset-email" className="text-sm font-bold">
              Email
            </label>
            <input
              id="reset-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="mt-2 h-14 w-full rounded-2xl border border-input bg-background px-4 text-sm font-semibold outline-none focus:ring-2 focus:ring-ring"
            />

            <span className="mt-4 block text-sm font-bold">6-digit code</span>
            <div className="mt-2">
              <InputOTP
                maxLength={6}
                value={code}
                onChange={(value) => setCode(value)}
                pattern={REGEXP_ONLY_DIGITS}
              >
                <InputOTPGroup>
                  {[0, 1, 2, 3, 4, 5].map((index) => (
                    <InputOTPSlot key={index} index={index} />
                  ))}
                </InputOTPGroup>
              </InputOTP>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              The code is in the reset email we sent you.
            </p>
          </>
        )}

        <label htmlFor="reset-password" className="mt-4 block text-sm font-bold">
          New password
        </label>
        <input
          id="reset-password"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder={`${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters`}
          className="mt-2 h-14 w-full rounded-2xl border border-input bg-background px-4 text-sm font-semibold outline-none focus:ring-2 focus:ring-ring"
        />
        <p
          className={`mt-1 text-xs font-semibold ${newPassword.length > 0 && !passwordOk ? "text-destructive" : "text-muted-foreground"}`}
        >
          {newPassword.length} / {PASSWORD_MAX_LENGTH} characters · password must be{" "}
          {PASSWORD_MIN_LENGTH} to {PASSWORD_MAX_LENGTH} characters
        </p>

        <label htmlFor="reset-confirm" className="mt-4 block text-sm font-bold">
          Confirm new password
        </label>
        <input
          id="reset-confirm"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="Type the new password again"
          className="mt-2 h-14 w-full rounded-2xl border border-input bg-background px-4 text-sm font-semibold outline-none focus:ring-2 focus:ring-ring"
        />
        {confirmPassword.length > 0 && (
          <p
            className={`mt-1 text-xs font-semibold ${passwordsMatch ? "text-teal" : "text-destructive"}`}
          >
            {passwordsMatch ? "Passwords match" : "Passwords do not match yet"}
          </p>
        )}

        {error && (
          <p className="mt-3 rounded-2xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-primary font-bold text-primary-foreground shadow-glow disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <KeyRound className="h-5 w-5" />}
          {busy ? "Changing your password…" : "Change password"}
        </button>

        {linkFlow && (
          <button
            type="button"
            onClick={() => {
              // Back to the 6-digit-code flow. The email stays as it is
              // (prefilled from the link when it carried one).
              setTokenHash("");
              setError("");
            }}
            className="mt-3 block w-full text-center text-sm font-semibold text-teal"
          >
            Use the 6-digit code instead
          </button>
        )}

        <p className="mt-4 text-center text-sm text-muted-foreground">
          No code yet?{" "}
          <Link to="/forgot-password" className="font-semibold text-teal">
            Send a new one
          </Link>
        </p>
      </form>
    </main>
  );
}
