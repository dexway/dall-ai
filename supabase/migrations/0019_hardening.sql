-- HeimCheck L4: pin search_path on the bank lock trigger function.
-- (L5 left as is: is_member/is_manager are used inside RLS policies, so revoking them from anon would turn
--  harmless empty results into permission errors. They only ever return false for logged-out visitors.)
alter function public.lock_bank_columns() set search_path = public;
