-- Multi-channel inbox, lead capture, ad attribution, webhook event log and ads sync.
-- Everything is workspace-scoped; members read their own workspace only (is_member), writes go
-- through the server (service role) unless a policy below says otherwise.

-- Messages: team members can reply by hand; outbound replies carry a delivery state.
alter table public.messages drop constraint if exists messages_role_check;
alter table public.messages add constraint messages_role_check check (role in ('user','assistant','human'));
alter table public.messages add column if not exists delivery_status text
  check (delivery_status in ('pending','sent','delivered','read','failed'));
alter table public.messages add column if not exists delivery_error text;
alter table public.messages add column if not exists provider_message_id text; -- id the platform gave our outbound message
alter table public.messages add column if not exists attachments jsonb not null default '[]';
alter table public.messages add column if not exists sent_by uuid;              -- team member, for role = 'human'
create index if not exists messages_provider_id on public.messages(provider_message_id) where provider_message_id is not null;

-- Conversations: inbox state, human takeover, assignment, outcome, attribution.
alter table public.conversations add column if not exists contact_name text;
alter table public.conversations add column if not exists last_message_at timestamptz;
alter table public.conversations add column if not exists last_inbound_at timestamptz;  -- start of the 24h messaging window
alter table public.conversations add column if not exists ai_paused boolean not null default false;
alter table public.conversations add column if not exists handoff_reason text;
alter table public.conversations add column if not exists assigned_to uuid;
alter table public.conversations add column if not exists outcome text not null default 'open'
  check (outcome in ('open','qualified','won','lost','spam'));
alter table public.conversations add column if not exists unread boolean not null default false;
-- Where Meta tells us: {source:'ad', ad_id, ctwa_clid, headline, ref, first_seen}. Null = unknown, never guessed.
alter table public.conversations add column if not exists attribution jsonb;
alter table public.conversations add column if not exists ad_id text;
create index if not exists conversations_inbox on public.conversations(workspace_id, last_message_at desc nulls last);
create index if not exists conversations_ad on public.conversations(workspace_id, ad_id) where ad_id is not null;
update public.conversations c set last_message_at = coalesce((select max(created_at) from public.messages m where m.conversation_id = c.id), c.created_at)
  where last_message_at is null;

-- Leads the assistant (or a team member) captured. Consent is recorded, not assumed.
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  channel text,
  name text, phone text, email text,
  interest text,                        -- what they want, in their words
  budget text,
  status text not null default 'new' check (status in ('new','qualified','sales_ready','won','lost')),
  consent_contact boolean not null default false,
  ad_id text,                           -- copied from the conversation when Meta provided it
  notes text,
  created_by text not null default 'agent' check (created_by in ('agent','human')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists leads_ws on public.leads(workspace_id, created_at desc);
create unique index if not exists leads_one_per_conversation on public.leads(conversation_id) where conversation_id is not null;
alter table public.leads enable row level security;
drop policy if exists leads_member_read on public.leads;
create policy leads_member_read on public.leads for select using (public.is_member(workspace_id));

-- Every webhook delivery we accept, for idempotency, retries and debugging.
create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,               -- whatsapp | facebook | instagram
  event_key text not null,              -- platform message/status id; unique per provider
  kind text not null,                   -- message | status | referral | other
  workspace_id uuid references public.workspaces(id) on delete cascade,
  status text not null default 'received' check (status in ('received','processed','ignored','failed')),
  attempts int not null default 0,
  error text,
  payload jsonb,                        -- the normalized event (never tokens)
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, event_key)
);
create index if not exists webhook_events_retry on public.webhook_events(status, received_at) where status = 'failed';
create index if not exists webhook_events_ws on public.webhook_events(workspace_id, received_at desc);
alter table public.webhook_events enable row level security;
drop policy if exists webhook_events_member_read on public.webhook_events;
create policy webhook_events_member_read on public.webhook_events for select using (workspace_id is not null and public.is_member(workspace_id));

-- Integration errors shown to the owner (send failures, sync failures, token problems).
create table if not exists public.integration_errors (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source text not null,                 -- whatsapp_send | meta_send | ads_sync | ads_update | webhook
  message text not null,
  context jsonb,
  created_at timestamptz not null default now()
);
create index if not exists integration_errors_ws on public.integration_errors(workspace_id, created_at desc);
alter table public.integration_errors enable row level security;
drop policy if exists integration_errors_member_read on public.integration_errors;
create policy integration_errors_member_read on public.integration_errors for select using (public.is_member(workspace_id));

-- Channel health: when we last heard from / successfully sent on each channel.
alter table public.channel_connections add column if not exists last_inbound_at timestamptz;
alter table public.channel_connections add column if not exists last_outbound_at timestamptz;
alter table public.channel_connections add column if not exists scopes text[];

-- Ads: synced Meta state and reporting.
alter table public.ad_campaigns add column if not exists meta_status text;          -- ACTIVE | PAUSED | ...
alter table public.ad_campaigns add column if not exists effective_status text;     -- Meta's delivery status
alter table public.ad_campaigns add column if not exists insights jsonb;            -- last synced lifetime insights
alter table public.ad_campaigns add column if not exists last_synced_at timestamptz;
alter table public.ad_campaigns add column if not exists page_id text;
alter table public.ad_campaigns add column if not exists name text;
create table if not exists public.ad_insights_daily (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  ad_campaign_id uuid not null references public.ad_campaigns(id) on delete cascade,
  day date not null,
  spend_minor bigint not null default 0,
  impressions bigint not null default 0,
  reach bigint not null default 0,
  clicks bigint not null default 0,
  conversations_started bigint not null default 0,   -- Meta's messaging_conversation_started_7d action, when reported
  leads bigint not null default 0,
  synced_at timestamptz not null default now(),
  primary key (ad_campaign_id, day)
);
alter table public.ad_insights_daily enable row level security;
drop policy if exists ad_insights_member_read on public.ad_insights_daily;
create policy ad_insights_member_read on public.ad_insights_daily for select using (public.is_member(workspace_id));
drop policy if exists ad_campaigns_member_read on public.ad_campaigns;
create policy ad_campaigns_member_read on public.ad_campaigns for select using (public.is_member(workspace_id));
