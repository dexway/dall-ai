-- AI marketing: promotions the assistant can sell, marketing consent, follow-ups, broadcasts.
-- Members read their own business's rows; every write goes through the server.

create table if not exists public.promotions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  code text not null,                         -- what customers type or the assistant applies, e.g. JOLLOF10
  title text not null,                        -- how the assistant describes it
  kind text not null check (kind in ('percent','fixed')),
  value bigint not null check (value > 0),    -- percent (1-90) or kobo off
  min_order_kobo bigint not null default 0,
  max_discount_kobo bigint,                   -- cap for percent promos
  item_ids uuid[],                            -- null = whole basket
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  max_uses int,
  uses int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (workspace_id, code),
  check (kind <> 'percent' or value <= 90)
);
alter table public.promotions enable row level security;
drop policy if exists promotions_member_read on public.promotions;
create policy promotions_member_read on public.promotions for select using (public.is_member(workspace_id));

alter table public.orders add column if not exists promo_code text;

-- Marketing consent per customer chat (channel contact). Opt-out always wins.
alter table public.conversations add column if not exists marketing_consent boolean not null default false;
alter table public.conversations add column if not exists consent_at timestamptz;
alter table public.conversations add column if not exists opted_out_at timestamptz;

create table if not exists public.marketing_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  followups_enabled boolean not null default true,
  unpaid_nudge_minutes int not null default 20 check (unpaid_nudge_minutes between 5 and 600),
  quiet_lead_hours int not null default 20 check (quiet_lead_hours between 1 and 23),
  upsell_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.marketing_settings enable row level security;
drop policy if exists marketing_settings_member_read on public.marketing_settings;
create policy marketing_settings_member_read on public.marketing_settings for select using (public.is_member(workspace_id));

-- One row per automatic follow-up the assistant sent (or skipped), so nothing is sent twice.
create table if not exists public.followups (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  kind text not null check (kind in ('unpaid_checkout','quiet_lead')),
  order_id uuid references public.orders(id) on delete cascade,
  status text not null check (status in ('sent','skipped','failed')),
  reason text,
  message text,
  created_at timestamptz not null default now()
);
create unique index if not exists followups_once_per_order on public.followups(order_id, kind) where order_id is not null;
create unique index if not exists followups_once_per_quiet on public.followups(conversation_id, kind, ((created_at at time zone 'UTC')::date)) where kind = 'quiet_lead';
create index if not exists followups_ws on public.followups(workspace_id, created_at desc);
alter table public.followups enable row level security;
drop policy if exists followups_member_read on public.followups;
create policy followups_member_read on public.followups for select using (public.is_member(workspace_id));

create table if not exists public.broadcasts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null,
  channel text not null check (channel in ('whatsapp','facebook','instagram')),
  message text,                               -- Messenger/Instagram free text (24h window only)
  template_name text, template_language text, -- WhatsApp approved template
  promo_code text,
  status text not null default 'draft' check (status in ('draft','sending','sent','failed')),
  total int not null default 0, sent int not null default 0, failed int not null default 0, skipped int not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create table if not exists public.broadcast_recipients (
  broadcast_id uuid not null references public.broadcasts(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  status text not null check (status in ('sent','failed','skipped')),
  error text,
  provider_message_id text,
  created_at timestamptz not null default now(),
  primary key (broadcast_id, conversation_id)
);
alter table public.broadcasts enable row level security;
alter table public.broadcast_recipients enable row level security;
drop policy if exists broadcasts_member_read on public.broadcasts;
create policy broadcasts_member_read on public.broadcasts for select using (public.is_member(workspace_id));
drop policy if exists broadcast_recipients_member_read on public.broadcast_recipients;
create policy broadcast_recipients_member_read on public.broadcast_recipients for select using (public.is_member(workspace_id));

-- Claims one promotion use atomically (no overselling a limited code).
create or replace function public.claim_promo_use(p_promo uuid) returns boolean
language sql security definer set search_path = public as $$
  update promotions set uses = uses + 1
  where id = p_promo and active and (max_uses is null or uses < max_uses) and starts_at <= now() and (ends_at is null or ends_at > now())
  returning true
$$;
revoke all on function public.claim_promo_use(uuid) from public, anon, authenticated;
grant execute on function public.claim_promo_use(uuid) to service_role;
