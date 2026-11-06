-- The agent saves leads with upsert(..., { onConflict: "conversation_id" }), but the only unique index
-- was partial ("where conversation_id is not null"), which ON CONFLICT can't use, so every save failed.
-- A plain unique index allows the same thing: Postgres treats NULLs as distinct, so leads without a chat still fit.
drop index if exists public.leads_one_per_conversation;
create unique index if not exists leads_conversation_key on public.leads(conversation_id);
