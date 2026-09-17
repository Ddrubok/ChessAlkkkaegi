import './headless-browser-env.mjs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
globalThis.__bannerAwards = [];
const vite = await createServer({ root: fileURLToPath(new URL('../..', import.meta.url)), configFile: false, logLevel: 'error', server: { middlewareMode: true, hmr: false }, plugins: [{
  name: 'banner-recording-test', resolveId(id) { if (id === './banner-progress') return '/banner-progress.ts'; }, load(id) { if (id.endsWith('/banner-progress.ts')) return 'export const recordBannerShot = (_s, v) => globalThis.__bannerAwards.push(["shot", v]); export const recordBannerVictory = (_s, v) => globalThis.__bannerAwards.push(["win", v]);'; },
}] });
try {
  const { createBannerMatch, settleBannerMatch, finishBannerMatch } = await vite.ssrLoadModule('/src/banner-match.ts');
  const storage = { owner: 'member-a' };
  const shot = { eventId: 'game:L1', enemyPieceIds: ['b1'], ownRemaining: 2, enemyRemaining: 5, playerLaunch: true, eligible: true };
  let run = createBannerMatch(storage.owner, 5, true, 16, 16);
  run.launchType = 'Knight'; settleBannerMatch(storage, run, shot);
  assert.equal(run.comeback, true); assert.equal(run.launchType, null);
  settleBannerMatch(storage, run, { ...shot, eventId: null, ownRemaining: 1, enemyRemaining: 3 });
  finishBannerMatch(storage, run, 'game', true); finishBannerMatch(storage, run, 'game', true);
  assert.equal(globalThis.__bannerAwards.filter(([k]) => k === 'win').length, 1);
  assert.equal(globalThis.__bannerAwards.at(-1)[1].comebackEligible, true);
  run = createBannerMatch(storage.owner, 5, true, 3, 5);
  settleBannerMatch(storage, run, { ...shot, ownRemaining: 2, enemyRemaining: 4 });
  assert.equal(run.comeback, false);
  assert.equal(createBannerMatch(storage.owner, 5, true, 2, 5).comeback, true);
  assert.equal(createBannerMatch(storage.owner, 5, true, 0, 5).comeback, false);
  const before = globalThis.__bannerAwards.length;
  for (const [owner, eligible, account] of [[null, true, storage.owner], [storage.owner, false, storage.owner], [storage.owner, true, 'member-b']]) {
    const r = createBannerMatch(owner, 5, eligible, 2, 5); r.launchType = 'Knight';
    settleBannerMatch({ owner: account }, r, shot); finishBannerMatch({ owner: account }, r, 'excluded', true);
  }
  assert.equal(globalThis.__bannerAwards.length, before);
  run = createBannerMatch(storage.owner, 5, true, 2, 5);
  settleBannerMatch(storage, run, { ...shot, eligible: false });
  finishBannerMatch(storage, run, 'automatic-or-debug', true);
  assert.equal(globalThis.__bannerAwards.length, before);
  run = createBannerMatch(storage.owner, 5, true, 2, 5); finishBannerMatch(storage, run, 'loss', false);
  assert.equal(globalThis.__bannerAwards.length, before);
  assert.equal(createBannerMatch(storage.owner, 5, true, 16, 16).comeback, false);
  console.log('PASS banner match: same-moment comeback, sticky flag, reset, launch type, owner isolation, guest/debug/automatic exclusion and once-only finish');
} finally { delete globalThis.__bannerAwards; await vite.close(); }
