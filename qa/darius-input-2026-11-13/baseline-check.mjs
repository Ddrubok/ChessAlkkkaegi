import { createServer } from '../../web/node_modules/vite/dist/node/index.js';
import { chromium } from '../../.orca/ui-check/node_modules/playwright/index.mjs';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative } from 'node:path';

const root = resolve('web/src');
const out = resolve(process.argv[2] ?? 'qa/darius-input-2026-11-13/baseline');
await mkdir(out, { recursive: false });
async function hashes(dir = root) {
  const result = {};
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) Object.assign(result, await hashes(path));
    else if (entry.isFile()) result[relative(root, path).replaceAll('\\', '/')] = createHash('sha256').update(await readFile(path)).digest('hex');
  }
  return result;
}
const before = await hashes();
const server = await createServer({
  root: resolve('web'), mode: 'itch', logLevel: 'error',
  cacheDir: resolve('.orca/darius-baseline-vite'),
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { host: '127.0.0.1', port: 0, open: false, hmr: false },
  plugins: [{ name: 'darius-baseline-inspection', transform(code, id) {
    if (!id.replaceAll('\\', '/').endsWith('/src/main.ts')) return;
    return code.replace('let gameLoopStarted = false;',
      'globalThis.__playtestQA={sceneRuntime,inputRuntime,physicsRuntime,turnRuntime,aimRuntime,aimParametersRuntime,tutorialManager,selectPiece,switchInputMode,resetBoard,get gameMode(){return gameModeRuntime;}};let gameLoopStarted = false;');
  } }],
});
await server.listen();
const origin = 'http://127.0.0.1:' + server.httpServer.address().port;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const result = { scope: 'Automated local Edge browser; real opening and pointer gesture; analytical projection separate from pointer check',
  origin, sourceBefore: before, deniedOrigins: [], pageErrors: [], measurements: [] };
