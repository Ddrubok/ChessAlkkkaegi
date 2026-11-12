import './headless-browser-env.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

let bgm, context, starts = 0, attempts = 0, authListeners = 0, settingsListener;
class Context extends EventTarget {
  state = 'suspended'; destination = {};
  constructor() { super(); context = this; }
  createGain() { return { gain: { value: 1 }, connect() {} }; }
  createBufferSource() { return { playbackRate: { value: 1 }, connect() {}, start() { starts++; }, stop() {} }; }
  decodeAudioData() { return Promise.resolve({}); }
  async resume() { this.state = 'running'; this.dispatchEvent(new Event('statechange')); }
  async suspend() { this.state = 'suspended'; this.dispatchEvent(new Event('statechange')); }
}
window.AudioContext = Context;
globalThis.Audio = class {
  volume = 1; paused = true;
  constructor() { bgm = this; }
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
};
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) });
const account = { __dangerousUserId: 'recovered-1', username: 'Recovered', profilePictureUrl: '' };
const sdkMock = {
  init: async () => { attempts++; if (attempts === 1) throw Error('temporary failure'); },
  user: {
    isUserAccountAvailable: true,
    getUser: async () => account,
    addAuthListener: () => { authListeners++; },
  },
  game: {
    settings: { muteAudio: true },
    addSettingsChangeListener: listener => { settingsListener = listener; },
  },
};
window.CrazyGames = { SDK: sdkMock };
let scripts = 0;
document.createElement = () => ({ remove() {} });
document.head = { append: script => { scripts++; queueMicrotask(() => script.onload()); } };
const settle = () => new Promise(resolve => setTimeout(resolve, 10));
const vite = await createServer({ root: fileURLToPath(new URL('../..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false } });
try {
  const sdk = await vite.ssrLoadModule('/src/crazygames-sdk.ts');
  const sound = await vite.ssrLoadModule('/src/sound.ts');
  let identities = 0;
  sdk.onIdentityChanged(() => identities++);
  await Promise.all([sdk.init(), sdk.init()]);
  assert.equal(attempts, 1);
  assert.equal(sdk.isSdkAvailable(), false);
  assert.equal(await sdk.getUser(), null);
  assert.equal(attempts, 1, 'ordinary checks must not retry failed SDK init');
  await Promise.all([sdk.init(true), sdk.init(true)]);
  assert.equal(attempts, 2, 'explicit recovery must be single flight');
  assert.equal(scripts, 2);
  assert.equal(authListeners, 1);
  assert.equal(identities, 1, 'recovered identity must invalidate the guest namespace');
  assert.equal((await sdk.getUser())?.__dangerousUserId, account.__dangerousUserId);

  const timed = await vite.ssrLoadModule('/src/crazygames-sdk.ts?timeout');
  const originalWindowTimeout = window.setTimeout;
  let finishLate;
  const delayedSdk = {
    ...sdkMock,
    init: () => new Promise(resolve => { finishLate = resolve; }),
    user: { ...sdkMock.user, addAuthListener: () => {} },
  };
  window.CrazyGames.SDK = delayedSdk;
  window.setTimeout = (callback) => setTimeout(callback, 10);
  try {
    const expired = timed.init();
    while (!finishLate) await settle();
    await expired;
    assert.equal(timed.isSdkAvailable(), false);
    window.CrazyGames.SDK = sdkMock;
    await timed.init(true);
    assert.equal(timed.getSdk(), sdkMock);
    finishLate();
    await settle();
    assert.equal(timed.getSdk(), sdkMock, 'late completion cannot replace recovered SDK');
  } finally { window.setTimeout = originalWindowTimeout; }

  sound.initializeSound();
  document.dispatchEvent(new Event('pointerdown'));
  await settle();
  assert.equal(bgm.volume, 0, 'initial platform mute must silence BGM');
  assert.equal(bgm.paused, true);
  sound.playPieceClickSound();
  assert.equal(starts, 0, 'initial platform mute must silence SFX');
  sound.updateSoundSettings({ muted: false, masterVolume: 1, bgmVolume: 1, sfxVolume: 1 });
  await settle();
  assert.equal(bgm.volume, 0, 'player settings cannot override platform mute');
  settingsListener({ muteAudio: false });
  await settle();
  assert.ok(bgm.volume > 0 && !bgm.paused);
  sound.playPieceClickSound();
  assert.equal(starts, 1);
  sound.updateSoundSettings({ muted: true });
  settingsListener({ muteAudio: true });
  settingsListener({ muteAudio: false });
  await settle();
  assert.equal(bgm.volume, 0, 'player mute must remain after platform unmute');
  sound.playPieceClickSound();
  assert.equal(starts, 1);
  assert.equal(sound.getSoundSettings().muted, true);
  console.log('CrazyGames SDK recovery/audio checks passed');
} finally {
  globalThis.fetch = originalFetch;
  await vite.close();
}
