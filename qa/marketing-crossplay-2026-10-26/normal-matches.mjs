import { chromium } from '../../.orca/ui-check/node_modules/playwright/index.mjs';
import { preview } from '../../web/node_modules/vite/dist/node/index.js';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = resolve('qa/marketing-crossplay-2026-10-26');
const androidHosts = process.argv.includes('--android-host');
const prefix = androidHosts ? 'android-host-' : '';
const adb = 'C:/Users/DooBokWie/AppData/Local/Android/Sdk/platform-tools/adb.exe';
const run = (...args) => execFileSync(adb, ['-s', '10.8.4.105:41399', ...args], { windowsHide: true, maxBuffer: 20_000_000 });
const report = { startedAt: new Date().toISOString(), host: androidHosts ? 'android' : 'web', method: 'rule-valid QA autoplay, self ring-out when needed; mouse/ADB input is verified separately in manual-input-results.json', matches: [], errors: [] };
const save = () => writeFileSync(resolve(dir, `${prefix}normal-matches.json`), JSON.stringify({ ...report, updatedAt: new Date().toISOString() }, null, 2));
save();
let server, browser, nativeBrowser;
try {
  server = await preview({ root: resolve('web'), build: { outDir: resolve(dir, 'assets/public') }, preview: { port: 5351, strictPort: true, host: '127.0.0.1' } });
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ko-KR' });
  const web = await context.newPage();
  run('shell', 'am', 'force-stop', 'com.chessalkkagi.app.marketingqa');
  run('shell', 'am', 'start', '-n', 'com.chessalkkagi.app.marketingqa/com.chessalkkagi.app.MainActivity');
  await new Promise(r => setTimeout(r, 2500));
  const qaPid = run('shell', 'pidof', 'com.chessalkkagi.app.marketingqa').toString().trim();
  run('forward', 'tcp:9349', `localabstract:webview_devtools_remote_${qaPid}`);
  nativeBrowser = await chromium.connectOverCDP('http://127.0.0.1:9349');
  const android = nativeBrowser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('https://localhost'));
  if (!android) throw new Error('Android QA WebView CDP page unavailable');
  const pages = { web, android };
  await web.goto('http://127.0.0.1:5351/', { waitUntil: 'domcontentloaded' });
  for (const [side, page] of Object.entries(pages)) {
    if (await page.locator('#guest-nickname-input').isVisible()) {
      await page.locator('#guest-nickname-input').fill(side === 'web' ? 'QA_WEB_M05' : 'QA_ANDROID_M05');
      await page.locator('#btn-guest-submit').click();
    }
    await page.locator('#menu-profile-btn').waitFor({ timeout: 30000 });
    if (!(await page.locator('[data-friendly-host]').isVisible())) {
      await page.locator('.lobby-other-modes summary').click();
      await page.locator('[data-game-mode="online"]').click();
    }
    await page.locator('[data-friendly-host]').waitFor({ timeout: 30000 });
  }
  const host = androidHosts ? android : web, guest = androidHosts ? web : android;
  await host.locator('[data-friendly-host]').click();
  await host.waitForFunction(() => document.querySelector('[data-friendly-room]')?.value?.replaceAll('-', '').length === 12, null, { timeout: 45000 });
  const code = await host.locator('[data-friendly-room]').inputValue();
  await guest.locator('[data-friendly-code]').fill(code);
  await guest.locator('[data-friendly-join]').click();
  await Promise.all(Object.values(pages).map(p => p.waitForFunction(() => !!window.__marketingQA?.turnRuntime && !document.querySelector('[data-friendly-host]'), null, { timeout: 90000 })));
  const state = async page => page.evaluate(() => {
    const q = window.__marketingQA;
    return { side: q.turnRuntime.currentSide, phase: q.turnRuntime.phase, turnIndex: q.turnRuntime.turnNumber, halfExtent: q.physicsRuntime.boardHalfExtent,
      pieces: [...q.physicsRuntime.pieces.values()].map(p => ({ id: p.instance.id, side: p.instance.side, type: p.instance.type, x: q.sceneRuntime.pieceMeshes.get(p.instance.id)?.position.x, z: q.sceneRuntime.pieceMeshes.get(p.instance.id)?.position.z })) };
  });
  console.log('initial', JSON.stringify({ web: { phase: (await state(web)).phase, pieces: (await state(web)).pieces.length }, android: { phase: (await state(android)).phase, pieces: (await state(android)).pieces.length } }));
  if (process.argv.includes('--probe')) process.exitCode = 0;
  else {
    for (let matchNumber = 1; matchNumber <= 3; matchNumber++) {
      const rec = { matchNumber, startedAt: new Date().toISOString(), acceptedShots: 0, rejectedShots: 0, timedOutTurns: 0, result: 'incomplete' };
      report.matches.push(rec); save();
      for (let cycle = 0; cycle < 1200; cycle++) {
        const ws = await state(web), as = await state(android);
        if (ws.phase === 'match-over' && as.phase === 'match-over') {
          rec.result = 'completed'; rec.webState = { phase: ws.phase, turnIndex: ws.turnIndex, pieces: ws.pieces.length }; rec.androidState = { phase: as.phase, turnIndex: as.turnIndex, pieces: as.pieces.length };
          rec.webResultText = (await web.locator('.match-result-panel:visible').innerText()).slice(0, 250);
          rec.androidResultText = (await android.locator('.match-result-panel:visible').innerText()).slice(0, 250);
          writeFileSync(resolve(dir, `screenshots/${prefix}normal-match-${matchNumber}-native-final.png`), run('exec-out', 'screencap', '-p'));
          save(); break;
        }
        if (ws.phase !== 'ready' || as.phase !== 'ready' || ws.side !== as.side) { await web.waitForTimeout(350); continue; }
        const side = ws.side, page = side === 'white' ? host : guest;
        const outcome = await page.evaluate(() => {
          const q = window.__marketingQA, side = q.turnRuntime.currentSide;
          const pieces = [...q.physicsRuntime.pieces.values()].filter(p => p.instance.side === side && !q.turnRuntime.pendingRemovalIds.has(p.instance.id));
          if (!pieces.length) return { accepted: false, reason: 'no pieces' };
          // Every request passes through the game's normal local launch policy and physics.
          // Aim an edge piece outward to complete the terminal flow through a legal ring-out.
          const position = p => q.sceneRuntime.pieceMeshes.get(p.instance.id).position;
          const p = pieces.sort((a, b) => Math.hypot(position(b).x, position(b).z) - Math.hypot(position(a).x, position(a).z))[0];
          const direction = position(p).clone().setY(0).normalize();
          const applicationPoint = p.body.worldCom();
          const result = q.inputRuntime.policy.queueLaunch({ pieceId: p.instance.id, direction, normalizedPower: 1, applicationPoint });
          return { accepted: !!result?.accepted, reason: result?.reason ?? null, pieceId: p.instance.id, side };
        });
        if (outcome.accepted) rec.acceptedShots++; else { rec.rejectedShots++; rec.lastRejection = outcome.reason; await web.waitForTimeout(500); }
        if (outcome.accepted || cycle % 4 === 0) { rec.lastTurn = { web: ws.turnIndex, android: as.turnIndex, side }; save(); }
        if (outcome.accepted) console.log('shot', matchNumber, rec.acceptedShots, side, outcome.pieceId);
        await web.waitForTimeout(600);
      }
      if (rec.result !== 'completed') { rec.lastWeb = await state(web); rec.lastAndroid = await state(android); save(); break; }
      if (matchNumber < 3) {
        const offer = host.locator('.match-result-panel:visible button').filter({ hasText: /재대결|Rematch/ }).first();
        await offer.click();
        const accept = guest.locator('.match-result-panel:visible button').filter({ hasText: /수락|Accept/ }).first();
        await accept.waitFor({ state: 'visible', timeout: 20000 });
        await accept.click();
        await Promise.all(Object.values(pages).map(p => p.waitForFunction(() => window.__marketingQA?.turnRuntime?.phase === 'ready' && window.__marketingQA?.turnRuntime?.turnNumber === 0, null, { timeout: 60000 })));
        rec.rematchAccepted = true; rec.rematchNewMatchTurnZero = true; save();
      }
    }
  }
} catch (e) { report.errors.push(String(e)); save(); console.error(e); process.exitCode = 1; }
finally { report.finishedAt = new Date().toISOString(); save(); await nativeBrowser?.close(); await browser?.close(); await new Promise(r => server?.httpServer.close(r) ?? r()); run('forward', '--remove', 'tcp:9349'); }
