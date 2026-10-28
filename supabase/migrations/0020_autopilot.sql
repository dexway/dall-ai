-- Marketing autopilot: announce new deals to opted-in customers, auto-plan next month, auto-generate within
-- the owner's own cap, and publish approved posts to Facebook and Instagram on their planned date.

alter table public.promotions add column if not exists announce boolean not null default false;
alter table public.promotions add column if not exists announce_message text;
alter table public.promotions add column if not exists announced_at timestamptz;

alter table public.content_items add column if not exists publish_status text check (publish_status in ('scheduled','publishing','published','failed','skipped'));
alter table public.content_items add column if not exists publish_at timestamptz;
alter table public.content_items add column if not exists published_at timestamptz;
alter table public.content_items add column if not exists post_refs jsonb not null default '{}';
alter table public.content_items add column if not exists publish_error text;
alter table public.content_items add column if not exists publish_attempts int not null default 0;
create index if not exists content_items_due on public.content_items(publish_status, publish_at) where publish_status = 'scheduled';

create table if not exists public.creative_autopilot (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  brand_id uuid references public.creative_brands(id) on delete set null,
  auto_plan boolean not null default false,       -- draft next month's calendar on the 20th (owner still approves items)
  auto_generate boolean not null default false,   -- generate approved items 3 days before their date, within the cap
  auto_publish boolean not null default false,    -- post approved, generated items on their date
  monthly_media_cap_usd numeric(12,4) not null default 0 check (monthly_media_cap_usd >= 0),
  publish_hour int not null default 18 check (publish_hour between 0 and 23),   -- Lagos time
  channels text[] not null default '{facebook,instagram}',
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.creative_autopilot enable row level security;
drop policy if exists creative_autopilot_member_read on public.creative_autopilot;
create policy creative_autopilot_member_read on public.creative_autopilot for select using (public.is_member(workspace_id));
