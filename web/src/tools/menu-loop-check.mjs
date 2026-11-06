import './headless-browser-env.mjs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// Exercise the real scheduler with deterministic frames; rendering/physics are counted boundaries.
const mocks = {
  './platform': 'export const PLATFORM = { features: { debugTools: false } };',
  './ai': 'export function updateAiRuntime() {}',
  './aim': 'export function clearLaunchMotion() {} export function confirmLaunchFeedback() {} export function updateAimVisuals() {}',
  './impact-feedback': 'export function createImpactFeedback(scene) { return { reset() {}, add() {}, render() { scene.renderer.render(); } }; }',
  './input': 'export function isInputCameraTransitioning() { return false; } export function updateInputRuntime() {}',
  './scene': 'export function synchronizePieceMeshes() { return 0; }',
  './sound': 'export function capturePreStepImpactState() {} export function flushLiveImpactSounds() { return []; } export function playSoundEffect() {} export function resetPieceHitSoundTracking() {} export function scanLivePieceHitSounds() {}',
  './tuning': 'export function verifyTuningAfterStep() {}',
  './turn': 'export function applyPendingLaunchBeforeStep() { return false; } export function collectGroundedPieceIds() { return new Set(); } export function countRemainingPieces() { return { white: 0, black: 0 }; } export function updateTurnAfterStep() {} export function updateTurnCamera() {} export function wakeAllTurnPieces() {}',
};
const vite = await createServer({
  root: fileURLToPath(new URL('../..', import.meta.url)), configFile: false, logLevel: 'error',
  server: { middlewareMode: true, hmr: false },
  plugins: [{ name: 'loop-test-boundaries', enforce: 'pre',
    resolveId(id, importer) {
      if (importer?.replaceAll('\\', '/').endsWith('/src/loop.ts') && mocks[id]) return '\0loop-test:' + id;
    },
    load(id) { if (id.startsWith('\0loop-test:')) return mocks[id.slice(11)]; },
  }],
});
const originalPerformance = globalThis.performance;
try {
  const { startGameLoop } = await vite.ssrLoadModule('/src/loop.ts');
  let now = 0, nextFrame;
  globalThis.performance = { now: () => now };
  globalThis.requestAnimationFrame = (callback) => { nextFrame = callback; return 1; };
  let covered = true, renders = 0, steps = 0, peers = 0;
  const callbacks = [];
  const scene = { renderer: { domElement: { width: 1280, height: 720 }, render() { renders++; } },
    controls: { update() {} }, pieceMeshes: new Map(), boardHalfExtent: 4 };
  const physics = { pieces: new Map(), world: { step() { steps++; } } };
  const turn = { feedbackResetSerial: 0, turnResetSerial: 0, turnNumber: 1, currentSide: 'white', phase: 'ready', gameMode: 'classic' };
  const mode = { mode: 'stage', switching: false };
  startGameLoop(scene, physics, { activeAim: null }, {}, turn, {}, mode,
    { settings: { timeScale: 1, maxLaunchSpeed: 10 } },
    (time, delta) => callbacks.push({ time, delta }), () => null, () => true,
    () => { peers++; }, { isActive: () => false, onRingOut() {} }, () => covered);
  const frame = (time) => { now = time; assert.equal(typeof nextFrame, 'function'); const callback = nextFrame; nextFrame = null; callback(time); };
  frame(0);
  for (let i = 1; i <= 120; i++) frame(i * 250);
  assert.equal(steps, 0, 'covered offline menu must not advance physics');
  assert.equal(renders, 1, 'unchanged menu backdrop is rendered once');
  assert.equal(callbacks.length, 1, 'HUD cleanup only on entry');
  scene.renderer.domElement.width = 844;
  frame(30100);
  frame(30200);
  assert.equal(renders, 2, 'resize redraws the covered backdrop once');
  covered = false;
  frame(40000);
  assert.equal(steps, 0, 'returning after a long menu stay has no catch-up steps');
  assert.equal(callbacks.at(-1).delta, 0, 'local timer receives no menu time debt');
  frame(40020);
  assert.ok(steps > 0, 'physics resumes on the next frame');
  assert.equal(callbacks.at(-1).delta, 0.02);
  const resumedSteps = steps;
  covered = true;
  frame(40040);
  frame(50000);
  assert.equal(steps, resumedSteps, 'second menu entry also suspends');
  mode.switching = true;
  frame(50020);
  frame(50040);
  assert.ok(steps > resumedSteps, 'mode transition is never suspended');
  mode.switching = false;
  mode.mode = 'online';
  turn.turnResetSerial++;
  frame(50060);
  const onlineSteps = steps, onlinePeers = peers;
  frame(51060);
  assert.ok(steps > onlineSteps && peers > onlinePeers, 'covered online game still steps both runtimes');
  assert.equal(callbacks.at(-1).delta, 1, 'online timeout uses full wall time, not the physics cap');
  console.log('PASS menu suspend, resize, re-entry, resume, switching, online wall clock and peer steps');
} finally {
  globalThis.performance = originalPerformance;
  await vite.close();
}
