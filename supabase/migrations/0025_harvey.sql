-- Harvey, the sales agent: finds prospective customers for a business, researches each one from its
-- own website (buying signals with evidence, who decides, how to reach them), writes outreach the
-- owner approves and sends, drafts follow-ups, answers replies, writes proposals, and tracks each
-- deal from new to won or lost. Members read their own business's rows; every write goes through
-- the server.

create table if not exists public.harvey_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  offer text not null default '',            -- what the business sells to these customers
  ideal_customers text not null default '',  -- "corporate offices, event planners, embassies"
  areas text not null default '',            -- "Lekki, Victoria Island, Ikoyi"
  deciders text not null default '',         -- "office manager, HR, admin, founder"
  proof text not null default '',            -- results, clients, reviews they can mention
  sender_name text not null default '',
  followup_days int not null default 3 check (followup_days between 1 and 21),
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table if not exists public.harvey_prospects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  website text,
  domain text,
  phone text, email text, whatsapp text, address text,
  contact_name text, contact_title text,
  source text not null default 'search' check (source in ('search','manual')),
  why text,                                   -- why Harvey thinks they could buy (from discovery)
  research jsonb,                             -- summary, signals[{key,label,evidence,url}], people, fit, angle
  fit int check (fit between 0 and 100),
  stage text not null default 'new' check (stage in ('new','researched','drafted','contacted','replied','meeting','proposal','won','lost')),
  value_kobo bigint check (value_kobo is null or value_kobo >= 0),
  next_step text, next_at timestamptz,
  lost_reason text,
  notes text,
  error text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists harvey_prospects_domain on public.harvey_prospects(workspace_id, domain) where domain is not null;
create index if not exists harvey_prospects_stage on public.harvey_prospects(workspace_id, stage, updated_at desc);

create table if not exists public.harvey_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  prospect_id uuid not null references public.harvey_prospects(id) on delete cascade,
  direction text not null check (direction in ('out','in')),
  channel text not null check (channel in ('email','whatsapp','call','other')),
  kind text not null check (kind in ('intro','followup','reply','proposal','note')),
  subject text,
  body text not null,
  status text not null default 'draft' check (status in ('draft','sent','received','discarded')),
  meta jsonb,                                 -- reply analysis: intent, summary, suggested stage
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists harvey_messages_prospect on public.harvey_messages(prospect_id, created_at);

alter table public.harvey_settings enable row level security;
alter table public.harvey_prospects enable row level security;
alter table public.harvey_messages enable row level security;
drop policy if exists harvey_settings_member_read on public.harvey_settings;
create policy harvey_settings_member_read on public.harvey_settings for select using (public.is_member(workspace_id));
drop policy if exists harvey_prospects_member_read on public.harvey_prospects;
create policy harvey_prospects_member_read on public.harvey_prospects for select using (public.is_member(workspace_id));
drop policy if exists harvey_messages_member_read on public.harvey_messages;
create policy harvey_messages_member_read on public.harvey_messages for select using (public.is_member(workspace_id));
