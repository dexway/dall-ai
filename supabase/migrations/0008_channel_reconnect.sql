-- A channel whose Meta access lapsed (token expired, permissions revoked) is flagged so the
-- dashboard can show a "lost connection — refresh permissions" banner.
alter table public.channel_connections drop constraint if exists channel_connections_status_check;
alter table public.channel_connections add constraint channel_connections_status_check
  check (status in ('active', 'paused', 'needs_reconnect'));
alter table public.channel_connections add column if not exists last_error text;
alter table public.channel_connections add column if not exists last_error_at timestamptz;
