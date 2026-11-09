import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const calls = [];
let authListener;
let userCalls = 0;
const user = { __dangerousUserId: 'cg-1', username: 'Player.One', profilePictureUrl: 'https://example.test/avatar' };
const sdkMock = {
  init: async () => calls.push('init'),
  user: {
    isUserAccountAvailable: true,
    getUser: async () => { userCalls++; return user; },
    getUserToken: async () => 'token',
    showAuthPrompt: async () => user,
    addAuthListener: listener => { authListener = listener; },
    removeAuthListener: () => {},
  },
  game: Object.fromEntries(['loadingStart', 'loadingStop', 'gameplayStart', 'gameplayStop'].map(name => [name, () => calls.push(name)])),
};
globalThis.window = { setTimeout, CrazyGames: { SDK: sdkMock } };
globalThis.document = {
  createElement: () => ({ remove() {} }),
  head: { append(script) { assert.equal(script.src, 'https://sdk.crazygames.com/crazygames-sdk-v3.js'); queueMicrotask(() => script.onload()); } },
};
const vite = await createServer({ root: fileURLToPath(new URL('../..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false } });
try {
  const sdk = await vite.ssrLoadModule('/src/crazygames-sdk.ts');
  const life = await vite.ssrLoadModule('/src/crazygames-stubs/portal-lifecycle.ts');
  await Promise.all([life.init(), life.init()]);
  assert.equal(calls.filter(x => x === 'init').length, 1);
  assert.equal(calls.filter(x => x === 'loadingStart').length, 1);
  life.loadingFinished(); life.loadingFinished();
  assert.equal(calls.filter(x => x === 'loadingStop').length, 1);
  life.gameplay.enter('match'); life.gameplay.enter('duplicate');
  const version = life.gameplay.leave('pause');
  life.gameplay.leave('menu');
  life.gameplay.enter('stale', version);
  assert.equal(calls.filter(x => x === 'gameplayStart').length, 1);
  life.gameplay.enter('resume'); life.gameplay.leave('end');
  assert.equal(calls.filter(x => x === 'gameplayStart').length, 2);
  assert.equal(calls.filter(x => x === 'gameplayStop').length, 2);
  assert.equal((await sdk.getUser()).username, 'Player.One');
  assert.equal(userCalls, 1); // initialized before main subscribes; no rapid SDK recheck
  let changes = 0;
  const unsubscribe = sdk.onIdentityChanged(() => changes++);
  authListener(user);
  assert.equal(changes, 0); // repeated same-account events must not reload the game
  authListener(null);
  assert.equal(sdk.getCachedUser(), null);
  assert.equal(changes, 1);
  authListener({ ...user, __dangerousUserId: '' });
  assert.equal(changes, 1); // invalid IDs remain guests
  const realNow = Date.now;
  let releaseUser;
  sdkMock.user.getUser = () => new Promise(resolve => { releaseUser = resolve; });
  try {
    Date.now = () => realNow() + 3000;
    const stale = sdk.getUser();
    while (!releaseUser) await new Promise(resolve => setTimeout(resolve, 0));
    const newer = { ...user, __dangerousUserId: 'cg-2' };
    authListener(newer);
    releaseUser(user);
    assert.equal((await stale).__dangerousUserId, 'cg-2');
    assert.equal(changes, 2);
  } finally { Date.now = realNow; }
  unsubscribe();
  assert.deepEqual(calls.slice(0, 3), ['init', 'loadingStart', 'loadingStop']);
  const unavailable = await vite.ssrLoadModule('/src/crazygames-sdk.ts?unavailable');
  window.CrazyGames = undefined;
  document.head.append = script => queueMicrotask(() => script.onerror());
  await unavailable.init();
  assert.equal(unavailable.isSdkAvailable(), false);
  assert.equal(await unavailable.getUser(), null);
  console.log('CrazyGames SDK/lifecycle checks passed');
} finally { await vite.close(); }
