-- =======================================================
-- Database Schema Migration: Multi-Tenant Architecture
-- =======================================================

-- 1. Create organizations table
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Ensure created_by column exists if table was already created
alter table public.organizations add column if not exists created_by uuid references public.profiles(id) default auth.uid();

-- Enable RLS on organizations
alter table public.organizations enable row level security;

-- 2. Create workspaces table
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade not null,
  name text not null,
  slug text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  constraint unique_org_workspace_slug unique (organization_id, slug)
);

-- Enable RLS on workspaces
alter table public.workspaces enable row level security;

-- 3. Create memberships table
create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  role text default 'member' not null check (role in ('owner', 'admin', 'member')),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  constraint unique_org_user_membership unique (organization_id, user_id)
);

-- Enable RLS on memberships
alter table public.memberships enable row level security;

-- Helper functions to check membership without causing infinite recursion in RLS policies
create or replace function public.is_org_member(org_id uuid, user_id uuid)
returns boolean as $$
begin
  return exists (
    select 1 from public.memberships
    where organization_id = org_id
    and memberships.user_id = $2
  );
end;
$$ language plpgsql security definer;

create or replace function public.has_org_role(org_id uuid, user_id uuid, roles text[])
returns boolean as $$
begin
  return exists (
    select 1 from public.memberships
    where organization_id = org_id
    and memberships.user_id = $2
    and role = any(roles)
  );
end;
$$ language plpgsql security definer;

-- 4. RLS Policies for Organizations
drop policy if exists "Allow select if member of organization" on public.organizations;
create policy "Allow select if member of organization" on public.organizations
  for select using (
    public.is_org_member(id, auth.uid())
    or created_by = auth.uid()
  );

drop policy if exists "Allow insert for authenticated users" on public.organizations;
create policy "Allow insert for authenticated users" on public.organizations
  for insert with check (auth.uid() is not null);

drop policy if exists "Allow update for organization owner or admin" on public.organizations;
create policy "Allow update for organization owner or admin" on public.organizations
  for update using (
    public.has_org_role(id, auth.uid(), array['owner', 'admin'])
  );

-- 5. RLS Policies for Workspaces
drop policy if exists "Allow select workspaces if organization member" on public.workspaces;
create policy "Allow select workspaces if organization member" on public.workspaces
  for select using (
    public.is_org_member(organization_id, auth.uid())
  );

drop policy if exists "Allow all actions on workspaces for org admins/owners" on public.workspaces;
create policy "Allow all actions on workspaces for org admins/owners" on public.workspaces
  for all using (
    public.has_org_role(organization_id, auth.uid(), array['owner', 'admin'])
  );

-- 6. RLS Policies for Memberships
drop policy if exists "Allow select memberships if organization member" on public.memberships;
create policy "Allow select memberships if organization member" on public.memberships
  for select using (
    public.is_org_member(organization_id, auth.uid())
  );

drop policy if exists "Allow all actions on memberships for org admins/owners" on public.memberships;
create policy "Allow all actions on memberships for org admins/owners" on public.memberships
  for all using (
    public.has_org_role(organization_id, auth.uid(), array['owner', 'admin'])
  );

-- 7. Automated owner initialization trigger when organization is created
create or replace function public.initialize_organization_owner()
returns trigger as $$
begin
  -- Insert current user as owner of the organization only if we have an authenticated user context
  if auth.uid() is not null then
    insert into public.memberships (organization_id, user_id, role)
    values (new.id, auth.uid(), 'owner')
    on conflict (organization_id, user_id) do nothing;
  end if;
  
  -- Create General workspace inside the new organization (except seed org which is manually seeded with static UUID)
  if new.id != '00000000-0000-0000-0000-000000000000' then
    insert into public.workspaces (organization_id, name, slug)
    values (new.id, 'General', 'general')
    on conflict (organization_id, slug) do nothing;
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_organization_created on public.organizations;
create trigger on_organization_created
  after insert on public.organizations
  for each row execute procedure public.initialize_organization_owner();

-- 8. Link content tables to organization
alter table public.posts add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.comments add column if not exists organization_id uuid references public.organizations(id) on delete cascade;

-- Seed Default Organization & General Workspace
insert into public.organizations (id, name, slug)
values ('00000000-0000-0000-0000-000000000000', 'Default Organization', 'default')
on conflict (id) do nothing;

insert into public.workspaces (id, organization_id, name, slug)
values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'General', 'general')
on conflict (organization_id, slug) do nothing;

-- Map existing users to Default Organization
insert into public.memberships (organization_id, user_id, role)
select '00000000-0000-0000-0000-000000000000', id, 'member'
from public.profiles
on conflict (organization_id, user_id) do nothing;

-- Update existing content
update public.posts set organization_id = '00000000-0000-0000-0000-000000000000' where organization_id is null;
update public.comments set organization_id = '00000000-0000-0000-0000-000000000000' where organization_id is null;

-- Make organization_id not null going forward
alter table public.posts alter column organization_id set not null;
alter table public.comments alter column organization_id set not null;

-- 9. Adjust RLS policies on posts and comments for Tenant Isolation
drop policy if exists "Allow read access to active posts" on public.posts;
drop policy if exists "Allow read access to active tenant posts" on public.posts;
create policy "Allow read access to active tenant posts" on public.posts
  for select using (
    (deleted_at is null 
     or auth.uid() = user_id 
     or exists (
       select 1 from public.profiles
       where id = auth.uid() and role in ('admin', 'moderator')
     ))
    and public.is_org_member(organization_id, auth.uid())
  );

drop policy if exists "Allow public read access to active comments" on public.comments;
drop policy if exists "Allow read access to active tenant comments" on public.comments;
create policy "Allow read access to active tenant comments" on public.comments
  for select using (
    (deleted_at is null 
     or auth.uid() = user_id 
     or exists (
       select 1 from public.profiles
       where id = auth.uid() and role in ('admin', 'moderator')
     ))
    and public.is_org_member(organization_id, auth.uid())
  );

-- Adjust Insert/Update/Delete policies for posts & comments to check membership
drop policy if exists "Allow authenticated users to insert posts" on public.posts;
drop policy if exists "Allow insert posts for organization members" on public.posts;
create policy "Allow insert posts for organization members" on public.posts
  for insert with check (
    auth.uid() = user_id
    and public.is_org_member(organization_id, auth.uid())
  );

drop policy if exists "Allow authenticated users to insert comments" on public.comments;
drop policy if exists "Allow insert comments for organization members" on public.comments;
create policy "Allow insert comments for organization members" on public.comments
  for insert with check (
    auth.uid() = user_id
    and public.is_org_member(organization_id, auth.uid())
  );

-- Configure Replica Identity
alter table public.organizations replica identity full;
alter table public.workspaces replica identity full;
alter table public.memberships replica identity full;

-- Enable Realtime Broadcasting safely using a PL/pgSQL block to handle duplicate member exceptions
do $$
begin
  begin
    alter publication supabase_realtime add table public.organizations;
  exception when duplicate_object then
    null; -- ignore if already added
  end;

  begin
    alter publication supabase_realtime add table public.workspaces;
  exception when duplicate_object then
    null; -- ignore if already added
  end;

  begin
    alter publication supabase_realtime add table public.memberships;
  exception when duplicate_object then
    null; -- ignore if already added
  end;
end $$;
