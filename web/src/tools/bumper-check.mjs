import "./headless-browser-env.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Mesh, Scene, Vector3 } from "three";
import { createServer } from "vite";

const vite = await createServer({ root: fileURLToPath(new URL("../..", import.meta.url)), configFile: false, logLevel: "error", appType: "custom", server: { middlewareMode: true, hmr: false, ws: false } });
const worlds = [];
const hasContact = (world, a, b) => {
  let contact = false;
  world.contactPair(a, b, manifold => { contact ||= manifold.numSolverContacts() > 0; });
  return contact;
};
try {
  const [physics, config, factory, definitions, maps, turn, tuning] = await Promise.all([
    "physics", "config", "maps/static-box", "maps/g04", "maps/hotseat-map-runtime", "turn", "tuning",
  ].map(name => vite.ssrLoadModule(`/src/${name}.ts`)));
  const meta = JSON.parse(await readFile(new URL("../../public/assets/chess-set.meta.json", import.meta.url), "utf8"));
  const map = definitions.G04_MAP;
  const H = config.deriveBoardHalfExtent(meta.cellSize) * map.boardScale;
  const options = { gameMode: "hotseat", stageNumber: 1 };
  const spawnFor = type => map.spawns.find(spawn => spawn.instance.type === type && spawn.instance.side === "white");
  const reference = await physics.createPhysicsRuntime(meta, [spawnFor("Pawn").instance], H, options);
  const pawnMass = reference.pieces.values().next().value.body.mass();
  reference.world.free();
  const contextFor = runtime => ({ world: runtime.world, boardTop: runtime.boardTop, cellSize: meta.cellSize, halfExtent: H, pawnMass, friction: config.getPieceFriction("hotseat") });
  async function create(instances = []) {
    const runtime = await physics.createPhysicsRuntime(meta, instances, H, options);
    worlds.push(runtime.world);
    return runtime;
  }
  function place(piece, x, z, velocity = { x: 0, y: 0, z: 0 }, elevation = 0) {
    piece.body.setTranslation({ x, y: piece.spawnTranslation.y + elevation, z }, true);
    piece.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    piece.body.setLinvel(velocity, true);
    piece.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    piece.body.enableCcd(true);
  }
  function sceneFor(runtime) {
    const scene = new Scene();
    return { scene, pieceMeshes: new Map([...runtime.pieces.values()].map(piece => [piece.instance.id, new Mesh()])), breakableWallMeshes: new Map(), controls: { enabled: true } };
  }
  // The shared runtime owns these factory bindings, including static bodies.
  function install(runtime, scene) {
    const objects = map.objects.map(definition => factory.createHotseatStaticBox(definition, contextFor(runtime)));
    runtime.hotseatMap = { definition: map, dynamicObjects: new Map(objects.map(object => [object.definition.id, object])), fallenObjectIds: new Set() };
    scene.scene.add(...objects.map(object => object.mesh));
    return objects;
  }
  const reuse = await create(map.spawns.map(spawn => spawn.instance));
  for (const spawn of map.spawns) {
    const piece = reuse.pieces.get(spawn.instance.id);
    piece.spawnTranslation = { x: -spawn.u * H, y: piece.spawnTranslation.y, z: spawn.v * H };
    piece.body.setTranslation(piece.spawnTranslation, true);
  }
  const scene = sceneFor(reuse);
  const baseline = [reuse.world.bodies.len(), reuse.world.colliders.len(), reuse.world.impulseJoints.len(), scene.scene.children.length];
  let spawnDrift = 0;
  for (let cycle = 0; cycle < 20; cycle++) {
    const objects = install(reuse, scene);
    assert.deepEqual([reuse.world.bodies.len(), reuse.world.colliders.len(), reuse.world.impulseJoints.len()], [baseline[0] + 3, baseline[1] + 3, baseline[2]]);
    for (const object of objects) {
      assert.ok(object.body.isFixed());
      assert.ok(Math.abs(object.collider.restitution() - (object.definition.kind === "bumper" ? .9 : config.PIECE_RESTITUTION)) < 1e-6);
      assert.equal(object.mesh.geometry.parameters.width, object.definition.widthH * H);
      assert.equal(object.mesh.geometry.parameters.height, object.definition.heightCells * meta.cellSize);
    }
    physics.preSettlePhysics(reuse);
    for (let step = 0; step < (cycle === 0 ? 1200 : 1); step++) {
      reuse.world.step();
      for (const piece of reuse.pieces.values()) {
        assert.ok(objects.every(object => !hasContact(reuse.world, piece.collider, object.collider)), `초기 기물이 장애물과 겹칩니다: ${piece.instance.id}`);
        const p = piece.body.translation();
        assert.ok(p.y > config.FALL_OUT_Y);
        spawnDrift = Math.max(spawnDrift, Math.hypot(p.x - piece.spawnTranslation.x, p.z - piece.spawnTranslation.z));
      }
    }
    let geometryDisposals = 0, materialDisposals = 0;
    for (const object of objects) object.mesh.traverse(mesh => {
      if (!(mesh instanceof Mesh)) return;
      mesh.geometry.addEventListener("dispose", () => geometryDisposals++);
      for (const material of new Set(Array.isArray(mesh.material) ? mesh.material : [mesh.material])) material.addEventListener("dispose", () => materialDisposals++);
    });
    maps.disposeHotseatMap(reuse, scene);
    assert.deepEqual([reuse.world.bodies.len(), reuse.world.colliders.len(), reuse.world.impulseJoints.len(), scene.scene.children.length], baseline);
    assert.ok(geometryDisposals === 15 && materialDisposals >= 15, "고정 객체의 geometry/material이 정리되지 않았습니다.");
  }
  assert.ok(spawnDrift < .01, `시작 배치 드리프트: ${spawnDrift}`);

  const padDefinition = map.objects[0];
  const padFace = (.72 - .08 / 2) * H;
  const radius = type => meta.pieces[type].bounds.x / 2;
  const reflection = [];
  for (const kind of ["box", "bumper"]) {
    const runtime = await create([spawnFor("Pawn").instance]);
    const piece = runtime.pieces.values().next().value;
    factory.createHotseatStaticBox({ ...padDefinition, kind, restitution: kind === "box" ? undefined : .9 }, contextFor(runtime));
    // Constrain rotation only in the material comparison so toppling cannot
    // trade translational speed for spin differently across the two surfaces.
    piece.body.lockRotations(true, true);
    place(piece, padFace - radius("Pawn") - .3, 0, { x: 4, y: 0, z: 0 });
    let before = 0, after = 0;
    for (let step = 0; step < 120; step++) {
      const velocity = piece.body.linvel().x;
      runtime.world.step();
      if (velocity > 0 && piece.body.linvel().x < 0) { before = velocity; after = -piece.body.linvel().x; break; }
    }
    assert.ok(before > 0 && after > 0, `반사 실패: ${kind}`);
    reflection.push({ kind, before, after, ratio: after / before });
  }
  assert.ok(reflection[1].after > reflection[0].after * 1.5, `반발 차이가 없습니다: ${JSON.stringify(reflection)}`);

  const idle = await create([spawnFor("Pawn").instance]);
  const idlePawn = idle.pieces.values().next().value;
  const idlePad = factory.createHotseatStaticBox(padDefinition, contextFor(idle));
  place(idlePawn, padFace - meta.pieces.Pawn.baseRadius, 0);
  // Let the contact solver remove the placement tolerance before measuring
  // resting contact; its initial penetration correction is not propulsion.
  for (let step = 0; step < 240; step++) idle.world.step();
  let idleMaxSpeed = 0;
  for (let step = 0; step < 1200; step++) {
    idle.world.step();
    const v = idlePawn.body.linvel();
    idleMaxSpeed = Math.max(idleMaxSpeed, Math.hypot(v.x, v.z));
  }
  assert.ok(idlePawn.body.isSleeping() && idleMaxSpeed < .05, `정지 접촉이 가속합니다: ${idleMaxSpeed}`);
  assert.ok(idlePad.body.isFixed());

  const corridor = await create([spawnFor("Pawn").instance]);
  const corridorPawn = corridor.pieces.values().next().value;
  const corridorObjects = install(corridor, sceneFor(corridor));
  place(corridorPawn, 0, .21 * H, { x: 6, y: 0, z: 0 });
  corridorPawn.body.lockRotations(true, true);
  const pads = corridorObjects.filter(object => object.definition.kind === "bumper");
  let corridorContacts = 0, corridorMaxSpeed = 0;
  let previousContacts = new Set();
  for (let step = 0; step < 1200; step++) {
    corridor.world.step();
    const contacts = new Set(pads.filter(pad => hasContact(corridor.world, corridorPawn.collider, pad.collider)).map(pad => pad.definition.id));
    for (const id of contacts) if (!previousContacts.has(id)) corridorContacts++;
    previousContacts = contacts;
    const p = corridorPawn.body.translation(), v = corridorPawn.body.linvel();
    assert.ok([p.x, p.y, p.z, v.x, v.y, v.z].every(Number.isFinite));
    corridorMaxSpeed = Math.max(corridorMaxSpeed, Math.hypot(v.x, v.z));
  }
  assert.ok(corridorContacts >= 2 && corridorMaxSpeed <= 6.01, `패드 반복 반사 실패: ${JSON.stringify({ corridorContacts, corridorMaxSpeed })}`);

  const stresses = [];
  for (const type of ["Rook", "Queen", "Bishop", "Knight"]) {
    const runtime = await create([spawnFor(type).instance]);
    const piece = runtime.pieces.values().next().value;
    const pad = factory.createHotseatStaticBox(padDefinition, contextFor(runtime));
    // A descending Knight overlaps the exposed face instead of clearing the pad.
    const speed = Math.max(8, config.getMaxLaunchSpeed("hotseat", type) * 2);
    place(piece, padFace - radius(type) - .3, 0, { x: speed, y: type === "Knight" ? -3 : 0, z: 0 }, type === "Knight" ? .08 : 0);
    if (type === "Bishop") piece.body.setAngvel({ x: 0, y: 15, z: 0 }, true);
    let hit = false, reflected = false, overflight = false, crossed = false, maxSpeed = 0;
    for (let step = 0; step < 120; step++) {
      runtime.world.step();
      const p = piece.body.translation(), v = piece.body.linvel();
      hit ||= hasContact(runtime.world, piece.collider, pad.collider);
      reflected ||= v.x < -.1;
      maxSpeed = Math.max(maxSpeed, Math.hypot(v.x, v.y, v.z));
      assert.ok([p.x, p.y, p.z, v.x, v.y, v.z].every(Number.isFinite));
      if (!crossed && p.x >= padFace + padDefinition.widthH * H) {
        const q = piece.body.rotation();
        const minimumY = Math.min(...meta.pieces[type].colliderPoints.map(point =>
          new Vector3(...point).multiplyScalar(piece.uniformScale).applyQuaternion(q).y + p.y));
        assert.ok(minimumY > runtime.boardTop + padDefinition.heightCells * meta.cellSize - .01, `${type}가 범퍼를 관통했습니다: x=${p.x}, bottom=${minimumY}`);
        overflight = true;
        crossed = true;
      }
    }
    assert.ok(hit && (reflected || overflight) && maxSpeed < speed * 1.5, `${type} 고속 접촉 실패: ${JSON.stringify({ hit, reflected, overflight, maxSpeed })}`);
    stresses.push({ type, speed, hit, reflected, overflight, maxSpeed });
  }

  // The initial 16-piece map permits a left Pawn to attack the opposite Pawn
  // via the left pad. No spawn is moved and no extra bounce impulse is injected.
  const attackerSpawn = map.spawns.find(spawn => spawn.instance.id === "white-pawn-left");
  const targetSpawn = map.spawns.find(spawn => spawn.instance.id === "black-pawn-right");
  const indirect = await create(map.spawns.map(spawn => spawn.instance));
  const indirectScene = sceneFor(indirect);
  install(indirect, indirectScene);
  const attacker = indirect.pieces.get(attackerSpawn.instance.id);
  const target = indirect.pieces.get(targetSpawn.instance.id);
  for (const spawn of map.spawns) {
    const piece = indirect.pieces.get(spawn.instance.id);
    piece.spawnTranslation = { x: -spawn.u * H, y: piece.spawnTranslation.y, z: spawn.v * H };
    piece.body.setTranslation(piece.spawnTranslation, true);
  }
  physics.preSettlePhysics(indirect);
  const start = { ...attacker.body.translation() }, targetStart = { ...target.body.translation() };
  const impactX = padFace - meta.pieces.Pawn.baseRadius;
  const mirroredTargetX = 2 * impactX - targetStart.x;
  const direction = new Vector3(mirroredTargetX - start.x, 0, targetStart.z - start.z).normalize();
  const launch = turn.createTurnRuntime(indirect, indirectScene, tuning.createDefaultRuntimeTuningSettings());
  launch.phase = "ready";
  launch.currentSide = "white";
  const launchPower = .35;
  const center = attacker.body.worldCom();
  const request = { pieceId: attacker.instance.id, direction, applicationPoint: new Vector3(center.x, center.y, center.z), normalizedPower: launchPower };
  assert.ok(turn.queueTurnLaunch(launch, request).accepted);
  assert.ok(turn.applyPendingLaunchBeforeStep(launch));
  const expectedSpeed = launchPower * config.getMaxLaunchSpeed("hotseat", "Pawn", launch.tuningSettings.maxLaunchSpeed);
  assert.ok(Math.abs(launch.lastLaunchInitialSpeed - expectedSpeed) < 1e-5, "표시 세기와 실제 발사 속도가 다릅니다.");
  const pad = indirect.hotseatMap.dynamicObjects.get("bumper-left");
  let padContact = false, targetContact = false, displacement = 0;
  for (let step = 0; step < 960; step++) {
    indirect.world.step();
    padContact ||= hasContact(indirect.world, attacker.collider, pad.collider);
    if (padContact) targetContact ||= hasContact(indirect.world, attacker.collider, target.collider);
    const p = target.body.translation();
    displacement = Math.max(displacement, Math.hypot(p.x - targetStart.x, p.z - targetStart.z));
    turn.updateTurnAfterStep(launch, config.FIXED_STEP);
    if (targetContact && displacement > .05) break;
  }
  assert.ok(padContact && targetContact && displacement > .05, `범퍼 경유 공격 실패: ${JSON.stringify({ padContact, targetContact, displacement, direction })}`);
  console.log(JSON.stringify({ mapId: map.id, revision: map.revision, H, restartCycles: 20, staticBodies: 3, spawnDrift, reflection, idleMaxSpeed, repeatedPads: { corridorContacts, corridorMaxSpeed }, stresses, indirect: { start, targetStart, direction, launchPower, expectedSpeed, actualSpeed: launch.lastLaunchInitialSpeed, padContact, targetContact, displacement } }, null, 2));
  console.log("PASS G04: 고정 객체/20회 정리, 반발 비교/정지 접촉, 고속/회전/착지, 실제 반사 공격");
} finally {
  for (const world of worlds) world.free();
  await vite.close();
}
