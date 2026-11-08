-- 002 — app_settings updated_at from the database clock.
--
-- Migration 001 attached the set_updated_at() trigger to profiles and
-- jobs but not to app_settings, so the creator dashboard's "Last
-- updated" was whatever the admin's device clock said when it saved —
-- a wrong clock wrote a wrong timestamp into the database. This
-- attaches the same trigger, so updated_at always comes from the
-- database clock. The dashboard no longer sends updated_at at all
-- (see creator-dashboard/src/lib/admin.ts saveAppSetting).
--
-- Safe to run more than once: drop trigger if exists, then create.

drop trigger if exists app_settings_set_updated_at on public.app_settings;
create trigger app_settings_set_updated_at
  before update on public.app_settings
  for each row execute function public.set_updated_at();
