-- AI Social Media Creative Director: brands, research, strategy, calendar, approvals, generation,
-- quotas and an auditable usage ledger. Tenant = workspace (the organisation); a workspace can run
-- several brands. Members read their workspace's rows; every write goes through the server.

create table if not exists public.creative_brands (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  profile jsonb not null default '{}',          -- website, industry, location, products, audience, objectives, voice...
  asset_paths text[] not null default '{}',     -- uploaded logos, product photos, guidelines (private bucket)
  onboarding_step int not null default 1,
  research_prefs jsonb not null default '{"depth":"standard","geo":"Nigeria","platforms":["instagram","tiktok","facebook"]}',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists creative_brands_ws on public.creative_brands(workspace_id);

create table if not exists public.creative_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brand_id uuid not null references public.creative_brands(id) on delete cascade,
  kind text not null check (kind in ('competitor','inspiration','leader','campaign')),
  platform text,
  handle_or_url text not null,
  notes text,
  source text not null default 'user' check (source in ('user','suggested')),
  accepted boolean not null default true,       -- suggestions start false until the user accepts
  created_at timestamptz not null default now(),
  unique (brand_id, kind, handle_or_url)
);

create table if not exists public.research_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brand_id uuid not null references public.creative_brands(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','running','completed','failed')),
  prefs jsonb not null default '{}',
  report jsonb,                                  -- validated report; every claim cites source ids
  limitations text[],
  searches_used int not null default 0,
  cost_usd numeric(12,6) not null default 0,
  error text,
  created_by uuid,
  started_at timestamptz, finished_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists research_runs_brand on public.research_runs(brand_id, created_at desc);

create table if not exists public.research_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  run_id uuid not null references public.research_runs(id) on delete cascade,
  url text not null,
  title text,
  source_name text,
  page_age text,                                 -- as reported by the search engine
  retrieved_at timestamptz not null default now(),
  unique (run_id, url)
);

create table if not exists public.creative_strategies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brand_id uuid not null references public.creative_brands(id) on delete cascade,
  research_run_id uuid references public.research_runs(id) on delete set null,
  version int not null default 1,
  status text not null default 'awaiting_approval' check (status in ('generating','awaiting_approval','approved','rejected','revision_requested','superseded','failed')),
  content jsonb,
  feedback text,
  approved_by uuid, approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.content_calendars (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brand_id uuid not null references public.creative_brands(id) on delete cascade,
  strategy_id uuid not null references public.creative_strategies(id) on delete cascade,
  month date not null,
  status text not null default 'draft' check (status in ('generating','draft','awaiting_approval','approved','rejected','failed')),
  feedback text,
  approved_by uuid, approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.content_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brand_id uuid not null references public.creative_brands(id) on delete cascade,
  calendar_id uuid not null references public.content_calendars(id) on delete cascade,
  position int not null default 0,
  planned_date date,
  platform text not null,
  format text not null,
  pillar text, campaign text,
  idea jsonb not null,                           -- concept, hook, caption/script, CTA, visual, shots, rationale, measure...
  status text not null default 'draft' check (status in ('draft','awaiting_approval','approved','rejected','revision_requested',
    'generation_queued','generating','generated','completed','failed','cancelled')),
  version int not null default 1,
  feedback text,
  approved_by uuid, approved_at timestamptz,
  spec jsonb,                                    -- production spec, prepared after approval
  spec_model_id uuid,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists content_items_cal on public.content_items(calendar_id, position);

create table if not exists public.approval_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  entity text not null check (entity in ('strategy','calendar','item','generation')),
  entity_id uuid not null,
  action text not null check (action in ('approve','reject','request_revision','edit','regenerate','authorize_generation','cancel')),
  actor uuid,
  note text,
  details jsonb,
  created_at timestamptz not null default now()
);
create index if not exists approval_events_entity on public.approval_events(entity, entity_id, created_at);

-- Media models an admin enabled, with their price. Nothing is enabled by default.
create table if not exists public.provider_models (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'higgsfield',
  endpoint text not null,                        -- Higgsfield model path, e.g. higgsfield-ai/soul/v2/standard
  name text not null,
  kind text not null check (kind in ('image','video')),
  unit text not null check (unit in ('image','second')),
  usd_per_unit numeric(12,6) not null check (usd_per_unit > 0),
  allowed_params text[] not null default '{prompt}',   -- only these keys are sent to the provider
  max_seconds int,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (provider, endpoint)
);

