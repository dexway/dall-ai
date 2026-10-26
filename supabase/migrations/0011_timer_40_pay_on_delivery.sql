alter table business_payment_settings alter column payment_window_minutes set default 40;
update business_payment_settings set payment_window_minutes = 40 where payment_window_minutes = 60;
alter table business_payment_settings add column if not exists pay_on_delivery_enabled boolean not null default false;
alter table orders add column if not exists pay_on_delivery boolean not null default false;
