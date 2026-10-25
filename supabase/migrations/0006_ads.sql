-- Ads: a business connects its Meta ad account, then runs click-to-chat campaigns from Dall AI.

-- One row per connected ad account. The token is a long-lived user token with ads_management.
create table if not exists ad_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  ad_account_id text not null,          -- Meta account id, e.g. "act_123456789"
  name text,
  currency text,                        -- the ad account's currency (NGN, USD, ...)
  access_token_enc text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  unique (workspace_id, ad_account_id)
);
alter table ad_connections enable row level security;
drop policy if exists ad_connections_member_read on ad_connections;
create policy ad_connections_member_read on ad_connections
  for select using (public.is_member(workspace_id));

-- One row per campaign a business launches through Dall AI.
create table if not exists ad_campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  ad_account_id text not null,
  product_label text,                   -- the catalogue item being boosted, for display
  destination text not null,            -- 'whatsapp' | 'messenger' | 'instagram'
  message text,                         -- the ad's primary text
  daily_budget_minor bigint not null,   -- in the ad account's currency minor unit (kobo/cents)
  meta_campaign_id text,
  meta_adset_id text,
  meta_creative_id text,
  meta_ad_id text,
  status text not null default 'draft', -- draft | active | paused | failed
  last_error text,
  created_by uuid,
  created_at timestamptz not null default now()
);
alter table ad_campaigns enable row level security;
drop policy if exists ad_campaigns_member_read on ad_campaigns;
create policy ad_campaigns_member_read on ad_campaigns
  for select using (public.is_member(workspace_id));
create index if not exists ad_campaigns_ws on ad_campaigns(workspace_id);