create table if not exists public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brand_id uuid not null references public.creative_brands(id) on delete cascade,
  item_id uuid not null references public.content_items(id) on delete cascade,
  model_id uuid not null references public.provider_models(id),
  spec jsonb not null,                           -- validated production spec (prompt, aspect, duration...)
  input jsonb not null,                          -- exactly what was sent to the provider
  idempotency_key text not null unique,
  provider_request_id text,
  status_url text,                               -- as returned by Higgsfield; used for polling
  status text not null default 'authorized' check (status in ('authorized','submitting','queued','in_progress','completed','failed','nsfw','canceled','uncertain','stored')),
  est_cost_usd numeric(12,6) not null,
  actual_cost_usd numeric(12,6),
  reservation_id uuid,
  output_paths text[] not null default '{}',
  error text,
  attempts int not null default 0,
  authorized_by uuid not null,
  submitted_at timestamptz, finished_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists generation_jobs_poll on public.generation_jobs(status, submitted_at) where status in ('queued','in_progress','uncertain','completed');

-- Quotas: any level can set a limit per resource and period; all applicable limits must have room.
create table if not exists public.quota_policies (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('platform','plan','org','brand','user')),
  scope_id text,                                 -- plan id, workspace id, brand id or user id (null for platform)
  resource text not null check (resource in ('claude_usd','claude_tokens','research_requests','image_generations','video_generations','media_usd')),
  period text not null check (period in ('day','month')),
  limit_amount numeric(14,6) not null check (limit_amount >= 0),
  max_batch int,
  max_concurrent int,
  enabled boolean not null default true,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  unique nulls not distinct (scope, scope_id, resource, period)
);

create table if not exists public.budget_reservations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brand_id uuid, user_id uuid,
  resource text not null,
  amount numeric(14,6) not null,
  status text not null default 'held' check (status in ('held','settled','released')),
  job_ref text not null,
  settled_amount numeric(14,6),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (job_ref, resource)
);
create index if not exists budget_reservations_held on public.budget_reservations(workspace_id, resource, status);

create table if not exists public.usage_ledger (
  id bigserial primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brand_id uuid, user_id uuid,
  resource text not null,
  amount numeric(14,6) not null,
  kind text not null check (kind in ('hold','charge')),           -- hold = budget reserved; charge = usage booked
  basis text not null check (basis in ('estimate','actual')),    -- how sure the figure is
  provider text, model text, job_ref text, reservation_id uuid,
  period_month date not null default date_trunc('month', now())::date,
  created_at timestamptz not null default now()
);
create index if not exists usage_ledger_ws on public.usage_ledger(workspace_id, resource, created_at desc);

create table if not exists public.creative_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brand_id uuid not null references public.creative_brands(id) on delete cascade,
  item_id uuid references public.content_items(id) on delete set null,
  job_id uuid references public.generation_jobs(id) on delete set null,
  path text not null,
  kind text not null,
  content_type text,
  bytes bigint,
  created_at timestamptz not null default now()
);

