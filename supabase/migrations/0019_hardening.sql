-- HeimCheck L4/L5: pin search_path on the bank lock trigger; logged-out visitors can't call membership checks.
alter function public.lock_bank_columns() set search_path = public;
revoke execute on function public.is_member(uuid) from anon;
revoke execute on function public.is_manager(uuid) from anon;
