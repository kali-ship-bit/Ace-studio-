# ReelKali Studio — Full Audit Report, 2026-11-08

Kenneth asked: check the app for any bug and disorganised code, check if all
code works, fix anything broken, and act as a hacker trying to hack it.

**Result in one line:** the app is healthy now. The audit found 2 high, 4
medium and 12 low code bugs, 5 real security holes, and a lot of dead and
duplicated code. Every real bug and hole is fixed and verified — including
one the first fix round missed, which only showed up when the reset flow
was tested live against real Supabase. Final numbers: build passes, `tsc`
0 errors, **312/312 main-app tests + 54/54 creator-dashboard tests**,
eslint 0 errors, prettier clean, dev server and production build both
serving correctly.

Nothing was committed, pushed, deployed, or sent to Lovable or Mochris.
All changes are uncommitted working-tree edits in
`~/workspace/ai-story-videos/reelkali-local/`.

---

## 1. What was checked, and how

Three passes, all done 2026-11-08, in this order:

1. **Verification pass** — `bun install`, `bun run build`, `npx tsc --noEmit`,
   `bun run test` (main + creator dashboard), eslint, prettier. Then the dev
   server and the production build were started and every route was hit
   for real (all 13 pages, the 404 page, robots.txt, sitemap.xml, favicon),
   plus the live Supabase wiring (CSRF endpoint, `/api/auth/me`, login
   with wrong credentials, platforms endpoint).
2. **Code audit (read-only)** — every route, server function, lib module,
   component, the creator dashboard, and migration 001 were read. Bugs,
   dead code, duplicates and disorganisation were listed with file + line.
3. **Hacker pass (white-hat, authorised by Kenneth)** — the local dev
   server was attacked as an outsider would, against the live Supabase
   project `reelkali-studio` (ref `ujxvuoyguhyfnstsqapk`), using only
   throwaway test accounts. 14 attack vectors were tried (list in §3).
   Nothing real was touched, nothing destructive was run against the
   live database.
4. **Fix pass + re-verification** — every real finding was fixed, tests
   were re-run after each fix, and the key attacks were re-run live to
   prove they now fail. One extra bug (M2b below) was found only during
   live re-verification and fixed the same way.

Earlier work was **not** redone, only re-checked: the 2026-11-07 code
review fixes (migration 001 privilege escalation, SSRF protection,
job-store ownership leak, rate-limit/session/CSRF fixes, light mode,
African dial codes) and the 2026-11-08 TikTok-video fixes (honeypot +
signup burst limit, age 18+ check, self-hosted fonts, robots/sitemap,
favicon) were all re-confirmed still in place and still working.

---

## 2. Bugs found, and the fix applied

### High

| # | Bug | File | Fix |
|---|-----|------|-----|
| H1 | Instagram Reels could never publish: `publishReel()` sent `media_type: "REEL"`, but Meta's Graph API only accepts `"REELS"` (plural). Every reel publish would have been rejected. | `src/lib/posting/instagram.ts:128` | Changed to `"REELS"`; fixed the wrong doc comment above it. Verified against Meta's IG User Media reference and 2026 guides. |
| H2 | TikTok publish could never start: `initVideoPublish` sent `privacy_level: "PUBLIC"`, which TikTok does not accept. Worse, the valid value must come from TikTok's `creator_info/query` endpoint, which the code never called. | `src/lib/posting/tiktok.ts:129` | Added `queryCreatorInfo()` (step 0, mandatory); `initVideoPublish` now takes a `privacyLevel` (default `PUBLIC_TO_EVERYONE`); `publishTikTokVideo` queries creator info first, prefers `PUBLIC_TO_EVERYONE` if offered, else the first offered option (`SELF_ONLY` on an unaudited client), and throws if TikTok returns no options. Verified against TikTok's own Direct Post docs. |

### Medium

