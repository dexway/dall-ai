-- Dall AI — initial schema
-- Two separate money systems live here and never share tables:
--   A. Platform billing (the business pays Dall AI for AI credits)  -> platform_*, usage_*, ai_*, credit_*
--   B. Business commerce (the business's customers pay the business) -> orders, payments, payment_*
-- All amounts in kobo (bigint). Credits are numeric(14,4).

-- gen_random_uuid() is built into Postgres 13+; no extension needed.

-- ───────────────────────── Identity & tenancy ─────────────────────────
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  created_at timestamptz not null default now()
);

create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.platform_plans (
  id text primary key,
  name text not null,
  price_kobo bigint not null default 0,
  monthly_credits numeric(14,4) not null,
  allowed_models text[] not null,
  max_output_tokens int not null default 1024,
  requests_per_minute int not null default 20,
  max_concurrent int not null default 3,
  is_trial boolean not null default false,
  active boolean not null default true
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 2 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,40}$'),
  business_type text,
  city text default 'Lagos',
  status text not null default 'active' check (status in ('active','suspended')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner','admin','staff')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index on public.workspace_members(user_id);

create or replace function public.is_member(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from workspace_members where workspace_id = ws and user_id = auth.uid());
$$;

create or replace function public.is_manager(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from workspace_members where workspace_id = ws and user_id = auth.uid() and role in ('owner','admin'));
$$;

-- ───────────────────────── Agents (identity studio) ─────────────────────────
create table public.agents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null default 'Amaka',
  role_title text not null default 'Sales & support assistant',
  persona text not null default 'Warm, quick and clear. Speaks like a helpful Lagos shop attendant.',
  languages text[] not null default array['English','Pidgin'],
  voice_style text not null default 'lagos-english'
    check (voice_style in ('lagos-english','pidgin','yoruba','igbo','hausa')),  -- used by the speech layer when voice is connected
  greeting text not null default 'Hello! How can I help you today?',
  accent_color text not null default '#C8EE72' check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  avatar_path text,
  image_paths text[] not null default '{}',
  channels text[] not null default array['web'],
  max_discount_pct numeric(5,2) not null default 0 check (max_discount_pct between 0 and 50),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.agents(workspace_id);

-- ───────────────────────── B. Business commerce ─────────────────────────
create table public.catalogue_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null default 'product' check (kind in ('product','service','booking','class','digital','package')),
  name text not null,
  description text not null default '',
  category text,
  price_kobo bigint not null check (price_kobo >= 0),
  intro_price_kobo bigint check (intro_price_kobo is null or intro_price_kobo >= 0),
  currency text not null default 'NGN',
  stock int check (stock is null or stock >= 0),
  image_path text,
  terms text,
  fulfilment_note text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index on public.catalogue_items(workspace_id, active);

create table public.business_payment_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  bank_name text,
  account_name text,
  account_number text check (account_number is null or account_number ~ '^[0-9]{10}$'),
  transfer_instructions text,
  payment_deadline_hours int not null default 24,
  paystack_enabled boolean not null default false,
  paystack_public_key text,
  updated_at timestamptz not null default now()
);

-- Secrets live apart from settings: RLS on with no policies, so only the server (service role) can read them.
-- (A column-level REVOKE is not enough: Supabase grants table-wide SELECT to authenticated.)
create table public.business_payment_secrets (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  paystack_secret_enc text,          -- AES-256-GCM
  updated_at timestamptz not null default now()
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text,
  phone text,
  email text,
  created_at timestamptz not null default now()
);
create index on public.customers(workspace_id);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  customer_id uuid references public.customers(id),
  channel text not null default 'web',
  visitor_token uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);
