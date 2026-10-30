import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const vite = await createServer({ root: fileURLToPath(new URL('../..', import.meta.url)), configFile: false, server: { middlewareMode: true, hmr: false } });
try {
  const { AccountProgressStorage } = await vite.ssrLoadModule('/src/progress-storage.ts');
  const localValues = new Map([['chessAlkkagi.meta.points', '20'], ['chessAlkkagi.meta.upgrades', '{}']]);
  const local = { getItem: k => localValues.get(k) ?? null, setItem: (k,v) => localValues.set(k,v) };
  const guest = new AccountProgressStorage(() => local);
  assert.equal(guest.claimGuestTutorialReward('basic'), 'granted');
  assert.equal(guest.getItem('chessAlkkagi.meta.points'), '120');
  assert.equal(guest.claimGuestTutorialReward('basic'), 'repeat');
  assert.equal(guest.claimGuestTutorialReward('advanced'), 'granted');
  assert.equal(guest.getItem('chessAlkkagi.meta.points'), '220');
  assert.equal(guest.claimGuestTutorialReward('advanced'), 'repeat');
  const interruptedValues = new Map([['chessAlkkagi.meta.points', '20'], ['chessAlkkagi.meta.upgrades', '{}']]);
  let failAtomic = true;
  const interruptedLocal = { getItem: k => interruptedValues.get(k) ?? null, setItem(k,v) {
    if (k === 'ca_guest_meta_v1' && failAtomic) throw new Error('quota');
    interruptedValues.set(k,v);
  } };
  const interrupted = new AccountProgressStorage(() => interruptedLocal);
  assert.equal(interrupted.claimGuestTutorialReward('basic'), 'pending');
  assert.equal(interruptedValues.get('ca_guest_meta_v1'), undefined);
  failAtomic = false;
  interrupted.setItems({ 'chessAlkkagi.meta.points': '50', 'chessAlkkagi.meta.upgrades': '{}' });
  const restarted = new AccountProgressStorage(() => interruptedLocal);
  assert.equal(restarted.claimGuestTutorialReward('basic'), 'granted');
  assert.equal(restarted.getItem('chessAlkkagi.meta.points'), '150', 'earn after failed write is preserved');
  restarted.setItems({ 'chessAlkkagi.meta.points': '100', 'chessAlkkagi.meta.upgrades': '{"power":1}' });
  const afterSpend = new AccountProgressStorage(() => interruptedLocal);
  assert.equal(afterSpend.claimGuestTutorialReward('basic'), 'repeat');
  assert.equal(afterSpend.getItem('chessAlkkagi.meta.points'), '100', 'restart does not restore spent points');
  assert.equal(afterSpend.getItem('chessAlkkagi.meta.upgrades'), '{"power":1}');
  const mirrorValues = new Map([['chessAlkkagi.meta.points', '7'], ['chessAlkkagi.meta.upgrades', '{}']]);
  let failMirror = true;
  const mirrorLocal = { getItem: k => mirrorValues.get(k) ?? null, setItem(k,v) {
    if (k === 'has_completed_tutorial' && failMirror) throw Error('mirror unavailable');
    mirrorValues.set(k,v);
  } };
  const mirrorGuest = new AccountProgressStorage(() => mirrorLocal);
  assert.equal(mirrorGuest.claimGuestTutorialReward('basic'), 'granted');
  assert.equal(mirrorGuest.getItem('chessAlkkagi.meta.points'), '107');
  failMirror = false;
  const mirrorRestart = new AccountProgressStorage(() => mirrorLocal);
  await mirrorRestart.activate(null, null);
  assert.equal(mirrorRestart.claimGuestTutorialReward('basic'), 'repeat');
  assert.equal(mirrorValues.get('has_completed_tutorial'), 'true', 'restart repairs direct lobby read');

  const data = { 'chessAlkkagi.meta.points': '10', 'chessAlkkagi.meta.upgrades': '{}' };
  let revision = 1;
  const grants = new Set();
  let failClaim = false;
  let holdClaim = null;
  const client = { rpc: async (name, args) => {
    if (name.startsWith('get_account_progress_v')) return { error: { code: 'PGRST202' } };
    if (name === 'get_account_progress') return { data: { data: { ...data }, revision } };
    if (name === 'save_account_progress') {
      if (args.p_expected_revision !== revision) return { error: { code: '40001' } };
      Object.assign(data, args.p_data); revision++;
      return { data: { data: { ...data }, revision } };
    }
    if (name === 'claim_tutorial_first_reward') {
      if (holdClaim) await holdClaim;
      if (failClaim) return { error: { code: 'network' } };
      const type = args.p_tutorial_type;
      const key = type === 'basic' ? 'has_completed_tutorial' : 'has_completed_adv_tutorial';
      const granted = !grants.has(type) && data[key] !== 'true';
      grants.add(type);
      if (granted) { data[key] = 'true'; data['chessAlkkagi.meta.points'] = String(Number(data['chessAlkkagi.meta.points']) + 100); revision++; }
      return { data: { granted, data: { ...data }, revision } };
    }
    throw Error(name);
  } };
  const account = new AccountProgressStorage(() => local);
  await account.activate(client, 'account-a');
  failClaim = true;
  assert.equal(await account.claimTutorialReward('basic'), 'pending');
  assert.equal(account.getItem('has_completed_tutorial'), null);
  failClaim = false;
  assert.equal(await account.claimTutorialReward('basic'), 'granted');
  assert.equal(account.getItem('chessAlkkagi.meta.points'), '110');
  assert.equal(await account.claimTutorialReward('basic'), 'repeat');
  assert.equal(await account.claimTutorialReward('advanced'), 'granted');
  assert.equal(account.getItem('chessAlkkagi.meta.points'), '210');
  assert.equal(await account.claimTutorialReward('advanced'), 'repeat');
  grants.clear();
  data['chessAlkkagi.meta.points'] = '10';
  delete data.has_completed_tutorial;
  delete data.has_completed_adv_tutorial;
  revision++;
  const racing = new AccountProgressStorage(() => ({ getItem: () => null, setItem() {} }));
  await racing.activate(client, 'account-b');
  let releaseClaim;
  holdClaim = new Promise(resolve => { releaseClaim = resolve; });
  const claimDuringSave = racing.claimTutorialReward('basic');
  await new Promise(resolve => setTimeout(resolve, 0));
  racing.setItem('chessAlkkagi.meta.points', '30');
  assert.equal(await racing.flush(), true);
  releaseClaim();
  holdClaim = null;
  assert.equal(await claimDuringSave, 'granted');
  assert.equal(racing.getItem('chessAlkkagi.meta.points'), '130', 'already saved local change is not added twice');
  console.log('tutorial reward client: atomic guest meta, independent types, repeats, pending retry and account snapshot passed');
} finally { await vite.close(); }