| # | Bug | File | Fix |
|---|-----|------|-----|
| M1 | The creator dashboard's **Maintenance mode** and **Announcement** toggles did nothing in the main app: the values were stored but never read. Flipping "Maintenance mode" on changed nothing; an announcement was never shown. | `creator-dashboard/src/pages/Settings.tsx`, `creator-dashboard/src/lib/admin.ts:317-352` | New server module `src/lib/settings/app-settings.ts` reads both switches (service client, 30 s cache, fail-open to defaults); `GET /api/app-settings` serves them; `src/server.ts` returns a 503 maintenance page for page GETs when maintenance is on (API routes stay live so the dashboard can turn it off); `src/routes/__root.tsx` renders the announcement banner. **Verified live** (see §4). |
| M2 | The password-reset link flow could never complete: the page only read `?code=` / `?token_hash=`, but a real Supabase recovery link carries the session in the **URL hash** (`#access_token=...`). | `src/lib/auth/api.ts:482`, `src/routes/reset-password.tsx:15,19,51` | New helper `src/lib/auth/recovery-hash.ts` (`parseRecoveryHash`); the reset handler accepts `recoveryAccessToken` and validates it with `getUser`; the page reads `window.location.hash` on mount and sends the token. **Verified live end-to-end** (see §4). |
| M2b | **Found only during live re-verification (new, not in the audit):** the M2 fix's `updateUser()` call always failed against real Supabase. The user client holds no session — the token only travels in the Authorization header, and `updateUser` needs a session. The unit test passed because the test fake does not model that behaviour. Live, every email-link reset failed with `reset_failed`. | `src/lib/auth/api.ts` (recovery-session branch) | The password is now changed through the Admin API (`serviceClient.auth.admin.updateUserById(userId, …)`) after `getUser` proves the token belongs to that user — so only that user's password can change. If no service client exists, the handler answers an honest 503 instead of failing silently. Test fake gained `admin.updateUserById` and the test now asserts the admin call targeted the token owner's id. **Verified live end-to-end** (see §4). |
| M3 | Avatar upload size pre-check was bypassed by chunked uploads: it read `Content-Length`, so a chunked request sailed past the 413 check and the whole body was buffered in memory before being rejected. | `src/lib/settings/avatar-api.ts:165-168` | New `readCappedFormData()` streams the body with a byte cap (aborts over 2 MB + 64 KB slack with `BodyTooLargeError` → 413 `avatar_too_big`), then re-parses the capped bytes as multipart. **Verified live:** a chunked 3 MB upload now gets 413 (see §4). |
| M4 | Dashboard "Last updated" was the admin's device clock, not the database clock: the upsert sent `updated_at: new Date().toISOString()` from the browser, and `app_settings` had no trigger to overwrite it. | `creator-dashboard/src/lib/admin.ts:397-399` | New migration `supabase/migrations/002_app_settings_updated_at.sql` (trigger `app_settings_set_updated_at` using the existing `set_updated_at()`); applied to the live project and proven by updating a row with `updated_at = '2000-01-01'` and watching the database overwrite it with the real time. The dashboard no longer sends `updated_at` in the upsert. |

### Low

