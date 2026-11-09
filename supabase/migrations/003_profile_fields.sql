-- Ace Studio — Profile fields (Phase: Profile page)
-- Adds display_name, username and bio to public.profiles.
--   display_name  what the Profile page shows (falls back to the email
--                 prefix when empty); at most 50 characters.
--   username      the @handle on the Profile page; lowercase letters,
--                 numbers and underscores, 3–30 characters, unique
--                 across all users (NULL means "not set yet").
--   bio           a short line about the user; at most 160 characters.
--
-- Safety: the existing "profiles: update own" policy already limits a
-- signed-in user to their own row, and the prevent_is_admin_change()
-- trigger still guards is_admin. The CHECKs below are the second lock:
-- even a direct API write cannot store a too-long or oddly-shaped
-- value. All three columns allow NULL, so every existing row stays
-- valid and the profile page simply shows the fallbacks until a user
-- fills them in.
alter table public.profiles
  add column if not exists display_name text
    check (display_name is null or char_length(display_name) <= 50),
  add column if not exists username text
    check (username is null or username ~ '^[a-z0-9_]{3,30}$'),
  add column if not exists bio text
    check (bio is null or char_length(bio) <= 160);

-- One username per user: a partial unique index (NULLs do not clash,
-- so many users can all have "no username yet").
create unique index if not exists profiles_username_unique_idx
  on public.profiles (username)
  where username is not null;
