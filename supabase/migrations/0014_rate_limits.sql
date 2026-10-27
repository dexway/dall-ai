-- Fixed-window rate limiting for public endpoints (chat, receipts) and free-mode AI spend caps.
-- Server-only: RLS on, no policies, and the function is not callable from the browser.
create table if not exists public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (key, window_start)
);
alter table public.rate_limits enable row level security;

-- Counts one hit for `p_key` in the current window and says whether it is still within `p_limit`.
create or replace function public.hit_rate_limit(p_key text, p_limit int, p_window_seconds int)
returns boolean language plpgsql security definer set search_path = public as $$
declare w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds); n int;
begin
  insert into rate_limits (key, window_start, hits) values (p_key, w, 1)
  on conflict (key, window_start) do update set hits = rate_limits.hits + 1
  returning hits into n;
  -- Housekeeping: drop windows older than two days now and then.
  if random() < 0.01 then delete from rate_limits where window_start < now() - interval '2 days'; end if;
  return n <= p_limit;
end $$;
revoke all on function public.hit_rate_limit(text, int, int) from public, anon, authenticated;
grant execute on function public.hit_rate_limit(text, int, int) to service_role;
