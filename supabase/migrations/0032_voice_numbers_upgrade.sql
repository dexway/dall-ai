-- 0004 had already created voice_numbers (statuses active/paused, no provider columns), so 0031's
-- "create table if not exists" kept the old shape and getting a number would fail. Upgrade it in place.
alter table public.voice_numbers add column if not exists country text not null default 'NG';
alter table public.voice_numbers add column if not exists provider_number_id text;
alter table public.voice_numbers add column if not exists voice_credential_id text;
alter table public.voice_numbers add column if not exists voice_phone_id text;
alter table public.voice_numbers add column if not exists provider_endpoint_id text;
alter table public.voice_numbers add column if not exists error text;
alter table public.voice_numbers add column if not exists created_by uuid;
alter table public.voice_numbers add column if not exists released_at timestamptz;
update public.voice_numbers set provider_number_id = coalesce(provider_number_id, krosai_number_id);
alter table public.voice_numbers drop constraint if exists voice_numbers_status_check;
alter table public.voice_numbers add constraint voice_numbers_status_check check (status in ('provisioning','active','paused','failed','released'));
alter table public.voice_numbers alter column status set default 'provisioning';
-- A released number can be bought again later: uniqueness only among live numbers (voice_numbers_live).
alter table public.voice_numbers drop constraint if exists voice_numbers_e164_key;
