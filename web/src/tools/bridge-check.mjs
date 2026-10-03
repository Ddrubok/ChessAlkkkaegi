import "./headless-browser-env.mjs";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Mesh, Scene, Vector3 } from "three";
import { createServer } from "vite";

const vite = await createServer({ root: fileURLToPath(new URL("../..", import.meta.url)), configFile: false, logLevel: "error", appType: "custom", server: { middlewareMode: true, hmr: false } });
const originalInfo = console.info;
console.info = () => {};
const fixtures = [];
const report = { mapId: "gm-breakable-bridge-v1", revision: 1 };
const originalCreateElement = document.createElement;
document.createElement = tag => tag !== "canvas" ? originalCreateElement(tag) : {
  width: 0, height: 0, getContext: () => new Proxy({}, { get: () => () => {}, set: () => true }),
};
try {
  const [physics, bridge, definition, surfaces, maps, stage, turnModule, tuning, config, collapse] = await Promise.all([
    "physics", "maps/breakable-bridge", "maps/g07", "maps/surface-materials", "maps/hotseat-map-runtime", "stage", "turn", "tuning", "config", "maps/collapsing-floor",
  ].map(name => vite.ssrLoadModule(`/src/${name}.ts`)));
  const RAPIER = (await import("@dimforge/rapier3d-compat")).default;
  const meta = JSON.parse(await readFile(new URL("../../public/assets/chess-set.meta.json", import.meta.url), "utf8"));
  const map = definition.G07_MAP, object = map.objects[0];
  const H = stage.computeStageBoardHalfExtent(meta.cellSize, "stage", 2);

  async function create(type = "Pawn", allSpawns = false, integrated = false) {
    const instances = allSpawns ? map.spawns.map(spawn => spawn.instance) : [{ id: `white-${type.toLowerCase()}`, type, side: "white", startingSquare: { file: "d", rank: 2 } }];
    const runtime = await physics.createPhysicsRuntime(meta, instances, H, { gameMode: "hotseat", stageNumber: 1 });
    const scene = { scene: new Scene(), pieceMeshes: new Map(), breakableWallMeshes: new Map(), controls: { enabled: true } };
    for (const piece of runtime.pieces.values()) scene.pieceMeshes.set(piece.instance.id, new Mesh());
    let binding;
    if (integrated) {
      const board = new Mesh(); scene.scene.add(board);
      Object.assign(scene, { boardMeshes: [board], boardMesh: board, boardHalfExtent: H, boardTop: runtime.boardTop,
        boardFloorRectangles: runtime.boardFloorRectangles, boardHoleRectangles: runtime.boardHoleRectangles, boardFloorLayoutKey: runtime.boardFloorLayoutKey });
      maps.installHotseatMap(runtime, scene, map, meta);
      binding = runtime.hotseatMap.dynamicObjects.get(object.id);
    } else {
      runtime.hotseatMap = { definition: map, dynamicObjects: new Map(), fallenObjectIds: new Set() };
      runtime.hotseatMap.disposeSurfaces = surfaces.installHotseatMapPhysicsFloor(runtime, meta, surfaces.computeHotseatMapFloorLayout(map, H));
      binding = bridge.createHotseatBridge(object, { world: runtime.world, boardTop: runtime.boardTop, cellSize: meta.cellSize, halfExtent: H, pawnMass: runtime.pieces.values().next().value.body.mass(), friction: config.getPieceFriction("hotseat") });
      runtime.hotseatMap.dynamicObjects.set(object.id, binding);
      scene.scene.add(binding.mesh);
    }
    for (const spawn of allSpawns ? map.spawns : []) {
      const piece = runtime.pieces.get(spawn.instance.id);
      piece.body.setTranslation({ ...piece.spawnTranslation, x: -spawn.u * H, z: spawn.v * H }, true);
    }
    const turn = turnModule.createTurnRuntime(runtime, scene, tuning.createDefaultRuntimeTuningSettings(), meta.cellSize);
    const fixture = { runtime, scene, turn, binding, piece: runtime.pieces.values().next().value };
    fixtures.push(fixture);
    return fixture;
  }
  function step(fixture, count = 1) {
    for (let i = 0; i < count; i++) {
      bridge.beforeHotseatBridgeStep(fixture.turn);
      fixture.runtime.world.step();
      bridge.afterHotseatBridgeStep(fixture.turn);
    }
  }
  function close(fixture) {
    maps.disposeHotseatMap(fixture.runtime, fixture.scene);
    fixture.runtime.world.free();
    fixtures.splice(fixtures.indexOf(fixture), 1);
  }
  // Block probes isolate collision rules inside an explicitly recorded launch interval.
  function active(fixture) { fixture.turn.phase = "settling"; fixture.turn.pendingTurnChange = true; collapse.noteAppliedHotseatLaunch(fixture.turn); }
  function targetPosition(index = 0) { return { x: -object.supports[index].u * H, z: 0 }; }
  function syntheticAttacker(fixture, { width = 0.04, index = 0, z = -0.1, speed = 3, id = "probe" } = {}) {
    const p = targetPosition(index);
    const body = fixture.runtime.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(width > .3 ? 0 : p.x, fixture.runtime.boardTop + meta.cellSize * .18, z).setGravityScale(0).setCcdEnabled(true));
    const collider = fixture.runtime.world.createCollider(RAPIER.ColliderDesc.cuboid(width / 2, meta.cellSize * .05, meta.cellSize * .04).setMass(.1), body);
    const binding = { definition: { kind: "block", id }, body, collider, mesh: new Mesh() };
    fixture.runtime.hotseatMap.dynamicObjects.set(id, binding);
    body.setLinvel({ x: 0, y: 0, z: speed }, true);
    return binding;
  }
  function untilHit(fixture, hitCount, maximum = 120) {
    for (let i = 0; i < maximum; i++) {
      step(fixture);
      if (bridge.getHotseatBridgeState(fixture.binding).hitCount >= hitCount) return i + 1;
    }
    assert.fail(`Expected hit ${hitCount}, got ${JSON.stringify(bridge.getHotseatBridgeState(fixture.binding))}`);
  }

  const spawn = await create("Pawn", true);
  assert.equal(spawn.binding.body.numColliders(), 3);
  assert.equal(spawn.binding.additionalColliders.length, 2);
  assert(Math.abs(spawn.binding.collider.shape.halfExtents.z - .12 * H) < 1e-7);
  for (const rectangle of spawn.runtime.boardFloorRectangles) assert(!(rectangle.minX < .14 * H && rectangle.maxX > -.14 * H && rectangle.minZ < .12 * H && rectangle.maxZ > -.12 * H), "Normal floor remains below deck");
  spawn.runtime.world.propagateModifiedBodyPositionsToColliders();
  const actors = [...spawn.runtime.pieces.values()];
  for (let i = 0; i < actors.length; i++) for (let j = i + 1; j < actors.length; j++) {
    assert((actors[i].collider.contactCollider(actors[j].collider, 0)?.distance ?? 0) >= -.0001, "Spawn hulls overlap");
  }
  step(spawn, 1200);
  assert.equal(bridge.getHotseatBridgeState(spawn.binding).hitCount, 0);
  assert([...spawn.runtime.pieces.values()].every(piece => piece.body.isSleeping() && piece.body.translation().y > config.FALL_OUT_Y));
  report.spawn = { pieces: 16, idleSeconds: 10, hits: 0 };
  close(spawn);
  console.log("PASS G07: 16 hull spawns, 10-second idle, exact moat/deck partition and three colliders owned by one fixed body");

  const crossing = await create();
  crossing.piece.body.setTranslation({ x: 0, y: crossing.piece.spawnTranslation.y, z: -.3 * H }, true);
  step(crossing, 120);
  const request = { pieceId: crossing.piece.instance.id, direction: new Vector3(0, 0, 1), normalizedPower: .18, applicationPoint: new Vector3().copy(crossing.piece.body.worldCom()) };
  assert(turnModule.queueTurnLaunch(crossing.turn, request).accepted);
  assert(turnModule.applyPendingLaunchBeforeStep(crossing.turn));
  let touchedDeck = false, maxZ = crossing.piece.body.translation().z;
  for (let i = 0; i < 360; i++) {
    step(crossing);
    maxZ = Math.max(maxZ, crossing.piece.body.translation().z);
    crossing.runtime.world.contactPair(crossing.piece.collider, crossing.binding.collider, manifold => { touchedDeck ||= manifold.numSolverContacts() > 0; });
  }
  assert(touchedDeck && maxZ > .14 * H, `Actual Pawn launch failed to traverse deck, maxZ=${maxZ}`);
  assert.equal(bridge.getHotseatBridgeState(crossing.binding).hitCount, 0);
  assert(crossing.piece.body.translation().y > config.FALL_OUT_Y && maxZ < H, `Crossing probe left board: maxZ=${maxZ}, end=${JSON.stringify(crossing.piece.body.translation())}`);
  report.crossing = { normalizedPower: request.normalizedPower, maxZ, touchedDeck, hits: 0, end: crossing.piece.body.translation() };
  close(crossing);
  console.log("PASS G07: actual approved Pawn launch crosses bridge without damage");

  const strike = await create();
  strike.piece.body.setTranslation({ x: targetPosition().x, y: strike.piece.spawnTranslation.y, z: -.25 * H }, true);
  step(strike, 120);
  const strikeRequest = { pieceId: strike.piece.instance.id, direction: new Vector3(0, 0, 1), normalizedPower: .6, applicationPoint: new Vector3().copy(strike.piece.body.worldCom()) };
  assert(turnModule.queueTurnLaunch(strike.turn, strikeRequest).accepted);
  assert(turnModule.applyPendingLaunchBeforeStep(strike.turn));
  const strikeSteps = untilHit(strike, 1);
  report.supportStrike = { type: "Pawn", normalizedPower: .6, direction: [0, 0, 1], start: { x: targetPosition().x, z: -.25 * H }, strikeSteps, hits: 1 };
  close(strike);
  console.log("PASS G07: actual approved Pawn launch physically hits exposed support and consumes one hit");

  const hits = await create();
  active(hits);
  const probe = syntheticAttacker(hits, { z: -.12 * H, speed: 2 });
  untilHit(hits, 1);
  assert.equal(bridge.getHotseatBridgeState(hits.binding).hitCount, 1);
  const cracks = [];
  hits.binding.mesh.traverse(child => { if (child.name.startsWith("bridge-crack-")) cracks.push(child); });
  assert.equal(cracks.length, 4);
  assert(cracks.every(crack => crack.visible), "First hit does not expose shared support cracks");
  for (const target of object.supports) assert.equal(hits.binding.mesh.getObjectByName(target.id).material.color.getHex(), 0xb45939);
  // Hold the same solver contact while approaching again: this is not a new hit.
  const contactPosition = { ...probe.body.translation() };
  for (let i = 0; i < 30; i++) {
    probe.body.setTranslation(contactPosition, true);
    probe.body.setLinvel({ x: 0, y: 0, z: 2 }, true);
    step(hits);
  }
  assert.equal(bridge.getHotseatBridgeState(hits.binding).hitCount, 1);
  probe.body.setTranslation({ ...contactPosition, z: -.25 * H }, true);
  probe.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  step(hits, 2);
  probe.body.setLinvel({ x: 0, y: 0, z: 3 }, true);
  untilHit(hits, 2);
  assert(bridge.getHotseatBridgeState(hits.binding).pendingDestruction && hits.binding.body.isValid(), "Second collision removed bridge in the solver step");
  step(hits);
  assert(!hits.binding.body.isValid() && bridge.getHotseatBridgeState(hits.binding).destroyed);
  report.contactRules = { persistentContactHits: 1, separatedRecontactHits: 2, nextStepRemoved: true };
  close(hits);
  console.log("PASS G07: new hit, continuous contact suppression, separated recontact, second-hit removal on next step");

  const wide = await create();
  active(wide);
  syntheticAttacker(wide, { width: .5 * H, z: -.12 * H, speed: 2 });
  untilHit(wide, 1);
  assert.equal(bridge.getHotseatBridgeState(wide.binding).hitCount, 1);
  step(wide, 8);
  assert.equal(bridge.getHotseatBridgeState(wide.binding).hitCount, 1);
  close(wide);
  console.log("PASS G07: one wide attacker hitting both targets in the same step consumes only one shared hit");

  const inactive = await create();
  inactive.turn.phase = "settling";
  inactive.turn.pendingTurnChange = true;
  syntheticAttacker(inactive, { z: -.12 * H, speed: 2 });
  step(inactive, 60);
  assert.equal(bridge.getHotseatBridgeState(inactive.binding).hitCount, 0);
  close(inactive);
  const slow = await create();
  active(slow);
  syntheticAttacker(slow, { z: -.06 * H - meta.cellSize * .04 - .002, speed: .1 * meta.cellSize });
  step(slow, 90);
  assert.equal(bridge.getHotseatBridgeState(slow.binding).hitCount, 0);
  close(slow);
  console.log("PASS G07: setup/non-launch contacts and sub-threshold resting approach do not damage bridge");

  for (const type of ["Pawn", "King"]) {
    const supported = await create(type);
    supported.piece.body.setTranslation({ x: 0, y: supported.piece.spawnTranslation.y, z: 0 }, true);
    step(supported, 600);
    assert(supported.piece.body.isSleeping(), `${type} does not sleep on deck`);
    if (type === "King") {
      assert(turnModule.executeKingDefense(supported.turn, supported.piece.instance.id));
      assert(supported.piece.body.isFixed());
    }
    active(supported);
    syntheticAttacker(supported, { id: "probe-left", index: 0, z: -.12 * H, speed: 2 });
    syntheticAttacker(supported, { id: "probe-right", index: 1, z: -.12 * H, speed: 2 });
    untilHit(supported, 2);
    step(supported);
    assert(!supported.piece.body.isSleeping() && !supported.piece.body.isFixed(), `${type} was not woken/released`);
    if (type === "King") assert(supported.turn.kingSpecialUsed.white && !supported.turn.kingDefenseActive.white);
    step(supported, 180);
    assert(supported.piece.body.translation().y < config.FALL_OUT_Y, `${type} stays above missing deck`);
    close(supported);
  }
  console.log("PASS G07: two simultaneous attackers destroy bridge; sleeping Pawn and defending King wake and fall, used king action preserved");

  const supportedBlock = await create();
  const deckBlock = maps.createHotseatBlock({ kind: "block", id: "deck-block", u: 0, v: 0, widthH: .15, depthH: .15, heightCells: .45, massPawnMultiple: 2 },
    { world: supportedBlock.runtime.world, boardTop: supportedBlock.runtime.boardTop, cellSize: meta.cellSize, halfExtent: H, pawnMass: supportedBlock.piece.body.mass(), friction: config.getPieceFriction("hotseat") });
  supportedBlock.runtime.hotseatMap.dynamicObjects.set("deck-block", deckBlock);
  supportedBlock.scene.scene.add(deckBlock.mesh);
  step(supportedBlock, 600);
  assert(deckBlock.body.isSleeping(), "Actual movable block did not settle on deck");
  active(supportedBlock);
  syntheticAttacker(supportedBlock, { id: "probe-left", index: 0, z: -.12 * H, speed: 2 });
  syntheticAttacker(supportedBlock, { id: "probe-right", index: 1, z: -.12 * H, speed: 2 });
  untilHit(supportedBlock, 2);
  step(supportedBlock);
  assert(!deckBlock.body.isSleeping(), "Sleeping movable block was not woken");
  step(supportedBlock, 180);
  assert(deckBlock.body.translation().y < config.FALL_OUT_Y, "Movable block stays above missing deck");
  close(supportedBlock);
  console.log("PASS G07: actual sleeping movable block wakes and falls after deck destruction");

  const bypass = await create("King");
  const kingBounds = meta.pieces.King.colliderPoints.map(point => point[0] * bypass.piece.uniformScale);
  const radius = Math.max(...kingBounds.map(Math.abs));
  const bypassWidth = .25 * H;
  assert(bypassWidth > radius * 2, `Bypass ${bypassWidth} narrower than basic King diameter ${radius * 2}`);
  bypass.piece.body.setTranslation({ x: -.875 * H, y: bypass.piece.spawnTranslation.y, z: -.25 * H }, true);
  step(bypass, 120);
  bypass.piece.body.setLinvel({ x: 0, y: 0, z: 2 }, true);
  active(bypass);
  step(bypass, 240);
  assert(bypass.piece.body.translation().z > .12 * H && bypass.piece.body.translation().y > config.FALL_OUT_Y, "Basic King cannot pass around moat");
  report.bypass = { width: bypassWidth, kingDiameter: radius * 2, end: bypass.piece.body.translation() };
  close(bypass);
  console.log("PASS G07: measured basic King hull fits and physically traverses outer bypass");

  const targetTop = await create();
  targetTop.piece.body.setTranslation({ x: targetPosition().x, y: targetTop.piece.spawnTranslation.y + object.supports[0].heightCells * meta.cellSize, z: 0 }, true);
  let supportGrounded = false;
  for (let i = 0; i < 60; i++) {
    step(targetTop);
    let supportContact = false;
    targetTop.runtime.world.contactPair(targetTop.piece.collider, targetTop.binding.additionalColliders[0], manifold => { supportContact ||= manifold.numSolverContacts() > 0 && Math.abs(manifold.normal().y) > .5; });
    supportGrounded ||= supportContact && maps.collectHotseatGroundedIds(targetTop.runtime).has(targetTop.piece.instance.id);
  }
  assert(supportGrounded, "Additional support collider is absent from grounding graph");
  close(targetTop);

  const integrated = await create("Pawn", true, true);
  physics.validateSpawnOverlaps(integrated.runtime, meta, false);
  physics.preSettlePhysics(integrated.runtime);
  assert.equal(bridge.getHotseatBridgeState(integrated.binding).hitCount, 0, "Pre-settle counted a bridge hit");
  const coreStep = fixture => {
    turnModule.applyPendingLaunchBeforeStep(fixture.turn);
    fixture.runtime.world.step();
    turnModule.updateTurnAfterStep(fixture.turn, config.FIXED_STEP);
  };
  const coreFinish = fixture => {
    let steps = 0;
    while (fixture.turn.phase === "settling" && steps++ < 2400) coreStep(fixture);
    assert(steps < 2400, "Integrated bridge shot did not settle");
    return steps;
  };
  const queueShot = (fixture, piece, direction, normalizedPower = .6) => {
    assert(turnModule.queueTurnLaunch(fixture.turn, { pieceId: piece.instance.id, direction: new Vector3(0, 0, direction), normalizedPower,
      applicationPoint: new Vector3().copy(piece.body.worldCom()) }).accepted);
  };
  const white = integrated.runtime.pieces.get("white-pawn-left"), black = integrated.runtime.pieces.get("black-pawn-right"), passenger = integrated.runtime.pieces.get("white-pawn-center");
  white.body.setTranslation({ x: targetPosition(0).x, y: white.spawnTranslation.y, z: -.25 * H }, true);
  black.body.setTranslation({ x: targetPosition(1).x, y: black.spawnTranslation.y, z: .25 * H }, true);
  passenger.body.setTranslation({ x: 0, y: passenger.spawnTranslation.y, z: 0 }, true);
  physics.preSettlePhysics(integrated.runtime);
  assert(passenger.body.isSleeping());
  let settlements = 0, mastery = 0, results = 0;
  integrated.turn.onTurnSettled = () => settlements++;
  integrated.turn.onMasterySettlement = () => mastery++;
  integrated.turn.onMatchOver = () => results++;
  queueShot(integrated, white, 1);
  coreFinish(integrated);
  assert.equal(bridge.getHotseatBridgeState(integrated.binding).hitCount, 1);
  assert.equal(settlements, 1);
  assert.equal(mastery, 1);
  integrated.turn.phase = "ready";
  integrated.turn.currentSide = "black";
  queueShot(integrated, black, -1);
  let hitSteps = 0;
  while (!bridge.getHotseatBridgeState(integrated.binding).pendingDestruction && hitSteps++ < 300) coreStep(integrated);
  assert(hitSteps < 300, "Actual black Pawn did not produce second support hit");
  assert(integrated.binding.body.isValid(), "Second collision removed bridge before next step");
  assert.equal(settlements, 1);
  assert.equal(integrated.turn.pendingLaunch, null, "Second shot impulse has not been applied");
  coreStep(integrated); // No launch remains: wrapper still applies pending bridge removal.
  assert(!integrated.binding.body.isValid());
  assert(!passenger.body.isSleeping());
  assert.equal(integrated.turn.phase, "settling");
  assert.equal(settlements, 1, "Bridge destruction finalized before passenger falling");
  const extraSteps = coreFinish(integrated);
  assert(!integrated.runtime.pieces.has(passenger.instance.id));
  assert.equal(settlements, 2);
  assert.equal(mastery, 2);
  assert.equal(results, 0);
  assert.equal(integrated.turn.settlementRemovedPieces.filter(piece => piece.id === passenger.instance.id).length, 1);
  assert(!collapse.hasAppliedHotseatLaunch(integrated.turn));
  for (let i = 0; i < 60; i++) coreStep(integrated);
  assert.equal(settlements, 2, "Idle step repeats the final settlement");
  report.integration = { actualShots: 2, extraFallingSteps: extraSteps, settlements, mastery, results, noLaunchStepRemoval: true };
  close(integrated);
  console.log("PASS G07 integration: install/pre-settle/two approved Pawn shots/no-launch-step removal/extra falling/final callbacks once per shot");

  const installedReset = await create("Pawn", true, true);
  const installedCounts = { bodies: installedReset.runtime.world.bodies.len(), colliders: installedReset.runtime.world.colliders.len(), meshes: installedReset.scene.scene.children.length };
  for (let i = 0; i < 20; i++) {
    maps.disposeHotseatMap(installedReset.runtime, installedReset.scene);
    assert.equal(installedReset.runtime.world.bodies.len(), 17);
    assert.equal(installedReset.runtime.world.colliders.len(), 17);
    maps.installHotseatMap(installedReset.runtime, installedReset.scene, map, meta);
    turnModule.resetTurnRuntime(installedReset.turn);
    physics.preSettlePhysics(installedReset.runtime);
    const rebuilt = installedReset.runtime.hotseatMap.dynamicObjects.get(object.id);
    assert.equal(bridge.getHotseatBridgeState(rebuilt).remainingHits, 2);
    assert.deepEqual({ bodies: installedReset.runtime.world.bodies.len(), colliders: installedReset.runtime.world.colliders.len(), meshes: installedReset.scene.scene.children.length }, installedCounts);
  }
  close(installedReset);
  console.log("PASS G07 integration: 20 actual map reinstalls preserve all physics/render counts and full durability");

  for (let i = 0; i < 20; i++) {
    const reset = await create();
    const count = { bodies: reset.runtime.world.bodies.len(), colliders: reset.runtime.world.colliders.len() };
    assert.equal(bridge.getHotseatBridgeState(reset.binding).remainingHits, 2);
    let geometryDisposals = 0, materialDisposals = 0;
    reset.binding.mesh.traverse(child => {
      if (!(child instanceof Mesh)) return;
      child.geometry.addEventListener("dispose", () => geometryDisposals++);
      for (const material of Array.isArray(child.material) ? child.material : [child.material]) material.addEventListener("dispose", () => materialDisposals++);
    });
    maps.disposeHotseatMap(reset.runtime, reset.scene);
    assert.equal(reset.runtime.world.bodies.len(), 2);
    assert.equal(reset.runtime.world.colliders.len(), 2);
    assert.equal(reset.scene.scene.children.length, 0);
    assert.equal(geometryDisposals, 9);
    assert.equal(materialDisposals, 9);
    assert.deepEqual(count, { bodies: 3, colliders: 12 });
    reset.runtime.world.free();
    fixtures.splice(fixtures.indexOf(reset), 1);
  }
  report.restarts = 20;
  console.log("PASS G07: 20 resets restore durability and remove all deck/support physics, child geometry and materials");
  const reportIndex = process.argv.indexOf("--report");
  if (reportIndex >= 0) await writeFile(process.argv[reportIndex + 1], JSON.stringify(report, null, 2) + "\n");
} finally {
  for (const fixture of fixtures) fixture.runtime.world.free();
  console.info = originalInfo;
  await vite.close();
}
