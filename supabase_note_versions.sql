-- =======================================================
-- Database Schema Migration: Shared Notes Version History
-- =======================================================

-- 1. Create shared_note_versions table
create table if not exists public.shared_note_versions (
  id uuid primary key default gen_random_uuid(),
  note_id uuid references public.shared_notes(id) on delete cascade not null,
  title text not null,
  content text default '' not null,
  version_number int not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable Row Level Security (RLS)
alter table public.shared_note_versions enable row level security;

-- 2. RLS Policies
drop policy if exists "Allow select versions for workspace members" on public.shared_note_versions;
create policy "Allow select versions for workspace members" on public.shared_note_versions
  for select using (
    exists (
      select 1 from public.shared_notes n
      join public.workspaces w on w.id = n.workspace_id
      where n.id = shared_note_versions.note_id
      and public.is_org_member(w.organization_id, auth.uid())
    )
  );

drop policy if exists "Allow insert versions for workspace members" on public.shared_note_versions;
create policy "Allow insert versions for workspace members" on public.shared_note_versions
  for insert with check (
    exists (
      select 1 from public.shared_notes n
      join public.workspaces w on w.id = n.workspace_id
      where n.id = shared_note_versions.note_id
      and public.is_org_member(w.organization_id, auth.uid())
    )
  );

-- 3. Version logging trigger on note creation
create or replace function public.log_shared_note_creation()
returns trigger as $$
begin
  insert into public.shared_note_versions (note_id, title, content, version_number, created_by)
  values (
    new.id,
    new.title,
    new.content,
    1,
    new.created_by
  );
  return new;
end;
$$ language plpgsql security definer;

create or replace trigger trigger_log_shared_note_creation
  after insert on public.shared_notes
  for each row execute procedure public.log_shared_note_creation();

-- 4. Version logging trigger on note updates with a 2-minute throttling window
create or replace function public.log_shared_note_version()
returns trigger as $$
declare
  v_last_version_id uuid;
  v_last_created_at timestamp with time zone;
  v_max_version int;
begin
  -- Don't version if title and content haven't changed
  if (old.title = new.title and old.content = new.content) then
    return new;
  end if;

  -- Find the latest version
  select id, created_at, version_number
  into v_last_version_id, v_last_created_at, v_max_version
  from public.shared_note_versions
  where note_id = new.id
  order by version_number desc
  limit 1;

  -- If last version was within 2 minutes and created by same user, update it to throttle versions
  if v_last_version_id is not null 
     and v_last_created_at > (now() - interval '2 minutes') 
     and new.updated_by = (select created_by from public.shared_note_versions where id = v_last_version_id) then
    
    update public.shared_note_versions
    set title = new.title,
        content = new.content,
        created_at = now()
    where id = v_last_version_id;
  else
    -- Otherwise, insert a new version row
    insert into public.shared_note_versions (note_id, title, content, version_number, created_by)
    values (
      new.id,
      new.title,
      new.content,
      coalesce(v_max_version, 0) + 1,
      new.updated_by
    );
  end if;

  return new;
end;
$$ language plpgsql security definer;

create or replace trigger trigger_log_shared_note_version
  after update on public.shared_notes
  for each row execute procedure public.log_shared_note_version();
