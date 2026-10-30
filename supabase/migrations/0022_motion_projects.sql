-- Motion video projects: the owner's editable brief and the production pack Dall AI drafts from the
-- business's own photos (asset review, enhancement edits, storyboard and Higgsfield prompts).
-- Everything here is a plan; generation still goes through the approved, budgeted job flow.

create table if not exists public.motion_projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brand_id uuid not null references public.creative_brands(id) on delete cascade,
  brief jsonb not null default '{}',
  pack jsonb,
  photos text[] not null default '{}',          -- the asset paths the pack was drafted from
  status text not null default 'draft' check (status in ('draft','drafting','ready','approved','failed')),
  version int not null default 1,
  error text,
  created_by uuid,
  approved_by uuid, approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists motion_projects_brand on public.motion_projects(brand_id, created_at desc);
alter table public.motion_projects enable row level security;
drop policy if exists motion_projects_member_read on public.motion_projects;
create policy motion_projects_member_read on public.motion_projects for select using (public.is_member(workspace_id));

-- Once a business has given its website, the scheduler prepares a launch video draft from what it knows
-- and the dashboard offers it once in a pop-up. One offer per business; the owner can accept or dismiss.
create table if not exists public.launch_video_offers (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  brand_id uuid references public.creative_brands(id) on delete set null,
  project_id uuid references public.motion_projects(id) on delete set null,
  website text,
  status text not null default 'pending' check (status in ('pending','accepted','dismissed')),
  created_at timestamptz not null default now(),
  responded_at timestamptz
);
alter table public.launch_video_offers enable row level security;
drop policy if exists launch_video_offers_member_read on public.launch_video_offers;
create policy launch_video_offers_member_read on public.launch_video_offers for select using (public.is_member(workspace_id));
