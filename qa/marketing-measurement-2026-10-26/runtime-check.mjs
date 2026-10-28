import assert from 'node:assert/strict';
import { build, loadEnv } from '../../web/node_modules/vite/dist/node/index.js';
import { chromium } from '../../.orca/ui-check/node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';

const dir = resolve('qa/marketing-measurement-2026-10-26');
const output = resolve(dir, 'dist');
const origin = 'http://127.0.0.1:5344';
await mkdir(dir, { recursive: true });
for (const key of Object.keys(loadEnv('production', resolve('web'), 'VITE_'))) {
  if (/^VITE_(SUPABASE|METERED|WEB_ADS|ADMOB|ADSENSE)/.test(key)) process.env[key] = '';
}
Object.assign(process.env, { VITE_SUPABASE_URL: origin, VITE_SUPABASE_ANON_KEY: 'local-qa-public-key',
  VITE_WEB_ADS_MODE: 'off', VITE_MARKETING_ENABLED: 'true', VITE_MARKETING_ENV: 'qa' });
await build({ root: resolve('web'), logLevel: 'warn', build: { outDir: output }, plugins: [{
  name: 'marketing-qa-observation', enforce: 'pre', transform(code, id) {
    if (id.replaceAll('\\', '/').endsWith('/src/main.ts')) return code.replace(
      '  if (PLATFORM.id !== "poki") await AdManager.init();',
      '  window.__marketingQA = {marketingRuntime,tutorialManager,turnRuntime,inputRuntime,physicsRuntime,sceneRuntime,menuRuntime,gameModeRuntime,startModeAction,returnToMainMenu};\n  if (PLATFORM.id !== "poki") await AdManager.init();');
  },
}] });
const received = [], attempts = [], errors = [];
let fail = true;
const server = createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/rest/v1/rpc/record_marketing_events')) {
      let body = ''; for await (const chunk of req) body += chunk;
      const events = JSON.parse(body).p_events; attempts.push(events);
      res.setHeader('Content-Type', 'application/json');
      if (fail) { res.statusCode = 503; res.end('{"message":"QA collector unavailable"}'); return; }
      received.push(...events); res.end(JSON.stringify({ accepted: events.length })); return;
    }
    const pathname = decodeURIComponent(new URL(req.url, origin).pathname);
    const target = resolve(output, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!target.startsWith(output)) { res.writeHead(403).end(); return; }
    const type = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.wasm': 'application/wasm' }[extname(target)] || 'application/octet-stream';
    res.setHeader('Content-Type', type); res.end(await readFile(target));
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(5344, '127.0.0.1', r));
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const checks = [];
try {
  const context = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
  await context.route('**/*', r => new URL(r.request().url()).origin === origin ? r.continue() : r.abort());
  await context.addInitScript(() => localStorage.setItem('app_language', 'ko'));
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.setDefaultTimeout(20000);
  await page.goto(origin + '/?utm_source=qa&utm_campaign=first_bundle&email=never_store');
  await page.getByRole('button', { name: '게스트로 바로 시작', exact: true }).click();
  await page.waitForFunction(() => window.__marketingQA?.marketingRuntime.snapshot().enabled);
  await page.evaluate(() => __marketingQA.marketingRuntime.flush());
  assert.ok(attempts.length && attempts[0].some(e => e.name === 'game_ready'));
  assert.equal(received.length, 0);
  const initialIds = attempts[0].map(e => e.event_id);
  await page.locator('.lobby-other-modes summary').click();
  await page.locator('[data-game-mode=hotseat]').click();
  await page.locator('[data-map-id=classic]').click();
  await page.locator('[data-map-action=start]').click();
  await page.getByRole('button', { name: '당구식', exact: true }).click();
  await page.waitForFunction(() => __marketingQA.inputRuntime.cameraTransition === null && __marketingQA.turnRuntime.phase === 'ready');
  const point = await page.evaluate(() => {
    const r = __marketingQA, m = r.sceneRuntime.pieceMeshes.get('white-pawn-e2');
    m.geometry.computeBoundingBox(); m.updateMatrixWorld(true);
    const v = m.geometry.boundingBox.getCenter(m.position.clone()); v.y = m.geometry.boundingBox.max.y * .85;
    const a = v.applyMatrix4(m.matrixWorld).project(r.sceneRuntime.camera), b = r.sceneRuntime.renderer.domElement.getBoundingClientRect();
    return { x: b.x + (a.x + 1) * b.width / 2, y: b.y + (1 - a.y) * b.height / 2 };
  });
  await page.mouse.click(point.x, point.y);
  await page.waitForFunction(() => __marketingQA.inputRuntime.cameraTransition === null);
  await page.waitForTimeout(300);
  const dot = await page.evaluate(() => {
    const r = __marketingQA, a = r.inputRuntime.aimParametersRuntime.currentSolution.applicationPoint.clone().project(r.sceneRuntime.camera), b = r.sceneRuntime.renderer.domElement.getBoundingClientRect();
    return { x: b.x + (a.x + 1) * b.width / 2, y: b.y + (1 - a.y) * b.height / 2 };
  });
  await page.mouse.move(dot.x, dot.y); await page.mouse.down();
  await page.mouse.move(dot.x, dot.y + 70, { steps: 7 });
  await page.keyboard.press('Escape'); await page.mouse.up();
  assert.equal(await page.evaluate(() => __marketingQA.marketingRuntime.snapshot().firstShot), false);
  checks.push('Actual drag cancelled with Escape is not recorded as first_shot.');
  await page.mouse.move(dot.x, dot.y); await page.mouse.down();
  await page.mouse.move(dot.x, dot.y + 120, { steps: 12 });
  await page.screenshot({ path: resolve(dir, '01-aim-collector-offline.png') });
  await page.mouse.up();
  await page.waitForFunction(() => __marketingQA.marketingRuntime.snapshot().firstShot);
  checks.push('Actual mouse drag/release launches while collector returns503; first_shot observed.');
  fail = false;
  await page.evaluate(() => __marketingQA.marketingRuntime.flush());
  assert.ok(initialIds.every(id => received.some(e => e.event_id === id)));
  assert.equal(received.filter(e => e.name === 'first_shot').length, 1);
  assert.equal(received.filter(e => e.name === 'match_start').length, 1);
  checks.push('Retry keeps event IDs; one first_shot and one hotseat match_start.');
  await page.waitForFunction(() => __marketingQA.turnRuntime.phase === 'ready', { timeout: 40000 });
  await page.getByRole('button', { name: '메뉴로', exact: true }).click();
  await page.locator('[data-menu-confirm]').click();
  await page.evaluate(() => __marketingQA.marketingRuntime.flush());
  assert.equal(received.filter(e => e.name === 'match_abort' && e.details.reason === 'menu_exit').length, 1);
  assert.equal(received.filter(e => e.name === 'match_start').length, 1);
  checks.push('Returning to menu aborts active board; background menu board is not counted.');

  // Controlled integration fixtures below verify real callbacks, not human wins or physical outcomes.
  await page.evaluate(async () => { await __marketingQA.startModeAction('tutorial', 1); });
  await page.evaluate(() => __marketingQA.marketingRuntime.flush());
  assert.equal(received.filter(e => e.name === 'match_start').length, 1);
  await page.evaluate(() => __marketingQA.tutorialManager.completeTutorial());
  await page.evaluate(() => __marketingQA.marketingRuntime.flush());
  assert.equal(received.filter(e => e.name === 'tutorial_complete' && e.details.tutorial === 'basic').length, 1);
  await page.screenshot({ path: resolve(dir, '02-completion-fixture.png') });
  await page.evaluate(async () => {
    const r = __marketingQA; await r.returnToMainMenu(r.menuRuntime); await r.startModeAction('stage', 1);
    r.turnRuntime.onMatchOver('white');
  });
  await page.evaluate(() => __marketingQA.marketingRuntime.flush());
  assert.equal(received.filter(e => e.name === 'match_end' && e.mode === 'ai' && !e.details.resigned).length, 1);
  checks.push('Controlled callbacks: tutorial excluded; basic completion and AI normal result recorded. This is NOT a played win.');
  assert.ok(received.every(e => e.environment === 'qa'));
  assert.ok(!JSON.stringify(received).includes('never_store'));
  assert.ok(received.every(e => !e.campaign || Object.keys(e.campaign).every(k => ['source', 'campaign', 'content'].includes(k))));
  assert.deepEqual(errors, []);
  await writeFile(resolve(dir, 'runtime-results.json'), JSON.stringify({ checkedAt: new Date().toISOString(), checks, errors, attempts: attempts.length, received, limitations: ['Local HTTP collector stub; SQL verification is separate.', 'One real mouse shot; tutorial completion and AI outcome are controlled callback fixtures.', 'No claim of online3-game QA or human usability.'] }, null, 2));
  console.log(JSON.stringify({ checks, events: received.length, errors }, null, 2));
} finally { await browser.close(); await new Promise(r => server.close(r)); }
