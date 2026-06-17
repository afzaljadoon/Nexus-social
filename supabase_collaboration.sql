-- =======================================================
-- Database Schema Migration: Team Collaboration System
-- =======================================================

-- 1. Create invitations table
create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade not null,
  invited_by uuid references public.profiles(id) on delete cascade not null,
  username text not null,
  role text default 'member' not null check (role in ('admin', 'member')),
  status text default 'pending' not null check (status in ('pending', 'accepted', 'declined')),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  constraint unique_pending_org_username unique (organization_id, username)
);

-- Enable RLS on invitations
alter table public.invitations enable row level security;

-- RLS Policies for Invitations
drop policy if exists "Allow select invitations for recipient or org admins" on public.invitations;
create policy "Allow select invitations for recipient or org admins" on public.invitations
  for select using (
    username = (select username from public.profiles where id = auth.uid())
    or public.has_org_role(organization_id, auth.uid(), array['owner', 'admin'])
  );

drop policy if exists "Allow insert invitations for org admins" on public.invitations;
create policy "Allow insert invitations for org admins" on public.invitations
  for insert with check (
    public.has_org_role(organization_id, auth.uid(), array['owner', 'admin'])
    and auth.uid() = invited_by
  );

drop policy if exists "Allow update invitations for recipient" on public.invitations;
create policy "Allow update invitations for recipient" on public.invitations
  for update using (
    username = (select username from public.profiles where id = auth.uid())
  );

drop policy if exists "Allow delete invitations for org admins" on public.invitations;
create policy "Allow delete invitations for org admins" on public.invitations
  for delete using (
    public.has_org_role(organization_id, auth.uid(), array['owner', 'admin'])
  );


-- 2. Create accept_invitation transaction function
create or replace function public.accept_invitation(invite_id uuid)
returns void as $$
declare
  v_org_id uuid;
  v_username text;
  v_role text;
  v_user_id uuid;
begin
  -- Retrieve invitation details
  select organization_id, username, role
  into v_org_id, v_username, v_role
  from public.invitations
  where id = invite_id and status = 'pending';
  
  if not found then
    raise exception 'Invitation not found or no longer pending.';
  end if;

  -- Find user profile by username
  select id into v_user_id
  from public.profiles
  where username = v_username;

  if v_user_id is null then
    raise exception 'User profile not found.';
  end if;

  -- Ensure matching current auth user
  if v_user_id <> auth.uid() then
    raise exception 'Unauthorized: You can only accept your own invitations.';
  end if;

  -- Update invitation status
  update public.invitations
  set status = 'accepted'
  where id = invite_id;

  -- Insert into memberships
  insert into public.memberships (organization_id, user_id, role)
  values (v_org_id, v_user_id, v_role)
  on conflict (organization_id, user_id) do update
  set role = EXCLUDED.role;
end;
$$ language plpgsql security definer;


-- 3. Create shared_notes table (Shared Resources)
create table if not exists public.shared_notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade not null,
  title text not null,
  content text default '' not null,
  created_by uuid references public.profiles(id) on delete cascade not null,
  updated_by uuid references public.profiles(id) on delete cascade not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS on shared_notes
alter table public.shared_notes enable row level security;

-- RLS Policies for Shared Notes
drop policy if exists "Allow select shared_notes for workspace members" on public.shared_notes;
create policy "Allow select shared_notes for workspace members" on public.shared_notes
  for select using (
    exists (
      select 1 from public.workspaces w
      where w.id = shared_notes.workspace_id
      and public.is_org_member(w.organization_id, auth.uid())
    )
  );

drop policy if exists "Allow insert shared_notes for workspace members" on public.shared_notes;
create policy "Allow insert shared_notes for workspace members" on public.shared_notes
  for insert with check (
    exists (
      select 1 from public.workspaces w
      where w.id = shared_notes.workspace_id
      and public.is_org_member(w.organization_id, auth.uid())
    )
    and auth.uid() = created_by
  );

drop policy if exists "Allow update shared_notes for workspace members" on public.shared_notes;
create policy "Allow update shared_notes for workspace members" on public.shared_notes
  for update using (
    exists (
      select 1 from public.workspaces w
      where w.id = shared_notes.workspace_id
      and public.is_org_member(w.organization_id, auth.uid())
    )
  );

drop policy if exists "Allow delete shared_notes for org admins or creators" on public.shared_notes;
create policy "Allow delete shared_notes for org admins or creators" on public.shared_notes
  for delete using (
    auth.uid() = created_by
    or exists (
      select 1 from public.workspaces w
      where w.id = shared_notes.workspace_id
      and public.has_org_role(w.organization_id, auth.uid(), array['owner', 'admin'])
    )
  );


-- 4. Enable Realtime Broadcasting
alter table public.invitations replica identity full;
alter table public.shared_notes replica identity full;

-- Enable Realtime Broadcasting safely using PL/pgSQL block
do $$
begin
  begin
    alter publication supabase_realtime add table public.invitations;
  exception when duplicate_object then
    null;
  end;

  begin
    alter publication supabase_realtime add table public.shared_notes;
  exception when duplicate_object then
    null;
  end;
end $$;
