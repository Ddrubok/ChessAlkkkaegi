import './headless-browser-env.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import RAPIER from '@dimforge/rapier3d-compat';

// Only the browser audio boundary is mocked; exercise the production sound module.
let context, bgm, starts = 0, stops = 0, rejectPlay = false;
class Context extends EventTarget {
  state = 'suspended'; destination = {};
  constructor() { super(); context = this; }
  async transition(state) { await Promise.resolve(); if (this.state !== state) { this.state = state; this.dispatchEvent(new Event('statechange')); } }
  resume() { return this.transition('running'); }
  suspend() { return this.transition('suspended'); }
  decodeAudioData() { return Promise.resolve({}); }
  currentTime = 0;
  createGain() { return { gain: { value: 1, setTargetAtTime(value) { this.value = value; }, setValueAtTime(value) { this.value = value; }, exponentialRampToValueAtTime(value) { this.value = value; } }, connect() {}, disconnect() {} }; }
  createOscillator() { return { frequency: { value: 0, setTargetAtTime(value) { this.value = value; }, setValueAtTime(value) { this.value = value; }, exponentialRampToValueAtTime(value) { this.value = value; } }, connect() {}, disconnect() {}, start() {}, stop() { this.onended?.(); } }; }
  createBufferSource() { return { playbackRate: { value: 1 }, connect() {}, disconnect() {}, start() { starts++; }, stop() { stops++; this.onended?.(); } }; }
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
  s.resetAimPowerSounds(); let n = starts;
  s.updateAimPowerSounds(.95); assert.equal(starts, n);
  s.updateAimPowerSounds(1); assert.equal(starts, n + 1);
  s.updateAimPowerSounds(.99); s.updateAimPowerSounds(1); assert.equal(starts, n + 1);
  s.updateAimPowerSounds(.96); s.updateAimPowerSounds(1); assert.equal(starts, n + 2);
  s.resetAimPowerSounds(); n = starts;
  s.updateAimPowerSounds(1, 1.5); assert.equal(starts, n);
  s.updateAimPowerSounds(1.01, 1.5); assert.equal(starts, n + 1);
  s.updateAimPowerSounds(1.5, 1.5); assert.equal(starts, n + 2);
  s.updateAimPowerSounds(1.49, 1.5); s.updateAimPowerSounds(1.5, 1.5); assert.equal(starts, n + 2);
  s.resetAimPowerSounds(); s.updateAimPowerSounds(1.5, 1.5); assert.equal(starts, n + 3);
  s.updateSoundSettings({ muted: true }); n = starts;
  s.playRingOutSound(false); s.updateAimPowerSounds(1); assert.equal(starts, n);
  s.updateSoundSettings({ muted: false }); await settle();
  s.resetAimPowerSounds(); s.playRingOutSound(false); s.playRingOutSound(true);

