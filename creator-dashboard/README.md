# Ace Studio Creator Dashboard

A **separate** app from the main Ace Studio website, sharing the **same
Supabase database/project** so the creator (Kenneth) can see how many users
there are and change things in the app from his end.

- Main app: `~/workspace/ai-story-videos/ace-studio-local/` (TanStack Start)
- This dashboard: `creator-dashboard/` (standalone Vite + React + TypeScript)
- Backend: Supabase — see `SUPABASE_SETUP.md` and
  `supabase/migrations/001_ace-studio_foundation.sql` in the main app.

## Security — read this first

- **No service-role (secret) key anywhere in this app.** All data access
  goes through Row Level Security (RLS) with the creator's own login, using
  only the publishable key (`VITE_SUPABASE_ANON_KEY`, public by design).
  The secret key bypasses RLS and must never be in a browser app, in code,
  in a test, in a log, or in git.
- **Admin-only means two layers:** (1) the login check in
  `src/lib/admin.ts` — a non-admin is signed out immediately and told
  "This dashboard is for the creator only." (2) The RLS policies in the
  database (`profiles: read own or admin`, `app_settings: write for
admins`, `jobs: owner or admin`). Even if the UI check were bypassed, a
  non-admin still could not read other users or change a setting.
- **Only ONE email can ever log in: `kennethkalizibegoddynatus@gmail.com`.**
  The allowlist lives in one place — `CREATOR_ADMIN_EMAIL` in
  `src/lib/admin.ts`, overridable with `VITE_CREATOR_ADMIN_EMAIL` (see
  `.env.example`) — and it is checked twice: once on the signed-in
  account's email right after login, and again on the profile row's
  email every time the session is re-checked. Any other email is signed
  out immediately with "This dashboard is for the creator only.", even
  with a valid password and even if that account somehow had the
  `is_admin` flag. There is no second admin, ever.
- **Login rate limiting comes from Supabase Auth itself.** This
  dashboard signs in directly with `signInWithPassword`; it does not
  reuse the main app's 3-strike IP lockout, because that lockout lives
  in the main app's `/api/auth/login` route, which answers with
  HttpOnly session cookies for the main app's own origin and never
  returns tokens — so this separate app cannot call it and then
  `setSession()` with the result. See the note at the top of
  `src/lib/admin.ts`.
- **Admin status is re-checked on every auth state change** (sign-in,
  token refresh), not just once at load — see `src/App.tsx`. A
  transient database error while checking never signs an admin out
  with a misleading "not the creator" message; the session is left
  alone and the next sign-in or refresh re-checks.

## Run it

```bash
cd ~/workspace/ai-story-videos/ace-studio-local/creator-dashboard
bun install        # once
bun run dev        # http://localhost:5174/
bun run build      # production build -> dist/
bun run test       # vitest (mocked Supabase client, no live project needed)
```

## Configure it (needs the Supabase project first)

```bash
cp .env.example .env
```

Then fill in `.env` with the values from the Supabase dashboard
(Project Settings → API) for the **new `ace-studio` project**:

| Variable                 | Value                                         |
| ------------------------ | --------------------------------------------- |
| `VITE_SUPABASE_URL`      | Project URL, e.g. `https://<ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Publishable key                               |

Without these, the app shows "Supabase is not configured" and the login
form is disabled — it never crashes and never pretends anyone is logged in.

## What still needs Kenneth before it can be verified live

1. **Create the Supabase project** (`ace-studio`) in the Supabase
   dashboard — the Management API token returned 401, so this has to be
   done by hand. See `SUPABASE_SETUP.md` in the main app.
2. **Run the migration** `supabase/migrations/001_ace-studio_foundation.sql`
   in the SQL Editor (creates `profiles`, `jobs`, `app_settings`,
   `auth_attempts`, buckets, and all RLS policies).
3. **Sign up once** in the main app, then make Kenneth the first (and
   only) admin:
   ```sql
   update public.profiles set is_admin = true where email = 'kennethkalizibegoddynatus@gmail.com';
   ```
   Only ONE admin email ever — no second admin. Until that row is
   flipped, even Kenneth gets "This dashboard is for the creator only."
   (The dashboard also allowlists only his email in code — see the
   security note above — so the flag and the allowlist must agree. If
   his email ever changes, update both.)
4. Put the two `VITE_` values above in this app's `.env` (local) or in the
   hosting dashboard's environment variables (deployed). Never the
   service-role key.

## What the dashboard does

- **Login** (`src/pages/Login.tsx`) — email + password via
  `supabase.auth.signInWithPassword`, then the admin check. Non-admins are
  signed out immediately.
- **Overview** (`src/pages/Overview.tsx`) — jobs by status
  (queued / running / done / failed) across all users.
- **Users** (`src/pages/Users.tsx`) — table of profiles (email, phone,
  country + dial code, created at, admin yes/no), newest first, with a
  search box that searches by email or phone on the server and pages
  through results (25 per page). The count shown is the exact total
  from the database, not the number of rows loaded. Dates render in
  Africa/Lagos time.
- **App settings** (`src/pages/Settings.tsx`) — the "change things in the
  app" part: `signup_open` (on/off), `maintenance_mode` (on/off), and
  `announcement` (text + save, 500 characters max, enforced both in
  the form and when saving). Each save upserts the `app_settings` row
  through the client (RLS "app_settings: write for admins"), records
  who saved it, and shows a confirmation with the last-updated time
  as stored by the database.
- **Header** (in `src/pages/Dashboard.tsx`) — "Creator dashboard —
  Ace Studio", big user count + total jobs count, and a Log out
  button.

## Adding a new section

Kenneth will ask for more sections. The extension point is deliberately
visible — the nav has a "More sections — ask Kenneth" placeholder. To add
one:

1. **Create the page:** `src/pages/NewSection.tsx` — one file per section.
   It receives the Supabase client as a `client` prop (see
   `src/pages/Users.tsx` for the pattern: load data in `useEffect`, show
   a loading state, show the error from the database).
2. **Add it to the nav:** add one entry to the `SECTIONS` list in
   `src/components/Nav.tsx`, e.g.
   `{ id: "posts", label: "Posts", description: "…" }`, and add `"posts"`
   to the `SectionId` type in the same file.
3. **Wire it into the dashboard shell:** in `src/pages/Dashboard.tsx`,
   render it when its section is active:
   `{section === "posts" && <Posts client={client} />}`.
4. **Add RLS policies if it needs new data:** if the section reads or
   writes a table (or a new table), add a policy in a new migration in
   the main app's `supabase/migrations/` — e.g. admins can read all rows,
   users only their own. Never read a table through a key that bypasses
   RLS, and never rely on hiding a button as the only protection.
5. **Add a test** in `src/lib/admin.test.ts` (mocked client) for any new
   data logic, then run `bun run test`, `npx tsc --noEmit`, and
   `bun run build`.

## Files

```
creator-dashboard/
  package.json            name "ace-studio-creator-dashboard", private
  vite.config.ts          Vite + React, dev server on port 5174
  vitest.config.ts        vitest, node environment
  tsconfig.json           strict TypeScript
  index.html
  .env.example            variable names only, no values
  src/main.tsx            React entry point
  src/App.tsx             session restore (admin-only) -> Login | Dashboard
  src/index.css           plain dark CSS
  src/lib/supabase.ts     client from VITE_ vars, getSessionUser, signOut
  src/lib/admin.ts        admin gate, dashboard data, app-settings save (all via RLS)
  src/lib/format.ts       dates in Africa/Lagos
  src/lib/admin.test.ts   mocked-client tests for the gate + settings save
  src/lib/supabase.test.ts  mocked tests for the config rule + client singleton
  src/lib/format.test.ts  tests for the Lagos date formatting
  src/components/Nav.tsx  SECTIONS list + nav buttons
  src/pages/Login.tsx     email + password, admin check, not-configured state
  src/pages/Dashboard.tsx header (counts), nav, logout, section switch
  src/pages/Overview.tsx  jobs by status
  src/pages/Users.tsx     profiles table + search
  src/pages/Settings.tsx  signup_open / maintenance_mode / announcement
  src/pages/MoreSections.tsx  placeholder — "Tell Muse what to add here"
```

## Verification (local, no live project)

`bun run build` passes, `npx tsc --noEmit` is clean, `bun run test` passes
with a mocked Supabase client. Live verification (real login, real user
list, real settings save) still needs the Supabase project + first-admin
SQL above.
