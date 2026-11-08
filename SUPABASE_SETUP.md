# Ace Studio — Supabase setup (Phase A)

The backend is Supabase: Postgres database + login (Supabase Auth) + file
storage. No Cloudflare. No hand-rolled password code — Supabase Auth
hashes passwords with bcrypt.

## What Kenneth needs to do (about 10 minutes, in the Supabase dashboard)

1. **Create a NEW Supabase project for Ace Studio** — do NOT reuse the
   Mochris test project. https://supabase.com/dashboard → New project →
   name it `ace-studio`, pick any region, set a strong database
   password and keep it somewhere safe (a password manager, not chat).
   Free tier is enough to start.
2. **Run the database setup**: in the new project, open SQL Editor →
   New query → paste the whole file
   `supabase/migrations/001_ace-studio_foundation.sql` → Run. It creates
   the `profiles`, `jobs`, `app_settings` and `auth_attempts` tables,
   turns on Row Level Security everywhere, and creates the `avatars`
   and `job-outputs` storage buckets with their rules.
3. **Copy three values** from Project Settings → API:
   - Project URL → `SUPABASE_URL`
   - Publishable key → `SUPABASE_ANON_KEY`
   - Secret key → `SUPABASE_SERVICE_ROLE_KEY` (server only — never paste
     it in chat, never put it in the website, never put it on GitHub).
4. **Put them in the app**:
   - Local testing: copy `.env.example` to `.dev.vars` and fill the
     three values in. (`.dev.vars` is gitignored — it never leaves this
     machine.)
   - Production: set the same three names as secrets in the hosting
     dashboard (Vercel → Settings → Environment Variables).
5. **Make Kenneth the first (and only) admin** (so the creator dashboard lets him
   in). After he signs up once in the app, run this in the SQL Editor:
   ```sql
   update public.profiles set is_admin = true where email = 'kennethkalizibegoddynatus@gmail.com';
   ```
   Only ONE admin email ever — no second admin. The creator dashboard
   also allowlists only this one email in code (`CREATOR_ADMIN_EMAIL`
   in `creator-dashboard/src/lib/admin.ts`, overridable with
   `VITE_CREATOR_ADMIN_EMAIL`), so the flag and the allowlist must
   agree: if his email ever changes, update both.
6. **Forgot-password emails**: Supabase sends the reset email. For the
   email to carry a **6-digit code** instead of a link, go to
   Authentication → Email Templates → "Reset Password" and change the
   template to use `{{ .Token }}` (the code) instead of the link. If
   this step is skipped, the reset link still works — the reset page
   accepts both the code and the link.
7. **Check it worked**: start the app, sign up, and the profile row
   should appear in Table Editor → profiles. Log in as a second user and
   confirm each user only sees their own jobs.

## What is already built (no project needed yet)

- `src/lib/supabase/env.ts` — reads the three values from env / `.dev.vars`.
- `src/lib/supabase/client.ts` — public client (publishable key), service
  client (secret key, server only, throws in a browser), per-user client
  (acts as one user, so RLS sees their identity).
- `src/lib/supabase/job-store.ts` — the jobs system on Postgres + Storage,
  behind the same `JobStore` interface as the local file store. A job is
  refused without an owner; anonymous demo jobs keep using the file store.
- `src/lib/supabase/rate-limit-store.ts` — the 3-strikes lockout rows in
  the database, so a lockout survives a restart.
- `supabase/migrations/001_ace-studio_foundation.sql` — the whole schema.
- `.env.example` — every variable name, no values (the only template).

## What the app does when Supabase is NOT configured yet

Auth pages and the Supabase job store answer with a clear
"Supabase is not configured" message (HTTP 503). The demo parts of the
app (demo jobs, mock narration) keep working. Nothing crashes, and no
fake "logged in" state is ever shown.

## Costs

Supabase free tier: 500 MB database, 1 GB file storage, 50,000 monthly
active users, 2 GB bandwidth. Nothing in this build needs a paid plan.