| # | Bug | Fix |
|---|-----|-----|
| L1 | Video-download timeout was per-hop, not whole-download: a fresh 60 s timeout per redirect hop meant up to ~6 min total. Also `2001:db8` prefix check over-blocked `2001:db80::/33`, and the `198.18.0.0/15` benchmarking range was missing from the public-IP check. | `src/lib/posting/download.ts` — one deadline for the whole download; exact first-two-hextet check for the documentation prefix; benchmarking range added. |
| L2 | Instagram poll loop never handled `EXPIRED` — it looped the full 24 × 5 s and reported a misleading "did not finish processing in time". | Throws immediately on `EXPIRED` (and on any unexpected status, named in the message). |
| L3 | Dashboard countdown counted down to the reminder, not the auto-post it described ("Auto-post at" is 30 min later). | Countdown now uses `autoPostTime()`; unused `deadline` import removed. |
| L4 | `resolveClients()` logged a warning on **every** auth request when the service key was missing. | Module-level flag: warns once per process. |
| L5 | Narrate page re-fetched the voice list every time a voice was picked (`loadVoices` depended on `voiceId`). | `loadVoices` now has empty deps (functional `setVoiceId`). |
| L6 | Share-sheet "deep link" (`/?video=<id>`) was never handled by Home, and the "Link copied" toast fired even when the clipboard write failed. | Home now has `validateSearch` for `video` and scrolls to the matching video; toasts fire only after the clipboard write resolves/rejects. |
| L7 | Hardcoded "5 clips" labels disagreed with the real clip count after clips were added/deleted. | Renders `{episode.clips.length}` and the summed total. |
| L8 | Rate limits are check-then-set, not atomic — concurrent requests can both be allowed, so caps can be exceeded slightly under concurrency. | **Documented, not fixed:** making it atomic needs a database-side increment (an RPC) for every limit. The caps are abuse brakes, not exact quotas; the lockout still engages on the next check. Note added to `src/lib/security/rate-limit.ts`. |
| L9 | `SupabaseAttemptStore.set` ran a cleanup delete on **every** write (a second DB round-trip per attempt). | **Deliberately left:** one cheap indexed delete on a low-frequency path, and the behaviour is pinned by a test. Revisit if auth traffic grows. |
| L10 | Dead `?? null` in the avatar GET handler (a string is never null). | Removed (fixed with M3). |
| L11 | Dead `PGRST116` branch in the attempt store (`maybeSingle()` never returns that error; it returns `{data: null, error: null}`). | Dropped the check; any real error now throws. |
| L12 | Twelve small UI-robustness nits. | All fixed: flash-hide timer cleaned up on unmount (`VideoCard`); conflicting `h-11`/`h-auto` on "Save to device" removed (`CardActions`); v7 cover no longer reuses v2's `nightbus` image (`feed-data.ts`, now `traffic`); file input clears `e.target.value` so re-picking the same image fires again (`create.tsx`); discarding a draft no longer cancels the approval window (`editor.tsx`, `baselineRef` reset); demotion to `needs-edit` clears stale `waitingAt`/`reminderAt` (`pipeline-rules.ts`); `NaN` guard when a video duration is 0 (`pipeline.tsx`, `duration \|\| 1`); dead ternary `edge === "start" ? d : d` is now just `d` (`editor.tsx`, was D6). |

### Dead code removed (D1–D6)

- **D1** — `findCountriesByDialCode` / `findCountryByDialCode`
  (`src/lib/countries.ts:117,123`): no production caller, only the test
  imported them. Deleted, plus their two tests.
- **D2** — `jobsDirExists()` (`src/lib/jobs/store.ts`): zero callers (its
  "used by the report" comment was stale). Deleted, plus the now-unused
  `existsSync` import.
- **D3** — `SPEECHIFY_FREE_TIER_MONTHLY_CHARS` (`src/lib/jobs/limits.ts`):
  never used while the UI hardcoded "500,000 characters a month". The
  narrate page now renders the constant (`toLocaleString()`), so the
  number lives in one place.
