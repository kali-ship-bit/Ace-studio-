# ReelKali Studio — Steps 0–2 build report (2026-11-07)

Steps 0–2 of the in-app video generation plan, built locally in
`~/workspace/ai-story-videos/reelkali-local/`. Steps 3–9 were NOT built
(no video generator, no Omni, no Seedance, no HyperFrames, no auth, no
persisted keys). Nothing was sent to Lovable, nothing pushed to any git
remote, Mochris untouched, the 2026-10-30 backup untouched. The 7 bottom
tabs and the colourful theme are unchanged; the 9 pipeline checks still
block failed videos (their 19 tests still pass).

## What was built

### Step 0 — Jobs foundations (`src/lib/jobs/`)
- `types.ts` — the `Job` record (`id, kind, label, status, progress,
  createdAt, updatedAt, detail, error, mock, output`) and the `JobStore`
  interface. A Job record holds no secrets by construction.
- `store.ts` — local filesystem adapter: one JSON file per job under
  `data/jobs/<id>.json`, outputs under `data/jobs/<id>/`. `data/` is
  gitignored (added to `.gitignore`). Jobs left running by a server
  restart are marked failed on next load, so the UI never polls forever.
- `api.ts` (wired into `src/server.ts`, which intercepts `/api/*`
  before the TanStack handler — this project has no file-based API-route
  convention to rely on, and `server.ts` is the entry in dev and in the
  Nitro cloudflare-module build):
  - `POST /api/jobs` — create a job (`kind: "demo"` for now). The demo
    job moves queued → running → done in ~1.4 s and writes `output.txt`.
  - `GET /api/jobs` — list recent jobs, newest first.
  - `GET /api/jobs/:id` — one job's status (poll this).
  - `GET /api/jobs/:id/output` — download the finished output file.
- `src/routes/narrate.tsx` shows the job-status UI: progress bar,
  status, a "Run a demo job" button, and a recent-jobs list that polls.
- **D1/R2 mapping (for deployment):** the `JobStore` interface is the
  seam. Deployed, the same Job record becomes a row in a Cloudflare D1
  `jobs` table (one column per field) and each output file becomes an
  object in an R2 bucket keyed `jobs/<id>/<filename>`; `GET
  /api/jobs/:id/output` then returns a short-lived signed R2 URL instead
  of streaming bytes from disk. The API routes and the UI do not change.
  The in-process `setTimeout` demo transitions are local-dev only — in
  production a queue consumer updates the D1 row instead.

### Step 1 — Speechify narration
- `src/lib/jobs/speechify.ts` — server-side client for
  `POST https://api.speechify.ai/v1/audio/speech` and
  `GET /v1/voices`. Model is the named constant `SPEECHIFY_MODEL =
  "simba-3.5"` in `env.ts` (change one line to switch — the research
  warns Simba 3.5's free allowance halves to 250,000 chars/month and its
  list price doubles after 21 Nov 2026).
- `POST /api/narrate` — body `{ text, voiceId, language?, rate?,
  sessionId? }`. Text comes from the user typing/pasting story lines in
  the UI. Enforces 2,000 characters per request (server + UI counter);
  default pace is `-5%` (moderate, as the story videos use). Creates a
  `narration` job, synthesizes server-side, saves the MP3 into the job's
  file storage, marks the job done. Returns 202 immediately; the client
  polls. The response reports billable characters.
- `GET /api/voices` — voice picker fed by the Speechify catalog
  (id, display name, locale). The UI (`/narrate`) shows the character
  count before generating (`X / 2,000`) and the free-tier note
  (500,000 characters/month).
- `/narrate` page — "Create a voice": textarea, voice picker, Create
  button, live job status, in-app audio preview (`<audio controls>`)
  and download. Linked from the Create page and from Settings. Not a
  bottom tab — the 7 tabs are unchanged.
- **Cost of the tests: $0.** All live Speechify calls in this build
  were the free tier (68 characters via the connector helper; the app's
  own live call is unverified — see below).

### Step 2 — Session-only BYOK settings
- `src/lib/jobs/byok.ts` — in-memory vault only:
  `sessionId -> provider -> key`. Provider registry with one entry
  today (`speechify`, validated by `GET /v1/voices`); Omni/Seedance/Kie
  plug into the same registry in later steps.
- `POST /api/settings/keys` — validates the pasted key server-side
  first (a rejected key is never stored), then holds it in memory for
  that session. Returns `{ sessionId, key: { provider, masked,
  validatedAt } }` — masked only (`••••` + last 4).
- `GET /api/settings/keys` — masked keys held for the session, plus
  `appKeyConfigured` (boolean only) and the provider list.
- `DELETE /api/settings/keys?provider=…` — removes the key from memory.
- `/settings` page — plain-words explanation, paste box (password
  field), masked display, remove button. Linked from Create and Narrate.
  Not a bottom tab.
- Key resolution for narration: session BYOK key first, then the app's
  own server key, then mock mode, else a clear 503 `speechify_key_missing`.

## How keys are hidden (exact mechanism)
- A key is read ONLY from the server process environment
  (`process.env.SPEECHIFY_API_KEY`) or, for local development, from a
  gitignored `.dev.vars` file in the project root (parsed by `env.ts`,
  server-side only). In production the same name comes from
  `wrangler secret put SPEECHIFY_API_KEY`.
- `.dev.vars` is already in `.gitignore`, and this project has no git
  repo, so the file cannot leave this machine through version control.
  **No `.dev.vars` file exists right now** — none was created, because
  the real key was never available to this build (see below).
