-- 0020: user profiles (display name for the AI, avatar) + public avatars bucket.
-- Profile page: change password (auth API, no schema), avatar, AI display
-- name, own activity trail (activity_log already keyed by actor email).

create table profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  -- Either 'preset:<key>' (built-in colored initial) or a public storage URL.
  avatar       text,
  updated_at   timestamptz not null default now()
);

alter table profiles enable row level security;
-- Any signed-in user may read profiles (names/avatars appear in shared
-- surfaces such as the digest audience); only the owner writes their row.
create policy "read profiles"       on profiles for select to authenticated using (true);
create policy "insert own profile"  on profiles for insert to authenticated with check (auth.uid() = user_id);
create policy "update own profile"  on profiles for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Public bucket for uploaded avatar images. Uploads go through the
-- service-role server action (size/type validated there); public read is
-- what lets the header <img> load without signed URLs.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "avatars public read" on storage.objects
  for select using (bucket_id = 'avatars');
