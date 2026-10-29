-- New deals can also go to WhatsApp customers, using an approved template (any time, not just inside 24h).
-- The template's {{1}}..{{4}} are filled with the deal's title, offer, code and end date.

alter table public.promotions add column if not exists announce_template_name text;
alter table public.promotions add column if not exists announce_template_language text;
alter table public.promotions add column if not exists announce_template_vars int not null default 0 check (announce_template_vars between 0 and 4);

alter table public.broadcasts add column if not exists template_params text[];
