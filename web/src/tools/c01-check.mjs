import "./headless-browser-env.mjs";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Mesh, Quaternion, Scene, Vector3 } from "three";
import { createServer } from "vite";

const vite = await createServer({ root: fileURLToPath(new URL("../..", import.meta.url)), configFile: false,
  logLevel: "error", appType: "custom", server: { middlewareMode: true, hmr: false } });
const fixtures = [];
const originalInfo = console.info;
console.info = () => {};
const originalCreateElement = document.createElement;
document.createElement = tag => tag !== "canvas" ? originalCreateElement(tag) : {
  width: 0, height: 0, getContext: () => new Proxy({}, { get: () => () => {}, set: () => true }),
};
try {
  const [physics, maps, definitions, stage, turn, tuning, config, layout, surfaces] = await Promise.all([
    "physics", "maps/hotseat-map-runtime", "maps/c01", "stage", "turn", "tuning", "config", "layout", "maps/surface-materials",
  ].map(name => vite.ssrLoadModule(`/src/${name}.ts`)));
  const meta = JSON.parse(await readFile(new URL("../../public/assets/chess-set.meta.json", import.meta.url), "utf8"));
  const definition = definitions.C01_MAP;
  const H = stage.computeStageBoardHalfExtent(meta.cellSize, "stage", 2);
  const options = { gameMode: "hotseat", stageNumber: 1 };
  const instances = definition.spawns.map(spawn => spawn.instance);
  const report = { mapId: definition.id, revision: definition.revision, cellSize: meta.cellSize, halfExtent: H,
    rapier: "0.19.3", shots: [], manualUI: "not run", android: "not run" };

  async function create() {
    const runtime = await physics.createPhysicsRuntime(meta, instances, H, options);
    const board = new Mesh();
    const scene = { scene: new Scene(), pieceMeshes: new Map(), breakableWallMeshes: new Map(), controls: { enabled: true },
      boardMeshes: [board], boardMesh: board, boardHalfExtent: H, boardTop: runtime.boardTop,
      boardFloorRectangles: runtime.boardFloorRectangles, boardHoleRectangles: runtime.boardHoleRectangles,
      boardFloorLayoutKey: runtime.boardFloorLayoutKey };
    scene.scene.add(board);
    for (const piece of runtime.pieces.values()) {
      const mesh = new Mesh(); scene.scene.add(mesh); scene.pieceMeshes.set(piece.instance.id, mesh);
    }
    maps.installHotseatMap(runtime, scene, definition, meta);
    const turnRuntime = turn.createTurnRuntime(runtime, scene, tuning.createDefaultRuntimeTuningSettings(), meta.cellSize);
    const fixture = { runtime, scene, turn: turnRuntime, settlements: 0, mastery: 0, results: 0 };
    turnRuntime.onTurnSettled = () => fixture.settlements++;
    turnRuntime.onMasterySettlement = () => fixture.mastery++;
    turnRuntime.onMatchOver = () => fixture.results++;
    fixtures.push(fixture);
    return fixture;
  }
  function coreStep(fixture) {
    turn.applyPendingLaunchBeforeStep(fixture.turn);
    fixture.runtime.world.step();
    turn.updateTurnAfterStep(fixture.turn, config.FIXED_STEP);
    maps.synchronizeHotseatMapMeshes(fixture.runtime);
  }
  function finish(fixture, observe = () => {}) {
    let steps = 0;
    while (fixture.turn.phase === "settling" && steps < 2400) { coreStep(fixture); observe(steps++); }
    assert(steps < 2400, "C01 settlement exceeded 20 seconds");
    assert.equal(fixture.settlements, 1, "Launch finalized more or less than once");
    assert.equal(fixture.mastery, 1);
    for (let i = 0; i < 60; i++) coreStep(fixture);
    assert.equal(fixture.settlements, 1, "Idle step repeated final settlement");
    assert.equal(fixture.mastery, 1);
    return steps * config.FIXED_STEP;
  }
  function queue(fixture, piece, direction, normalizedPower) {
    fixture.turn.phase = "ready"; fixture.turn.currentSide = piece.instance.side;
    const applicationPoint = new Vector3().copy(piece.body.worldCom());
    const start = { ...piece.body.translation() };
    assert(turn.queueTurnLaunch(fixture.turn, { pieceId: piece.instance.id, direction: new Vector3(...direction),
      normalizedPower, applicationPoint }).accepted, "Actual Pawn shot rejected");
    return { pieceId: piece.instance.id, type: piece.instance.type, start, direction, normalizedPower,
      applicationPoint: applicationPoint.toArray() };
  }
  function place(piece, x, z, y = piece.spawnTranslation.y) {
    piece.body.setTranslation({ x, y, z }, true);
    piece.body.setRotation(piece.spawnRotation, true);
    piece.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    piece.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
  function hasContact(runtime, first, second) {
    if (!first.collider.isValid() || !second.collider.isValid()) return false;
    let contact = false;
    runtime.world.contactPair(first.collider, second.collider, manifold => { contact ||= manifold.numSolverContacts() > 0; });
    return contact;
  }
  function hullBounds(piece) {
    const q = new Quaternion().copy(piece.body.rotation());
    const p = piece.body.translation();
    const points = meta.pieces[piece.instance.type].colliderPoints.map(point => new Vector3(...point)
      .multiplyScalar(piece.uniformScale).applyQuaternion(q).add(new Vector3(p.x, p.y, p.z)));
    return Object.fromEntries(["x", "y", "z"].flatMap(axis => [[`min${axis}`, Math.min(...points.map(p => p[axis]))],
      [`max${axis}`, Math.max(...points.map(p => p[axis]))]]));
  }

  const initial = await create();
  const r = initial.runtime;
  assert.equal(r.pieces.size, 16); assert.equal(r.hotseatMap.dynamicObjects.size, 2);
  assert.equal(r.breakableWalls.size, 0); assert.equal(r.pinballObstacles.size, 0);
  assert.equal(r.boardHoleRectangles.length, 1); assert.equal(r.boardColliders.length, 8);
  const hole = r.boardHoleRectangles[0];
  assert(Math.abs(hole.minX + .18 * H) < 1e-8 && Math.abs(hole.maxZ - .18 * H) < 1e-8);
  assert.deepEqual(r.boardFloorRectangles, initial.scene.boardFloorRectangles, "Render and physics partitions differ");
  for (const floor of r.boardFloorRectangles) assert(!(floor.minX < hole.maxX && floor.maxX > hole.minX &&
    floor.minZ < hole.maxZ && floor.maxZ > hole.minZ), "Hidden floor remains inside C01 hole");
  r.world.propagateModifiedBodyPositionsToColliders();
  physics.validateSpawnOverlaps(r, meta, false);
  const actors = [...r.pieces.values(), ...r.hotseatMap.dynamicObjects.values()];
  let minHullGap = Infinity;
  for (let i = 0; i < actors.length; i++) for (let j = i + 1; j < actors.length; j++) {
    const gap = actors[i].collider.contactCollider(actors[j].collider, 10)?.distance;
    if (gap !== undefined) { assert(gap >= -.0001, "Actual initial hulls overlap"); minHullGap = Math.min(minHullGap, gap); }
  }
  const pawn = r.pieces.get("white-pawn-left"), king = r.pieces.get("white-king");
  const pawnBounds = hullBounds(pawn), kingBounds = hullBounds(king);
  const pawnWidth = pawnBounds.maxx - pawnBounds.minx, kingWidth = kingBounds.maxx - kingBounds.minx;
  const narrowGap = (.36 - .10 - .18) * H;
  const outerRouteWidth = (1 - .36 - .10) * H;
  assert(outerRouteWidth > kingWidth, "Outer route cannot fit actual King hull");
  const pawnMass = pawn.body.mass();
  for (const block of r.hotseatMap.dynamicObjects.values()) assert(Math.abs(block.body.mass() / pawnMass - 2) < 1e-5);
  physics.preSettlePhysics(r);
  for (let i = 0; i < 1200; i++) coreStep(initial);
  assert.equal(r.pieces.size, 16); assert.equal(r.hotseatMap.dynamicObjects.size, 2);
  assert(actors.every(binding => binding.body.isSleeping() && binding.body.translation().y > config.FALL_OUT_Y));
  assert.equal(initial.settlements, 0); assert.equal(initial.results, 0);
  report.spawn = { pieces: 16, blocks: 2, floorColliders: 8, idleSeconds: 10, minHullGap, pawnMass,
    pawnHullWidth: pawnWidth, kingHullWidth: kingWidth, gapBetweenBlockAndHole: narrowGap,
    outerRouteWidth, outerKingClearance: outerRouteWidth - kingWidth };
  console.log("PASS C01: 16 collision-free supported spawns, real center hole, 2 blocks, no stage walls, 10 seconds idle");

  // A later-game block position leaves enough room for a fully supported
  // opponent between block and hole. Initial map coordinates stay unchanged.
  const attack = await create();
  const block = attack.runtime.hotseatMap.dynamicObjects.get("block-left");
  const shooter = attack.runtime.pieces.get("white-pawn-left");
  const target = attack.runtime.pieces.get("black-pawn-left");
  const blockX = block.body.translation().x + .12;
  block.body.setTranslation({ x: blockX, y: block.body.translation().y, z: 0 }, true);
  place(shooter, blockX + .10 * H + pawnWidth / 2 + .06, 0);
  place(target, .18 * H + .15, 0);
  physics.preSettlePhysics(attack.runtime);
  assert(target.body.isSleeping() && target.body.translation().y > config.FALL_OUT_Y, "Target is unsupported before attack");
  assert(maps.collectHotseatGroundedIds(attack.runtime).has(target.instance.id));
  const shot = queue(attack, shooter, [-1, 0, 0], .35);
  let blockContact = false, directContact = false, movingDelay = false, fellUngrounded = false;
  const seconds = finish(attack, () => {
    blockContact ||= hasContact(attack.runtime, block, target);
    directContact ||= hasContact(attack.runtime, shooter, target);
    if (block.body.isValid() && !maps.isMapObjectSlow(block)) {
      movingDelay = true; assert.equal(attack.settlements, 0, "Turn ended while a block moved");
    }
    if (target.body.isValid() && target.body.translation().y < attack.runtime.boardTop - .1) {
      fellUngrounded ||= !maps.collectHotseatGroundedIds(attack.runtime).has(target.instance.id);
    }
  });
  assert(blockContact, "Approved Pawn shot did not hit opponent through block");
  assert(!directContact, "Attack fixture was a direct Pawn collision rather than block-mediated");
  assert(!attack.runtime.pieces.has(target.instance.id), "Block-mediated opponent did not fall into hole");
  assert(fellUngrounded && movingDelay);
  assert.equal(attack.results, 0);
  assert.equal(attack.turn.settlementRemovedPieces.filter(piece => piece.id === target.instance.id).length, 1);
  report.shots.push({ ...shot, purpose: "block-mediated opponent hole fall", blockStart: { x: blockX, z: 0 }, targetStart: { x: .18 * H + .15, z: 0 }, seconds, blockContact, directContact,
    fellUngrounded, movingDelay, removedPieces: attack.turn.settlementRemovedPieces, forcedSettles: attack.turn.forcedSettleCount });
  console.log("PASS C01: approved Pawn shot → block → grounded opponent → real hole fall; callbacks once");

  const blockFall = await create();
  const fallingBlock = blockFall.runtime.hotseatMap.dynamicObjects.get("block-left");
  const blockShooter = blockFall.runtime.pieces.get("white-pawn-left");
  place(blockShooter, fallingBlock.body.translation().x + .10 * H + pawnWidth / 2 + .06, 0);
  physics.preSettlePhysics(blockFall.runtime);
  const fallShot = queue(blockFall, blockShooter, [-1, 0, 0], .25);
  let touchedBlock = false, airBlock = false;
  const fallSeconds = finish(blockFall, () => {
    touchedBlock ||= hasContact(blockFall.runtime, blockShooter, fallingBlock);
    if (fallingBlock.body.isValid() && fallingBlock.body.translation().y < blockFall.runtime.boardTop - .1) {
      airBlock ||= !maps.collectHotseatGroundedIds(blockFall.runtime).has("object:block-left");
      assert.equal(blockFall.settlements, 0, "Falling block prematurely ended turn");
    }
  });
  assert(touchedBlock && airBlock && blockFall.runtime.hotseatMap.fallenObjectIds.has("block-left"), "Block did not fall naturally through hole");
  assert.equal(blockFall.runtime.pieces.size, 16, "Block fall affected alive piece count");
  assert.equal(blockFall.turn.settlementRemovedPieces.length, 0, "Block was counted as a piece removal");
  assert.equal(blockFall.results, 0);
  assert(!blockFall.scene.scene.children.some(mesh => mesh.name === "map-block-left"));
  report.shots.push({ ...fallShot, purpose: "block itself falls into hole", seconds: fallSeconds, touchedBlock, airBlock,
    pieces: blockFall.runtime.pieces.size, removedPieces: 0, forcedSettles: blockFall.turn.forcedSettleCount });
  console.log("PASS C01: approved shot drops neutral block naturally, preserves all 16 pieces and removal counts");

  // A straddling block and its passenger remain supported by the hole rim.
  const support = await create();
  const base = support.runtime.hotseatMap.dynamicObjects.get("block-left");
  const passenger = support.runtime.pieces.get("white-pawn-left");
  base.body.setTranslation({ x: .19 * H, y: base.body.translation().y, z: 0 }, true);
  place(passenger, .19 * H, 0, passenger.spawnTranslation.y + .45 * meta.cellSize);
  physics.preSettlePhysics(support.runtime);
  assert(base.body.isSleeping());
  assert(maps.collectHotseatGroundedIds(support.runtime).has(passenger.instance.id), "Block rim support graph lost passenger");
  const quiet = support.runtime.pieces.get("white-pawn-center");
  const supportShot = queue(support, quiet, [1, 0, 0], .01);
  const supportSeconds = finish(support);
  assert(base.body.isValid() && base.body.translation().y > config.FALL_OUT_Y);
  assert(passenger.body.isValid() && support.runtime.pieces.size === 16);
  base.body.setLinvel({ x: 0, y: -1, z: 0 }, true);
  assert(!maps.collectHotseatGroundedIds(support.runtime).has(passenger.instance.id), "Moving block incorrectly grounds passenger");
  report.shots.push({ ...supportShot, purpose: "rim-straddling block settles with supported passenger", seconds: supportSeconds,
    forcedSettles: support.turn.forcedSettleCount });
  console.log("PASS C01: hole-rim straddling block and passenger settle; moving block cannot ground passenger");

  const bypass = await create();
  const bypassPawn = bypass.runtime.pieces.get("white-pawn-left");
  place(bypassPawn, .72 * H, -.35 * H);
  physics.preSettlePhysics(bypass.runtime);
  const bypassShot = queue(bypass, bypassPawn, [0, 0, 1], .20);
  let maxZ = bypassPawn.body.translation().z, crossed = false, touched = false;
  const bypassSeconds = finish(bypass, () => {
    maxZ = Math.max(maxZ, bypassPawn.body.translation().z);
    crossed ||= bypassPawn.body.translation().z > .18 * H;
    for (const object of bypass.runtime.hotseatMap.dynamicObjects.values()) touched ||= hasContact(bypass.runtime, bypassPawn, object);
  });
  assert(crossed && !touched && bypass.runtime.pieces.has(bypassPawn.instance.id), "Actual outer route failed");
  report.shots.push({ ...bypassShot, purpose: "outer route bypass", maxZ, seconds: bypassSeconds, touched,
    forcedSettles: bypass.turn.forcedSettleCount });
  console.log("PASS C01: actual approved Pawn shot crosses outer route without hitting block or hole");

  const counts = () => ({ bodies: r.world.bodies.len(), colliders: r.world.colliders.len(), joints: r.world.impulseJoints.len(),
    meshes: initial.scene.scene.children.length });
  const installedCounts = counts();
  let geometryDisposals = 0, materialDisposals = 0;
  for (let restart = 0; restart < 20; restart++) {
    const meshes = [...r.hotseatMap.dynamicObjects.values()].map(o => o.mesh).concat(initial.scene.boardMeshes);
    for (const mesh of meshes) {
      mesh.geometry.addEventListener("dispose", () => geometryDisposals++);
      for (const material of new Set(Array.isArray(mesh.material) ? mesh.material : [mesh.material]))
        material.addEventListener("dispose", () => materialDisposals++);
    }
    maps.disposeHotseatMap(r, initial.scene);
    assert.equal(r.world.bodies.len(), 17); assert.equal(r.world.colliders.len(), 17);
    assert.equal(initial.scene.scene.children.length, 17);
    assert.equal(r.boardHoleRectangles.length, 0);
    physics.rebuildPhysicsBoard(r, meta, H, options);
    physics.resetPhysicsPieces(r, meta, instances, options);
    maps.installHotseatMap(r, initial.scene, definition, meta);
    turn.resetTurnRuntime(initial.turn);
    physics.preSettlePhysics(r);
    assert.deepEqual(counts(), installedCounts, `Restart ${restart} leaked objects`);
    assert.equal(r.hotseatMap.fallenObjectIds.size, 0);
    assert.equal(r.pieces.size, 16); assert.equal(r.hotseatMap.dynamicObjects.size, 2);
    assert([...r.pieces.values()].every(p => p.body.isSleeping() && p.body.translation().y > config.FALL_OUT_Y));
    const restored = r.hotseatMap.dynamicObjects.get("block-left");
    assert(Math.abs(restored.body.translation().x - .36 * H) < .001);
  }
  assert.equal(geometryDisposals, 200); assert.equal(materialDisposals, 360);
  maps.disposeHotseatMap(r, initial.scene);
  physics.rebuildPhysicsBoard(r, meta, stage.computeStageBoardHalfExtent(meta.cellSize, "hotseat", 1), options);
  physics.resetPhysicsPieces(r, meta, layout.PIECE_INSTANCES, options);
  turn.resetTurnRuntime(initial.turn);
  assert.equal(r.hotseatMap, undefined); assert.equal(r.pieces.size, 32);
  assert.equal(r.world.bodies.len(), 33); assert.equal(r.world.colliders.len(), 33);
  assert.equal(r.boardColliders.length, 1); assert.equal(r.boardHoleRectangles.length, 0);
  assert.equal(initial.scene.boardMeshes.length, 1); assert(initial.scene.boardMeshes[0].visible);
  assert(!initial.scene.scene.children.some(mesh => mesh.name.startsWith("map-") || mesh.name.startsWith("MapFloor-")));
  assert.equal(surfaces.computeHotseatMapFloorLayout(definition, H).rectangles.length, 8);
  report.restarts = { count: 20, installedCounts, geometryDisposals, materialDisposals, classicPieces: 32, classicBodies: 33, classicColliders: 33 };
  console.log("PASS C01: 20 real install/dispose/reset cycles, geometry/material disposal, classic 32-piece cleanup");
  const reportIndex = process.argv.indexOf("--report");
  if (reportIndex >= 0) await writeFile(process.argv[reportIndex + 1], JSON.stringify(report, null, 2) + "\n");
  else console.log(JSON.stringify(report, null, 2));
} finally {
  for (const fixture of fixtures) fixture.runtime.world.free();
  console.info = originalInfo;
  document.createElement = originalCreateElement;
  await vite.close();
}
