-- =======================================================
-- Database Schema Migration: Advanced Full-Text Search
-- Run this ENTIRE script in Supabase SQL Editor
-- =======================================================

-- -------------------------------------------------------
-- STEP 1: Add tags column to public.posts (safe, idempotent)
-- -------------------------------------------------------
alter table public.posts add column if not exists tags text[] default '{}'::text[];

-- -------------------------------------------------------
-- STEP 2: Populate default tags for existing posts that have none
-- -------------------------------------------------------
update public.posts
set tags = array['general']
where tags is null or tags = '{}'::text[];

-- -------------------------------------------------------
-- STEP 3: Add plain fts tsvector column (NOT a generated column)
-- NOTE: Generated columns fail with ERROR 42P17 because
-- array_to_string() is not strictly IMMUTABLE in Postgres.
-- We use a trigger-based approach instead.
-- -------------------------------------------------------
alter table public.posts add column if not exists fts tsvector;

-- -------------------------------------------------------
-- STEP 4: Create IMMUTABLE helper function for FTS vector
-- Must be IMMUTABLE so it can be used in GIN index expressions.
-- -------------------------------------------------------
create or replace function public.posts_fts_vector(
  p_title   text,
  p_content text,
  p_tags    text[]
)
returns tsvector
language sql
immutable
as $$
  select to_tsvector('english',
    coalesce(p_title, '') || ' ' ||
    coalesce(p_content, '') || ' ' ||
    coalesce(array_to_string(p_tags, ' '), '')
  );
$$;

-- -------------------------------------------------------
-- STEP 5: FULL backfill — update fts for ALL existing rows
-- This fixes posts that were inserted before the trigger existed,
-- and posts whose fts is still NULL after previous failed migrations.
-- -------------------------------------------------------
update public.posts
set fts = public.posts_fts_vector(title, content, tags);

-- Verify the backfill worked (check count of rows with fts populated)
-- SELECT count(*) FROM public.posts WHERE fts IS NOT NULL;

-- -------------------------------------------------------
-- STEP 6: Create trigger function to auto-update fts on INSERT/UPDATE
-- -------------------------------------------------------
create or replace function public.posts_fts_trigger()
returns trigger
language plpgsql
as $$
begin
  new.fts := public.posts_fts_vector(new.title, new.content, new.tags);
  return new;
end;
$$;

-- -------------------------------------------------------
-- STEP 7: Attach trigger to posts table (idempotent via DROP IF EXISTS)
-- -------------------------------------------------------
drop trigger if exists trg_posts_fts on public.posts;
create trigger trg_posts_fts
  before insert or update of title, content, tags
  on public.posts
  for each row
  execute function public.posts_fts_trigger();

-- -------------------------------------------------------
-- STEP 8: Create GIN index for fast FTS queries
-- -------------------------------------------------------
drop index if exists idx_posts_fts;
create index idx_posts_fts on public.posts using gin(fts);

-- -------------------------------------------------------
-- STEP 9: Create GIN index on tags for fast tag-contains queries
-- -------------------------------------------------------
create index if not exists idx_posts_tags on public.posts using gin(tags);

-- -------------------------------------------------------
-- STEP 10: Grant execute permissions on helper functions
-- -------------------------------------------------------
grant execute on function public.posts_fts_vector(text, text, text[]) to authenticated, anon;
grant execute on function public.posts_fts_trigger() to authenticated, anon;

-- -------------------------------------------------------
-- STEP 11: Drop old version of the search RPC if it exists
-- -------------------------------------------------------
drop function if exists public.search_posts_advanced(
  text, text[], uuid, boolean, text, uuid, uuid[], integer, integer
);

