-- Harvey works without being asked: competitors are listed automatically (OpenStreetMap, no AI), and
-- when learning fails (for example the AI provider is unavailable) the reason is shown instead of
-- "learning…" forever, and retried later rather than on every page view.
alter table public.harvey_settings add column if not exists learn_error text;
alter table public.harvey_settings add column if not exists learn_tried_at timestamptz;
alter table public.harvey_settings add column if not exists competitors_listed_at timestamptz;
alter table public.harvey_competitors add column if not exists source text not null default 'owner';
alter table public.harvey_competitors add column if not exists phone text;
alter table public.harvey_competitors add column if not exists area text;
