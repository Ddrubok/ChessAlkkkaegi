import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { PGlite } from '../../.orca/sql-check/node_modules/@electric-sql/pglite/dist/index.js';
const db = new PGlite();
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT NULL::uuid$$;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;`);
  await db.exec(await readFile('supabase/migrations/202610260001_marketing_events.sql', 'utf8'));
  const events = JSON.parse(await readFile(new URL('runtime-results.json', import.meta.url), 'utf8')).received;
  await db.exec('SET ROLE anon');
  const insert = async () => (await db.query('SELECT public.record_marketing_events($1::jsonb) AS n', [JSON.stringify(events)])).rows[0].n;
  assert.equal(await insert(), events.length);
  assert.equal(await insert(), 0);
  await db.exec('RESET ROLE');
  const rows = (await db.query('SELECT * FROM public.marketing_events ORDER BY occurred_at')).rows;
  await writeFile(new URL('sql-runtime-export.json', import.meta.url), JSON.stringify(rows, null, 2));
  console.log(`PASS: ${rows.length} actual browser payloads accepted by local SQL; retry creates zero duplicates.`);
} finally { await db.close(); }
