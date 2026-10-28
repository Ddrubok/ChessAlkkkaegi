// Run from the repository root: node qa/polyhaven-model-2026-10-28/mass-compatibility-check.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../web/node_modules/vite/dist/node/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const web = path.join(root, 'web');
const oldMeta = JSON.parse(execFileSync('git', ['show', 'df00d80946c671f93f7dde485f7bfa8679af895f:web/public/assets/chess-set.meta.json'], { cwd: root, encoding: 'utf8' }));
const newMeta = JSON.parse(await readFile(path.join(web, 'public/assets/chess-set.meta.json'), 'utf8'));
const types = ['Pawn', 'Rook', 'Knight', 'Bishop', 'Queen', 'King'];
for (const type of types) {
  assert.ok(Number.isFinite(newMeta.pieces[type].densityScale) && newMeta.pieces[type].densityScale > 0,
    `${type}: converter must emit a finite positive densityScale`);
}

const vite = await createServer({ root: web, configFile: false, logLevel: 'error',
  server: { middlewareMode: true, hmr: false, ws: false } });
let oldRuntime, newRuntime;
try {
  const physics = await vite.ssrLoadModule('/src/physics.ts');
  const config = await vite.ssrLoadModule('/src/config.ts');
  const layout = await vite.ssrLoadModule('/src/layout.ts');
  const boardHalfExtent = config.deriveBoardHalfExtent(newMeta.cellSize);
  const stage = { gameMode: 'online', stageNumber: 1 };
  oldRuntime = await physics.createPhysicsRuntime(oldMeta, layout.PIECE_INSTANCES, boardHalfExtent, stage);
  newRuntime = await physics.createPhysicsRuntime(newMeta, layout.PIECE_INSTANCES, boardHalfExtent, stage);
  const { capturePhysicsStateHash } = await vite.ssrLoadModule('/src/state-hash.ts');
  const initialHashesMatch = (await capturePhysicsStateHash(oldRuntime)).sha256 ===
    (await capturePhysicsStateHash(newRuntime)).sha256;
  console.log(`Old/new initial online pose hashes match: ${initialHashesMatch}`);
  const one = (runtime, type) => [...runtime.pieces.values()].find(binding => binding.instance.type === type && binding.instance.side === 'white');
  const close = (actual, expected, label) => assert.ok(Math.abs(actual / expected - 1) < 1e-5,
    `${label}: actual=${actual}, expected=${expected}`);

  for (const type of types) {
    const oldPiece = one(oldRuntime, type);
    const newPiece = one(newRuntime, type);
    close(newPiece.originalHullMass, oldPiece.originalHullMass, `${type} old/new mass`);
    close(newPiece.collider.density(), config.PIECE_DENSITY * config.getPieceWeightMultiplier(type) * newMeta.pieces[type].densityScale,
      `${type} collider density`);
    assert.equal(oldPiece.densityScale, 1, `${type}: old metadata defaults to one`);
  }

  const pawn = one(newRuntime, 'Pawn');
  const pawnMass = pawn.originalHullMass;
  const replacement = physics.replacePieceBody(newRuntime, pawn.instance.id, newMeta.pieces.Pawn.colliderPoints, config.PIECE_DENSITY * 1.37);
  close(replacement.originalHullMass, pawnMass * 1.37, 'replacement custom density');
  close(replacement.densityScale, newMeta.pieces.Pawn.densityScale, 'replacement retained scale');
  const promoted = physics.promotePieceBody(newRuntime, pawn.instance.id, 'Queen', newMeta);
  close(promoted.originalHullMass, one(newRuntime, 'Queen').originalHullMass, 'promotion new type scale');
  close(promoted.densityScale, newMeta.pieces.Queen.densityScale, 'promotion switched scale');
  const stageOptions = { gameMode: 'stage', stageNumber: 8 };
  const stagePawn = physics.createPieceBody(newRuntime,
    { ...one(newRuntime, 'Pawn').instance, id: 'mass-check-stage-pawn', side: 'black' }, newMeta, stageOptions);
  const stageScale = (await vite.ssrLoadModule('/src/stage.ts')).computeStagePieceScale(stagePawn.instance, newMeta, stageOptions);
  const weightFraction = (await vite.ssrLoadModule('/src/stage.ts')).computeUpgradeWeightFraction(stagePawn.instance, stageOptions);
  close(stagePawn.originalHullMass, pawnMass * stageScale ** 3, 'stage size scales hull volume');
  close(stagePawn.upgradeAdditionalMass, stagePawn.originalHullMass * weightFraction, 'stage weight adds once');
  const stageReplacement = physics.replacePieceBody(newRuntime, stagePawn.instance.id,
    newMeta.pieces.Pawn.colliderPoints, config.PIECE_DENSITY);
  close(stageReplacement.originalHullMass, stagePawn.originalHullMass, 'stage replacement retains hull scale');
  close(stageReplacement.upgradeAdditionalMass, stagePawn.upgradeAdditionalMass, 'stage replacement retains upgrade mass');
  physics.resetPhysicsPieces(newRuntime, newMeta, layout.PIECE_INSTANCES, stage);
  close(one(newRuntime, 'Pawn').originalHullMass, pawnMass, 'reset rebuilds scaled hull');
  assert.ok(Math.abs(one(oldRuntime, 'King').originalLocalCom.y - one(newRuntime, 'King').originalLocalCom.y) > 1e-3,
    'new hull must supply its own center of mass');
  console.log('PASS: six real Rapier masses match pre-migration df00d809 original; replacement, promotion, stage size/weight, reset and fresh COM checked.');
} finally {
  oldRuntime?.world.free();
  newRuntime?.world.free();
  await vite.close();
}
