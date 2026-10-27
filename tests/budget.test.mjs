// Budget engine and promotion claims, run against every migration in an in-process Postgres.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const A = "11111111-1111-1111-1111-111111111111", B = "22222222-2222-2222-2222-222222222222";
let wsA, wsB;
const one = async (sql, p) => (await db.query(sql, p)).rows[0];
async function as(user, fn) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}
const reserve = (ws, res, amt, ref, brand = null, user = null) => db.query(`select reserve_budget($1,$2,$3,$4,$5,$6) as id`, [ws, brand, user, res, amt, ref]);

before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth; create schema storage;
    create table auth.users (id uuid primary key, raw_user_meta_data jsonb default '{}', email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table storage.buckets (id text primary key, name text, public boolean);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;
    grant usage on schema auth, storage, public to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;`);
  const dir = new URL("../supabase/migrations/", import.meta.url);
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), "utf8"));
  await db.exec(`grant select, insert, update, delete on all tables in schema public to authenticated;`);
  await db.exec(`insert into auth.users (id) values ('${A}'), ('${B}')`);
  wsA = await as(A, async () => (await one(`select create_workspace('Mama Put','mama-put','food') as id`)).id);
  wsB = await as(B, async () => (await one(`select create_workspace('Glow','glow','beauty') as id`)).id);
});

test("paid media is OFF until an admin sets a platform cap", async () => {
  await assert.rejects(reserve(wsA, "media_usd", 0.5, "gen:1"), /NOT_CONFIGURED:media_usd/);
});

test("every level of the hierarchy is enforced independently; org cap binds even when the user has room", async () => {
  await db.exec(`insert into quota_policies (scope, scope_id, resource, period, limit_amount) values
    ('platform', null, 'media_usd', 'month', 100), ('org', '${wsA}', 'media_usd', 'month', 1.00), ('user', '${A}', 'media_usd', 'month', 50)`);
  await reserve(wsA, "media_usd", 0.6, "gen:a1", null, A);
  await assert.rejects(reserve(wsA, "media_usd", 0.5, "gen:a2", null, A), /QUOTA:org:month:1\.000000:0\.600000/);
  // Business B has no org cap: only the platform cap applies.
  await reserve(wsB, "media_usd", 5, "gen:b1", null, B);
});

test("same job reference never reserves twice (retries, double clicks, parallel tabs)", async () => {
  const r1 = await one(`select reserve_budget($1,null,null,'media_usd',0.3,'gen:dup') as id`, [wsA]);
  const r2 = await one(`select reserve_budget($1,null,null,'media_usd',0.3,'gen:dup') as id`, [wsA]);
  assert.equal(r1.id, r2.id);
  const n = (await one(`select count(*)::int n from budget_reservations where job_ref = 'gen:dup'`)).n;
  assert.equal(n, 1);
});

test("holds count until settled; failed jobs release budget, settled ones are charged once", async () => {
  const used = async () => Number((await one(`select quota_used('org', $1, 'media_usd', 'month') as u`, [wsA])).u);
  assert.equal(await used(), 0.9);                                   // 0.6 + 0.3 held
  const dup = (await one(`select id from budget_reservations where job_ref = 'gen:dup'`)).id;
  await db.query(`select settle_budget($1, 0, 'higgsfield', 'm', 'estimate')`, [dup]);       // failed job → released
  assert.equal(await used(), 0.6);
  const a1 = (await one(`select id from budget_reservations where job_ref = 'gen:a1'`)).id;
  await db.query(`select settle_budget($1, 0.6, 'higgsfield', 'm', 'estimate')`, [a1]);
  await db.query(`select settle_budget($1, 0.6, 'higgsfield', 'm', 'estimate')`, [a1]);      // idempotent
  assert.equal(await used(), 0.6);
  const charges = (await one(`select count(*)::int n from usage_ledger where job_ref = 'gen:a1' and kind = 'charge'`)).n;
  assert.equal(charges, 1);
  assert.equal((await one(`select basis from usage_ledger where job_ref = 'gen:a1' and kind = 'charge'`)).basis, "estimate");
  await reserve(wsA, "media_usd", 0.4, "gen:a3", null, A);           // exactly fills the $1 cap
  await assert.rejects(reserve(wsA, "media_usd", 0.01, "gen:a4", null, A), /QUOTA:org/);
});

test("a raised cap takes effect immediately; last month's usage doesn't count this month", async () => {
  await db.exec(`update quota_policies set limit_amount = 2 where scope = 'org' and scope_id = '${wsA}'`);
  await reserve(wsA, "media_usd", 0.5, "gen:a5", null, A);
  await db.exec(`update usage_ledger set created_at = created_at - interval '40 days' where workspace_id = '${wsA}' and kind = 'charge'`);
  const u = Number((await one(`select quota_used('org', $1, 'media_usd', 'month') as u`, [wsA])).u);
  assert.equal(u, 0.9);                                              // only the two open holds (0.4 + 0.5)
});

test("signed-in users can't call the budget functions or write quotas/ledger; they only see their own", async () => {
  await as(A, async () => {
    await assert.rejects(db.query(`select reserve_budget('${wsA}', null, null, 'media_usd', 0, 'x')`), /permission denied/);
    await assert.rejects(db.query(`select settle_budget('00000000-0000-0000-0000-000000000000', 0, 'p', 'm', 'actual')`), /permission denied/);
    await assert.rejects(db.query(`insert into quota_policies (scope, resource, period, limit_amount) values ('platform','media_usd','month',1e9)`));
    const rows = (await db.query(`select distinct workspace_id from usage_ledger`)).rows;
    assert.ok(rows.every((r) => r.workspace_id === wsA));
    const holds = (await db.query(`select * from budget_reservations where workspace_id = '${wsB}'`)).rows;
    assert.equal(holds.length, 0);
  });
});

test("promotion uses are claimed atomically and stop at the limit", async () => {
  const p = (await one(`insert into promotions (workspace_id, code, title, kind, value, max_uses) values ($1,'TEN','Ten off','percent',10,2) returning id`, [wsA])).id;
  const claim = async () => (await one(`select claim_promo_use($1) as ok`, [p])).ok;
  assert.equal(await claim(), true); assert.equal(await claim(), true); assert.equal(await claim(), null);
  await db.exec(`update promotions set ends_at = now() - interval '1 minute', uses = 0 where id = '${p}'`);
  assert.equal(await claim(), null);
  await as(A, async () => { await assert.rejects(db.query(`select claim_promo_use('${p}')`), /permission denied/); });
  await assert.rejects(db.query(`insert into promotions (workspace_id, code, title, kind, value) values ($1,'BIG','x','percent',95)`, [wsA]), /check/);
});

test("creative data is isolated between businesses", async () => {
  const brand = (await one(`insert into creative_brands (workspace_id, name) values ($1,'Mama Put') returning id`, [wsA])).id;
  await db.query(`insert into creative_accounts (workspace_id, brand_id, kind, handle_or_url) values ($1,$2,'competitor','@rival')`, [wsA, brand]);
  await as(B, async () => {
    for (const t of ["creative_brands", "creative_accounts", "budget_reservations", "promotions"]) {
      const n = (await one(`select count(*)::int n from ${t} where workspace_id = $1`, [wsA])).n;
      assert.equal(n, 0, t);
    }
  });
});
