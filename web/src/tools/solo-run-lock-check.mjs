import './headless-browser-env.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, logLevel: 'error', server: { middlewareMode: true, hmr: false } });
try {
  const { claimSoloRunTab } = await vite.ssrLoadModule('/src/solo-run-lock.ts');
  Object.defineProperty(navigator, 'locks', { configurable: true, writable: true, value: undefined });
  assert.equal(await claimSoloRunTab(null), 'session-only', 'missing API allows isolated play');
  navigator.locks = { request: () => Promise.reject(Error('denied')) };
  assert.equal(await claimSoloRunTab(null), 'session-only', 'rejected request allows isolated play');
  navigator.locks = { request: () => { throw Error('blocked'); } };
  assert.equal(await claimSoloRunTab(null), 'session-only', 'synchronous rejection allows isolated play');
  navigator.locks = { request: (_key, _options, callback) => Promise.resolve(callback(null)) };
  assert.equal(await claimSoloRunTab(null), 'occupied', 'an occupied tab cannot bypass its lock');
  let requestedKey;
  navigator.locks = { request: (key, options, callback) => {
    requestedKey = key;
    assert.equal(options.ifAvailable, true);
    void callback({ name: key });
    return new Promise(() => {});
  } };
  assert.equal(await claimSoloRunTab('account-a'), 'acquired');
  assert.match(requestedKey, /progress:account-a$/);
  const { progressStorage } = await vite.ssrLoadModule('/src/progress-storage.ts');
  const { createSoloRun, saveSoloRun, readSoloRun } = await vite.ssrLoadModule('/src/solo-run.ts');
  const persistent = localStorage;
  const { useTemporaryPortalStorage } = await vite.ssrLoadModule('/src/portal-browser-guards.ts');
  useTemporaryPortalStorage();
  globalThis.localStorage = window.localStorage; // The headless shim has separate global and window objects.
  const memory = localStorage;
  await progressStorage.activate(null, null);
  progressStorage.setItem('has_completed_tutorial', 'skipped');
  assert.equal(progressStorage.getItem('has_completed_tutorial'), 'skipped', 'shared progress caller reads memory');
  assert.equal(persistent.getItem('has_completed_tutorial'), null, 'shared progress caller leaves saved guest data untouched');
  const savedRun = createSoloRun(null, 1, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  assert.equal(saveSoloRun(savedRun, persistent), true);
  const run = createSoloRun(null, 1, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.equal(saveSoloRun(run, memory), false, "temporary progress is not durable");
  assert.equal(readSoloRun(null, memory).run?.runId, run.runId);
  assert.equal(readSoloRun(null, persistent).run?.runId, savedRun.runId, 'session run cannot overwrite the saved run');
  console.log('PASS solo lock: outcomes and shared in-memory progress/run isolation');
} finally { await vite.close(); }