create index on public.conversations(workspace_id, created_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content jsonb not null,
  created_at timestamptz not null default now()
);
create index on public.messages(conversation_id, created_at);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  reference text not null unique,
  public_token uuid not null unique default gen_random_uuid(),
  customer_id uuid references public.customers(id),
  conversation_id uuid references public.conversations(id),
  status text not null default 'order_created' check (status in (
    'order_created','awaiting_payment','payment_evidence_submitted','verification_pending',
    'payment_confirmed','payment_rejected','payment_failed','payment_expired','partially_paid',
    'refunded','order_fulfilled')),
  subtotal_kobo bigint not null,
  discount_kobo bigint not null default 0,
  total_kobo bigint not null check (total_kobo >= 0),
  currency text not null default 'NGN',
  customer_approved_at timestamptz,
  expires_at timestamptz,
  idempotency_key text,
  created_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key)
);
create index on public.orders(workspace_id, created_at desc);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  catalogue_item_id uuid references public.catalogue_items(id),
  name text not null,
  unit_price_kobo bigint not null,
  quantity int not null check (quantity between 1 and 999),
  line_total_kobo bigint not null
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  method text not null check (method in ('paystack','bank_transfer')),
  provider_reference text unique,
  gateway_transaction_id text,
  amount_kobo bigint not null,
  currency text not null default 'NGN',
  status text not null default 'pending' check (status in ('pending','confirmed','failed','rejected','refunded')),
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.payments(workspace_id, created_at desc);

create table public.payment_events (       -- commerce webhook idempotency
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  provider text not null,
  event_key text not null unique,
  payload jsonb not null,
  received_at timestamptz not null default now()
);

create table public.payment_evidence (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  file_path text not null,
  extracted jsonb,
  flags text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now()
);
create index on public.payment_evidence(workspace_id, status);

create table public.payment_verification_reviews (
  id uuid primary key default gen_random_uuid(),
  evidence_id uuid not null references public.payment_evidence(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  reviewer_id uuid not null references auth.users(id),
  decision text not null check (decision in ('approved','rejected')),
  reason text not null,
  created_at timestamptz not null default now()
);

create table public.financial_audit_logs (
  id bigserial primary key,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  actor_id uuid,
  action text not null,
  entity text not null,
  entity_id text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- ───────────────────────── A. Platform billing & AI usage ─────────────────────────
create table public.platform_subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references public.workspaces(id) on delete cascade,
  plan_id text not null references public.platform_plans(id),
  status text not null default 'trialing' check (status in ('trialing','active','past_due','cancelled','suspended')),
  current_period_start timestamptz not null default now(),
  current_period_end timestamptz not null default now() + interval '14 days',
  created_at timestamptz not null default now()
);

create table public.ai_cost_rate_cards (
  id serial primary key,
  version text not null,
  model text not null,
  input_usd_per_mtok numeric(10,4) not null,
  output_usd_per_mtok numeric(10,4) not null,
  cache_write_usd_per_mtok numeric(10,4) not null,
  cache_read_usd_per_mtok numeric(10,4) not null,
  credits_per_usd numeric(10,2) not null default 100,
  effective_from timestamptz not null default now(),
  unique (version, model)
);

create table public.ai_usage_reservations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  credits numeric(14,4) not null check (credits > 0),
  status text not null default 'held' check (status in ('held','settled','released')),
  purpose text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '5 minutes'
);
create index on public.ai_usage_reservations(workspace_id, status, created_at);

create table public.usage_credit_ledger (
  id bigserial primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  delta numeric(14,4) not null,
  kind text not null check (kind in ('grant','topup','reservation','release','usage','adjustment')),
  reference text,
  idempotency_key text not null unique,
  note text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index on public.usage_credit_ledger(workspace_id);

create table public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  reservation_id uuid unique references public.ai_usage_reservations(id),
  agent_id uuid,
  user_id uuid,
  conversation_id uuid,
  feature text not null,
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cache_creation_tokens int not null default 0,
  cache_read_tokens int not null default 0,
  provider_request_id text,
  rate_card_version text,
  est_cost_usd numeric(12,6) not null default 0,
  credits_consumed numeric(14,4) not null default 0,
  status text not null check (status in ('succeeded','failed')),
  error text,
  created_at timestamptz not null default now()
);
create index on public.ai_usage_events(workspace_id, created_at desc);

create table public.credit_top_up_orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  credits numeric(14,4) not null check (credits > 0),
  amount_kobo bigint not null check (amount_kobo > 0),
  plan_id text references public.platform_plans(id),   -- set when this purchase is a plan upgrade/renewal
  reference text not null unique,
  status text not null default 'pending' check (status in ('pending','paid','failed')),
  created_by uuid,
  created_at timestamptz not null default now()
);

