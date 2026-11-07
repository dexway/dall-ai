-- Read-only provider diagnostics: a platform admin (or the platform team) requests a check, the 5-minute
-- cron runs it with the server's keys and stores the providers' responses with every secret-looking field
-- removed. Used to verify integrations against real API shapes. Service role only.
create table if not exists public.provider_checks (
  id uuid primary key default gen_random_uuid(),
  requested_at timestamptz not null default now(),
  ran_at timestamptz,
  result jsonb
);
alter table public.provider_checks enable row level security;
