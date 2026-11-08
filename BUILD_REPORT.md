# ReelKali Studio — local build report (2026-11-07)

Built locally in `~/workspace/ai-story-videos/reelkali-local/` after Lovable ran out of credits.
Nothing was sent to Lovable, nothing was pushed to any git remote, Mochris was not touched,
and `~/workspace/ai-story-videos/reelkali-backup-2026-10-30/` was not touched.

## What was fixed

1. **BottomNav.tsx (the build error)** — was `grid-cols-7` with only 6 items, a stray
   `LayoutDashboard` shorthand property on the Review entry, and a destructured `tone`
   no item defined. Now: 7 items — Home, Stories, Create, Review, Library, Editor,
   **Dashboard** (`{ to: "/dashboard", label: "Dashboard", icon: LayoutDashboard }`),
   stray field removed, and every item now defines a `tone` class (per-tab colour on
   hover/active: Home yellow, Stories pink, Create orange, Review teal, Library violet,
   Editor pink, Dashboard orange). The `/dashboard` route already existed.
2. **AGENTS.md** — the old Lovable rule "preserve the six bottom tabs and expose Dashboard
   through Home and Review only" was replaced with the seven-tab rule, per Kenneth's
   instruction (2026-11-07). It now says Dashboard is reached from its own bottom tab.
3. **Create + Library titles** — Create's `<h1>` now uses `text-gradient-create`;
   Library (via `ComingSoon`, which gained an optional `titleClassName` prop) now uses
   `text-gradient-library`. Stories/Review/Dashboard/Editor already had gradients.
4. **Home feed narration** — `VideoCard` now calls `useNarration(narrationFor(video.id),
   active && playing, muted)`, the same pattern Review/Editor use. The feed's existing
   mute button controls it; the feed starts muted, so nothing auto-plays with sound.
   Bundled sample audio only — no voice API, no key anywhere.

## Missing binaries — resolved

- **3 sample narration MP3s: downloaded successfully.** All three came from the Lovable
  preview host (`id-preview--83513d10-…lovable.app/__l5e/assets-v1/…`), HTTP 200,
  `audio/mpeg`, and byte sizes match the manifests exactly (ep1 73,197; ep2 81,453;
  feed 55,533). Verified as real MPEG audio (`file` output). They now live as real files
  in `src/assets/audio/` and `src/lib/demo-audio.ts` imports the MP3 files directly
  instead of the Lovable-hosted manifest URLs, so the app works offline.
- **12 cover JPGs + favicon.ico: placeholders, NOT the originals.** Generated locally
  with PIL (608×1088, solid danfo-yellow/pink/violet/teal/orange with the story title,
  "ReelKali Studio", and the text "PLACEHOLDER COVER — not the original art"):
  cover-phone, cover-nightbus, cover-market, cover-grandma, cover-exam, cover-traffic,
  cover-comedy, cover-science, cover-music, cover-sports, cover-food, cover-tech.
  Favicon is a real 32×32/64×64 `.ico` (danfo yellow, black "RK").

## Build / test results (2026-11-07, after all fixes)

- `bun install` — 533 packages installed, no errors.
- `bun run build` — **passed** (`✓ built in 1.05s`, nitro output in `.output/`).
- `npx tsc --noEmit` — **passed, 0 errors** (the BottomNav type error is gone).
- `bun run test` (vitest run) — **45 passed / 45, 5 test files, 0 failed.**
  - pipeline-rules.test.ts: 19 tests, including "blocks posting when \<each of the 9 checks\> fails",
    "rechecks failed outputs before auto-post", and "never approves failed checks" — so the
    9 pipeline checks still block a failed video from posting.
  - story-rules 7, editor-rules 14, feed-data 4, app-routing 1.
- `bun run lint` (eslint) — **does NOT pass: 743 problems (730 errors, 13 warnings), all
  prettier/prettier formatting.** This is pre-existing across the whole Lovable codebase
  (errors in ~30 files I never touched, e.g. `stories.tsx`, `review.tsx`, `ui/*`), not
  caused by this work. No files were reformatted; fixing it would be a whole-codebase
  `prettier --write` and is out of scope here.

## Server check (dev server, `bun run dev`, port 4175)

- All routes returned **HTTP 200**: `/`, `/dashboard`, `/create`, `/library`, `/review`,
  `/editor`, `/stories`. Favicon, a cover JPG, and an MP3 all returned 200.
- Rendered Home HTML contains all 7 bottom-nav labels (Home, Stories, Create, Review,
  Library, Editor, Dashboard) and `grid-cols-7`.
- Rendered HTML contains `text-gradient-create`, `text-gradient-library`,
  `text-gradient-dashboard`, `text-gradient-review`.
- Rendered HTML contains **zero** occurrences of "Needs manual edit" — the UI badge for a
  failed video is "Held · not posted" (see `StatusBadge` in `src/components/pipeline.tsx`).
  Note: the string "Needs manual edit" still exists inside `src/lib/pipeline-rules.ts`
  as an internal status label/event text, not as a visible flag.
- Episode 2 "Amara Decides" ships with sound: the pipeline seed comment and
  `startDaily` default (`sound: true`) make "Sound present" pass.

## What was NOT verified

- **No real browser check.** No Chromium/Playwright/Puppeteer is available in this
  environment and subagents cannot drive a browser. Phone (390×844) and desktop
  (1280×1800) rendering, the 7 buttons being tappable, the Dashboard opening on tap,
  and the Delete/Save-to-device/Manual-edit buttons appearing on cards were verified
  only by: build + tests + TypeScript + SSR HTML + code inspection. `CardActions`
  (Delete/Save/Manual edit) is wired in `pipeline.tsx`, `editor.tsx`, and `stories.tsx`,
  but the Review/Dashboard records render client-side from browser-local demo state
  (SSR shows "Loading daily videos…"), so the buttons do not appear in server HTML.
  **Someone with a browser still needs to open the app and tap through it.**
- `vite preview` does not work for this project: the build preset is `cloudflare-module`,
  so `.output/server/index.mjs` is a Cloudflare Worker (exports `fetch`, listens on no
  port) and `vite preview` looks for a `dist/server/server.js` that does not exist.
  Use `bun run dev` to run it locally (see below).

## How to run it locally

```bash
cd ~/workspace/ai-story-videos/reelkali-local
bun install        # only needed once (533 packages)
bun run dev        # Vite dev server, e.g. http://127.0.0.1:5173/
bun run build      # production build -> .output/ (Cloudflare Worker target)
bun run test       # vitest run, 45 tests
```

## Still not done

- Visual/phone/desktop tap-through in a real browser (see above).
- Lint: 743 pre-existing prettier errors across the codebase.
- The 12 placeholder covers are not the original Lovable covers — if Kenneth wants the
  real art back, the originals would need to be re-exported from Lovable or regenerated.
- The sample narration is the Lovable agent's offline espeak recording (robotic), not
  Speechify — that was already known; it is demo audio only.
