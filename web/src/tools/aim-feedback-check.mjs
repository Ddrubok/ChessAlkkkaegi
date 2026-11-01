import './headless-browser-env.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { Mesh, SphereGeometry, MeshBasicMaterial, Vector3 } from 'three';

const vite = await createServer({ configFile: false, logLevel: 'error', server: { middlewareMode: true, hmr: false } });
try {
  const aim = await vite.ssrLoadModule('/src/aim.ts');
  const motion = await vite.ssrLoadModule('/src/ui-motion.ts');
  const powerReadout = { style: {}, dataset: {}, textContent: '' };
  const rookCenterMax = aim.getAimMaxPower({ isRook: true, isBishop: false, hasCustomSpin: false });
  const rookSpinMax = aim.getAimMaxPower({ isRook: true, isBishop: false, hasCustomSpin: true });
  const queenSpinMax = aim.getAimMaxPower({ isRook: true, isBishop: true, hasCustomSpin: true });
  assert.equal(rookCenterMax, 1.5);
  assert.equal(rookSpinMax, 1);
  assert.equal(queenSpinMax, 1.5);
  for (const [power, limit, expected] of [[.99, 1.5, '99%'], [1.01, 1.5, '101%'], [1.49, 1.5, '149%'], [1.5, 1.5, '150%'], [1, 1, '100%']]) {
    aim.applyPowerReadoutVisuals(powerReadout, power, aim.computeAimColor(power), false, limit);
    assert.ok(powerReadout.textContent.startsWith(expected), 'current numeric power remains visible');
    assert.equal(powerReadout.dataset.maxPower, `${Math.round(limit * 100)}%`);
    assert.equal(powerReadout.dataset.baseReached, String(power >= 1));
  }
  const line = () => ({ visible: false, geometry: { setPositions(points) { this.points = points; } } });
  const decoration = () => ({ visible: false, position: new Vector3() });
  const mesh = new Mesh(new SphereGeometry(0.5), new MeshBasicMaterial());
  const runtime = {
    sceneRuntime: { pieceMeshes: new Map([['rook', mesh]]) },
    activeAim: { pieceId: 'rook', direction: new Vector3(1, 0, 0), normalizedPower: 1.5, tracksPowerSounds: false },
    applicationPoint: new Vector3(), selectedPieceId: 'rook', marker: decoration(),
    bowstring: line(), faintBowstring: line(), bowPullMarker: decoration(), faintBowPullMarker: decoration(),
    groundRibbon: decoration(), faintGroundRibbon: decoration(), elevationRibbon: decoration(), faintElevationRibbon: decoration(),
    groundChevrons: [], faintGroundChevrons: [], groundChevronOutlines: [], faintGroundChevronOutlines: [],
    powerReadout: { style: {}, hidden: false }, elevationGauge: { hidden: false },
    pendingLaunchFeedback: null, launchRestore: null, pulses: new Map(),
  };
  aim.prepareLaunchFeedback(runtime, 'rook');
  assert.ok(runtime.pendingLaunchFeedback);
  aim.cancelAim(runtime, true, true);
  assert.ok(runtime.pendingLaunchFeedback, 'accepted request survives release cleanup');
  assert.equal(runtime.bowstring.visible, false, 'request acceptance has no launch animation');
  aim.confirmLaunchFeedback(runtime, 'rook', 1000);
  assert.equal(runtime.bowstring.visible, true);
  const startX = runtime.bowstring.geometry.points[3];
  aim.updateLaunchPulses(runtime, 1040);
  assert.ok(runtime.bowstring.geometry.points[3] > startX, 'pull point restores toward piece');
  aim.updateLaunchPulses(runtime, 1080);
  assert.equal(runtime.bowstring.visible, false);
  assert.equal(runtime.launchRestore, null);
  assert.deepEqual(mesh.scale.toArray(), [1, 1, 1], 'renderer mesh silhouette stays unchanged');

  runtime.activeAim = { pieceId: 'rook', direction: new Vector3(1, 0, 0), normalizedPower: 1, tracksPowerSounds: false };
  runtime.applicationPoint = new Vector3();
  aim.prepareLaunchFeedback(runtime, 'rook');
  aim.cancelAim(runtime, true);
  aim.confirmLaunchFeedback(runtime, 'rook', 2000);
  assert.equal(runtime.bowstring.visible, false, 'denied or cancelled request stays silent');

  runtime.activeAim = { pieceId: 'rook', direction: new Vector3(1, 0, 0), normalizedPower: 1, tracksPowerSounds: false };
  runtime.applicationPoint = new Vector3();
  aim.prepareLaunchFeedback(runtime, 'rook');
  aim.cancelAim(runtime, true, true);
  aim.confirmLaunchFeedback(runtime, 'other', 3000);
  assert.equal(runtime.bowstring.visible, false, 'wrong piece cannot consume snapshot');

  runtime.activeAim = { pieceId: 'rook', direction: new Vector3(1, 0, 0), normalizedPower: 1, tracksPowerSounds: false };
  runtime.applicationPoint = new Vector3();
  aim.prepareLaunchFeedback(runtime, 'rook');
  aim.cancelAim(runtime, true, true);
  motion.setMotionReduced(true);
  assert.equal(runtime.pendingLaunchFeedback, null, 'motion preference clears pending snapshot');
  aim.confirmLaunchFeedback(runtime, 'rook', 4000);
  assert.equal(runtime.bowstring.visible, false);
  motion.setMotionReduced(false);
  console.log('PASS power limits/boundaries; accepted/actual launch boundary, 80ms restore, cancellation, mismatch, reduced motion, unchanged mesh');
} finally {
  await vite.close();
}
