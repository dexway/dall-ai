-- Harvey learns each business from what Dall AI already holds (sign-up, assistant, Content Creator,
-- catalogue, promotions, competitors), the way Harvey's trainer learns a product from its website.
-- The result is cached here; owner corrections stay in the existing columns and win over it.
alter table public.harvey_settings add column if not exists knowledge jsonb;
alter table public.harvey_settings add column if not exists knowledge_at timestamptz;
alter table public.harvey_settings add column if not exists do_not_contact text[] not null default '{}';
-- Opt-outs are permanent (Harvey's hard rule); angry or legal replies go to a human.
alter table public.harvey_prospects add column if not exists opted_out boolean not null default false;
alter table public.harvey_prospects add column if not exists needs_human text;
-- Why a draft failed the pre-send gate, shown to the owner.
alter table public.harvey_messages add column if not exists gate jsonb;
