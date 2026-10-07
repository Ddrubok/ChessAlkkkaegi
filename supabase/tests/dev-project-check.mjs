// Fresh install with opt-in table grants; synthetic auth only, no remote writes.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '../../.orca/sql-check/node_modules/@electric-sql/pglite/dist/index.js';
const db = new PGlite();
const ids = [1,2,3].map(n => `00000000-0000-4000-8000-00000000000${n}`);
async function user(id, sql, params = []) {
  await db.exec('SET ROLE authenticated');
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [id]);
  try { return (await db.query(sql, params)).rows; }
  finally { await db.exec('RESET ROLE'); }
}
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY, created_at timestamptz DEFAULT now(), raw_app_meta_data jsonb DEFAULT '{}');
    CREATE TABLE auth.identities(user_id uuid REFERENCES auth.users(id), provider text);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT jsonb_build_object('sub',auth.uid(),'is_anonymous',false)$$;
    GRANT USAGE ON SCHEMA auth TO anon,authenticated;
    REVOKE ALL ON SCHEMA public FROM PUBLIC;
    ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;`);
  const sql = await readFile(new URL('../setup_dev_project.sql', import.meta.url), 'utf8');
  // Guard against accidentally nested transaction boundaries in the bundle.
  assert.equal((sql.match(/^BEGIN;$/gim)||[]).length, 1);
  assert.equal((sql.match(/^COMMIT;$/gim)||[]).length, 1);
  await db.exec(sql);
  for (const [n, id] of ids.entries()) {
    await db.query('INSERT INTO auth.users(id) VALUES($1)', [id]);
    await user(id, 'INSERT INTO public.profiles(id,nickname,referral_code) VALUES($1,$2,$3)', [id, `Test ${n}`, `TEST${n}`]);
  }
  const [a,b,c] = ids;
  assert.equal((await user(a,'SELECT id FROM public.profiles')).length, 3);
  await assert.rejects(user(a, 'UPDATE public.profiles SET mmr=9999 WHERE id=$1', [a]), /permission denied/);
  const friendship = (await user(a, "INSERT INTO public.friendships(requester_id,addressee_id,status) VALUES($1,$2,'pending') RETURNING id", [a,b]))[0].id;
  assert.equal((await user(c, 'SELECT * FROM public.friendships')).length, 0);
  assert.equal((await user(a, "UPDATE public.friendships SET status='accepted' WHERE id=$1 RETURNING id",[friendship])).length, 0);
  assert.equal((await user(b, "UPDATE public.friendships SET status='accepted',updated_at=now() WHERE id=$1 RETURNING id",[friendship])).length, 1);
  await assert.rejects(user(b, "INSERT INTO public.friendships(requester_id,addressee_id,status) VALUES($1,$2,'pending')", [b,a]), /duplicate key/);
  await assert.rejects(user(a,'UPDATE public.friendships SET addressee_id=$1',[c]), /permission denied/);
  await assert.rejects(user(a, "INSERT INTO public.friendships(requester_id,addressee_id,status) VALUES($1,$2,'pending')", [b,c]), /row-level security/);
  for (const id of [a,b]) await user(id, "SELECT public.register_ranked_match('dev-check','classic',$1,$2)",[a,b]);
  for (const id of [a,b]) await user(id, "SELECT public.finish_match_v2('dev-check','classic',$1,$2,$1)",[a,b]);
  assert.equal((await user(a,'SELECT * FROM public.match_history')).length,1);
  assert.equal((await user(c,'SELECT * FROM public.match_history')).length,0);
  await user(a,"SELECT public.get_account_progress_v4($1,'cosmetics-v1')",[a]);
  await user(a,'SELECT public.get_quest_snapshot_v1($1)',[a]);
  await user(a,'SELECT public.get_weekly_challenge_snapshot_v1($1)',[a]);
  await user(a,'SELECT public.get_nickname_state_v1()');
  await db.exec('SET ROLE anon');
  assert.equal((await db.query('SELECT id FROM public.profiles')).rows.length,3);
  await assert.rejects(db.query('SELECT * FROM public.friendships'), /permission denied/);
  await db.exec('RESET ROLE');
  await assert.rejects(db.exec(sql), /Fresh development project required/);
  await db.exec('ROLLBACK');
  assert.equal((await db.query('SELECT count(*)::int n FROM public.profiles')).rows[0].n,3);
  console.log('PASS fresh dev install: all migrations, explicit grants, profile creation, friend request/accept/RLS, ranked settlement/history, progress/quest/nickname RPCs, rerun rejection without data loss');
} catch (error) {
  console.error(error.message, error.where || '');
  process.exitCode = 1;
} finally { await db.close(); }
