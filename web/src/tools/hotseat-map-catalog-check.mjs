import './headless-browser-env.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Mesh, Scene } from 'three';
import { createServer } from 'vite';

// Exercise all menu entries through the actual map installer and reset path.
// Canvas is stubbed only for headless textures; browser QA checks appearance.
const createElement = document.createElement;
document.createElement = tag => tag !== 'canvas' ? createElement(tag) : {
  width: 0, height: 0,
  getContext: () => new Proxy({}, { get: () => () => {}, set: () => true }),
};
const vite = await createServer({ root: fileURLToPath(new URL('../..', import.meta.url)), configFile: false,
  logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false } });
let runtime;
const originalInfo = console.info;
console.info = () => {};
try {
  const [catalog, maps, physics, config, layout, i18n] = await Promise.all([
    'maps/map-catalog', 'maps/hotseat-map-runtime', 'physics', 'config', 'layout', 'i18n',
  ].map(name => vite.ssrLoadModule(`/src/${name}.ts`)));
  const meta = JSON.parse(await readFile(new URL('../../public/assets/chess-set.meta.json', import.meta.url), 'utf8'));
  const entries = catalog.HOTSEAT_MAP_CATALOG;
  assert.equal(entries.length, 14, 'classic plus all thirteen planned maps must be selectable');
  assert.equal(new Set(entries.map(entry => entry.id)).size, entries.length);
  const options = { gameMode: 'hotseat', stageNumber: 1 };
  const classicHalfExtent = config.deriveBoardHalfExtent(meta.cellSize);
  runtime = await physics.createPhysicsRuntime(meta, layout.PIECE_INSTANCES, classicHalfExtent, options);
  for (const entry of entries.filter(entry => entry.id !== catalog.DEFAULT_HOTSEAT_MAP_ID)) {
    assert.notEqual(i18n.I18nManager.t(entry.nameKey), entry.nameKey, 'missing map title');
    assert.notEqual(i18n.I18nManager.t(entry.descriptionKey), entry.descriptionKey, 'missing map description');
    const definition = maps.getHotseatMapDefinition(entry.id, meta);
    assert.ok(definition, `unregistered map: ${entry.id}`);
    assert.equal(definition.revision, entry.revision);
    assert.equal(definition.spawns.length, 16);
    const H = classicHalfExtent * definition.boardScale;
    physics.rebuildPhysicsBoard(runtime, meta, H, options);
    physics.resetPhysicsPieces(runtime, meta, definition.spawns.map(spawn => spawn.instance), options);
    const scene = new Scene(), board = new Mesh(); scene.add(board);
    const pieceMeshes = new Map([...runtime.pieces.values()].map(piece => {
      const mesh = new Mesh(); scene.add(mesh); return [piece.instance.id, mesh];
    }));
    const sceneRuntime = { scene, pieceMeshes, boardMeshes: [board], boardMesh: board,
      boardHalfExtent: H, boardTop: runtime.boardTop, boardFloorRectangles: runtime.boardFloorRectangles,
      boardHoleRectangles: runtime.boardHoleRectangles, boardFloorLayoutKey: runtime.boardFloorLayoutKey,
      controls: { enabled: true }, breakableWallMeshes: new Map() };
    const baselineMeshes = scene.children.length;
    for (let restart = 0; restart < 2; restart++) {
      if (restart) physics.resetPhysicsPieces(runtime, meta, definition.spawns.map(spawn => spawn.instance), options);
      maps.installHotseatMap(runtime, sceneRuntime, definition, meta);
      physics.validateSpawnOverlaps(runtime, meta, false);
      physics.preSettlePhysics(runtime);
      for (let step = 0; step < 120; step++) runtime.world.step();
      const grounded = maps.collectHotseatGroundedIds(runtime);
      for (const piece of runtime.pieces.values()) {
        assert.ok(grounded.has(piece.instance.id), `${entry.id}: unsupported starting piece ${piece.instance.id}`);
        assert.ok(piece.body.translation().y > config.FALL_OUT_Y);
      }
      maps.disposeHotseatMap(runtime, sceneRuntime);
      assert.equal(runtime.hotseatMap, undefined);
      assert.equal(runtime.world.bodies.len(), 17, `${entry.id}: object body leak`);
      assert.equal(runtime.world.colliders.len(), 17, `${entry.id}: object or surface collider leak`);
      assert.equal(runtime.world.impulseJoints.len(), 0, `${entry.id}: joint leak`);
      assert.equal(scene.children.length, baselineMeshes, `${entry.id}: mesh leak`);
      assert.equal(board.visible, true);
    }
    physics.rebuildPhysicsBoard(runtime, meta, classicHalfExtent, options);
    physics.resetPhysicsPieces(runtime, meta, layout.PIECE_INSTANCES, options);
    physics.preSettlePhysics(runtime);
    assert.equal(runtime.pieces.size, 32);
    assert.equal(runtime.world.bodies.len(), 33);
    assert.equal(runtime.boardColliders.length, 1);
    assert.equal(runtime.boardHoleRectangles.length, 0);
    assert.ok(Math.abs(runtime.boardCollider.friction() - config.getPieceFriction('hotseat')) < 1e-6);
    console.log(`PASS ${entry.id}: menu lookup, stable spawns, restart, cleanup, classic restoration`);
  }
} finally {
  runtime?.world.free();
  console.info = originalInfo;
  await vite.close();
}
