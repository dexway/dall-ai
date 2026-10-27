-- WhatsApp Business Account id, needed to list approved message templates.
alter table public.channel_connections add column if not exists waba_id text;
