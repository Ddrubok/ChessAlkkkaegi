import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { MathUtils, PerspectiveCamera, Vector3 } from 'three';

const powerSource = readFileSync(new URL('../power-controls.ts', import.meta.url), 'utf8');
const sceneSource = readFileSync(new URL('../scene.ts', import.meta.url), 'utf8');
const helpers = powerSource.match(/export function computeViewportPullReserve[\s\S]*?(?=export function powerControlsCopy)/)?.[0];
const fit = sceneSource.match(/function computeMinimumCameraDistance\([\s\S]*?\r?\n}\r?\n/)?.[0];
assert.ok(helpers && fit, 'viewport and camera fit helpers exist');
const js = stripTypeScriptTypes(`${helpers}\n${fit}`).replaceAll('export ', '') + '\nreturn { computeViewportPullReserve, computeViewportPowerDistance, computeMinimumCameraDistance };';
const { computeViewportPullReserve, computeViewportPowerDistance, computeMinimumCameraDistance } =
  new Function('MathUtils', 'Vector3', 'CAMERA_PITCH_DEG', 'CAMERA_FIT_MARGIN', js)(MathUtils, Vector3, 48, 1.06);

for (const [width, height] of [[800, 450], [1366, 768], [390, 844], [3840, 2160]]) {
  const reserve = computeViewportPullReserve(width, height);
  assert.equal(reserve, Math.min(width, height) * 0.18);
  for (const preferred of [180, 240, 360]) {
    const actual = computeViewportPowerDistance(preferred, width, height);
    assert.equal(actual, Math.min(preferred, reserve * 0.8 / 1.5));
    assert.ok(1.5 * actual <= reserve * 0.8 + 1e-9);
  }
  for (const direction of [new Vector3(0, 0, -1), new Vector3(1, 0, -1).normalize(), new Vector3(-1, 0, 0)]) {
    const camera = new PerspectiveCamera(42, width / height, 0.05, 100);
    const distance = computeMinimumCameraDistance(camera, direction, 4, width, height);
    const pitch = MathUtils.degToRad(48);
    camera.position.copy(direction.clone().multiplyScalar(Math.cos(pitch) * distance));
    camera.position.y = Math.sin(pitch) * distance;
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    for (const x of [-4, 4]) for (const z of [-4, 4]) {
      const screen = new Vector3(x, 0, z).project(camera);
      assert.ok(Math.abs(screen.x) <= 1 - 2 * reserve / width + 1e-6, `${width}x${height} horizontal reserve`);
      assert.ok(Math.abs(screen.y) <= 1 - 2 * reserve / height + 1e-6, `${width}x${height} vertical reserve`);
    }
  }
}
assert.equal(computeViewportPowerDistance(180, 800, 450), computeViewportPowerDistance(360, 800, 450));
assert.equal(computeViewportPowerDistance(180, 3840, 2160), 180);
console.log('playtest frame geometry: ok');
