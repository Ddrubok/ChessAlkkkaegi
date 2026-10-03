import "./headless-browser-env.mjs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Mesh, Scene } from "three";
import { createServer } from "vite";

const vite = await createServer({ root: fileURLToPath(new URL("../..", import.meta.url)), configFile: false, logLevel: "error", appType: "custom", server: { middlewareMode: true } });
const assert = (condition, message) => { if (!condition) throw new Error(message); };
try {
  const [physics, maps, definitions, stage, turn, tuning, config, layout] = await Promise.all([
    "physics", "maps/hotseat-map-runtime", "maps/g01", "stage", "turn", "tuning", "config", "layout",
  ].map(name => vite.ssrLoadModule(`/src/${name}.ts`)));
  const meta = JSON.parse(await readFile(new URL("../../public/assets/chess-set.meta.json", import.meta.url), "utf8"));
  const definition = definitions.G01_MAP;
  const options = { gameMode: "hotseat", stageNumber: 1 };
  const instances = definition.spawns.map(spawn => spawn.instance);
  const halfExtent = stage.computeStageBoardHalfExtent(meta.cellSize, "stage", 2);
  function sceneFor(runtime) {
    const scene = new Scene();
    const pieceMeshes = new Map([...runtime.pieces.values()].map(piece => {
      const mesh = new Mesh(); mesh.name = piece.instance.id; scene.add(mesh); return [piece.instance.id, mesh];
    }));
    return { scene, pieceMeshes, breakableWallMeshes: new Map(), controls: { enabled: true } };
  }
  async function create() {
    const runtime = await physics.createPhysicsRuntime(meta, instances, halfExtent, options);
    const scene = sceneFor(runtime);
    maps.installHotseatMap(runtime, scene, definition, meta);
    physics.validateSpawnOverlaps(runtime, meta, false);
    physics.preSettlePhysics(runtime);
    return { runtime, scene };
  }
  const fixture = await create();
  const r = fixture.runtime;
  assert(r.pieces.size === 16 && r.hotseatMap.dynamicObjects.size === 2, "G01 must have 16 pieces and 2 neutral blocks");
  const pawnMass = r.pieces.get("white-pawn-left").body.mass();
  for (const block of r.hotseatMap.dynamicObjects.values()) {
    assert(Math.abs(block.body.mass() / pawnMass - 2) < 1e-5, "Block mass must equal two pawns");
  }
  for (let i = 0; i < 1200; i++) r.world.step();
  assert([...r.pieces.values(), ...r.hotseatMap.dynamicObjects.values()].every(binding => binding.body.isSleeping() && binding.body.translation().y > config.FALL_OUT_Y), "An idle G01 object moved or fell over 10 seconds");
  for (let restart = 0; restart < 20; restart++) {
    maps.disposeHotseatMap(r, fixture.scene);
    physics.rebuildPhysicsBoard(r, meta, halfExtent, options);
    physics.resetPhysicsPieces(r, meta, instances, options);
    maps.installHotseatMap(r, fixture.scene, definition, meta);
    physics.preSettlePhysics(r);
    assert(r.world.bodies.len() === 19 && r.world.colliders.len() === 19, `Restart ${restart} leaked physics objects`);
    assert(fixture.scene.scene.children.filter(mesh => mesh.name.startsWith("map-")).length === 2, `Restart ${restart} leaked map meshes`);
    assert([...r.pieces.values()].every(p => p.body.translation().y > config.FALL_OUT_Y), "Initial piece fell");
  }
  console.log("PASS G01: 16 stable pieces, 2 blocks at 2×pawn mass, 20 restarts without leaks");

  const t = turn.createTurnRuntime(r, fixture.scene, tuning.createDefaultRuntimeTuningSettings());
  t.phase = "settling";
  let settlements = 0;
  t.onTurnSettled = () => settlements++;
  const block = r.hotseatMap.dynamicObjects.get("block-left");
  block.body.setLinvel({ x: 0, y: 0, z: 1 }, true);
  for (let i = 0; i < 50; i++) turn.updateTurnAfterStep(t, config.FIXED_STEP);
  assert(t.phase === "settling" && settlements === 0, "Turn ended while a block was moving");
  block.body.setTranslation({ x: 0, y: config.FALL_OUT_Y - 1, z: 0 }, true);
  turn.updateTurnAfterStep(t, config.FIXED_STEP);
  assert(r.hotseatMap.dynamicObjects.size === 1 && r.pieces.size === 16 && t.settlementRemovedPieces.length === 0, "Block fall changed piece counts or removals");
  assert(r.hotseatMap.fallenObjectIds.has("block-left") && !fixture.scene.scene.children.some(mesh => mesh.name === "map-block-left"), "Fallen block was not removed");
  console.log("PASS G01: moving block prevents settlement; block fall does not count as a piece fall");

  const drop = await create();
  const dropping = drop.runtime.hotseatMap.dynamicObjects.get("block-left");
  dropping.body.setTranslation({ x: halfExtent + definition.objects[0].widthH * halfExtent, y: dropping.body.translation().y, z: 0 }, true);
  const dropTurn = turn.createTurnRuntime(drop.runtime, drop.scene, tuning.createDefaultRuntimeTuningSettings());
  dropTurn.phase = "settling";
  let dropSteps = 0;
  while (drop.runtime.hotseatMap.dynamicObjects.has("block-left") && dropSteps < 600) {
    drop.runtime.world.step();
    turn.updateTurnAfterStep(dropTurn, config.FIXED_STEP);
    dropSteps++;
  }
  assert(dropSteps < 600 && drop.runtime.pieces.size === 16, "A block outside the board did not fall naturally or changed piece counts");
  console.log(`PASS G01: block vertical motion remains free and natural gravity removes it after ${dropSteps} steps`);

  const push = await create();
  const p = push.runtime;
  const left = p.pieces.get("white-pawn-left");
  const target = p.pieces.get("black-pawn-left");
  for (const [id, piece] of p.pieces) if (piece !== left && piece !== target) { p.world.removeRigidBody(piece.body); p.pieces.delete(id); }
  const moving = p.hotseatMap.dynamicObjects.get("block-left");
  const x = moving.body.translation().x;
  const depth = definition.objects[0].depthH * halfExtent;
  const radius = meta.pieces.Pawn.bounds.z / 2;
  const targetStart = depth / 2 + radius + 0.03;
  left.body.setTranslation({ x, y: left.spawnTranslation.y, z: -depth / 2 - radius - 0.04 }, true);
  target.body.setTranslation({ x, y: target.spawnTranslation.y, z: targetStart }, true);
  left.body.setLinvel({ x: 0, y: 0, z: 4 }, true);
  let hitTarget = false;
  for (let i = 0; i < 360; i++) {
    p.world.step();
    p.world.contactPair(moving.collider, target.collider, manifold => { if (manifold.numSolverContacts() > 0) hitTarget = true; });
  }
  assert(hitTarget && moving.body.translation().z > 0.03 && target.body.translation().z > targetStart + 0.03, "Actual block-mediated push did not move the target");
  console.log(`PASS G01: pawn → block → opponent contact, block z=${moving.body.translation().z.toFixed(3)}, target displacement=${(target.body.translation().z - targetStart).toFixed(3)}`);

  const support = await create();
  const s = support.runtime;
  const supported = s.pieces.get("white-pawn-left");
  const base = s.hotseatMap.dynamicObjects.get("block-left");
  supported.body.setTranslation({ x: base.body.translation().x, y: supported.spawnTranslation.y + definition.objects[0].heightCells * meta.cellSize, z: 0 }, true);
  physics.preSettlePhysics(s);
  assert(maps.collectHotseatGroundedIds(s).has(supported.instance.id), "A pawn resting on a block was not grounded");
  base.body.setLinvel({ x: 0, y: -1, z: 0 }, true);
  assert(!maps.collectHotseatGroundedIds(s).has(supported.instance.id), "A moving block incorrectly supported a pawn at forced settlement");
  console.log("PASS G01: stationary block supports a piece; moving block is excluded from forced-settlement support");

  maps.disposeHotseatMap(r, fixture.scene);
  physics.rebuildPhysicsBoard(r, meta, stage.computeStageBoardHalfExtent(meta.cellSize, "hotseat", 1), options);
  physics.resetPhysicsPieces(r, meta, layout.PIECE_INSTANCES, options);
  assert(r.hotseatMap === undefined && r.pieces.size === 32 && r.world.bodies.len() === 33, "Classic hotseat retained G01 objects or changed its pieces");
  const stageOptions = { gameMode: "stage", stageNumber: 3 };
  physics.rebuildPhysicsBoard(r, meta, stage.computeStageBoardHalfExtent(meta.cellSize, "stage", 3), stageOptions);
  physics.resetPhysicsPieces(r, meta, layout.PIECE_INSTANCES, stageOptions);
  assert(r.hotseatMap === undefined && r.breakableWalls.size === 32, "Stage 3 was changed by G01");
  console.log("PASS G01: classic returns to 32 pieces; stage 3 retains its 32 legacy walls");
  for (const runtime of [r, p, s, drop.runtime]) runtime.world.free();
} finally { await vite.close(); }