- **D5** — stale Cloudflare-era file `.wrangler/deploy/config.json`.
  Deleted (per the app's own house rules, it should not exist).
- **D6** — dead ternary in the editor trim drag (see L12).

### Disorganisation tidied (duplicates consolidated)

- `publicJob()` existed twice with an identical body
  (`src/lib/jobs/api.ts:101`, `src/lib/posting/api.ts:58`) → one copy in
  `src/lib/jobs/types.ts`.
- JSON/error helpers were duplicated in four handlers → all use
  `src/lib/security/http.ts` (`jsonResponse` / `errorResponse`).
- The CSRF 403 message was spelled three ways → one shared
  `csrfInvalidResponse()` in `src/lib/security/csrf.ts`.
- Two cookie parsers → `readCookie()` now delegates to `parseCookies()`
  from `src/lib/security/session.ts` (no import cycle).
- Four near-identical `resolveConfig()` and five near-identical
  `sanitise*Error()` functions across the posting providers →
  shared `resolveEnvConfig()` and `sanitiseProviderMessage()` in new
  `src/lib/posting/provider.ts` (+ 5 tests). Instagram, Facebook,
  TikTok, YouTube and Speechify all use them.
- All 429 responses now return a `Retry-After` **header** as well as
  `retryAfterSeconds` in the JSON body, via shared `tooManyResponse()`
  (previously header was missing everywhere).
- Filter CSS was built twice with the same inline template →
  shared `clipFilterCss()` in `src/lib/editor-rules.ts`, used by the
  editor and the preview.
- `src/routes/review.tsx:102` — an import sat in the middle of the file;
  moved to the top imports.

### Known cosmetic inconsistency, recorded not fixed

- **503 vs 500:** auth store/DB failures answer `503 auth_unavailable`,
  while jobs/posting/avatar failures surface as `500 server_error`
  from the catch-all in `src/server.ts`. Standardising needs an error
  taxonomy change across handlers; left as a known inconsistency.
- **Token in body:** Instagram/Facebook send `access_token` in the JSON
  body while the status check uses a Bearer header. Not a vulnerability
  (HTTPS POST body), and the live flow cannot be verified against Meta
  without credentials — left alone, noted here.

---

## 3. Hacker pass — every attempt, method, result

Target: local dev server talking to the live `reelkali-studio` project.
Only throwaway test accounts were used; no real user data was touched;
no destructive writes against the live database. Full raw log kept at
`~/workspace/ai-story-videos/pentest-report-2026-11-08.md`.

| # | Attack | Method | Result |
|---|--------|--------|--------|
| 1 | **Logout does not invalidate the session — MEDIUM, succeeded** | Logged in as throwaway A, logged out, then reused the old access token and old refresh token. | **Succeeded before the fix:** `GET /api/auth/me` with the old token → 200; refresh with the old token → 200 (even a rotated-out refresh token still worked). Logout only cleared cookies; Supabase never revoked anything, so a stolen token stayed usable up to 30 days. **Fixed:** logout now calls `serviceClient.auth.admin.signOut(accessToken, "global")` when a service client exists (revokes every refresh token for that user), falling back to the public sign-out otherwise; cookies are still cleared either way. **Re-verified live:** old access token → 401, old refresh token → 401 `session_expired`. |
| 2 | **Signup failures reported as success — MEDIUM, succeeded** | Tried signing up several throwaway accounts; checked the admin user list after each attempt. | **Succeeded before the fix:** every `signUp` failed server-side (Supabase `email rate limit exceeded`, 429; no user row created) yet the app answered 200 "Check your email" — a real user would wait forever for an email that never comes. **Fixed:** the handler now captures the `signUp()` error; duplicates still get the generic 200 (indistinguishable, by design), any other error gets an honest `503 signup_unavailable` with the real error logged server-side. **Re-verified live:** signup probe → 503, and the server log shows the real Supabase error. **Open question answered live (see §4):** Supabase is *still* rate-limiting signups — see "still needing Kenneth". |
| 3 | **Lockout keyed on a client-controlled IP — MEDIUM, succeeded** | `clientIp()` trusted the last `X-Forwarded-For` entry. While the real IP was locked, logins with a spoofed XFF succeeded. | **Succeeded before the fix** (observationally: locked real IP → 429, spoofed-IP login in the same minute → 200). **Fixed:** new `trustProxyHeaders()` — true only when `TRUST_PROXY=1` or `NODE_ENV=production`; otherwise `clientIp()` returns `"unknown"` and ignores XFF/X-Real-IP entirely. `isSecureRequest()` only trusts `x-forwarded-proto` under the same condition. Tests set `TRUST_PROXY=1` (they simulate a proxied deployment). **Re-verified live:** 3 wrong passwords → 429 lockout; wrong password with spoofed XFF → 429; correct password with spoofed XFF → 429. The bypass is closed. (In local dev all requests share the `"unknown"` bucket, so the lockout applies to every login from the dev server — in production the real client IP is used.) |
| 4 | **Anonymous demo jobs have no ownership — LOW–MEDIUM, succeeded** | Visitor 1 created a demo job; visitor 2 (fresh browser, no cookies) listed it, read it and downloaded its output. | **Succeeded before the fix:** `GET /api/jobs` enumerated every anonymous job; IDs were unguessable but the list gave them away. Signed-in jobs were already correctly isolated. **Fixed:** new server-only `src/lib/jobs/anon.ts` — an `rk_anon` cookie (UUID, 1 year, HttpOnly, SameSite=Lax, Secure on HTTPS) identifies each anonymous visitor; `FileJobStore.create()` now persists `userId` (it used to drop it); job create/list/read/output and post-job endpoints all scope to the requester's id (signed-in id or `anon:<uuid>`); ownerless legacy jobs return 404 for everyone. **Re-verified live:** owner lists 1 job, stranger lists 0, stranger get/output → 404, owner get/output → 200. |
| 5 | **Avatar upload size pre-check bypass — LOW, succeeded** | Sent a 2.1 MB PNG as chunked `FormData` (no `Content-Length`). | **Succeeded before the fix:** the whole body was parsed into memory before `validateUpload` rejected it (400). File still rejected, but a very large chunked upload is buffered first — a memory-DoS vector. **Fixed:** same fix as M3 (streaming byte cap → 413). **Re-verified live:** chunked 3 MB upload → 413 `avatar_too_big`. |
| 6 | **8-character password maximum — LOW** | 5- and 9-character passwords → 400. | **Left alone:** this is Kenneth's spec (built as specified, weaker than usual). Flagged, not changed. |

### Attempts that were blocked (no fix needed)

- **Auth bypass:** `/api/auth/me` and `/api/settings/avatar` without login → 401. Creator dashboard as non-admin → `not-admin`, session signed out, no session left. Jobs/posting/keys accept anonymous requests (documented demo behaviour, Kenneth's decision).
- **Privilege escalation (direct PostgREST):** setting `is_admin=true` on own row → blocked by trigger (`is_admin can only be changed by the creator (SQL Editor)`); cross-user profile read/update → 0 rows; forged job insert with another user's id → RLS violation; cross-user delete → 0 rows; `app_settings` write → 0 rows; `auth_attempts` read → 0 rows; Storage upload to another user's avatar path → RLS violation. Control (own phone update) works.
- **IDOR, signed-in:** B/anon reading A's job or output → 404; lists do not leak; Storage `job-outputs` for A's files → empty / "Object not found" (A's own download works).
- **CSRF:** no token / cookie-only / wrong token → 403 `csrf_invalid`; `_csrf` body field works (by design); `Origin: evil.example` + valid token → 201 (correct for double-submit — the token is unobtainable cross-origin: no CORS headers on `/api/auth/csrf`).
- **XSS:** payloads stored verbatim in JSON only; SSR `/library` HTML contains no raw script; CSP present everywhere; the single `dangerouslySetInnerHTML` is a static theme-boot script with no user data. SSML escaping verified in code only (no Speechify key, so no live generation).
- **SQL injection / PostgREST abuse:** `' OR '1'='1` etc. → 400 `bad_email`; password payload → 400; `.or()`/`.neq()` filters targeting another user → 0 rows. No query-param-driven reads in the app.
- **Signup abuse:** honeypot → generic 200, no account created (verified); age/password/mismatch/country → 400s; duplicate → generic 200; burst 3rd signup → 429.
- **Password-reset abuse:** nonexistent email → generic 200; 4th reset for the same email → 429 (per-email limit held even with a fresh spoofed IP each time); wrong codes → 400 `bad_code`; garbage `tokenHash` → 400; real recovery link: 1st use 200, reuse 400, new password logs in, old password 401.
- **Upload abuse:** HTML-as-PNG, EXE-as-PNG, PNG-as-WebP → 400 `avatar_invalid`; valid PNG → 200, stored at `<own-id>/avatar.png`, served `image/png`; traversal filename stored safely; anon → 401; no CSRF → 403.
- **SSRF:** loopback, localhost, 169.254.169.254, 10/8, 172.16/12, 192.168/16, 100.64/10, 0.0.0.0, `[::1]`, ftp → all refused; mocked 302 to 127.0.0.1 / 10.0.0.5 refused; 6 chained redirects refused; control public video downloads; text/html refused. (Tested at downloader-module level: the API never reaches the downloader while no platform is connected, because the config check comes first.) Residual documented risk: DNS-rebinding TOCTOU.
- **Secrets leakage:** fresh build; client bundle (48 files): 0 occurrences of `SUPABASE_SERVICE_ROLE_KEY`, `service_role`, `SPEECHIFY_API_KEY`, `IG_ACCESS_TOKEN`, `META_APP_SECRET`, `TIKTOK_ACCESS_TOKEN`, `YOUTUBE_REFRESH_TOKEN`, `FACEBOOK_PAGE_ACCESS_TOKEN`, `sb_secret_`; 0 JWT-shaped strings. Server bundle contains only env-var names (expected). Error responses are clean short JSON, no stack traces.
- **Dependencies:** fresh OSV scan of all 513 installed name@version pairs → only the known `zod@3.25.76` GHSA (memory exhaustion, not reachable from app code — already flagged in SECURITY.md).

### Not tested (stated plainly)

- Live SSRF through the API — impossible while no platform is connected (config check first); tested at module level instead.
- Live narration / Speechify — no app key configured; SSML escaping verified in code only.
- The deployed (Vercel) app — local dev only; the XFF finding depends on deployment topology (in production, `NODE_ENV=production` means proxy headers are trusted, which is correct behind exactly one trusted edge proxy).
- The active 3-strikes trigger test in the pentest — stopped before execution and not run; the bypass conclusion rested on observation + code. The fix has since been proven live by the re-test in row 3 above.

---

## 4. Live re-verification after the fixes

Dev server (fresh code, port 8091) + live Supabase project. All checks run
2026-11-08 ~13:25–14:05 WAT.

- **Routes:** all 13 pages 200 (`/`, `/login`, `/signup`, `/forgot-password`,
  `/reset-password`, `/settings`, `/narrate`, `/stories`, `/create`,
  `/review`, `/library`, `/editor`, `/dashboard`); `/no-such-page` 404;
  `/robots.txt`, `/sitemap.xml`, `/favicon.svg` 200.
- **Live wiring:** `/api/auth/csrf` 200; `/api/auth/me` anon 401; wrong
  password (valid length) → 401 `wrong_credentials`; `/api/post/platforms`
  200, 10 platforms, all `configured:false` (expected — no credentials set).
- **Logout fix:** login as throwaway A → 200; logout → 200; old access
  token → 401; old refresh token → 401 `session_expired`. (An earlier
  script artifact returned 403 for the refresh check because the CSRF
  cookie was not sent; re-tested with a valid CSRF token + cookie → 401.
  The fix itself was never in doubt — the first check was wrong.)
- **Anon-job fix:** owner lists 1 job; stranger lists 0; stranger
  get/output → 404; owner get/output → 200.
- **Chunked-upload fix:** chunked 3 MB avatar → 413 `avatar_too_big`.
  (A 2.1 MB chunked upload returns 400 `avatar_invalid` — correct: it
  fits under the streaming cap + 64 KB slack, so it is parsed and then
  rejected by validation as over 2 MB.)
- **M1 live:** flipped `maintenance_mode` on in the live database →
  home and login pages 503 with maintenance text, `/api/auth/csrf`
  still 200, `/api/app-settings` reported `maintenanceMode: true`;
  set a test announcement → `/api/app-settings` returned it;
  **both reverted immediately** — `maintenance_mode: false`,
  `announcement: ""`, home 200 again. (Two Management API calls timed
  out at 60 s; the writes had not applied, so the flip was retried with
  a 180 s timeout, which worked. Lesson kept: always verify state with
  a read after a timeout instead of re-running blindly.)
- **M2 live, end-to-end:** generated a real recovery link for
  throwaway A, followed it (Supabase 303 → app with the session in the
  hash fragment), sent the hash `access_token` to
  `/api/auth/reset-password` → 200 "Your password is changed";
  login with the new password → 200; reuse of the same token → 400
  `bad_reset_link`; fresh link, reset back to the original password →
  200; login with the original password → 200. (First attempt sent the
  raw `token` query param instead of the hash `access_token` and got
  400 — that is the wrong token type for this endpoint, not a bug; the
  real browser flow delivers the hash token, as the page reads it.)
- **Signup probe (finding #2 follow-up):** a real-domain signup
  (`reelkali.audit.20261108+test@gmail.com`) → **503
  `signup_unavailable`**, server log: `email rate limit exceeded`.
  An `@example.com` address is rejected earlier at validation
  ("Email address … is invalid"). The app now reports the failure
  honestly; the Supabase-side rate limit is still active — see §6.
- **XFF re-test:** 3 wrong passwords → 429 lockout; wrong password
  with spoofed XFF → 429; correct password with spoofed XFF → 429.
  The bypass is closed. (This left the VM's IP locked out of login for
  15 minutes; it clears on its own.)
- **Production build** (`node .output/server/index.mjs`, port 3000):
  `/` 200, `/login` 200, `/api/auth/csrf` 200, `/robots.txt` 200,
  `/sitemap.xml` 200, `/no-such-page` 404; security headers present
  (HSTS, CSP, X-Frame-Options DENY, nosniff, permissions-policy,
  referrer-policy).
- Both audit servers were stopped afterwards; no processes remain.

---

## 5. Final verification numbers (2026-11-08 ~14:04 WAT)

| Check | Result |
|---|---|
| `bun install` | No changes (557 installs checked) |
| `bun run build` (main app) | Passes (~1.6 s) |
| `npx tsc --noEmit` (main app) | 0 errors |
| `bun run test` (main app) | **312/312, 42 files** (was 285 before this audit — 27 new tests cover the fixes) |
| Creator dashboard `bun run build` | Passes |
| Creator dashboard `bun run test` | **54/54** |
| Creator dashboard `tsc --noEmit` | 0 errors |
| eslint (main app) | 0 errors, 8 warnings (all known `react-refresh/only-export-components` in `pipeline.tsx`, `pipeline-store.tsx`, `story-store.tsx`) |
| prettier `--check` | Clean (main + dashboard) |
| Production build smoke test | All routes 200, 404 correct, headers present |

One note on honesty: a single full test run during re-verification
exited 1 without showing a failing test; the two runs immediately
before and after it both passed 312/312. Treated as a one-off flake,
not hidden — the final state is green twice over.

---

## 6. Deliberately left alone (product decisions, not bugs)

- **Login is NOT forced on the older demo routes** (jobs / narration /
  posting) — Kenneth's product decision. Anonymous demo jobs are now
  isolated per visitor (fix #4), which is the safe middle ground.
- **Creator-dashboard login lockout not workable** — documented
  limitation, left as is.
- **2 of the 9 pipeline checks (`playable` / `watermarkFree`) are
  hardcoded `true`** — no evidence source in the demo pipeline; left.
- **Maximum password length 8** — Kenneth's spec, weaker than usual;
  built as specified.
- **DMCA agent registration (~$6, US-only) still undone** — Kenneth's
  decision, needed before public launch.
- **L8 rate-limit race** — documented in code (needs a DB-side atomic
  increment to fix properly).
- **L9 cleanup delete on every attempt-store write** — cheap, test-pinned.
- **503-vs-500 inconsistency** — cosmetic, needs an error-taxonomy change.

---

## 7. Still needing Kenneth

1. **Supabase signup is still broken for real users — needs a dashboard
   check.** Live probe 2026-11-08 ~14:00 WAT: a real-domain signup
   returns Supabase `email rate limit exceeded`. The app now reports
   this honestly (503) instead of a fake success, but no new user can
   sign up until the limit clears or the cause is fixed. Likely causes
   to check in the Supabase dashboard (Authentication → Logs): the
   built-in email sender caps at ~2 emails/hour per project, and
   Supabase's own docs say it is for testing only — the long-term fix
   is a custom SMTP sender (Resend / SendGrid / etc.), which also
   matters because the built-in sender reportedly only delivers to
   project team members. Verify in the dashboard before promising any
   signup date.
2. **Vercel deploy** — still awaiting his yes/no. Deploy unlocks:
   opening the app on his phone, his signup (then the admin-flag SQL),
   pasting his Speechify key in app Settings, and live login
   verification in the creator dashboard.
3. **Speechify key** — to be pasted by Kenneth in the app's Settings
   (never in chat) for a real voice through `/narrate`.
4. **Platform credentials** — per `src/lib/posting/CREDENTIALS.md`,
   before Instagram / Facebook / TikTok / YouTube can post through
   the app. (H1/H2 mean the code paths will now work once credentials
   exist; they could never have worked before.)
5. **Supabase Site URL is `http://localhost:3000`** — set it to the
   deployed app URL after the Vercel deploy, so reset links land on
   `/reset-password`. (`SITE_URL` is also unset in `.dev.vars`.)
6. **Refresh-token rotation** — the pentest found a rotated-out refresh
   token still worked, which may just be Supabase's short reuse window
   (default 10 s), not a bug. Worth a glance at the dashboard setting
   (Auth → Sessions) when he is in there for item 1.
7. **DMCA agent registration (~$6)** before public launch
   (documented in `LEGAL_TRAPS.md`).
8. **Cleanup:** delete the throwaway pentest accounts from the
   Supabase dashboard when no longer needed —
   `pentest-a-20261108@example.com` and
   `pentest-b-20261108@example.com`. (The gmail.com signup probe never
   created a user — Supabase rejected it — so there is nothing to
   delete for it. The `pentest-a` password was changed twice during
   the live reset test and restored to the original each time.)
9. **Note:** this VM's IP was locked out of login for 15 minutes by
   the XFF re-test (~until 14:20 WAT); it clears on its own — no action.

---

## Appendix — files changed

All changes are uncommitted working-tree edits; nothing was pushed.

**Posting:** `src/lib/posting/instagram.ts`, `src/lib/posting/tiktok.ts`,
`src/lib/posting/provider.ts` (new), `src/lib/posting/provider.test.ts`
(new), `src/lib/posting/download.ts`, `src/lib/posting/api.ts`,
`src/lib/posting/instagram.test.ts`, `src/lib/posting/tiktok.test.ts`.

**Auth / security:** `src/lib/auth/api.ts`, `src/lib/auth/api.test.ts`,
`src/lib/auth/recovery-hash.ts` (new), `src/lib/auth/recovery-hash.test.ts`
(new), `src/lib/security/rate-limit.ts`,
`src/lib/security/rate-limit.test.ts`, `src/lib/security/session.ts`,
`src/lib/security/session.test.ts`, `src/lib/security/csrf.ts`,
`src/lib/security/http.ts`, `src/lib/supabase/rate-limit-store.ts`.

**Jobs / anon isolation:** `src/lib/jobs/anon.ts` (new),
`src/lib/jobs/anon.test.ts` (new), `src/lib/jobs/store.ts`,
`src/lib/jobs/api.ts`, `src/lib/jobs/types.ts`,
`src/lib/jobs/api.test.ts`, `src/lib/posting/api.test.ts`.

**Settings / app settings:** `src/lib/settings/app-settings.ts` (new),
`src/lib/settings/app-settings.test.ts` (new),
`src/lib/settings/avatar-api.ts`, `src/lib/settings/avatar-api.test.ts`,
`src/routes/__root.tsx`, `src/server.ts`,
`src/lib/supabase/client.ts` (unchanged — `createUserClient` behaviour
documented the M2b fix in `api.ts` instead).

**Dashboard:** `creator-dashboard/src/lib/admin.ts`,
`creator-dashboard/src/lib/admin.test.ts`.

**Migration:** `supabase/migrations/002_app_settings_updated_at.sql`
(new; applied to the live project and verified).

**Routes / UI:** `src/routes/reset-password.tsx`,
`src/routes/dashboard.tsx`, `src/routes/narrate.tsx`,
`src/routes/review.tsx`, `src/routes/stories.tsx`,
`src/routes/editor.tsx`, `src/routes/index.tsx`,
`src/routes/create.tsx`, `src/components/feed/Sheets.tsx`,
`src/components/feed/VideoCard.tsx`, `src/components/CardActions.tsx`,
`src/components/EditedPreview.tsx`, `src/lib/feed-data.ts`,
`src/lib/pipeline-rules.ts`, `src/lib/pipeline.tsx`,
`src/lib/editor-rules.ts`, `src/lib/countries.ts`,
`src/lib/countries.test.ts`.

**Deleted:** `.wrangler/deploy/config.json`.
