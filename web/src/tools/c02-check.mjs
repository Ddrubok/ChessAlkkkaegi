import "./headless-browser-env.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Mesh, Scene, Vector3 } from "three";
import { createServer } from "vite";

const createElement = document.createElement;
document.createElement = tag => tag === "canvas" ? {
  width: 0, height: 0,
  getContext: () => new Proxy({}, { get: () => () => {}, set: () => true }),
} : createElement(tag);
const vite = await createServer({ root: fileURLToPath(new URL("../..", import.meta.url)), configFile: false,
  logLevel: "error", appType: "custom", server: { middlewareMode: true, hmr: false, ws: false } });
const worlds = [];
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: ${actual} != ${expected}`);
const contact = (world, a, b) => {
  let touching = false;
  world.contactPair(a, b, manifold => { touching ||= manifold.numSolverContacts() > 0; });
  return touching;
};

try {
  const [physics, config, definitions, maps, surfaces, stage, walls, turn, tuning, layout] = await Promise.all([
    "physics", "config", "maps/c02", "maps/hotseat-map-runtime", "maps/surface-materials", "stage", "walls", "turn", "tuning", "layout",
  ].map(name => vite.ssrLoadModule(`/src/${name}.ts`)));
  const meta = JSON.parse(await readFile(new URL("../../public/assets/chess-set.meta.json", import.meta.url), "utf8"));
  const map = definitions.createC02MapDefinition(meta);
  const H = stage.computeStageBoardHalfExtent(meta.cellSize, "stage", 2);
  const options = { gameMode: "hotseat", stageNumber: 1 };
  const kingRadius = walls.computePocketKingBaseRadius(meta.pieces.King.colliderPoints, meta.pieces.King.bounds.y);
  const geometry = walls.computePocketWallGeometry(H, kingRadius);
  const legacyWalls = walls.computePocketWallSegments(H, 0, kingRadius);
  assert.equal(map.id, definitions.C02_MAP_ID);
  assert.equal(map.spawns.length, 16);
  assert.equal(map.objects.length, 4);
  assert.equal(map.surfaces.length, 4);
  near(geometry.diagonalClearance, 2 * kingRadius * config.POCKET_WALL_EXIT_WIDTH_KING_DIAMETER_MULTIPLIER, "king exit width");
  const floor = surfaces.computeHotseatMapFloorLayout(map, H);
  assert.equal(floor.rectangles.length, 9);
  assert.equal(floor.rectangles.filter(rectangle => rectangle.material === "ice").length, 4);
  near(floor.rectangles.reduce((area, r) => area + (r.maxX - r.minX) * (r.maxZ - r.minZ), 0), 4 * H * H, "floor coverage");
  for (let a = 0; a < floor.rectangles.length; a++) for (let b = a + 1; b < floor.rectangles.length; b++) {
    const l = floor.rectangles[a], r = floor.rectangles[b];
    assert.ok(Math.min(l.maxX, r.maxX) <= Math.max(l.minX, r.minX) || Math.min(l.maxZ, r.maxZ) <= Math.max(l.minZ, r.minZ), "duplicate floor");
  }
  // This factory must follow another loaded set rather than caching one model's king width.
  const scaledMeta = structuredClone(meta);
  scaledMeta.pieces.King.colliderPoints = scaledMeta.pieces.King.colliderPoints.map(([x, y, z]) => [x * 1.1, y, z * 1.1]);
  const widerKingMap = definitions.createC02MapDefinition(scaledMeta);
  assert.ok(widerKingMap.objects[0].widthH < map.objects[0].widthH, "loaded king changes exit geometry");

  function sceneFor(runtime) {
    const scene = new Scene();
    const boardMesh = new Mesh(); scene.add(boardMesh);
    const pieceMeshes = new Map([...runtime.pieces.values()].map(piece => {
      const mesh = new Mesh(); mesh.name = piece.instance.id; scene.add(mesh); return [piece.instance.id, mesh];
    }));
    return { scene, boardMesh, boardMeshes: [boardMesh], boardTop: runtime.boardTop, boardHalfExtent: H,
      boardFloorRectangles: runtime.boardFloorRectangles, boardHoleRectangles: [], boardFloorLayoutKey: runtime.boardFloorLayoutKey,
      pieceMeshes, breakableWallMeshes: new Map(), controls: { enabled: true } };
  }
  async function create(definition = map) {
    const runtime = await physics.createPhysicsRuntime(meta, definition.spawns.map(spawn => spawn.instance), H, options);
    worlds.push(runtime.world);
    const scene = sceneFor(runtime);
    maps.installHotseatMap(runtime, scene, definition, meta);
    return { runtime, scene };
  }
  function pieceAabb(piece) {
    const position = piece.body.translation(), rotation = piece.body.rotation();
    const points = meta.pieces[piece.instance.type].colliderPoints.map(point => new Vector3(...point).multiplyScalar(piece.uniformScale).applyQuaternion(rotation).add(position));
    return { minX: Math.min(...points.map(p => p.x)), maxX: Math.max(...points.map(p => p.x)),
      minY: Math.min(...points.map(p => p.y)), maxY: Math.max(...points.map(p => p.y)),
      minZ: Math.min(...points.map(p => p.z)), maxZ: Math.max(...points.map(p => p.z)) };
  }
  const integrated = await create();
  const { runtime, scene } = integrated;
  physics.validateSpawnOverlaps(runtime, meta, false);
  for (const piece of runtime.pieces.values()) {
    const aabb = pieceAabb(piece);
    for (const object of runtime.hotseatMap.dynamicObjects.values()) {
      const p = object.body.translation(), e = object.collider.halfExtents();
      assert.ok(aabb.maxX <= p.x - e.x || aabb.minX >= p.x + e.x || aabb.maxZ <= p.z - e.z || aabb.minZ >= p.z + e.z,
        `spawn wall overlap: ${piece.instance.id} / ${object.definition.id}`);
    }
    for (const ice of floor.rectangles.filter(r => r.material === "ice")) {
      assert.ok(aabb.maxX <= ice.minX || aabb.minX >= ice.maxX || aabb.maxZ <= ice.minZ || aabb.minZ >= ice.maxZ,
        `spawn footprint touches ice: ${piece.instance.id}`);
    }
  }
  for (const wall of legacyWalls) {
    const binding = runtime.hotseatMap.dynamicObjects.get(wall.id);
    assert.ok(binding.body.isFixed());
    for (const axis of ["x", "y", "z"]) {
      near(binding.body.translation()[axis], wall.center[axis], `${wall.id} center ${axis}`);
      near(binding.collider.halfExtents()[axis], wall.halfExtents[axis], `${wall.id} extent ${axis}`);
    }
  }
  const settle = physics.preSettlePhysics(runtime);
  let spawnDrift = 0;
  for (let step = 0; step < 1200; step++) runtime.world.step();
  for (const piece of runtime.pieces.values()) {
    const p = piece.body.translation();
    assert.ok(piece.body.isSleeping() && p.y > config.FALL_OUT_Y);
    spawnDrift = Math.max(spawnDrift, Math.hypot(p.x - piece.spawnTranslation.x, p.z - piece.spawnTranslation.z));
  }
  assert.ok(spawnDrift < .01, `spawn drift: ${spawnDrift}`);

  const settings = tuning.createDefaultRuntimeTuningSettings();
  const tuningRuntime = { physicsRuntime: runtime, settings, localSettings: { ...settings }, controls: new Map(),
    panel: { querySelector: () => null }, storage: null, storageNotice: {}, onlineNotice: {}, onlineDefaultsActive: false };
  const expected = [21, 29, 0, 4, 9];
  for (let reset = 0; reset < 20; reset++) {
    maps.disposeHotseatMap(runtime, scene);
    physics.rebuildPhysicsBoard(runtime, meta, H, options);
    physics.resetPhysicsPieces(runtime, meta, map.spawns.map(spawn => spawn.instance), options);
    tuning.reapplyTuningPhysicsSettings(tuningRuntime);
    maps.installHotseatMap(runtime, scene, definitions.createC02MapDefinition(meta), meta);
    physics.preSettlePhysics(runtime);
    tuning.setTuningValue(tuningRuntime, "friction", reset % 2 ? .12 : .08, false);
    tuning.reapplyTuningPhysicsSettings(tuningRuntime);
    runtime.world.step(); tuning.verifyTuningAfterStep(tuningRuntime);
    assert.deepEqual([runtime.world.bodies.len(), runtime.world.colliders.len(), runtime.world.impulseJoints.len(),
      scene.scene.children.filter(mesh => mesh.name.startsWith("map-")).length,
      scene.scene.children.filter(mesh => mesh.name.startsWith("MapFloor-")).length], expected, `reset ${reset}`);
    for (const collider of runtime.boardColliders) {
      near(collider.friction(), surfaces.getBoardSurfaceId(collider).startsWith("ice-") ? .005 : settings.friction, "tuning preserves material");
      near(collider.translation().y + collider.halfExtents().y, runtime.boardTop, "flush ice top");
    }
  }

  async function shot({ type, u, v, direction, power, definition = map, lying = false, steps = 1800 }) {
    const fixture = await create(definition);
    const { runtime: r, scene: s } = fixture;
    const piece = [...r.pieces.values()].find(p => p.instance.side === "white" && p.instance.type === type);
    // Navigation fixtures use the game's actual convex piece and launch path, with no rotation lock.
    for (const [id, other] of [...r.pieces]) if (other !== piece && id !== "black-pawn-center") {
      r.world.removeRigidBody(other.body); r.pieces.delete(id); s.scene.remove(s.pieceMeshes.get(id)); s.pieceMeshes.delete(id);
    }
    const other = r.pieces.get("black-pawn-center");
    other.body.setTranslation({ x: 0, y: other.spawnTranslation.y, z: H * .4 }, true);
    piece.body.setTranslation({ x: -u * H, y: piece.spawnTranslation.y, z: v * H }, true);
    if (lying) piece.body.setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }, true);
    physics.preSettlePhysics(r);
    const start = { ...piece.body.translation() };
    const t = turn.createTurnRuntime(r, s, tuning.createDefaultRuntimeTuningSettings());
    t.phase = "ready"; t.currentSide = "white";
    let settlements = 0; t.onTurnSettled = () => settlements++;
    const center = piece.body.worldCom();
    assert.ok(turn.queueTurnLaunch(t, { pieceId: piece.instance.id, direction: new Vector3(...direction).normalize(),
      applicationPoint: new Vector3(center.x, center.y, center.z), normalizedPower: power }).accepted);
    assert.ok(turn.applyPendingLaunchBeforeStep(t));
    let wallContact = false, reflected = false, exit = false, maxSpeed = 0, boundaryCrossed = false, maxY = start.y;
    const touchedWalls = new Set();
    let lastPosition = start, contactPosition, exitPosition;
    let elapsedSeconds = 0;
    for (let step = 0; step < steps; step++) {
      turn.applyPendingLaunchBeforeStep(t); r.world.step();
      if (r.pieces.has(piece.instance.id)) {
        const p = piece.body.translation(), velocity = piece.body.linvel();
        lastPosition = { ...p }; maxY = Math.max(maxY, p.y);
        assert.ok([p.x, p.y, p.z, velocity.x, velocity.y, velocity.z].every(Number.isFinite));
        maxSpeed = Math.max(maxSpeed, Math.hypot(velocity.x, velocity.y, velocity.z));
        const contacts = [...r.hotseatMap.dynamicObjects.values()].filter(wall => contact(r.world, piece.collider, wall.collider));
        for (const wall of contacts) touchedWalls.add(wall.definition.id);
        if (contacts.length > 0) {
          if (!wallContact) contactPosition = { ...p };
          wallContact = true;
        }
        reflected ||= wallContact && velocity.x * direction[0] < -.05;
        if (!exit && (Math.abs(p.x) > H || Math.abs(p.z) > H)) { exit = true; exitPosition = { ...p }; }
        boundaryCrossed ||= (Math.abs(start.x) - H * .45) * (Math.abs(p.x) - H * .45) < 0;
      }
      turn.updateTurnAfterStep(t, config.FIXED_STEP);
      elapsedSeconds += config.FIXED_STEP;
      if (t.phase !== "settling") break;
    }
    assert.equal(settlements, 1, `settlement count ${type}`);
    for (let step = 0; step < 60; step++) turn.updateTurnAfterStep(t, config.FIXED_STEP);
    assert.equal(settlements, 1, `duplicate settlement ${type}`);
    const result = { type, u, v, direction, power, start, wallContact, touchedWalls: [...touchedWalls], reflected, contactPosition, exit, exitPosition,
      removed: !r.pieces.has(piece.instance.id), lastPosition, distance: Math.hypot(lastPosition.x - start.x, lastPosition.z - start.z),
      maxSpeed, initialSpeed: t.lastLaunchInitialSpeed, maxY, boundaryCrossed, settleSeconds: elapsedSeconds, forcedSettlements: t.forcedSettleCount };
    maps.disposeHotseatMap(r, s);
    return result;
  }

  const escape = [];
  for (const signX of [-1, 1]) for (const signZ of [-1, 1]) {
    const result = await shot({ type: "King", u: -.72 * signX, v: .72 * signZ, direction: [signX, 0, signZ], power: .28 });
    assert.ok(result.exit && result.removed && !result.wallContact, `king corner escape: ${JSON.stringify(result)}`);
    escape.push(result);
  }
  const reflection = await shot({ type: "Pawn", u: -.68, v: -.57, direction: [1, 0, -.4], power: .2 });
  assert.ok(reflection.wallContact && reflection.reflected && reflection.exit && reflection.removed,
    `real wall reflection and exit: ${JSON.stringify(reflection)}`);
  assert.deepEqual(reflection.touchedWalls, ["pocket-wall-east"], "ricochet exits through the adjacent corner gap without crossing its south wall");
  assert.ok(reflection.exitPosition.x > geometry.wallLength / 2, "ricochet leaves beyond the adjacent wall tip");
  const boundary = [];
  for (const lying of [false, true]) {
    const result = await shot({ type: "Pawn", u: -.50, v: -.65, direction: [-1, 0, 0], power: .12, lying });
    assert.ok(result.boundaryCrossed && !result.wallContact && !result.removed && result.maxY - result.start.y < .03,
      `smooth slow boundary: ${JSON.stringify(result)}`);
    boundary.push(result);
  }
  const comparison = [];
  for (const ice of [false, true]) {
    const result = await shot({ type: "Pawn", u: -.60, v: -.65, direction: [-1, 0, 0], power: .12,
      definition: ice ? map : { ...map, surfaces: [] } });
    comparison.push({ ice, ...result });
  }
  assert.ok(comparison[1].distance > comparison[0].distance * 1.2, "ice noticeably extends the same real launch");

  // The original 16-piece spawn also has an ordinary attack through the clear central lane.
  const ordinaryFixture = await create();
  const ordinaryRuntime = ordinaryFixture.runtime;
  physics.preSettlePhysics(ordinaryRuntime);
  const attacker = ordinaryRuntime.pieces.get("white-pawn-left"), target = ordinaryRuntime.pieces.get("black-pawn-right");
  const targetStart = { ...target.body.translation() };
  const ordinaryTurn = turn.createTurnRuntime(ordinaryRuntime, ordinaryFixture.scene, tuning.createDefaultRuntimeTuningSettings());
  ordinaryTurn.phase = "ready"; ordinaryTurn.currentSide = "white";
  const center = attacker.body.worldCom();
  assert.ok(turn.queueTurnLaunch(ordinaryTurn, { pieceId: attacker.instance.id, direction: new Vector3(0, 0, 1),
    applicationPoint: new Vector3(center.x, center.y, center.z), normalizedPower: .4 }).accepted);
  let targetContact = false, targetDisplacement = 0;
  for (let step = 0; step < 1800 && ordinaryTurn.phase === "settling"; step++) {
    turn.applyPendingLaunchBeforeStep(ordinaryTurn); ordinaryRuntime.world.step();
    if (ordinaryRuntime.pieces.has(attacker.instance.id) && ordinaryRuntime.pieces.has(target.instance.id)) {
      targetContact ||= contact(ordinaryRuntime.world, attacker.collider, target.collider);
      const p = target.body.translation();
      targetDisplacement = Math.max(targetDisplacement, Math.hypot(p.x - targetStart.x, p.z - targetStart.z));
    }
    turn.updateTurnAfterStep(ordinaryTurn, config.FIXED_STEP);
  }
  assert.ok(targetContact && targetDisplacement > .05, `original-spawn ordinary attack: ${targetDisplacement}`);
  maps.disposeHotseatMap(ordinaryRuntime, ordinaryFixture.scene);

  let disposedGeometry = 0, disposedMaterials = 0, disposedFloorGeometry = 0, disposedFloorMaterials = 0;
  for (const object of runtime.hotseatMap.dynamicObjects.values()) {
    object.mesh.geometry.addEventListener("dispose", () => disposedGeometry++);
    object.mesh.material.addEventListener("dispose", () => disposedMaterials++);
  }
  for (const mesh of scene.scene.children.filter(mesh => mesh.name.startsWith("MapFloor-"))) {
    mesh.geometry.addEventListener("dispose", () => disposedFloorGeometry++);
    for (const material of new Set(Array.isArray(mesh.material) ? mesh.material : [mesh.material])) {
      material.addEventListener("dispose", () => disposedFloorMaterials++);
    }
  }
  maps.disposeHotseatMap(runtime, scene);
  assert.equal(disposedGeometry, 4); assert.equal(disposedMaterials, 4);
  assert.equal(disposedFloorGeometry, 9); assert.equal(disposedFloorMaterials, 18);
  assert.equal(runtime.hotseatMap, undefined);
  assert.equal(runtime.world.bodies.len(), 17); assert.equal(runtime.world.colliders.len(), 17);
  assert.equal(scene.scene.children.filter(mesh => mesh.name.startsWith("map-") || mesh.name.startsWith("MapFloor-")).length, 0);
  const normalH = stage.computeStageBoardHalfExtent(meta.cellSize, "hotseat", 1);
  physics.rebuildPhysicsBoard(runtime, meta, normalH, options);
  physics.resetPhysicsPieces(runtime, meta, layout.PIECE_INSTANCES, options);
  tuning.reapplyTuningPhysicsSettings(tuningRuntime);
  assert.equal(runtime.pieces.size, 32); assert.equal(runtime.world.bodies.len(), 33); assert.equal(runtime.world.colliders.len(), 33);
  assert.equal(runtime.boardColliders.length, 1); assert.equal(surfaces.getBoardSurfaceId(runtime.boardCollider), undefined);
  console.log(JSON.stringify({ mapId: map.id, revision: map.revision, H, kingRadius, geometry,
    spawnDrift, preSettleSteps: settle.steps, restartCycles: 20, objectCounts: expected, escape, reflection, boundary, comparison,
    ordinary: { attacker: "white-pawn-left", target: "black-pawn-right", direction: [0, 0, 1], power: .4, targetContact, targetDisplacement } }, null, 2));
  console.log("PASS C02: exact legacy pocket geometry, 16 clear spawns, ice/tuning, 20 resets/disposal/classic cleanup, real king escapes and wall reflection");
} finally {
  for (const world of worlds) world.free();
  await vite.close();
}
