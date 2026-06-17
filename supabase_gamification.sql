-- =======================================================
-- Database Schema Migration: Reputation & Gamification
-- =======================================================

-- 1. Add reputation_points column to public.profiles table
alter table public.profiles add column if not exists reputation_points integer default 0 not null;

-- 2. Create badges table
create table if not exists public.badges (
  id text primary key,
  name text not null,
  description text not null,
  icon text not null,
  points_required integer default 0 not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS on badges
alter table public.badges enable row level security;

-- Allow read access to badges for everyone
create policy "Allow public read access to badges" on public.badges
  for select using (true);

-- 3. Create user_badges table
create table if not exists public.user_badges (
  user_id uuid references public.profiles(id) on delete cascade not null,
  badge_id text references public.badges(id) on delete cascade not null,
  awarded_at timestamp with time zone default timezone('utc'::text, now()) not null,
  primary key (user_id, badge_id)
);

-- Enable RLS on user_badges
alter table public.user_badges enable row level security;

-- Allow read access to user_badges for everyone
create policy "Allow public read access to user_badges" on public.user_badges
  for select using (true);

-- Configure Replica Identity to FULL for Realtime support
alter table public.user_badges replica identity full;

-- Enable Realtime Broadcasting
alter publication supabase_realtime add table public.user_badges;

-- 4. Seed initial badges definitions
insert into public.badges (id, name, description, icon, points_required)
values 
  ('first_post', 'First Post', 'Publish your first post to start sharing.', 'FiPlusCircle', 0),
  ('chatterbox', 'Chatterbox', 'Leave at least 5 comments on community posts.', 'FiMessageSquare', 0),
  ('popular', 'Super Popular', 'Receive at least 10 likes from other users.', 'FiHeart', 0),
  ('influencer', 'Nexus Influencer', 'Reach 100 reputation points on the platform.', 'FiAward', 100)
on conflict (id) do update 
set name = excluded.name, 
    description = excluded.description, 
    icon = excluded.icon, 
    points_required = excluded.points_required;

-- 5. Create Badge Checking Function
create or replace function public.check_user_badges(target_user_id uuid)
returns void as $$
declare
  post_count integer;
  comment_count integer;
  like_count integer;
  rep_points integer;
begin
  -- Get stats
  select count(*) into post_count from public.posts where user_id = target_user_id and deleted_at is null;
  select count(*) into comment_count from public.comments where user_id = target_user_id;
  select count(*) into like_count from public.likes l join public.posts p on l.post_id = p.id where p.user_id = target_user_id;
  select reputation_points into rep_points from public.profiles where id = target_user_id;

  -- First Post Badge
  if post_count >= 1 then
    insert into public.user_badges (user_id, badge_id)
    values (target_user_id, 'first_post')
    on conflict do nothing;
  end if;

  -- Chatterbox Badge
  if comment_count >= 5 then
    insert into public.user_badges (user_id, badge_id)
    values (target_user_id, 'chatterbox')
    on conflict do nothing;
  end if;

  -- Popular Badge
  if like_count >= 10 then
    insert into public.user_badges (user_id, badge_id)
    values (target_user_id, 'popular')
    on conflict do nothing;
  end if;

  -- Influencer Badge
  if rep_points >= 100 then
    insert into public.user_badges (user_id, badge_id)
    values (target_user_id, 'influencer')
    on conflict do nothing;
  end if;
end;
$$ language plpgsql security definer;

-- 6. Trigger for Post Reputation
create or replace function public.handle_post_reputation()
returns trigger as $$
begin
  if tg_op = 'INSERT' then
    update public.profiles set reputation_points = reputation_points + 10 where id = new.user_id;
    perform public.check_user_badges(new.user_id);
    return new;
  elsif tg_op = 'DELETE' then
    update public.profiles set reputation_points = greatest(0, reputation_points - 10) where id = old.user_id;
    perform public.check_user_badges(old.user_id);
    return old;
  end if;
  return null;
end;
$$ language plpgsql security definer;

drop trigger if exists on_post_reputation on public.posts;
create trigger on_post_reputation
  after insert or delete on public.posts
  for each row execute procedure public.handle_post_reputation();

-- 7. Trigger for Comment Reputation
create or replace function public.handle_comment_reputation()
returns trigger as $$
begin
  if tg_op = 'INSERT' then
    update public.profiles set reputation_points = reputation_points + 5 where id = new.user_id;
    perform public.check_user_badges(new.user_id);
    return new;
  elsif tg_op = 'DELETE' then
    update public.profiles set reputation_points = greatest(0, reputation_points - 5) where id = old.user_id;
    perform public.check_user_badges(old.user_id);
    return old;
  end if;
  return null;
end;
$$ language plpgsql security definer;

drop trigger if exists on_comment_reputation on public.comments;
create trigger on_comment_reputation
  after insert or delete on public.comments
  for each row execute procedure public.handle_comment_reputation();

-- 8. Trigger for Likes Reputation (Awards post author)
create or replace function public.handle_like_reputation()
returns trigger as $$
declare
  post_author_id uuid;
begin
  if tg_op = 'INSERT' then
    select user_id into post_author_id from public.posts where id = new.post_id;
    if post_author_id is not null then
      update public.profiles set reputation_points = reputation_points + 5 where id = post_author_id;
      perform public.check_user_badges(post_author_id);
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    select user_id into post_author_id from public.posts where id = old.post_id;
    if post_author_id is not null then
      update public.profiles set reputation_points = greatest(0, reputation_points - 5) where id = post_author_id;
      perform public.check_user_badges(post_author_id);
    end if;
    return old;
  end if;
  return null;
end;
$$ language plpgsql security definer;

drop trigger if exists on_like_reputation on public.likes;
create trigger on_like_reputation
  after insert or delete on public.likes
  for each row execute procedure public.handle_like_reputation();

-- 9. Trigger for Follows Reputation
create or replace function public.handle_follow_reputation()
returns trigger as $$
begin
  if tg_op = 'INSERT' then
    update public.profiles set reputation_points = reputation_points + 2 where id = new.follower_id;
    perform public.check_user_badges(new.follower_id);
    return new;
  elsif tg_op = 'DELETE' then
    update public.profiles set reputation_points = greatest(0, reputation_points - 2) where id = old.follower_id;
    perform public.check_user_badges(old.follower_id);
    return old;
  end if;
  return null;
end;
$$ language plpgsql security definer;

drop trigger if exists on_follow_reputation on public.follows;
create trigger on_follow_reputation
  after insert or delete on public.follows
  for each row execute procedure public.handle_follow_reputation();
