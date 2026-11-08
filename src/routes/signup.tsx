import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Loader2, MailCheck, UserPlus } from "lucide-react";
import { COUNTRIES } from "@/lib/countries";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/security/validation";
import { apiErrorMessage, postAuth } from "@/lib/auth/session";

export const Route = createFileRoute("/signup")({
  head: () => ({
    meta: [
      { title: "Create an account — Ace Studio" },
      {
        name: "description",
        content: "Create a Ace Studio account with your email and phone number.",
      },
      { property: "og:title", content: "Create an account — Ace Studio" },
      {
        property: "og:description",
        content: "Create a Ace Studio account with your email and phone number.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SignupPage,
});

function SignupPage() {
  const [email, setEmail] = useState("");
  const [countryCode, setCountryCode] = useState("NG");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  // The <select> value is the ISO country code, not the dial code:
  // the US and Canada both use +1, so a dial-code value could never
  // tell them apart (Canada could never be picked).
  const country = useMemo(
    () => COUNTRIES.find((c) => c.code === countryCode) ?? COUNTRIES[0],
    [countryCode],
  );
  const dialCode = country?.dialCode ?? "+234";

  const passwordOk =
    password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH;
  const passwordsMatch = confirmPassword.length > 0 && confirmPassword === password;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordOk) {
      setError(`Password must be ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters.`);
      return;
    }
    if (!passwordsMatch) {
      setError("The two passwords do not match.");
      return;
    }
    if (!ageConfirmed) {
      setError("Please confirm you are 18 years or older to create an account.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await postAuth<{ message: string }>("/api/auth/signup", {
        email: email.trim(),
        password,
        confirmPassword,
        phone: phone.trim(),
        dialCode,
        country: country?.name ?? "",
        ageConfirmed,
      });
      setDone(true);
    } catch (err) {
      const message = apiErrorMessage(err, "Could not create the account. Try again.");
      setError(message);
      toast.error("Could not create the account", { description: message });
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
            Check your email to confirm your account. The confirmation link is in the email we just
            sent to <span className="font-semibold text-foreground">{email}</span>.
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
      <h1 className="font-display text-3xl font-bold text-gradient-create">Create an account</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        One account for creating voices and videos in Ace Studio.
      </p>

      <form
        onSubmit={(e) => void submit(e)}
        className="mt-5 rounded-2xl border border-border bg-card p-4"
      >
        <label htmlFor="signup-email" className="text-sm font-bold">
          Email
        </label>
        <input
          id="signup-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="mt-2 h-14 w-full rounded-2xl border border-input bg-background px-4 text-sm font-semibold outline-none focus:ring-2 focus:ring-ring"
        />

        <label htmlFor="signup-country" className="mt-4 block text-sm font-bold">
          Country and phone number
        </label>
        <select
          id="signup-country"
          value={countryCode}
          onChange={(e) => setCountryCode(e.target.value)}
          className="mt-2 h-14 w-full rounded-2xl border border-input bg-background px-4 text-sm font-semibold outline-none focus:ring-2 focus:ring-ring"
        >
          {COUNTRIES.map((c) => (
            <option key={`${c.code}-${c.dialCode}`} value={c.code}>
              {c.name} ({c.dialCode})
            </option>
          ))}
        </select>
        <input
          id="signup-phone"
          type="tel"
          autoComplete="tel-national"
          inputMode="numeric"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="802 828 9087"
          className="mt-2 h-14 w-full rounded-2xl border border-input bg-background px-4 text-sm font-semibold outline-none focus:ring-2 focus:ring-ring"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Your number will be {dialCode} {phone.trim() || "…"}.
        </p>

        <label htmlFor="signup-password" className="mt-4 block text-sm font-bold">
          Password
        </label>
        <input
          id="signup-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={`${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters`}
          className="mt-2 h-14 w-full rounded-2xl border border-input bg-background px-4 text-sm font-semibold outline-none focus:ring-2 focus:ring-ring"
        />
        <p
          className={`mt-1 text-xs font-semibold ${password.length > 0 && !passwordOk ? "text-destructive" : "text-muted-foreground"}`}
        >
          {password.length} / {PASSWORD_MAX_LENGTH} characters · password must be{" "}
          {PASSWORD_MIN_LENGTH} to {PASSWORD_MAX_LENGTH} characters
        </p>

        <label htmlFor="signup-confirm" className="mt-4 block text-sm font-bold">
          Confirm password
        </label>
        <input
          id="signup-confirm"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="Type the password again"
          className="mt-2 h-14 w-full rounded-2xl border border-input bg-background px-4 text-sm font-semibold outline-none focus:ring-2 focus:ring-ring"
        />
        {confirmPassword.length > 0 && (
          <p
            className={`mt-1 flex items-center gap-1 text-xs font-semibold ${passwordsMatch ? "text-teal" : "text-destructive"}`}
          >
            {passwordsMatch && <CheckCircle2 className="h-3.5 w-3.5" />}
            {passwordsMatch ? "Passwords match" : "Passwords do not match yet"}
          </p>
        )}

        {error && (
          <p className="mt-3 rounded-2xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>
        )}

        <label
          htmlFor="signup-age"
          className="mt-4 flex cursor-pointer items-start gap-3 text-sm font-semibold"
        >
          <input
            id="signup-age"
            type="checkbox"
            checked={ageConfirmed}
            onChange={(e) => setAgeConfirmed(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 accent-teal"
          />
          <span>I confirm I am 18 years or older.</span>
        </label>

        <button
          type="submit"
          disabled={busy}
          className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-primary font-bold text-primary-foreground shadow-glow disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <UserPlus className="h-5 w-5" />}
          {busy ? "Creating your account…" : "Create account"}
        </button>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link to="/login" className="font-semibold text-teal">
            Sign in
          </Link>
        </p>
      </form>
    </main>
  );
}
