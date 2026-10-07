// Isolated security evidence: in-memory PostgreSQL, synthetic users, no network.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '../../.orca/sql-check/node_modules/@electric-sql/pglite/dist/index.js';

const db = new PGlite();
const a = '00000000-0000-4000-8000-000000000001';
const b = '00000000-0000-4000-8000-000000000002';
const c = '00000000-0000-4000-8000-000000000003';
const evidence = { environment: 'PGlite in-memory; synthetic auth facade and base tables; repository migrations; no production requests', checks: [] };
async function asUser(id, sql, params = []) {
  await db.exec('SET ROLE authenticated');
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [id]);
  try { return await db.query(sql, params); }
  finally { await db.exec('RESET ROLE'); }
}
try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY, created_at timestamptz DEFAULT now());
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
      $$SELECT jsonb_build_object('sub',auth.uid(),'is_anonymous',false)$$;
    GRANT USAGE ON SCHEMA auth, public TO authenticated, anon;
    GRANT EXECUTE ON FUNCTION auth.uid(),auth.jwt() TO authenticated, anon;
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY REFERENCES auth.users(id), nickname varchar(30) UNIQUE NOT NULL,
      mmr integer NOT NULL DEFAULT 1200, wins integer NOT NULL DEFAULT 0,
      losses integer NOT NULL DEFAULT 0, draws integer NOT NULL DEFAULT 0,
      created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE public.match_history (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      white_player_id uuid NOT NULL REFERENCES public.profiles(id),
      black_player_id uuid NOT NULL REFERENCES public.profiles(id), winner_id uuid REFERENCES public.profiles(id),
      white_mmr_change integer NOT NULL, black_mmr_change integer NOT NULL, played_at timestamptz DEFAULT now()
    );
    CREATE FUNCTION public.finish_match(uuid,uuid,boolean,boolean) RETURNS jsonb
      LANGUAGE sql SECURITY DEFINER AS $$SELECT '{}'::jsonb$$;
    GRANT ALL ON public.profiles, public.match_history TO authenticated, anon;
    ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "Public profiles are viewable by everyone" ON public.profiles FOR SELECT USING (true);
  `);
  for (const [id, nickname] of [[a, 'Synthetic A'], [b, 'Synthetic B'], [c, 'Observer']]) {
    await db.query('INSERT INTO auth.users(id) VALUES ($1)', [id]);
    await db.query('INSERT INTO public.profiles(id,nickname) VALUES ($1,$2)', [id, nickname]);
  }
  const dir = new URL('../migrations/', import.meta.url);
  evidence.migrations = (await readdir(dir)).filter(n => n.endsWith('.sql')).sort();
  for (const name of evidence.migrations.filter(n => n < '20261007')) await db.exec(await readFile(new URL(name, dir), 'utf8'));
  // Preserve a previously settled result across the upgrade.
  for (const id of [a,b]) await asUser(id, 'SELECT public.finish_match_v2($1,$2,$3,$4,$5)', ['historical', 'classic', a, b, null]);
  const securityMigration = await readFile(new URL('20261007_ranked_match_registration.sql', dir), 'utf8');
  await db.exec(securityMigration);
  await db.exec(await readFile(new URL('../verify_ranked_match_registration.sql', import.meta.url), 'utf8'));

  const register = async (caller, match, mode='classic', white=a, black=b) =>
    (await asUser(caller, 'SELECT public.register_ranked_match($1,$2,$3,$4) AS result', [match, mode, white, black])).rows[0].result;
  const report = async (caller, match, winner=a, mode='classic', white=a, black=b) =>
    (await asUser(caller, 'SELECT public.finish_match_v2($1,$2,$3,$4,$5) AS result', [match, mode, white, black, winner])).rows[0].result;
  const ratings = async () => (await db.query('SELECT id,mmr,strategy_mmr,wins,losses,draws FROM public.profiles ORDER BY id')).rows;
  const initial = await ratings();

  // The exact original exploit (finish calls alone) must fail with no writes.
  for (const id of [a,b]) await assert.rejects(report(id, 'synthetic-no-game'), /must register/);
  assert.deepEqual(await ratings(), initial);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM public.match_settlements WHERE match_id='synthetic-no-game'")).rows[0].n, 0);
  assert.equal((await report(a, 'historical', null)).status, 'settled');
  await assert.rejects(register(a, 'historical'), /already reported/);

  await assert.rejects(register(c, 'game-1'), /participants/);
  await assert.rejects(register(a, 'same-player', 'classic', a, a), /participants/);
  await assert.rejects(register(a, 'bad-mode', 'friendly'), /Invalid/);
  assert.equal((await register(a, 'game-1')).status, 'pending');
  assert.equal((await register(a, 'game-1')).status, 'pending');
  await assert.rejects(report(a, 'game-1'), /must register/);
  await assert.rejects(register(b, 'game-1', 'strategy'), /Conflicting/);
  await assert.rejects(register(a, 'game-1', 'classic', a, c), /Conflicting/);
  assert.equal((await register(b, 'game-1')).status, 'ready');
  await assert.rejects(report(c, 'game-1'), /participants/);
  await assert.rejects(report(a, 'game-1', a, 'strategy'), /registered/);
  await assert.rejects(report(a, 'game-1', a, 'classic', a, c), /registered/);
  await assert.rejects(report(a, 'game-1', c), /Invalid/);
  assert.equal((await report(a, 'game-1')).status, 'pending');
  await assert.rejects(report(b, 'game-1', b), /Conflicting/);
  assert.deepEqual(await ratings(), initial);
  assert.equal((await report(b, 'game-1')).status, 'settled');
  const settled = await ratings();
  assert.equal(settled[0].mmr, 1216);
  assert.equal(settled[1].mmr, 1184);
  assert.equal((await report(a, 'game-1')).status, 'settled');
  await db.query("UPDATE public.ranked_match_sessions SET expires_at=now()-interval '1 second' WHERE match_id=$1", ['game-1']);
  assert.equal((await report(a, 'game-1')).status, 'settled');
  assert.deepEqual(await ratings(), settled);

  // A rematch is a fresh registered game, including strategy and draw results.
  for (const id of [a,b]) await register(id, 'game-1:rematch', 'strategy');
  assert.equal((await report(a, 'game-1:rematch', null, 'strategy')).status, 'pending');
  const rematch = await report(b, 'game-1:rematch', null, 'strategy');
  assert.deepEqual(rematch, {status:'settled', white_delta:0, black_delta:0});
  for (const id of [a,b]) await register(id, 'expired');
  await db.query("UPDATE public.ranked_match_sessions SET expires_at=now()-interval '1 second' WHERE match_id=$1", ['expired']);
  await assert.rejects(register(a, 'expired'), /expired/);
  await assert.rejects(report(a, 'expired'), /expired/);

  await assert.rejects(asUser(a, "UPDATE public.ranked_match_sessions SET black_ready=true"), /permission denied/);
  await assert.rejects(asUser(a, "INSERT INTO public.ranked_match_sessions(match_id,mode,white_id,black_id) VALUES ('direct','classic',$1,$2)", [a,b]), /permission denied/);
  await assert.rejects(asUser(a, 'UPDATE public.profiles SET mmr=9999 WHERE id=$1', [a]), /permission denied/);
  await assert.rejects(asUser(a, 'SELECT public.finish_match($1,$2,true,false)', [a,b]), /permission denied/);
  assert.equal((await asUser(c, 'SELECT * FROM public.ranked_match_sessions')).rows.length, 0);
  await db.exec('SET ROLE anon');
  try { await assert.rejects(db.query('SELECT public.register_ranked_match($1,$2,$3,$4)', ['anon','classic',a,b]), /permission denied/); }
  finally { await db.exec('RESET ROLE'); }
  await db.exec(`CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT jsonb_build_object('is_anonymous',true)$$`);
  await assert.rejects(register(a, 'anonymous-auth'), /signed-in/);
  await assert.rejects(report(a, 'game-1'), /participants/);
  await db.exec(`CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT jsonb_build_object('is_anonymous',false)$$`);

  // Offline progress stays client-authored by explicit product choice. Ownership
  // and revision protection must still hold; do not claim this prevents cheating.
  const data = {'chessAlkkagi.meta.points':'1000000', 'chessAlkkagi.meta.upgrades':'{}', 'chessAlkkagi.meta.maxStage':'10'};
  const save = async (caller, revision, owner=a, payload=data) =>
    (await asUser(caller, 'SELECT public.save_account_progress($1::jsonb,$2,$3) AS result', [JSON.stringify(payload), revision, owner])).rows[0].result;
  assert.equal((await save(a,0)).data['chessAlkkagi.meta.points'], '1000000');
  await assert.rejects(save(b,1), /Account changed/);
  await assert.rejects(save(a,0), /Revision conflict/);
  await assert.rejects(save(a,1,a,{...data,'chessAlkkagi.meta.points':'-1'}));
  await assert.rejects(save(a,1,a,{...data,'chessAlkkagi.meta.maxStage':'999'}));

  const beforeRerun = await ratings();
  await db.exec(securityMigration);
  assert.deepEqual(await ratings(), beforeRerun);
  assert.equal((await report(a, 'game-1')).status, 'settled');
  // Honest limitation: two colluding accounts can also complete registration.
  for (const id of [a,b]) await register(id, 'collusion-still-possible');
  await report(a, 'collusion-still-possible');
  assert.equal((await report(b, 'collusion-still-possible')).status, 'settled');
  console.log('PASS: unregistered/one-sided/mismatched/expired matches rejected; normal match/rematch/draw and historical retries preserved; RLS, grants, anonymous auth, migration rerun and offline ownership/revisions checked.');
  console.log('KNOWN LIMITS: registered two-account collusion and self-authored offline progress remain possible.');
} catch (error) {
  console.error(error.message, error.code ?? '', error.where ?? '');
  process.exitCode = 1;
} finally { await db.close(); }
