/**
 * Read a Supabase recovery session out of the URL hash.
 *
 * What the real reset email does: the link points at Supabase's
 * /auth/v1/verify, which checks the token and redirects to the app with
 * the session in the URL HASH — `#access_token=...&type=recovery` —
 * never as a `?token_hash=` query param and never as a 6-digit code.
 * The reset page used to read only the query string, so a real user
 * clicking the email link landed on the form with no way to prove the
 * link — the code box sat empty with nothing to type.
 *
 * This returns the access token only for a recovery session; any other
 * hash (email confirmation, magic link, or none at all) returns null.
 * The token itself is never logged or stored — the page sends it straight
 * to /api/auth/reset-password, which validates it against Supabase.
 */
export function parseRecoveryHash(hash: string): string | null {
  if (!hash.startsWith("#")) return null;
  const params = new URLSearchParams(hash.slice(1));
  if (params.get("type") !== "recovery") return null;
  const token = params.get("access_token");
  return token ? token : null;
}
