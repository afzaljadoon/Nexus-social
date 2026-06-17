-- =======================================================
-- Database Schema Migration: Soft Delete Architecture
-- =======================================================

-- 1. Add deleted_at column to public.posts
alter table public.posts add column if not exists deleted_at timestamp with time zone;

-- Enable Row Level Security (RLS) on posts
alter table public.posts enable row level security;

-- 2. Adjust RLS select policy for posts
-- Allow reading a post if:
--   a) The post is active (deleted_at is null)
--   b) The reading user is the author of the post (auth.uid() = user_id)
--   c) The reading user is an admin or moderator (can view soft-deleted posts for audit purposes)
drop policy if exists "Allow public read access to posts" on public.posts;
drop policy if exists "Allow read access to active posts" on public.posts;

create policy "Allow read access to active posts" on public.posts
  for select using (
    deleted_at is null 
    or auth.uid() = user_id 
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'moderator')
    )
  );

-- =======================================================
-- Architectural Rationale: Soft Deletes vs Hard Deletes
-- =======================================================
--
-- 1. Data Retention & Compliance (e.g. GDPR, HIPAA, SOC 2):
--    Keeping deleted rows in the database simplifies compliance audits, allows tracking
--    who deleted content, and provides verification logs.
--
-- 2. Accidental Deletion Recovery:
--    Restoring soft-deleted rows is a simple "update" query. No complex database backups or
--    point-in-time recoveries are required to restore user content.
--
-- 3. Data Analytics & AI Integrity:
--    Hard deletes disrupt historical statistics (like engagement logs or post frequencies).
--    Soft deletion retains full referential metrics for ML training and dashboard analytics.
--
-- 4. Schema Relationship Preservation:
--    Using "on delete cascade" on related tables (like comments or likes) destroys user interactions.
--    Soft deleting a post hides it from the UI while keeping the associated interactions intact.