- Keys are NEVER in frontend/bundled code (no `VITE_` var, and all
  `node:fs` / key-handling modules are imported only from `server.ts`
  and `src/lib/jobs/api.ts` — never from a component or route loader),
  NEVER in a Job record, NEVER logged, NEVER returned by any API, and
  NEVER in a test, a fixture, or this report. Test values are obviously
  fake placeholders, not key-shaped.
- Session keys live only in one server-process `Map`. A restart wipes
  them. The browser only holds a random session id in `sessionStorage`
  (see `src/lib/jobs/session.ts`); the id is not a secret and not a login.
- Speechify errors are sanitised server-side (`speechify.ts`): only the
  HTTP status and Speechify's public message are kept, truncated to 200
  characters. Verified live: a fake app key produced job failure
  `Speechify request failed (HTTP 401)` with no key material anywhere.
- Verified by grep after the live tests: no key-shaped string appears in
  `data/`, `.output/` or `src/` (only obviously-fake test placeholders
  remain, and they are not keys). The project's own new files pass
  `eslint` with 0 errors (the 743 pre-existing prettier errors elsewhere
  in the Lovable codebase were left untouched).

## How to run it
```bash
cd ~/workspace/ai-story-videos/reelkali-local
bun install        # once (533 packages)
bun run dev        # http://127.0.0.1:5173/ — /narrate and /settings
bun run build      # production build -> .output/
bun run test       # vitest run
```

## How to set the Speechify key in local env (without putting it in the website)
1. Copy `.dev.vars.example` to `.dev.vars` in the project root.
2. Put your key after `SPEECHIFY_API_KEY=` — that file is gitignored and
   is read only by the server. Never paste the key in chat, in a
   component, or in any file the app serves.
3. Restart `bun run dev`. Settings will show "App key on the server:
   set". Or skip the file entirely and paste your key in Settings —
   it is checked once and held in server memory for that session only.
4. To prove the flow without any key: `SPEECHIFY_MOCK=1 bun run dev`
   — narration returns a clearly-labelled mock job (`mock: true`, UI
   says so). Never enable mock mode in production.

## Verification (all run 2026-11-07, local)
- `bun run build` — passed.
- `npx tsc --noEmit` — 0 errors.
- `bun run test` — **69 passed / 69, 9 files** (45 pre-existing + 24
  new: store 5, byok 5, speechify 5, api 9). The 19 pipeline-rules
  tests still pass — the 9 checks still block failed videos.
- `npx eslint src/lib/jobs src/routes/narrate.tsx src/routes/settings.tsx
  src/routes/create.tsx src/server.ts` — 0 errors (my files were
  formatted with prettier; the pre-existing 743 errors elsewhere were
  not touched).
- **Live dev-server proofs (curl, port 5173):**
  - `/`, `/narrate`, `/settings` — HTTP 200.
  - Demo job: `POST /api/jobs` → queued → (poll) done, progress 100,
    `output.txt` downloaded (200, 262 bytes).
  - `GET /api/voices` with no key → 503 `speechify_key_missing`.
  - `POST /api/narrate` with no key → 503 `speechify_key_missing`.
  - Fake BYOK key in Settings → rejected live by Speechify (401) and
    never stored or echoed back.
  - `SPEECHIFY_MOCK=1`: narrate → job done, `mock: true`, real MP3
    downloaded (200, 55,533 bytes, verified MPEG audio).
  - Fake `SPEECHIFY_API_KEY` in env: narration job failed with the
    sanitised `Speechify request failed (HTTP 401)`; `/api/voices`
    returned the same clean error.
- **Speechify itself verified live via the connector helper** (not
  through the app — see below): `voices --locale en --model simba-3.5`
  returned the catalog, and a test synthesis (voice elijah, -5% pace,
  68 chars) produced a valid 92,589-byte MP3. Cost $0 on the free tier.

## What is NOT done / unverified
- **Live app-server → Speechify call is UNVERIFIED.** The app's own
  server key was never available to this build: the Speechify key lives
  in Muse's connector storage, and by design it cannot be read out of
  there (extracting it would break the credential rules). So the app
  route was proved end-to-end with the clearly-labelled mock path and
  with a fake key producing a clean 401 — but no real narration has
  been generated through `/api/narrate` yet. To verify it: put the real
  key in `.dev.vars` as above (or paste it in Settings), then create a
  voice on `/narrate` and check the MP3 plays. That one step is all
  that is missing.
- **No live-browser tap-through.** The browser cannot reach the local
  dev server (loopback rejected), so `/narrate` and `/settings` were
  verified by build + tests + curl only, not by opening them and
  tapping. A Vercel deploy would give a link to check them in a real
  browser (not done — awaiting say-so).
- **Demo job transitions are simulated in-process** (`setTimeout`).
  In production they must be replaced by a queue consumer updating the
  D1 row — documented in `store.ts` and above.
- **Mock mode is dev-only.** It reuses the bundled sample narration
  MP3 as its audio; the job is labelled `mock: true` everywhere.
- Steps 3–9 are not built: no video generator, no Omni/Seedance, no
  HyperFrames, no auth, no persisted keys, no spend caps.
- The 2,000-characters-per-request cap is enforced by us (Speechify's
  own cap is unverified in the primary docs). The free-tier monthly
  usage is not tracked server-side yet — the UI shows the allowance
  only.
- Test job records from the live proofs were cleared from `data/` after
  verification, so the app starts clean.
