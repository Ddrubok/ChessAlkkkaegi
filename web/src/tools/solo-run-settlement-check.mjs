import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const vite = await createServer({ root: fileURLToPath(new URL('../..', import.meta.url)), configFile: false, server: { middlewareMode: true, hmr: false } });
const runId = '00000000-0000-4000-8000-000000000051';
const input = { settlementId: `solo-v1:${runId}`, runId, rulesVersion: 'itch-retry-v1', startStage: 3, lastClearedStage: 5 };
const store = initial => {
  const values = new Map(initial);
  let fail = false;
  return { values, set fail(value) { fail = value; }, getItem: key => values.get(key) ?? null,
    setItem(key, value) { if (fail && key === 'ca_guest_meta_v2') throw Error('quota'); values.set(key, value); } };
};
try {
  const { AccountProgressStorage } = await vite.ssrLoadModule('/src/progress-storage.ts');
  const { parsePermanentUpgrades } = await vite.ssrLoadModule('/src/meta.ts');
  for (const initial of [[], [['ca_guest_meta_v1', JSON.stringify({ has_completed_tutorial: 'skipped' })]]]) {
    const fresh = store(initial), newGuest = new AccountProgressStorage(() => fresh);
    fresh.fail = true;
    assert.deepEqual(await newGuest.settleSoloRun(input), { status: 'pending' });
    assert.equal(fresh.values.get('ca_guest_meta_v2'), undefined, 'defaults and receipt are atomic');
    fresh.fail = false;
    assert.deepEqual(await newGuest.settleSoloRun(input), { status: 'paid', payout: 12 });
    const saved = JSON.parse(fresh.values.get('ca_guest_meta_v2'));
    assert.equal(saved.data['chessAlkkagi.meta.points'], '12');
    assert.doesNotThrow(() => parsePermanentUpgrades(JSON.parse(saved.data['chessAlkkagi.meta.upgrades'])));
    assert.equal(Object.keys(saved.settlements).length, 1);
    assert.deepEqual(await new AccountProgressStorage(() => fresh).settleSoloRun(input), { status: 'paid', payout: 12 });
    assert.equal(newGuest.getItem('chessAlkkagi.meta.points'), '12', 'retry does not credit again');
  }
  const partial = store([['chessAlkkagi.meta.points', '99']]);
  assert.deepEqual(await new AccountProgressStorage(() => partial).settleSoloRun(input), { status: 'pending' });
  assert.equal(partial.values.get('chessAlkkagi.meta.points'), '99');
  assert.equal(partial.values.get('ca_guest_meta_v2'), undefined, 'do not replace damaged research with defaults');
  const local = store([['ca_guest_meta_v1', JSON.stringify({ 'chessAlkkagi.meta.points': '20', 'chessAlkkagi.meta.upgrades': '{}', has_completed_tutorial: 'true' })]]);
  const guest = new AccountProgressStorage(() => local);
  local.fail = true;
  assert.deepEqual(await guest.settleSoloRun(input), { status: 'pending' });
  assert.equal(local.values.get('ca_guest_meta_v2'), undefined);
  local.fail = false;
  assert.deepEqual(await guest.lookupSoloRunSettlement(input.settlementId), { status: 'unpaid' });
  assert.deepEqual(await guest.settleSoloRun(input), { status: 'paid', payout: 12 });
  const restarted = new AccountProgressStorage(() => local);
  assert.equal(restarted.getItem('chessAlkkagi.meta.points'), '32');
  assert.equal(restarted.getItem('has_completed_tutorial'), 'true');
  assert.deepEqual(await restarted.lookupSoloRunSettlement(input.settlementId), { status: 'paid', payout: 12 });
  assert.deepEqual(await restarted.settleSoloRun(input), { status: 'paid', payout: 12 });
  assert.deepEqual(await restarted.settleSoloRun({ ...input, lastClearedStage: 4 }), { status: 'conflict' });
  restarted.setItems({ 'chessAlkkagi.meta.points': '22', 'chessAlkkagi.meta.upgrades': '{"power":1}' });
  assert.equal(new AccountProgressStorage(() => local).getItem('chessAlkkagi.meta.points'), '22');
  assert.deepEqual(await new AccountProgressStorage(() => local).settleSoloRun(input), { status: 'paid', payout: 12 });
  assert.equal(new AccountProgressStorage(() => local).getItem('chessAlkkagi.meta.points'), '22');
  const zero = { ...input, runId: '00000000-0000-4000-8000-000000000052', settlementId: 'solo-v1:00000000-0000-4000-8000-000000000052', startStage: 7, lastClearedStage: 6 };
  assert.deepEqual(await restarted.settleSoloRun(zero), { status: 'paid', payout: 0 });

  const rows = new Map();
  const receipts = new Map();
  let loseAck = false, hold = null;
  const client = { rpc: async (name, args) => {
    if (name.startsWith('get_account_progress_v')) return { error: { code: 'PGRST202' } };
    const owner = args.p_expected_user_id;
    const row = rows.get(owner);
    if (name === 'get_account_progress') return { data: row ? structuredClone(row) : { data: {}, revision: 0 } };
    if (name === 'save_account_progress') {
      if (args.p_expected_revision !== (row?.revision ?? 0)) return { error: { code: '40001' } };
      rows.set(owner, { data: structuredClone(args.p_data), revision: (row?.revision ?? 0) + 1 });
      return { data: structuredClone(rows.get(owner)) };
    }
    if (name === 'lookup_solo_run_settlement') {
      const receipt = receipts.get(`${owner}:${args.p_settlement_id}`);
      return { data: receipt ? { status: 'paid', payout: receipt.payout, ...structuredClone(rows.get(owner)) } : { status: 'unpaid' } };
    }
    if (name === 'settle_solo_run') {
      if (hold) await hold;
      const key = `${owner}:${args.p_settlement_id}`;
      let receipt = receipts.get(key);
      if (receipt && (receipt.startStage !== args.p_start_stage || receipt.lastClearedStage !== args.p_last_cleared_stage)) return { data: { status: 'conflict' } };
      if (!receipt) {
        receipt = { startStage: args.p_start_stage, lastClearedStage: args.p_last_cleared_stage, payout: 12 };
        receipts.set(key, receipt);
        const current = rows.get(owner);
        current.data['chessAlkkagi.meta.points'] = String(Number(current.data['chessAlkkagi.meta.points']) + 12);
        current.revision++;
      }
      const response = { data: { status: 'paid', payout: receipt.payout, ...structuredClone(rows.get(owner)) } };
      if (loseAck) { loseAck = false; return { error: { code: 'network' } }; }
      return response;
    }
    throw Error(name);
  } };
  const empty = store([]);
  const account = new AccountProgressStorage(() => empty);
  await account.activate(client, 'owner-a');
  account.setItems({ 'chessAlkkagi.meta.points': '10', 'chessAlkkagi.meta.upgrades': '{}' });
  assert.equal(await account.flush(), true);
  loseAck = true;
  assert.deepEqual(await account.settleSoloRun(input), { status: 'pending' });
  account.setItems({ 'chessAlkkagi.meta.points': '7', 'chessAlkkagi.meta.upgrades': '{"power":1}' });
  assert.equal(await account.flush(), false, 'uncertain credit must not race an old balance save');
  assert.deepEqual(await account.lookupSoloRunSettlement(input.settlementId), { status: 'paid', payout: 12 });
  assert.equal(account.getItem('chessAlkkagi.meta.points'), '19', 'lookup rebases the pending purchase after a lost acknowledgement');
  assert.deepEqual(await account.settleSoloRun(input), { status: 'paid', payout: 12 });
  assert.equal(account.getItem('chessAlkkagi.meta.points'), '19');
  assert.deepEqual(await account.settleSoloRun({ ...input, lastClearedStage: 4 }), { status: 'conflict' });

  const second = new AccountProgressStorage(() => store([]));
  await second.activate(client, 'owner-b');
  second.setItems({ 'chessAlkkagi.meta.points': '5', 'chessAlkkagi.meta.upgrades': '{}' });
  assert.equal(await second.flush(), true);
  let release;
  hold = new Promise(resolve => { release = resolve; });
  const pending = second.settleSoloRun(input);
  await new Promise(resolve => setTimeout(resolve, 0));
  second.setItems({ 'chessAlkkagi.meta.points': '2', 'chessAlkkagi.meta.upgrades': '{"power":1}' });
  assert.equal(await second.flush(), false, 'hold dirty updates until the settlement row is known');
  release(); hold = null;
  assert.deepEqual(await pending, { status: 'paid', payout: 12 });
  assert.equal(second.getItem('chessAlkkagi.meta.points'), '14', 'purchase delta rebased on canonical settlement');
  assert.equal(rows.get('owner-b').data['chessAlkkagi.meta.points'], '14');
  const swapped = new AccountProgressStorage(() => store([]));
  await swapped.activate(client, 'owner-c');
  swapped.setItems({ 'chessAlkkagi.meta.points': '1', 'chessAlkkagi.meta.upgrades': '{}' });
  await swapped.flush();
  hold = new Promise(resolve => { release = resolve; });
  const old = swapped.settleSoloRun(input);
  await new Promise(resolve => setTimeout(resolve, 0));
  await swapped.activate(client, 'owner-d');
  release(); hold = null;
  assert.deepEqual(await old, { status: 'pending' });
  assert.equal(swapped.owner, 'owner-d');
  assert.equal(swapped.getItem('chessAlkkagi.meta.points'), null);
  console.log('solo settlement client: guest atomic/retry/migration/spend, account lost ack/owner swap/canonical merge passed');
} finally { await vite.close(); }
