import './headless-browser-env.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { Mesh, Scene } from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

// Canvas commands are inspected here; pixel appearance needs the real browser.
const drawing = [];
const originalCreateElement = document.createElement;
document.createElement = tag => tag !== 'canvas' ? originalCreateElement(tag) : {
  width: 0, height: 0, getContext: () => new Proxy({}, { get: (_, key) => (...args) => drawing.push([key, ...args]), set: () => true }),
};
const root = fileURLToPath(new URL('../..', import.meta.url));
const meta = JSON.parse(await readFile(new URL('../../public/assets/chess-set.meta.json', import.meta.url), 'utf8'));
const vite = await createServer({ root, configFile: false, logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false } });
const worlds = [];
try {
  const physics = await vite.ssrLoadModule('/src/physics.ts');
  const config = await vite.ssrLoadModule('/src/config.ts');
  const material = await vite.ssrLoadModule('/src/maps/surface-materials.ts');
  const maps = await vite.ssrLoadModule('/src/maps/hotseat-map-runtime.ts');
  const tuning = await vite.ssrLoadModule('/src/tuning.ts');
  const turn = await vite.ssrLoadModule('/src/turn.ts');
  const legacy = await vite.ssrLoadModule('/src/layout.ts');
  const { G02_MAP: map } = await vite.ssrLoadModule('/src/maps/g02.ts');
  const halfExtent = config.deriveBoardHalfExtent(meta.cellSize) * map.boardScale;
  const layout = material.computeHotseatMapFloorLayout(map, halfExtent);
  assert.equal(layout.rectangles.length, 3);
  assert.equal(layout.rectangles.filter(rectangle => rectangle.material === 'ice').length, 1);
  const area = layout.rectangles.reduce((sum, r) => sum + (r.maxX - r.minX) * (r.maxZ - r.minZ), 0);
  assert.ok(Math.abs(area - 4 * halfExtent ** 2) < 1e-8);
  for (let a = 0; a < layout.rectangles.length; a++) for (let b = a + 1; b < layout.rectangles.length; b++) {
    const left = layout.rectangles[a], right = layout.rectangles[b];
    assert.ok(Math.min(left.maxX, right.maxX) <= Math.max(left.minX, right.minX)
      || Math.min(left.maxZ, right.maxZ) <= Math.max(left.minZ, right.minZ), 'floor rectangles must not overlap');
  }
  assert.notEqual(layout.key, material.computeHotseatMapFloorLayout({ ...map, revision: 2 }, halfExtent).key);
  assert.notEqual(layout.key, material.computeHotseatMapFloorLayout({ ...map, surfaces: [] }, halfExtent).key);
  assert.throws(() => material.computeHotseatMapFloorLayout({ ...map, holes: [{ id: 'overlap', ...map.surfaces[0].rectangle }] }, halfExtent), /overlapping/);
  const holeLayout = material.computeHotseatMapFloorLayout({ ...map, surfaces: [], holes: [{ id: 'hole', minU: -.2, maxU: .2, minV: -.2, maxV: .2 }] }, halfExtent);
  assert.ok(holeLayout.rectangles.every(r => !(r.minX < 0 && r.maxX > 0 && r.minZ < 0 && r.maxZ > 0)));

  async function runtimeFor(type = 'Pawn') {
    const spawn = map.spawns.find(spawn => spawn.instance.type === type && spawn.instance.side === 'white');
    const runtime = await physics.createPhysicsRuntime(meta, [spawn.instance], halfExtent, { gameMode: 'hotseat', stageNumber: 1 });
    worlds.push(runtime.world);
    return runtime;
  }
  const runtime = await runtimeFor();
  const originalKey = runtime.boardFloorLayoutKey;
  const originalMeshes = [new Mesh()];
  const scene = { scene: new Scene(), boardMeshes: originalMeshes, boardMesh: originalMeshes[0], boardTop: 0,
    boardHalfExtent: halfExtent, boardFloorRectangles: runtime.boardFloorRectangles, boardHoleRectangles: [], boardFloorLayoutKey: originalKey };
  scene.scene.add(...originalMeshes);
  const baseline = { bodies: runtime.world.bodies.len(), colliders: runtime.world.colliders.len(), meshes: scene.scene.children.length };
  for (let reset = 0; reset < 20; reset++) {
    const dispose = material.installHotseatMapSurfaces(runtime, scene, meta, map);
    assert.equal(runtime.boardColliders.length, 3);
    assert.equal(runtime.boardBody.numColliders(), 3, 'no hidden base collider');
    assert.equal(runtime.world.colliders.len(), baseline.colliders + 2);
    assert.deepEqual(scene.boardFloorRectangles, runtime.boardFloorRectangles);
    assert.equal(scene.boardFloorLayoutKey, runtime.boardFloorLayoutKey);
    assert.equal(originalMeshes[0].visible, false);
    material.applyBoardSurfaceFriction(runtime.boardColliders, .12);
    for (const [index, collider] of runtime.boardColliders.entries()) {
      const rectangle = layout.rectangles[index];
      assert.ok(Math.abs(collider.friction() - (rectangle.material === 'ice' ? .005 : .12)) < 1e-6);
      assert.ok(Math.abs(collider.translation().y + collider.halfExtents().y) < 1e-7, 'same floor top');
    }
    dispose();
    assert.equal(runtime.world.bodies.len(), baseline.bodies);
    assert.equal(runtime.world.colliders.len(), baseline.colliders);
    assert.equal(scene.scene.children.length, baseline.meshes);
    assert.equal(runtime.boardFloorLayoutKey, originalKey);
    assert.equal(scene.boardFloorLayoutKey, originalKey);
    assert.equal(originalMeshes[0].visible, true);
    assert.ok(runtime.boardColliders.every(collider => collider.isValid()));
  }
  assert.ok(drawing.some(([command]) => command === 'strokeRect'), 'ice boundary drawn');

  const spawned = await physics.createPhysicsRuntime(meta, map.spawns.map(spawn => spawn.instance), halfExtent, { gameMode: 'hotseat', stageNumber: 1 });
  worlds.push(spawned.world);
  material.installHotseatMapPhysicsFloor(spawned, meta, layout);
  for (const spawn of map.spawns) {
    const piece = spawned.pieces.get(spawn.instance.id);
    piece.body.setTranslation({ x: -spawn.u * halfExtent, y: piece.spawnTranslation.y, z: spawn.v * halfExtent }, true);
    piece.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  }
  const extents = [...spawned.pieces.values()].map(piece => {
    const p = piece.body.translation(), points = meta.pieces[piece.instance.type].colliderPoints;
    return { id: piece.instance.id, minX: p.x + Math.min(...points.map(v => v[0])), maxX: p.x + Math.max(...points.map(v => v[0])),
      minZ: p.z + Math.min(...points.map(v => v[2])), maxZ: p.z + Math.max(...points.map(v => v[2])) };
  });
  for (let a = 0; a < extents.length; a++) for (let b = a + 1; b < extents.length; b++) {
    const l = extents[a], r = extents[b];
    assert.ok(Math.min(l.maxX, r.maxX) <= Math.max(l.minX, r.minX) || Math.min(l.maxZ, r.maxZ) <= Math.max(l.minZ, r.minZ), `spawn overlap: ${l.id}, ${r.id}`);
  }
  physics.preSettlePhysics(spawned);
  for (let step = 0; step < 1200; step++) spawned.world.step();
  assert.equal(spawned.pieces.size, 16);
  for (const piece of spawned.pieces.values()) {
    const position = piece.body.translation();
    assert.ok(position.y > config.FALL_OUT_Y && Math.abs(position.x) < halfExtent && Math.abs(position.z) < halfExtent, 'spawn stays supported after 10 seconds');
  }

  const integrated = await physics.createPhysicsRuntime(meta, map.spawns.map(spawn => spawn.instance), halfExtent, { gameMode: 'hotseat', stageNumber: 1 });
  worlds.push(integrated.world);
  const integratedScene = { scene: new Scene(), boardMeshes: [new Mesh()], boardTop: 0, boardHalfExtent: halfExtent,
    boardFloorRectangles: integrated.boardFloorRectangles, boardHoleRectangles: [], boardFloorLayoutKey: integrated.boardFloorLayoutKey,
    pieceMeshes: new Map(), breakableWallMeshes: new Map(), controls: { enabled: true } };
  integratedScene.boardMesh = integratedScene.boardMeshes[0];
  integratedScene.scene.add(integratedScene.boardMesh);
  const settings = tuning.createDefaultRuntimeTuningSettings();
  const tuningRuntime = { physicsRuntime: integrated, settings, localSettings: { ...settings }, controls: new Map(),
    panel: { querySelector: () => null }, storage: null, storageNotice: {}, onlineNotice: {}, onlineDefaultsActive: false };
  assert.equal(maps.getHotseatMapDefinition(map.id), map);
  for (let restart = 0; restart < 20; restart++) {
    maps.disposeHotseatMap(integrated, integratedScene);
    physics.rebuildPhysicsBoard(integrated, meta, halfExtent, { gameMode: 'hotseat', stageNumber: 1 });
    physics.resetPhysicsPieces(integrated, meta, map.spawns.map(spawn => spawn.instance), { gameMode: 'hotseat', stageNumber: 1 });
    tuning.reapplyTuningPhysicsSettings(tuningRuntime);
    maps.installHotseatMap(integrated, integratedScene, map, meta);
    physics.validateSpawnOverlaps(integrated, meta, false);
    physics.preSettlePhysics(integrated);
    tuning.verifyTuningAfterStep(tuningRuntime);
    assert.equal(integrated.world.bodies.len(), 17);
    assert.equal(integrated.world.colliders.len(), 19);
    assert.equal(integratedScene.scene.children.filter(mesh => mesh.name.startsWith('MapFloor-')).length, 3);
    const ice = integrated.boardColliders.find(collider => material.getBoardSurfaceId(collider) === 'ice-center');
    assert.ok(ice && Math.abs(ice.friction() - .005) < 1e-7);
    tuning.setTuningValue(tuningRuntime, 'friction', restart % 2 ? .12 : .08, false);
    tuning.reapplyTuningPhysicsSettings(tuningRuntime);
    integrated.world.step();
    tuning.verifyTuningAfterStep(tuningRuntime);
    assert.ok(Math.abs(ice.friction() - .005) < 1e-7, 'real set/reapply preserves ice');
  }
  maps.disposeHotseatMap(integrated, integratedScene);
  const normalExtent = config.deriveBoardHalfExtent(meta.cellSize);
  physics.rebuildPhysicsBoard(integrated, meta, normalExtent, { gameMode: 'hotseat', stageNumber: 1 });
  physics.resetPhysicsPieces(integrated, meta, legacy.PIECE_INSTANCES, { gameMode: 'hotseat', stageNumber: 1 });
  tuning.reapplyTuningPhysicsSettings(tuningRuntime);
  integrated.world.step(); tuning.verifyTuningAfterStep(tuningRuntime);
  assert.equal(integrated.pieces.size, 32);
  assert.equal(integrated.hotseatMap, undefined);
  assert.equal(integrated.boardColliders.length, 1);
  assert.equal(material.getBoardSurfaceId(integrated.boardCollider), undefined);
  for (const mode of ['online', 'stage', 'weekly']) {
    tuning.setTuningGameMode(tuningRuntime, mode);
    physics.rebuildPhysicsBoard(integrated, meta, normalExtent, { gameMode: mode, stageNumber: 1 });
    physics.resetPhysicsPieces(integrated, meta, legacy.PIECE_INSTANCES, { gameMode: mode, stageNumber: 1 });
    tuning.reapplyTuningPhysicsSettings(tuningRuntime);
    integrated.world.step(); tuning.verifyTuningAfterStep(tuningRuntime);
    assert.ok(integrated.boardColliders.every(collider => material.getBoardSurfaceId(collider) === undefined
      && Math.abs(collider.friction() - settings.friction) < 1e-6), `${mode} keeps legacy friction`);
    assert.equal(integrated.hotseatMap, undefined);
  }

  const live = await runtimeFor();
  material.installHotseatMapPhysicsFloor(live, meta, layout);
  const livePiece = [...live.pieces.values()][0];
  const pieceMesh = new Mesh();
  const liveScene = { scene: new Scene(), controls: { enabled: true }, pieceMeshes: new Map([[livePiece.instance.id, pieceMesh]]), breakableWallMeshes: new Map() };
  liveScene.scene.add(pieceMesh);
  livePiece.body.setTranslation({ x: -halfExtent * .4, y: livePiece.spawnTranslation.y, z: 0 }, true);
  physics.preSettlePhysics(live);
  const liveTurn = turn.createTurnRuntime(live, liveScene, tuning.createDefaultRuntimeTuningSettings());
  liveTurn.phase = 'settling';
  liveTurn.pendingTurnChange = true;
  livePiece.body.setLinvel({ x: .65, y: 0, z: 0 }, true);
  let forced = 0, callbacks = 0;
  liveTurn.onTurnSettled = settlement => { callbacks++; if (settlement.forced) forced++; };
  for (let step = 0; step < 960 && liveTurn.phase === 'settling'; step++) {
    live.world.step(); turn.updateTurnAfterStep(liveTurn, config.FIXED_STEP);
  }
  assert.equal(callbacks, 1, 'live ice shot settles once');
  assert.equal(forced, 0, 'representative ice shot settles naturally');
  assert.ok(livePiece.body.translation().x + halfExtent * .4 > 3, 'turn rest threshold preserves long ice slide');

  for (const prone of [false, true]) {
    const rt = await runtimeFor('Pawn');
    material.installHotseatMapPhysicsFloor(rt, meta, layout);
    const piece = [...rt.pieces.values()][0];
    piece.body.setTranslation({ x: 0, y: prone ? .2 : piece.spawnTranslation.y, z: -halfExtent * .4 }, true);
    piece.body.setRotation(prone ? { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 } : { x: 0, y: 0, z: 0, w: 1 }, true);
    for (let step = 0; step < 600; step++) rt.world.step();
    const start = { ...piece.body.translation() };
    piece.body.setLinvel({ x: 0, y: 0, z: 1.25 }, true);
    let maxY = start.y, maxSpeed = 1.25;
    for (let step = 0; step < 960; step++) {
      rt.world.step();
      maxY = Math.max(maxY, piece.body.translation().y);
      maxSpeed = Math.max(maxSpeed, Math.hypot(...Object.values(piece.body.linvel())));
    }
    assert.ok(piece.body.translation().z > .20 * halfExtent, 'piece crosses both ice boundaries');
    assert.ok(maxY - start.y < .08, 'boundary must not create a step or launch');
    assert.ok(maxSpeed < 1.3, 'ice never supplies propulsion');
  }

  async function blockDistance(ice) {
    const rt = await runtimeFor();
    for (const piece of rt.pieces.values()) rt.world.removeRigidBody(piece.body);
    rt.pieces.clear();
    if (ice) material.installHotseatMapPhysicsFloor(rt, meta, layout);
    const body = rt.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(-halfExtent * .4, .12, 0)
      .enabledRotations(false, true, false));
    const collider = rt.world.createCollider(RAPIER.ColliderDesc.cuboid(.15, .12, .15).setMass(.055).setFriction(config.PIECE_FRICTION), body);
    for (let step = 0; step < 600; step++) rt.world.step();
    const x = body.translation().x;
    body.setLinvel({ x: .65, y: 0, z: 0 }, true);
    for (let step = 0; step < 960; step++) rt.world.step();
    assert.ok(collider.isValid() && body.translation().y > config.FALL_OUT_Y);
    return body.translation().x - x;
  }
  const normalBlock = await blockDistance(false), iceBlock = await blockDistance(true);
  assert.ok(iceBlock > normalBlock * 1.5, 'block uses actual surface contact friction');

  async function distance(type, ice, prone = false) {
    const rt = await runtimeFor(type);
    if (ice) material.installHotseatMapPhysicsFloor(rt, meta, layout);
    const piece = [...rt.pieces.values()][0];
    const y = Math.max(...meta.pieces[type].colliderPoints.map(point => Math.abs(point[2]))) + .02;
    piece.body.setTranslation({ x: -halfExtent * .4, y: prone ? y : piece.spawnTranslation.y, z: 0 }, true);
    piece.body.setRotation(prone ? { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 } : { x: 0, y: 0, z: 0, w: 1 }, true);
    piece.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    for (let step = 0; step < 600; step++) rt.world.step();
    const start = { ...piece.body.translation() };
    piece.body.setLinvel({ x: .65, y: 0, z: 0 }, true);
    let seconds = 0;
    for (let step = 0; step < 960; step++) {
      rt.world.step(); seconds = (step + 1) * config.FIXED_STEP;
      const position = piece.body.translation();
      assert.ok(position.y > config.FALL_OUT_Y, `${type} must remain supported in measurement`);
      if (piece.body.isSleeping()) break;
    }
    return { type, prone, ice, distance: piece.body.translation().x - start.x, seconds,
      sleeping: piece.body.isSleeping(), speed: Math.hypot(...Object.values(piece.body.linvel())) };
  }
  const measurements = [];
  for (const type of ['Pawn', 'King', 'Rook', 'Queen', 'Bishop', 'Knight']) {
    for (const prone of [false, true]) {
      const normal = await distance(type, false, prone), ice = await distance(type, true, prone);
      measurements.push({ type, prone, normal: normal.distance, ice: ice.distance, ratio: ice.distance / normal.distance,
        normalSeconds: normal.seconds, iceSeconds: ice.seconds, normalSleeping: normal.sleeping, iceSleeping: ice.sleeping });
      assert.ok(ice.distance > normal.distance * 1.5, `${type} ${prone ? 'prone' : 'upright'} ice must slide farther`);
    }
  }
  console.table(measurements);
  console.log(`Block distance: normal=${normalBlock.toFixed(4)}, ice=${iceBlock.toFixed(4)}`);
  console.log('PASS: partition/overlap/hidden floor checks, 20 standalone installs plus 20 app-order restarts, actual tuning set/reapply, classic/online/stage/weekly cleanup, live ice turn settlement, 16 stable spawns, boundaries, 6 real hulls and block sliding. Browser pixels are a separate check.');
} finally {
  for (const world of worlds) world.free();
  await vite.close();
}
