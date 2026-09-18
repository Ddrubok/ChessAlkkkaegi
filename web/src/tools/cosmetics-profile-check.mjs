import './headless-browser-env.mjs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const vite = await createServer({ root: fileURLToPath(new URL('../..', import.meta.url)), configFile: false,
  logLevel: 'error', server: { middlewareMode: true, hmr: false },
  plugins: [{ name: 'cosmetic-rpc-test', load(id) {
    if (id.includes('supabase-client')) return 'export function getSupabaseClient(){return globalThis.__cosmeticClient;}';
  } }],
});
try {
  const { readOpponentCosmetics } = await vite.ssrLoadModule('/src/banner-profile.ts');
  const { DEFAULT_COSMETICS, GUEST_COSMETICS } = await vite.ssrLoadModule('/src/cosmetics.ts');
  let calls = [];
  let responses = [];
  globalThis.__cosmeticClient = { rpc(name, args) {
    calls.push({ name, args });
    return { abortSignal() { return Promise.resolve(responses.shift()); } };
  } };
  assert.deepEqual(await readOpponentCosmetics('other', false), GUEST_COSMETICS);
  assert.equal(calls.length, 0);
  const expected = { ...DEFAULT_COSMETICS, frame: 'frame:classic-gold', title: 'title:challenger', titleFrame: 'titleFrame:violet' };
  responses = [{ data: expected, error: null }];
  assert.deepEqual(await readOpponentCosmetics('other', true), expected);
  assert.equal(calls[0].name, 'get_player_cosmetics');
  calls = []; responses = [{ error: { code: 'PGRST202' } }, { data: 'forest', error: null }];
  assert.equal((await readOpponentCosmetics('other', true)).banner, 'forest');
  assert.deepEqual(calls.map(c => c.name), ['get_player_cosmetics', 'get_player_banner']);
  calls = []; responses = [{ error: { code: 'NETWORK' } }];
  assert.deepEqual(await readOpponentCosmetics('other', true), DEFAULT_COSMETICS);
  assert.equal(calls.length, 1);
  responses = [{ data: { ...expected, titleFrame: 'javascript:alert(1)' }, error: null }];
  assert.deepEqual(await readOpponentCosmetics('other', true), DEFAULT_COSMETICS);
  console.log('PASS public cosmetics: member-only lookup, six slots, legacy fallback, network limit, invalid ID rejection');
} finally { delete globalThis.__cosmeticClient; await vite.close(); }
