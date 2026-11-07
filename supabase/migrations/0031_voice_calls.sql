-- AI phone calls: businesses get a phone number from Dall AI, a voice version of their assistant answers
-- and makes calls, and they can run call campaigns. Numbers live on the platform's telecom account and
-- the voice agents on the platform's voice account, so businesses never open third-party accounts.
-- Additive only. Members read their own rows; every write goes through the server (service role).

create table if not exists public.voice_numbers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  e164 text not null,                          -- "+2348012345678"
  country text not null default 'NG',
  label text,
  status text not null default 'provisioning' check (status in ('provisioning','active','failed','released')),
  provider_number_id text,                     -- telecom provider's id for the number
  voice_credential_id text,                    -- voice provider's SIP trunk credential
  voice_phone_id text,                         -- voice provider's id for the imported number
  provider_endpoint_id text,                   -- telecom provider's route to the voice agent (used to place calls)
  error text,
  created_by uuid,
  created_at timestamptz not null default now(),
  released_at timestamptz
);
create unique index if not exists voice_numbers_live on public.voice_numbers(e164) where status <> 'released';
create index if not exists voice_numbers_ws on public.voice_numbers(workspace_id, created_at desc);

create table if not exists public.voice_agents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  voice text not null default 'female_ng',     -- a Dall AI voice choice, mapped to a provider voice server-side
  first_message text not null default '',
  instructions text not null default '',       -- extra call instructions from the owner
  provider_assistant_id text,                  -- voice provider's assistant id
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id)                        -- one voice agent per business for now
);

create table if not exists public.voice_campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (length(name) between 2 and 80),
  number_id uuid not null references public.voice_numbers(id),
  goal text not null default '',               -- what the agent should achieve on these calls
  status text not null default 'draft' check (status in ('draft','running','paused','done')),
  max_concurrent int not null default 1 check (max_concurrent between 1 and 10),
  max_minutes int not null default 30 check (max_minutes between 1 and 10000),   -- owner's cap for the whole campaign
  minutes_used numeric(10,2) not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists voice_campaigns_ws on public.voice_campaigns(workspace_id, created_at desc);

create table if not exists public.voice_calls (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  number_id uuid references public.voice_numbers(id),
  campaign_id uuid references public.voice_campaigns(id) on delete cascade,
  direction text not null default 'outbound' check (direction in ('outbound','inbound')),
  to_e164 text not null,
  contact_name text,
  status text not null default 'queued' check (status in ('queued','dialing','in_progress','completed','no_answer','busy','failed','cancelled')),
  provider_call_id text unique,
  ended_reason text,
  duration_s int,
  summary text,
  transcript text,
  recording_url text,
  cost_usd numeric(10,4),
  error text,
  created_by uuid,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz
);
create index if not exists voice_calls_ws on public.voice_calls(workspace_id, created_at desc);
create index if not exists voice_calls_queue on public.voice_calls(campaign_id, status) where status in ('queued','dialing','in_progress');

alter table public.voice_numbers enable row level security;
alter table public.voice_agents enable row level security;
alter table public.voice_campaigns enable row level security;
alter table public.voice_calls enable row level security;
drop policy if exists voice_numbers_member_read on public.voice_numbers;
create policy voice_numbers_member_read on public.voice_numbers for select using (public.is_member(workspace_id));
drop policy if exists voice_agents_member_read on public.voice_agents;
create policy voice_agents_member_read on public.voice_agents for select using (public.is_member(workspace_id));
drop policy if exists voice_campaigns_member_read on public.voice_campaigns;
create policy voice_campaigns_member_read on public.voice_campaigns for select using (public.is_member(workspace_id));
drop policy if exists voice_calls_member_read on public.voice_calls;
create policy voice_calls_member_read on public.voice_calls for select using (public.is_member(workspace_id));
