import './headless-browser-env.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
const vite = await createServer({ root: fileURLToPath(new URL('../..', import.meta.url)), configFile: false, optimizeDeps: { noDiscovery: true }, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false }, plugins: [{ name: 'friends-network-double', load(id) { if (id.includes('supabase-client')) return `let client=null; export const setMockClient=c=>client=c; export const getSupabaseClient=()=>client;`; } }] });
try {
  const { SocialService } = await vite.ssrLoadModule('/src/social-service.ts');
  const { setMockClient } = await vite.ssrLoadModule('/src/supabase-client.ts');
  for (const method of ['getFriendsList', 'getPendingRequests']) {
    setMockClient(null);
    assert.equal(await SocialService[method]('member'), null, `${method}: unavailable client must not look empty`);
    for (const result of [{ data: null, error: { message: 'offline' } }, { data: null, error: null }, { data: [], error: null }]) {
      const query = { select() { return this; }, eq() { return this; }, or() { return this; }, then(resolve) { return Promise.resolve(result).then(resolve); } };
      setMockClient({ from: () => query });
      assert.deepEqual(await SocialService[method]('member'), result.data === null ? null : []);
    }
    let resolveRead;
    const delayed = new Promise(resolve => { resolveRead = resolve; });
    const query = { select() { return this; }, eq() { return this; }, or() { return this; }, then(resolve) { return delayed.then(resolve); } };
    setMockClient({ from: () => query });
    let settled = false;
    const read = SocialService[method]('member').then(value => { settled = true; return value; });
    await Promise.resolve();
    assert.equal(settled, false);
    resolveRead({ data: [], error: null });
    assert.deepEqual(await read, []);
  }
  console.log('PASS friends reads: unavailable, server error, malformed response, true empty and delayed success (both tabs)');
} finally { await vite.close(); }
