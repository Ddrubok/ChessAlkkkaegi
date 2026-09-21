import './headless-browser-env.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

// Only the browser audio boundary is mocked; exercise the production sound module.
let context, bgm, starts = 0, stops = 0, rejectPlay = false;
class Context extends EventTarget {
  state = 'suspended'; destination = {};
  constructor() { super(); context = this; }
  async transition(state) { await Promise.resolve(); if (this.state !== state) { this.state = state; this.dispatchEvent(new Event('statechange')); } }
  resume() { return this.transition('running'); }
  suspend() { return this.transition('suspended'); }
  decodeAudioData() { return Promise.resolve({}); }
  createGain() { return { gain: { value: 1 }, connect() {} }; }
  createBufferSource() { return { connect() {}, disconnect() {}, start() { starts++; }, stop() { stops++; this.onended?.(); } }; }
}
window.AudioContext = Context;
globalThis.Audio = class {
  volume = 1; paused = true;
  constructor() { bgm = this; }
  play() { if (rejectPlay) return Promise.reject(new Error('test autoplay rejection')); this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
};
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) });
localStorage.setItem('chessAlkkagi.soundSettings', JSON.stringify({ muted: true, masterVolume: 1, bgmVolume: .6, sfxVolume: .8 }));
const vite = await createServer({ root: fileURLToPath(new URL('../..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false } });
const settle = () => new Promise(r => setTimeout(r, 10));
const hidden = value => { document.hidden = value; document.dispatchEvent(new Event('visibilitychange')); };
try {
  const s = await vite.ssrLoadModule('/src/sound.ts');
  s.initializeSound(); document.dispatchEvent(new Event('pointerdown')); await settle();
  assert.equal(bgm.volume, 0); assert.equal(bgm.paused, true);
  s.updateSoundSettings({ muted: false }); await settle();
  assert.equal(bgm.volume, .108); assert.equal(bgm.paused, false);
  s.playPieceClickSound(); const beforeMute = starts;
  s.updateSoundSettings({ muted: true }); assert.ok(stops > 0);
  hidden(true); await settle(); hidden(false); s.updateSoundSettings({ muted: false }); await settle();
  assert.equal(context.state, 'running'); assert.equal(bgm.paused, false);
  s.playPieceClickSound(); assert.equal(starts, beforeMute + 1);
  s.setAdSoundMuted(true); hidden(true); await settle(); hidden(false); s.setAdSoundMuted(false); await settle();
  assert.equal(context.state, 'running'); assert.equal(bgm.paused, false);
  s.updateSoundSettings({ muted: true }); s.updateSoundSettings({ muted: false }); await settle();
  assert.equal(context.state, 'running');
  s.updateSoundSettings({ muted: true }); s.setAdSoundMuted(true); s.setAdSoundMuted(false); await settle();
  assert.equal(bgm.paused, true); assert.equal(s.getSoundSettings().muted, true);
  s.updateSoundSettings({ muted: false }); await settle();
  window.dispatchEvent(new Event('pagehide')); await settle(); assert.equal(bgm.paused, true);
  window.dispatchEvent(new Event('pageshow')); await settle(); assert.equal(bgm.paused, false);
  s.resetAimPowerSounds(); let n = starts; s.updateAimPowerSounds(.95); assert.equal(starts - n, 1);
  n = starts; s.updateAimPowerSounds(.89); s.updateAimPowerSounds(.91); assert.equal(starts, n);
  s.updateAimPowerSounds(.85); s.updateAimPowerSounds(.91); assert.equal(starts, n + 1);
  s.updateSoundSettings({ bgmVolume: 0 }); await settle(); assert.equal(bgm.paused, true);
  rejectPlay = true; s.updateSoundSettings({ bgmVolume: .6 }); await settle();
  rejectPlay = false; document.dispatchEvent(new Event('pointerdown')); await settle(); assert.equal(bgm.paused, false);
  s.updateSoundSettings({ sfxVolume: 0 }); n = starts; s.playPieceClickSound(); assert.equal(starts, n);
  console.log('PASS sound: persisted mute, volume, foreground/unmute/ad recovery, rapid toggles, page lifecycle, stale-source stop, autoplay retry, one aim cue and hysteresis, SFX zero');
} finally { globalThis.fetch = originalFetch; await vite.close(); }
