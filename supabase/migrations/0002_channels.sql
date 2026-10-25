-- Channel connections: which WhatsApp (later Instagram/TikTok) account belongs to which business.
-- Tokens are encrypted by the app (lib/crypto.ts) before they reach this table.
create table public.channel_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null check (provider in ('whatsapp','instagram','tiktok')),
  external_id text not null,            -- WhatsApp phone_number_id
  display_name text,
  access_token_enc text not null,
  status text not null default 'active' check (status in ('active','paused')),
  created_at timestamptz not null default now(),
  unique (provider, external_id)
);
create index on public.channel_connections(workspace_id);
alter table public.channel_connections enable row level security;
-- No policies: only the server (service role) reads or writes these rows.

-- One chat per customer per channel, and one stored row per inbound platform message (Meta retries).
alter table public.conversations add column external_ref text;
create unique index conversations_channel_ref on public.conversations(workspace_id, channel, external_ref) where external_ref is not null;
alter table public.messages add column external_id text;
create unique index messages_external_id on public.messages(workspace_id, external_id) where external_id is not null;
