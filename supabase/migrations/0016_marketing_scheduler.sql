-- Every 5 minutes the database calls /api/cron/marketing to send due follow-ups.
-- The shared secret is generated inside the database (Vault) and never leaves it except in that
-- call; the app reads it back through a service-role-only function to check the caller.
-- Skipped automatically where pg_cron / pg_net / vault are unavailable (e.g. local tests).
do $outer$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net')
     or not exists (select 1 from pg_namespace where nspname = 'vault') then
    raise notice 'marketing scheduler skipped: pg_cron/pg_net/vault not available';
    return;
  end if;
  create extension if not exists pg_cron;
  create extension if not exists pg_net;
  if not exists (select 1 from vault.secrets where name = 'dall_marketing_cron') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'dall_marketing_cron', 'Bearer token for /api/cron/marketing');
  end if;

  execute $f$
    create or replace function public.marketing_cron_secret() returns text
    language sql security definer set search_path = public as $$
      select decrypted_secret from vault.decrypted_secrets where name = 'dall_marketing_cron'
    $$;
    revoke all on function public.marketing_cron_secret() from public, anon, authenticated;
    grant execute on function public.marketing_cron_secret() to service_role;
  $f$;

  perform cron.unschedule(jobid) from cron.job where jobname = 'dall-marketing';
  perform cron.schedule('dall-marketing', '*/5 * * * *', $job$
    select net.http_post(
      url := 'https://dall-ai.vercel.app/api/cron/marketing',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'dall_marketing_cron')),
      body := '{}'::jsonb,
      timeout_milliseconds := 55000
    )
  $job$);
end
$outer$;
