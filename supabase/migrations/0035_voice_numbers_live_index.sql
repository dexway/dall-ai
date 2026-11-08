-- A failed attempt must not block anyone (including another business) from getting that number later:
-- only numbers being set up or in use are unique.
drop index if exists public.voice_numbers_live;
create unique index if not exists voice_numbers_live on public.voice_numbers(e164) where status in ('provisioning','active','paused');
