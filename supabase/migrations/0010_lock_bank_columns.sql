-- Bank name/account name/number can only be written by the server (service role) after email confirmation.
create or replace function lock_bank_columns() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('request.jwt.claim.role', true), (current_setting('request.jwt.claims', true)::jsonb ->> 'role'), '') <> 'service_role'
     and current_user not in ('postgres','service_role','supabase_admin') then
    if tg_op = 'UPDATE' and (new.bank_name is distinct from old.bank_name or new.account_name is distinct from old.account_name or new.account_number is distinct from old.account_number) then
      raise exception 'Bank details can only change after email confirmation';
    end if;
    if tg_op = 'INSERT' and (new.account_number is not null or new.bank_name is not null or new.account_name is not null) then
      raise exception 'Bank details can only change after email confirmation';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists lock_bank_columns on business_payment_settings;
create trigger lock_bank_columns before insert or update on business_payment_settings for each row execute function lock_bank_columns();
