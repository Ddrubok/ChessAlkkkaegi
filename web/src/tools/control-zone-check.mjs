import './headless-browser-env.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Mesh, Scene, Vector3 } from 'three';
import { createServer } from 'vite';

const originalCreateElement = document.createElement;
document.createElement = tag => tag !== 'canvas' ? originalCreateElement(tag) : {
  width: 0, height: 0, getContext: () => new Proxy({}, { get: () => () => {}, set: () => true }),
};
const vite = await createServer({ root: fileURLToPath(new URL('../..', import.meta.url)), configFile: false,
  logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false } });
const worlds = [];
try {
  const [physics, maps, zone, definitions, config, tuning, turn, layout, i18n, display, rapier] = await Promise.all([
    'physics', 'maps/hotseat-map-runtime', 'maps/control-zone', 'maps/g08', 'config', 'tuning', 'turn', 'layout', 'i18n', 'maps/control-zone-display',
  ].map(name => vite.ssrLoadModule(`/src/${name}.ts`)).concat(import('@dimforge/rapier3d-compat').then(module => module.default)));
  const meta = JSON.parse(await readFile(new URL('../../public/assets/chess-set.meta.json', import.meta.url), 'utf8'));
  const definition = definitions.G08_MAP, options = { gameMode: 'hotseat', stageNumber: 1 };
  const H = config.deriveBoardHalfExtent(meta.cellSize) * definition.boardScale;
  const instances = definition.spawns.map(spawn => spawn.instance);
  const sceneFor = runtime => {
    const scene = new Scene(), board = new Mesh(); scene.add(board);
    const pieceMeshes = new Map([...runtime.pieces.values()].map(piece => { const mesh = new Mesh(); scene.add(mesh); return [piece.instance.id, mesh]; }));
    return { scene, pieceMeshes, boardMeshes: [board], boardMesh: board, boardHalfExtent: H, boardTop: runtime.boardTop,
      boardFloorRectangles: runtime.boardFloorRectangles, boardHoleRectangles: runtime.boardHoleRectangles, boardFloorLayoutKey: runtime.boardFloorLayoutKey,
      controls: { enabled: true }, breakableWallMeshes: new Map() };
  };
  function place(f, id, u, v, height = 0) {
    const p = f.runtime.pieces.get(id);
    p.body.setTranslation({ x: -u * H, y: p.spawnTranslation.y + height, z: v * H }, true);
    p.body.setRotation(p.spawnRotation, true); p.body.setLinvel({ x: 0, y: 0, z: 0 }, true); p.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    f.runtime.world.propagateModifiedBodyPositionsToColliders();
    return p;
  }
  async function create(positions = [], map = definition) {
    const runtime = await physics.createPhysicsRuntime(meta, instances, H, options); worlds.push(runtime.world);
    const scene = sceneFor(runtime); maps.installHotseatMap(runtime, scene, map, meta);
    const f = { runtime, scene };
    physics.preSettlePhysics(runtime);
    for (const [id, u, v] of positions) {
      const p = runtime.pieces.get(id);
      p.body.setTranslation({ ...p.body.translation(), x: -u * H, z: v * H }, false);
    }
    runtime.world.propagateModifiedBodyPositionsToColliders();
    f.t = turn.createTurnRuntime(runtime, scene, tuning.createDefaultRuntimeTuningSettings(), meta.cellSize);
    return f;
  }
  const state = f => zone.getControlZoneState(f.runtime);
  const nextEvaluation = (f, side = 'white') => { f.t.turnNumber++; f.t.currentSide = side; zone.beginControlZoneTurn(f.t); return state(f); };
  const step = f => { turn.applyPendingLaunchBeforeStep(f.t); f.runtime.world.step(); turn.updateTurnAfterStep(f.t, config.FIXED_STEP); };
  const queue = (f, id = `${f.t.currentSide}-rook`, power = .01) => {
    const p = f.runtime.pieces.get(id);
    return turn.queueTurnLaunch(f.t, { pieceId: id, normalizedPower: power, direction: new Vector3(1, 0, 0), applicationPoint: new Vector3().copy(p.body.worldCom()) });
  };
  const finish = f => { let steps = 0; while (f.t.phase === 'settling' && steps++ < 2400) step(f); assert.ok(steps < 2400, 'turn must settle'); return steps; };
  const initial = await create();
  physics.validateSpawnOverlaps(initial.runtime, meta, false);
  assert.equal(initial.runtime.pieces.size, 16); assert.equal(initial.runtime.hotseatMap.dynamicObjects.size, 0);
  assert.equal(initial.runtime.boardColliders.length, 1); assert.equal(state(initial).status, 'empty');
  for (let i = 0; i < 1200; i++) step(initial);
  assert.ok([...initial.runtime.pieces.values()].every(p => p.body.translation().y > config.FALL_OUT_Y));
  assert.equal(state(initial).status, 'empty');
  const single = await create([['white-pawn-center', 0, 0]]);
  assert.equal(state(single).status, 'bonus'); assert.equal(state(single).beneficiaryId, 'white-pawn-center');
  const contested = await create([['white-pawn-center', -.12, 0], ['black-pawn-center', .12, 0]]);
  assert.equal(state(contested).status, 'contested'); assert.equal(state(contested).beneficiaryId, null);
  const enemy = await create([['black-pawn-center', 0, 0]]);
  assert.equal(state(enemy).status, 'opponent'); assert.equal(nextEvaluation(enemy, 'black').beneficiaryId, 'black-pawn-center');
  for (const [u, v] of [[-.2, 0], [.2, 0], [0, -.2], [0, .2], [-.2, -.2], [.2, .2]]) {
    const f = await create(); const p = place(f, 'white-pawn-center', u, v); physics.preSettlePhysics(f.runtime);
    // Restore exact authored boundary after solver's tiny lateral drift, preserving true floor support.
    const position = p.body.translation(); p.body.setTranslation({ ...position, x: -u * H, z: v * H }, false);
    assert.equal(nextEvaluation(f).beneficiaryId, p.instance.id, `inclusive boundary ${u},${v}`);
  }
  const outside = await create([['white-pawn-center', .2001, 0]]); assert.equal(state(outside).status, 'empty');
  const tie = await create([['white-pawn-left', -.12, 0], ['white-pawn-right', .12, 0]]);
  const left = tie.runtime.pieces.get('white-pawn-left'), right = tie.runtime.pieces.get('white-pawn-right');
  left.body.setTranslation({ ...left.body.translation(), x: .12 * H, z: 0 }, false);
  right.body.setTranslation({ ...right.body.translation(), x: -.12 * H, z: 0 }, false);
  assert.equal(nextEvaluation(tie).beneficiaryId, 'white-pawn-left', 'equal distance uses stable ID order');
  place(tie, 'white-pawn-right', .04, .10); physics.preSettlePhysics(tie.runtime);
  assert.equal(nextEvaluation(tie).beneficiaryId, 'white-pawn-right', 'nearer center wins');
  const airborne = await create(); place(airborne, 'white-pawn-center', 0, 0, meta.cellSize * 2);
  assert.equal(nextEvaluation(airborne).status, 'empty', 'stationary airborne piece is ineligible');
  const fixed = await create(); const king = place(fixed, 'white-king', 0, 0, meta.cellSize * 2);
  king.body.setBodyType(rapier.RigidBodyType.Fixed, true);
  assert.equal(nextEvaluation(fixed).status, 'empty', 'unsupported Fixed king is ineligible');
  king.body.setBodyType(rapier.RigidBodyType.Dynamic, true); place(fixed, king.instance.id, 0, 0); physics.preSettlePhysics(fixed.runtime);
  king.body.setBodyType(rapier.RigidBodyType.Fixed, true);
  assert.equal(nextEvaluation(fixed).beneficiaryId, king.instance.id, 'Fixed king with real floor support is eligible');
  single.runtime.pieces.get('white-pawn-center').body.setLinvel({ x: 2, y: 0, z: 0 }, true);
  assert.equal(nextEvaluation(single).status, 'empty', 'moving piece is ineligible');
  console.log('PASS ZONE01/MAP06: 16 stable spawns; empty/sole/opponent/contested; inclusive boundaries; nearest and ID tie; moving/airborne/Fixed support');

  const ratios = [];
  for (const [type, id] of [['Pawn', 'white-pawn-center'], ['Rook', 'white-rook'], ['Knight', 'white-knight'], ['Bishop', 'white-bishop'], ['Queen', 'white-queen'], ['King', 'white-king']]) {
    const plain = await create([[id, 0, 0]]), bonus = await create([[id, 0, 0]]);
    zone.expireControlZoneBonus(plain.t);
    const mass = bonus.runtime.pieces.get(id).body.mass();
    assert.equal(queue(plain, id, .1).accepted, true); assert.equal(queue(bonus, id, .1).accepted, true);
    assert.equal(state(bonus).status, 'bonus', 'queue reservation must not consume');
    assert.equal(turn.applyPendingLaunchBeforeStep(plain.t), true); assert.equal(turn.applyPendingLaunchBeforeStep(bonus.t), true);
    const ratio = bonus.t.lastLaunchInitialSpeed / plain.t.lastLaunchInitialSpeed;
    assert.ok(Math.abs(ratio - 1.15) < 1e-5, `${type} actual Rapier impulse ratio ${ratio}`);
    assert.equal(bonus.runtime.pieces.get(id).body.mass(), mass, 'bonus must not modify mass');
    assert.equal(state(bonus).status, 'spent'); assert.equal(zone.consumeControlZoneLaunch(bonus.t, id), 1, 'one use only');
    if (type === 'Knight') {
      const a = plain.runtime.pieces.get(id).body.linvel(), b = bonus.runtime.pieces.get(id).body.linvel();
      assert.ok(Math.abs(a.y / Math.hypot(a.x, a.z) - b.y / Math.hypot(b.x, b.z)) < 1e-5, 'knight angle unchanged');
    }
    ratios.push({ type, ratio });
  }
  const heavy = await create([['white-pawn-center', 0, 0]]), heavyPlain = await create([['white-pawn-center', 0, 0]]);
  for (const f of [heavy, heavyPlain]) {
    const p = f.runtime.pieces.get('white-pawn-center'); p.collider.setMass(p.body.mass() * 2); p.body.recomputeMassPropertiesFromColliders();
  }
  zone.expireControlZoneBonus(heavyPlain.t); queue(heavy, 'white-pawn-center', .1); queue(heavyPlain, 'white-pawn-center', .1);
  turn.applyPendingLaunchBeforeStep(heavy.t); turn.applyPendingLaunchBeforeStep(heavyPlain.t);
  assert.ok(Math.abs(heavy.t.lastLaunchInitialSpeed / heavyPlain.t.lastLaunchInitialSpeed - 1.15) < 1e-5, 'mass increase cannot stack speed');
  const otherLaunch = await create([['white-pawn-center', 0, 0]]);
  const ownMass = otherLaunch.runtime.pieces.get('white-pawn-center').body.mass(); queue(otherLaunch); turn.applyPendingLaunchBeforeStep(otherLaunch.t);
  assert.equal(state(otherLaunch).status, 'spent'); assert.equal(otherLaunch.runtime.pieces.get('white-pawn-center').body.mass(), ownMass);
  const cancel = await create([['white-pawn-center', 0, 0]]); queue(cancel, 'white-pawn-center'); cancel.t.pendingLaunch = null;
  assert.equal(turn.applyPendingLaunchBeforeStep(cancel.t), false); assert.equal(state(cancel).status, 'bonus'); finish(cancel);
  assert.equal(state(cancel).side, 'black'); assert.equal(state(cancel).beneficiaryId, null);
  console.log('PASS ZONE02: six actual launch ratios and doubled-mass ratio = 1.15; knight angle preserved; actual application consumes, cancel does not; other piece consumes', JSON.stringify(ratios));

  const swap = await create(); assert.equal(turn.executeKingSwap(swap.t, 'white-king', 'white-pawn-center'), true);
  place(swap, 'white-king', 0, 0); physics.preSettlePhysics(swap.runtime); zone.beginControlZoneTurn(swap.t);
  assert.equal(state(swap).status, 'empty', 'same-turn swap/camera/rerender does not mint a bonus');
  const defense = await create([['white-pawn-center', 0, 0]]);
  assert.equal(turn.executeKingDefense(defense.t, 'white-king'), true);
  defense.t.phase = 'settling'; defense.t.pendingTurnChange = true; finish(defense);
  assert.equal(state(defense).beneficiaryId, null, 'turn-ending king action expires the grant');
  const promoted = await create([['white-pawn-center', 0, 0]]);
  physics.promotePieceBody(promoted.runtime, 'white-pawn-center', 'Queen', meta);
  step(promoted); assert.equal(state(promoted).status, 'spent', 'promoted replacement does not inherit stale grant');
  const removed = await create([['white-pawn-center', 0, 0]]);
  place(removed, 'white-pawn-center', 0, 0, config.FALL_OUT_Y - meta.cellSize * 2); step(removed);
  assert.equal(state(removed).status, 'spent'); assert.equal(removed.runtime.pieces.has('white-pawn-center'), false);
  const advance = await create([['black-pawn-center', 0, 0]]);
  queue(advance); finish(advance);
  assert.equal(advance.t.currentSide, 'black'); assert.equal(state(advance).beneficiaryId, 'black-pawn-center');
  const grant = state(advance); zone.beginControlZoneTurn(advance.t); assert.equal(state(advance), grant, 'ready/camera duplicate callbacks are idempotent');
  console.log('PASS ZONE02: swap cannot mint, king turn end expires, removal/promotion invalidates, final settlement grants next side once');

  const reset = await create();
  const counts = { bodies: reset.runtime.world.bodies.len(), colliders: reset.runtime.world.colliders.len(), joints: reset.runtime.world.impulseJoints.len(), meshes: reset.scene.scene.children.length };
  for (let restart = 0; restart < 20; restart++) {
    place(reset, 'white-pawn-center', 0, 0); physics.preSettlePhysics(reset.runtime); nextEvaluation(reset);
    assert.equal(state(reset).status, 'bonus');
    maps.disposeHotseatMap(reset.runtime, reset.scene);
    assert.equal(state(reset), undefined);
    physics.rebuildPhysicsBoard(reset.runtime, meta, H, options); physics.resetPhysicsPieces(reset.runtime, meta, instances, options);
    maps.installHotseatMap(reset.runtime, reset.scene, definition, meta); physics.preSettlePhysics(reset.runtime); turn.resetTurnRuntime(reset.t);
    assert.equal(state(reset).status, 'empty'); assert.equal(state(reset).turnNumber, 0);
    assert.deepEqual({ bodies: reset.runtime.world.bodies.len(), colliders: reset.runtime.world.colliders.len(), joints: reset.runtime.world.impulseJoints.len(), meshes: reset.scene.scene.children.length }, counts);
    assert.equal(reset.scene.scene.children.filter(mesh => mesh.name === 'ControlZone-control-center').length, 1);
  }
  for (const mode of ['hotseat', 'stage', 'weekly', 'puzzle', 'tutorial', 'online']) {
    maps.disposeHotseatMap(reset.runtime, reset.scene);
    const modeOptions = { gameMode: mode, stageNumber: 3 };
    const modeH = config.deriveBoardHalfExtent(meta.cellSize);
    physics.rebuildPhysicsBoard(reset.runtime, meta, modeH, modeOptions); physics.resetPhysicsPieces(reset.runtime, meta, layout.PIECE_INSTANCES, modeOptions);
    for (const mesh of reset.scene.pieceMeshes.values()) reset.scene.scene.remove(mesh);
    reset.scene.pieceMeshes = new Map([...reset.runtime.pieces.keys()].map(id => { const mesh = new Mesh(); reset.scene.scene.add(mesh); return [id, mesh]; }));
    turn.setTurnGameMode(reset.t, mode); turn.resetTurnRuntime(reset.t);
    assert.equal(state(reset), undefined); assert.equal(reset.runtime.hotseatMap, undefined); assert.equal(reset.runtime.pieces.size, 32);
    assert.ok(!reset.scene.scene.children.some(mesh => mesh.name.startsWith('ControlZone-')));
    if (mode !== 'hotseat') assert.throws(() => maps.installHotseatMap(reset.runtime, reset.scene, definition, meta), /Hotseat maps/);
    assert.equal(queue(reset, 'white-rook-a1', .1).accepted, true); assert.equal(turn.applyPendingLaunchBeforeStep(reset.t), true);
    assert.ok(Math.abs(reset.t.lastLaunchInitialSpeed - config.getMaxLaunchSpeed(mode, 'Rook', reset.t.tuningSettings.maxLaunchSpeed) * .1) < 1e-5);
    if (mode === 'stage') assert.equal(reset.runtime.breakableWalls.size, 32);
  }
  const different = await create(); maps.disposeHotseatMap(different.runtime, different.scene);
  maps.installHotseatMap(different.runtime, different.scene, maps.getHotseatMapDefinition('gm-ice-lane-v1'), meta);
  assert.equal(state(different), undefined); assert.ok(!different.scene.scene.children.some(mesh => mesh.name.startsWith('ControlZone-')));
  assert.equal(Object.keys(display.CONTROL_ZONE_COPY).length, 9);
  for (const language of Object.keys(display.CONTROL_ZONE_COPY)) {
    assert.equal(display.CONTROL_ZONE_COPY[language].length, 5); i18n.I18nManager.setLanguage(language);
  }
  console.log('PASS MAP04/05/ZONE02: 20 reset cycles keep bodies/colliders/joints/meshes; default and five other modes clean and preserve real launch speed; other map cleanup; nine-locale status');
} finally { for (const world of worlds) world.free(); await vite.close(); }
