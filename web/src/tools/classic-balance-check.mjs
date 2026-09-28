import './headless-browser-env.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Mesh, Scene, Vector3 } from 'three';
import { createServer } from 'vite';

const vite = await createServer({
  root: fileURLToPath(new URL('../..', import.meta.url)), configFile: false,
  logLevel: 'error', server: { middlewareMode: true, hmr: false },
});
let world;
try {
  const config = await vite.ssrLoadModule('/src/config.ts');
  const physics = await vite.ssrLoadModule('/src/physics.ts');
  const turn = await vite.ssrLoadModule('/src/turn.ts');
  const layout = await vite.ssrLoadModule('/src/layout.ts');
  const aim = await vite.ssrLoadModule('/src/aim.ts');
  const meta = JSON.parse(await readFile(new URL('../../public/assets/chess-set.meta.json', import.meta.url), 'utf8'));
  world = await physics.createPhysicsRuntime(meta, layout.PIECE_INSTANCES,
    config.deriveBoardHalfExtent(meta.cellSize), { gameMode: 'online', stageNumber: 1 });
  const scene = { scene: new Scene(), controls: { enabled: true },
    pieceMeshes: new Map([...world.pieces.keys()].map(id => [id, new Mesh()])) };
  let checked = 0;
  for (const mode of ['online', 'hotseat', 'stage', 'weekly', 'tutorial', 'puzzle']) {
    for (const side of ['white', 'black']) {
      for (const type of config.PIECE_TYPES) {
        const binding = [...world.pieces.values()].find(b => b.instance.type === type && b.instance.side === side);
        for (const power of type === 'Rook' ? [0.25, 1, 1.5] : [0.25, 1]) {
          binding.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
          binding.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
          const runtime = turn.createTurnRuntime(world, scene, { maxLaunchSpeed: 9, strikeHeightRatio: 0 });
          turn.setTurnGameMode(runtime, mode);
          runtime.currentSide = side;
          // Exercise the production impulse path directly; puzzle queue has separate scenario constraints.
          runtime.pendingLaunch = { pieceId: binding.instance.id,
            direction: new Vector3(1, 0, 0), normalizedPower: power,
            applicationPoint: new Vector3().copy(binding.body.worldCom()), speedMultiplier: 1 };
          assert.equal(turn.applyPendingLaunchBeforeStep(runtime), true);
          const actual = new Vector3().copy(binding.body.linvel()).length();
          const effectivePower = type === 'Knight' ? 0.38 + 0.62 * power : power;
          const expected = effectivePower * (mode === 'online' ? type === 'Knight' ? 4.5 : 7 : 9);
          assert.ok(Math.abs(actual - expected) < 1e-5, `${mode}/${side}/${type}/${power}: ${actual} != ${expected}`);
          checked++;
        }
      }
    }
  }
  const direction = new Vector3(Math.cos(config.KNIGHT_LAUNCH_ANGLE), Math.sin(config.KNIGHT_LAUNCH_ANGLE), 0);
  for (const speed of [4.5, 7, 11]) {
    const points = aim.computeKnightTrajectoryPoints(new Vector3(0, 0.2, 0), direction, 0.5, 16, speed);
    const vx = (points[1].position.x - points[0].position.x) / points[1].time;
    assert.ok(Math.abs(vx - 0.69 * speed * direction.x) < 1e-10, 'Knight guide uses launch speed');
  }
  console.log(`PASS: ${checked} real Rapier launch checks; both sides, six modes, Rook overdrive, Knight trajectory.`);
} finally {
  world?.world.free();
  await vite.close();
}
