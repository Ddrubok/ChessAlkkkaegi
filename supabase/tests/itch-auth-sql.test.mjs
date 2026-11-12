import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('SQL admission is service-only, globally bounded, and cleans expiry in batches', async t => {
  let PGlite;
  try { ({ PGlite } = await import('../../.orca/sql-check/node_modules/@electric-sql/pglite/dist/index.js')); }
  catch { t.skip('local PGlite installation unavailable'); return; }
  const db = new PGlite();
  const hash = i => i.toString(16).padStart(64, '0');
  const challenge = 'b'.repeat(43);
  const start = async i => (await db.query('select public.itch_oauth_start($1,$2,null) as result', [hash(i), challenge])).rows[0].result;
  let stage = 'setup';
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); grant usage on schema public to anon, authenticated, service_role;');
    await db.exec(await readFile(new URL('../migrations/202611100001_itch_auth.sql', import.meta.url), 'utf8'));
    stage = 'anon';
    await db.exec('set role anon');
    await assert.rejects(() => start(1), /permission denied/);
    await assert.rejects(() => db.query('select * from itch_auth_private.start_budget'), /permission denied/);
    stage = 'service starts';
    await db.exec('reset role; set role service_role');
    for (let i = 1; i <= 60; i++) assert.equal(await start(i), 'started');
    assert.equal(await start(1), 'duplicate');
    assert.equal(await start(61), 'rate_limited');
    assert.equal((await db.query('select count(*)::int as n from public.itch_oauth_pending')).rows[0].n, 60);

    stage = 'live cap';
    await db.exec("reset role; delete from public.itch_oauth_pending; update itch_auth_private.start_budget set admitted_at = '{}'; set role service_role;");
    await db.query("insert into public.itch_oauth_pending (state_hash, code_challenge, expires_at) select lpad(to_hex(n),64,'0'), $1, now()+interval '5 minutes' from generate_series(1000,1199) n", [challenge]);
    assert.equal(await start(62), 'rate_limited');
    assert.equal((await db.query('select count(*)::int as n from public.itch_oauth_pending')).rows[0].n, 200);

    stage = 'expiry cleanup';
    await db.exec("reset role; delete from public.itch_oauth_pending; update itch_auth_private.start_budget set admitted_at = '{}'; set role service_role;");
    await db.query("insert into public.itch_oauth_pending (state_hash, code_challenge, expires_at) select lpad(to_hex(n),64,'0'), $1, now()-interval '1 second' from generate_series(2000,2099) n", [challenge]);
    assert.equal(await start(63), 'started');
    assert.equal((await db.query('select count(*)::int as n from public.itch_oauth_pending')).rows[0].n, 69);
  } catch (error) { error.message = `${stage}: ${error.message}`; throw error; }
  finally { await db.close(); }
});
