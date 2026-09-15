import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const vite = await createServer({ root: fileURLToPath(new URL('../..', import.meta.url)), configFile: false, server: { middlewareMode: true } });
try {
  const { AccountProgressStorage } = await vite.ssrLoadModule('/src/progress-storage.ts');
  const values = new Map();
  const local = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const rows = new Map();
  let auth = 'account-a';
  let failRead = false;
  let failWrite = false;
  let holdRead = null;
  let holdWrite = null;
  const writes = [];
  const client = { rpc: async (name, args) => {
    const captured = auth;
    if (name === 'get_account_progress' && holdRead) await holdRead;
    if (name === 'save_account_progress' && holdWrite) await holdWrite;
    if (args.p_expected_user_id !== auth || captured !== auth) return { error: { code: '42501' } };
    if (name === 'get_account_progress') {
      if (failRead) return { error: { code: 'network' } };
      return { data: structuredClone(rows.get(auth) ?? { data: {}, revision: 0 }) };
    }
    if (failWrite) return { error: { code: 'network' } };
    const old = rows.get(auth) ?? { data: {}, revision: 0 };
    if (old.revision !== args.p_expected_revision) return { error: { code: '40001' } };
    const next = { data: structuredClone(args.p_data), revision: old.revision + 1 };
    rows.set(auth, next); writes.push(structuredClone(args));
    return { data: structuredClone(next) };
  } };
  const store = new AccountProgressStorage(() => local);
  const stage = 'chessAlkkagi.meta.maxStage';
  const points = 'chessAlkkagi.meta.points';
  const upgrades = 'chessAlkkagi.meta.upgrades';
  local.setItem(stage, '3');
  local.setItem('has_completed_tutorial', 'skipped');
  await store.activate(client, auth);
  assert.equal(store.getItem(stage), null, 'legacy guest data must not enter an account automatically');
  assert.equal(store.canImport(), true);
  await store.importLocal();
  assert.equal(rows.get(auth).data[stage], '3');
  assert.equal(rows.get(auth).data.has_completed_tutorial, 'skipped', 'skipped is not completion');
  assert.equal(local.getItem(stage), '3', 'legacy original retained');

  store.setItem(points, '120'); store.setItem(upgrades, '{}');
  await store.flush();
  assert.equal(writes.at(-1).p_data[points], '120');
  assert.equal(writes.at(-1).p_data[upgrades], '{}', 'point spending and upgrade snapshot are sent together');
  auth = 'account-b'; await store.activate(client, auth);
  assert.equal(store.getItem(stage), null, 'account B cannot inherit account A');
  assert.equal(store.canImport(), false, 'device legacy snapshot claimed only once');
  await store.activate(null, null);
  assert.equal(store.getItem(stage), '3', 'guest original remains separate');

  auth = 'account-a'; await store.activate(client, auth);
  failWrite = true;
  store.setItem(stage, '4'); assert.equal(await store.flush(), false);
  assert.equal(rows.get(auth).data[stage], '3');
  const reloaded = new AccountProgressStorage(() => local);
  failWrite = false; await reloaded.activate(client, auth);
  assert.equal(rows.get(auth).data[stage], '4', 'pending own-account writes survive reload');
  await store.activate(client, auth);
  rows.set(auth, { data: { ...rows.get(auth).data, [stage]: '6' }, revision: rows.get(auth).revision + 1 });
  store.setItem(stage, '5'); assert.equal(await store.flush(), false);
  assert.equal(store.conflict, true); assert.equal(store.ready, false);
  assert.equal(rows.get(auth).data[stage], '6', 'stale device cannot overwrite newer server progress');
  await store.useServer();
  assert.equal(store.getItem(stage), '6');
  assert.ok([...values.keys()].some(key => key.includes(':backup:')), 'conflicting device state retained in backup');

  failRead = true;
  const before = writes.length;
  await store.activate(client, auth);
  assert.equal(store.ready, false);
  assert.throws(() => store.setItem(stage, '0'));
  assert.equal(writes.length, before, 'failed reads must not create blank server rows');
  failRead = false;

  let releaseRead;
  holdRead = new Promise(resolve => { releaseRead = resolve; });
  const late = store.activate(client, 'account-a');
  auth = 'account-b'; holdRead = null;
  await store.activate(client, auth);
  releaseRead(); await late;
  assert.equal(store.owner, 'account-b'); assert.equal(store.getItem(stage), null);

  auth = 'account-a'; await store.activate(client, auth);
  let releaseWrite;
  holdWrite = new Promise(resolve => { releaseWrite = resolve; });
  store.setItem(stage, '7'); const lateSave = store.flush();
  auth = 'account-b'; await store.activate(client, auth);
  holdWrite = null; releaseWrite(); await lateSave;
  assert.equal(rows.has('account-b'), false, 'delayed save cannot be routed into a new account');
  assert.equal(store.owner, 'account-b');

  // An upload may commit while its response is lost. Reopening recognizes that snapshot.
  auth = 'account-a';
  const cached = JSON.parse(values.get('ca_account_progress_v1:account-a'));
  rows.set(auth, { data: cached.data, revision: cached.revision + 1 });
  await store.activate(client, auth);
  assert.equal(store.conflict, false); assert.equal(store.ready, true);
  assert.equal(store.getItem(stage), '7');

  const damaged = new AccountProgressStorage(() => ({ getItem: key => key === points ? '100' : null, setItem() {} }));
  auth = 'account-c'; await damaged.activate(client, auth);
  await damaged.importLocal();
  assert.equal(rows.has(auth), false, 'incomplete research data cannot replace a server record');
  store.suspend(); reloaded.suspend(); damaged.suspend();
  console.log('PASS account progress: manual import, atomic research, account/guest isolation, offline retry, conflict backup, failed reads, late responses, lost acknowledgement');
} finally { await vite.close(); }
