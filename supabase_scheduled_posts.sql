-- =======================================================
-- Database Schema Migration: Scheduled Posts
-- =======================================================

-- 1. Add scheduling columns to public.posts
alter table public.posts add column if not exists is_published boolean default true not null;
alter table public.posts add column if not exists published_at timestamp with time zone default timezone('utc'::text, now()) not null;

-- Enable Row Level Security (RLS) on posts
alter table public.posts enable row level security;

-- 2. Adjust RLS select policy for posts
-- Allow reading a post if:
--   a) The post is active (deleted_at is null), published (is_published = true), and the publication date has passed (published_at <= now())
--   b) The reading user is the author of the post (auth.uid() = user_id)
--   c) The reading user is an admin or moderator (can view draft or future-scheduled posts for moderation)
drop policy if exists "Allow read access to active posts" on public.posts;

create policy "Allow read access to active posts" on public.posts
  for select using (
    (deleted_at is null and is_published = true and published_at <= now())
    or auth.uid() = user_id 
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'moderator')
    )
  );

-- 3. Optimize Activity Feed Trigger to prevent premature feed leakage
-- Re-registers the trigger to log posts only when they actually transition to published status.
drop trigger if exists tr_post_creation_activity on public.posts;

create or replace function public.log_post_creation_activity()
returns trigger as $$
declare
  v_full_name text;
begin
  if (new.is_published = true and (TG_OP = 'INSERT' or old.is_published = false)) then
    select full_name into v_full_name from public.profiles where id = new.user_id;
    
    insert into public.activities (actor_id, action_type, target_id, description, metadata)
    values (
      new.user_id,
      'post.create',
      new.id::text,
      coalesce(v_full_name, 'A user') || ' published a new post: "' || substring(new.title from 1 for 50) || '"',
      jsonb_build_object('post_id', new.id, 'title', new.title)
    );
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger tr_post_creation_activity
  after insert or update on public.posts
  for each row execute procedure public.log_post_creation_activity();


-- 4. Enable database extensions for background HTTP scheduling
create extension if not exists pg_net;
create extension if not exists pg_cron with schema pg_catalog;

-- 5. Setup pg_cron Job calling our Edge Function
-- Runs every minute to publish any pending/due scheduled posts.
-- Note: Replace project reference 'vqveotmyoddqybjohgmw' if your project reference differs.
select cron.unschedule(jobid) from cron.job where jobname = 'publish-scheduled-posts';
select cron.schedule(
  'publish-scheduled-posts',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://vqveotmyoddqybjohgmw.supabase.co/functions/v1/publish-posts',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZxdmVvdG15b2RkcXliam9oZ213Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExNTY5MjgsImV4cCI6MjA5NjczMjkyOH0.0TpGOCHZ5M04RfGoa_bSKc1tVEbGPtgZuubSChi2ngg"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
