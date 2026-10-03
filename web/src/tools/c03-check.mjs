import "./headless-browser-env.mjs";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Mesh, Scene, Vector3 } from "three";
import { createServer } from "vite";

const vite = await createServer({ root: fileURLToPath(new URL("../..", import.meta.url)), configFile: false,
  logLevel: "error", appType: "custom", server: { middlewareMode: true, hmr: false, ws: false } });
const worlds = new Set();
const contact = (world, a, b) => {
  let touching = false;
  world.contactPair(a, b, manifold => { touching ||= manifold.numSolverContacts() > 0; });
  return touching;
};
const info = console.info;
console.info = () => {};
try {
  const [physics, maps, definition, ramp, stage, config, turn, tuning, layout] = await Promise.all([
    "physics", "maps/hotseat-map-runtime", "maps/c03", "maps/ramp", "stage", "config", "turn", "tuning", "layout",
  ].map(name => vite.ssrLoadModule(`/src/${name}.ts`)));
  const meta = JSON.parse(await readFile(new URL("../../public/assets/chess-set.meta.json", import.meta.url), "utf8"));
  const map = definition.C03_MAP;
  const H = stage.computeStageBoardHalfExtent(meta.cellSize, "stage", 2);
  const options = { gameMode: "hotseat", stageNumber: 1 };
  const results = { mapId: map.id, revision: map.revision, H };
  function sceneFor(runtime) {
    const scene = new Scene();
    const pieceMeshes = new Map([...runtime.pieces.values()].map(piece => {
      const mesh = new Mesh(); scene.add(mesh); return [piece.instance.id, mesh];
    }));
    return { scene, pieceMeshes, breakableWallMeshes: new Map(), controls: { enabled: true } };
  }
  async function create() {
    const runtime = await physics.createPhysicsRuntime(meta, map.spawns.map(spawn => spawn.instance), H, options);
    worlds.add(runtime.world);
    const scene = sceneFor(runtime);
    maps.installHotseatMap(runtime, scene, map, meta);
    runtime.world.propagateModifiedBodyPositionsToColliders();
    return { runtime, scene };
  }
  function close({ runtime, scene }) {
    maps.disposeHotseatMap(runtime, scene);
    runtime.world.free(); worlds.delete(runtime.world);
  }
  function minimumY(piece) {
    const p = piece.body.translation(), q = piece.body.rotation();
    return p.y + Math.min(...meta.pieces[piece.instance.type].colliderPoints.map(point =>
      new Vector3(...point).multiplyScalar(piece.uniformScale).applyQuaternion(q).y));
  }
  const initial = await create();
  const objects = [...initial.runtime.hotseatMap.dynamicObjects.values()];
  const all = [...initial.runtime.pieces.values(), ...objects];
  const penetrations = [];
  for (let a = 0; a < all.length; a++) for (let b = a + 1; b < all.length; b++) {
    if (all[a].body.isFixed() && all[b].body.isFixed()) continue;
    const overlap = all[a].collider.contactCollider(all[b].collider, 0);
    if (overlap?.distance < -.0001) penetrations.push({ left: all[a].instance?.id ?? all[a].definition.id,
      right: all[b].instance?.id ?? all[b].definition.id, distance: overlap.distance });
  }
  assert.equal(penetrations.length, 0, `spawn hull penetration: ${JSON.stringify(penetrations)}`);
  physics.validateSpawnOverlaps(initial.runtime, meta, false);
  for (const object of objects) {
    assert(object.body.isFixed());
    if (object.definition.kind === "ramp") {
      const shape = ramp.computeHotseatRampShape(object.definition, H);
      assert.deepEqual([...object.mesh.geometry.getAttribute("position").array], [...shape.vertices]);
      assert.deepEqual([...object.collider.shape.vertices], [...shape.vertices]);
      assert(Math.abs(object.collider.friction() - .45) < 1e-6);
    } else {
      assert.equal(object.mesh.geometry.parameters.width, object.definition.widthH * H);
      assert.equal(object.mesh.geometry.parameters.depth, object.definition.depthH * H);
      assert(Math.abs(object.collider.restitution() - .9) < 1e-6);
    }
  }
  physics.preSettlePhysics(initial.runtime);
  for (let step = 0; step < 1200; step++) initial.runtime.world.step();
  let spawnDrift = 0;
  for (const piece of initial.runtime.pieces.values()) {
    const p = piece.body.translation();
    assert(piece.body.isSleeping() && p.y > config.FALL_OUT_Y, `${piece.instance.id} idle moved/fell`);
    spawnDrift = Math.max(spawnDrift, Math.hypot(p.x - piece.spawnTranslation.x, p.z - piece.spawnTranslation.z));
  }
  assert(spawnDrift < .01);
  results.spawn = { pieces: 16, hullPenetrations: 0, idleSeconds: 10, spawnDrift };
  console.log("PASS C03: 16 real hull spawns, fixed objects/render match, 10 second idle");
  close(initial);

  async function launchShot({ pieceId = "white-pawn-center", x = 1.1, z = 1, power = .45, steps = 1200 }) {
    const fixture = await create();
    const { runtime, scene } = fixture;
    physics.preSettlePhysics(runtime);
    const piece = runtime.pieces.get(pieceId);
    const start = { ...piece.body.translation() };
    const launch = turn.createTurnRuntime(runtime, scene, tuning.createDefaultRuntimeTuningSettings());
    launch.phase = "ready"; launch.currentSide = piece.instance.side;
    const direction = new Vector3(x, 0, z).normalize();
    const request = { pieceId, direction, normalizedPower: power, applicationPoint: new Vector3().copy(piece.body.worldCom()) };
    assert(turn.queueTurnLaunch(launch, request).accepted);
    assert(turn.applyPendingLaunchBeforeStep(launch));
    let rampStep = null, airborneStep = null, padStep = null, padId = null, padNormal = null, padContactY = null, padAirborne = false, maxSpeed = 0, maxY = start.y,
      minPadDistance = 0, reflected = false, targetContact = false, targetDisplacement = 0;
    const target = runtime.pieces.get(piece.instance.side === "white" ? "black-pawn-left" : "white-pawn-left");
    const targetStart = { ...target.body.translation() };
    const events = [];
    for (let step = 0; step < steps; step++) {
      runtime.world.step();
      const p = piece.body.translation(), v = piece.body.linvel(), q = piece.body.rotation();
      assert([p.x, p.y, p.z, v.x, v.y, v.z, q.x, q.y, q.z, q.w].every(Number.isFinite));
      maxSpeed = Math.max(maxSpeed, Math.hypot(v.x, v.y, v.z)); maxY = Math.max(maxY, p.y);
      const contacts = [...runtime.hotseatMap.dynamicObjects.values()].filter(object => contact(runtime.world, piece.collider, object.collider));
      if (rampStep === null && contacts.some(object => object.definition.kind === "ramp")) { rampStep = step; events.push({ kind: "ramp", step, position: { ...p } }); }
      const supported = runtime.boardColliders.some(collider => contact(runtime.world, piece.collider, collider)) || contacts.some(object => object.definition.kind === "ramp");
      const beyondHighEdge = piece.instance.side === "white" ? p.z > -.14 * H + .03 : p.z < .14 * H - .03;
      if (rampStep !== null && airborneStep === null && beyondHighEdge && !supported && minimumY(piece) > runtime.boardTop + .025) {
        airborneStep = step; events.push({ kind: "airborne", step, position: { ...p }, bottomY: minimumY(piece) });
      }
      for (const object of runtime.hotseatMap.dynamicObjects.values()) {
        if (object.definition.kind !== "bumper") continue;
        const overlap = piece.collider.contactCollider(object.collider, 0);
        if (overlap) minPadDistance = Math.min(minPadDistance, overlap.distance);
        if (padStep === null && contact(runtime.world, piece.collider, object.collider)) {
          padStep = step; padId = object.definition.id;
          runtime.world.contactPair(piece.collider, object.collider, manifold => { if (manifold.numSolverContacts()) {
            padNormal = { ...manifold.normal() }; padContactY = manifold.solverContactPoint(0).y;
          } });
          padAirborne = !runtime.boardColliders.some(collider => contact(runtime.world, piece.collider, collider));
          events.push({ kind: "pad", step, id: padId, position: { ...p }, bottomY: minimumY(piece), normal: padNormal });
        }
      }
      if (padStep !== null && v.x * direction.x < -.1) reflected = true;
      targetContact ||= contact(runtime.world, piece.collider, target.collider);
      const t = target.body.translation();
      targetDisplacement = Math.max(targetDisplacement, Math.hypot(t.x - targetStart.x, t.z - targetStart.z));
      if (p.y < config.FALL_OUT_Y) break;
    }
    const result = { pieceId, start, direction: { x: direction.x, z: direction.z }, power,
      launchSpeed: launch.lastLaunchInitialSpeed, rampStep, airborneStep, padStep, padId, padNormal, padContactY, padAirborne, reflected,
      maxSpeed, maxY, minPadDistance, targetContact, targetDisplacement, end: { ...piece.body.translation() }, events };
    close(fixture);
    return result;
  }
  results.combination = [];
  for (const side of ["white", "black"]) {
    const sign = side === "white" ? 1 : -1;
    const shot = await launchShot({ pieceId: `${side}-pawn-center`, x: sign * 1.1, z: sign, power: .45 });
    assert(shot.rampStep !== null && shot.airborneStep > shot.rampStep && shot.padStep > shot.airborneStep && shot.reflected,
      `${side} ramp→airborne→pad reflection failed: ${JSON.stringify(shot)}`);
    assert(shot.padAirborne && Math.abs(shot.padNormal.y) > .5, "Expected airborne contact on the bumper upper corner");
    const padTop = meta.cellSize * .55;
    assert(Math.abs(shot.padContactY - padTop) < .025, `Contact missed pad top edge: ${shot.padContactY}, ${padTop}`);
    assert(shot.maxSpeed <= shot.launchSpeed * 1.15 && shot.minPadDistance > -.06, "Upper pad contact caused speed blowup/penetration");
    assert(Math.abs(shot.launchSpeed - config.getMaxLaunchSpeed("hotseat", "Pawn") * shot.power) < 1e-5);
    results.combination.push(shot);
  }
  console.log("PASS C03: both real 16-piece launch paths ramp→airborne beyond high edge→upper bumper corner→reflection, bounded speed");
  const alternative = await launchShot({ pieceId: "white-pawn-right", x: 0, power: .4 });
  assert(alternative.rampStep === null && alternative.padStep === null && alternative.targetContact && alternative.targetDisplacement > .05,
    `Ordinary alternative attack failed: ${JSON.stringify(alternative)}`);
  results.alternative = alternative;
  console.log("PASS C03: original right Pawn has an ordinary route to push the opposing Pawn without ramp/pad contact");

  const reuse = await create();
  const settings = tuning.createDefaultRuntimeTuningSettings();
  const tuningRuntime = { physicsRuntime: reuse.runtime, settings, localSettings: { ...settings }, controls: new Map(),
    panel: { querySelector: () => null }, storage: null, storageNotice: {}, onlineNotice: {}, onlineDefaultsActive: false };
  for (let cycle = 0; cycle < 20; cycle++) {
    let geometryDisposals = 0, materialDisposals = 0;
    for (const object of reuse.runtime.hotseatMap.dynamicObjects.values()) object.mesh.traverse(mesh => {
      if (!(mesh instanceof Mesh)) return;
      mesh.geometry.addEventListener("dispose", () => geometryDisposals++);
      for (const material of new Set(Array.isArray(mesh.material) ? mesh.material : [mesh.material])) material.addEventListener("dispose", () => materialDisposals++);
    });
    maps.disposeHotseatMap(reuse.runtime, reuse.scene);
    assert.deepEqual([reuse.runtime.world.bodies.len(), reuse.runtime.world.colliders.len(), reuse.runtime.world.impulseJoints.len()], [17, 17, 0]);
    assert.equal(reuse.scene.scene.children.filter(mesh => mesh.name.startsWith("map-")).length, 0);
    assert.equal(geometryDisposals, 18); assert.equal(materialDisposals, 28);
    physics.rebuildPhysicsBoard(reuse.runtime, meta, H, options);
    physics.resetPhysicsPieces(reuse.runtime, meta, map.spawns.map(spawn => spawn.instance), options);
    maps.installHotseatMap(reuse.runtime, reuse.scene, map, meta);
    tuning.reapplyTuningPhysicsSettings(tuningRuntime);
    physics.preSettlePhysics(reuse.runtime);
    assert.deepEqual([reuse.runtime.world.bodies.len(), reuse.runtime.world.colliders.len(), reuse.runtime.world.impulseJoints.len()], [21, 21, 0]);
    assert.equal(reuse.scene.scene.children.filter(mesh => mesh.name.startsWith("map-")).length, 4);
    assert.equal(reuse.runtime.hotseatMap.fallenObjectIds.size, 0);
    for (const object of reuse.runtime.hotseatMap.dynamicObjects.values()) {
      assert(Math.abs(object.collider[object.definition.kind === "ramp" ? "friction" : "restitution"]() - (object.definition.kind === "ramp" ? .45 : .9)) < 1e-6);
    }
  }
  maps.disposeHotseatMap(reuse.runtime, reuse.scene);
  const classicH = config.deriveBoardHalfExtent(meta.cellSize);
  physics.rebuildPhysicsBoard(reuse.runtime, meta, classicH, options);
  physics.resetPhysicsPieces(reuse.runtime, meta, layout.PIECE_INSTANCES, options);
  assert.equal(reuse.runtime.hotseatMap, undefined);
  assert.equal(reuse.runtime.pieces.size, 32);
  assert.deepEqual([reuse.runtime.world.bodies.len(), reuse.runtime.world.colliders.len(), reuse.runtime.world.impulseJoints.len()], [33, 33, 0]);
  assert.equal(reuse.scene.scene.children.filter(mesh => mesh.name.startsWith("map-")).length, 0);
  results.cleanup = { restarts: 20, installedBodies: 21, installedColliders: 21, joints: 0, mapMeshes: 4,
    disposedGeometriesPerRestart: 18, materialDisposeEventsPerRestart: 28, classicPieces: 32, classicBodies: 33, classicColliders: 33 };
  console.log("PASS C03: 20 real rebuild/reset/install cycles, tuning preserves materials, all child resources disposed, classic32-piece physics restores cleanly");
  close(reuse);
  const reportArg = process.argv.indexOf("--report");
  if (reportArg >= 0) await writeFile(process.argv[reportArg + 1], JSON.stringify(results, null, 2) + "\n");
} finally {
  for (const world of worlds) world.free();
  console.info = info;
  await vite.close();
}
