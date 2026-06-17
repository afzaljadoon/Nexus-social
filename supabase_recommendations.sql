-- =========================================================
-- Recommendation Engine: Database Layer
-- Run in Supabase SQL Editor
-- =========================================================

-- ---------------------------------------------------------
-- HELPER: get_user_interests
-- Returns the top N interest tags for a given user, derived
-- from tags on posts they have liked and bookmarked.
-- ---------------------------------------------------------
create or replace function public.get_user_interests(
  p_user_id uuid,
  p_limit   integer default 10
)
returns table (tag text, frequency bigint)
language sql
stable
security invoker
as $$
  select tag, count(*) as frequency
  from (
    -- Tags from posts the user liked
    select unnest(p.tags) as tag
    from public.likes     l
    join  public.posts    p  on p.id = l.post_id
    where l.user_id = p_user_id
      and p.deleted_at is null

    union all

    -- Tags from posts the user bookmarked
    select unnest(p2.tags) as tag
    from public.bookmarks  b
    join  public.posts     p2 on p2.id = b.post_id
    where b.user_id = p_user_id
      and p2.deleted_at is null
  ) interest_signals
  group by tag
  order by frequency desc
  limit p_limit;
$$;

grant execute on function public.get_user_interests(uuid, integer) to authenticated;

-- ---------------------------------------------------------
-- MAIN: get_recommended_posts
--
-- Scoring signals (combined, then multiplied by recency):
--   follow_signal   (+3.0)   author is followed by user
--   tag_affinity    (+2.0×n) n tags matching user's interest profile
--   popularity      (+0.1×n) total likes on the post
--   quality         (+0.3×n) total bookmarks on the post
--   recency_decay   (×exp)   exponential decay, halves every ~7 days
--
-- Exclusions:
--   - User's own posts
--   - Posts the user already liked
--   - Soft-deleted or unpublished posts
-- ---------------------------------------------------------
drop function if exists public.get_recommended_posts(uuid, uuid, integer, integer);

create or replace function public.get_recommended_posts(
  p_user_id  uuid,
  p_org_id   uuid    default null,
  p_limit    integer default 10,
  p_offset   integer default 0
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
  post_user_id    uuid,         -- renamed to avoid ambiguity with profiles.user_id
  organization_id uuid,
  tags            text[],
  score           real,
  reasons         text[],
  profiles        jsonb,
  likes           jsonb,
  bookmarks       jsonb
)
language plpgsql
security invoker
stable
as $$
declare
  v_interest_tags text[];
  v_followed_ids  uuid[];
