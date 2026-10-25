-- Voice: numbers, calls, bulk campaigns, and consent. Written by the server; members can read their own business's rows.

create table public.voice_numbers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  e164 text not null unique,                 -- +234…
  krosai_number_id text,                     -- id from KrosAI, filled in when we link it
  label text,
  status text not null default 'active' check (status in ('active','paused')),
  created_at timestamptz not null default now()
);
create index on public.voice_numbers(workspace_id);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  status text not null default 'draft' check (status in ('draft','running','paused','done')),
  calling_from_hour int not null default 9 check (calling_from_hour between 0 and 23),   -- Lagos time
  calling_until_hour int not null default 18 check (calling_until_hour between 1 and 24),
  calls_per_hour int not null default 30 check (calls_per_hour between 1 and 300),
  created_at timestamptz not null default now()
);
create index on public.campaigns(workspace_id);

create table public.campaign_contacts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  e164 text not null,
  name text,
  consent_source text not null,              -- how they opted in, e.g. "web form 12 Oct 2026"
  consent_at timestamptz not null,           -- required: no consent, no call
  status text not null default 'queued' check (status in ('queued','calling','done','failed','opted_out')),
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  unique (campaign_id, e164)
);
create index on public.campaign_contacts(campaign_id, status);

-- Numbers that said stop. Checked before every call, for every campaign and every single call.
create table public.opt_outs (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  e164 text not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, e164)
);

create table public.calls (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  number_id uuid references public.voice_numbers(id) on delete set null,
  campaign_id uuid references public.campaigns(id) on delete set null,
  direction text not null check (direction in ('inbound','outbound')),
  counterpart text not null,                 -- the other phone number
  krosai_call_id text unique,
  status text not null default 'started',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds int,
  transcript jsonb not null default '[]'::jsonb,
  outcome text,
  created_at timestamptz not null default now()
);
create index on public.calls(workspace_id, started_at desc);

alter table public.voice_numbers enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_contacts enable row level security;
alter table public.opt_outs enable row level security;
alter table public.calls enable row level security;

-- Members can read their business's voice data. Writes happen only on the server.
create policy member_read on public.voice_numbers for select using (public.is_member(workspace_id));
create policy member_read on public.campaigns for select using (public.is_member(workspace_id));
create policy member_read on public.campaign_contacts for select using (public.is_member(workspace_id));
create policy member_read on public.calls for select using (public.is_member(workspace_id));
