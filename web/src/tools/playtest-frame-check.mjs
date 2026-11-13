import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { MathUtils, PerspectiveCamera, Vector3 } from 'three';

const powerSource = readFileSync(new URL('../power-controls.ts', import.meta.url), 'utf8');
const sceneSource = readFileSync(new URL('../scene.ts', import.meta.url), 'utf8');
const exponent = Number(powerSource.match(/export const MOUSE_POWER_EXPONENT = ([\d.]+)/)?.[1]);
const helpers = powerSource.match(/export function computeViewportPullReserve[\s\S]*?(?=export function powerControlsCopy)/)?.[0];
const functions = ['computeMinimumCameraDistance', 'computeBoardProjectionOffset', 'centerBoardProjection'].map(name =>
  sceneSource.match(new RegExp(`function ${name}\\([\\s\\S]*?\\r?\\n}\\r?\\n`))?.[0]);
assert.ok(helpers && functions.every(Boolean), 'actual power and camera helpers exist');
const js = stripTypeScriptTypes(`${helpers}\n${functions.join('\n')}`).replaceAll('export ', '') +
  '\nreturn { computeViewportPowerDistance, powerAtPullDistance, pullDistanceForPower, computeMinimumCameraDistance, centerBoardProjection };';
const api = new Function('MathUtils', 'Vector3', 'CAMERA_PITCH_DEG', 'CAMERA_FIT_MARGIN', 'MOUSE_POWER_EXPONENT', js)(MathUtils, Vector3, 48, 1.06, exponent);

for (const [width, height] of [[800, 248], [1366, 610], [1920, 922], [390, 686], [400, 400], [900, 600], [3840, 2160]]) {
  for (let degrees = 0; degrees <= 90; degrees += 15) {
    const direction = new Vector3(Math.sin(degrees * Math.PI / 180), 0, -Math.cos(degrees * Math.PI / 180));
    const camera = new PerspectiveCamera(42, width / height, 0.05, 100);
    const distance = api.computeMinimumCameraDistance(camera, direction, 4, width, height);
    const pitch = MathUtils.degToRad(48), polar = Math.PI / 2 - pitch;
    camera.position.copy(direction.clone().multiplyScalar(Math.cos(pitch) * distance));
    camera.position.y = Math.sin(pitch) * distance;
    camera.lookAt(0, 0, 0);
    const runtime = { camera, boardHalfExtent: 4, boardTop: 0, minimumCameraDistance: distance,
      controls: { target: new Vector3(), minDistance: distance, minPolarAngle: polar, maxPolarAngle: polar },
      renderer: { domElement: { getBoundingClientRect: () => ({ width, height }) } } };
    api.centerBoardProjection(runtime);
    const projected = [];
    for (const x of [-4, 4]) for (const z of [-4, 4]) {
      const p = new Vector3(x, 0, z).project(camera);
      projected.push({ x: (p.x + 1) * width / 2, y: (1 - p.y) * height / 2 });
    }
    const top = Math.min(...projected.map(p => p.y)), bottom = Math.max(...projected.map(p => p.y));
    assert.ok(Math.abs(top + bottom - height * 1.07) < 1e-6, 'board framing retains headroom for tall pieces');
    if (width / height >= 1.5) assert.ok((bottom - top) / height >= .55, 'desktop board height reaches 55%');
    for (const preferred of [180, 240, 360]) {
      const actual = api.computeViewportPowerDistance(preferred, width, height);
      const pull = api.pullDistanceForPower(1.5, actual, exponent);
      assert.ok(actual <= preferred);
      assert.ok(Math.abs(api.powerAtPullDistance(pull, actual, 1.5, exponent) - 1.5) < 1e-9);
      for (const p of projected) {
        const margin = Math.min(p.x, width - p.x, p.y, height - p.y);
        assert.ok(margin + 1e-6 >= pull, `${width}x${height}/${degrees}deg: margin ${margin} < 150% pull ${pull}`);
      }
    }
    runtime.controls.maxPolarAngle += .1;
    api.centerBoardProjection(runtime);
    assert.equal(camera.view.enabled, false, 'free billiards keeps its centered projection');
  }
}
assert.ok(api.pullDistanceForPower(.3, api.computeViewportPowerDistance(180, 1366, 566), exponent) >= 50);
console.log('PASS headroom, desktop board size, fixed mouse scale and planar 150% board-corner clearance; actual piece starts checked in browser QA');
