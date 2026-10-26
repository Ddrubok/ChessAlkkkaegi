import { chromium } from '../../.orca/ui-check/node_modules/playwright/index.mjs';
import { preview } from '../../web/node_modules/vite/dist/node/index.js';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const adb = 'C:/Users/DooBokWie/AppData/Local/Android/Sdk/platform-tools/adb.exe';
const device = '10.8.4.105:41399';
const run = (...args) => execFileSync(adb, ['-s', device, ...args], { windowsHide: true, maxBuffer: 20_000_000 });
const dir = resolve('qa/marketing-measurement-2026-10-26');
run('shell', 'am', 'force-stop', 'com.chessalkkagi.app.marketingqa');
run('shell', 'am', 'start', '-n', 'com.chessalkkagi.app.marketingqa/com.chessalkkagi.app.MainActivity');
await new Promise(r => setTimeout(r, 2500));
const pid = run('shell', 'pidof', 'com.chessalkkagi.app.marketingqa').toString().trim();
const socket = `webview_devtools_remote_${pid}`;
assert.ok(socket, 'QA app WebView must be running');
run('forward', 'tcp:9350', `localabstract:${socket}`);
const server = await preview({ root: resolve('web'), build: { outDir: resolve('qa/marketing-crossplay-2026-10-26/assets/public') }, preview: { port: 5352, strictPort: true, host: '127.0.0.1' } });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const native = await chromium.connectOverCDP('http://127.0.0.1:9350', { timeout: 15000 });
const android = native.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('https://localhost'));
assert.ok(android);
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const web = await context.newPage();
const nativeInfo = (await (await fetch('http://127.0.0.1:9350/json')).json()).find(p => p.url.startsWith('https://localhost'));
const bounds = JSON.parse(nativeInfo.description);
const evidence = { checkedAt: new Date().toISOString(), method: 'Web mouse and ADB touchscreen on physical Android; observe real queue acceptance and physics speed', cases: [] };
async function point(page, selected = false) {
  return page.evaluate(selected => {
    const q = __marketingQA, rect = q.sceneRuntime.renderer.domElement.getBoundingClientRect();
    let v;
    if (selected) v = q.inputRuntime.aimParametersRuntime.currentSolution.applicationPoint.clone();
    else {
      const candidates = [...q.physicsRuntime.pieces.values()].filter(p => p.instance.side === q.turnRuntime.currentSide && p.instance.type === 'Pawn');
      const p = candidates[q.turnRuntime.currentSide === 'white' ? 0 : Math.floor(candidates.length / 2)];
      const m = q.sceneRuntime.pieceMeshes.get(p.instance.id); m.geometry.computeBoundingBox(); m.updateMatrixWorld(true);
      v = m.geometry.boundingBox.getCenter(m.position.clone()); v.y = m.geometry.boundingBox.max.y * .85; v.applyMatrix4(m.matrixWorld);
    }
    v.project(q.sceneRuntime.camera); return { x: rect.x + (v.x + 1) * rect.width / 2, y: rect.y + (1 - v.y) * rect.height / 2 };
  }, selected);
}
async function gesture(page, start, end) {
  if (page === web) {
    if (!end) await page.mouse.click(start.x, start.y);
    else { await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y, { steps: 12 }); await page.mouse.up(); }
  } else {
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    const physical = p => [Math.round(bounds.screenX + p.x * bounds.width / viewport.width), Math.round(bounds.screenY + p.y * bounds.height / viewport.height)].map(String);
    if (end) run('shell', 'input', 'touchscreen', 'swipe', ...physical(start), ...physical(end), '400');
    else run('shell', 'input', 'touchscreen', 'tap', ...physical(start));
  }
}
async function fire(page, peer, label, expectedSide) {
  console.log('input', label, expectedSide);
  await Promise.all([page, peer].map(p => p.waitForFunction(side => __marketingQA.turnRuntime.phase === 'ready' && __marketingQA.turnRuntime.currentSide === side, expectedSide, { timeout: 40000 })));
  await page.evaluate(() => {
    const q = __marketingQA, original = q.inputRuntime.policy.queueLaunch;
    window.__shotEvidence = [];
    q.inputRuntime.policy.queueLaunch = request => {
      const result = original(request);
      __shotEvidence.push({ accepted: result.accepted, reason: result.reason, power: request.normalizedPower, side: q.turnRuntime.currentSide, piece: request.pieceId });
      return result;
    };
  });
  const selectionPoint = await point(page);
  evidence.pending = { label, expectedSide, selectionPoint, state: await page.evaluate(() => ({ side: __marketingQA.turnRuntime.currentSide, phase: __marketingQA.turnRuntime.phase, width: innerWidth, height: innerHeight })) };
  console.log('select', JSON.stringify(evidence.pending));
  await gesture(page, selectionPoint);
  await page.waitForFunction(() => !!__marketingQA.inputRuntime.aimRuntime.selectedPieceId && __marketingQA.inputRuntime.cameraTransition === null);
  const dot = await point(page, true);
  console.log('drag', label, JSON.stringify(dot));
  await gesture(page, dot, { x: dot.x, y: Math.min(dot.y + 100, (await page.evaluate(() => innerHeight)) - 80) });
  await page.waitForFunction(() => __shotEvidence.some(e => e.accepted) && __marketingQA.turnRuntime.lastLaunchInitialSpeed > 0, null, { timeout: 5000 });
  const shot = await page.evaluate(() => ({ event: __shotEvidence.at(-1), actualInitialSpeed: __marketingQA.turnRuntime.lastLaunchInitialSpeed }));
  await peer.waitForFunction(() => __marketingQA.turnRuntime.lastLaunchInitialSpeed > 0, null, { timeout: 5000 });
  evidence.cases.push({ label, ...shot });
  delete evidence.pending;
  console.log('accepted', label, JSON.stringify(shot));
  await page.screenshot({ path: resolve(dir, `manual-${label}.png`) });
  await page.waitForFunction(() => __marketingQA.turnRuntime.phase === 'ready', null, { timeout: 40000 });
}
try {
  for (const direction of ['web-host', 'android-host']) {
    await web.goto('http://127.0.0.1:5352/'); await android.reload();
    for (const page of [web, android]) {
      if (await page.locator('#guest-nickname-input').isVisible()) {
        await page.locator('#guest-nickname-input').fill('QA_Input'); await page.locator('#btn-guest-submit').click();
      }
      await page.locator('#menu-profile-btn').waitFor({ timeout: 30000 });
      await page.locator('.lobby-other-modes summary').click();
      await page.locator('[data-game-mode=online]').click();
    }
    const host = direction === 'web-host' ? web : android, guest = host === web ? android : web;
    await host.locator('[data-friendly-host]').click();
    await host.waitForFunction(() => document.querySelector('[data-friendly-room]')?.value.length > 5, null, { timeout: 45000 });
    await guest.locator('[data-friendly-code]').fill(await host.locator('[data-friendly-room]').inputValue());
    await guest.locator('[data-friendly-join]').click();
    await Promise.all([host, guest].map(p => p.waitForFunction(() => !document.querySelector('[data-friendly-host]') && __marketingQA.gameModeRuntime.mode === 'online', null, { timeout: 60000 })));
    await fire(host, guest, `${direction}-host`, 'white');
    await fire(guest, host, `${direction}-guest`, 'black');
    await writeFile(resolve(dir, 'manual-input-results.json'), JSON.stringify(evidence, null, 2));
  }
} catch (error) {
  evidence.error = String(error);
  await Promise.all([web, android].map((p, i) => p.screenshot({ path: resolve(dir, `manual-failure-${i}.png`) }).catch(() => {})));
  throw error;
}
finally {
  await writeFile(resolve(dir, 'manual-input-results.json'), JSON.stringify(evidence, null, 2));
  await native.close(); await browser.close(); await new Promise(r => server.httpServer.close(r));
  run('forward', '--remove', 'tcp:9350');
}
