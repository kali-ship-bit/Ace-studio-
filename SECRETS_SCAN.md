# ReelKali Studio — Secrets Scan + Phase C Security Audit (2026-11-07)

## Verdict up front

**No live secret was found leaked anywhere — not in the local repo, not in
any of Kenneth's public GitHub repos. No rotation is needed.**

Three real gaps were found in the code and fixed (details below):

1. The cost-bearing API routes (narration, posting, demo jobs, key saves)
   had NO rate limit — the `API_MAX_PER_MINUTE` guard existed but was
   never wired in. Now wired: narration 10/min/IP, posting 10/min/IP,
   demo jobs and key saves 60/min/IP (429 with `retryAfterSeconds`).
2. Avatar uploads trusted the browser's MIME label — a script relabelled
   `image/png` would have passed. Now rejected by a magic-byte check.
3. Narration text starting with `<speak` was sent to Speechify as raw
   SSML, and the `rate` value was interpolated into SSML unvalidated.
   Text is now always escaped plain text; `rate` must match
   `-?\d{1,3}%`.

One residual risk is documented, not fixed (it needs Kenneth's decision,
not a code change): the jobs / narration / posting APIs are not
login-gated — they are CSRF-checked and now rate-limited, but anyone who
can reach the endpoint can spend narration characters or trigger a post
once posting credentials are configured. See SECURITY.md.

## Scope and method

- Local repo: `~/workspace/ai-story-videos/reelkali-local/` — `src/`,
  `creator-dashboard/src/`, `supabase/`, docs, `.env.example`,
  `.dev.vars.example`, `data/`, `.output/`, `creator-dashboard/dist/`.
  No gitleaks installed, so the scan was careful grep for `AKIA…`,
  `ghp_`/`gho_`, `sk-`, `sk_live_`, `xox[baprs]-`, `BEGIN … PRIVATE KEY`,
  JWT-shaped strings (`eyJhbGciOi…`), and `api_key|secret|password|token`
  assignments with values. `.dev.vars` does not exist; `data/` is empty.
