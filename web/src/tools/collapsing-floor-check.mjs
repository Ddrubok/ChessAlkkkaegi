import './headless-browser-env.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Mesh, Scene, Vector3 } from 'three';
import { createServer } from 'vite';

const originalCreateElement = document.createElement;
document.createElement = tag => tag !== 'canvas' ? originalCreateElement(tag) : {
  width: 0, height: 0, getContext: () => new Proxy({}, { get: (_, key) => (...args) => {}, set: () => true }),
};
const vite = await createServer({ root: fileURLToPath(new URL('../..', import.meta.url)), configFile: false,
  logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false } });
const worlds = [];
try {
  const [physics, maps, collapse, definitions, config, tuning, turn, surfaces, legacy] = await Promise.all([
    'physics', 'maps/hotseat-map-runtime', 'maps/collapsing-floor', 'maps/g06', 'config', 'tuning', 'turn', 'maps/surface-materials', 'layout',
  ].map(name => vite.ssrLoadModule(`/src/${name}.ts`)));
  const meta = JSON.parse(await readFile(new URL('../../public/assets/chess-set.meta.json', import.meta.url), 'utf8'));
  const definition = definitions.G06_MAP;
  const halfExtent = config.deriveBoardHalfExtent(meta.cellSize) * definition.boardScale;
  const options = { gameMode: 'hotseat', stageNumber: 1 };
  const instances = definition.spawns.map(spawn => spawn.instance);
  const sceneFor = runtime => {
    const scene = new Scene(), board = new Mesh(); scene.add(board);
    const pieceMeshes = new Map([...runtime.pieces.values()].map(piece => { const mesh = new Mesh(); scene.add(mesh); return [piece.instance.id, mesh]; }));
    return { scene, pieceMeshes, boardMeshes: [board], boardMesh: board, boardHalfExtent: halfExtent, boardTop: runtime.boardTop,
      boardFloorRectangles: runtime.boardFloorRectangles, boardHoleRectangles: runtime.boardHoleRectangles, boardFloorLayoutKey: runtime.boardFloorLayoutKey,
      controls: { enabled: true }, breakableWallMeshes: new Map() };
  };
  async function create() {
    const runtime = await physics.createPhysicsRuntime(meta, instances, halfExtent, options); worlds.push(runtime.world);
    const scene = sceneFor(runtime); maps.installHotseatMap(runtime, scene, definition, meta);
    physics.validateSpawnOverlaps(runtime, meta, false); physics.preSettlePhysics(runtime);
    const t = turn.createTurnRuntime(runtime, scene, tuning.createDefaultRuntimeTuningSettings(), meta.cellSize);
    return { runtime, scene, t };
  }
  const state = fixture => collapse.getCollapsingFloorState(fixture.runtime);
  const step = fixture => { turn.applyPendingLaunchBeforeStep(fixture.t); fixture.runtime.world.step(); turn.updateTurnAfterStep(fixture.t, config.FIXED_STEP); };
  function queue(fixture, id) {
    const p = id ? fixture.runtime.pieces.get(id) : [...fixture.runtime.pieces.values()].find(piece => piece.instance.side === fixture.t.currentSide && piece.instance.type === 'Rook');
    assert.ok(p, 'test needs a real active-side launcher');
    assert.equal(turn.queueTurnLaunch(fixture.t, { pieceId: p.instance.id, normalizedPower: .0001,
      direction: new Vector3(1, 0, 0), applicationPoint: new Vector3().copy(p.body.worldCom()) }).accepted, true);
  }
  function finish(fixture) {
    let steps = 0;
    while (fixture.t.phase === 'settling' && steps++ < 2400) step(fixture);
    assert.ok(steps < 2400, 'actual turn did not finish');
    return steps;
  }
  function shot(fixture, id) { queue(fixture, id); return finish(fixture); }
  const initial = await create();
  assert.equal(initial.runtime.boardColliders.length, 9);
  assert.equal(initial.runtime.boardBody.numColliders(), 9, 'no hidden floor beneath collapse tile');
  assert.equal(initial.scene.boardMeshes.length, 9);
  assert.equal(initial.runtime.pieces.size, 16);
  for (let i = 0; i < 1200; i++) step(initial);
  assert.equal(state(initial).shots, 0, 'idle and initial settling must not count');
  assert.ok([...initial.runtime.pieces.values()].every(piece => piece.body.translation().y > config.FALL_OUT_Y));
  assert.equal(turn.queueTurnLaunch(initial.t, { pieceId: 'missing', normalizedPower: .5, direction: new Vector3(1, 0, 0), applicationPoint: new Vector3() }).accepted, false);
  // An accepted reservation that vanishes before impulse application is not a real shot.
  queue(initial); initial.t.pendingLaunch = null; finish(initial);
  assert.equal(state(initial).shots, 0, 'cancelled queued launch must not count');
  initial.t.phase = 'settling'; initial.t.pendingTurnChange = true; finish(initial);
  assert.equal(state(initial).shots, 0, 'a timeout without launch must not count');
  initial.t.currentSide = 'white';
  assert.equal(turn.executeKingSwap(initial.t, 'white-king', 'white-pawn-center'), true);
  initial.t.phase = 'settling'; initial.t.pendingTurnChange = true; finish(initial);
  assert.equal(state(initial).shots, 0, 'king swap must not count');
  turn.resetTurnRuntime(initial.t);
  assert.equal(turn.executeKingDefense(initial.t, 'white-king'), true);
  initial.t.phase = 'settling'; initial.t.pendingTurnChange = true; finish(initial);
  assert.equal(state(initial).shots, 0, 'king defense must not count');
  console.log('PASS COLLAPSE01: stable 16-piece spawn, idle/initial/cancel/timeout/king actions excluded');

  const threshold = await create();
  let settled = 0, mastery = 0, results = 0;
  threshold.t.onTurnSettled = () => settled++;
  threshold.t.onMasterySettlement = () => mastery++;
  threshold.t.onMatchOver = () => results++;
  for (let n = 1; n <= 5; n++) {
    shot(threshold); assert.equal(state(threshold).shots, n); assert.equal(threshold.runtime.boardColliders.length, 9);
  }
  const sleeping = threshold.runtime.pieces.get('white-pawn-center');
  sleeping.body.setTranslation({ x: 0, y: sleeping.spawnTranslation.y, z: 0 }, true);
  physics.preSettlePhysics(threshold.runtime); sleeping.body.sleep();
  assert.equal(sleeping.body.isSleeping(), true);
  queue(threshold);
  const directRemoval = threshold.runtime.pieces.get('black-pawn-left');
  directRemoval.body.setTranslation({ x: 0, y: config.FALL_OUT_Y - 1, z: 0 }, true);
  while (state(threshold).shots < 6) step(threshold);
  assert.equal(state(threshold).shots, 6);
  assert.equal(collapse.hasAppliedHotseatLaunch(threshold.t), true, 'actual launch remains active through additional falling');
  assert.equal(threshold.t.phase, 'settling');
  assert.equal(settled, 5); assert.equal(mastery, 5); assert.equal(results, 0, 'no early result callbacks');
  assert.equal(threshold.runtime.boardColliders.length, 8);
  assert.equal(threshold.scene.boardMeshes.length, 8);
  assert.equal(threshold.runtime.boardBody.numColliders(), 8);
  assert.equal(sleeping.body.isSleeping(), false, 'removed support wakes a sleeping piece');
  assert.ok(threshold.runtime.boardColliders.every(c => surfaces.getBoardSurfaceId(c) !== 'collapse-center'));
  assert.ok(!threshold.scene.scene.children.some(mesh => mesh.name.startsWith('MapFloor-collapse-center-')));
  const postCollapseSteps = finish(threshold);
  assert.equal(threshold.runtime.pieces.has(sleeping.instance.id), false, 'sleeping piece falls naturally after support removal');
  assert.equal(state(threshold).shots, 6, 'second settling must not recount the same launch');
  assert.equal(settled, 6); assert.equal(mastery, 6);
  assert.equal(threshold.t.settlementRemovedPieces.filter(piece => piece.id === sleeping.instance.id).length, 1);
  assert.equal(threshold.t.settlementRemovedPieces.filter(piece => piece.id === directRemoval.instance.id).length, 1, 'pre-collapse removal evidence survives additional falling');
  assert.equal(collapse.hasAppliedHotseatLaunch(threshold.t), false, 'final settlement clears actual launch status');
  assert.equal(collapse.commitSettledHotseatTerrain(threshold.t), false);
  shot(threshold);
  assert.equal(state(threshold).shots, 7); assert.equal(threshold.runtime.boardHoleRectangles.length, 1);
  threshold.t.phase = 'settling'; threshold.t.pendingTurnChange = true;
  assert.equal(collapse.hasAppliedHotseatLaunch(threshold.t), false, 'timeout after an earlier real launch must not inherit its ID');
  finish(threshold); assert.equal(state(threshold).shots, 7);
  assert.equal(threshold.runtime.boardFloorLayoutKey, threshold.scene.boardFloorLayoutKey);
  console.log(`PASS COLLAPSE01/02: shot 5 retains floor; shot 6 removes collision/render; sleeping pawn falls in ${postCollapseSteps} further steps; final callbacks once; shot 7 stable`);

  for (const partialSupport of [false, true]) {
    const f = await create();
    for (let i = 0; i < 5; i++) shot(f);
    const king = f.runtime.pieces.get('white-king');
    king.body.setTranslation({ x: partialSupport ? .2 * halfExtent : 0, y: king.spawnTranslation.y, z: 0 }, true);
    physics.preSettlePhysics(f.runtime);
    f.t.currentSide = 'white'; assert.equal(turn.executeKingDefense(f.t, king.instance.id), true);
    queue(f);
    while (state(f).shots < 6) step(f);
    assert.equal(king.body.isFixed(), partialSupport, 'Fixed defense must depend on real surviving floor support');
    assert.equal(f.t.kingDefenseActive.white, partialSupport);
    assert.equal(f.t.kingSpecialUsed.white, true, 'support loss never refunds king action');
    finish(f);
    assert.equal(f.runtime.pieces.has(king.instance.id), partialSupport);
  }
  console.log('PASS COLLAPSE03: unsupported defended king becomes Dynamic and falls; king partly supported by surviving floor stays Fixed; no action refund');

  const draw = await create();
  for (let i = 0; i < 5; i++) shot(draw);
  for (const [id, piece] of draw.runtime.pieces) if (!['white-pawn-center', 'black-pawn-center'].includes(id)) {
    draw.runtime.world.removeRigidBody(piece.body); draw.runtime.pieces.delete(id);
    draw.scene.scene.remove(draw.scene.pieceMeshes.get(id)); draw.scene.pieceMeshes.delete(id);
  }
  for (const piece of draw.runtime.pieces.values()) {
    piece.body.setTranslation({ x: 0, y: piece.spawnTranslation.y, z: (piece.instance.side === 'white' ? -1 : 1) * halfExtent * .1 }, true);
  }
  physics.preSettlePhysics(draw.runtime);
  for (const piece of draw.runtime.pieces.values()) piece.body.sleep();
  let drawResults = [], drawSettled = 0, evidence = [];
  draw.t.onMatchOver = winner => drawResults.push(winner);
  draw.t.onTurnSettled = () => drawSettled++;
  draw.t.onMasterySettlement = event => evidence.push(event);
  shot(draw, `${draw.t.currentSide}-pawn-center`);
  assert.equal(draw.t.phase, 'match-over'); assert.deepEqual(drawResults, ['draw']); assert.equal(drawSettled, 1);
  assert.equal(evidence.length, 1); assert.equal(evidence[0].removedPieces.length, 2);
  for (let i = 0; i < 100; i++) step(draw);
  assert.deepEqual(drawResults, ['draw']); assert.equal(state(draw).shots, 6);
  console.log('PASS SETTLE02: both last sleeping pieces fall together; draw/result/evidence callbacks exactly once after extra falling');

  const reset = await create();
  const counts = { bodies: reset.runtime.world.bodies.len(), colliders: reset.runtime.world.colliders.len(), meshes: reset.scene.scene.children.length };
  for (let restart = 0; restart < 20; restart++) {
    for (let i = 0; i < 6; i++) shot(reset);
    maps.disposeHotseatMap(reset.runtime, reset.scene);
    physics.rebuildPhysicsBoard(reset.runtime, meta, halfExtent, options);
    physics.resetPhysicsPieces(reset.runtime, meta, instances, options);
    maps.installHotseatMap(reset.runtime, reset.scene, definition, meta);
    physics.preSettlePhysics(reset.runtime); turn.resetTurnRuntime(reset.t);
    assert.equal(state(reset).shots, 0); assert.equal(state(reset).lastCommittedLaunchId, 0);
    assert.equal(reset.runtime.boardColliders.length, 9); assert.equal(reset.scene.boardMeshes.length, 9);
    assert.equal(reset.runtime.world.bodies.len(), counts.bodies); assert.equal(reset.runtime.world.colliders.len(), counts.colliders);
    assert.equal(reset.scene.scene.children.length, counts.meshes);
    assert.equal(reset.scene.scene.children.filter(mesh => mesh.name === 'CollapseLabel-collapse-center').length, 1);
  }
  maps.disposeHotseatMap(reset.runtime, reset.scene);
  physics.rebuildPhysicsBoard(reset.runtime, meta, config.deriveBoardHalfExtent(meta.cellSize), options);
  physics.resetPhysicsPieces(reset.runtime, meta, legacy.PIECE_INSTANCES, options);
  assert.equal(reset.runtime.pieces.size, 32); assert.equal(reset.runtime.boardColliders.length, 1);
  assert.equal(reset.runtime.hotseatMap, undefined);
  assert.ok(!reset.scene.scene.children.some(mesh => mesh.name.startsWith('CollapseLabel-')));
  console.log('PASS MAP04/05: 20 actual collapse/restart cycles restore collision/render/state counts; classic hotseat restores 32 pieces and one floor');
} finally {
  for (const world of worlds) world.free();
  await vite.close();
}
