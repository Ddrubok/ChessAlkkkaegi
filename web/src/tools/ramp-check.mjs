import "./headless-browser-env.mjs";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Mesh, Scene, Quaternion, Vector3 } from "three";
import { createServer } from "vite";

const vite = await createServer({ root: fileURLToPath(new URL("../..", import.meta.url)), configFile: false, logLevel: "error", appType: "custom", server: { middlewareMode: true, hmr: false } });
const results = { mapId: "gm-launch-ramps-v1", revision: 1, entries: [], jumps: [], highSpeedEntries: [], weakEntries: [], landings: [] };
const info = console.info;
console.info = () => {};
const runtimes = [];
try {
  const [physics, maps, ramp, boxes, definition, stage, config, turn, tuning] = await Promise.all([
    "physics", "maps/hotseat-map-runtime", "maps/ramp", "maps/static-box", "maps/g05", "stage", "config", "turn", "tuning",
  ].map(name => vite.ssrLoadModule(`/src/${name}.ts`)));
  const meta = JSON.parse(await readFile(new URL("../../public/assets/chess-set.meta.json", import.meta.url), "utf8"));
  const map = definition.G05_MAP;
  const H = stage.computeStageBoardHalfExtent(meta.cellSize, "stage", 2);
  const options = { gameMode: "hotseat", stageNumber: 1 };
  const south = map.objects[0];
  const shape = ramp.computeHotseatRampShape(south, H);
  const lowZ = (south.v - south.depthH / 2) * H;
  const highZ = (south.v + south.depthH / 2) * H;
  const types = ["Pawn", "Rook", "Knight", "Bishop", "Queen", "King"];

  function sceneFor(runtime) {
    const scene = new Scene();
    const pieceMeshes = new Map([...runtime.pieces.values()].map(piece => {
      const mesh = new Mesh(); scene.add(mesh); return [piece.instance.id, mesh];
    }));
    return { scene, pieceMeshes, breakableWallMeshes: new Map(), controls: { enabled: true } };
  }
  async function create(type, objects = [south]) {
    const instances = type ? [{ id: `white-${type.toLowerCase()}`, type, side: "white", startingSquare: { file: "d", rank: 2 } }] : map.spawns.map(spawn => spawn.instance);
    const runtime = await physics.createPhysicsRuntime(meta, instances, H, options);
    runtimes.push(runtime);
    const scene = sceneFor(runtime);
    if (!type) {
      assert.equal(maps.getHotseatMapDefinition(map.id), map, "G05 is not registered in the real runtime");
      maps.installHotseatMap(runtime, scene, map, meta);
    } else {
      const context = { world: runtime.world, boardTop: runtime.boardTop, cellSize: meta.cellSize, halfExtent: H, pawnMass: runtime.pieces.values().next().value.body.mass(), friction: config.getPieceFriction("hotseat") };
      runtime.hotseatMap = { definition: { ...map, objects }, dynamicObjects: new Map(), fallenObjectIds: new Set() };
      for (const object of objects) {
        const binding = object.kind === "ramp" ? ramp.createHotseatRamp(object, context) : boxes.createHotseatStaticBox(object, context);
        runtime.hotseatMap.dynamicObjects.set(object.id, binding);
        scene.scene.add(binding.mesh);
      }
    }
    runtime.world.propagateModifiedBodyPositionsToColliders();
    return { runtime, scene, piece: runtime.pieces.values().next().value, ramp: runtime.hotseatMap.dynamicObjects.get(south.id) };
  }
  function close(fixture) {
    maps.disposeHotseatMap(fixture.runtime, fixture.scene);
    fixture.runtime.world.free();
    runtimes.splice(runtimes.indexOf(fixture.runtime), 1);
  }
  function extents(piece, rotation) {
    const points = meta.pieces[piece.instance.type].colliderPoints.map(point => new Vector3(...point).multiplyScalar(piece.uniformScale).applyQuaternion(rotation));
    return { minY: Math.min(...points.map(point => point.y)), minX: Math.min(...points.map(point => point.x)), maxX: Math.max(...points.map(point => point.x)), minZ: Math.min(...points.map(point => point.z)), maxZ: Math.max(...points.map(point => point.z)) };
  }
  function pose(fixture, posture, direction) {
    const q = posture === "lying" ? new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2) : new Quaternion().copy(fixture.piece.spawnRotation);
    const bounds = extents(fixture.piece, q);
    const p = { x: 0, y: fixture.runtime.boardTop - bounds.minY + 0.002, z: 0 };
    if (direction === "front") p.z = lowZ - bounds.maxZ - 0.025;
    else if (direction === "back") p.z = highZ - bounds.minZ + 0.025;
    else { p.x = shape.width / 2 - bounds.minX + 0.025; p.z = (south.v - 0.025) * H; }
    fixture.piece.body.setRotation(q, true);
    fixture.piece.body.setTranslation(p, true);
    fixture.piece.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    fixture.piece.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    for (let i = 0; i < 90; i++) fixture.runtime.world.step();
  }
  function simulate(fixture, steps = 960) {
    const { runtime, piece } = fixture;
    const objects = [...runtime.hotseatMap.dynamicObjects.values()];
    let touchedRamp = false, minDistance = 0, maxY = piece.body.translation().y, wallCrossY = null, wallCrossMinY = null, touchedWall = false, touchedWallBeforeCross = false, airborne = false, landed = false;
    const initialY = piece.body.translation().y;
    const startZ = piece.body.translation().z;
    for (let i = 0; i < steps; i++) {
      runtime.world.step();
      const p = piece.body.translation(), v = piece.body.linvel(), q = piece.body.rotation();
      assert([p.x, p.y, p.z, v.x, v.y, v.z, q.x, q.y, q.z, q.w].every(Number.isFinite), "Ramp produced nonfinite physics state");
      maxY = Math.max(maxY, p.y);
      if (wallCrossY === null && p.z >= 0 && startZ < 0) {
        wallCrossY = p.y;
        wallCrossMinY = p.y + extents(piece, new Quaternion(q.x, q.y, q.z, q.w)).minY;
      }
      let boardContact = false;
      for (const board of runtime.boardColliders) runtime.world.contactPair(piece.collider, board, manifold => { boardContact ||= manifold.numSolverContacts() > 0; });
      if (!boardContact && p.z > highZ + 0.05 && p.y > initialY + 0.03) airborne = true;
      if (airborne && boardContact && p.z > highZ + 0.05) landed = true;
      for (const object of objects) {
        const contact = piece.collider.contactCollider(object.collider, 0);
        if (contact) minDistance = Math.min(minDistance, contact.distance);
        runtime.world.contactPair(piece.collider, object.collider, manifold => {
          if (manifold.numSolverContacts() > 0) {
            if (object.definition.kind === "ramp") touchedRamp = true;
            else { touchedWall = true; if (wallCrossY === null) touchedWallBeforeCross = true; }
          }
        });
      }
    }
    return { initialY, maxY, end: piece.body.translation(), touchedRamp, minDistance, airborne, landed, wallCrossY, wallCrossMinY, touchedWall, touchedWallBeforeCross, sleeping: piece.body.isSleeping() };
  }

  // Every rendering boundary is exactly the hull vertex used by the physical wedge.
  const fixture = await create(undefined, map.objects);
  for (const object of fixture.runtime.hotseatMap.dynamicObjects.values()) {
    assert(object.body.isFixed(), "Ramp and low wall must be fixed");
    if (object.definition.kind === "ramp") {
      const expected = ramp.computeHotseatRampShape(object.definition, H);
      assert.deepEqual([...object.mesh.geometry.getAttribute("position").array], [...expected.vertices]);
      assert.deepEqual([...object.collider.shape.vertices], [...expected.vertices]);
      assert.equal(object.mesh.position.y, fixture.runtime.boardTop);
    }
  }
  const spawnPenetrations = [];
  const all = [...fixture.runtime.pieces.values(), ...fixture.runtime.hotseatMap.dynamicObjects.values()];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    if (all[i].body.isFixed() && all[j].body.isFixed()) continue;
    const contact = all[i].collider.contactCollider(all[j].collider, 0);
    if (contact?.distance < -0.0001) spawnPenetrations.push({ left: all[i].instance?.id ?? all[i].definition.id, right: all[j].instance?.id ?? all[j].definition.id, distance: contact.distance });
  }
  assert.equal(spawnPenetrations.length, 0, `G05 spawn hulls overlap another piece or map object: ${JSON.stringify(spawnPenetrations)}`);
  physics.validateSpawnOverlaps(fixture.runtime, meta, false);
  physics.preSettlePhysics(fixture.runtime);
  for (let i = 0; i < 1200; i++) fixture.runtime.world.step();
  assert([...fixture.runtime.pieces.values()].every(piece => piece.body.isSleeping() && piece.body.translation().y > config.FALL_OUT_Y), "An idle G05 piece moved or fell");
  results.spawn = { pieces: fixture.runtime.pieces.size, hullPenetrations: spawnPenetrations.length, idleSeconds: 10 };
  console.log("PASS G05: exact render/hull boundary, fixed wedges, 16 hulls without spawn overlaps or idle falls");
  close(fixture);

  results.integration = [];
  for (const speed of [1.5, 5]) {
    const installed = await create(undefined, map.objects);
    physics.preSettlePhysics(installed.runtime);
    installed.piece = installed.runtime.pieces.get("white-pawn-center");
    assert.equal(installed.piece.spawnTranslation.z, -0.64 * H, "Real installation did not apply the center Pawn spawn");
    const installedTurn = turn.createTurnRuntime(installed.runtime, installed.scene, tuning.createDefaultRuntimeTuningSettings());
    const launch = { pieceId: installed.piece.instance.id, direction: new Vector3(0, 0, 1), normalizedPower: speed / config.getMaxLaunchSpeed("hotseat", "Pawn"), applicationPoint: new Vector3().copy(installed.piece.body.worldCom()) };
    assert(turn.queueTurnLaunch(installedTurn, launch).accepted);
    assert(turn.applyPendingLaunchBeforeStep(installedTurn));
    const result = simulate(installed, 1200);
    if (speed === 1.5) {
      assert(result.sleeping && result.end.z > lowZ && result.end.z < highZ && maps.collectHotseatGroundedIds(installed.runtime).has(installed.piece.instance.id), "Installed G05 weak launch did not settle on the ramp");
    } else {
      assert(result.airborne && result.landed && !result.touchedWallBeforeCross && result.wallCrossMinY > installed.runtime.boardTop + map.objects[2].heightCells * meta.cellSize, "Installed G05 launch did not clear the wall and land");
    }
    results.integration.push({ pieces: installed.runtime.pieces.size, speed, normalizedPower: launch.normalizedPower, ...result });
    close(installed);
  }
  console.log("PASS G05 integration: real map lookup/install → 16-piece pre-settle → weak incline settlement and wall-clearing Pawn launch");

  for (const type of types) for (const posture of ["upright", "lying"]) for (const direction of ["front", "side", "back"]) {
    const entry = await create(type);
    pose(entry, posture, direction);
    const speed = 3;
    entry.piece.body.enableCcd(true);
    entry.piece.body.setLinvel({ x: direction === "side" ? -speed : 0, y: 0, z: direction === "front" ? speed : direction === "back" ? -speed : 0 }, true);
    const result = simulate(entry);
    assert(result.touchedRamp, `${type}/${posture}/${direction} did not contact the ramp`);
    assert(result.minDistance > -0.06, `${type}/${posture}/${direction} penetrated ramp ${result.minDistance}`);
    results.entries.push({ type, posture, direction, speed, ...result });
    close(entry);
  }
  console.log("PASS G05: 36 actual convex-hull entry cases, six types × two postures × three directions");

  for (const type of types) for (const posture of ["upright", "lying"]) {
    const fast = await create(type);
    pose(fast, posture, "front");
    const speed = config.getMaxLaunchSpeed("hotseat", type);
    fast.piece.body.enableCcd(true);
    fast.piece.body.setLinvel({ x: 0, y: 0, z: speed }, true);
    const result = simulate(fast, 360);
    assert(result.touchedRamp && result.minDistance > -0.06, `High speed ${type}/${posture} missed or penetrated the ramp: ${JSON.stringify(result)}`);
    results.highSpeedEntries.push({ type, posture, speed, ...result });
    close(fast);
  }
  console.log("PASS G05: 12 maximum-speed hull probes contact the ramp without tunneling");

  for (const type of types) for (const posture of ["upright", "lying"]) {
    let landed = false;
    for (const speed of [4, 5, 6, 7]) {
      const landing = await create(type);
      pose(landing, posture, "front");
      landing.piece.body.enableCcd(true);
      landing.piece.body.setLinvel({ x: 0, y: 0, z: speed }, true);
      const result = simulate(landing);
      landed = result.touchedRamp && result.airborne && result.landed && result.minDistance > -0.06;
      results.landings.push({ type, posture, speed, ...result });
      close(landing);
      if (landed) break;
    }
    assert(landed, `${type}/${posture} never landed after leaving the ramp`);
  }
  console.log("PASS G05: all six upright and lying hulls physically leave the ramp and land on the board");

  for (const type of ["Pawn", "Rook"]) {
    let successful = false;
    for (const speed of [3, 4, 5, 6, 7, 8]) {
      if (speed > config.getMaxLaunchSpeed("hotseat", type)) break;
      const jump = await create(type, map.objects);
      jump.piece.body.setTranslation({ x: 0, y: jump.piece.spawnTranslation.y, z: -0.64 * H }, true);
      physics.preSettlePhysics(jump.runtime);
      const jumpTurn = turn.createTurnRuntime(jump.runtime, jump.scene, tuning.createDefaultRuntimeTuningSettings());
      const jumpLaunch = { pieceId: jump.piece.instance.id, direction: new Vector3(0, 0, 1), normalizedPower: speed / config.getMaxLaunchSpeed("hotseat", type), applicationPoint: new Vector3().copy(jump.piece.body.worldCom()) };
      assert(turn.queueTurnLaunch(jumpTurn, jumpLaunch).accepted);
      assert(turn.applyPendingLaunchBeforeStep(jumpTurn));
      const result = simulate(jump);
      results.jumps.push({ type, speed, normalizedPower: speed / config.getMaxLaunchSpeed("hotseat", type), ...result });
      successful ||= result.touchedRamp && result.airborne && result.landed && !result.touchedWallBeforeCross && result.wallCrossMinY >= jump.runtime.boardTop + map.objects[2].heightCells * meta.cellSize && result.wallCrossMinY !== null && result.end.z > 0;
      close(jump);
      if (successful) break;
    }
    assert(successful, `${type} could not physically jump the G05 low wall and land`);
  }
  console.log("PASS G05: Pawn and Rook physically clear the low center wall and land at reachable shot strengths");

  let weakEntryPassed = false;
  for (const speed of [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]) {
    const entry = await create("Pawn");
    entry.piece.body.setTranslation({ x: 0, y: entry.piece.spawnTranslation.y, z: -0.64 * H }, true);
    physics.preSettlePhysics(entry.runtime);
    const weakTurn = turn.createTurnRuntime(entry.runtime, entry.scene, tuning.createDefaultRuntimeTuningSettings());
    const launch = { pieceId: entry.piece.instance.id, direction: new Vector3(0, 0, 1), normalizedPower: speed / config.getMaxLaunchSpeed("hotseat", "Pawn"), applicationPoint: new Vector3().copy(entry.piece.body.worldCom()) };
    assert(turn.queueTurnLaunch(weakTurn, launch).accepted);
    assert(turn.applyPendingLaunchBeforeStep(weakTurn));
    const result = simulate(entry, 1200);
    weakEntryPassed = result.sleeping && result.touchedRamp && result.end.z > lowZ && result.end.z < highZ && result.end.y > entry.runtime.boardTop + 0.02 && maps.collectHotseatGroundedIds(entry.runtime).has(entry.piece.instance.id);
    results.weakEntries.push({ type: "Pawn", speed, normalizedPower: launch.normalizedPower, ...result, settledOnIncline: weakEntryPassed });
    close(entry);
    if (weakEntryPassed) break;
  }
  assert(weakEntryPassed, `An actual weak launch from the entry never settled on the incline: ${JSON.stringify(results.weakEntries)}`);
  console.log("PASS G05: actual weak Pawn launch enters and settles on the incline");

  // A weak forward shot starts partway up the face and must settle on the actual incline.
  const weak = await create("Pawn");
  const incline = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -south.slopeDegrees * Math.PI / 180);
  const local = extents(weak.piece, incline);
  weak.piece.body.setRotation(incline, true);
  weak.piece.body.setTranslation({ x: 0, y: weak.runtime.boardTop + shape.height * 0.55 - local.minY, z: lowZ + shape.depth * 0.55 }, true);
  weak.piece.body.enableCcd(true);
  weak.piece.body.setLinvel({ x: 0, y: 0, z: 0.15 }, true);
  const weakResult = simulate(weak, 1200);
  assert(weakResult.sleeping && weakResult.touchedRamp, `Weak shot did not settle on the incline: ${JSON.stringify(weakResult)}`);
  assert(weakResult.end.z > lowZ && weakResult.end.z < highZ && weakResult.end.y > weak.runtime.boardTop + 0.02, "Weak shot only settled after leaving the incline");
  assert(maps.collectHotseatGroundedIds(weak.runtime).has(weak.piece.instance.id), "Inclined contact is not recognized as support");
  const before = { ...weak.piece.body.translation() };
  const replacement = physics.replacePieceBody(weak.runtime, weak.piece.instance.id, meta.pieces.Pawn.colliderPoints, config.PIECE_DENSITY);
  assert.deepEqual({ ...replacement.body.translation() }, before, "Collider replacement reset ramp height");
  const promoted = physics.promotePieceBody(weak.runtime, replacement.instance.id, "Rook", meta);
  assert.deepEqual({ ...promoted.body.translation() }, before, "Promotion reset ramp height");
  results.weak = weakResult;
  close(weak);

  const king = await create("King");
  const kingBounds = extents(king.piece, incline);
  king.piece.body.setRotation(incline, true);
  king.piece.body.setTranslation({ x: 0, y: king.runtime.boardTop + shape.height * 0.6 - kingBounds.minY, z: lowZ + shape.depth * 0.6 }, true);
  for (let i = 0; i < 1200; i++) king.runtime.world.step();
  assert(king.piece.body.translation().z > lowZ && king.piece.body.translation().z < highZ && king.piece.body.translation().y > king.runtime.boardTop + 0.02, "King left the incline before defense");
  assert(maps.collectHotseatGroundedIds(king.runtime).has(king.piece.instance.id), "King has no real incline support");
  const defense = turn.createTurnRuntime(king.runtime, king.scene, tuning.createDefaultRuntimeTuningSettings());
  const kingBefore = { ...king.piece.body.translation() };
  assert(turn.executeKingDefense(defense, king.piece.instance.id), "King defense on incline was rejected");
  assert.deepEqual({ ...king.piece.body.translation() }, kingBefore, "King defense changed inclined position");
  assert(king.piece.body.isFixed(), "King defense did not fix body");
  results.kingDefense = { before: kingBefore, after: { ...king.piece.body.translation() }, fixed: king.piece.body.isFixed() };
  close(king);
  console.log("PASS G05: weak shot incline settlement/support, collider replacement/promotion and king defense preserve elevated position");

  // Knight uses the existing launch handler once; the fixed ramp has no velocity hooks.
  const knight = await create("Knight", map.objects);
  pose(knight, "upright", "front");
  const knightTurn = turn.createTurnRuntime(knight.runtime, knight.scene, tuning.createDefaultRuntimeTuningSettings());
  const launch = { pieceId: knight.piece.instance.id, direction: new Vector3(0, 0, 1), normalizedPower: 0.4, applicationPoint: new Vector3().copy(knight.piece.body.worldCom()) };
  assert(turn.queueTurnLaunch(knightTurn, launch).accepted);
  assert(turn.applyPendingLaunchBeforeStep(knightTurn));
  const launchVelocity = { ...knight.piece.body.linvel() };
  assert(launchVelocity.y > 0, "Knight lost its normal upward launch");
  assert(Math.abs(Math.hypot(launchVelocity.x, launchVelocity.y, launchVelocity.z) - knightTurn.lastLaunchInitialSpeed) < 0.001, "Knight received duplicate propulsion");
  results.knight = { launchVelocity, ...simulate(knight) };
  close(knight);
  console.log("PASS G05: existing Knight launch keeps its upward impulse without a second ramp impulse");

  for (let i = 0; i < 20; i++) {
    const restart = await create(undefined, map.objects);
    let disposedGeometries = 0, disposedMaterials = 0;
    for (const object of restart.runtime.hotseatMap.dynamicObjects.values()) object.mesh.traverse(child => {
      if (!(child instanceof Mesh)) return;
      child.geometry.addEventListener("dispose", () => disposedGeometries++);
      for (const material of Array.isArray(child.material) ? child.material : [child.material]) material.addEventListener("dispose", () => disposedMaterials++);
    });
    maps.disposeHotseatMap(restart.runtime, restart.scene);
    assert.equal(restart.runtime.world.bodies.len(), 17, "Ramp teardown leaked a rigid body");
    assert.equal(restart.runtime.world.colliders.len(), 17, "Ramp teardown leaked a collider");
    assert.equal(restart.scene.scene.children.filter(child => child.name.startsWith("map-")).length, 0, "Ramp teardown leaked a mesh");
    assert.equal(disposedGeometries, 5, "Ramp teardown omitted child geometries");
    assert.equal(disposedMaterials, 5, "Ramp teardown omitted child materials");
    restart.runtime.world.free();
    runtimes.splice(runtimes.indexOf(restart.runtime), 1);
  }
  results.restarts = 20;
  console.log("PASS G05: 20 teardown/recreate cycles remove all ramp, marker and low-wall resources");
  const reportArg = process.argv.indexOf("--report");
  if (reportArg >= 0) await writeFile(process.argv[reportArg + 1], JSON.stringify(results, null, 2) + "\n");
} finally {
  for (const runtime of runtimes) runtime.world.free();
  console.info = info;
  await vite.close();
}
