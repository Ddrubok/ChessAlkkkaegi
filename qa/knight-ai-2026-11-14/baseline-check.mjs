import { createServer } from '../../web/node_modules/vite/dist/node/index.js';
import { chromium } from '../../.orca/ui-check/node_modules/playwright/index.mjs';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative } from 'node:path';

const root = resolve('web/src');
const out = resolve(process.argv[2] ?? 'qa/knight-ai-2026-11-14/baseline');
await mkdir(out, { recursive: false });
async function hashes(dir = root) {
  const found = {};
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) Object.assign(found, await hashes(path));
    else if (entry.isFile()) found[relative(root, path).replaceAll('\\', '/')] = createHash('sha256').update(await readFile(path)).digest('hex');
  }
  return found;
}
const before = await hashes();
const server = await createServer({
  root: resolve('web'), mode: 'itch', logLevel: 'error',
  cacheDir: resolve(out, 'vite-cache'),
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { host: '127.0.0.1', port: 0, open: false, hmr: false },
  plugins: [{ name: 'knight-baseline-inspection', transform(code, id) {
    if (!id.replaceAll('\\', '/').endsWith('/src/main.ts')) return;
    const anchor = 'let gameLoopStarted = false;';
    if (!code.includes(anchor)) throw new Error('QA exposure anchor missing');
    return code.replace(anchor, 'globalThis.__playtestQA={sceneRuntime,inputRuntime,physicsRuntime,turnRuntime,aimRuntime,aimParametersRuntime,aiRuntime,tutorialManager,selectPiece,switchInputMode,resetBoard,get gameMode(){return gameModeRuntime;}};' + anchor);
  } }],
});
await server.listen();
const origin = 'http://127.0.0.1:' + server.httpServer.address().port;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const result = { scope: 'Real local Edge render; controlled test-only board and directed aim. UI screenshots and physical source measurements are separate.', origin, sourceBefore: before, deniedOrigins: [], pageErrors: [], captures: [] };
let context;
try {
  context = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'en-US', serviceWorkers: 'block' });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    if (!result.deniedOrigins.includes(url.origin)) result.deniedOrigins.push(url.origin);
    return route.abort();
  });
  await context.routeWebSocket('**/*', socket => socket.close());
  const page = await context.newPage();
  page.on('pageerror', error => result.pageErrors.push(error.message));
  await page.goto(origin);
  await page.locator('.tutorial-gesture circle').waitFor({ timeout: 30000 });
  await page.waitForFunction(() => globalThis.__playtestQA?.turnRuntime.phase === 'ready');
  const cue = page.locator('.tutorial-gesture circle');
  const x = Number(await cue.getAttribute('cx')), y = Number(await cue.getAttribute('cy'));
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, y + 100, { steps: 8 }); await page.mouse.up();
  await page.locator('#feedback-start-stage').waitFor({ timeout: 30000 });
  await page.locator('#feedback-start-stage').click();
  await page.waitForFunction(() => globalThis.__playtestQA?.gameMode?.mode === 'stage');
  for (const [width, height] of [[1366, 768], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(async () => {
      const q = globalThis.__playtestQA;
      for (const [id, binding] of globalThis.__knightQARemoved ?? []) q.physicsRuntime.pieces.set(id, binding);
      globalThis.__knightQARemoved = [];
      const { setStageNumber } = await import('/src/game-mode.ts');
      setStageNumber(q.gameMode, 4);
      await q.resetBoard({ gameMode: 'stage', stageNumber: 4 });
      q.turnRuntime.currentSide = 'white';
      for (const [id, binding] of q.physicsRuntime.pieces) {
        if (binding.instance.type === 'Knight' && binding.instance.startingSquare.file === 'b') continue;
        globalThis.__knightQARemoved.push([id, binding]);
        q.physicsRuntime.pieces.delete(id);
        const mesh = q.sceneRuntime.pieceMeshes.get(id);
        if (mesh) mesh.visible = false;
      }
    });
    await page.waitForTimeout(350);
    const fixture = await page.evaluate(() => {
      const q = globalThis.__playtestQA;
      return [...q.physicsRuntime.pieces.values()].map(p => ({ id: p.instance.id, type: p.instance.type, side: p.instance.side, position: p.body.translation(), rotation: p.body.rotation(), velocity: p.body.linvel() }));
    });
    const knight = fixture.find(p => p.type === 'Knight' && p.side === 'white');
    if (!knight) throw new Error('No white Knight on controlled stage 4 board');
    const other = fixture.find(p => p.side === 'black');
    const aim = await page.evaluate(async ({ knightId, targetId }) => {
      const q = globalThis.__playtestQA;
      const { Vector3 } = await import('/node_modules/.vite/deps/three.js').catch(() => import('/node_modules/three/build/three.module.js'));
      const { beginDirectedAim, updateDirectedAim, selectAimPiece, setAimApplicationPoint } = await import('/src/aim.ts');
      const source = q.physicsRuntime.pieces.get(knightId), target = q.physicsRuntime.pieces.get(targetId);
      const a = source.body.translation(), b = target.body.translation();
      const direction = new Vector3(b.x - a.x, 0, b.z - a.z).normalize();
      selectAimPiece(q.aimRuntime, knightId);
      const mesh = q.sceneRuntime.pieceMeshes.get(knightId);
      mesh.updateMatrixWorld(true);
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const center = mesh.geometry.boundingBox.getCenter(new Vector3()).applyMatrix4(mesh.matrixWorld);
      setAimApplicationPoint(q.aimRuntime, center);
      beginDirectedAim(q.aimRuntime, knightId, direction);
      updateDirectedAim(q.aimRuntime, direction, .5);
      return { pieceId: knightId, targetId, direction: direction.toArray(), applicationPoint: center.toArray(), activeDirection: q.aimRuntime.activeAim?.direction.toArray(), power: q.aimRuntime.activeAim?.normalizedPower, isKnight: q.aimRuntime.activeAim?.isKnight };
    }, { knightId: knight.id, targetId: other.id });
    await page.waitForTimeout(180);
    await page.screenshot({ path: resolve(out, `knight-aim-${width}x${height}.png`) });
    const aimUi = await page.evaluate(() => ({ guideVisible: [...document.querySelectorAll('canvas, .aim-guide, .power-readout')].filter(e => e.getBoundingClientRect().width > 0).length, phase: globalThis.__playtestQA.turnRuntime.phase }));
    const telegraph = await page.evaluate(async () => {
      const q = globalThis.__playtestQA;
      const { cancelAim } = await import('/src/aim.ts');
      const { updateAiRuntime } = await import('/src/ai.ts');
      cancelAim(q.aimRuntime, true);
      q.turnRuntime.currentSide = 'black';
      q.turnRuntime.phase = 'ready';
      q.aiRuntime.telegraph = null;
      updateAiRuntime(q.aiRuntime, performance.now());
      const t = q.aiRuntime.telegraph;
      if (!t) return null;
      t.previewAt = performance.now() - 100;
      updateAiRuntime(q.aiRuntime, performance.now());
      t.chargeStartedAt = performance.now() - 300;
      updateAiRuntime(q.aiRuntime, performance.now());
      return { decision: t.decision, direction: t.direction.toArray(), applicationPoint: t.applicationPoint.toArray(), chargeStartedAt: t.chargeStartedAt, activeDirection: q.aimRuntime.activeAim?.direction.toArray(), shownPower: q.aimRuntime.activeAim?.normalizedPower, isKnight: q.aimRuntime.activeAim?.isKnight };
    });
    if (!telegraph) throw new Error('AI telegraph not prepared');
    await page.screenshot({ path: resolve(out, `ai-telegraph-${width}x${height}.png`) });
    const aiLaunch = await page.evaluate(async () => {
      const q = globalThis.__playtestQA;
      const t = q.aiRuntime.telegraph;
      const { queueTurnLaunch, applyPendingLaunchBeforeStep } = await import('/src/turn.ts');
      const { computeStageAiSpeedMultiplier } = await import('/src/stage.ts');
      const body = q.physicsRuntime.pieces.get(t.decision.pieceId).body;
      const before = body.linvel();
      const speedMultiplier = computeStageAiSpeedMultiplier({ gameMode: 'stage', stageNumber: 4, enemyBuffStepScale: q.aiRuntime.getEnemyBuffStepScale() });
      const request = { pieceId: t.decision.pieceId, direction: t.direction, normalizedPower: t.decision.power, applicationPoint: t.applicationPoint, speedMultiplier };
      const accepted = queueTurnLaunch(q.turnRuntime, request);
      const applied = applyPendingLaunchBeforeStep(q.turnRuntime);
      const after = body.linvel();
      return { accepted, applied, request: { pieceId: request.pieceId, direction: request.direction.toArray(), power: request.normalizedPower, applicationPoint: request.applicationPoint.toArray(), speedMultiplier }, velocityBefore: before, velocityAfter: after, lastLaunchInitialSpeed: q.turnRuntime.lastLaunchInitialSpeed };
    });
    result.captures.push({ viewport: { width, height }, fixture, knightAim: aim, aimUi, aiTelegraph: telegraph, aiLaunch });
  }
  result.lifecycle = await page.evaluate(async () => {
    const q = globalThis.__playtestQA;
    const { resetAiMatch, updateAiRuntime } = await import('/src/ai.ts');
    const a=q.aiRuntime,t=q.turnRuntime;
    resetAiMatch(a);t.pendingLaunch=null;t.phase='ready';t.currentSide='black';
    const snapshot=q.physicsRuntime.world.takeSnapshot();
    updateAiRuntime(a,1000);
    const prepared=a.telegraph;
    if(!prepared)throw new Error('no re-entry telegraph');
    const afterPreparation=q.physicsRuntime.world.takeSnapshot();
    const unchanged=snapshot.length===afterPreparation.length&&snapshot.every((byte,i)=>byte===afterPreparation[i]);
    const expected={power:prepared.decision.power,direction:prepared.direction.toArray(),speed:prepared.speedMultiplier};
    const originalBuff=a.getEnemyBuffStepScale;
    a.getEnemyBuffStepScale=()=>999;
    updateAiRuntime(a,prepared.previewAt);
    updateAiRuntime(a,prepared.previewAt+1000);
    a.getEnemyBuffStepScale=originalBuff;
    const pending=t.pendingLaunch;
    const matches=!!pending&&pending.normalizedPower===expected.power&&pending.speedMultiplier===expected.speed
      &&pending.direction.toArray().every((v,i)=>v===expected.direction[i]);
    t.pendingLaunch=null;t.phase='ready';t.currentSide='black';resetAiMatch(a);
    updateAiRuntime(a,5000);resetAiMatch(a);
    const originalMode=a.getGameMode;a.getGameMode=()=> 'hotseat';updateAiRuntime(a,9000);a.getGameMode=originalMode;
    const cancelled=a.telegraph===null&&a.scheduledAt===null&&t.pendingLaunch===null&&a.shotCounter===0;
    updateAiRuntime(a,10000);
    const reentered=a.telegraph!==null;
    resetAiMatch(a);
    if(!unchanged||!matches||!cancelled||!reentered)throw new Error('AI lifecycle mismatch '+JSON.stringify({unchanged,matches,cancelled,reentered}));
    return {worldUnchangedDuringPreparation:unchanged,frozenTelegraphMatchesQueuedRequest:matches,cancelled,reentered};
  });
} catch (error) { result.failure = error.stack; }
finally {
  result.sourceAfter = await hashes();
  result.sourcesChangedDuringRun = Object.keys({ ...result.sourceBefore, ...result.sourceAfter }).filter(k => result.sourceBefore[k] !== result.sourceAfter[k]);
  await writeFile(resolve(out, 'result.json'), JSON.stringify(result, null, 2));
  await context?.close(); await browser.close(); await server.close();
  console.log(JSON.stringify({ out, captures: result.captures.length, sourcesChangedDuringRun: result.sourcesChangedDuringRun, failure: result.failure }));
  if (result.failure) process.exitCode = 1;
}