-- RLS: members read their own workspace's rows. provider_models and quota_policies are readable by any
-- signed-in member (prices and limits are shown in the UI), never writable from the browser.
do $$
declare t text;
begin
  foreach t in array array['creative_brands','creative_accounts','research_runs','research_sources','creative_strategies',
    'content_calendars','content_items','approval_events','generation_jobs','budget_reservations','usage_ledger','creative_assets'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_member_read', t);
    execute format('create policy %I on public.%I for select using (public.is_member(workspace_id))', t || '_member_read', t);
  end loop;
end $$;
alter table public.provider_models enable row level security;
alter table public.quota_policies enable row level security;
drop policy if exists provider_models_read on public.provider_models;
create policy provider_models_read on public.provider_models for select to authenticated using (true);
drop policy if exists quota_policies_read on public.quota_policies;
create policy quota_policies_read on public.quota_policies for select to authenticated using (scope in ('platform','plan') or public.is_member(scope_id::uuid) or scope_id = auth.uid()::text);

insert into storage.buckets (id, name, public) values ('creative-assets', 'creative-assets', false) on conflict do nothing;

-- Used amount for one policy in its current period: booked charges plus open holds.
create or replace function public.quota_used(p_scope text, p_scope_id text, p_resource text, p_period text)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare since timestamptz := case when p_period = 'day' then date_trunc('day', now()) else date_trunc('month', now()) end;
        ids uuid[]; charged numeric; held numeric;
begin
  if p_scope = 'plan' then select array_agg(workspace_id) into ids from platform_subscriptions where plan_id = p_scope_id;
  elsif p_scope = 'org' then ids := array[p_scope_id::uuid]; end if;
  select coalesce(sum(amount), 0) into charged from usage_ledger
   where resource = p_resource and kind = 'charge' and created_at >= since
     and (p_scope = 'platform' or (p_scope in ('plan','org') and workspace_id = any(ids))
          or (p_scope = 'brand' and brand_id::text = p_scope_id) or (p_scope = 'user' and user_id::text = p_scope_id));
  select coalesce(sum(amount), 0) into held from budget_reservations
   where resource = p_resource and status = 'held'
     and (p_scope = 'platform' or (p_scope in ('plan','org') and workspace_id = any(ids))
          or (p_scope = 'brand' and brand_id::text = p_scope_id) or (p_scope = 'user' and user_id::text = p_scope_id));
  return charged + held;
end $$;

/*
  Atomically checks every applicable limit and holds the amount. Raises QUOTA:<scope>:<period>:<limit>:<used>
  when one would be exceeded, or NOT_CONFIGURED when no platform cap exists for a money resource (paid
  generation is off until an admin sets one). A platform-wide lock serialises reservations per resource,
  so parallel tabs, retries and concurrent jobs cannot overspend.
*/
create or replace function public.reserve_budget(p_ws uuid, p_brand uuid, p_user uuid, p_resource text, p_amount numeric, p_job_ref text)
returns uuid language plpgsql security definer set search_path = public as $$
declare pol record; used numeric; plan_id text; res_id uuid; has_platform boolean;
begin
  if p_amount < 0 then raise exception 'BAD_AMOUNT'; end if;
  perform pg_advisory_xact_lock(hashtext('budget:' || p_resource));
  select id into res_id from budget_reservations where job_ref = p_job_ref and resource = p_resource;
  if res_id is not null then return res_id; end if;              -- idempotent retry
  select s.plan_id into plan_id from platform_subscriptions s where s.workspace_id = p_ws;
  select exists(select 1 from quota_policies where scope = 'platform' and resource = p_resource and enabled) into has_platform;
  if p_resource in ('media_usd','claude_usd') and not has_platform then raise exception 'NOT_CONFIGURED:%', p_resource; end if;
  for pol in select * from quota_policies q where q.resource = p_resource and q.enabled and (
      q.scope = 'platform' or (q.scope = 'plan' and q.scope_id = plan_id) or (q.scope = 'org' and q.scope_id = p_ws::text)
      or (q.scope = 'brand' and q.scope_id = p_brand::text) or (q.scope = 'user' and q.scope_id = p_user::text)) loop
    used := quota_used(pol.scope, pol.scope_id, p_resource, pol.period);
    if used + p_amount > pol.limit_amount then
      raise exception 'QUOTA:%:%:%:%', pol.scope, pol.period, pol.limit_amount, used;
    end if;
  end loop;
  insert into budget_reservations (workspace_id, brand_id, user_id, resource, amount, job_ref)
    values (p_ws, p_brand, p_user, p_resource, p_amount, p_job_ref) returning id into res_id;
  insert into usage_ledger (workspace_id, brand_id, user_id, resource, amount, kind, basis, job_ref, reservation_id)
    values (p_ws, p_brand, p_user, p_resource, p_amount, 'hold', 'estimate', p_job_ref, res_id);
  return res_id;
end $$;

-- Closes a hold with the actual amount (0 = nothing was charged). Idempotent.
-- p_basis = 'actual' when the provider reported the real usage, 'estimate' when we priced it ourselves
-- (Higgsfield doesn't return a per-request charge, so media is booked at the configured price, labelled).
create or replace function public.settle_budget(p_res uuid, p_actual numeric, p_provider text, p_model text, p_basis text default 'actual')
returns void language plpgsql security definer set search_path = public as $$
declare r budget_reservations%rowtype;
begin
  select * into r from budget_reservations where id = p_res for update;
  if not found or r.status <> 'held' then return; end if;
  update budget_reservations set status = case when p_actual > 0 then 'settled' else 'released' end, settled_amount = p_actual, closed_at = now() where id = p_res;
  if p_actual > 0 then
    -- Settled usage counts against quotas whatever its basis; the basis says how sure the figure is.
    insert into usage_ledger (workspace_id, brand_id, user_id, resource, amount, kind, basis, provider, model, job_ref, reservation_id)
      values (r.workspace_id, r.brand_id, r.user_id, r.resource, p_actual, 'charge', case when p_basis = 'estimate' then 'estimate' else 'actual' end, p_provider, p_model, r.job_ref, p_res);
  end if;
end $$;

revoke all on function public.quota_used(text, text, text, text) from public, anon, authenticated;
revoke all on function public.reserve_budget(uuid, uuid, uuid, text, numeric, text) from public, anon, authenticated;
revoke all on function public.settle_budget(uuid, numeric, text, text, text) from public, anon, authenticated;
grant execute on function public.quota_used(text, text, text, text) to service_role;
grant execute on function public.reserve_budget(uuid, uuid, uuid, text, numeric, text) to service_role;
grant execute on function public.settle_budget(uuid, numeric, text, text, text) to service_role;

-- Count-based resources (generations, research requests) use the same functions with amount = count.
-- Sensible starting limits; admins change them in /admin without code changes.
-- Media spend (media_usd) is deliberately NOT seeded: paid generation stays off until an admin sets a cap.
insert into public.quota_policies (scope, scope_id, resource, period, limit_amount) values
  ('platform', null, 'claude_usd', 'month', 50),
  ('platform', null, 'research_requests', 'month', 2000)
on conflict do nothing;