begin
  -- 1. Build the user's interest tag vector (top 10 tags from engagement history)
  select array_agg(gi.tag)
  into v_interest_tags
  from public.get_user_interests(p_user_id, 10) gi;

  -- Default to empty array if no interests yet
  if v_interest_tags is null then
    v_interest_tags := '{}'::text[];
  end if;

  -- 2. Collect the IDs of users this person follows
  select array_agg(f.following_id)
  into v_followed_ids
  from public.follows f
  where f.follower_id = p_user_id;

  if v_followed_ids is null then
    v_followed_ids := '{}'::uuid[];
  end if;

  -- 3. Score, filter, and rank candidate posts
  return query
  with
  -- Posts already liked by requesting user (excluded from recommendations)
  already_liked as (
    select l.post_id
    from public.likes l
    where l.user_id = p_user_id
  ),
  -- Aggregate like counts per post
  like_counts as (
    select l2.post_id, count(*)::real as cnt
    from public.likes l2
    group by l2.post_id
  ),
  -- Aggregate bookmark counts per post
  bookmark_counts as (
    select bk.post_id, count(*)::real as cnt
    from public.bookmarks bk
    group by bk.post_id
  ),
  -- Core scoring CTE — all columns fully qualified with alias p
  scored as (
    select
      p.id                as post_id,
      p.title             as post_title,
      p.content           as post_content,
      p.created_at        as post_created_at,
      p.updated_at        as post_updated_at,
      p.deleted_at        as post_deleted_at,
      p.published_at      as post_published_at,
      p.is_published      as post_is_published,
      p.user_id           as author_user_id,
      p.organization_id   as post_org_id,
      p.tags              as post_tags,

      -- === SIGNAL: Follow affinity ===
      case
        when p.user_id = any(v_followed_ids) then 3.0::real
        else 0.0::real
      end as follow_score,

      -- === SIGNAL: Tag affinity (2.0 per matching interest tag) ===
      (
        select count(*)::real
        from unnest(p.tags) pt(itag)
        where pt.itag = any(v_interest_tags)
      ) * 2.0 as tag_score,

      -- === SIGNAL: Popularity (0.1 per like) ===
      coalesce(lc.cnt, 0.0) * 0.1 as pop_score,

      -- === SIGNAL: Quality (0.3 per bookmark) ===
      coalesce(bc.cnt, 0.0) * 0.3 as quality_score,

      -- === RECENCY DECAY: e^(-0.1 * age_in_days) ===
      -- ~100% at 0 days old, ~50% at 7 days, ~14% at 20 days
      exp(
        -0.1 * extract(epoch from (now() - p.created_at)) / 86400.0
      )::real as recency,

      -- Matched interest tags (for reason chips — up to 3)
      array(
        select pt2.itag
        from unnest(p.tags) pt2(itag)
        where pt2.itag = any(v_interest_tags)
        limit 3
      ) as matched_tags,

      -- Raw like count (used for the "popular" threshold chip)
      coalesce(lc.cnt, 0.0) as raw_like_count

    from public.posts p
    left join like_counts     lc on lc.post_id = p.id
    left join bookmark_counts bc on bc.post_id = p.id
    where
      p.deleted_at  is null
      and p.is_published = true
      and p.published_at <= now()
      -- Exclude requesting user's own posts
      and p.user_id != p_user_id
      -- Exclude posts already liked by this user
      and p.id not in (select al.post_id from already_liked al)
      -- Optional tenant scoping
      and (p_org_id is null or p.organization_id = p_org_id)
  )
  -- Final select — map renamed columns back to expected return shape
  select
    s.post_id               as id,
    s.post_title            as title,
    s.post_content          as content,
    s.post_created_at       as created_at,
    s.post_updated_at       as updated_at,
    s.post_deleted_at       as deleted_at,
    s.post_published_at     as published_at,
    s.post_is_published     as is_published,
    s.author_user_id        as post_user_id,
    s.post_org_id           as organization_id,
    s.post_tags             as tags,

    -- Composite relevance score (not exposed in UI — used only for ordering)
    ((s.follow_score + s.tag_score + s.pop_score + s.quality_score)
      * s.recency)::real    as score,

    -- Reason chips (no numeric score — industry standard: Twitter/LinkedIn/TikTok)
    (
      case when s.follow_score > 0
        then array['followed_author']
        else array[]::text[]
      end
      ||
      case
        when array_length(s.matched_tags, 1) > 0
        then (
          select array_agg('tag:' || mt)
          from unnest(s.matched_tags) mt
        )
        else array[]::text[]
      end
      ||
      case when s.raw_like_count >= 5
        then array['popular']
        else array[]::text[]
      end
    ) as reasons,

    -- Author profile (joined on explicit alias to avoid user_id ambiguity)
    jsonb_build_object(
      'full_name',  pr.full_name,
      'avatar_url', pr.avatar_url,
      'last_seen',  pr.last_seen
    ) as profiles,

    -- Likes list
    coalesce(
      (
        select jsonb_agg(jsonb_build_object('user_id', lk.user_id))
        from public.likes lk
        where lk.post_id = s.post_id
      ),
      '[]'::jsonb
    ) as likes,

    -- Bookmarks list
    coalesce(
      (
        select jsonb_agg(jsonb_build_object('user_id', bk2.user_id))
        from public.bookmarks bk2
        where bk2.post_id = s.post_id
      ),
      '[]'::jsonb
    ) as bookmarks

  from scored s
  -- Join profiles on the author's id (explicitly using s.author_user_id)
  left join public.profiles pr on pr.id = s.author_user_id

  order by
    score desc,
    s.post_created_at desc

  limit  p_limit
  offset p_offset;
end;
$$;

grant execute on function public.get_recommended_posts(uuid, uuid, integer, integer) to authenticated;

-- ---------------------------------------------------------
-- QUICK TEST (uncomment and replace with your user UUID):
-- SELECT id, title, score, reasons
-- FROM get_recommended_posts(
--   p_user_id => 'YOUR-USER-UUID-HERE',
--   p_limit   => 5
-- );
-- ---------------------------------------------------------