-- -------------------------------------------------------
-- STEP 12: Create search RPC function
-- Features: FTS ranking (ts_rank_cd), tag filtering (@>),
--           feed type filtering, soft-delete support, pagination
-- -------------------------------------------------------
create or replace function public.search_posts_advanced(
  p_query          text      default '',
  p_tags           text[]    default null,
  p_org_id         uuid      default null,
  p_show_trash     boolean   default false,
  p_feed_type      text      default 'all',
  p_user_id        uuid      default null,
  p_following_ids  uuid[]    default null,
  p_limit          integer   default 10,
  p_offset         integer   default 0
)
returns table (
  id              bigint,
  title           text,
  content         text,
  created_at      timestamp with time zone,
  updated_at      timestamp with time zone,
  deleted_at      timestamp with time zone,
  published_at    timestamp with time zone,
  is_published    boolean,
  user_id         uuid,
  organization_id uuid,
  tags            text[],
  relevance       real,
  profiles        jsonb,
  likes           jsonb,
  bookmarks       jsonb
)
language plpgsql
security invoker
stable
as $$
declare
  v_tsquery tsquery;
begin
  -- Build tsquery once (null if no search term provided)
  if p_query is not null and trim(p_query) <> '' then
    v_tsquery := websearch_to_tsquery('english', trim(p_query));
  end if;

  return query
  select
    p.id,
    p.title,
    p.content,
    p.created_at,
    p.updated_at,
    p.deleted_at,
    p.published_at,
    p.is_published,
    p.user_id,
    p.organization_id,
    p.tags,

    -- Relevance score: 0 when no search term, ts_rank_cd otherwise
    case
      when v_tsquery is null then 0::real
      when p.fts is null     then 0::real
      else ts_rank_cd(p.fts, v_tsquery)
    end as relevance,

    -- Author profile
    jsonb_build_object(
      'full_name',  pr.full_name,
      'avatar_url', pr.avatar_url,
      'last_seen',  pr.last_seen
    ) as profiles,

    -- Likes aggregation
    coalesce(
      (select jsonb_agg(jsonb_build_object('user_id', l.user_id))
       from public.likes l
       where l.post_id = p.id),
      '[]'::jsonb
    ) as likes,

    -- Bookmarks aggregation
    coalesce(
      (select jsonb_agg(jsonb_build_object('user_id', b.user_id))
       from public.bookmarks b
       where b.post_id = p.id),
      '[]'::jsonb
    ) as bookmarks

  from public.posts p
  left join public.profiles pr on p.user_id = pr.id
  where
    -- 1. Tenant isolation (skip if no org provided)
    (p_org_id is null or p.organization_id = p_org_id)

    -- 2. Soft-delete logic
    and (
      (p_show_trash = true  and p.deleted_at is not null and p.user_id = p_user_id)
      or (p_show_trash = false and p.deleted_at is null)
    )

    -- 3. Publication visibility (skip check when viewing trash)
    and (
      p_show_trash = true
      or (p.is_published = true and p.published_at <= now())
    )

    -- 4. Feed type filtering
    and (
      p_feed_type = 'all'
      or p_feed_type != 'following'
      or p_following_ids is null
      or p.user_id = any(p_following_ids)
    )

    -- 5. Full-text search (skip filter if no query; handle null fts gracefully)
    and (
      v_tsquery is null
      or (p.fts is not null and p.fts @@ v_tsquery)
    )

    -- 6. Tag filtering (skip if no tags selected)
    and (
      p_tags is null
      or cardinality(p_tags) = 0
      or p.tags @> p_tags
    )

  order by
    -- Sort by relevance when searching, otherwise by newest first
    case
      when v_tsquery is null then 0::real
      when p.fts is null     then 0::real
      else ts_rank_cd(p.fts, v_tsquery)
    end desc,
    p.created_at desc

  limit  p_limit
  offset p_offset;
end;
$$;

-- -------------------------------------------------------
-- STEP 13: Grant execute on search function
-- -------------------------------------------------------
grant execute on function public.search_posts_advanced(
  text, text[], uuid, boolean, text, uuid, uuid[], integer, integer
) to authenticated, anon;

-- -------------------------------------------------------
-- QUICK TEST (uncomment to verify search is working):
-- SELECT id, title, tags, relevance
-- FROM search_posts_advanced(p_query => 'innovation', p_limit => 5);
-- -------------------------------------------------------
