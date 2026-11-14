import './headless-browser-env.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { Vector3 } from 'three';

const vite = await createServer({ configFile: false, logLevel: 'error', server: { middlewareMode: true, hmr: false } });
try {
  const [launch, config, aim] = await Promise.all([
    vite.ssrLoadModule('/src/launch.ts'),
    vite.ssrLoadModule('/src/config.ts'),
    vite.ssrLoadModule('/src/aim.ts'),
  ]);
  const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} !== ${expected}`);
  for (const gameMode of ['hotseat', 'online', 'stage']) {
    for (const pieceType of ['Pawn', 'Knight', 'Queen', 'Rook']) {
      for (const power of [0, .35, 1, 1.5]) {
        const direction = new Vector3(3, 0, 4);
        const options = { gameMode, pieceType, normalizedPower: power, direction,
          maxLaunchSpeed: 11, speedMultiplier: 1.25, controlMultiplier: 1.2 };
        const result = launch.computeLaunchKinematics(options);
        const effectivePower = pieceType === 'Knight' ? config.computeKnightEffectivePower(power) : power;
        close(result.effectivePower, effectivePower);
        close(result.targetSpeed, effectivePower * config.getMaxLaunchSpeed(gameMode, pieceType, 11) * 1.25 * 1.2);
        close(result.direction.length(), 1);
        if (pieceType === 'Knight') {
          close(result.direction.y, Math.sin(config.KNIGHT_LAUNCH_ANGLE));
          close(result.direction.x, .6 * Math.cos(config.KNIGHT_LAUNCH_ANGLE));
        } else {
          close(result.direction.x, .6);
          close(result.direction.y, 0);
        }
        assert.deepEqual(direction.toArray(), [3, 0, 4], 'input direction stays unchanged');
      }
    }
  }
  const elevated = launch.computeLaunchKinematics({ gameMode: 'hotseat', pieceType: 'Knight',
    normalizedPower: .5, direction: { x: 1, y: .2, z: 0 }, maxLaunchSpeed: 11 });
  close(elevated.direction.y, .2 / Math.hypot(1, .2));
  const fallback = launch.computeLaunchKinematics({ gameMode: 'hotseat', pieceType: 'Knight',
    normalizedPower: .5, direction: { x: 0, y: 0, z: 0 }, maxLaunchSpeed: 11 });
  close(fallback.direction.z, Math.cos(config.KNIGHT_LAUNCH_ANGLE));
  const guideOptions = { gameMode: 'stage', maxLaunchSpeed: 11, speedMultiplier: 1.4, controlMultiplier: 1.2 };
  const start = new Vector3(0, 1, 0), guideDirection = new Vector3(1, 0, 0);
  const predicted = launch.computeLaunchKinematics({ ...guideOptions, pieceType: 'Knight',
    normalizedPower: .35, direction: guideDirection });
  const points = aim.computeKnightTrajectoryPoints(start, guideDirection, .35, 8, guideOptions);
  const firstStep = points[1].position.clone().sub(start);
  close(firstStep.x / points[1].time, predicted.direction.x * predicted.targetSpeed);
  close((firstStep.y - .5 * config.GRAVITY_Y * points[1].time ** 2) / points[1].time,
    predicted.direction.y * predicted.targetSpeed);
  assert.throws(() => launch.computeLaunchKinematics({ gameMode: 'hotseat', pieceType: 'Pawn',
    normalizedPower: .5, direction: { x: 1, y: 0, z: 0 }, maxLaunchSpeed: 11, speedMultiplier: 0 }));
  console.log('PASS KN-R01 launch kinematics: mode/piece/power/multipliers, Knight direction, read-only input, speed validation');
} finally {
  await vite.close();
}
