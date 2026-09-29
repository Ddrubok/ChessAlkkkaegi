import './headless-browser-env.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { Mesh, Scene, Vector3 } from 'three';

const root = fileURLToPath(new URL('../..', import.meta.url));
const original = await readFile(new URL('../../balance.csv', import.meta.url), 'utf8');
const meta = JSON.parse(await readFile(new URL('../../public/assets/chess-set.meta.json', import.meta.url), 'utf8'));

function change(csv, pattern, transform) {
  let count = 0;
  const result = csv.replace(/^([^,\r\n]+),([^,\r\n]+),/gm, (row, key, value) => {
    if (!pattern.test(key)) return row;
    count++;
    return `${key},${transform(Number(value))},`;
  });
  assert.equal(count, 1, `Expected one CSV row for ${pattern}`);
  return result;
}

async function sample(csv) {
  const vite = await createServer({ root, configFile: false, logLevel: 'error',
    server: { middlewareMode: true, hmr: false, ws: false },
    plugins: [{ name: 'balance-test-fixture', enforce: 'pre', load(id) {
      if (id.replaceAll('\\', '/').endsWith('/balance.csv?raw')) return `export default ${JSON.stringify(csv)}`;
    } }],
  });
  let runtime;
  try {
    const config = await vite.ssrLoadModule('/src/config.ts');
    const physics = await vite.ssrLoadModule('/src/physics.ts');
    const turn = await vite.ssrLoadModule('/src/turn.ts');
    const layout = await vite.ssrLoadModule('/src/layout.ts');
    const tuning = await vite.ssrLoadModule('/src/tuning.ts');
    runtime = await physics.createPhysicsRuntime(meta, layout.PIECE_INSTANCES,
      config.deriveBoardHalfExtent(meta.cellSize), { gameMode: 'online', stageNumber: 1 });
    const pawn = [...runtime.pieces.values()].find(b => b.instance.type === 'Pawn' && b.instance.side === 'white');
    const queen = [...runtime.pieces.values()].find(b => b.instance.type === 'Queen' && b.instance.side === 'white');
    const scene = { scene: new Scene(), controls: { enabled: true },
      pieceMeshes: new Map([...runtime.pieces.keys()].map(id => [id, new Mesh()])) };
    const turns = turn.createTurnRuntime(runtime, scene, { maxLaunchSpeed: config.MAX_LAUNCH_SPEED, strikeHeightRatio: 0 });
    turn.setTurnGameMode(turns, 'online');
    pawn.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    turns.pendingLaunch = { pieceId: pawn.instance.id, direction: new Vector3(1, 0, 0),
      normalizedPower: 1, applicationPoint: new Vector3().copy(pawn.body.worldCom()), speedMultiplier: 1 };
    assert.equal(turn.applyPendingLaunchBeforeStep(turns), true);
    const result = { mass: pawn.originalHullMass, queenMass: queen.originalHullMass,
      speed: new Vector3().copy(pawn.body.linvel()).length(),
      friction: pawn.collider.friction(), boardFriction: runtime.boardCollider.friction(),
      restitution: pawn.collider.restitution(), storageKey: tuning.TUNING_SETTINGS_STORAGE_KEY };
    const replaced = physics.replacePieceBody(runtime, pawn.instance.id, meta.pieces.Pawn.colliderPoints, config.PIECE_DENSITY);
    assert.ok(Math.abs(replaced.originalHullMass / result.mass - 1) < 1e-5, 'Replacement must apply weight once');
    const promoted = physics.promotePieceBody(runtime, pawn.instance.id, 'Queen', meta);
    assert.ok(Math.abs(promoted.originalHullMass / result.queenMass - 1) < 1e-5, 'Promotion must use new piece weight');
    return result;
  } finally {
    runtime?.world.free();
    await vite.close();
  }
}

const baseline = await sample(original);
let patched = change(original, /^PAWN_WEIGHT_MULTIPLIER$/, value => value * 1.25);
patched = change(patched, /^PAWN_POWER_MULTIPLIER$/, value => value * 0.8);
patched = change(patched, /^CLASSIC_FRICTION$/, () => 0.3);
patched = change(patched, /^PIECE_RESTITUTION$/, () => 0.4);
const changed = await sample(patched);
assert.ok(Math.abs(changed.mass / baseline.mass - 1.25) < 1e-5, 'CSV weight must change real Rapier mass');
assert.ok(Math.abs(changed.speed / baseline.speed - 0.8) < 1e-5, 'CSV power must change real launch velocity');
assert.ok(Math.abs(changed.friction - 0.3) < 1e-6);
assert.ok(Math.abs(changed.boardFriction - 0.3) < 1e-6);
assert.ok(Math.abs(changed.restitution - 0.4) < 1e-6);
assert.notEqual(changed.storageKey, baseline.storageKey, 'Old local tuning must not override a new CSV');
console.log('PASS: edited CSV changes real mass, launch speed, friction, restitution; replacement, promotion and tuning isolation checked.');
