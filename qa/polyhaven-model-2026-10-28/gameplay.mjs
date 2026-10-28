import assert from 'node:assert/strict';
import { build } from '../../web/node_modules/vite/dist/node/index.js';
import { chromium } from '../../.orca/ui-check/node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const dir = resolve('qa/polyhaven-model-2026-10-28', process.argv.includes('--small') ? 'small' : '.');
const output = resolve(dir, 'observed-dist');
const evidence = { checkedAt: new Date().toISOString(), method: 'Observation-only temporary build; original input policy and real physics; no body/result/time manipulation', shots: [], errors: [], external: [] };
await mkdir(dir, { recursive: true });
await build({ root: resolve('web'), mode: 'crazygames', logLevel: 'error', build: { outDir: output, emptyOutDir: true }, plugins: [{
  name: 'cg-readonly-observation', enforce: 'pre', transform(code, id) {
    if (!id.replaceAll('\\', '/').endsWith('/src/main.ts')) return;
    const marker = '  marketingRuntime.ready();';
    assert.equal(code.split(marker).length, 2);
    return code.replace(marker, `${marker}\n(window as any).__cgQA = {tutorialManager,turnRuntime,inputRuntime,physicsRuntime,sceneRuntime,menuRuntime,gameModeRuntime,marketingRuntime};`);
  },
}] });
const mime = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://local').pathname);
    const target = resolve(output, '.' + (path === '/' ? '/index.html' : path));
    assert.ok(target.startsWith(output + sep));
    res.setHeader('Content-Type', mime[extname(target)] ?? 'application/octet-stream');
    res.end(await readFile(target));
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const portrait = process.argv.includes('--portrait');
const capture = process.argv.includes('--capture');
const stageCapture = process.argv.includes('--stage-capture');
const small = process.argv.includes('--small');
const viewport = small ? { width: 821, height: 462 } : portrait ? { width: 1080, height: 1620 } : { width: 1920, height: 1080 };
evidence.viewport = viewport;
const context = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'ko-KR', ...(capture ? { recordVideo: { dir: resolve(dir, 'raw-video'), size: viewport } } : {}) });
await context.route('**/*', r => { if (new URL(r.request().url()).origin === origin) return r.continue(); evidence.external.push(r.request().url()); return r.abort(); });
const page = await context.newPage();
const pageVideo = page.video();
page.setDefaultTimeout(20000);
page.on('pageerror', e => evidence.errors.push(e.message));
const snapshot = () => page.evaluate(() => {
  const q = window.__cgQA;
  return { step: q.tutorialManager.currentStep, active: q.tutorialManager.isActive, mode: q.gameModeRuntime.mode, stage: q.gameModeRuntime.stageNumber, side: q.turnRuntime.currentSide, phase: q.turnRuntime.phase, speed: q.turnRuntime.lastLaunchInitialSpeed, pieces: [...q.physicsRuntime.pieces.values()].map(p => ({ id: p.instance.id, side: p.instance.side, removed: p.removed, position: p.body.translation() })) };
});
async function shoot(id, targetId, powerPixels = 150) {
  await page.waitForFunction(() => __cgQA.turnRuntime.phase === 'ready' && __cgQA.turnRuntime.currentSide === 'white' && __cgQA.inputRuntime.cameraTransition === null);
  ({ id, targetId } = await page.evaluate(({ id, targetId }) => {
    const pieces = __cgQA.physicsRuntime.pieces;
    const shooter = pieces.get(id) ?? [...pieces.values()].find(p => p.instance.side === 'white' && p.instance.type === 'Pawn');
    if (!shooter) throw Error('No available player piece for capture');
    const p = shooter.body.translation();
    const enemies = [...pieces.values()].filter(p => p.instance.side === 'black');
    enemies.sort((a,b) => { const x=a.body.translation(), y=b.body.translation(); return Math.hypot(x.x-p.x,x.z-p.z)-Math.hypot(y.x-p.x,y.z-p.z); });
    const target = pieces.get(targetId) ?? enemies[0];
    if (!target) throw Error('No remaining opponent for capture');
    return { id: shooter.instance.id, targetId: target.instance.id };
  }, { id, targetId }));
  const point = await page.evaluate(id => {
    const q = __cgQA, m = q.sceneRuntime.pieceMeshes.get(id), rect = q.sceneRuntime.renderer.domElement.getBoundingClientRect();
    m.geometry.computeBoundingBox(); m.updateMatrixWorld(true);
    const v = m.geometry.boundingBox.getCenter(m.position.clone()); v.y = m.geometry.boundingBox.max.y * .85; v.applyMatrix4(m.matrixWorld).project(q.sceneRuntime.camera);
    return { x: rect.x + (v.x + 1) * rect.width / 2, y: rect.y + (1 - v.y) * rect.height / 2 };
  }, id);
  await page.mouse.click(point.x, point.y);
  await page.waitForFunction(id => __cgQA.inputRuntime.aimRuntime.selectedPieceId === id && __cgQA.inputRuntime.cameraTransition === null, id);
  const drag = await page.evaluate(({targetId, powerPixels}) => {
    const q = __cgQA, rect = q.sceneRuntime.renderer.domElement.getBoundingClientRect();
    const selected = q.sceneRuntime.pieceMeshes.get(q.inputRuntime.aimRuntime.selectedPieceId);
    selected.geometry.computeBoundingBox(); selected.updateMatrixWorld(true);
    const origin = q.inputRuntime.aimParametersRuntime.currentSolution?.applicationPoint.clone() ?? selected.geometry.boundingBox.getCenter(selected.position.clone());
    if (!q.inputRuntime.aimParametersRuntime.currentSolution) { origin.y = selected.geometry.boundingBox.max.y * .85; origin.applyMatrix4(selected.matrixWorld); }
    const t = q.physicsRuntime.pieces.get(targetId).body.translation();
    const target = origin.clone().set(t.x, origin.y, t.z).project(q.sceneRuntime.camera);
    const dot = origin.project(q.sceneRuntime.camera);
    const x = rect.x + (dot.x + 1) * rect.width / 2, y = rect.y + (1 - dot.y) * rect.height / 2;
    const dx = (target.x - dot.x) * rect.width / 2, dy = -(target.y - dot.y) * rect.height / 2;
    const length = Math.hypot(dx, dy);
    return { x, y, toX: x - dx / length * powerPixels, toY: y - dy / length * powerPixels };
  }, { targetId, powerPixels });
  const before = await page.evaluate(() => __cgShots.length);
  await page.mouse.move(drag.x, drag.y); await page.mouse.down();
  if (small && !evidence.explicitCancel) {
    const cancel = await page.locator('.classic-cancel-btn').boundingBox();
    assert.ok(cancel);
    await page.mouse.move(cancel.x + cancel.width / 2, cancel.y + cancel.height / 2, { steps: 12 }); await page.mouse.up();
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => __cgShots.length), before);
    evidence.explicitCancel = { accepted: false, button: cancel };
    return shoot(id, targetId, powerPixels);
  }
  Object.assign(drag, await page.evaluate(({targetId, powerPixels, drag}) => {
    const q = __cgQA, aim = q.inputRuntime.aimRuntime.activeAim;
    const t = q.physicsRuntime.pieces.get(targetId).body.translation();
    const p = q.physicsRuntime.pieces.get(aim.pieceId).body.translation();
    const direction = aim.basis.forward.clone().set(t.x - p.x, 0, t.z - p.z).normalize();
    return { toX: drag.x - direction.dot(aim.basis.right) * powerPixels, toY: drag.y + direction.dot(aim.basis.forward) * powerPixels };
  }, { targetId, powerPixels, drag }));
  await page.mouse.move(drag.toX, drag.toY, { steps: 20 }); await page.waitForTimeout(250); await page.mouse.up();
  await page.waitForFunction(before => __cgShots.length > before && __cgShots.at(-1).accepted && __cgQA.turnRuntime.lastLaunchInitialSpeed > 0, before, { timeout: 5000 });
  const result = await page.evaluate(() => ({ ...__cgShots.at(-1), speed: __cgQA.turnRuntime.lastLaunchInitialSpeed }));
  evidence.shots.push({ id, targetId, drag, ...result }); console.log('SHOT', JSON.stringify(result));
}
try {
  await page.goto(origin);
  await page.waitForFunction(() => !!window.__cgQA);
  assert.equal(await page.evaluate(() => localStorage.getItem('app_language')), 'en');
  await page.locator('#menu-recommendation-btn').click();
  await page.locator('.main-menu-overlay').waitFor({ state: 'hidden' });
  await page.evaluate(() => {
    const original = __cgQA.inputRuntime.policy.queueLaunch;
    window.__cgShots = [];
    __cgQA.inputRuntime.policy.queueLaunch = req => { const result = original(req); __cgShots.push({ piece: req.pieceId, power: req.normalizedPower, ...result, at: performance.now() }); return result; };
  });
  await page.waitForTimeout(800);
  console.log('INITIAL', JSON.stringify(await snapshot()));
  await page.screenshot({ path: resolve(dir, `tutorial-${portrait ? 'portrait' : 'landscape'}.png`) });
  evidence.captureStarted = Date.now();
  if (capture) await page.evaluate(() => {
    const canvas = __cgQA.sceneRuntime.renderer.domElement;
    const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8'].find(t => MediaRecorder.isTypeSupported(t));
    const chunks = [], recorder = new MediaRecorder(canvas.captureStream(60), { mimeType, videoBitsPerSecond: 14_000_000 });
    window.__cgRecording = new Promise(resolve => { recorder.onstop = () => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.readAsDataURL(new Blob(chunks, { type: mimeType })); }; });
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); }; recorder.start();
    setTimeout(() => recorder.stop(), 16500);
  });
  await shoot('white-pawn-d6', 'black-pawn-d8', small ? 80 : 150);
  await page.waitForFunction(() => __cgQA.tutorialManager.currentStep === 2, null, { timeout: 25000 });
  evidence.step1 = await snapshot(); console.log('STEP2');
  await shoot('white-pawn-c5', 'black-pawn-f8', small ? 100 : 165);
  await page.waitForFunction(() => __cgQA.tutorialManager.currentStep === 3, null, { timeout: 25000 });
  evidence.step2 = await snapshot(); console.log('STEP3');
  await shoot('white-rook-d3', 'black-king-d8', small ? 120 : 220);
  if (capture) {
    const base64 = await page.evaluate(() => __cgRecording);
    await writeFile(resolve(dir, `gameplay-${portrait ? 'portrait' : 'landscape'}.webm`), Buffer.from(base64, 'base64'));
  }
  evidence.final = await snapshot();
  if (!capture || stageCapture) {
    await page.locator('#btn-tutorial-start-stage').waitFor();
    evidence.tutorialCompleted = await page.locator('.tutorial-modal-overlay').innerText();
    await page.locator('#btn-tutorial-start-stage').click();
    await page.waitForFunction(() => __cgQA.gameModeRuntime.mode === 'stage' && __cgQA.turnRuntime.phase === 'ready');
    evidence.stageInitial = await snapshot(); console.log('STAGE', evidence.stageInitial.pieces.length);
    if (stageCapture) {
      const began = Date.now();
      evidence.stageCaptureStarted = began;
      await shoot('white-pawn-e2', 'black-pawn-e7', small ? 90 : 180);
      await shoot('white-pawn-c2', 'black-pawn-c7', small ? 90 : 180);
      await shoot('white-pawn-g2', 'black-pawn-g7', small ? 90 : 180);
      await page.waitForTimeout(Math.max(0, 16500 - (Date.now() - began)));
      evidence.stagePreview = await snapshot();
    } else {
      await page.getByRole('button', { name: 'Billiards', exact: true }).click();
      await shoot('white-pawn-e2', 'black-pawn-e7', 160);
      evidence.billiardsShot = evidence.shots.at(-1);
      // Legal center launches outwards exercise a real complete loss. AI takes every intervening turn.
      evidence.autoplay = [];
      for (let turn = 0; turn < 25; turn++) {
        await page.waitForFunction(() => !!document.querySelector('.promotion-piece-card') || __cgQA.turnRuntime.phase === 'match-over' || (__cgQA.turnRuntime.phase === 'ready' && __cgQA.turnRuntime.currentSide === 'white'), null, { timeout: 45000 });
        if (await page.locator('.promotion-piece-card').count()) {
          // The modal can close automatically between animation frames; click its visible bounds.
          const box = await page.locator('.promotion-piece-card[data-piece-type="Queen"]').boundingBox();
          if (box) {
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
            evidence.promotionClicks = (evidence.promotionClicks ?? 0) + 1;
          }
          await page.waitForTimeout(400);
          continue;
        }
        if ((await snapshot()).phase === 'match-over') break;
        const shot = await page.evaluate(() => {
          const q = __cgQA, piece = [...q.physicsRuntime.pieces.values()].find(p => p.instance.side === 'white');
          const center = piece.body.worldCom(), t = piece.body.translation();
          const dir = Math.abs(t.x) > Math.abs(t.z) ? [Math.sign(t.x),0,0] : [0,0,Math.sign(t.z) || -1];
          const request = { pieceId: piece.instance.id, normalizedPower: 1, direction: q.sceneRuntime.camera.position.clone().set(...dir), applicationPoint: q.sceneRuntime.camera.position.clone().set(center.x, center.y, center.z) };
          return { id: piece.instance.id, ...q.inputRuntime.policy.queueLaunch(request) };
        });
        assert.equal(shot.accepted, true); evidence.autoplay.push(shot); console.log('LEGAL-SHOT', shot.id);
        await page.waitForTimeout(200);
      }
      assert.equal((await snapshot()).phase, 'match-over');
      evidence.stageLoss = await snapshot();
      await page.screenshot({ path: resolve(dir, 'stage-real-loss.png') });
      console.log('LOSS-BUTTONS', await page.locator('button:visible').allTextContents());
      if (await page.locator('[data-match-restart]').isVisible()) {
        await page.locator('[data-match-restart]').click();
        await page.waitForFunction(() => __cgQA.turnRuntime.phase === 'ready');
        evidence.retry = await snapshot();
      } else if (await page.locator('[data-match-menu]').isVisible()) {
        await page.locator('[data-match-menu]').click();
        await page.locator('#menu-recommendation-btn').waitFor();
        await page.reload(); await page.locator('#menu-recommendation-btn').waitFor();
        evidence.persisted = { hero: await page.locator('#menu-recommendation-btn').innerText(), storage: await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([k]) => /tutorial|progress|meta/.test(k)))) };
        await page.locator('[data-game-mode="stage"]').click();
        await page.locator('#tab-upgrades').click();
        const beforePoints = await page.locator('#pve-points-held').innerText();
        await page.locator('[data-action="increase"][data-stat="force"]').click();
        await page.waitForTimeout(300);
        evidence.research = { before: beforePoints, after: await page.locator('#pve-points-held').innerText(), text: await page.locator('[data-stat="force"]').first().innerText() };
        assert.notEqual(evidence.research.before, evidence.research.after, 'Real earned tutorial points can be spent in piece research');
        await page.locator('#tab-stages').click();
        await page.locator('#pve-start-btn').click();
        await page.waitForFunction(() => __cgQA.turnRuntime.phase === 'ready');
        // UI transition fixture only. This is not evidence of a physics-earned Stage win.
        await page.evaluate(() => { __cgQA.turnRuntime.phase = 'match-over'; __cgQA.turnRuntime.onMatchOver('white'); });
        await page.locator('.upgrade-card').first().waitFor();
        evidence.nextStageFixture = { method: 'Synthetic winner callback in temporary QA build; UI route verification only', result: await page.locator('.match-result-overlay:not([hidden])').innerText() };
        await page.locator('.upgrade-card').first().click();
        await page.waitForFunction(() => __cgQA.gameModeRuntime.stageNumber === 2 && __cgQA.turnRuntime.phase === 'ready');
        evidence.nextStageFixture.stageAfter = (await snapshot()).stage;
      }
    }
  }
  assert.deepEqual(evidence.errors, []); assert.deepEqual(evidence.external, []);
} catch (error) {
  evidence.error = String(error); evidence.final = await snapshot().catch(() => null);
  await page.screenshot({ path: resolve(dir, 'gameplay-failure.png') }); throw error;
} finally {
  await writeFile(resolve(dir, `gameplay-${small ? 'small' : portrait ? 'portrait' : 'landscape'}-${stageCapture ? 'preview' : capture ? 'tutorial' : 'flow'}-results.json`), JSON.stringify(evidence, null, 2));
  await context.close();
  if (capture) await pageVideo.saveAs(resolve(dir, `full-gameplay-${portrait ? 'portrait' : 'landscape'}.webm`));
  await browser.close(); await new Promise(r => server.close(r));
}