create table public.platform_payment_transactions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  top_up_id uuid references public.credit_top_up_orders(id),
  provider_reference text not null unique,
  amount_kobo bigint not null,
  status text not null,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.billing_webhook_events (
  event_key text primary key,
  payload jsonb not null,
  received_at timestamptz not null default now()
);

create table public.platform_spend_limits (
  id boolean primary key default true check (id),
  ai_enabled boolean not null default true,
  global_daily_usd_cap numeric(12,2) not null default 50,
  default_model text not null default 'claude-sonnet-5-5'
);
insert into public.platform_spend_limits default values;

create table public.billing_audit_logs (
  id bigserial primary key,
  workspace_id uuid,
  actor_id uuid,
  action text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- Audit logs are append-only, even for the service role.
create or replace function public.forbid_mutation() returns trigger language plpgsql as $$
begin raise exception 'audit logs are append-only'; end $$;
create trigger financial_audit_append_only before update or delete on public.financial_audit_logs
  for each row execute function public.forbid_mutation();
create trigger billing_audit_append_only before update or delete on public.billing_audit_logs
  for each row execute function public.forbid_mutation();
create trigger ledger_append_only before update or delete on public.usage_credit_ledger
  for each row execute function public.forbid_mutation();

-- ───────────────────────── Seed: plans & rate card ─────────────────────────
-- Confirm current model prices at the Anthropic pricing page and add a new rate-card version when they change.
insert into public.platform_plans (id, name, price_kobo, monthly_credits, allowed_models, max_output_tokens, requests_per_minute, max_concurrent, is_trial) values
  ('trial',   'Free trial', 0,         150,  array['claude-haiku-5-5','claude-sonnet-5-5'], 800,  10, 2, true),
  ('starter', 'Starter',    2500000,   700,  array['claude-haiku-5-5','claude-sonnet-5-5'], 1024, 30, 3, false),
  ('growth',  'Growth',     7500000,   2500, array['claude-haiku-5-5','claude-sonnet-5-5'], 1500, 90, 8, false);

insert into public.ai_cost_rate_cards (version, model, input_usd_per_mtok, output_usd_per_mtok, cache_write_usd_per_mtok, cache_read_usd_per_mtok, credits_per_usd) values
  ('2026-10-v1', 'claude-sonnet-5-5', 3, 15, 3.75, 0.30, 100),
  ('2026-10-v1', 'claude-haiku-5-5',  1, 5,  1.25, 0.10, 100);

-- ───────────────────────── Atomic credit functions ─────────────────────────
-- Members see their own balance; the server (no auth.uid) sees any. Others get null.
create or replace function public.credit_balance(ws uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null or is_member(ws)
    then (select coalesce(sum(delta), 0) from usage_credit_ledger where workspace_id = ws) end;
$$;

-- Reserve credits before an AI call. Serialised per workspace with an advisory lock,
-- so concurrent requests cannot both spend the same balance.
create or replace function public.reserve_credits(ws uuid, amount numeric, purpose text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  bal numeric; res_id uuid; ws_status text; sub record; plan record; recent int; inflight int; limits record; spent_today numeric;
begin
  perform pg_advisory_xact_lock(hashtext('credits:' || ws::text));

  select * into limits from platform_spend_limits where id;
  if not limits.ai_enabled then raise exception 'AI_DISABLED' using errcode = 'P0001'; end if;
  select coalesce(sum(est_cost_usd),0) into spent_today from ai_usage_events where created_at > now() - interval '1 day';
  if spent_today >= limits.global_daily_usd_cap then raise exception 'GLOBAL_CAP' using errcode = 'P0001'; end if;

  select status into ws_status from workspaces where id = ws;
  if ws_status is distinct from 'active' then raise exception 'WORKSPACE_SUSPENDED' using errcode = 'P0001'; end if;

  select * into sub from platform_subscriptions where workspace_id = ws;
  if sub is null or sub.status in ('cancelled','suspended') then raise exception 'NO_SUBSCRIPTION' using errcode = 'P0001'; end if;
  if sub.status = 'trialing' and sub.current_period_end < now() then raise exception 'TRIAL_ENDED' using errcode = 'P0001'; end if;
  if sub.status in ('active','past_due') and sub.current_period_end + interval '3 days' < now() then raise exception 'PLAN_EXPIRED' using errcode = 'P0001'; end if;
  select * into plan from platform_plans where id = sub.plan_id;

  -- expire stale holds first (a crashed request must not lock credits forever)
  update ai_usage_reservations set status = 'released' where workspace_id = ws and status = 'held' and expires_at < now();
  insert into usage_credit_ledger (workspace_id, delta, kind, reference, idempotency_key, note)
    select r.workspace_id, r.credits, 'release', r.id::text, 'expire:' || r.id, 'reservation expired'
    from ai_usage_reservations r
    where r.workspace_id = ws and r.status = 'released'
      and not exists (select 1 from usage_credit_ledger l where l.idempotency_key in ('release:' || r.id, 'expire:' || r.id));

  select count(*) into recent from ai_usage_reservations where workspace_id = ws and created_at > now() - interval '1 minute';
  if recent >= plan.requests_per_minute then raise exception 'RATE_LIMITED' using errcode = 'P0001'; end if;
  select count(*) into inflight from ai_usage_reservations where workspace_id = ws and status = 'held';
  if inflight >= plan.max_concurrent then raise exception 'TOO_MANY_CONCURRENT' using errcode = 'P0001'; end if;

  select coalesce(sum(delta),0) into bal from usage_credit_ledger where workspace_id = ws;
  if bal < amount then raise exception 'INSUFFICIENT_CREDITS' using errcode = 'P0001'; end if;

  insert into ai_usage_reservations (workspace_id, credits, purpose) values (ws, amount, purpose) returning id into res_id;
  insert into usage_credit_ledger (workspace_id, delta, kind, reference, idempotency_key, note)
    values (ws, -amount, 'reservation', res_id::text, 'reserve:' || res_id, purpose);
  return res_id;
end $$;

-- Settle a reservation with the provider's actual usage. Idempotent: a second call is a no-op.
create or replace function public.settle_reservation(
  res uuid, succeeded boolean, actual_credits numeric, p_model text, p_feature text,
  p_input int, p_output int, p_cache_create int, p_cache_read int,
  p_request_id text, p_rate_version text, p_cost numeric,
  p_agent uuid, p_user uuid, p_conversation uuid, p_error text)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from ai_usage_reservations where id = res for update;
  if r is null then raise exception 'NO_RESERVATION'; end if;
  if r.status = 'settled' then return; end if;   -- already done

  -- give back the hold (unless an expiry already returned it)
  if not exists (select 1 from usage_credit_ledger where idempotency_key = 'expire:' || res) then
    insert into usage_credit_ledger (workspace_id, delta, kind, reference, idempotency_key, note)
      values (r.workspace_id, r.credits, 'release', res::text, 'release:' || res, 'reservation settled')
      on conflict (idempotency_key) do nothing;
  end if;
  -- charge what the provider actually billed (zero for a request that produced no billable usage)
  if actual_credits > 0 then
    insert into usage_credit_ledger (workspace_id, delta, kind, reference, idempotency_key, note)
      values (r.workspace_id, -actual_credits, 'usage', res::text, 'usage:' || res, p_feature)
      on conflict (idempotency_key) do nothing;
  end if;

  insert into ai_usage_events (workspace_id, reservation_id, agent_id, user_id, conversation_id, feature, model,
      input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, provider_request_id, rate_card_version,
      est_cost_usd, credits_consumed, status, error)
    values (r.workspace_id, res, p_agent, p_user, p_conversation, p_feature, p_model, p_input, p_output, p_cache_create,
      p_cache_read, p_request_id, p_rate_version, p_cost, actual_credits, case when succeeded then 'succeeded' else 'failed' end, p_error)
    on conflict (reservation_id) do nothing;

  update ai_usage_reservations set status = 'settled' where id = res;
end $$;

-- Grant credits once per idempotency key (trial grants, verified top-ups, admin adjustments).
create or replace function public.grant_credits(ws uuid, amount numeric, p_kind text, p_key text, p_note text, p_actor uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  insert into usage_credit_ledger (workspace_id, delta, kind, idempotency_key, note, created_by)
    values (ws, amount, p_kind, p_key, p_note, p_actor) on conflict (idempotency_key) do nothing;
  if not found then return false; end if;
  insert into billing_audit_logs (workspace_id, actor_id, action, details)
    values (ws, p_actor, 'credits.' || p_kind, jsonb_build_object('amount', amount, 'key', p_key, 'note', p_note));
  return true;
end $$;

-- Create a workspace for the signed-in user: membership, trial plan, starter credits, default agent.
create or replace function public.create_workspace(p_name text, p_slug text, p_type text)
returns uuid language plpgsql security definer set search_path = public as $$
declare ws uuid; trial record;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN'; end if;
  insert into workspaces (name, slug, business_type, created_by) values (p_name, p_slug, p_type, auth.uid()) returning id into ws;
  insert into workspace_members (workspace_id, user_id, role) values (ws, auth.uid(), 'owner');
  select * into trial from platform_plans where id = 'trial';
  insert into platform_subscriptions (workspace_id, plan_id, status) values (ws, 'trial', 'trialing');
  perform grant_credits(ws, trial.monthly_credits, 'grant', 'trial:' || ws, 'Free trial credits', auth.uid());
  insert into agents (workspace_id) values (ws);
  insert into business_payment_settings (workspace_id) values (ws);
  return ws;
end $$;

-- Approve or reject transfer evidence. Only managers; confirms the order only on approval by a person.
create or replace function public.review_evidence(p_evidence uuid, p_decision text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare ev record; ord record;
begin
  select * into ev from payment_evidence where id = p_evidence for update;
  if ev is null then raise exception 'NOT_FOUND'; end if;
  if not is_manager(ev.workspace_id) then raise exception 'FORBIDDEN'; end if;
  if ev.status <> 'pending' then raise exception 'ALREADY_REVIEWED'; end if;
  if p_decision not in ('approved','rejected') or length(coalesce(p_reason,'')) < 3 then raise exception 'BAD_INPUT'; end if;
  select * into ord from orders where id = ev.order_id for update;

  update payment_evidence set status = p_decision where id = p_evidence;
  insert into payment_verification_reviews (evidence_id, workspace_id, reviewer_id, decision, reason)
    values (p_evidence, ev.workspace_id, auth.uid(), p_decision, p_reason);

  if p_decision = 'approved' then
    insert into payments (workspace_id, order_id, method, provider_reference, amount_kobo, currency, status, verified_at)
      values (ev.workspace_id, ord.id, 'bank_transfer', 'transfer:' || p_evidence, ord.total_kobo, ord.currency, 'confirmed', now())
      on conflict (provider_reference) do nothing;
    update orders set status = 'payment_confirmed' where id = ord.id;
  else
    update orders set status = 'payment_rejected' where id = ord.id;
  end if;

  insert into financial_audit_logs (workspace_id, actor_id, action, entity, entity_id, details)
    values (ev.workspace_id, auth.uid(), 'evidence.' || p_decision, 'order', ord.reference,
            jsonb_build_object('evidence', p_evidence, 'reason', p_reason, 'amount_kobo', ord.total_kobo));
end $$;

-- ───────────────────────── New-user profile ─────────────────────────
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name) values (new.id, new.raw_user_meta_data->>'full_name') on conflict do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ───────────────────────── Row level security ─────────────────────────
alter table public.profiles enable row level security;
alter table public.platform_admins enable row level security;
alter table public.platform_plans enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.agents enable row level security;
alter table public.catalogue_items enable row level security;
alter table public.business_payment_settings enable row level security;
alter table public.business_payment_secrets enable row level security;
alter table public.customers enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.payment_events enable row level security;
alter table public.payment_evidence enable row level security;
alter table public.payment_verification_reviews enable row level security;
alter table public.financial_audit_logs enable row level security;
alter table public.platform_subscriptions enable row level security;
alter table public.ai_cost_rate_cards enable row level security;
alter table public.ai_usage_reservations enable row level security;
alter table public.usage_credit_ledger enable row level security;
alter table public.ai_usage_events enable row level security;
alter table public.credit_top_up_orders enable row level security;
alter table public.platform_payment_transactions enable row level security;
alter table public.billing_webhook_events enable row level security;
alter table public.platform_spend_limits enable row level security;
alter table public.billing_audit_logs enable row level security;

create policy "own profile" on public.profiles for all using (id = auth.uid()) with check (id = auth.uid());
create policy "plans readable" on public.platform_plans for select using (true);
create policy "member reads workspace" on public.workspaces for select using (is_member(id));
create policy "manager edits workspace" on public.workspaces for update using (is_manager(id)) with check (is_manager(id));
create policy "member reads members" on public.workspace_members for select using (is_member(workspace_id));

-- business data: members read, managers write
do $$ declare t text; begin
  foreach t in array array['agents','catalogue_items','customers'] loop
    execute format('create policy "member read" on public.%I for select using (is_member(workspace_id))', t);
    execute format('create policy "manager insert" on public.%I for insert with check (is_manager(workspace_id))', t);
    execute format('create policy "manager update" on public.%I for update using (is_manager(workspace_id)) with check (is_manager(workspace_id))', t);
    execute format('create policy "manager delete" on public.%I for delete using (is_manager(workspace_id))', t);
  end loop;
  -- read-only from the browser; written by the server after checks
  foreach t in array array['conversations','messages','orders','order_items','payments','payment_evidence',
      'payment_verification_reviews','financial_audit_logs','platform_subscriptions','usage_credit_ledger',
      'ai_usage_events','credit_top_up_orders','platform_payment_transactions','billing_audit_logs'] loop
    execute format('create policy "member read" on public.%I for select using (is_member(workspace_id))', t);
  end loop;
end $$;

-- payment settings: managers only. business_payment_secrets has no policies at all (server-only).
create policy "manager read settings" on public.business_payment_settings for select using (is_manager(workspace_id));
create policy "manager update settings" on public.business_payment_settings for update using (is_manager(workspace_id)) with check (is_manager(workspace_id));
revoke all on public.business_payment_secrets from anon, authenticated;

revoke execute on function public.reserve_credits(uuid, numeric, text) from anon, authenticated, public;
revoke execute on function public.settle_reservation(uuid, boolean, numeric, text, text, int, int, int, int, text, text, numeric, uuid, uuid, uuid, text) from anon, authenticated, public;
revoke execute on function public.grant_credits(uuid, numeric, text, text, text, uuid) from anon, authenticated, public;
revoke execute on function public.credit_balance(uuid) from anon, public;
grant execute on function public.credit_balance(uuid) to authenticated;
revoke execute on function public.create_workspace(text, text, text) from anon, public;
revoke execute on function public.review_evidence(uuid, text, text) from anon, public;
grant execute on function public.create_workspace(text, text, text) to authenticated;
grant execute on function public.review_evidence(uuid, text, text) to authenticated;

-- ───────────────────────── Storage ─────────────────────────
insert into storage.buckets (id, name, public) values ('brand-assets', 'brand-assets', true) on conflict do nothing;
insert into storage.buckets (id, name, public) values ('payment-evidence', 'payment-evidence', false) on conflict do nothing;

create policy "managers upload brand assets" on storage.objects for insert to authenticated
  with check (bucket_id = 'brand-assets' and is_manager(((storage.foldername(name))[1])::uuid));
create policy "managers replace brand assets" on storage.objects for update to authenticated
  using (bucket_id = 'brand-assets' and is_manager(((storage.foldername(name))[1])::uuid));
create policy "managers delete brand assets" on storage.objects for delete to authenticated
  using (bucket_id = 'brand-assets' and is_manager(((storage.foldername(name))[1])::uuid));
create policy "members read evidence" on storage.objects for select to authenticated
  using (bucket_id = 'payment-evidence' and is_member(((storage.foldername(name))[1])::uuid));
-- evidence uploads come from customers through the server (service role), never directly.

-- ───────────────────────── Hardening (from Supabase advisors) ─────────────────────────
alter function public.forbid_mutation() set search_path = public;
revoke execute on function public.handle_new_user() from anon, authenticated, public;
revoke execute on function public.forbid_mutation() from anon, authenticated, public;

-- ───────────────────────── In-chat transfer timer ─────────────────────────
alter table public.business_payment_settings
  add column if not exists payment_window_minutes int not null default 60 check (payment_window_minutes between 5 and 1440);
