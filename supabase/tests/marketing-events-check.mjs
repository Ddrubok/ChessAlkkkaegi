import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '../../.orca/sql-check/node_modules/@electric-sql/pglite/dist/index.js';

const db = new PGlite();
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hashId = `m-${'a'.repeat(64)}`;
const now = () => new Date().toISOString();
const base = { event_id: uuid(1), name: 'session_start', occurred_at: now(),
  analytics_id: uuid(2), session_id: uuid(3), environment: 'production', platform: 'web',
  build: '1.0.0', mode: 'menu', match_id: null, campaign: null, details: {} };
async function role(name, sql, params = [], uid) {
  await db.exec(`SET ROLE ${name}`);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [uid ?? '']);
  try { return await db.query(sql, params); }
  finally { await db.exec('RESET ROLE'); }
}
async function send(name, events, uid) {
  const batch = Array.isArray(events) ? events : [events];
  return (await role(name, 'SELECT public.record_marketing_events($1::jsonb) AS n', [JSON.stringify(batch)], uid)).rows[0].n;
}
const count = async table => (await db.query(`SELECT count(*)::int n FROM public.${table}`)).rows[0].n;
const invalid = async event => assert.rejects(send('anon', event), /Invalid|Expected|outside retention/i);

try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;`);
  const migration = await readFile(new URL('../migrations/202610260001_marketing_events.sql', import.meta.url), 'utf8');
  await db.exec(migration);
  await db.exec(migration); // Reapplying must preserve grants and avoid duplicate schedule work.

  const runtime = [
    { ...base, details: { first_session: true } },
    { ...base, event_id: uuid(4), name: 'game_ready' },
    { ...base, event_id: uuid(5), name: 'first_shot', mode: 'ai', match_id: uuid(20) },
    { ...base, event_id: uuid(6), name: 'tutorial_complete', mode: 'tutorial', details: { tutorial: 'basic' } },
    { ...base, event_id: uuid(7), name: 'match_start', mode: 'friend', match_id: hashId },
    { ...base, event_id: uuid(8), name: 'match_end', mode: 'friend', match_id: hashId, details: { outcome: 'win', resigned: false } },
    { ...base, event_id: uuid(9), name: 'match_abort', mode: 'ai', match_id: uuid(20), details: { reason: 'restart' } },
    { ...base, event_id: uuid(10), name: 'invite_created', mode: 'friend', match_id: hashId, campaign: { source: 'cafe' } },
    { ...base, event_id: uuid(11), name: 'invite_joined', mode: 'friend', match_id: hashId },
    { ...base, event_id: uuid(12), name: 'rematch_start', mode: 'friend', match_id: hashId, details: { previous_match_id: uuid(20) } },
  ];
  assert.equal(await send('anon', runtime), runtime.length);
  assert.equal(await send('anon', runtime), 0); // A fully accepted retry acknowledges with zero new rows.
  assert.equal(await send('authenticated', runtime, uuid(30)), 0);
  assert.equal(await count('marketing_events'), runtime.length);
  assert.equal((await db.query('SELECT user_id FROM public.marketing_identity_links')).rows[0].user_id, uuid(30));
  assert.equal(await send('authenticated', { ...runtime[4], analytics_id: uuid(40) }, uuid(41)), 0);
  assert.equal(await count('marketing_identity_links'), 1); // Event ID collision cannot bind a different analytics ID.
  assert.equal(await send('authenticated', { ...runtime[4], event_id: uuid(13), analytics_id: uuid(40) }, uuid(41)), 1);
  assert.equal((await db.query('SELECT count(DISTINCT analytics_id)::int n FROM public.marketing_events WHERE match_id=$1', [hashId])).rows[0].n, 2);

  for (const name of ['anon', 'authenticated']) {
    await assert.rejects(role(name, 'SELECT * FROM public.marketing_events'), /permission denied/);
    await assert.rejects(role(name, 'SELECT * FROM public.marketing_identity_links'), /permission denied/);
    await assert.rejects(role(name, 'DELETE FROM public.marketing_events'), /permission denied/);
    await assert.rejects(role(name, 'UPDATE public.marketing_events SET build=$1', ['tampered']), /permission denied/);
    await assert.rejects(role(name, 'SELECT public.purge_marketing_events()'), /permission denied/);
  }
  assert.equal((await role('service_role', 'SELECT count(*)::int n FROM public.marketing_events')).rows[0].n, runtime.length + 1);

  const bad = (change, extra = {}) => ({ ...base, event_id: uuid(100), ...change, ...extra });
  for (const key of ['event_id','name','occurred_at','analytics_id','session_id','environment','platform','build','mode','match_id','campaign','details']) {
    const missing = bad(); delete missing[key]; await invalid(missing);
  }
  for (const key of ['event_id','name','occurred_at','analytics_id','session_id','environment','platform','build','mode','details']) {
    await invalid(bad({ [key]: null }));
    await invalid(bad({ [key]: 42 }));
  }
  for (const payload of [
    bad({ email: 'x@example.com' }),
    bad({ name: 'fake' }), bad({ environment: 'fake' }), bad({ platform: 'fake' }), bad({ mode: 'fake' }),
    bad({ event_id: '123' }), bad({ analytics_id: '123' }), bad({ session_id: '123' }),
    bad({ match_id: 'ABCD12' }), bad({ match_id: 'm-short' }), bad({ match_id: 5 }),
    bad({ campaign: [] }), bad({ campaign: 'fake' }), bad({ campaign: { source: 'bad/room' } }),
    bad({ details: [] }), bad({ details: { token: 'secret' } }),
    bad({ details: { previous_match_id: 'ABCD12' } }),
    bad({ occurred_at: new Date(Date.now() + 6 * 60_000).toISOString() }),
    bad({ occurred_at: new Date(Date.now() - 91 * 86400_000).toISOString() }),
    bad({ occurred_at: '2026-10-01T09:00:00+09:00' }),
    bad({ name: 'session_start', mode: 'friend' }),
    bad({ name: 'session_start', match_id: hashId }),
    bad({ name: 'tutorial_complete', mode: 'tutorial' }),
    bad({ name: 'match_start', mode: 'friend', match_id: null }),
    bad({ name: 'match_end', mode: 'friend', match_id: hashId }),
    bad({ name: 'match_end', mode: 'friend', match_id: hashId, details: { outcome: 'win' } }),
    bad({ name: 'match_end', mode: 'friend', match_id: hashId, details: { outcome: 'win', resigned: 'false' } }),
    bad({ name: 'match_abort', mode: 'friend', match_id: hashId }),
    bad({ name: 'rematch_start', mode: 'friend', match_id: hashId }),
    bad({ name: 'invite_created', mode: 'ai', match_id: hashId }),
  ]) await invalid(payload);
  await invalid([{ ...base, event_id: uuid(101) }, bad({ details: { token: 'secret' } })]);
  await invalid([null]);
  await invalid(['fake']);
  await assert.rejects(role('anon', 'SELECT public.record_marketing_events($1::jsonb)', [JSON.stringify({ fake: true })]), /Invalid marketing event batch/);
  assert.equal(await count('marketing_events'), runtime.length + 1); // Invalid batch is atomic.
  await invalid(Array.from({ length: 51 }, (_, i) => ({ ...base, event_id: uuid(200 + i) })));

  await db.exec(`UPDATE public.marketing_events SET occurred_at = now() - interval '91 days' WHERE event_id = '${uuid(1)}'`);
  await db.exec(`UPDATE public.marketing_events SET recorded_at = now() - interval '91 days' WHERE event_id = '${uuid(4)}'`);
  await db.exec(`UPDATE public.marketing_identity_links SET recorded_at = now() - interval '91 days' WHERE analytics_id = '${uuid(2)}'`);
  assert.equal((await role('service_role', 'SELECT public.purge_marketing_events() AS n')).rows[0].n, 2);
  assert.equal(await count('marketing_events'), runtime.length - 1);
  assert.equal(await count('marketing_identity_links'), 1);
  console.log('PASS marketing SQL: runtime payloads, exact fields, privacy IDs, permissions, retry, window, retention');
} finally { await db.close(); }