- GitHub (read-only, GitHub connector, connected as Kenneth's account):
  `search_repositories user:kali-ship-bit` listed 3 public repos and no
  ReelKali repo; `search_code` per repo for `SUPABASE_SERVICE_ROLE_KEY`,
  `filename:.env`, `BEGIN PRIVATE KEY`, `ghp_`, `eyJhbGciOi`, `password`,
  `api_key`, `VITE_SUPABASE`; `get_file_contents` for `.env` and
  `.env.local` in each repo; `list_commits` (recent commits) per repo.
  Nothing was pushed, opened, or modified on GitHub.

## Local scan results — clean

| Check                                                                                                               | Result                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Key-shaped patterns (`AKIA`, `ghp_`, `sk-`, private keys, JWTs) in `src/`, `creator-dashboard/src/`, docs, examples | **0 hits**                                                                                                                                                                           |
| `.dev.vars`                                                                                                         | Does not exist (never created)                                                                                                                                                       |
| `.env` files                                                                                                        | Only `.env.example` and `creator-dashboard/.env.example` — placeholders only (`your-project-ref`, `your-publishable-key-here`, `your-service-role-key-here`, `test-key-placeholder`) |
| `data/`                                                                                                             | Empty                                                                                                                                                                                |
| `.output/` + `creator-dashboard/dist/`                                                                              | Only Supabase library doc examples (`example.supabase.co`, `xyzcompany.supabase.co`, `your-publishable-key`, `<TOKEN>`) — not real values                                            |
| Test fixtures                                                                                                       | Obviously fake only (`test-key-placeholder`, `toolongpass`, 20-char `abcdefghijklmnopqrst` CSRF test token, `test-ig-access-token`)                                                  |

## GitHub scan results — clean, with one caveat

| Repo                                 | Scanned                                                                               | Findings |
| ------------------------------------ | ------------------------------------------------------------------------------------- | -------- |
| `kali-ship-bit/Mochris-ventures-`    | Yes — code search (8 patterns) + `.env`/`.env.local` absent + recent commits reviewed | **None** |
| `kali-ship-bit/Nibss-kGbank`         | Yes — code search + `.env`/`.env.local` absent + recent commits reviewed              | **None** |
| `kali-ship-bit/Kenneth-student-api-` | Yes — code search + `.env`/`.env.local` absent + recent commits reviewed              | **None** |
| ReelKali repo                        | Not applicable — **no ReelKali repo exists** on the account (3 repos total)           | —        |

Caveat: every GitHub `search_code` response returned
`incomplete_results: true` (GitHub's code search timed out), so the
code-search half is "0 hits, search flagged incomplete" rather than a
fully proven clean sweep. The `.env` absence checks and the commit
review (all small, Jul–Oct 2026, nothing secret-shaped in messages)
are complete and independent of that flag.

## Audit verdict per check (a–k)

- (a) CSRF on every mutating route — **TRUE**. All POST/DELETE in
  `auth/api.ts` (via `readCheckedBody`), `posting/api.ts`,
  `settings/avatar-api.ts`, `jobs/api.ts` verify the double-submit token
  before doing anything. GETs are correctly exempt.
- (b) Server-side validation on every form — **TRUE**, with two fixes
  made (see below). Login/signup/reset use `validation.ts`; avatar uses
  `validateUpload`; posting checks https URL + caption/title lengths;
  narration caps text at 2,000 chars and requires a voice.
- (c) No `dangerouslySetInnerHTML` / user text as code — **TRUE for live
  code**, with one fix made (SSML, below). The only
  `dangerouslySetInnerHTML` is in `src/components/ui/chart.tsx`
  (pre-existing Lovable shadcn code) building a `<style>` tag from
  developer-supplied chart config — and that component is not used
  anywhere in the app (dead code). No `innerHTML`, `eval`, or
  `new Function` anywhere.
- (d) No SQL built from user input — **TRUE**. Only Supabase client
  calls (`.from().eq().select()` etc.); the only SQL file is
  `supabase/migrations/001_reelkali_foundation.sql`, run once by a human.
- (e) No secrets in code/tests/fixtures/comments/examples/docs — **TRUE**
  (see scan above).
- (f) Upload limits enforced server-side — **TRUE for avatars** (2 MB +
  MIME + now magic bytes), **NOT APPLICABLE for posting video** (see
  fix note): there is no video file-upload path — posting takes an
  https URL. SECURITY.md wrongly claimed a 500 MB video limit; corrected.
- (g) Admin pages locked — **TRUE**. Creator dashboard (`creator-dashboard/`,
  read-only audit): login + `is_admin` check signs non-admins out
  immediately (`App.tsx`, `admin.ts`), and RLS backs it. Main app has no
  admin-only routes — `/dashboard` is demo pipeline data.
- (h) Session cookies HttpOnly/Secure/SameSite — **TRUE**
  (`security/session.ts`: HttpOnly + SameSite=Lax always; Secure when
  the request is https, off only on local http dev).
- (i) Security headers + HSTS — **TRUE** (`src/server.ts` wraps EVERY
  return path — 308 redirect, API responses, SSR, 500 page — in
  `withSecurityHeaders`; HSTS 1 year + includeSubDomains; CSP, nosniff,
  DENY framing, referrer and permissions policies).
- (j) Rate limits wired — **PARTLY TRUE before this audit, TRUE now**.
  Login 3-strikes/15-min lockout, signup 5/hour, reset 3/hour/email+IP,
  reset-code 5 guesses were all traced route → store (memory, or the
  `auth_attempts` table via the service client when Supabase is
  configured). But `API_MAX_PER_MINUTE` was defined and never used, so
  the jobs/narration/posting routes were unlimited — fixed below.
- (k) Errors never leak internals — **TRUE**. API errors are short
  public messages + codes; Speechify/Instagram/Facebook/TikTok/YouTube
  errors are sanitised and truncated to 200 chars; the server catch-all
  returns a static error page and logs server-side only. No stack
  traces, keys, or SQL in any response checked.

## Fixes made (Phase C)

### 1. Rate-limited the cost-bearing mutating routes

- `src/lib/security/rate-limit.ts` — new `checkApiRateLimit(request,
group, maxPerMinute, store?)` helper (per-IP fixed window, IP hashed
  with SHA-256, never stored raw) and new caps `NARRATE_MAX_PER_MINUTE
= 10`, `POSTING_MAX_PER_MINUTE = 10`. The existing `API_MAX_PER_MINUTE
= 60` is now actually used.
- `src/lib/jobs/api.ts` — POST `/api/jobs` (60/min), POST `/api/narrate`
  (10/min), POST/DELETE `/api/settings/keys` (60/min) return 429
  `too_many_requests` with `retryAfterSeconds` when the cap is hit.
  New optional `ApiDeps.attemptStore` (tests pass a fresh store; default
  is process memory).
- `src/lib/posting/api.ts` — POST `/api/post/:platform` (10/min), same
  429 shape. New optional `PostingApiDeps.attemptStore`.
- Tests: `src/lib/security/rate-limit.test.ts` (helper: cap then 429;
  groups independent), `src/lib/jobs/api.test.ts` (11th narration in a
  minute is 429), `src/lib/posting/api.test.ts` (11th post in a minute
  is 429).
- Limitation to know: the default store is in-process memory, so the cap
  is per server instance and clears on restart — same limitation as the
  auth memory fallback. A durable store (the `auth_attempts` table)
  would need the Supabase client wired into these handlers; left as a
  follow-up, not silently built.

### 2. Avatar uploads now check real magic bytes

- `src/lib/security/validation.ts` — new `isRealImageBytes(bytes,
mime)`: JPEG `FF D8 FF`, PNG 8-byte signature, WebP `RIFF....WEBP`.
- `src/lib/settings/avatar-api.ts` — after `validateUpload`, reads the
  file bytes and rejects a mismatch with 400 `avatar_invalid` before
  anything reaches the public avatars bucket. The upload itself still
  sends the original file.
- Tests: `src/lib/security/validation.test.ts` (real JPEG/PNG/WebP pass;
  HTML-as-PNG, mismatched types, short bytes fail),
  `src/lib/settings/avatar-api.test.ts` (happy-path fixtures now use
  real magic bytes; new test: HTML bytes labelled `image/png` → 400,
  nothing uploaded).

### 3. Narration text can no longer be smuggled in as SSML

- `src/lib/jobs/speechify.ts` — `synthesizeSpeech` now always escapes
  the input (`&`, `<`, `>`) and wraps it in `<speak>` itself (with a
  `<prosody>` wrapper only when a pace is given). The old
  `input.startsWith("<speak")` passthrough is gone. `rate` is
  allow-listed to `/^-?\d{1,3}%$/` and anything else throws `Invalid
narration pace`.
- Tests: `src/lib/jobs/speechify.test.ts` (SSML input is escaped, never
  sent raw; valid `-5%` still wraps in prosody; malicious rate rejected).
- Behaviour note: a no-rate request now sends `<speak>…</speak>` instead
  of bare plain text. That is valid SSML and the path Speechify already
  accepted for paced requests; no caller in the app passes SSML on
  purpose (the narrate page is a plain-text box).

### 4. SECURITY.md corrected (docs only)

- The Uploads row no longer claims a 500 MB posting-video limit (no
  such upload exists; the constants are reserved for a future path).
- Added the API rate-limit row and an explicit "Login not required
  (known limit)" row documenting the residual risk in plain words.

## Migration notes (reported, not edited — per instructions)

`supabase/migrations/001_reelkali_foundation.sql` was audited read-only.
RLS is on for every table; `auth_attempts` has no policies (service key
only); storage policies pin files under the owner's id folder. Two
small hardening notes for the next migration edit (not live holes):

- `public.is_admin()` is `SECURITY DEFINER` without `SET search_path`
  (its sibling `handle_new_user()` has it). Add `set search_path =
public` to match.
- `clientIp()` trusts the first `x-forwarded-for` entry. That is correct
  behind Vercel (which sets the real client IP first), but on a bare
  server an attacker could spoof the header to dodge a lockout or lock
  someone else out. Only run behind a proxy you control.

## Deliberately left out (with reasons)

- **Login-gating the jobs / narration / posting APIs.** The real fix for
  "anyone can spend the Speechify allowance / trigger a post" is auth,
  and the app now HAS auth — but the narrate/create pages are demo-era
  routes that work with no account and no Supabase configured. Gating
  them changes the product behaviour, so it is Kenneth's decision, not a
  Phase C patch. Rate limiting (fix 1) is the mitigation in place now.
  Documented in SECURITY.md.
- **`src/server.ts` handler order, the migration, `src/routes/__root.tsx`,
  the creator-dashboard folder, `package.json`.** Untouched per the task.
- **No `bun install`, no `bun run build`, no dev server.** Per the task;
  another agent owns the build.
- **The `chart.tsx` `dangerouslySetInnerHTML`.** Dead code (component
  unused), config is developer-supplied, not user text. Left as is;
  removing the file is a cleanup decision, not a security fix.
- **GitHub secret scanning (`run_secret_scanning`).** The connector
  lists it, but it is not in the reviewed read-only tool set, so it was
  not run. The code search + `.env` absence checks + commit review above
  are the coverage instead.

## Verification

- `npx tsc --noEmit` — clean (0 errors).
- Full suite `bun run test` — **209 passed / 209** on rerun (29 files).
  One first-run flake in the untouched `src/lib/jobs/store.test.ts`
  (list-order assertion when two jobs share one millisecond) failed once
  then passed 3× alone and in the full rerun — pre-existing timing flake,
  not caused by this audit.
- Touched files after formatting: 66/66 tests pass
  (`rate-limit`, `validation`, `speechify`, `jobs/api`, `posting/api`,
  `avatar-api`).
- `bun x prettier --write` on all edited files; `npx eslint` on them —
  **0 errors**.
