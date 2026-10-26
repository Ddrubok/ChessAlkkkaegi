import { chromium } from '../../.orca/ui-check/node_modules/playwright/index.mjs';
import { preview } from '../../web/node_modules/vite/dist/node/index.js';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = resolve('qa/marketing-crossplay-2026-10-26');
const direction = process.argv[2] === 'android-host' ? 'android-host' : 'web-host';
mkdirSync(resolve(dir, 'screenshots'), { recursive: true });
const adb = 'C:/Users/DooBokWie/AppData/Local/Android/Sdk/platform-tools/adb.exe';
const device = '10.8.4.105:41399';
const run = (...args) => execFileSync(adb, ['-s', device, ...args], { windowsHide: true, maxBuffer: 20_000_000 });
const report = { startedAt: new Date().toISOString(), target: 'local staging QA build + Android marketing QA', direction, cases: [], errors: [] };
const server = await preview({ root: resolve('web'), build: { outDir: resolve(dir, 'assets/public') }, preview: { port: 5351, strictPort: true, host: '127.0.0.1' } });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ko-KR' });
const web = await context.newPage();
const nativeBrowser = await chromium.connectOverCDP('http://127.0.0.1:9349');
const android = nativeBrowser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('https://localhost'));
if (!android) throw new Error('Android QA WebView CDP page unavailable');
const capture = async (label, page) => {
  if (page === android) writeFileSync(resolve(dir, `screenshots/${label}.png`), run('exec-out', 'screencap', '-p'));
  else await page.screenshot({ path: resolve(dir, `screenshots/${label}.png`) });
};
const text = async p => (await p.locator('body').innerText()).replace(/\b[A-Z0-9]{6,12}\b/g, '[ROOM]');
const shot = async side => {
  if (side === 'android') run('shell', 'input', 'swipe', '958', '694', '958', '870', '650');
  else { await web.mouse.move(612, 428); await web.mouse.down(); await web.mouse.move(612, 500, { steps: 15 }); await web.mouse.up(); }
};
for (const [side, page] of [['web', web], ['android', android]]) {
  page.on('pageerror', e => report.errors.push(`${side}: ${e.name}: ${e.message.slice(0, 180)}`));
}
try {
  await web.goto('http://127.0.0.1:5351/', { waitUntil: 'domcontentloaded' });
  for (const [side, page] of [['web', web], ['android', android]]) {
    if (await page.locator('#guest-nickname-input').isVisible()) {
    await capture(`${direction}-${side}-entry`, page);
      await page.locator('#guest-nickname-input').fill(side === 'web' ? 'QA_WEB_M04' : 'QA_ANDROID_M04');
      await page.locator('#btn-guest-submit').click();
    }
    await page.locator('#menu-profile-btn').waitFor({ timeout: 30000 });
    await capture(`${direction}-${side}-lobby`, page);
    if (!(await page.locator('[data-friendly-host]').isVisible())) {
      if (!(await page.locator('[data-game-mode="online"]').isVisible())) await page.getByText('다른 모드와 활동', { exact: true }).click();
      await page.locator('[data-game-mode="online"]').click();
    }
    await page.locator('[data-friendly-host]').waitFor({ timeout: 30000 });
    await capture(`${direction}-${side}-friendly`, page);
    report.cases.push({ id: `${side}-guest-entry`, result: 'passed', text: (await text(page)).slice(0, 1000) });
  }
  const host = direction === 'web-host' ? web : android, guest = direction === 'web-host' ? android : web;
  const hostSide = direction === 'web-host' ? 'web' : 'android', guestSide = direction === 'web-host' ? 'android' : 'web';
  await host.locator('[data-friendly-host]').click();
  await host.waitForFunction(() => document.querySelector('[data-friendly-room]')?.value?.replaceAll('-', '').length === 12, null, { timeout: 45000 });
  const code = await host.locator('[data-friendly-room]').inputValue();
  report.cases.push({ id: `${hostSide}-host-created`, result: 'passed', codeRecorded: false, hostStatus: await host.locator('[data-friendly-status]').innerText() });
  await guest.locator('[data-friendly-code]').fill(code);
  await guest.locator('[data-friendly-join]').click();
  await Promise.all([host, guest].map(p => p.waitForFunction(() => !document.querySelector('[data-friendly-host]') && !!document.querySelector('canvas'), null, { timeout: 90000 })));
  for (const [side, page] of [[hostSide, host], [guestSide, guest]]) {
    await capture(`${direction}-${side}-connected`, page);
    report.cases.push({ id: `${side}-${direction}-connected`, result: 'passed', text: (await text(page)).slice(0, 1000) });
  }
  await shot(hostSide);
  await guest.waitForFunction(() => document.body.innerText.includes('내 턴'), null, { timeout: 25000 });
  await capture(`${direction}-${hostSide}-after-first-shot`, host);
  await capture(`${direction}-${guestSide}-after-first-shot`, guest);
  report.cases.push({ id: `${hostSide}-manual-shot-turn-transfer`, result: 'passed', input: hostSide === 'android' ? 'ADB touchscreen swipe at board pawn' : 'Playwright mouse drag at board pawn', webText: (await text(web)).slice(0, 300), androidText: (await text(android)).slice(0, 300) });
  await shot(guestSide);
  await host.waitForFunction(() => document.body.innerText.includes('내 턴'), null, { timeout: 25000 });
  await capture(`${direction}-${guestSide}-after-second-shot`, guest);
  await capture(`${direction}-${hostSide}-after-second-shot`, host);
  report.cases.push({ id: `${guestSide}-manual-shot-turn-transfer`, result: 'passed', input: guestSide === 'android' ? 'ADB touchscreen swipe at board pawn' : 'Playwright mouse drag at board pawn', webText: (await text(web)).slice(0, 300), androidText: (await text(android)).slice(0, 300) });
  if (process.argv.includes('lifecycle')) {
    run('shell', 'input', 'keyevent', '3');
    await web.waitForTimeout(3000);
    run('shell', 'am', 'start', '-n', 'com.chessalkkagi.app.marketingqa/com.chessalkkagi.app.MainActivity');
    await web.waitForTimeout(2000);
    await capture(`${direction}-android-background-return`, android);
    report.cases.push({ id: 'android-background-return', text: (await text(android)).slice(0, 400), webText: (await text(web)).slice(0, 400), durationSeconds: 3 });
    await web.getByRole('button', { name: '메뉴로' }).click();
    await capture(`${direction}-menu-confirmation`, web);
    report.cases.push({ id: 'menu-exit-confirmation', text: (await text(web)).slice(0, 500) });
    await web.locator('[data-menu-cancel]').click();
    report.cases.push({ id: 'menu-exit-cancel', result: (await text(web)).includes('내 턴') || (await text(web)).includes('상대 턴') ? 'passed' : 'uncertain', text: (await text(web)).slice(0, 350) });
    await web.getByRole('button', { name: '메뉴로' }).click();
    await web.locator('[data-menu-confirm]').click();
    await web.waitForTimeout(1500);
    await capture(`${direction}-after-menu-exit`, web);
    await capture(`${direction}-remote-after-menu-exit`, android);
    report.cases.push({ id: 'menu-exit-remote-result', webText: (await text(web)).slice(0, 500), androidText: (await text(android)).slice(0, 500) });
  }
} catch (e) { report.errors.push(String(e)); }
report.finishedAt = new Date().toISOString();
writeFileSync(resolve(dir, `${direction}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
await nativeBrowser.close();
await browser.close();
await server.httpServer.close();
