# ReelKali Studio — Backend + Security Build Report (2026-11-07)

Supabase backend (NOT Cloudflare), auth pages, security hardening, TikTok-style
settings, separate creator dashboard, and social posting routes — built locally
in `~/workspace/ai-story-videos/reelkali-local/`. Nothing sent to Lovable,
nothing pushed to GitHub, nothing deployed, nothing posted to any social
account. $0 spent, no cards, no paid plans.

## Verification summary (final state, all run 2026-11-07 evening)

- `bun run build` (main app) — passes.
- `npx tsc --noEmit` — 0 errors.
- `bun run test` (main app) — **209/209, five consecutive green runs**.
- Creator dashboard (`creator-dashboard/`): `bun run build` passes,
  `npx tsc --noEmit` clean, `bun run test` **21/21**.
- Live curl checks against the local dev server (port 8080, server stopped
  afterwards) — see "Live checks" below.
- One test flake was found and fixed during verification (see "Fixes during
  verification"). Before the fix the suite failed about 1 run in 3; after
  the fix it passed 5 times in a row.

## Phase A — Supabase foundation + security core (done, verified)

- `src/lib/supabase/` — env (SUPABASE_URL / ANON_KEY / SERVICE_ROLE_KEY from
  process env or gitignored `.dev.vars`), public client (publishable key),
  service client (secret key, server-only, throws in a browser), per-user
  client (acts as one user, RLS sees their identity), `getAuthUserFromRequest`,
  `refreshSession`, `isAdminUser`.
- `src/lib/supabase/job-store.ts` — jobs on Postgres + Storage behind the
  same `JobStore` interface as the local file store. A job is refused without
  an owner; outputs live at `<user_id>/jobs/<id>/<filename>` so Storage RLS
  enforces ownership. Anonymous/demo jobs keep using the file store.
- `src/lib/supabase/rate-limit-store.ts` — lockout rows in the `auth_attempts`
  table (SHA-256 hashes of IPs, never raw addresses), so a lockout survives a
  restart.
- `src/lib/security/` — validation (email, password 6–8, phone + dial code,
  6-digit reset code, uploads, safe redirects), CSRF double-submit
  (`rk_csrf` cookie + `x-csrf-token` header), rate limiting (login 3 strikes
  → 15-min lockout; signup 5/hour; reset 3/hour; code guesses 5; API caps),
  session cookies (HttpOnly, Secure when HTTPS, SameSite=Lax), security
  headers (HSTS 1 year, CSP, nosniff, DENY framing, referrer + permissions
  policies), JSON/body helpers (1 MB cap).
- `src/lib/countries.ts` — dial codes, Nigeria +234 first.
- `supabase/migrations/001_reelkali_foundation.sql` — profiles, jobs,
  app_settings, auth_attempts; RLS on every table (users see only their own
  rows; admins see all; `auth_attempts` has no API policy at all — service
  key only); `handle_new_user` trigger; `is_admin()` helper; Storage buckets
  `avatars` (public) and `job-outputs` (private) with owner-folder policies.
- `.env.example` / `.dev.vars.example` — names only, no values.
  `.gitignore` now also ignores `.env`, `.env.local`.
- Docs: `SUPABASE_SETUP.md` (exact steps for Kenneth), `SECURITY.md`
  (rules table + plain-words XSS / SQL injection / CSRF answers).

## Phase B — Auth pages + API (done, verified)

- `src/lib/auth/api.ts` — `GET /api/auth/csrf`, `POST /api/auth/signup`
  (server validation of everything, 5/hour/IP, `signup_open` check, generic
  success that never reveals whether the email exists),
  `POST /api/auth/login` (lockout checked before the password is tried, 429
  with `retryAfterSeconds`; generic 401; cookies set + count reset on
  success), `POST /api/auth/logout`, `POST /api/auth/refresh`,
  `POST /api/auth/forgot-password` (3/hour per email and per IP, generic
  reply), `POST /api/auth/reset-password` (6-digit code flow via
  `verifyOtp` type recovery + link `token_hash` flow; 5 code guesses then a
  15-minute lockout), `GET /api/auth/me`. No Supabase → 503
  `auth_not_configured` (CSRF/logout still work). No hand-rolled hashing —
  Supabase Auth hashes with bcrypt.
- Pages: `/login` (safe `?next=` redirect), `/signup` (dial-code picker,
  Nigeria +234 first, live 6–8 password count), `/forgot-password`,
  `/reset-password` (InputOTP 6-digit code, prefills `?code=` /
  `?token_hash=` from the email link). Branded 404 page in `__root.tsx`.
- Tests: 22/22 (auth handler + session helpers).

## Phase C — Security hardening audit + secrets scan (done)

- Audit verdict: CSRF on every mutating route, server validation everywhere,
  no user text rendered as code, no SQL built from user input, no secrets in
  code/tests/docs, upload limits, admin gating, cookies, headers, rate-limit
  wiring, errors leak nothing. Full findings: `SECRETS_SCAN.md`.
- Fixes made by the audit: (1) rate limits on the cost-bearing routes
  (`/api/narrate` 10/min, `/api/post/*` 10/min, `/api/jobs` 60/min,
  `/api/settings/keys` 60/min — 429 with `retryAfterSeconds`); (2) avatar
  magic-byte check (JPEG/PNG/WebP signatures — a script relabelled as
  `image/png` is now rejected); (3) SSML injection closed in Speechify
  narration (text always escaped inside `<speak>`, rate allow-listed);
  (4) `SECURITY.md` corrected (it wrongly claimed a 500 MB video-upload
  limit — no video-upload path exists).
- Secrets scan: **no live secret leaked anywhere — no rotation needed.**
  Local repo: 0 key-shaped hits (grep; no gitleaks installed); `.dev.vars`
  does not exist; `data/` empty. GitHub (connector, read-only): 3 public
  repos, no ReelKali repo — `kali-ship-bit/Mochris-ventures-`,
  `Nibss-kGbank`, `Kenneth-student-api-`, 0 findings. Caveat: every code
  search response said `incomplete_results: true`, so the GitHub code search
  is "0 hits, flagged incomplete"; `.env`/`.env.local` absence was confirmed
  directly per repo and recent commits reviewed.

## Phase D — Settings page (done, verified)

- `src/routes/settings.tsx` rebuilt as a TikTok-style hub from Kenneth's
  three screenshots, using only the items that match this app: Account,
  Security & permissions, Private account, Blocked accounts, Comments,
  Mentions, Direct messages, Downloads, Following list, Liked videos,
  Music, Activity center, Offline videos, Free up space, Data Saver, Help
  Center, Privacy Center, Terms and Policies, Switch account, Log out —
  plus dark/light mode and profile-picture upload. TikTok-only items skipped
  (LIVE, Family Pairing, Time and well-being, Wallpaper, etc.). BYOK keys
  section kept exactly as Step 2 built it.
- Every row does something real: theme toggle persists (localStorage,
  default dark); avatar uploads via `POST /api/settings/avatar`
  (server-validated 2 MB + type + magic bytes, Storage RLS ownership);
  preference rows open a choice sheet and save on-device (page states
  "Saved on this device for now — account sync comes next"); Blocked
  accounts shows "None" honestly; Offline videos / Activity center show
  real job counts; Free up space shows real local-storage bytes and clears
  only cached demo data behind a confirm; Help/Privacy/Terms open
  plain-words in-app sheets. Switch account / Log out call
  `POST /api/auth/logout` then go to `/login`.
- Tests: 26/26. Caveat: `__root.tsx` still hardcodes `class="dark"` on
  `<html>` (forbidden to touch), so Light mode applies after mount, not on
  the first server-rendered paint.

## Phase E — Creator dashboard, separate app (done, verified)

- `creator-dashboard/` — standalone Vite + React 19 + TypeScript app
  (own package.json, `bun install` done, 112 packages). Nothing outside
  that folder was touched.
- Login page (admin-only: non-admins are signed out immediately with
  "This dashboard is for the creator only"); dashboard with big user count
  + total jobs; users table (email, phone, country + dial code, created at,
  admin yes/no, search by email/phone); jobs by status; app-settings editor
  (`signup_open`, `maintenance_mode`, `announcement` with save
  confirmation). All reads through RLS with the publishable key — **no
  service key anywhere in this app**. README documents the 5-step "add a
  new section" guide plus a visible placeholder section.
- Run: `cd creator-dashboard && bun run dev` (port 5174), env
  `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`.
- Tests: 21/21 (mocked client).

## Phase F — Social posting routes (done, verified)

- `src/lib/posting/` — registry of 10 platforms (Instagram, Facebook,
  TikTok, YouTube, X, Snapchat, Twitch, Kick, Rumble, Dailymotion) with
  honest monetisation notes (no payout rates invented).
- Fully implemented behind credential gates: Instagram (container →
  status → publish), Facebook (Page video), TikTok (Content Posting API
  init → upload → publish), YouTube (token refresh → resumable upload).
  Checklist-only, with honest reasons: X (OAuth + chunked media upload not
  built), Snapchat (Business/Creator + Spotlight, no simple server
  endpoint), Twitch (live-streaming only; VODs come from streams, no
  upload API), Kick (no public upload API at all), Rumble + Dailymotion
  (verified partner/API arrangement needed first).
- API: `GET /api/post/platforms`, `POST /api/post/:platform` (CSRF-checked,
  creates a `kind: "post"` job, 202, publishes fire-and-forget; unconfigured
  → job fails naming the exact missing env vars), `GET /api/post/jobs/:id`.
- `src/lib/posting/CREDENTIALS.md` — exact per-platform setup steps.
- Tests: 43/43 with mocked fetch. TikTok and YouTube are implemented from
  the public docs but NOT live-verified against the real platform APIs —
  run one throwaway-clip test before the first real post.

## Server wiring (done by the coordinator)

- `src/server.ts` routes `/api/auth/*` → auth, `/api/post/*` → posting,
  `/api/settings/avatar` → avatar, then the jobs API, then the TanStack
  app; wraps EVERY response with the security headers; 308 redirects plain
  http to https for any non-local host (local dev untouched).
- CSRF added to the older jobs API (`POST /api/jobs`, `POST /api/narrate`,
  `POST/DELETE /api/settings/keys`); `/narrate` and `/settings` send the
  token via a new `fetchWithCsrf()` helper (fetches once, retries once on
  expiry). `userId` stripped from public job responses in both APIs.
- One bug found and fixed: `/login` and `/reset-password` declared search
  params as required, so links to them without `?next=`/`?code=` failed
  type-check — search fields are now optional; route tree regenerated.

## Live checks (curl, local dev server, 2026-11-07 ~21:43 WAT)

- Pages: `/` 200, `/login` 200, `/signup` 200, `/forgot-password` 200,
  `/reset-password` 200, `/settings` 200, `/narrate` 200,
  `/no-such-page` 404 with "Page not found" text.
- Security headers present on `/`: HSTS, CSP, nosniff, `X-Frame-Options:
  DENY`, referrer-policy, permissions-policy.
- `GET /api/auth/csrf` → 200 + `rk_csrf` cookie + token.
- `POST /api/jobs` without CSRF → 403; with CSRF → 201, polls to done
  100, output downloads 200.
- `POST /api/post/instagram` without CSRF → 403; with CSRF → 202, job
  fails with "Instagram is not connected yet — set IG_USER_ID and
  IG_ACCESS_TOKEN".
- `GET /api/post/platforms` → 10 platforms, all unconfigured except Kick
  (Kick needs no credentials because it has no upload API — it still
  cannot post).
- Narrate rate limit live: 10 rapid calls → 503 (no Speechify key, as
  expected unconfigured), 11th → **429 `too_many_requests`,
  `retryAfterSeconds: 60`**.
- `GET /api/auth/me`, `/api/voices`, `/api/settings/avatar` → 503
  (Supabase not configured — the designed unconfigured behaviour, not a
  bug). Unknown API route → 404.

## Fixes during verification (coordinator)

- Test flake fixed (was failing ~1 run in 3): two jobs created in the same
  millisecond sorted backwards (random id suffix has no creation order).
  Job ids now carry a monotonic per-process sequence, and `list()` breaks
  createdAt ties by id; the Supabase store orders by `created_at, id`.
  A second real bug from the same log: concurrent writes for one job shared
  a tmp filename, so the second rename failed with ENOENT — each write now
  uses a unique tmp name. Also applied the audit's note: `is_admin()` in
  migration 001 now sets `search_path = public`. Suite then passed 5/5
  consecutive runs (209/209).

## What still needs Kenneth

1. **Supabase project** (about 10 minutes, dashboard): create a NEW project
   `reelkali-studio` (not the Mochris one); run
   `supabase/migrations/001_reelkali_foundation.sql` in its SQL Editor;
   copy Project URL → `SUPABASE_URL`, publishable key →
   `SUPABASE_ANON_KEY`, secret key → `SUPABASE_SERVICE_ROLE_KEY` (server
   only — never in chat, never in the website, never on GitHub) into
   `.dev.vars` locally / hosting secrets in production. Then sign up once
   in the app and run `update public.profiles set is_admin = true where
   email = 'his-email@example.com';` to become first admin. Full steps:
   `SUPABASE_SETUP.md`. (The Management API token returned 401, so this
   cannot be automated — it needs his dashboard.)
2. **Forgot-password email**: for a 6-digit code instead of a link, change
   the "Reset Password" email template in the Supabase dashboard to use
   `{{ .Token }}`. If skipped, the reset link still works.
3. **Platform credentials** before any platform can post — exact steps in
   `src/lib/posting/CREDENTIALS.md`: Instagram (`IG_USER_ID`,
   `IG_ACCESS_TOKEN`, Meta app id/secret), Facebook (`FACEBOOK_PAGE_ID`,
   `FACEBOOK_PAGE_ACCESS_TOKEN`), TikTok (client key/secret, access token
   with approved `video.upload` scope), YouTube (OAuth client id/secret,
   refresh token). X/Snapchat/Twitch/Rumble/Dailymotion/Kick have no
   working route yet.
4. **Speechify key**: no real narration has been made through the app yet
   — he pastes his key in the app's Settings page (never in chat) once the
   app is reachable, then creates a voice on `/narrate`.

## Deliberately left out (with reasons)

- **Login is not required for the jobs / narration / posting APIs.** The
  narrate/create pages are demo-era routes that work with no account, so
  forcing login would be a product change, not a security patch. Rate
  limiting (10/min narration + posting) is the mitigation now; documented
  in `SECURITY.md`. Wiring the Supabase job store per logged-in user is the
  follow-up once he confirms narration should require login.
- **No live-browser tap-through** (same loopback limit as Steps 0–2):
  pages verified by build + tests + curl, not by opening them in a browser.
- **Live login/lockout/HTTPS-redirect checks need the Supabase project**
  (unconfigured, auth routes answer 503 by design; lockout is proved by
  unit tests only).
- **TikTok/YouTube not live-verified** against the real platform APIs
  (mocked fetch only).
- **No video-upload path for posting** — the posting routes take a public
  video URL (e.g. a Supabase Storage signed URL); uploading the file itself
  is a later step.
- **Settings preferences are on-device for now** (localStorage); account
  sync needs a `profiles.preferences` column (migration 002, not written).
- **No Vercel deploy, no git push, no Lovable** — all awaiting his say-so.
