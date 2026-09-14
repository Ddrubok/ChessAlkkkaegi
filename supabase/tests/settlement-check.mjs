// Local PostgreSQL checks. Install the test-only engine using the command in ../README.md.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '../../.orca/sql-check/node_modules/@electric-sql/pglite/dist/index.js';

const db = new PGlite();
const white = '00000000-0000-4000-8000-000000000001';
const black = '00000000-0000-4000-8000-000000000002';
const stranger = '00000000-0000-4000-8000-000000000003';
const oldUser = '00000000-0000-4000-8000-000000000004';
const migration = await readFile(new URL(process.argv[2] ?? '../migrations/20260914_secure_match_settlement.sql', import.meta.url), 'utf8');

async function asUser(id, sql, params = []) {
  await db.exec('SET ROLE authenticated');
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [id]);
  try { return await db.query(sql, params); }
  finally { await db.exec('RESET ROLE'); }
}
async function report(id, match, mode = 'classic', winner = white) {
  const result = await asUser(id, 'SELECT public.finish_match_v2($1,$2,$3,$4,$5) AS result', [match, mode, white, black, winner]);
  return result.rows[0].result;
}

try {
  // Only the Supabase-owned auth facade and pre-existing application tables are fixtures.
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY, created_at timestamptz DEFAULT now());
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    GRANT USAGE ON SCHEMA auth, public TO authenticated, anon;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
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
    GRANT UPDATE (mmr) ON public.profiles TO authenticated;
    ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "Public profiles are viewable by everyone" ON public.profiles FOR SELECT USING (true);
  `);
  for (const [id, name] of [[white, 'White'], [black, 'Black'], [stranger, 'Other'], [oldUser, 'Old']]) {
    await db.query('INSERT INTO auth.users(id) VALUES ($1)', [id]);
    await db.query('INSERT INTO public.profiles(id,nickname) VALUES ($1,$2)', [id, name]);
  }
  await db.query("UPDATE auth.users SET created_at = now() - interval '2 days' WHERE id=$1", [oldUser]);
  await db.query('UPDATE public.profiles SET mmr=1450, wins=5 WHERE id=$1', [oldUser]);
  await db.exec(await readFile(new URL('../migrations/20260901_referral_system.sql', import.meta.url), 'utf8'));
  await db.exec('ALTER TABLE public.profiles ALTER COLUMN draws DROP NOT NULL; UPDATE public.profiles SET draws=NULL; ALTER TABLE public.profiles ADD COLUMN strategy_mmr integer');
  await db.exec(migration);
  assert.equal((await db.query('SELECT classic_mmr FROM public.profiles WHERE id=$1', [oldUser])).rows[0].classic_mmr, 1450);
  assert.deepEqual((await db.query('SELECT classic_draws,strategy_mmr FROM public.profiles WHERE id=$1', [oldUser])).rows[0], { classic_draws: 0, strategy_mmr: 1200 });

  await assert.rejects(report(stranger, 'unauthorized'), /participants/);
  await assert.rejects(report('', 'anonymous'), /participants/);
  await db.exec('SET ROLE anon');
  await assert.rejects(db.query('SELECT public.finish_match_v2($1,$2,$3,$4,$5)', ['anon', 'classic', white, black, white]), /permission denied/);
  await db.exec('RESET ROLE');
  await assert.rejects(asUser(white, 'SELECT public.finish_match($1,$2,false,true)', [white, black]), /permission denied/);
  await assert.rejects(asUser(white, 'UPDATE public.profiles SET mmr=9999 WHERE id=$1', [white]), /permission denied/);
  await assert.rejects(asUser(white, 'UPDATE public.profiles SET classic_mmr=9999 WHERE id=$1', [white]), /permission denied/);
  await assert.rejects(asUser(white, 'UPDATE public.profiles SET coins=9999 WHERE id=$1', [white]), /permission denied/);
  await asUser(white, 'UPDATE public.profiles SET nickname=$1 WHERE id=$2', ['White renamed', white]);
  assert.equal((await asUser(white, 'UPDATE public.profiles SET nickname=$1 WHERE id=$2', ['Not yours', black])).affectedRows, 0);

  assert.equal((await report(white, 'game-1')).status, 'pending');
  assert.equal((await report(white, 'game-1')).status, 'pending');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.match_history')).rows[0].n, 0);
  await assert.rejects(report(black, 'game-1', 'classic', black), /Conflicting/);
  assert.deepEqual(await report(black, 'game-1'), { status: 'settled', white_delta: 16, black_delta: -16 });
  assert.deepEqual(await report(white, 'game-1'), { status: 'settled', white_delta: 16, black_delta: -16 });
  await report(black, 'game-1');
  assert.deepEqual((await db.query('SELECT mmr,classic_mmr,wins FROM public.profiles WHERE id=$1', [white])).rows[0], { mmr: 1216, classic_mmr: 1216, wins: 1 });
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.match_history')).rows[0].n, 1);
  assert.equal((await asUser(stranger, 'SELECT * FROM public.match_settlements')).rows.length, 0);

  await report(black, 'game-2', 'strategy', black);
  assert.deepEqual(await report(white, 'game-2', 'strategy', black), { status: 'settled', white_delta: -16, black_delta: 16 });
  assert.deepEqual((await db.query('SELECT mmr,classic_mmr,strategy_mmr,strategy_losses FROM public.profiles WHERE id=$1', [white])).rows[0], { mmr: 1216, classic_mmr: 1216, strategy_mmr: 1184, strategy_losses: 1 });
  await report(white, 'game-draw', 'classic', null);
  assert.equal((await report(black, 'game-draw', 'classic', null)).status, 'settled');
  assert.equal((await db.query('SELECT classic_draws FROM public.profiles WHERE id=$1', [white])).rows[0].classic_draws, 1);
  assert.equal((await db.query('SELECT draws FROM public.profiles WHERE id=$1', [white])).rows[0].draws, 1);
  await assert.rejects(asUser(white, 'SELECT public.finish_match_v2($1,$2,$3,$4,$5)', ['self', 'classic', white, white, white]), /participants/);
  await assert.rejects(report(white, 'invalid', 'other'), /Invalid/);

  const claimSql = 'SELECT public.claim_referral_reward($1,$2,true) AS result';
  await assert.rejects(asUser(white, claimSql, [stranger, black]), /authenticated referee/);
  assert.equal((await asUser(oldUser, claimSql, [oldUser, black])).rows[0].result.code, 'ALREADY_MEMBER');
  assert.equal((await asUser(stranger, claimSql, [stranger, black])).rows[0].result.success, true);
  assert.equal((await asUser(stranger, claimSql, [stranger, black])).rows[0].result.code, 'ALREADY_REFERRED');
  assert.equal((await db.query('SELECT coins FROM public.profiles WHERE id=$1', [stranger])).rows[0].coins, 15);
  await assert.rejects(asUser(white, 'SELECT public.check_and_claim_referrer_rewards($1)', [black]), /authenticated referrer/);

  const ratings = (await db.query('SELECT id,classic_mmr,strategy_mmr FROM public.profiles ORDER BY id')).rows;
  await db.exec(migration);
  assert.deepEqual((await db.query('SELECT id,classic_mmr,strategy_mmr FROM public.profiles ORDER BY id')).rows, ratings);
  assert.equal((await report(white, 'game-1')).status, 'settled');
  console.log('PASS: SQL permissions, account ownership, bilateral settlement, idempotency, modes, draws, referral ownership, migration rerun');
} finally {
  await db.close();
}
