import "./headless-browser-env.mjs";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
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
const fixtures = [];
const originalInfo = console.info;
console.info = () => {};
const touching = (world, a, b) => {
  let contact = false;
  world.contactPair(a, b, manifold => { contact ||= manifold.numSolverContacts() > 0; });
  return contact;
};
const yaw = body => 2 * Math.atan2(body.rotation().y, body.rotation().w);

try {
  const [physics, config, definitions, maps, surfaces, stage, turn, tuning, layout, g03] = await Promise.all([
    "physics", "config", "maps/c04", "maps/hotseat-map-runtime", "maps/surface-materials", "stage", "turn", "tuning", "layout", "maps/g03",
  ].map(name => vite.ssrLoadModule(`/src/${name}.ts`)));
  const meta = JSON.parse(await readFile(new URL("../../public/assets/chess-set.meta.json", import.meta.url), "utf8"));
  const map = definitions.C04_MAP;
  const H = stage.computeStageBoardHalfExtent(meta.cellSize, "stage", 2);
  const options = { gameMode: "hotseat", stageNumber: 1 };
  const report = { mapId: map.id, revision: map.revision, halfExtent: H, rapier: "0.19.3", shots: [],
    browser: "not run", android: "not run" };
  assert.equal(map.objects, g03.G03_MAP.objects, "C04 must reuse the G03 gate");
  assert.equal(map.spawns, g03.G03_MAP.spawns);
  assert.deepEqual(map.surfaces.map(s => s.rectangle), [
    { minU: -.72, maxU: -.22, minV: -.22, maxV: .22 },
    { minU: .22, maxU: .72, minV: -.22, maxV: .22 },
  ]);
  const floor = surfaces.computeHotseatMapFloorLayout(map, H);
  assert.equal(floor.rectangles.length, 15);
  assert.equal(floor.rectangles.filter(r => r.material === "ice").length, 2);
  assert.ok(Math.abs(floor.rectangles.reduce((sum, r) => sum + (r.maxX - r.minX) * (r.maxZ - r.minZ), 0) - 4 * H * H) < 1e-8);
  for (let a = 0; a < floor.rectangles.length; a++) for (let b = a + 1; b < floor.rectangles.length; b++) {
    const l = floor.rectangles[a], r = floor.rectangles[b];
    assert.ok(Math.min(l.maxX, r.maxX) <= Math.max(l.minX, r.minX) || Math.min(l.maxZ, r.maxZ) <= Math.max(l.minZ, r.minZ), "duplicate floor collider");
  }

  async function create(definition = map) {
    const runtime = await physics.createPhysicsRuntime(meta, definition.spawns.map(s => s.instance), H, options);
    const boardMesh = new Mesh(), scene3d = new Scene(); scene3d.add(boardMesh);
    const scene = { scene: scene3d, boardMesh, boardMeshes: [boardMesh], boardTop: runtime.boardTop, boardHalfExtent: H,
      boardFloorRectangles: runtime.boardFloorRectangles, boardHoleRectangles: [], boardFloorLayoutKey: runtime.boardFloorLayoutKey,
      pieceMeshes: new Map(), breakableWallMeshes: new Map(), controls: { enabled: true } };
    for (const piece of runtime.pieces.values()) {
      const mesh = new Mesh(); mesh.name = piece.instance.id; scene3d.add(mesh); scene.pieceMeshes.set(piece.instance.id, mesh);
    }
    maps.installHotseatMap(runtime, scene, definition, meta);
    const turnRuntime = turn.createTurnRuntime(runtime, scene, tuning.createDefaultRuntimeTuningSettings(), meta.cellSize);
    const fixture = { runtime, scene, turn: turnRuntime, settlements: 0 };
    turnRuntime.onTurnSettled = () => fixture.settlements++;
    fixtures.push(fixture);
    return fixture;
  }
  const place = (piece, x, z) => {
    piece.body.setTranslation({ x, y: piece.spawnTranslation.y, z }, true);
    piece.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    piece.body.setLinvel({ x: 0, y: 0, z: 0 }, true); piece.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  };
  const step = fixture => {
    turn.applyPendingLaunchBeforeStep(fixture.turn);
    fixture.runtime.world.step();
    turn.updateTurnAfterStep(fixture.turn, config.FIXED_STEP);
    maps.synchronizeHotseatMapMeshes(fixture.runtime);
  };
  const slow = piece => piece.body.isFixed() || (Math.hypot(...Object.values(piece.body.linvel())) < config.REST_LINEAR_EPS
    && Math.hypot(...Object.values(piece.body.angvel())) < config.REST_ANGULAR_EPS);
  const counts = fixture => ({ bodies: fixture.runtime.world.bodies.len(), colliders: fixture.runtime.world.colliders.len(),
    joints: fixture.runtime.world.impulseJoints.len(), meshes: fixture.scene.scene.children.length });

  const initial = await create(), r = initial.runtime;
  physics.validateSpawnOverlaps(r, meta, false);
  assert.equal(r.pieces.size, 16);
  const gate = r.hotseatMap.dynamicObjects.get("gate-main");
  for (const piece of r.pieces.values()) {
    const points = meta.pieces[piece.instance.type].colliderPoints.map(p => new Vector3(...p).multiplyScalar(piece.uniformScale)
      .applyQuaternion(piece.body.rotation()).add(piece.body.translation()));
    const g = gate.body.translation(), e = gate.collider.halfExtents();
    assert.ok(Math.max(...points.map(p => p.x)) <= g.x - e.x || Math.min(...points.map(p => p.x)) >= g.x + e.x
      || Math.max(...points.map(p => p.z)) <= g.z - e.z || Math.min(...points.map(p => p.z)) >= g.z + e.z,
    `spawn overlaps gate: ${piece.instance.id}`);
  }
  physics.preSettlePhysics(r);
  for (let i = 0; i < 1200; i++) r.world.step();
  let drift = 0;
  for (const piece of r.pieces.values()) {
    assert.ok(piece.body.isSleeping() && piece.body.translation().y > config.FALL_OUT_Y);
    drift = Math.max(drift, Math.hypot(piece.body.translation().x - piece.spawnTranslation.x, piece.body.translation().z - piece.spawnTranslation.z));
  }
  assert.ok(drift < .01);
  assert.ok(gate.anchorBody.isFixed());
  assert.ok(Math.abs(gate.joint.limitsMin() + 75 * Math.PI / 180) < 1e-6);
  assert.ok(Math.abs(gate.joint.limitsMax() - 75 * Math.PI / 180) < 1e-6);
  report.spawn = { pieces: 16, seconds: 10, drift, counts: counts(initial) };
  console.log("PASS C04: exact two ice regions, G03 gate, 16 supported nonoverlapping spawns, ten-second idle");

  // Gate and piece are independently required to be slow before turn settlement.
  initial.turn.phase = "settling";
  gate.body.setAngvel({ x: 0, y: .08, z: 0 }, true);
  for (let i = 0; i < 40; i++) turn.updateTurnAfterStep(initial.turn, config.FIXED_STEP);
  assert.equal(initial.turn.phase, "settling");
  gate.body.setAngvel({ x: 0, y: 0, z: 0 }, true); gate.body.sleep();
  const waitingPawn = r.pieces.get("white-pawn-center");
  waitingPawn.body.setLinvel({ x: .1, y: 0, z: 0 }, true);
  for (let i = 0; i < 40; i++) turn.updateTurnAfterStep(initial.turn, config.FIXED_STEP);
  assert.equal(initial.turn.phase, "settling");
  waitingPawn.body.setLinvel({ x: 0, y: 0, z: 0 }, true); waitingPawn.body.sleep();
  for (let i = 0; i < 40; i++) turn.updateTurnAfterStep(initial.turn, config.FIXED_STEP);
  assert.equal(initial.turn.phase, "ready");
  assert.equal(initial.settlements, 0, "a synthetic settle probe must not count as a launch");
  console.log("PASS C04: next turn waits for moving gate tip and moving piece independently");

  report.limits = [];
  for (const sign of [-1, 1]) {
    const fixture = await create(), door = fixture.runtime.hotseatMap.dynamicObjects.get("gate-main");
    physics.preSettlePhysics(fixture.runtime);
    const pivot = { ...door.body.translation() };
    door.body.setAngvel({ x: 0, y: sign * 10, z: 0 }, true);
    let maxAngle = 0, pivotDrift = 0;
    for (let i = 0; i < 1200; i++) {
      fixture.runtime.world.step();
      const p = door.body.translation(), q = door.body.rotation();
      maxAngle = Math.max(maxAngle, sign * yaw(door.body) * 180 / Math.PI);
      pivotDrift = Math.max(pivotDrift, Math.hypot(p.x - pivot.x, p.y - pivot.y, p.z - pivot.z));
      assert.ok([p.x, p.y, p.z, q.x, q.y, q.z, q.w].every(Number.isFinite));
      assert.ok(Math.hypot(q.x, q.z) < .002, "gate tilted off its y-axis");
    }
    assert.ok(maxAngle > 74.5 && maxAngle < 75.1 && pivotDrift < .002, "gate limit/pivot stress failed");
    assert.ok(maps.isMapObjectSlow(door));
    report.limits.push({ sign, maxAngle, pivotDrift });
  }
  console.log("PASS C04: both 75-degree limits and fixed pivot remain stable on mixed ice floor");

  async function shot(definition, speed, sign = 1, targetX = -.65, targetZ = -.34) {
    const fixture = await create(definition), rt = fixture.runtime;
    const attacker = rt.pieces.get("white-pawn-center"), target = rt.pieces.get("black-pawn-center");
    const door = rt.hotseatMap.dynamicObjects.get("gate-main");
    place(attacker, .68 * sign, -.58);
    place(target, targetX * sign, targetZ);
    physics.preSettlePhysics(rt);
    const origin = { ...target.body.translation() }, pivot = { ...door.body.translation() };
    const normalizedPower = speed / config.getMaxLaunchSpeed("hotseat", "Pawn");
    assert.ok(turn.queueTurnLaunch(fixture.turn, { pieceId: attacker.instance.id, direction: new Vector3(0, 0, 1), normalizedPower,
      applicationPoint: new Vector3().copy(attacker.body.worldCom()) }).accepted);
    let attackContact = false, targetContact = false, iceContact = false, maxAngle = 0, pivotDrift = 0, distance = 0, steps = 0;
    while (fixture.turn.phase === "settling" && steps < 1800) {
      turn.applyPendingLaunchBeforeStep(fixture.turn); rt.world.step();
      attackContact ||= touching(rt.world, attacker.collider, door.collider);
      targetContact ||= touching(rt.world, target.collider, door.collider);
      if (targetContact) for (const floorCollider of rt.boardColliders) {
        if (surfaces.getBoardSurfaceId(floorCollider)?.startsWith("ice-") && touching(rt.world, target.collider, floorCollider)) iceContact = true;
      }
      const p = target.body.translation(), d = door.body.translation();
      distance = Math.max(distance, Math.hypot(p.x - origin.x, p.z - origin.z));
      maxAngle = Math.max(maxAngle, Math.abs(yaw(door.body)) * 180 / Math.PI);
      pivotDrift = Math.max(pivotDrift, Math.hypot(d.x - pivot.x, d.y - pivot.y, d.z - pivot.z));
      const movingGate = !maps.areHotseatObjectsAtRest(rt), movingPiece = [...rt.pieces.values()].some(piece => !slow(piece));
      turn.updateTurnAfterStep(fixture.turn, config.FIXED_STEP);
      if (movingGate || movingPiece) assert.equal(fixture.turn.phase, "settling", "turn finished during gate/piece movement");
      maps.synchronizeHotseatMapMeshes(rt);
      assert.ok(door.mesh.position.distanceTo(new Vector3().copy(door.body.translation())) < 1e-7);
      steps++;
    }
    assert.ok(steps < 1800 && attackContact && targetContact, "approved gate-to-piece shot failed");
    assert.ok(maxAngle < 75.1 && pivotDrift < .002, "pivot or limit unstable");
    assert.equal(fixture.settlements, 1); assert.equal(fixture.turn.forcedSettleCount, 0);
    const result = { floor: definition.surfaces.length ? "ice" : "normal", speed, normalizedPower, sign, attackContact, targetContact,
      iceContact, distance, maxAngle, pivotDrift, targetX, targetZ, seconds: steps * config.FIXED_STEP, remainingPieces: rt.pieces.size, forcedSettles: fixture.turn.forcedSettleCount };
    report.shots.push(result);
    return result;
  }
  for (const [speed, sign] of [[2, 1], [3, 1], [4, 1], [2, -1]]) {
    const icy = await shot(map, speed, sign, -.8, -.34);
    const normal = await shot(g03.G03_MAP, speed, sign, -.8, -.34);
    assert.ok(icy.iceContact && !normal.iceContact);
    assert.equal(icy.remainingPieces, 16, "fixture caused unsafe chain removal");
    assert.equal(normal.remainingPieces, 16);
    if (speed === 2 && sign === 1) assert.ok(icy.distance > normal.distance * 1.3, `weak indirect ice shot has no distinct travel: ${JSON.stringify({icy, normal})}`);
  }
  const iceWeak = report.shots.find(s => s.floor === "ice" && s.speed === 2 && s.sign === 1);
  const normalMedium = report.shots.find(s => s.floor === "normal" && s.speed === 3 && s.sign === 1);
  assert.ok(Math.abs(iceWeak.distance - normalMedium.distance) < .15 * normalMedium.distance,
    "ice did not demonstrate a different power choice for similar travel");
  report.comparison = { weakIceToWeakNormal: iceWeak.distance / report.shots.find(s => s.floor === "normal" && s.speed === 2 && s.sign === 1).distance,
    icePowerForSimilarTravel: iceWeak.normalizedPower, normalPowerForSimilarTravel: normalMedium.normalizedPower };
  console.log("PASS C04: approved gate-to-piece-to-ice shots on both ends, distinct travel/power versus G03 floor, no chain removals");

  const expected = counts(initial);
  let geometryDisposals = 0, materialDisposals = 0;
  for (let cycle = 0; cycle < 20; cycle++) {
    const meshes = [...r.hotseatMap.dynamicObjects.values()].map(o => o.mesh).concat(initial.scene.boardMeshes);
    for (const mesh of meshes) {
      mesh.geometry.addEventListener("dispose", () => geometryDisposals++);
      for (const material of new Set(Array.isArray(mesh.material) ? mesh.material : [mesh.material])) material.addEventListener("dispose", () => materialDisposals++);
    }
    maps.disposeHotseatMap(r, initial.scene);
    assert.equal(r.world.impulseJoints.len(), 0); assert.equal(r.world.bodies.len(), 17); assert.equal(r.world.colliders.len(), 17);
    physics.rebuildPhysicsBoard(r, meta, H, options);
    physics.resetPhysicsPieces(r, meta, map.spawns.map(s => s.instance), options);
    maps.installHotseatMap(r, initial.scene, map, meta);
    turn.resetTurnRuntime(initial.turn); physics.preSettlePhysics(r);
    assert.deepEqual(counts(initial), expected);
    assert.ok([...r.pieces.values()].every(piece => piece.body.isSleeping() && piece.body.translation().y > config.FALL_OUT_Y));
    assert.equal(r.boardColliders.filter(c => surfaces.getBoardSurfaceId(c)?.startsWith("ice-")).length, 2);
  }
  assert.equal(geometryDisposals, 320); assert.equal(materialDisposals, 640);
  maps.disposeHotseatMap(r, initial.scene);
  physics.rebuildPhysicsBoard(r, meta, config.deriveBoardHalfExtent(meta.cellSize), options);
  physics.resetPhysicsPieces(r, meta, layout.PIECE_INSTANCES, options);
  assert.equal(r.hotseatMap, undefined); assert.equal(r.pieces.size, 32);
  assert.equal(r.world.bodies.len(), 33); assert.equal(r.world.colliders.len(), 33); assert.equal(r.world.impulseJoints.len(), 0);
  assert.equal(r.boardColliders.length, 1); assert.equal(surfaces.getBoardSurfaceId(r.boardCollider), undefined);
  assert.equal(initial.scene.boardMeshes.length, 1); assert.ok(initial.scene.boardMesh.visible);
  assert.ok(!initial.scene.scene.children.some(mesh => mesh.name.startsWith("map-") || mesh.name.startsWith("MapFloor-")));
  report.restarts = { cycles: 20, counts: expected, geometryDisposals, materialDisposals, classicPieces: 32 };
  console.log("PASS C04: 20 full reset/disposal cycles and classic 32-piece cleanup");
  const reportIndex = process.argv.indexOf("--report");
  if (reportIndex >= 0) await writeFile(process.argv[reportIndex + 1], JSON.stringify(report, null, 2) + "\n");
  else console.log(JSON.stringify(report, null, 2));
} finally {
  for (const fixture of fixtures) fixture.runtime.world.free();
  console.info = originalInfo; document.createElement = createElement;
  await vite.close();
}
