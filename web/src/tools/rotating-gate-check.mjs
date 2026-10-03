import "./headless-browser-env.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { Mesh, Scene, Vector3 } from "three";

// Floor transition tests need canvas commands; visual appearance is checked in the browser.
const originalCreateElement = document.createElement;
document.createElement = tag => tag !== "canvas" ? originalCreateElement(tag) : {
  width: 0, height: 0,
  getContext: () => new Proxy({}, { get: () => () => {}, set: () => true }),
};

const vite = await createServer({
  root: fileURLToPath(new URL("../..", import.meta.url)),
  configFile: false,
  logLevel: "error",
  appType: "custom",
  server: { middlewareMode: true },
});

function yaw(body) {
  const q = body.rotation();
  return 2 * Math.atan2(q.y, q.w);
}

function touching(world, left, right) {
  let contact = false;
  world.contactPair(left, right, manifold => { contact ||= manifold.numSolverContacts() > 0; });
  return contact;
}

function disposeGate(world, gate) {
  world.removeImpulseJoint(gate.joint, true);
  world.removeRigidBody(gate.body);
  world.removeRigidBody(gate.anchorBody);
  gate.mesh.geometry.dispose();
  for (const material of gate.mesh.material) material.dispose();
}

try {
  const [config, physics, layout, stage, factory, mapModule, RAPIER, maps, turn, tuning, surface] = await Promise.all([
    vite.ssrLoadModule("/src/config.ts"),
    vite.ssrLoadModule("/src/physics.ts"),
    vite.ssrLoadModule("/src/layout.ts"),
    vite.ssrLoadModule("/src/stage.ts"),
    vite.ssrLoadModule("/src/maps/rotating-gate.ts"),
    vite.ssrLoadModule("/src/maps/g03.ts"),
    import("@dimforge/rapier3d-compat").then(module => module.default),
    vite.ssrLoadModule("/src/maps/hotseat-map-runtime.ts"),
    vite.ssrLoadModule("/src/turn.ts"),
    vite.ssrLoadModule("/src/tuning.ts"),
    vite.ssrLoadModule("/src/maps/surface-materials.ts"),
  ]);
  const meta = JSON.parse(await readFile(new URL("../../public/assets/chess-set.meta.json", import.meta.url), "utf8"));
  const map = mapModule.G03_MAP;
  const H = stage.computeStageBoardHalfExtent(meta.cellSize, "stage", 2);
  const options = { gameMode: "hotseat", stageNumber: 1 };
  const pawnInstance = layout.PIECE_INSTANCES.find(piece => piece.id === "white-pawn-d2");
  const targetInstance = layout.PIECE_INSTANCES.find(piece => piece.id === "black-pawn-d7");
  const baseline = await physics.createPhysicsRuntime(meta, [pawnInstance], H, options);
  const pawnMass = baseline.pieces.get(pawnInstance.id).body.mass();
  baseline.world.free();

  function createGate(runtime) {
    return factory.createHotseatGate(map.objects[0], {
      world: runtime.world,
      boardTop: runtime.boardTop,
      cellSize: meta.cellSize,
      halfExtent: H,
      pawnMass,
      friction: config.getPieceFriction("hotseat"),
    });
  }

  function place(binding, x, z, speed = 0) {
    binding.body.setTranslation({ x, y: binding.spawnTranslation.y, z }, true);
    binding.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    binding.body.setLinvel({ x: 0, y: 0, z: speed }, true);
    binding.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  // Actual factory counts and mass, repeated creation/removal in a single world.
  const reuse = await physics.createPhysicsRuntime(meta, [], H, options);
  const counts = () => [reuse.world.bodies.len(), reuse.world.colliders.len(), reuse.world.impulseJoints.len()];
  const baselineCounts = counts();
  for (let cycle = 0; cycle < 20; cycle++) {
    const gate = createGate(reuse);
    assert.deepEqual(counts(), [baselineCounts[0] + 2, baselineCounts[1] + 2, baselineCounts[2] + 1]);
    assert.ok(Math.abs(gate.body.mass() / pawnMass - 3) < 1e-6);
    assert.ok(Math.abs(gate.joint.limitsMin() + 75 * Math.PI / 180) < 1e-6);
    assert.ok(Math.abs(gate.joint.limitsMax() - 75 * Math.PI / 180) < 1e-6);
    assert.equal(gate.joint.contactsEnabled(), false);
    for (let step = 0; step < 1200; step++) reuse.world.step();
    assert.ok(Math.abs(yaw(gate.body)) < 1e-6, "대기 중 문이 스스로 회전했습니다.");
    assert.ok(gate.body.isSleeping(), "대기 중 문이 정착하지 않았습니다.");
    disposeGate(reuse.world, gate);
    assert.deepEqual(counts(), baselineCounts);
  }
  reuse.world.free();

  const spawn = await physics.createPhysicsRuntime(meta, map.spawns.map(entry => entry.instance), H, options);
  for (const entry of map.spawns) {
    const piece = spawn.pieces.get(entry.instance.id);
    piece.body.setTranslation({ x: -entry.u * H, y: piece.spawnTranslation.y, z: entry.v * H }, true);
  }
  const spawnGate = createGate(spawn);
  let spawnDrift = 0;
  for (let step = 0; step < 1200; step++) {
    spawn.world.step();
    for (const entry of map.spawns) {
      const piece = spawn.pieces.get(entry.instance.id), p = piece.body.translation();
      assert.ok(!touching(spawn.world, piece.collider, spawnGate.collider), `시작 기물이 문과 겹칩니다: ${entry.instance.id}`);
      assert.ok(p.y > config.FALL_OUT_Y, `시작 기물이 낙하했습니다: ${entry.instance.id}`);
      spawnDrift = Math.max(spawnDrift, Math.hypot(p.x + entry.u * H, p.z - entry.v * H));
    }
  }
  assert.ok(spawnDrift < .01, `16기물 시작 배치가 움직입니다: ${spawnDrift}`);
  disposeGate(spawn.world, spawnGate);
  spawn.world.free();

  // Same actual Pawn hull and speed: end hits must rotate more than near-pivot hits.
  const shots = [];
  for (const speed of [0.8, 3, 8]) {
    for (const x of [0.06, 0.68, -0.68]) {
      const runtime = await physics.createPhysicsRuntime(meta, [pawnInstance], H, options);
      const pawn = runtime.pieces.get(pawnInstance.id);
      const gate = createGate(runtime);
      place(pawn, x, -0.58, speed);
      let maxAngle = 0, maxDrift = 0, maxTilt = 0, hit = false, rest = 0, settledAt = null;
      for (let step = 0; step < 1200; step++) {
        runtime.world.step();
        const p = gate.body.translation(), q = gate.body.rotation(), w = gate.body.angvel();
        assert.ok([p.x, p.y, p.z, q.x, q.y, q.z, q.w, w.x, w.y, w.z].every(Number.isFinite));
        maxAngle = Math.max(maxAngle, Math.abs(yaw(gate.body)) * 180 / Math.PI);
        maxDrift = Math.max(maxDrift, Math.hypot(p.x, p.z, p.y - (runtime.boardTop + .45 * meta.cellSize / 2)));
        maxTilt = Math.max(maxTilt, Math.hypot(q.x, q.z));
        hit ||= touching(runtime.world, pawn.collider, gate.collider);
        const slow = Math.hypot(w.x, w.y, w.z) < config.REST_ANGULAR_EPS && Math.hypot(w.x, w.y, w.z) * gate.tipRadius < config.REST_LINEAR_EPS;
        rest = hit && slow ? rest + config.FIXED_STEP : 0;
        if (rest >= config.REST_HOLD_SECONDS && settledAt === null) settledAt = (step + 1) * config.FIXED_STEP;
      }
      assert.ok(hit, `문 접촉이 없습니다: speed=${speed}, x=${x}`);
      assert.ok(maxAngle <= 75.1 && maxDrift < .002 && maxTilt < .002, `각도/축 위치 불안정: ${maxAngle}, ${maxDrift}, tilt=${maxTilt}`);
      assert.ok(settledAt !== null && settledAt < config.MAX_SETTLE_SECONDS, `문 정착이 8초 제한을 넘었습니다: speed=${speed}, x=${x}, settledAt=${settledAt}`);
      shots.push({ speed, x, maxAngle, maxDrift, maxTilt, settledAt });
      disposeGate(runtime.world, gate);
      runtime.world.free();
    }
  }
  for (const speed of [0.8, 3, 8]) {
    const center = shots.find(shot => shot.speed === speed && shot.x === .06);
    const end = shots.find(shot => shot.speed === speed && shot.x === .68);
    assert.ok(end.maxAngle > center.maxAngle + 2, `끝 타격의 회전 차이가 없습니다: ${JSON.stringify({ center, end })}`);
  }

  const indirect = await physics.createPhysicsRuntime(meta, [pawnInstance, targetInstance], H, options);
  const attacker = indirect.pieces.get(pawnInstance.id);
  const target = indirect.pieces.get(targetInstance.id);
  const gate = createGate(indirect);
  place(attacker, .68, -.58, 3);
  place(target, -.65, -.34);
  let targetHit = false, targetDisplacement = 0;
  for (let step = 0; step < 1200; step++) {
    indirect.world.step();
    targetHit ||= touching(indirect.world, target.collider, gate.collider);
    const p = target.body.translation();
    targetDisplacement = Math.max(targetDisplacement, Math.hypot(p.x + .65, p.z + .34));
  }
  assert.ok(targetHit && targetDisplacement > .05, `반대편 목표 간접 타격 실패: contact=${targetHit}, displacement=${targetDisplacement}`);
  disposeGate(indirect.world, gate);
  indirect.world.free();

  const stresses = [];
  const kingInstance = layout.PIECE_INSTANCES.find(piece => piece.id === "black-king-e8");
  for (const label of ["fixed-king", "opposing-pawns"]) {
    const runtime = await physics.createPhysicsRuntime(meta, [pawnInstance, label === "fixed-king" ? kingInstance : targetInstance], H, options);
    const moving = runtime.pieces.get(pawnInstance.id);
    const other = runtime.pieces.get(label === "fixed-king" ? kingInstance.id : targetInstance.id);
    const door = createGate(runtime);
    place(moving, .68, -.58, 3);
    place(other, -.65, label === "fixed-king" ? -.36 : -.58, label === "fixed-king" ? 0 : 3);
    if (label === "fixed-king") other.body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
    let maxAngle = 0, fixedContact = false;
    for (let step = 0; step < 1200; step++) {
      runtime.world.step();
      fixedContact ||= touching(runtime.world, other.collider, door.collider);
      maxAngle = Math.max(maxAngle, Math.abs(yaw(door.body)) * 180 / Math.PI);
      assert.ok([door.body.translation().x, door.body.translation().y, door.body.translation().z, yaw(door.body)].every(Number.isFinite));
    }
    assert.ok(fixedContact && maxAngle <= 75.1, `동시/방어 접촉 불안정: ${label}, contact=${fixedContact}, angle=${maxAngle}`);
    assert.ok(door.body.isSleeping() || Math.hypot(...Object.values(door.body.angvel())) * door.tipRadius < config.REST_LINEAR_EPS, `동시/방어 접촉 미정착: ${label}`);
    stresses.push({ label, fixedContact, maxAngle });
    disposeGate(runtime.world, door);
    runtime.world.free();
  }
  console.log(JSON.stringify({ mapId: map.id, revision: map.revision, H, pawnMass, restartCycles: 20, spawnDrift, shots, indirect: { targetHit, targetDisplacement }, stresses }, null, 2));
  console.log("G03 factory 물리·회전 제한·정착·간접 타격·20회 정리 검사 통과");

  const integrated = await physics.createPhysicsRuntime(meta, map.spawns.map(spawn => spawn.instance), H, options);
  const scene = { scene: new Scene(), boardMeshes: [new Mesh()], boardTop: integrated.boardTop, boardHalfExtent: H,
    boardFloorRectangles: integrated.boardFloorRectangles, boardHoleRectangles: [], boardFloorLayoutKey: integrated.boardFloorLayoutKey,
    pieceMeshes: new Map(), breakableWallMeshes: new Map(), controls: { enabled: true } };
  scene.boardMesh = scene.boardMeshes[0];
  scene.scene.add(scene.boardMesh);
  for (const piece of integrated.pieces.values()) {
    const mesh = new Mesh();
    mesh.name = piece.instance.id;
    scene.pieceMeshes.set(piece.instance.id, mesh);
    scene.scene.add(mesh);
  }
  assert.equal(maps.getHotseatMapDefinition(map.id), map);
  const reset = definition => {
    maps.disposeHotseatMap(integrated, scene);
    physics.rebuildPhysicsBoard(integrated, meta, H, options);
    physics.resetPhysicsPieces(integrated, meta, definition.spawns.map(spawn => spawn.instance), options);
    maps.installHotseatMap(integrated, scene, definition, meta);
    physics.validateSpawnOverlaps(integrated, meta, false);
    physics.preSettlePhysics(integrated);
  };
  for (let restart = 0; restart < 20; restart++) {
    reset(map);
    assert.equal(integrated.world.bodies.len(), 19);
    assert.equal(integrated.world.colliders.len(), 19);
    assert.equal(integrated.world.impulseJoints.len(), 1);
    assert.equal(scene.scene.children.filter(mesh => mesh.name.startsWith("map-")).length, 1);
  }
  const liveGate = integrated.hotseatMap.dynamicObjects.get("gate-main");
  const liveTurn = turn.createTurnRuntime(integrated, scene, tuning.createDefaultRuntimeTuningSettings());
  liveGate.body.setAngvel({ x: 0, y: .08, z: 0 }, true);
  assert.equal(maps.isMapObjectSlow(liveGate), false, "문 끝이 움직이는데 각속도만 보고 정지로 판정했습니다.");
  liveTurn.phase = "settling";
  for (let step = 0; step < 40; step++) turn.updateTurnAfterStep(liveTurn, config.FIXED_STEP);
  assert.equal(liveTurn.phase, "settling", "문 끝이 움직이는 중 턴이 끝났습니다.");
  assert.ok(maps.collectHotseatGroundedIds(integrated).has("object:gate-main"), "고정 축 관절이 문 지지로 인정되지 않았습니다.");
  liveGate.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  liveGate.body.sleep();
  liveTurn.phase = "ready";
  const livePawn = integrated.pieces.get("white-pawn-center");
  place(livePawn, .68, -.58);
  const com = livePawn.body.worldCom();
  let settlements = 0, contactSeen = false, movingSteps = 0, launchSteps = 0;
  liveTurn.onTurnSettled = () => { assert.ok(maps.areHotseatObjectsAtRest(integrated)); settlements++; };
  assert.ok(turn.queueTurnLaunch(liveTurn, {
    pieceId: livePawn.instance.id,
    direction: new Vector3(0, 0, 1),
    normalizedPower: 3 / config.MAX_LAUNCH_SPEED,
    applicationPoint: new Vector3(com.x, com.y, com.z),
  }).accepted);
  while (liveTurn.phase === "settling" && launchSteps < 1800) {
    turn.applyPendingLaunchBeforeStep(liveTurn);
    integrated.world.step();
    maps.synchronizeHotseatMapMeshes(integrated);
    contactSeen ||= touching(integrated.world, livePawn.collider, liveGate.collider);
    const moving = !maps.areHotseatObjectsAtRest(integrated);
    if (moving) movingSteps++;
    turn.updateTurnAfterStep(liveTurn, config.FIXED_STEP);
    if (moving) assert.equal(liveTurn.phase, "settling", "문 회전 중 다음 턴으로 넘어갔습니다.");
    assert.ok(liveGate.mesh.position.distanceTo(new Vector3(...Object.values(liveGate.body.translation()))) < 1e-7);
    const rotation = liveGate.body.rotation();
    assert.ok(["x", "y", "z", "w"].every(axis => Math.abs(liveGate.mesh.quaternion[axis] - rotation[axis]) < 1e-7));
    launchSteps++;
  }
  assert.ok(contactSeen && movingSteps > 0, "실제 승인 발사가 회전문과 충돌하지 않았습니다.");
  assert.equal(settlements, 1);
  assert.equal(liveTurn.currentSide, "black");
  assert.equal(liveTurn.phase, "ready");
  assert.equal(liveTurn.forcedSettleCount, 0);

  reset(maps.getHotseatMapDefinition("gm-push-blocks-v1"));
  assert.equal(integrated.world.impulseJoints.len(), 0);
  assert.equal(integrated.hotseatMap.dynamicObjects.size, 2);
  assert.equal(integrated.world.bodies.len(), 19);
  reset(maps.getHotseatMapDefinition("gm-ice-lane-v1"));
  assert.equal(integrated.world.impulseJoints.len(), 0);
  assert.equal(integrated.hotseatMap.dynamicObjects.size, 0);
  assert.equal(integrated.world.bodies.len(), 17);
  assert.equal(integrated.boardColliders.length, 3);
  assert.ok(integrated.boardColliders.some(collider => surface.getBoardSurfaceId(collider) === "ice-center" && Math.abs(collider.friction() - .005) < 1e-6));
  reset(map);
  assert.equal(integrated.world.impulseJoints.len(), 1);
  assert.equal(integrated.boardColliders.length, 1);
  assert.ok(integrated.boardColliders.every(collider => surface.getBoardSurfaceId(collider) === undefined));
  maps.disposeHotseatMap(integrated, scene);
  physics.rebuildPhysicsBoard(integrated, meta, config.deriveBoardHalfExtent(meta.cellSize), options);
  physics.resetPhysicsPieces(integrated, meta, layout.PIECE_INSTANCES, options);
  assert.equal(integrated.hotseatMap, undefined);
  assert.equal(integrated.world.impulseJoints.len(), 0);
  assert.equal(integrated.world.bodies.len(), 33);
  integrated.world.free();
  console.log(`G03 실제 설치·사전 정착·승인 발사·턴 정착 통과: ${launchSteps} step, 문 이동 ${movingSteps} step, 정산 ${settlements}회; 20회 재시작·G01/G02/기본맵 복귀 누수 없음`);
} finally {
  await vite.close();
}
