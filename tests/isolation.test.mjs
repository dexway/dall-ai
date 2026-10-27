// Runs ALL migrations in an in-process Postgres (PGlite), then checks webhook idempotency and
// that one business can never read another business's conversations, leads, events or ads.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
let wsA, wsB;
const one = async (sql, p) => (await db.query(sql, p)).rows[0];
async function as(user, fn) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}

before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema storage;
    create table auth.users (id uuid primary key, raw_user_meta_data jsonb default '{}', email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table storage.buckets (id text primary key, name text, public boolean);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;
    grant usage on schema auth, storage, public to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;`);
  const dir = new URL("../supabase/migrations/", import.meta.url);
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), "utf8"));
  await db.exec(`grant select, insert, update, delete on all tables in schema public to authenticated;`);
  await db.exec(`insert into auth.users (id) values ('${A}'), ('${B}')`);
  wsA = await as(A, async () => (await one(`select create_workspace('Mama Put','mama-put','food') as id`)).id);
  wsB = await as(B, async () => (await one(`select create_workspace('Glow Salon','glow','beauty') as id`)).id);
  for (const [ws, tag] of [[wsA, "a"], [wsB, "b"]]) {
    const agent = (await one(`select id from agents where workspace_id = $1`, [ws])).id;
    const conv = (await one(`insert into conversations (workspace_id, agent_id, channel, external_ref, ad_id) values ($1,$2,'whatsapp','234${tag}','AD_${tag}') returning id`, [ws, agent])).id;
    await db.query(`insert into messages (conversation_id, workspace_id, role, content) values ($1,$2,'human','{"text":"hi"}')`, [conv, ws]);
    await db.query(`insert into leads (workspace_id, conversation_id, interest) values ($1,$2,'trays')`, [ws, conv]);
    await db.query(`insert into webhook_events (provider, event_key, kind, workspace_id) values ('whatsapp','msg:${tag}','message',$1)`, [ws]);
    await db.query(`insert into integration_errors (workspace_id, source, message) values ($1,'whatsapp_send','x')`, [ws]);
    const camp = (await one(`insert into ad_campaigns (workspace_id, ad_account_id, destination, daily_budget_minor) values ($1,'act_${tag}','whatsapp',200000) returning id`, [ws])).id;
    await db.query(`insert into ad_insights_daily (workspace_id, ad_campaign_id, day, spend_minor) values ($1,$2,'2026-10-26',150000)`, [ws, camp]);
  }
});

test("the same webhook event can only be stored once (provider + event key)", async () => {
  await assert.rejects(db.query(`insert into webhook_events (provider, event_key, kind) values ('whatsapp','msg:a','message')`), /duplicate key/);
  const r = await db.query(`insert into webhook_events (provider, event_key, kind) values ('whatsapp','msg:a','message') on conflict (provider, event_key) do nothing returning id`);
  assert.equal(r.rows.length, 0);
  // Same id on a different provider is a different event.
  await db.query(`insert into webhook_events (provider, event_key, kind) values ('facebook','msg:a','message')`);
});

test("a retried inbound message is stored once per business (messages.external_id)", async () => {
  const conv = (await one(`select id from conversations where workspace_id = $1`, [wsA])).id;
  await db.query(`insert into messages (conversation_id, workspace_id, role, content, external_id) values ($1,$2,'user','{"text":"x"}','wamid.R')`, [conv, wsA]);
  await assert.rejects(db.query(`insert into messages (conversation_id, workspace_id, role, content, external_id) values ($1,$2,'user','{"text":"x"}','wamid.R')`, [conv, wsA]), /duplicate key/);
});

test("tenant isolation: each owner sees only their own inbox, leads, events, errors and ad data", async () => {
  for (const [user, ws, other] of [[A, () => wsA, () => wsB], [B, () => wsB, () => wsA]]) {
    await as(user, async () => {
      for (const t of ["conversations", "messages", "leads", "webhook_events", "integration_errors", "ad_campaigns", "ad_insights_daily"]) {
        const rows = (await db.query(`select workspace_id from ${t}`)).rows;
        assert.ok(rows.length > 0, `${t}: owner should see their own rows`);
        assert.ok(rows.every((r) => r.workspace_id === ws()), `${t}: leaked another business's rows`);
        const leaked = (await db.query(`select count(*)::int n from ${t} where workspace_id = $1`, [other()])).rows[0].n;
        assert.equal(leaked, 0, `${t}: can read other workspace`);
      }
    });
  }
});

test("owners cannot write leads, webhook events or integration errors directly (server-only)", async () => {
  await as(A, async () => {
    await assert.rejects(db.query(`insert into leads (workspace_id, interest) values ($1,'x')`, [wsA]));
    await assert.rejects(db.query(`insert into webhook_events (provider, event_key, kind, workspace_id) values ('whatsapp','forged','message',$1)`, [wsA]));
    const u = await db.query(`update leads set status = 'won' where workspace_id = $1`, [wsB]);
    assert.equal(u.affectedRows ?? 0, 0);
  });
});

test("message roles allow team replies but nothing else", async () => {
  const conv = (await one(`select id from conversations where workspace_id = $1`, [wsA])).id;
  await assert.rejects(db.query(`insert into messages (conversation_id, workspace_id, role, content) values ($1,$2,'system','{}')`, [conv, wsA]), /check/);
});
