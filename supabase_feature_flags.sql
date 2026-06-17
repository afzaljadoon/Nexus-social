-- =======================================================
-- Database Schema Migration: Feature Flags Table
-- =======================================================

-- 1. Create feature_flags table
create table if not exists public.feature_flags (
  key text primary key,
  is_enabled boolean default false not null,
  description text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone
);

-- Enable Row Level Security (RLS)
alter table public.feature_flags enable row level security;

-- 2. RLS Policies for feature_flags
-- Allow anyone (including guests and standard users) to view active feature flags
create policy "Allow public read access to feature_flags" on public.feature_flags
  for select using (true);

-- Allow only admins to manage (insert, update, delete) feature flags
create policy "Allow admins to manage feature_flags" on public.feature_flags
  for all using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );

-- 3. Enable Realtime Broadcasting
alter table public.feature_flags replica identity full;
alter publication supabase_realtime add table public.feature_flags;

-- 4. Seed default system feature flags
insert into public.feature_flags (key, is_enabled, description)
values 
  ('ai-comments', true, 'Enables OpenAI assistant suggest-reply buttons inside post comments.'),
  ('ai-draft-post', true, 'Enables OpenAI content generator assistant for drafting new posts.')
on conflict (key) do nothing;
