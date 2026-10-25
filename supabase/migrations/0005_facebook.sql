-- Messenger (Facebook Pages) joins WhatsApp and Instagram as a channel.
alter table public.channel_connections drop constraint if exists channel_connections_provider_check;
alter table public.channel_connections add constraint channel_connections_provider_check
  check (provider in ('whatsapp','facebook','instagram','tiktok'));