  await RAPIER.init();
  const makeRuntime = (speed, third = false, reverse = false, originOffset = 0, spin = false) => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    world.timestep = 1 / 120;
    const pieces = new Map();
    const add = (id, x, vx) => {
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, -originOffset, 0).setLinvel(vx, 0, 0).setAngvel({x:0,y:0,z:spin&&vx>0?6:0}).setLinearDamping(0));
      const collider = world.createCollider(RAPIER.ColliderDesc.ball(.5).setTranslation(0,originOffset,0).setRestitution(.2).setDensity(1), body);
      pieces.set(id, { instance: { id, type: 'Pawn' }, body, collider });
      return body;
    };
    if(reverse){add('b',0,0);add('a',-1.1,speed);const b=pieces.get('b');pieces.delete('b');pieces.set('b',b);}
    else{add('a', -1.1, speed); add('b', 0, 0);} if (third) add('c', 1.1, 0);
    return { world, pieces, breakableWalls: new Map(), pinballObstacles: new Map() };
  };
  const runShot = (speed, third = false, reverse = false, originOffset = 0, spin = false) => {
    const runtime = makeRuntime(speed, third, reverse, originOffset, spin);
    s.resetPieceHitSoundTracking();
    // Cold scan primes existing contact; no snapshot catch-up impact.
    s.capturePreStepImpactState(runtime); runtime.world.step(); s.scanLivePieceHitSounds(runtime, 0);
    assert.deepEqual(s.flushLiveImpactSounds(0), []);
    const events = [];
    for (let i = 1; i <= 100; i++) {
      s.capturePreStepImpactState(runtime); runtime.world.step(); s.scanLivePieceHitSounds(runtime, i * 1000 / 120);
      events.push(...s.flushLiveImpactSounds(i * 1000 / 120));
    }
    runtime.world.free();
    return events;
  };
  const weak = runShot(2), strong = runShot(10), chain = runShot(10, true);
  assert.equal(weak.length, 1, JSON.stringify(weak));
  assert.equal(strong.length, 1, JSON.stringify(strong));
  assert.ok(strong[0].strength > weak[0].strength, JSON.stringify({ weak, strong }));
  assert.deepEqual(chain.map(event => event.pairKey), ['piece:a|piece:b', 'piece:b|piece:c']);
  const reversed = runShot(2,false,true);
  assert.equal(reversed.length,1,'flipped Rapier manifold must still produce an approaching impact');
  assert.ok(Math.abs(reversed[0].strength-weak[0].strength)<1e-5,'collider creation order must not change impact strength');
  const spinning=runShot(2,false,false,0,true),offsetSpinning=runShot(2,false,false,.5,true);
  assert.equal(offsetSpinning.length,spinning.length,'shifted body origin with identical world COM must preserve spin contact');
  assert.ok(spinning.length>0);
  assert.ok(Math.abs(offsetSpinning[0].strength-spinning[0].strength)<.001,'contact velocity must be relative to COM');
  const results=[];
  for(const fps of [0,30,60]){
    const r=makeRuntime(10,true);s.resetPieceHitSoundTracking();
    for(let step=0;step<240;step++){
      if(fps)s.capturePreStepImpactState(r);r.world.step();
      if(fps){s.scanLivePieceHitSounds(r,step*1000/120);if((step+1)%(120/fps)===0)s.flushLiveImpactSounds(step*1000/120);}
    }
    results.push([...r.pieces.values()].map(p=>({p:p.body.translation(),q:p.body.rotation(),v:p.body.linvel(),w:p.body.angvel()})));r.world.free();
  }
  assert.deepEqual(results[0],results[1],'30fps feedback must not change physics');
  assert.deepEqual(results[0],results[2],'60fps feedback must not change physics');
  s.updateSoundSettings({ muted: true });
  assert.equal(runShot(10).length, 1, 'visual impact must survive mute and lack of playback');
  s.updateSoundSettings({ muted: false }); await settle();
  const resting = makeRuntime(0);
  resting.pieces.get('b').body.setTranslation({ x: -.95, y: 0, z: 0 }, true);
  s.resetPieceHitSoundTracking();
  for (let i = 0; i < 12; i++) {
    s.capturePreStepImpactState(resting); resting.world.step(); s.scanLivePieceHitSounds(resting, i * 1000 / 120);
    assert.deepEqual(s.flushLiveImpactSounds(i * 1000 / 120), []);
  }
  resting.world.free();
  if (strong[0].strength >= .65) {
    runShot(10);
    assert.ok(bgm.volume < .108, 'strong impact briefly ducks BGM');
    await new Promise(resolve => setTimeout(resolve, 170));
    assert.equal(bgm.volume, .108, 'BGM returns to saved gain');
  }
  s.updateSoundSettings({ bgmVolume: 0 }); await settle(); assert.equal(bgm.paused, true);
  rejectPlay = true; s.updateSoundSettings({ bgmVolume: .6 }); await settle();
  rejectPlay = false; document.dispatchEvent(new Event('pointerdown')); await settle(); assert.equal(bgm.paused, false);
  s.updateSoundSettings({ sfxVolume: 0 }); n = starts; s.playPieceClickSound(); assert.equal(starts, n);
  runShot(10);assert.equal(bgm.volume,.108,'SFX zero must not duck BGM');
  console.log('PASS sound: lifecycle, aim cap/hysteresis/cancel/mute, ring-out mute, real Rapier weak/strong/chain/continuous contacts, SFX zero');
} finally { globalThis.fetch = originalFetch; await vite.close(); }
