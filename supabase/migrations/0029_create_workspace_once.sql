-- A double-tapped "Continue" on onboarding created two businesses for one owner, 1–3 seconds apart.
-- Serialise create_workspace per user and hand back the business they already own instead of making another.
create or replace function public.create_workspace(p_name text, p_slug text, p_type text)
returns uuid language plpgsql security definer set search_path = public as $$
declare ws uuid; trial record;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN'; end if;
  perform pg_advisory_xact_lock(hashtext('create_workspace:' || auth.uid()::text));
  select workspace_id into ws from workspace_members where user_id = auth.uid() and role = 'owner' order by created_at limit 1;
  if ws is not null then return ws; end if;
  insert into workspaces (name, slug, business_type, created_by) values (p_name, p_slug, p_type, auth.uid()) returning id into ws;
  insert into workspace_members (workspace_id, user_id, role) values (ws, auth.uid(), 'owner');
  select * into trial from platform_plans where id = 'trial';
  insert into platform_subscriptions (workspace_id, plan_id, status) values (ws, 'trial', 'trialing');
  perform grant_credits(ws, trial.monthly_credits, 'grant', 'trial:' || ws, 'Free trial credits', auth.uid());
  insert into agents (workspace_id) values (ws);
  insert into business_payment_settings (workspace_id) values (ws);
  return ws;
end $$;
revoke execute on function public.create_workspace(text, text, text) from anon, public;
grant execute on function public.create_workspace(text, text, text) to authenticated;
