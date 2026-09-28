import './headless-browser-env.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Mesh, Scene, Vector3 } from 'three';
import { createServer } from 'vite';

const vite = await createServer({ root: fileURLToPath(new URL('../..', import.meta.url)),
  configFile: false, logLevel: 'error', server: { middlewareMode: true, hmr: false } });
let physics;
try {
  const aim = await vite.ssrLoadModule('/src/aim.ts');
  const params = await vite.ssrLoadModule('/src/aimparams.ts');
  const config = await vite.ssrLoadModule('/src/config.ts');
  const turn = await vite.ssrLoadModule('/src/turn.ts');
  const world = await vite.ssrLoadModule('/src/physics.ts');
  const layout = await vite.ssrLoadModule('/src/layout.ts');
  for (const [type, rook, bishop] of [['Queen', true, true], ['Rook', true, false], ['Bishop', false, true], ['Pawn', false, false]]) {
    for (const spin of [false, true]) {
      const max = aim.getAimMaxPower({ isRook: rook, isBishop: bishop, hasCustomSpin: spin });
      assert.equal(max, type === 'Queen' || (type === 'Rook' && !spin) ? 1.5 : 1, `${type}/${spin}`);
    }
    const runtime = { normalizedPower: 1.5, strikePointOverride: null };
    params.setStrikePointOverride(runtime, new Vector3(0.1, 0, 0),
      aim.getAimMaxPower({ isRook: rook, isBishop: bishop, hasCustomSpin: true }));
    assert.equal(runtime.normalizedPower, type === 'Queen' ? 1.5 : 1, `${type}: changing strike point`);
  }
  const meta = JSON.parse(await readFile(new URL('../../public/assets/chess-set.meta.json', import.meta.url), 'utf8'));
  physics = await world.createPhysicsRuntime(meta, layout.PIECE_INSTANCES,
    config.deriveBoardHalfExtent(meta.cellSize), { gameMode: 'online', stageNumber: 1 });
  const scene = { scene: new Scene(), controls: { enabled: true },
    pieceMeshes: new Map([...physics.pieces.keys()].map(id => [id, new Mesh()])) };
  for (const mode of ['online', 'hotseat', 'puzzle']) {
    const queen = [...physics.pieces.values()].find(b => b.instance.type === 'Queen' && b.instance.side === 'white');
    queen.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    queen.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    const runtime = turn.createTurnRuntime(physics, scene, { maxLaunchSpeed: 11, strikeHeightRatio: 0 });
    turn.setTurnGameMode(runtime, mode);
    const point = new Vector3().copy(queen.body.worldCom()).add(new Vector3(0.1, 0, 0));
    const request = { pieceId: queen.instance.id, normalizedPower: 1.5,
      direction: new Vector3(0, 0, 1), applicationPoint: point, speedMultiplier: 1 };
    assert.equal(turn.queueTurnLaunch(runtime, request).accepted, true, `${mode}: queen spin accepted`);
    assert.equal(turn.applyPendingLaunchBeforeStep(runtime), true);
    assert.ok(Math.abs(new Vector3().copy(queen.body.linvel()).length() - 1.5 * (mode === 'online' ? 7 : 11)) < 1e-5);
    assert.ok(Math.abs(queen.body.angvel().y) > 0.01, `${mode}: spin preserved with overdrive`);
    const overflow = turn.createTurnRuntime(physics, scene, { maxLaunchSpeed: 11, strikeHeightRatio: 0 });
    turn.setTurnGameMode(overflow, 'puzzle');
    assert.equal(turn.queueTurnLaunch(overflow, { ...request, normalizedPower: 1.50001 }).accepted, false);
  }
  console.log('PASS: Queen spin + 150% launch, strike-point changes, real Rapier velocity/spin, puzzle cap; Rook/Bishop limits unchanged');
} finally {
  physics?.world.free();
  await vite.close();
}
