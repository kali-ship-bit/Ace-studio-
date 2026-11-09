<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

<!-- LOVABLE:END -->

## Demo story architecture

- Keep Phase 2 story state in a shared React provider with browser-local demo persistence; no backend is used because this phase explicitly requests demo-only state.
- Keep clip completion rules in pure shared functions so Stories and Create agree and concrete limits can be tested.
- Leave Home feed data independent from editable story drafts to preserve Phase 1 behavior.

## Demo daily pipeline architecture

- Keep the daily workflow in a separate shared browser-local provider, snapshotting episodes on send so later draft edits cannot alter approval records.
- Keep safety checks and timed transitions in pure shared rules; revalidate the output before approval and every automatic posting transition to block failures.
- Use a persisted demo clock offset for test controls, but start the grace period when a reminder is actually delivered after reopening so closed tabs cannot silently skip it.
- Review and Dashboard read the same pipeline records; the bottom navigation has seven tabs — Home, Stories, Create, Review, Library, Editor, Dashboard — and Dashboard is reached from its own bottom tab (Kenneth's instruction, 2026-11-07, outranks the old six-tab rule).
- Simulate all output and check evidence from demo metadata and existing sample images; never imply a real playable file, email or platform post exists.

## Manual demo editor architecture

- Keep editing operations and completion limits in pure editor rules so every manual edit is tested and rechecked by the daily pipeline.
- Persist editor drafts separately from stories and snapshot the full edit in pipeline output on resubmission so Review can display the edit without altering approval history.

## Local build — structure after the 2026-11-07 review

- Backend is **Supabase, not Cloudflare**: `vite.config.ts` defaults the Nitro preset to `node-server` (set `NITRO_PRESET=vercel` to build the Vercel output instead); the default build output is a plain Node server (`.output/server/index.mjs`). Never re-add a Cloudflare preset or wrangler references.
- `.env.example` is the only env template (copy it to `.dev.vars` locally). Historical reports (`STEPS_02_REPORT.md`, `REELKALI_BACKEND_REPORT.md`, `SECRETS_SCAN.md`, `BUILD_REPORT.md`, `PULL_REPORT.md`) are frozen history — do not update them.
- Job storage is per-request: signed-in users get the Supabase store (`src/lib/supabase/job-store.ts`, RLS-backed), anonymous/demo use the file store (`src/lib/jobs/store.ts`). The resolver is `getJobStoreForRequest()` in `src/lib/jobs/store.ts`.
- Rate limits live in Supabase when configured (`getDefaultAttemptStore()`), else in process memory. CSRF failures are always `403 csrf_invalid`. Validation runs before rate limiting on mutating routes.
- Theme is light + dark: `src/styles.css` has both palettes, `__root.tsx` applies the saved theme before first paint. The Toaster follows the live theme.
- `src/components/ui/` holds only the 12 shadcn components the app actually imports (button, dialog, drawer, input, input-otp, label, separator, sheet, skeleton, slider, toggle, tooltip). The other shadcn files were deleted as unused; the Toaster comes from the `sonner` package directly.
- `tsconfig.json` has `noUnusedLocals` and `noUnusedParameters` on — keep them on.
- Tests live beside the code they test. The route table is pinned in `src/router.test.ts` (14 pages).
- Creator dashboard (`creator-dashboard/`) is a separate app with its own build/tests; its admin-status check is tri-state (`admin | not-admin | error`).
