-- Early-payment bonus: pay by transfer inside the chat countdown and pay the discounted amount.
alter table public.business_payment_settings
  add column early_pay_bonus_pct int not null default 0 check (early_pay_bonus_pct between 0 and 15);
alter table public.orders
  add column early_total_kobo bigint check (early_total_kobo is null or early_total_kobo >= 0);

-- What the assistant should know about the business (delivery times, hours, areas, returns).
alter table public.workspaces
  add column business_profile jsonb not null default '{}'::jsonb;
