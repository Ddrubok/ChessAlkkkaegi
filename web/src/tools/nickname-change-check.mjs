import './headless-browser-env.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
const vite = await createServer({ root: fileURLToPath(new URL('../..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false } });
try {
  const { changeNickname, getNicknameState } = await vite.ssrLoadModule('/src/nickname.ts');
  let account = 'owner', failure = false, request;
  const state = { nickname: 'ServerName', free_available: false, tickets: 0 };
  const client = {
    rpc: async (method, args) => { request = { method, args }; return { data: failure ? { ok: false, code: 'taken' } : { ...state, ok: true }, error: null }; },
    auth: { getSession: async () => ({ data: { session: { user: { id: account } } }, error: null }) },
  };
  assert.equal((await getNicknameState(client)).tickets, 0);
  await changeNickname(client, 'owner', ' Ａlice ', 'stable-request');
  assert.deepEqual(request, { method: 'change_nickname_v1', args: { p_nickname: 'Alice', p_request_id: 'stable-request', p_expected_user_id: 'owner' } });
  assert.equal(localStorage.getItem('ca_local_nickname'), 'ServerName');
  localStorage.setItem('ca_local_nickname', 'Keep');
  failure = true;
  await assert.rejects(changeNickname(client, 'owner', 'Taken', 'other-request'));
  assert.equal(localStorage.getItem('ca_local_nickname'), 'Keep');
  failure = false; account = 'other-account';
  await assert.rejects(changeNickname(client, 'owner', 'Alice', 'stable-request'));
  assert.equal(localStorage.getItem('ca_local_nickname'), 'Keep');
  await assert.rejects(getNicknameState({ rpc: async () => ({ data: { ...state, tickets: -1 }, error: null }) }));
  console.log('PASS nickname client: normalized input, expected account and request ID, server-authoritative cache, duplicate rejection, account-switch protection, malformed inventory rejection');
} finally { await vite.close(); }
