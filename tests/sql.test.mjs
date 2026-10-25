// Runs the real migration in an in-process Postgres (PGlite) with minimal stand-ins for
// Supabase's auth and storage schemas, then checks money, credits and tenant isolation.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const OWNER_A = "11111111-1111-1111-1111-111111111111";
const OWNER_B = "22222222-2222-2222-2222-222222222222";
let wsA, wsB;

async function as(user, fn) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}
const one = async (sql, params) => (await db.query(sql, params)).rows[0];

before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema storage;
    create table auth.users (id uuid primary key, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table storage.buckets (id text primary key, name text, public boolean);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;
    grant usage on schema auth, storage, public to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;
  `);
  await db.exec(readFileSync(new URL("../supabase/migrations/0001_init.sql", import.meta.url), "utf8"));
  await db.exec(`grant select, insert, update, delete on all tables in schema public to authenticated;
                 grant usage on all sequences in schema public to authenticated;`);
  await db.exec(`insert into auth.users (id) values ('${OWNER_A}'), ('${OWNER_B}')`);
  wsA = await as(OWNER_A, async () => (await one(`select create_workspace('Mama Put Kitchen','mama-put','food') as id`)).id);
  wsB = await as(OWNER_B, async () => (await one(`select create_workspace('Glow Salon','glow-salon','beauty') as id`)).id);
});

const balance = async (ws) => Number((await one(`select credit_balance($1) as b`, [ws])).b);

test("new workspace gets trial credits, agent and payment settings exactly once", async () => {
  assert.equal(await balance(wsA), 150);
  assert.equal((await one(`select count(*)::int c from agents where workspace_id=$1`, [wsA])).c, 1);
  const again = await one(`select grant_credits($1::uuid, 150, 'grant', 'trial:' || $1::text, 'dup', null) as ok`, [wsA]);
  assert.equal(again.ok, false, "duplicate grant key must be ignored");
  assert.equal(await balance(wsA), 150);
});

test("reserve then settle charges actual usage, not the hold", async () => {
  const res = (await one(`select reserve_credits($1, 20, 'chat') as id`, [wsA])).id;
  assert.equal(await balance(wsA), 130);
  await db.query(`select settle_reservation($1, true, 1.37, 'claude-sonnet-5-5', 'chat', 1200, 200, 0, 0, 'req_1', '2026-10-v1', 0.0137, null, null, null, null)`, [res]);
  assert.equal(await balance(wsA), 148.63);
  // settling twice (retry / duplicate callback) must not double charge
  await db.query(`select settle_reservation($1, true, 1.37, 'claude-sonnet-5-5', 'chat', 1200, 200, 0, 0, 'req_1', '2026-10-v1', 0.0137, null, null, null, null)`, [res]);
  assert.equal(await balance(wsA), 148.63);
  assert.equal((await one(`select count(*)::int c from ai_usage_events where reservation_id=$1`, [res])).c, 1);
});

test("failed request with no billable usage costs nothing", async () => {
  const before = await balance(wsA);
  const res = (await one(`select reserve_credits($1, 5, 'chat') as id`, [wsA])).id;
  await db.query(`select settle_reservation($1, false, 0, 'claude-sonnet-5-5', 'chat', 0, 0, 0, 0, null, '2026-10-v1', 0, null, null, null, 'timeout')`, [res]);
  assert.equal(await balance(wsA), before);
});

test("cannot reserve more than the balance", async () => {
  await assert.rejects(db.query(`select reserve_credits($1, 99999, 'chat')`, [wsB]), /INSUFFICIENT_CREDITS/);
  assert.equal(await balance(wsB), 150);
});

test("concurrency cap: holds beyond the plan's max_concurrent are refused", async () => {
  const a = (await one(`select reserve_credits($1, 1, 'chat') as id`, [wsB])).id;
  const b = (await one(`select reserve_credits($1, 1, 'chat') as id`, [wsB])).id;
  await assert.rejects(db.query(`select reserve_credits($1, 1, 'chat')`, [wsB]), /TOO_MANY_CONCURRENT/); // trial allows 2
  for (const id of [a, b]) await db.query(`select settle_reservation($1, false, 0, 'm', 'chat', 0,0,0,0, null, null, 0, null, null, null, null)`, [id]);
});

test("expired holds are returned to the balance", async () => {
  const before = await balance(wsB);
  const id = (await one(`select reserve_credits($1, 10, 'chat') as id`, [wsB])).id;
  await db.query(`update ai_usage_reservations set expires_at = now() - interval '1 minute' where id=$1`, [id]);
  await db.query(`select reserve_credits($1, 1, 'chat')`, [wsB]); // triggers expiry sweep
  assert.equal(await balance(wsB), before - 1);
});

test("suspended workspace cannot spend", async () => {
  await db.query(`update workspaces set status='suspended' where id=$1`, [wsB]);
  await assert.rejects(db.query(`select reserve_credits($1, 1, 'chat')`, [wsB]), /WORKSPACE_SUSPENDED/);
  await db.query(`update workspaces set status='active' where id=$1`, [wsB]);
});

test("global kill switch stops all AI spend", async () => {
  await db.query(`update platform_spend_limits set ai_enabled=false`);
  await assert.rejects(db.query(`select reserve_credits($1, 1, 'chat')`, [wsA]), /AI_DISABLED/);
  await db.query(`update platform_spend_limits set ai_enabled=true`);
});

test("ended trial blocks spend until a plan is bought", async () => {
  await db.query(`update platform_subscriptions set current_period_end = now() - interval '1 day' where workspace_id=$1`, [wsB]);
  await assert.rejects(db.query(`select reserve_credits($1, 1, 'chat')`, [wsB]), /TRIAL_ENDED/);
  await db.query(`update platform_subscriptions set status='active', plan_id='starter', current_period_end = now() + interval '30 days' where workspace_id=$1`, [wsB]);
  const r = (await one(`select reserve_credits($1, 1, 'chat') as id`, [wsB])).id;
  await db.query(`select settle_reservation($1, false, 0, 'm', 'chat', 0,0,0,0, null, null, 0, null, null, null, null)`, [r]);
});

test("ledger and audit logs are append-only", async () => {
  await assert.rejects(db.query(`update usage_credit_ledger set delta = 1000000`), /append-only/);
  await assert.rejects(db.query(`delete from billing_audit_logs`), /append-only/);
});

test("tenant isolation: owner B cannot see or edit A's data", async () => {
  await db.query(`insert into catalogue_items (workspace_id, name, price_kobo) values ($1, 'Jollof + chicken', 350000)`, [wsA]);
  await as(OWNER_B, async () => {
    assert.equal((await one(`select count(*)::int c from catalogue_items where workspace_id=$1`, [wsA])).c, 0);
    assert.equal((await one(`select count(*)::int c from usage_credit_ledger where workspace_id=$1`, [wsA])).c, 0);
    await assert.rejects(db.query(`insert into catalogue_items (workspace_id, name, price_kobo) values ($1, 'x', 1)`, [wsA]), /row-level security/);
    const upd = await db.query(`update catalogue_items set price_kobo = 1 where workspace_id=$1`, [wsA]);
    assert.equal(upd.affectedRows ?? 0, 0);
    await assert.rejects(db.query(`select reserve_credits($1, 1, 'x')`, [wsA]), /permission denied/);
    assert.equal((await one(`select credit_balance($1) as b`, [wsA])).b, null, "must not read another tenant's balance");
    assert.ok(Number((await one(`select credit_balance($1) as b`, [wsB])).b) > 0, "can read own balance");
    await assert.rejects(db.query(`select grant_credits($1, 1000, 'grant', 'hack', 'x', null)`, [wsB]), /permission denied/);
  });
  await as(OWNER_A, async () => {
    assert.equal((await one(`select count(*)::int c from catalogue_items where workspace_id=$1`, [wsA])).c, 1);
  });
});

test("browser role cannot read the stored Paystack secret", async () => {
  await db.query(`insert into business_payment_secrets (workspace_id, paystack_secret_enc) values ($1, 'enc')`, [wsA]);
  await as(OWNER_A, async () => {
    // RLS on with no policies: the browser role sees nothing and changes nothing
    assert.equal((await db.query(`select paystack_secret_enc from business_payment_secrets`)).rows.length, 0);
    const upd = await db.query(`update business_payment_secrets set paystack_secret_enc='x'`);
    assert.equal(upd.affectedRows ?? 0, 0);
    assert.ok(await one(`select bank_name from business_payment_settings where workspace_id=$1`, [wsA]));
  });
});

test("transfer evidence: only a manager confirms, once, with an audit row", async () => {
  const ord = await one(`insert into orders (workspace_id, reference, subtotal_kobo, total_kobo, status) values ($1,'MAM-TEST0001',350000,350000,'verification_pending') returning id`, [wsA]);
  const ev = await one(`insert into payment_evidence (workspace_id, order_id, file_path) values ($1,$2,'x/y.png') returning id`, [wsA, ord.id]);
  await as(OWNER_B, async () => {
    await assert.rejects(db.query(`select review_evidence($1,'approved','looks fine')`, [ev.id]), /FORBIDDEN/);
  });
  await as(OWNER_A, async () => {
    await db.query(`select review_evidence($1,'approved','Matched in GTBank app')`, [ev.id]);
    await assert.rejects(db.query(`select review_evidence($1,'approved','again')`, [ev.id]), /ALREADY_REVIEWED/);
  });
  assert.equal((await one(`select status from orders where id=$1`, [ord.id])).status, "payment_confirmed");
  assert.equal((await one(`select count(*)::int c from payments where order_id=$1 and status='confirmed'`, [ord.id])).c, 1);
  assert.equal((await one(`select count(*)::int c from financial_audit_logs where entity_id='MAM-TEST0001'`)).c, 1);
});
