-- Ace Studio — Supabase foundation (Phase A)
-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
-- Project: create a NEW Supabase project for Ace Studio (do NOT reuse the
-- Mochris test project). Free tier is enough to start.
--
-- What this creates, in plain words:
--   profiles      one row per user (email, phone, country, avatar, admin flag)
--   jobs          one row per video/voice job, owned by one user
--   app_settings  key/value switches the creator dashboard can change
--   auth_attempts login-attempt counts, for the 3-strikes IP lockout
--   buckets       avatars (public) and job-outputs (private)
-- Row Level Security (RLS) is ON for every table: by default NOBODY can
-- read a row. Each policy below opens exactly one door, for the right
-- person only. Users see only their own data; admins see all.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto;

-- Keep updated_at fresh on every edit.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Nobody except the creator may change the admin flag. The
-- "profiles: update own" policy below only restricts WHICH row a user can
-- touch — without this trigger, ANY signed-in user could run
-- `update profiles set is_admin = true where id = auth.uid()` through the
-- API and become an admin, then read every user and change app settings.
-- The trigger runs as the table owner, so current_user tells us who is
-- really acting: 'postgres' in the SQL Editor, 'service_role' for the
-- server's secret key, 'authenticated' for a signed-in user. The first
-- admin is still made the documented way (SQL Editor as postgres).
create or replace function public.prevent_is_admin_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.is_admin is true and current_user not in ('postgres', 'service_role') then
      raise exception 'is_admin can only be set by the creator (SQL Editor).';
    end if;
    return new;
  end if;
  -- UPDATE: the flag must not change at all for ordinary users.
  if new.is_admin is distinct from old.is_admin
     and current_user not in ('postgres', 'service_role') then
    raise exception 'is_admin can only be changed by the creator (SQL Editor).';
  end if;
  return new;
end;
$$;

-- The trigger itself is attached below, after the profiles table exists.

-- ---------------------------------------------------------------------------
-- profiles — one row per user, linked to Supabase Auth (auth.users)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  phone text,
  country text,
  dial_code text,
  avatar_url text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_email_idx on public.profiles (email);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- The admin-flag guard (function defined in the Helpers section above).
drop trigger if exists profiles_guard_is_admin on public.profiles;
create trigger profiles_guard_is_admin
  before insert or update on public.profiles
  for each row execute function public.prevent_is_admin_change();

-- Is the signed-in user an admin? SECURITY DEFINER so policies can call it
-- without tripping over RLS on profiles itself.
-- NOTE: this must be created AFTER the profiles table above — a
-- language-sql function body is checked when it is created, so the
-- table has to exist first.
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_admin = true
  );
$$;

alter table public.profiles enable row level security;

drop policy if exists "profiles: read own or admin" on public.profiles;
create policy "profiles: read own or admin"
  on public.profiles for select
  using (auth.uid() = id or public.is_admin());

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "profiles: insert own" on public.profiles;
create policy "profiles: insert own"
  on public.profiles for insert
  with check (auth.uid() = id);

-- No delete policy: nobody can delete a profile through the API.

-- When a user signs up in Supabase Auth, create their profile row
-- automatically from the details they gave at signup (phone, country,
-- dial code). The trigger runs as the database owner, so RLS does not
-- block it.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, phone, country, dial_code)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    nullif(new.raw_user_meta_data ->> 'country', ''),
    nullif(new.raw_user_meta_data ->> 'dial_code', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- jobs — one row per job (narration, video, post). Owned by one user.
-- ---------------------------------------------------------------------------
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('demo', 'narration', 'video', 'post')),
  label text not null default '',
  status text not null default 'queued'
    check (status in ('queued', 'running', 'done', 'failed')),
  progress integer not null default 0 check (progress between 0 and 100),
  detail text,
  error text,
  mock boolean not null default false,
  output_filename text,
  output_content_type text,
  output_bytes bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists jobs_user_created_idx
  on public.jobs (user_id, created_at desc);

drop trigger if exists jobs_set_updated_at on public.jobs;
create trigger jobs_set_updated_at
  before update on public.jobs
  for each row execute function public.set_updated_at();

alter table public.jobs enable row level security;

-- One policy for all operations: you can only touch your own jobs,
-- unless you are an admin (the creator dashboard).
drop policy if exists "jobs: owner or admin" on public.jobs;
create policy "jobs: owner or admin"
  on public.jobs for all
  using (auth.uid() = user_id or public.is_admin())
  with check (auth.uid() = user_id or public.is_admin());

-- ---------------------------------------------------------------------------
-- app_settings — switches the creator dashboard changes (key/value).
-- The app reads them; only admins can write them.
-- ---------------------------------------------------------------------------
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

alter table public.app_settings enable row level security;

drop policy if exists "app_settings: read for signed-in users" on public.app_settings;
create policy "app_settings: read for signed-in users"
  on public.app_settings for select
  using (auth.role() = 'authenticated');

drop policy if exists "app_settings: write for admins" on public.app_settings;
create policy "app_settings: write for admins"
  on public.app_settings for all
  using (public.is_admin())
  with check (public.is_admin());

-- Defaults: signups open, maintenance off. The dashboard can change these.
insert into public.app_settings (key, value) values
  ('signup_open', 'true'::jsonb),
  ('maintenance_mode', 'false'::jsonb),
  ('announcement', '""'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- auth_attempts — login-attempt counts for the 3-strikes IP lockout.
-- Holds SHA-256 hashes of IPs, never raw addresses. RLS is ON with NO
-- policies, so only the service key (server) can read or write it.
-- ---------------------------------------------------------------------------
create table if not exists public.auth_attempts (
  key text primary key,
  attempts integer not null default 0,
  locked_until timestamptz,
  window_start timestamptz not null default now()
);

-- Old rows are deleted by the app (best-effort) when a new attempt is
-- recorded, so this table does not grow forever.
create index if not exists auth_attempts_window_start_idx
  on public.auth_attempts (window_start);

alter table public.auth_attempts enable row level security;

-- ---------------------------------------------------------------------------
-- Storage buckets + policies
--   avatars      public read; each user writes only under their own id
--   job-outputs  private; each user reads/writes only their own jobs
-- Files are stored at <user_id>/... or jobs/<job_id>/... — the folder name
-- IS the owner check, so a user cannot guess another user's path and win.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values
  ('avatars', 'avatars', true),
  ('job-outputs', 'job-outputs', false)
on conflict (id) do nothing;

-- avatars: anyone can view a profile picture.
drop policy if exists "avatars: public read" on storage.objects;
create policy "avatars: public read"
  on storage.objects for select
  using (bucket_id = 'avatars');

-- avatars: signed-in users write only inside their own folder.
drop policy if exists "avatars: owner write" on storage.objects;
create policy "avatars: owner write"
  on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars: owner update" on storage.objects;
create policy "avatars: owner update"
  on storage.objects for update
  using (
    bucket_id = 'avatars'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars: owner delete" on storage.objects;
create policy "avatars: owner delete"
  on storage.objects for delete
  using (
    bucket_id = 'avatars'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- job-outputs: private bucket. Files live at <user_id>/jobs/<job_id>/...
-- so the first folder IS the owner check: a signed-in user can only
-- touch their own folder. Admin reads go through the API with the
-- service key, which bypasses RLS by design.
drop policy if exists "job-outputs: owner all" on storage.objects;
create policy "job-outputs: owner all"
  on storage.objects for all
  using (
    bucket_id = 'job-outputs'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'job-outputs'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
