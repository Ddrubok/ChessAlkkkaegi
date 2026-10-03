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
  const [physics, maps, collapse, zone, definitions, config, tuning, turn, surfaces, layout, display, i18n] = await Promise.all([
    'physics', 'maps/hotseat-map-runtime', 'maps/collapsing-floor', 'maps/control-zone', 'maps/c05',
    'config', 'tuning', 'turn', 'maps/surface-materials', 'layout', 'maps/collapsing-floor-display', 'i18n',
  ].map(name => vite.ssrLoadModule(`/src/${name}.ts`)));
  const meta = JSON.parse(await readFile(new URL('../../public/assets/chess-set.meta.json', import.meta.url), 'utf8'));
  const definition = definitions.C05_MAP, options = { gameMode: 'hotseat', stageNumber: 1 };
  const H = config.deriveBoardHalfExtent(meta.cellSize) * definition.boardScale;
  const instances = definition.spawns.map(spawn => spawn.instance);
  const sceneFor = runtime => {
    const scene = new Scene(), board = new Mesh(); scene.add(board);
    const pieceMeshes = new Map([...runtime.pieces.values()].map(piece => { const mesh = new Mesh(); scene.add(mesh); return [piece.instance.id, mesh]; }));
    return { scene, pieceMeshes, boardMeshes: [board], boardMesh: board, boardHalfExtent: H, boardTop: runtime.boardTop,
      boardFloorRectangles: runtime.boardFloorRectangles, boardHoleRectangles: runtime.boardHoleRectangles,
      boardFloorLayoutKey: runtime.boardFloorLayoutKey, controls: { enabled: true }, breakableWallMeshes: new Map() };
  };
  async function create() {
    const runtime = await physics.createPhysicsRuntime(meta, instances, H, options); worlds.push(runtime.world);
    const scene = sceneFor(runtime); maps.installHotseatMap(runtime, scene, definition, meta);
    physics.validateSpawnOverlaps(runtime, meta, false); physics.preSettlePhysics(runtime);
    const t = turn.createTurnRuntime(runtime, scene, tuning.createDefaultRuntimeTuningSettings(), meta.cellSize);
    return { runtime, scene, t };
  }
  const state = f => collapse.getCollapsingFloorState(f.runtime);
  const control = f => zone.getControlZoneState(f.runtime);
  const step = f => { turn.applyPendingLaunchBeforeStep(f.t); f.runtime.world.step(); turn.updateTurnAfterStep(f.t, config.FIXED_STEP); };
  function place(f, id, u, v) {
    const p = f.runtime.pieces.get(id);
    p.body.setTranslation({ x: -u * H, y: p.spawnTranslation.y, z: v * H }, true);
    p.body.setRotation(p.spawnRotation, true); p.body.setLinvel({ x: 0, y: 0, z: 0 }, true); p.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    f.runtime.world.propagateModifiedBodyPositionsToColliders();
    return p;
  }
  function queue(f, id = `${f.t.currentSide}-rook`, power = .0001, direction = new Vector3(1, 0, 0)) {
    const p = f.runtime.pieces.get(id);
    assert.ok(p, 'real launcher exists');
    assert.equal(turn.queueTurnLaunch(f.t, { pieceId: id, normalizedPower: power, direction,
      applicationPoint: new Vector3().copy(p.body.worldCom()) }).accepted, true);
  }
  function finish(f, duringStep = () => {}) {
    let steps = 0;
    while (f.t.phase === 'settling' && steps++ < 2400) { step(f); duringStep(); }
    assert.ok(steps < 2400, 'actual turn settles'); return steps;
  }
  function shot(f) { queue(f); return finish(f); }
  const surfaceIds = f => new Set(f.runtime.boardColliders.map(c => surfaces.getBoardSurfaceId(c)));
  const collapsedIds = f => [...state(f).collapsedSurfaceIds].sort();
  const counts = f => ({ bodies: f.runtime.world.bodies.len(), colliders: f.runtime.world.colliders.len(),
    joints: f.runtime.world.impulseJoints.len(), meshes: f.scene.scene.children.length });
  const initial = await create();
  assert.equal(initial.runtime.pieces.size, 16);
  assert.equal(initial.runtime.hotseatMap.dynamicObjects.size, 0);
  assert.equal(initial.runtime.boardBody.numColliders(), initial.runtime.boardColliders.length, 'no duplicate floor');
  assert.equal(initial.scene.boardMeshes.length, initial.runtime.boardColliders.length);
  for (const spawn of definition.spawns.filter(s => s.instance.id.endsWith('pawn-center'))) {
    assert.equal(spawn.v, spawn.instance.side === 'white' ? -.64 : .64);
  }
  for (let i = 0; i < 1200; i++) step(initial);
  assert.equal(state(initial).shots, 0); assert.equal(control(initial).status, 'empty');
  assert.ok([...initial.runtime.pieces.values()].every(p => p.body.translation().y > config.FALL_OUT_Y));
  console.log('PASS C05 MAP06: 16 nonoverlapping supported pieces, central pawns at ±.64, 10 seconds idle without collapse');

  // Exercise actual language subscriptions and badge updates without claiming
  // a browser layout check. The parent verifies the compact dual HUD in-browser.
  const querySelector = document.querySelector, createElement = document.createElement;
  const hud = { appendChild(badge) { this.badge = badge; } };
  document.querySelector = () => hud;
  document.createElement = tag => tag === 'div' ? { ...createElement(tag), setAttribute() {} } : createElement(tag);
  const statusDisplay = display.createCollapsingFloorDisplay(initial.runtime, { ...initial.scene, scene: new Scene() });
  const completedCopy = {
    ko: '주변 발판 붕괴', en: 'Surrounding platforms collapsed', ja: '周囲の足場が崩壊', 'zh-CN': '周围踏板已坍塌',
    de: 'Umliegende Plattformen eingestürzt', fr: 'Plateformes alentour effondrées',
    es: 'Las plataformas de alrededor han colapsado', ru: 'Окружающие площадки обрушились', 'pt-BR': 'Plataformas ao redor desabaram',
  };
  for (const [language, complete] of Object.entries(completedCopy)) {
    i18n.I18nManager.setLanguage(language);
    statusDisplay.update(0, new Set()); assert.ok(hud.badge.textContent.includes('6 / 10'));
    statusDisplay.update(6, new Set(['collapse-south', 'collapse-north'])); assert.ok(hud.badge.textContent.includes('4'));
    statusDisplay.update(10, new Set(definition.surfaces.map(surface => surface.id))); assert.equal(hud.badge.textContent, complete);
  }
  statusDisplay.dispose(); i18n.I18nManager.setLanguage('ko');
  document.querySelector = querySelector; document.createElement = createElement;
  console.log('PASS C05 UI02: nine language platform status updates, 6 / 10 grouped countdown, central floor never described as collapsed');

  const threshold = await create();
  let settled = 0, mastery = 0, results = 0;
  threshold.t.onTurnSettled = () => settled++;
  threshold.t.onMasterySettlement = () => mastery++;
  threshold.t.onMatchOver = () => results++;
  const snapshots = [];
  const southNorth = ['collapse-north', 'collapse-south'];
  const all = ['collapse-east', 'collapse-north', 'collapse-south', 'collapse-west'];
  for (let n = 1; n <= 11; n++) {
    let falling, survivor;
    if (n === 6 || n === 10) {
      survivor = place(threshold, 'white-pawn-center', 0, 0);
      falling = n === 6 ? place(threshold, 'white-pawn-left', 0, -.39) : place(threshold, 'white-pawn-right', -.39, 0);
      physics.preSettlePhysics(threshold.runtime); falling.body.sleep();
      assert.equal(falling.body.isSleeping(), true);
    }
    const previousControl = { ...control(threshold) };
    const previousFloors = new Map(threshold.runtime.boardColliders.map(c => [c.handle, surfaces.getBoardSurfaceId(c)]));
    queue(threshold);
    if (falling) {
      let steps = 0;
      while (state(threshold).shots < n && steps++ < 2400) step(threshold);
      assert.ok(steps < 2400);
      assert.equal(threshold.t.phase, 'settling', 'extra falling precedes next turn');
      assert.equal(settled, n - 1); assert.equal(mastery, n - 1); assert.equal(results, 0);
      assert.deepEqual(control(threshold), previousControl, 'next turn control evaluation waits for extra falling');
      assert.equal(falling.body.isSleeping(), false, 'sleeping occupant wakes on support loss');
      const removed = [...previousFloors].filter(([handle]) => !threshold.runtime.boardColliders.some(c => c.handle === handle)).map(([, id]) => id).sort();
      assert.deepEqual(removed, n === 6 ? southNorth : ['collapse-east', 'collapse-west'], 'only the scheduled group is removed');
      const extraSteps = finish(threshold, () => {
        if (threshold.t.phase === 'settling') {
          assert.equal(settled, n - 1); assert.equal(mastery, n - 1);
          assert.deepEqual(control(threshold), previousControl);
        }
      });
      assert.equal(threshold.runtime.pieces.has(falling.instance.id), false, 'tile occupant naturally falls out');
      assert.equal(threshold.t.settlementRemovedPieces.filter(p => p.id === falling.instance.id).length, 1);
      assert.ok(threshold.runtime.pieces.has(survivor.instance.id), 'central floor survives');
      assert.equal(control(threshold).turnNumber, threshold.t.turnNumber);
      assert.equal(control(threshold).side, 'white'); assert.equal(control(threshold).status, 'bonus');
      assert.equal(control(threshold).beneficiaryId, survivor.instance.id);
      console.log(`PASS C05 SETTLE02/ZONE01: shot ${n} support removal, ${extraSteps} extra steps, next turn crown awarded after falling`);
    } else finish(threshold);
    assert.equal(state(threshold).shots, n, 'one terrain count per real shot');
    assert.equal(settled, n); assert.equal(mastery, n); assert.equal(results, 0, 'one final settlement per shot');
    const expected = n < 6 ? [] : n < 10 ? southNorth : all;
    assert.deepEqual(collapsedIds(threshold), expected);
    assert.deepEqual(threshold.runtime.boardHoleRectangles.map(h => h.id).sort(), expected);
    for (const id of all) {
      assert.equal(surfaceIds(threshold).has(id), !expected.includes(id), `collision state ${n}/${id}`);
      assert.equal(threshold.scene.boardMeshes.some(mesh => mesh.name.startsWith(`MapFloor-${id}-`)), !expected.includes(id), `visible state ${n}/${id}`);
    }
    assert.equal(threshold.runtime.boardBody.numColliders(), threshold.runtime.boardColliders.length);
    assert.equal(threshold.scene.boardMeshes.length, threshold.runtime.boardColliders.length);
    assert.equal(threshold.scene.boardFloorLayoutKey, threshold.runtime.boardFloorLayoutKey);
    assert.equal(collapse.commitSettledHotseatTerrain(threshold.t), false, 'finalized launch cannot recount');
    if ([5, 6, 7, 9, 10, 11].includes(n)) snapshots.push({ shot: n, collapsed: expected, floors: threshold.runtime.boardColliders.length });
  }
  console.log('PASS C05 COLLAPSE01: actual shots 5/6/7/9/10/11 exact groups; central floor survives', JSON.stringify(snapshots));

  // Use the fully collapsed real map. Launch the base king through a diagonal
  // corner of the surviving plaza; measure its path rather than infer width visually.
  for (const [id, p] of threshold.runtime.pieces) if (!['white-king', 'black-king'].includes(id)) {
    threshold.runtime.world.removeRigidBody(p.body); threshold.runtime.pieces.delete(id);
    threshold.scene.scene.remove(threshold.scene.pieceMeshes.get(id)); threshold.scene.pieceMeshes.delete(id);
  }
  place(threshold, 'black-king', -.75, .75);
  const king = place(threshold, 'white-king', .45, -.45);
  physics.preSettlePhysics(threshold.runtime);
  threshold.t.phase = 'ready'; threshold.t.currentSide = 'white'; threshold.t.pendingTurnChange = false;
  queue(threshold, king.instance.id, .12, new Vector3(1, 0, 1).normalize());
  let supported = true;
  const routeSteps = finish(threshold, () => {
    if (!threshold.runtime.pieces.has(king.instance.id)) { supported = false; return; }
    supported &&= king.body.translation().y > threshold.runtime.boardTop - meta.cellSize * .1;
  });
  assert.ok(supported && threshold.runtime.pieces.has(king.instance.id), 'base king crosses surviving diagonal floor without falling');
  const finalPosition = king.body.translation(), finalUV = [-finalPosition.x / H, finalPosition.z / H];
  assert.ok(finalUV.every(value => Math.abs(value) <= .20), 'actual king route settles inside the control zone');
  const route = { power: .12, direction: [1, 0, 1], startUV: [.45, -.45], finalUV, steps: routeSteps };
  console.log('PASS C05 diagonal king route after shot 10', JSON.stringify(route));

  const reset = await create(), baseline = counts(reset);
  for (let restart = 0; restart < 20; restart++) {
    for (let n = 0; n < 10; n++) shot(reset);
    assert.deepEqual(collapsedIds(reset), all);
    const oldMap = reset.runtime.hotseatMap;
    maps.disposeHotseatMap(reset.runtime, reset.scene);
    assert.equal(zone.getControlZoneState(reset.runtime), undefined); assert.equal(collapse.getCollapsingFloorState(reset.runtime), undefined);
    physics.rebuildPhysicsBoard(reset.runtime, meta, H, options);
    physics.resetPhysicsPieces(reset.runtime, meta, instances, options);
    maps.installHotseatMap(reset.runtime, reset.scene, definition, meta);
    physics.preSettlePhysics(reset.runtime); turn.resetTurnRuntime(reset.t);
    assert.notEqual(reset.runtime.hotseatMap, oldMap);
    assert.equal(state(reset).shots, 0); assert.equal(state(reset).lastCommittedLaunchId, 0);
    assert.deepEqual(collapsedIds(reset), []); assert.equal(control(reset).status, 'empty');
    assert.deepEqual(counts(reset), baseline);
    assert.equal(reset.runtime.boardHoleRectangles.length, 0);
    for (const id of all) assert.equal(reset.scene.scene.children.filter(mesh => mesh.name === `CollapseLabel-${id}`).length, 1);
  }
  maps.disposeHotseatMap(reset.runtime, reset.scene);
  physics.rebuildPhysicsBoard(reset.runtime, meta, config.deriveBoardHalfExtent(meta.cellSize), options);
  physics.resetPhysicsPieces(reset.runtime, meta, layout.PIECE_INSTANCES, options);
  turn.resetTurnRuntime(reset.t);
  assert.equal(reset.runtime.pieces.size, 32); assert.equal(reset.runtime.boardColliders.length, 1);
  assert.equal(reset.runtime.hotseatMap, undefined); assert.equal(control(reset), undefined); assert.equal(state(reset), undefined);
  assert.ok(!reset.scene.scene.children.some(mesh => mesh.name.startsWith('CollapseLabel-') || mesh.name.startsWith('ControlZone-')));
  console.log('PASS C05 MAP04/05: 20 real 10-shot/reset cycles restore body/collider/joint/mesh counts; classic 32 pieces and one floor');
} finally {
  for (const world of worlds) world.free();
  await vite.close();
}
