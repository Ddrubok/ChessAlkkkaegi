import assert from 'node:assert/strict';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
try {
  const { AccountProgressStorage, progressStorage } = await vite.ssrLoadModule('/src/progress-storage.ts');
  const { TutorialManager } = await vite.ssrLoadModule('/src/tutorial.ts');
  const remote = { 'chessAlkkagi.meta.points': '10', 'chessAlkkagi.meta.upgrades': '{}' };
  let revision = 1;
  let granted = false;
  let failPostGrantSave = true;
  let releaseClaim;
  let claimEntered;
  const entered = new Promise(resolve => { claimEntered = resolve; });
  const gate = new Promise(resolve => { releaseClaim = resolve; });
  const client = { rpc: async (name, args) => {
    if (name.startsWith('get_account_progress_v')) return { error: { code: 'PGRST202' } };
    if (name === 'get_account_progress') return { data: { data: { ...remote }, revision } };
    if (name === 'save_account_progress') {
      if (failPostGrantSave) { failPostGrantSave = false; return { error: { code: 'network' } }; }
      if (args.p_expected_revision !== revision) return { error: { code: '40001' } };
      Object.assign(remote, args.p_data); revision++;
      return { data: { data: { ...remote }, revision } };
    }
    if (name === 'claim_tutorial_first_reward') {
      claimEntered();
      await gate;
      const first = !granted;
      if (first) {
        granted = true;
        remote.has_completed_tutorial = 'true';
        remote['chessAlkkagi.meta.points'] = String(Number(remote['chessAlkkagi.meta.points']) + 100);
        revision++;
      }
      return { data: { granted: first, data: { ...remote }, revision } };
    }
    throw Error(name);
  } };
  const account = new AccountProgressStorage(() => ({ getItem: () => null, setItem() {} }));
  await account.activate(client, 'account-a');

  const original = {
    owner: progressStorage.owner,
    claim: progressStorage.claimTutorialReward,
    get: progressStorage.getItem,
  };
  progressStorage.owner = 'account-a';
  progressStorage.claimTutorialReward = type => account.claimTutorialReward(type);
  progressStorage.getItem = key => account.getItem(key);
  const savedDocument = globalThis.document;
  let retry;
  const status = { textContent: '' , after(button) { retry = button; } };
  const modal = { querySelector(selector) {
    if (selector === '.tutorial-reward-status') return status;
    if (selector === '.tutorial-reward-retry') return retry ?? null;
    return null;
  } };
  globalThis.document = { createElement() {
    return { disabled: false, addEventListener(_name, callback) { this.click = callback; }, remove() { retry = null; } };
  } };
  try {
    const manager = new TutorialManager();
    const runtime = { state: { points: 10, upgrades: {} }, storage: progressStorage };
    manager.init(runtime, async () => {}, async () => {});
    manager.completionModal = modal;
    const first = manager.settleCompletionReward('basic');
    await entered;
    account.setItem('chessAlkkagi.meta.points', '20');
    releaseClaim();
    await first;
    assert.equal(runtime.state.points, 120, 'pending postgrant snapshot reaches live runtime');
    assert.equal(account.getItem('chessAlkkagi.meta.points'), '120');
    assert.ok(retry, 'pending modal offers retry');
    retry.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(remote['chessAlkkagi.meta.points'], '120', 'retry cannot save stale runtime balance');
    assert.equal(account.getItem('has_completed_tutorial'), 'true');

    // A closed modal cannot be changed by a late result, even if another modal opens.
    const oldStatus = { textContent: '' };
    manager.completionModal = { querySelector: selector => selector === '.tutorial-reward-status' ? oldStatus : null };
    const late = manager.settleCompletionReward('basic');
    const savingText = oldStatus.textContent;
    manager.completionModal = { querySelector: () => ({ textContent: 'new modal' }) };
    await late;
    assert.equal(oldStatus.textContent, savingText);
  } finally {
    globalThis.document = savedDocument;
    progressStorage.owner = original.owner;
    progressStorage.claimTutorialReward = original.claim;
    progressStorage.getItem = original.get;
  }

  let releaseOld;
  const oldGate = new Promise(resolve => { releaseOld = resolve; });
  const oldClient = { rpc: async name => {
    if (name.startsWith('get_account_progress_v')) return { error: { code: 'PGRST202' } };
    if (name === 'get_account_progress') return { data: { data: { 'chessAlkkagi.meta.points': '5', 'chessAlkkagi.meta.upgrades': '{}' }, revision: 1 } };
    if (name === 'claim_tutorial_first_reward') { await oldGate; return { data: { granted: true, data: { 'chessAlkkagi.meta.points': '105', 'chessAlkkagi.meta.upgrades': '{}', has_completed_tutorial: 'true' }, revision: 2 } }; }
    throw Error(name);
  } };
  const switching = new AccountProgressStorage(() => ({ getItem: () => null, setItem() {} }));
  await switching.activate(oldClient, 'old');
  const stale = switching.claimTutorialReward('basic');
  await new Promise(resolve => setTimeout(resolve, 0));
  await switching.activate(client, 'new');
  assert.equal(await switching.claimTutorialReward('basic'), 'repeat', 'new account is not held behind old RPC');
  releaseOld();
  assert.equal(await stale, 'pending');
  assert.equal(switching.owner, 'new');
  assert.equal(switching.getItem('chessAlkkagi.meta.points'), remote['chessAlkkagi.meta.points']);

  let releaseFirst;
  let firstEntered;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  const firstStarted = new Promise(resolve => { firstEntered = resolve; });
  const order = [];
  const orderedRemote = { 'chessAlkkagi.meta.points': '0', 'chessAlkkagi.meta.upgrades': '{}' };
  let orderedRevision = 1;
  const orderedClient = { rpc: async (name, args) => {
    if (name.startsWith('get_account_progress_v')) return { error: { code: 'PGRST202' } };
    if (name === 'get_account_progress') return { data: { data: { ...orderedRemote }, revision: orderedRevision } };
    if (name === 'claim_tutorial_first_reward') {
      order.push(args.p_tutorial_type);
      if (args.p_tutorial_type === 'basic') { firstEntered(); await firstGate; }
      const key = args.p_tutorial_type === 'basic' ? 'has_completed_tutorial' : 'has_completed_adv_tutorial';
      orderedRemote[key] = 'true';
      orderedRemote['chessAlkkagi.meta.points'] = String(Number(orderedRemote['chessAlkkagi.meta.points']) + 100);
      orderedRevision++;
      return { data: { granted: true, data: { ...orderedRemote }, revision: orderedRevision } };
    }
    throw Error(name);
  } };
  const ordered = new AccountProgressStorage(() => ({ getItem: () => null, setItem() {} }));
  await ordered.activate(orderedClient, 'ordered');
  const basic = ordered.claimTutorialReward('basic');
  const advanced = ordered.claimTutorialReward('advanced');
  await firstStarted;
  assert.deepEqual(order, ['basic'], 'second claim waits for first response');
  releaseFirst();
  assert.deepEqual(await Promise.all([basic, advanced]), ['granted', 'granted']);
  assert.deepEqual(order, ['basic', 'advanced']);
  assert.equal(ordered.getItem('chessAlkkagi.meta.points'), '200');
  // A background save can observe the grant before its original RPC reply arrives.
  let releaseDelayed, enteredDelayed;
  const delayedGate = new Promise(resolve => { releaseDelayed = resolve; });
  const delayedStarted = new Promise(resolve => { enteredDelayed = resolve; });
  let delayedRevision = 1;
  let delayedData = { 'chessAlkkagi.meta.points': '10', 'chessAlkkagi.meta.upgrades': '{}' };
  const delayedClient = { rpc: async (name, args) => {
    if (name.startsWith('get_account_progress_v')) return { error: { code: 'PGRST202' } };
    if (name === 'get_account_progress') return { data: { data: { ...delayedData }, revision: delayedRevision } };
    if (name === 'save_account_progress') {
      if (args.p_expected_revision !== delayedRevision) return { error: { code: '40001' } };
      delayedData = { ...args.p_data }; delayedRevision++;
      return { data: { data: { ...delayedData }, revision: delayedRevision } };
    }
    if (name === 'claim_tutorial_first_reward') {
      delayedData['chessAlkkagi.meta.points'] = '110'; delayedData.has_completed_tutorial = 'true'; delayedRevision++;
      const reply = { data: { granted: true, data: { ...delayedData }, revision: delayedRevision } };
      enteredDelayed(); await delayedGate; return reply;
    }
    throw Error(name);
  } };
  const delayed = new AccountProgressStorage(() => ({ getItem: () => null, setItem() {} }));
  await delayed.activate(delayedClient, 'delayed');
  const delayedClaim = delayed.claimTutorialReward('basic');
  await delayedStarted;
  delayed.setItem('has_completed_adv_tutorial', 'started');
  assert.equal(await delayed.flush(), true);
  releaseDelayed(); await delayedClaim;
  assert.equal(delayed.getItem('has_completed_adv_tutorial'), 'started', 'late grant must not roll back a newer saved snapshot');
  assert.equal(delayed.getItem('chessAlkkagi.meta.points'), '110');
  console.log('tutorial reward modal retry, pending reconciliation, closed modal, account switch and ordered claims passed');
} finally { await vite.close(); }
