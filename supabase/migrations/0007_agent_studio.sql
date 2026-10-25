-- AI build studio: richer agent brain (instructions + knowledge), a website source, and saved presets.

alter table public.agents
  add column if not exists instructions text not null default '',
  add column if not exists website_url text,
  add column if not exists knowledge text not null default '';

-- Custom presets a business saves to reuse (built-in presets live in code).
create table if not exists public.agent_presets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  persona text not null default '',
  greeting text not null default '',
  instructions text not null default '',
  created_at timestamptz not null default now()
);
alter table public.agent_presets enable row level security;
drop policy if exists agent_presets_member_read on public.agent_presets;
create policy agent_presets_member_read on public.agent_presets
  for select using (public.is_member(workspace_id));
create index if not exists agent_presets_ws on public.agent_presets(workspace_id);
