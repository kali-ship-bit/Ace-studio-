# Ace Studio

A local-first studio for making faceless AI story videos — write a story,
pick a voice, build the video, and post it to Instagram, Facebook, TikTok
or YouTube. Built with TanStack Start, React, TypeScript and Tailwind CSS.
The backend is **Supabase** (Postgres + Auth + Storage). No Cloudflare.

> This code was pulled out of Lovable on 2026-11-07 (Lovable ran out of
> credits) and is built locally now. Nothing is sent to Lovable. See
> `PULL_REPORT.md` and `BUILD_REPORT.md` for that history.

## Quick start

```sh
bun install
cp .env.example .dev.vars   # fill in your own values (see below)
bun run dev                  # http://localhost:5173
```

Checks:

```sh
bun run build          # production build (Nitro node-server preset)
npx tsc --noEmit       # typecheck — must be 0 errors
bun run test           # full test suite (main app)
bun run lint           # eslint
```

The creator dashboard is a separate app in `creator-dashboard/` with its
own `package.json` — `cd creator-dashboard && npm install && npm run build`
and `npm test` there.

## What is in here

- **Demo story studio (the Lovable app)** — `src/routes/` has the 7 bottom
  tabs: Home, Stories, Create, Review, Library, Editor, Dashboard. Story
  state is browser-local demo data; the daily pipeline (9 safety checks
  that block a failed video from posting) lives in `src/lib/pipeline-*`.
  The checks and the tabs are load-bearing: do not change them without
  Kenneth's say-so.
- **Video generation (Steps 0–2)** — `src/lib/jobs/` (job queue + API:
  `POST /api/jobs`, `POST /api/narrate`, `GET /api/voices`,
  `/api/settings/keys`), `src/lib/posting/` (Instagram/Facebook/TikTok/
  YouTube routes under `/api/post/*`). Voices come from Speechify.
  See `STEPS_02_REPORT.md`.
- **Accounts (Phase A/B)** — `src/lib/auth/` (email + password, 3-strike
  IP lockout, 6-digit reset codes), `src/lib/supabase/`,
  `supabase/migrations/001_ace-studio_foundation.sql`. See
  `SUPABASE_SETUP.md` and `REELKALI_BACKEND_REPORT.md`.
- **Settings** — `src/routes/settings.tsx` (theme, profile picture,
  session API keys) and `src/lib/settings/avatar-api.ts`.

## Configuration

`.env.example` is the only template — every variable name, no values.
Copy it to `.dev.vars` for local development; set the same names as
secrets in the hosting dashboard for production. **Never put a real key
in a file, in chat, or in git.** The secret/service key goes only in the
hosting dashboard (or `.dev.vars` locally) — never in the browser, never
in a `VITE_` variable, never in a Job record or a log line.

- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` —
  create a project named `ace-studio`, run the migration in
  `supabase/migrations/`, then copy the values. Without these, the auth
  routes answer 503 by design and the demo parts keep working.
- `SPEECHIFY_API_KEY` — the app's own voice key (from
  platform.speechify.ai → API Keys). Visitors can also paste their own
  key in Settings; it is held in server memory for that session only.
  `SPEECHIFY_MOCK=1` (dev only) makes narration return a labelled mock.
- Posting credentials per platform — see `src/lib/posting/CREDENTIALS.md`.

## Rules (from AGENTS.md — read it before changing structure)

- The 7 bottom tabs stay as they are. The 9 pipeline checks stay as they
  are. The admin dashboard stays exactly as it is.
- No key ever appears in a response, a Job record, or a log line.
- Pushing, opening a PR, and merging are three separate approvals.

## Docs

- `AGENTS.md` — working rules for this folder.
- `SECURITY.md` — security model (auth, CSRF, rate limits, RLS).
- `SUPABASE_SETUP.md` — create the project, run the migration, go live.
- `src/lib/posting/CREDENTIALS.md` — per-platform posting setup.
- `REELKALI_BACKEND_REPORT.md` — what the Supabase backend build did.
- `STEPS_02_REPORT.md` — what the Steps 0–2 generation build did.
- `SECRETS_SCAN.md` — last secrets scan.
