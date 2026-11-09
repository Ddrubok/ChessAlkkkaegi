import './headless-browser-env.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

let portalUser = null;
let authListener;
let promptCalls = 0;
let tokenCalls = 0;
const account = id => ({ __dangerousUserId: id, username: `Name.${id}`, profilePictureUrl: '' });
const sdkMock = {
  init: async () => {},
  user: {
    isUserAccountAvailable: true,
    getUser: async () => portalUser,
    getUserToken: async options => { assert.deepEqual(options, { signingKeyType: 'IN_GAME_AUTH' }); tokenCalls++; return 'opaque-token'; },
    showAuthPrompt: async () => { promptCalls++; portalUser = account('cg-1'); authListener(portalUser); return portalUser; },
    addAuthListener: listener => { authListener = listener; },
    removeAuthListener: () => {},
  },
  game: { loadingStart() {}, loadingStop() {}, gameplayStart() {}, gameplayStop() {} },
};
window.CrazyGames = { SDK: sdkMock };
document.createElement = () => ({ remove() {} });
document.head = { append: script => queueMicrotask(() => script.onload()) };
const vite = await createServer({ root: fileURLToPath(new URL('../..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false } });
try {
  const { signInCrazyGames } = await vite.ssrLoadModule('/src/crazygames-auth.ts');
  const client = {
    current: null, invokes: 0, prompts: 0, signOuts: 0, rank: 1200,
    response: { session: { access_token: 'access', refresh_token: 'refresh' } },
    auth: {
      signOut: async () => { client.signOuts++; client.current = null; return { error: null }; },
      setSession: async () => { client.current = client.nextUser; client.expiresAt = client.nextExpiry ?? Math.floor(Date.now() / 1000) + 3600; return { data: { user: client.current, session: { user: client.current, expires_at: client.expiresAt } }, error: null }; },
      getSession: async () => ({ data: { session: client.current ? { user: client.current, expires_at: client.expiresAt } : null } }),
    },
    functions: { invoke: async (name, options) => {
      assert.equal(name, 'crazygames-auth');
      assert.deepEqual(options.body, { token: 'opaque-token' });
      assert.equal(options.timeout, 10000);
      client.invokes++;
      return { data: client.response, error: null };
    } },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'sb-1', nickname: 'DatabaseName', classic_mmr: client.rank, referral_code: 'REF1' }, error: null }) }) }) }),
  };
  const bound = (id = 'cg-1', gameId = 'game-1') => ({ id: 'sb-1', is_anonymous: false, app_metadata: { crazygames: { user_id: id, game_id: gameId } } });
  client.nextUser = bound();
  assert.equal(await signInCrazyGames(client), null); // guest
  assert.equal(client.invokes, 0);
  assert.equal(promptCalls, 0);
  sdkMock.user.isUserAccountAvailable = false;
  assert.equal(await signInCrazyGames(client, true), null);
  assert.equal(promptCalls, 0);
  sdkMock.user.isUserAccountAvailable = true;
  portalUser = account('cg-1'); authListener(portalUser);
  const [first, duplicate] = await Promise.all([signInCrazyGames(client, true), signInCrazyGames(client, true)]);
  assert.equal(first.nickname, 'Name.cg-1');
  assert.equal(duplicate.id, 'sb-1');
  assert.equal(client.invokes, 1);
  assert.equal(tokenCalls, 1);
  client.rank = 1216;
  assert.equal((await signInCrazyGames(client)).classicMmr, 1216);
  assert.equal(client.invokes, 1); // verified session and SDK identity are reused
  client.expiresAt = Math.floor(Date.now() / 1000) - 1;
  assert.equal((await signInCrazyGames(client)).id, 'sb-1');
  assert.equal(client.invokes, 2); // expired session must be exchanged again
  client.nextUser = bound('forged');
  client.expiresAt = 0;
  assert.equal(await signInCrazyGames(client, true), null);
  assert.equal(client.current, null);
  client.nextUser = bound('cg-1', '');
  assert.equal(await signInCrazyGames(client, true), null);
  assert.equal(client.current, null);
  client.response = { session: { access_token: 'access' } };
  client.nextUser = bound();
  assert.equal(await signInCrazyGames(client, true), null);
  assert.equal(client.current, null);
  client.response = { session: { access_token: 'access', refresh_token: 'refresh' } };
  client.nextUser = bound();
  client.nextExpiry = null;
  let release;
  client.functions.invoke = async () => { client.invokes++; await new Promise(resolve => { release = resolve; }); return { data: client.response, error: null }; };
  const racing = signInCrazyGames(client, true);
  while (!release) await new Promise(resolve => setTimeout(resolve, 0));
  portalUser = account('cg-2'); authListener(portalUser);
  release();
  assert.equal(await racing, null);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(client.current, null);
  client.functions.invoke = async () => { client.invokes++; return { data: client.response, error: null }; };
  portalUser = account('cg-3'); authListener(portalUser);
  client.nextUser = bound('cg-3');
  assert.equal((await signInCrazyGames(client, true)).nickname, 'Name.cg-3');
  const beforeRecheck = client.invokes;
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 3000;
    portalUser = account('cg-4'); // simulate an SDK change with a missed listener event
    client.nextUser = bound('cg-4');
    assert.equal((await signInCrazyGames(client)).nickname, 'Name.cg-4');
  } finally { Date.now = realNow; }
  assert.equal(client.invokes, beforeRecheck + 1);
  assert.equal(promptCalls, 0);
  assert.equal(typeof client.auth.signInAnonymously, 'undefined');
  console.log('CrazyGames auth checks passed');
} finally { await vite.close(); }
