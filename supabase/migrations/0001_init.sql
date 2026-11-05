-- Migration: 0001_init.sql
-- Multi-clinic / Multi-workspace Schema for Escriba
-- CRITICAL: Audio is 100% local and NEVER stored in the database.
-- Only metadata and text transcriptions are stored here when cloud sync is enabled.

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- 1. Workspaces
create table if not exists public.workspaces (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text not null unique,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  deleted_at timestamp with time zone
);

-- 2. Memberships (RBAC)
create table if not exists public.memberships (
  id uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'dentist', 'assistant')),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique (workspace_id, user_id)
);

-- 3. Sessions (Metadata only - ZERO audio)
create table if not exists public.sessions (
  id uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid references auth.users(id),
  title text not null,
  reference text,
  status text not null check (status in ('recording', 'recorded', 'transcribing', 'completed', 'error')),
  duration_sec numeric not null default 0,
  consent_given boolean not null default false,
  model_tier_used text,
  audio_deleted boolean not null default false,
  error text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  deleted_at timestamp with time zone
);

-- 4. Transcript Segments (Text and timestamps)
create table if not exists public.transcript_segments (
  id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  start_sec numeric not null,
  end_sec numeric not null,
  text text not null,
  original_text text not null,
  speaker text,
  edited boolean not null default false,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 5. Glossary Entries
create table if not exists public.glossary_entries (
  id uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  incorrect text not null,
  correct text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Indices for rapid querying
create index if not exists idx_memberships_user on public.memberships(user_id);
create index if not exists idx_sessions_workspace on public.sessions(workspace_id, created_at desc);
create index if not exists idx_transcript_segments_session on public.transcript_segments(session_id, start_sec asc);
create index if not exists idx_glossary_workspace on public.glossary_entries(workspace_id);

-- Enable Row Level Security (RLS) on all tables
alter table public.workspaces enable row level security;
alter table public.memberships enable row level security;
alter table public.sessions enable row level security;
alter table public.transcript_segments enable row level security;
alter table public.glossary_entries enable row level security;

-- Helper function to check workspace membership
create or replace function public.is_workspace_member(ws_id uuid)
returns boolean security definer set search_path = public as $$
begin
  return exists (
    select 1 from public.memberships
    where workspace_id = ws_id
      and user_id = auth.uid()
  );
end;
$$ language plpgsql;

-- RLS Policies
create policy "Users can view workspaces they belong to"
  on public.workspaces for select
  using (public.is_workspace_member(id));

create policy "Users can view memberships of their workspaces"
  on public.memberships for select
  using (public.is_workspace_member(workspace_id));

create policy "Workspace members can view sessions"
  on public.sessions for select
  using (public.is_workspace_member(workspace_id));

create policy "Workspace members can insert/update sessions"
  on public.sessions for all
  using (public.is_workspace_member(workspace_id));

create policy "Workspace members can access transcript segments"
  on public.transcript_segments for all
  using (
    exists (
      select 1 from public.sessions s
      where s.id = transcript_segments.session_id
        and public.is_workspace_member(s.workspace_id)
    )
  );

create policy "Workspace members can manage glossary entries"
  on public.glossary_entries for all
  using (public.is_workspace_member(workspace_id));
