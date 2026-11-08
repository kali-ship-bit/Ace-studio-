# Phase 2

- [x] Shared demo story state and five-clip validation.
- [x] Stories series manager, episode creation and details.
- [x] Create four-step flow, images, prompts, reorder/delete, draft and preview.
- [x] Regression tests and phone/desktop flow verification.

# Phase 3

- [x] Shared demo pipeline, nine checks, timers, notifications and safety tests.
- [x] Review preview, actions, reminders and daily history.
- [x] Dashboard records, metrics, workflow, activity and notifications.
- [x] Stories/Create send actions and minimal Home entry points.
- [x] End-to-end phone/desktop verification and regression checks.

# Phase 4

- [x] Restore preview and verify previous screens.
- [x] Editor timeline, trim/split/reorder/delete and editing limits tests.
- [x] Text, audio, overlays, effects, filters, adjust, stickers, cover, transitions and aspect ratio.
- [x] Save drafts and resubmit to Review with all nine safety checks.
- [x] Phone/desktop end-to-end verification and regression tests.

Verified November 5, 2026 at 390×844 and 1280×1800 with isolated browser-local demo state. Editor tools and timeline operations were exercised; saved drafts survived reload; resubmission began with pending checks, then ran all nine. Valid edits reached approval; a non-9:16 edit remained held after both timer skips. Home actions and filters, Stories details, Create steps and saving, Review reminders/auto transitions, Dashboard search/filters/read notices, and the Library placeholder passed. All 45 regression tests passed; preview reports build OK. No Phase 1–3 source files were changed. Historical pixel-for-pixel equivalence was not assessed because no Phase 3 baseline was available.

# In-app generation — Steps 0–2 (built locally, 2026-11-07)

- [x] Step 0 — Jobs skeleton: JobStore (local files under gitignored `data/jobs/`, maps to D1 + R2), POST/GET `/api/jobs`, `GET /api/jobs/:id`, `GET /api/jobs/:id/output`, demo job end to end, job-status UI with polling.
- [x] Step 1 — Speechify narration: server route POST `/api/narrate` (simba-3.5, 2,000 chars/request), voice picker from GET `/v1/voices`, MP3 into job storage, `/narrate` page with audio preview + download. Free tier, $0 in tests.
- [x] Step 2 — Session-only BYOK: `/settings` page, server-side key validation, masked display (••••last4), keys held in server memory only — never saved, never shown in full.
- [ ] Step 3 — One paid generator, one clip (Omni Flash). NOT started.
- [ ] Steps 4–9 — Assembly, HyperFrames, Seedance, free generation, auth + persisted keys, hardening. NOT started.

Steps 0–2 verified 2026-11-07: build passes, `tsc` 0 errors, 69/69 tests (45 pre-existing + 24 new), live curl proofs of the demo job, mock narration and key rejection. One gap: no real narration has been generated through `/api/narrate` yet — the app's server key was never available to the build (it lives in Muse's connector storage and cannot be read out). Put the real key in `.dev.vars` or paste it in Settings to verify. See STEPS_02_REPORT.md.
