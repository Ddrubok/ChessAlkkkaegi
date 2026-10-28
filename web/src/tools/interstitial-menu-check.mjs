import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';

// Exercise the actual menu transition without loading the game's rendering stack.
const source = await readFile(new URL('../menu.ts', import.meta.url), 'utf8');
const start = source.indexOf('export async function returnToMainMenu(');
assert(start >= 0);
const fn = stripTypeScriptTypes(source.slice(start, source.indexOf('/**', start)))
  .replace('export ', '');
let adCalls = 0, exits = 0, menus = 0, releaseAd;
let behavior = () => Promise.resolve(false);
const platform = { id: 'web' };
const leaves = [];
const transition = runInNewContext(`${fn}; returnToMainMenu`, {
  PLATFORM: platform,
  gameplay: { leave: reason => leaves.push(reason) },
  AdManager: { showInterstitial: () => { adCalls++; return behavior(); } },
  showMainMenu: () => { menus++; },
  console: { warn() {} },
});
const runtime = { busy: false, ready: false, onReturnToMenu: async () => { exits++; } };
await transition(runtime);
assert.equal(adCalls, 0, 'ordinary menu navigation never requests interstitials');
assert.equal(exits, 1);
behavior = () => new Promise(resolve => { releaseAd = resolve; });
const pending = transition(runtime, true);
assert.equal(runtime.busy, true);
assert.equal(exits, 1, 'game reset waits until the displayed ad is dismissed');
releaseAd(true);
await pending;
assert.equal(exits, 2);
assert.equal(menus, 2);
assert.equal(runtime.busy, false);
behavior = async () => { throw new Error('SDK unavailable'); };
await transition(runtime, true);
assert.equal(exits, 3, 'ad failure must not prevent returning to the menu');
assert.equal(menus, 3);
behavior = async () => false;
await transition(runtime, true);
assert.equal(exits, 4, 'no prepared ad proceeds directly to menu');
assert.equal(runtime.busy, false);
platform.id = 'crazygames';
const callsBeforePortal = adCalls;
await transition(runtime, true);
assert.equal(adCalls, callsBeforePortal, 'CrazyGames Basic never requests a result-menu ad');
assert.equal(exits, 5);
assert.equal(menus, 5);
assert.equal(leaves.length, 5, 'every menu transition leaves gameplay');
console.log('PASS result-menu interstitial ordering, normal navigation exclusion, failure and no-fill fallback');