let context, page;
try {
  context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: 'en-US', serviceWorkers: 'block' });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    if (!result.deniedOrigins.includes(url.origin)) result.deniedOrigins.push(url.origin);
    return route.abort();
  });
  await context.routeWebSocket('**/*', socket => socket.close());
  page = await context.newPage();
  page.on('pageerror', error => result.pageErrors.push(error.message));
  await page.goto(origin);
  await page.locator('.tutorial-gesture circle').waitFor({ timeout: 30000 });
  await page.waitForFunction(() => globalThis.__playtestQA?.turnRuntime.phase === 'ready');
  const cue = page.locator('.tutorial-gesture circle');
  const x = Number(await cue.getAttribute('cx'));
  const y = Number(await cue.getAttribute('cy'));
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 100, { steps: 8 });
  await page.mouse.up();
  await page.locator('#feedback-start-stage').waitFor({ timeout: 30000 });
  await page.locator('#feedback-start-stage').click();
  await page.locator('.mastery-hud-objective').filter({ hasText: 'Stage 1/10' }).waitFor({ timeout: 30000 });
  for (const [width, height] of [[1920, 1080], [1366, 768]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(300);
    const data = await page.evaluate(async () => {
      const q = globalThis.__playtestQA, s = q.sceneRuntime, c = s.camera;
      const r = s.renderer.domElement.getBoundingClientRect();
      c.updateMatrixWorld(true); c.updateProjectionMatrix();
      const project = p => { const v = p.clone().project(c); return { x: r.left + (v.x + 1) * r.width / 2, y: r.top + (1 - v.y) * r.height / 2 }; };
      const point = (x, y, z) => { const v = c.position.clone(); v.set(x, y, z); return project(v); };
      const h = s.boardHalfExtent, board = [point(-h, s.boardTop, -h), point(h, s.boardTop, -h), point(h, s.boardTop, h), point(-h, s.boardTop, h)];
      const bbox = pts => ({ left: Math.min(...pts.map(p => p.x)), top: Math.min(...pts.map(p => p.y)), right: Math.max(...pts.map(p => p.x)), bottom: Math.max(...pts.map(p => p.y)) });
      const cross = (a, b) => a.x * b.y - a.y * b.x;
      const area = Math.abs(board.reduce((sum, p, i) => sum + cross(p, board[(i + 1) % 4]), 0)) / 2;
      const pieces = [...s.pieceMeshes].filter(([, m]) => m.visible).map(([id, m]) => {
        m.updateMatrixWorld(true); if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        const box = m.geometry.boundingBox, pts = [];
        for (const xx of [box.min.x, box.max.x]) for (const yy of [box.min.y, box.max.y]) for (const zz of [box.min.z, box.max.z]) {
          const v = c.position.clone().set(xx, yy, zz).applyMatrix4(m.matrixWorld); pts.push(project(v));
        }
        const bounds = bbox(pts);
        return { id, bounds, minBorderDistance: Math.min(bounds.left - r.left, r.right - bounds.right, bounds.top - r.top, r.bottom - bounds.bottom) };
      });
      const controls = await import('/src/power-controls.ts');
      const presets = [180, 240, 360].map(preferred => ({ preferred, actual: controls.computeViewportPowerDistance(preferred, r.width, r.height) }));
      return { viewport: { width: innerWidth, height: innerHeight }, canvas: { x: r.x, y: r.y, width: r.width, height: r.height },
        camera: { position: c.position.toArray(), target: s.controls.target.toArray(), currentDistance: c.position.distanceTo(s.controls.target), minimumCameraDistance: s.minimumCameraDistance, controlsMinDistance: s.controls.minDistance, controlsMaxDistance: s.controls.maxDistance },
        board: { polygon: board, bbox: bbox(board), bboxHeight: bbox(board).bottom - bbox(board).top, polygonArea: area }, pieces, presets,
        phase: q.turnRuntime.phase, stage: q.gameMode?.stageNumber };
    });
    result.measurements.push(data);
    await page.screenshot({ path: resolve(out, `stage1-${width}x${height}.png`) });
  }
  const aimPoint = await page.evaluate(() => {
    const q = globalThis.__playtestQA, s = q.sceneRuntime, c = s.camera, r = s.renderer.domElement.getBoundingClientRect();
    const piece = [...q.physicsRuntime.pieces.values()].find(p => p.instance.side === q.turnRuntime.currentSide);
    const m = s.pieceMeshes.get(piece.instance.id); m.updateMatrixWorld(true);
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    const p = m.geometry.boundingBox.getCenter(c.position.clone()).applyMatrix4(m.matrixWorld).project(c);
    return { id: piece.instance.id, x: r.left + (p.x + 1) * r.width / 2, y: r.top + (1 - p.y) * r.height / 2 };
  });
  const actualDistance = result.measurements.at(-1).presets[0].actual;
  await page.mouse.move(aimPoint.x, aimPoint.y);
  await page.mouse.down();
  const targetDistance = await page.evaluate(async distance => {
    const mod=await import('/src/power-controls.ts'), exponent=globalThis.__playtestQA.inputRuntime.gesture?.powerExponent ?? 1;
    return mod.pullDistanceForPower ? mod.pullDistanceForPower(.3,distance,exponent) : distance*.3;
  },actualDistance);
  await page.mouse.move(aimPoint.x, aimPoint.y + targetDistance, { steps: 8 });
  result.pointerAim = await page.evaluate(() => {
    const q = globalThis.__playtestQA;
    return { selectedPieceId: q.aimRuntime.selectedPieceId, power: q.aimRuntime.activeAim?.normalizedPower,
      gesture: q.inputRuntime.gesture ? { source: q.inputRuntime.gesture.source, maxDragPixels: q.inputRuntime.gesture.maxDragPixels } : null };
  });
  result.pointerAim.start = aimPoint;
  result.pointerAim.end = { x: aimPoint.x, y: aimPoint.y + targetDistance };
  await page.screenshot({ path: resolve(out, 'stage1-1366x768-30percent-aim.png') });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  result.pointerAim.afterCancel = await page.evaluate(() => ({ gesture: globalThis.__playtestQA.inputRuntime.gesture, phase: globalThis.__playtestQA.turnRuntime.phase }));
} catch (error) {
  result.failure = error.stack;
} finally {
  result.sourceAfter = await hashes();
  result.sourcesChangedDuringRun = Object.keys({ ...result.sourceBefore, ...result.sourceAfter }).filter(k => result.sourceBefore[k] !== result.sourceAfter[k]);
  await writeFile(resolve(out, 'result.json'), JSON.stringify(result, null, 2));
  await browser.close(); await server.close();
  console.log(JSON.stringify({ out, measurements: result.measurements.length, pointerAim: result.pointerAim, sourcesChangedDuringRun: result.sourcesChangedDuringRun, failure: result.failure }));
  if (result.failure) process.exitCode = 1;
}
