-- =======================================================
-- Database Schema Migration: Enterprise File Management
-- =======================================================

-- 1. Create workspace_files metadata table
create table if not exists public.workspace_files (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade not null,
  name text not null,
  is_folder boolean default false not null,
  parent_id uuid references public.workspace_files(id) on delete cascade,
  storage_path text, -- NULL for folders
  file_size bigint, -- NULL for folders
  mime_type text, -- NULL for folders
  created_by uuid references public.profiles(id) on delete cascade not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS on workspace_files
alter table public.workspace_files enable row level security;

-- RLS Policies for workspace_files
drop policy if exists "Allow select files for workspace members" on public.workspace_files;
create policy "Allow select files for workspace members" on public.workspace_files
  for select using (
    exists (
      select 1 from public.workspaces w
      where w.id = workspace_files.workspace_id
      and public.is_org_member(w.organization_id, auth.uid())
    )
  );

drop policy if exists "Allow insert files for workspace members" on public.workspace_files;
create policy "Allow insert files for workspace members" on public.workspace_files
  for insert with check (
    exists (
      select 1 from public.workspaces w
      where w.id = workspace_files.workspace_id
      and public.is_org_member(w.organization_id, auth.uid())
    )
    and auth.uid() = created_by
  );

drop policy if exists "Allow update files for workspace members" on public.workspace_files;
create policy "Allow update files for workspace members" on public.workspace_files
  for update using (
    exists (
      select 1 from public.workspaces w
      where w.id = workspace_files.workspace_id
      and public.is_org_member(w.organization_id, auth.uid())
    )
  );

drop policy if exists "Allow delete files for workspace members" on public.workspace_files;
create policy "Allow delete files for workspace members" on public.workspace_files
  for delete using (
    exists (
      select 1 from public.workspaces w
      where w.id = workspace_files.workspace_id
      and public.is_org_member(w.organization_id, auth.uid())
    )
  );


-- 2. Seed Storage Bucket
insert into storage.buckets (id, name, public)
values ('workspace-files', 'workspace-files', false)
on conflict (id) do nothing;


-- 3. Storage Security Policies for 'workspace-files' bucket
create or replace function public.safe_cast_to_uuid(val text)
returns uuid as $$
begin
  if val ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return val::uuid;
  else
    return null;
  end if;
end;
$$ language plpgsql immutable;

-- Security definer helper to verify workspace access without nested client RLS issues
create or replace function public.can_access_workspace(workspace_uuid uuid, user_uuid uuid)
returns boolean as $$
begin
  return exists (
    select 1 from public.workspaces w
    where w.id = workspace_uuid
    and public.is_org_member(w.organization_id, user_uuid)
  );
end;
$$ language plpgsql security definer;

drop policy if exists "Allow select objects for workspace members" on storage.objects;
create policy "Allow select objects for workspace members" on storage.objects
  for select using (
    bucket_id = 'workspace-files'
    and public.can_access_workspace(public.safe_cast_to_uuid(split_part(name, '/', 1)), auth.uid())
  );

drop policy if exists "Allow insert objects for workspace members" on storage.objects;
create policy "Allow insert objects for workspace members" on storage.objects
  for insert with check (
    bucket_id = 'workspace-files'
    and public.can_access_workspace(public.safe_cast_to_uuid(split_part(name, '/', 1)), auth.uid())
  );

drop policy if exists "Allow delete objects for workspace members" on storage.objects;
create policy "Allow delete objects for workspace members" on storage.objects
  for delete using (
    bucket_id = 'workspace-files'
    and public.can_access_workspace(public.safe_cast_to_uuid(split_part(name, '/', 1)), auth.uid())
  );


-- 4. Enable Realtime Broadcasting
alter table public.workspace_files replica identity full;

do $$
begin
  begin
    alter publication supabase_realtime add table public.workspace_files;
  exception when duplicate_object then
    null;
  end;
end $$;
