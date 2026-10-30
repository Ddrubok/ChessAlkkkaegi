import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '../../.orca/sql-check/node_modules/@electric-sql/pglite/dist/index.js';

const db = new PGlite();
const a = '00000000-0000-4000-8000-000000000041';
const b = '00000000-0000-4000-8000-000000000042';
const c = '00000000-0000-4000-8000-000000000043';
const migration = new URL('../migrations/', import.meta.url);
async function user(id, sql, params = []) {
  await db.exec('SET ROLE authenticated');
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [id]);
  try { return (await db.query(sql, params)).rows[0]?.result; }
  finally { await db.exec('RESET ROLE'); }
}
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
  await db.query('INSERT INTO auth.users(id) VALUES ($1),($2),($3)', [a,b,c]);
  await db.exec(await readFile(new URL('20260915_account_progress.sql', migration), 'utf8'));
  await db.query(`INSERT INTO public.account_progress(user_id,data,revision) VALUES
    ($1,'{"chessAlkkagi.meta.points":"50","chessAlkkagi.meta.upgrades":"{}","has_completed_tutorial":"true"}',1),
    ($2,'{"chessAlkkagi.meta.points":"25","chessAlkkagi.meta.upgrades":"{}"}',1),
    ($3,'{"has_completed_tutorial":"true"}',1)`, [a,b,c]);
  await db.exec(await readFile(new URL('202610300001_tutorial_first_rewards.sql', migration), 'utf8'));
  const claim = (id, type) => user(id, 'SELECT public.claim_tutorial_first_reward($1,$2) AS result', [id,type]);
  const legacy = await claim(a, 'basic');
  assert.equal(legacy.granted, false);
  assert.equal(legacy.data['chessAlkkagi.meta.points'], '50');
  assert.equal((await claim(c, 'basic')).granted, false);
  const firstAttempts = await Promise.all([claim(b, 'basic'), claim(b, 'basic')]);
  assert.equal(firstAttempts.filter(r => r.granted).length, 1);
  assert(firstAttempts.every(r => r.data['chessAlkkagi.meta.points'] === '125'));
  const repeated = await Promise.all([claim(b, 'basic'), claim(b, 'basic')]);
  assert(repeated.every(r => r.granted === false && r.data['chessAlkkagi.meta.points'] === '125'));
  const advanced = await claim(b, 'advanced');
  assert.equal(advanced.granted, true);
  assert.equal(advanced.data['chessAlkkagi.meta.points'], '225');
  assert.equal((await claim(b, 'advanced')).granted, false);
  await assert.rejects(user(b, 'SELECT public.save_account_progress($1,$2,$3) AS result', [
    { 'chessAlkkagi.meta.points': '25', 'chessAlkkagi.meta.upgrades': '{}' }, 1, b,
  ]), /Revision conflict/);
  const saved = await user(b, 'SELECT public.save_account_progress($1,$2,$3) AS result', [
    { 'chessAlkkagi.meta.points': '225', 'chessAlkkagi.meta.upgrades': '{}' }, advanced.revision, b,
  ]);
  assert.equal(saved.data.has_completed_tutorial, 'true');
  assert.equal(saved.data.has_completed_adv_tutorial, 'true');
  await assert.rejects(claim(a, 'invalid'), /Invalid tutorial type/);
  await assert.rejects(user(a, 'SELECT public.claim_tutorial_first_reward($1,$2) AS result', [b,'advanced']), /Authenticated account required/);
  await db.exec('SET ROLE anon');
  await assert.rejects(db.query("SELECT public.claim_tutorial_first_reward('00000000-0000-4000-8000-000000000042','basic')"), /permission denied/);
  await db.exec('RESET ROLE');
  const rows = (await db.query('SELECT user_id,tutorial_type FROM public.tutorial_reward_grants ORDER BY user_id,tutorial_type')).rows;
  assert.equal(rows.length, 4);
  console.log('tutorial reward SQL: legacy, basic, advanced, repeats, stale CAS, identity and anon permissions passed');
} finally { await db.close(); }
