import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '../../.orca/sql-check/node_modules/@electric-sql/pglite/dist/index.js';

const db = new PGlite();
const a = '00000000-0000-4000-8000-000000000061';
const b = '00000000-0000-4000-8000-000000000062';
const run = '00000000-0000-4000-8000-000000000063';
const id = `solo-v1:${run}`;
const migrations = new URL('../migrations/', import.meta.url);
async function user(owner, sql, params = []) {
  await db.exec('SET ROLE authenticated');
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [owner]);
  try { return (await db.query(sql, params)).rows[0]?.result; }
  finally { await db.exec('RESET ROLE'); }
}
const lookup = (owner, settlement = id) => user(owner, 'SELECT public.lookup_solo_run_settlement($1,$2) AS result', [owner, settlement]);
const settle = (owner, last = 5, expected = owner) => user(owner,
  'SELECT public.settle_solo_run($1,$2,$3,$4,$5,$6) AS result',
  [expected, id, run, 'itch-retry-v1', 3, last]);
try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
      $$SELECT jsonb_build_object('is_anonymous', false)$$;
    GRANT USAGE ON SCHEMA auth, public TO anon, authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid(), auth.jwt() TO anon, authenticated;
  `);
  await db.query('INSERT INTO auth.users(id) VALUES ($1),($2)', [a,b]);
  for (const filename of ['20260915_account_progress.sql', '202610300001_tutorial_first_rewards.sql', '202611150001_solo_run_settlements.sql'])
    await db.exec(await readFile(new URL(filename, migrations), 'utf8'));
  assert.equal((await lookup(a)).status, 'unpaid');
  await db.query(`INSERT INTO public.account_progress(user_id,data,revision) VALUES
    ($1,'{"chessAlkkagi.meta.points":"20","chessAlkkagi.meta.upgrades":"{}"}',1),
    ($2,'{"chessAlkkagi.meta.points":"7","chessAlkkagi.meta.upgrades":"{}"}',1)`, [a,b]);
  const first = await settle(a);
  assert.equal(first.status, 'paid');
  assert.equal(first.payout, 12);
  assert.equal(first.data['chessAlkkagi.meta.points'], '32');
  assert.equal(first.revision, 2);
  const looked = await lookup(a);
  assert.equal(looked.status, 'paid');
  assert.equal(looked.payout, 12);
  assert.equal(looked.data['chessAlkkagi.meta.points'], '32');
  assert.equal(looked.revision, 2);
  assert.equal((await settle(a)).revision, 2, 'retry does not add points');
  assert.equal((await settle(a, 4)).status, 'conflict');
  assert.equal((await settle(b)).data['chessAlkkagi.meta.points'], '19', 'owner receipts are independent');
  const legacyRun = 'abcdef0123456789abcdef0123456789';
  const zero = await user(a, 'SELECT public.settle_solo_run($1,$2,$3,$4,$5,$6) AS result',
    [a, `solo-v1:${legacyRun}`, legacyRun, 'itch-retry-v1', 7, 6]);
  assert.equal(zero.payout, 0);
  assert.equal(zero.data['chessAlkkagi.meta.points'], '32');
  assert.equal(zero.revision, 3, 'zero payout still records a receipt');
  assert.equal((await lookup(a, `solo-v1:${legacyRun}`)).status, 'paid');
  await assert.rejects(settle(a, 5, b), /Authenticated account required/);
  await assert.rejects(user(a, 'SELECT public.lookup_solo_run_settlement($1,$2) AS result', [b,id]), /Authenticated account required/);
  await assert.rejects(user(a, 'SELECT public.settle_solo_run($1,$2,$3,$4,$5,$6) AS result', [a,id,run,'other',3,5]), /Invalid solo settlement/);
  await db.exec('SET ROLE anon');
  await assert.rejects(db.query('SELECT public.lookup_solo_run_settlement($1,$2)', [a,id]), /permission denied/);
  await assert.rejects(db.query('SELECT public.settle_solo_run($1,$2,$3,$4,$5,$6)', [a,id,run,'itch-retry-v1',3,5]), /permission denied/);
  await assert.rejects(db.query('SELECT * FROM public.solo_run_settlements'), /permission denied/);
  await db.exec('RESET ROLE');
  console.log('solo settlement SQL: migration, owner scope, exact retry, conflict, delta/revision, auth privileges passed');
} finally { await db.close(); }
