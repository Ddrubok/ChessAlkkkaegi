import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const calls = [];
let launchRoom = '23456789ABCD';
let instant = false;
const game = {
  loadingStart() {}, loadingStop() {}, gameplayStart() {}, gameplayStop() {},
  get isInstantMultiplayer() { return instant; },
  getInviteParam(name) { assert.equal(name, 'room'); return launchRoom; },
  inviteLink(params) { calls.push(['inviteLink', params]); return `https://www.crazygames.com/game/chess-alkkagi?room=${params.room}`; },
  updateRoom(params) { calls.push(['updateRoom', params]); },
  leftRoom() { calls.push(['leftRoom']); },
};
const sdkMock = {
  init: async () => {},
  user: { isUserAccountAvailable: false, addAuthListener() {} },
  game,
};
globalThis.window = { setTimeout, CrazyGames: { SDK: sdkMock } };
globalThis.document = {
  createElement: () => ({ remove() {} }),
  head: { append(script) { queueMicrotask(() => script.onload()); } },
};
const vite = await createServer({ root: fileURLToPath(new URL('../..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false } });
try {
  const multiplayer = await vite.ssrLoadModule('/src/crazygames-multiplayer.ts');
  const life = await vite.ssrLoadModule('/src/crazygames-stubs/portal-lifecycle.ts');
  await multiplayer.prepareLaunchInvite();
  assert.equal(multiplayer.hasLaunchInvite(), true);
  assert.deepEqual(multiplayer.consumeLaunchInvite(), { room: '23456789ABCD', instant: false });
  assert.equal(multiplayer.consumeLaunchInvite(), null);
  assert.equal(multiplayer.hasLaunchInvite(), false);
  assert.equal(multiplayer.inviteLink('2345-6789-ABCD'), 'https://www.crazygames.com/game/chess-alkkagi?room=23456789ABCD');
  assert.deepEqual(calls.at(-1), ['inviteLink', { room: '23456789ABCD' }]);
  assert.equal(multiplayer.inviteLink('bad'), null);
  assert.equal(calls.filter(call => call[0] === 'inviteLink').length, 1);
  game.inviteLink = () => 'https://other.example/game?room=23456789ABCD';
  assert.equal(multiplayer.inviteLink('23456789ABCD'), null);

  multiplayer.updateRoom('23456789ABCD', true);
  assert.deepEqual(calls.at(-1), ['updateRoom', { roomId: 'friendly-23456789ABCD', isJoinable: true, inviteParams: { room: '23456789ABCD' } }]);
  multiplayer.updateRoom('23456789ABCD', false);
  assert.deepEqual(calls.at(-1), ['updateRoom', { roomId: 'friendly-23456789ABCD', isJoinable: false, inviteParams: { room: '23456789ABCD' } }]);
  life.gameplay.leave('match-result');
  life.gameplay.leave('pause');
  assert.equal(calls.filter(call => call[0] === 'leftRoom').length, 0);
  multiplayer.clearRoom(); // lobby cancel
  multiplayer.clearRoom();
  assert.equal(calls.filter(call => call[0] === 'leftRoom').length, 1);
  multiplayer.updateRoom('23456789ABCD', false);
  life.gameplay.leave('return-to-menu');
  assert.equal(calls.filter(call => call[0] === 'leftRoom').length, 2);

  launchRoom = 'invalid'; instant = true;
  const invalid = await vite.ssrLoadModule('/src/crazygames-multiplayer.ts?invalid');
  await invalid.prepareLaunchInvite();
  assert.deepEqual(invalid.consumeLaunchInvite(), { room: 'invalid', instant: true });
  assert.equal(invalid.inviteLink('invalid'), null);
  launchRoom = null;
  const instantOnly = await vite.ssrLoadModule('/src/crazygames-multiplayer.ts?instant');
  await instantOnly.prepareLaunchInvite();
  assert.deepEqual(instantOnly.consumeLaunchInvite(), { instant: true });
  instant = false;
  game.getInviteParam = undefined;
  game.inviteLink = undefined;
  const unavailable = await vite.ssrLoadModule('/src/crazygames-multiplayer.ts?missing-param');
  await unavailable.prepareLaunchInvite();
  assert.equal(unavailable.hasLaunchInvite(), false);
  assert.equal(unavailable.inviteLink('23456789ABCD'), null);
  console.log('CrazyGames invite checks passed');
} finally { await vite.close(); }
