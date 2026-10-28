import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { chromium } from '../../.orca/ui-check/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';

const root = resolve(process.env.CG_DIST_ROOT ?? 'web/dist-crazygames');
const output = resolve('qa/polyhaven-model-2026-10-28');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.woff2': 'font/woff2' };
const server = http.createServer(async (req, res) => {
  if (req.url === '/parent') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><iframe src="http://127.0.0.1:' + server.address().port + '/" style="position:fixed;inset:0;width:100%;height:100%;border:0"></iframe>');
    return;
  }
  const path = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
  if (path !== root && !path.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
  try {
    const file = path === root ? join(root, 'index.html') : path;
    res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' });
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
await mkdir(join(output, 'portal-screenshots'), { recursive: true });
const port = server.address().port;
const cases = [];
const quick = process.env.CG_QUICK === '1';
for (const browser of [
  { name: 'Edge', executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' },
  { name: 'Chrome', executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' },
].filter((_, i) => !quick || i === 0)) for (const [width, height] of (quick ? [[821, 462]] : [[821, 462], [907, 510]])) {
  const result = { browser: browser.name, width, height, dpr: 1, externalRequests: [], consoleErrors: [], steps: [] };
  cases.push(result);
  let app;
  try {
    app = await chromium.launch({ headless: true, executablePath: browser.executablePath });
    const context = await app.newContext({ viewport: { width, height }, deviceScaleFactor: 1, locale: 'ko-KR' });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return route.continue();
      result.externalRequests.push({ url: route.request().url(), method: route.request().method() });
      return route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    page.on('pageerror', error => result.consoleErrors.push(error.message));
    await page.goto(`http://localhost:${port}/parent`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('iframe');
    await frame.locator('#boot-loading').waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1500);
    async function step(name) {
      const data = await frame.locator('body').evaluate(body => ({ text: body.innerText.slice(0, 4500), buttons: [...body.querySelectorAll('button')].filter(b => { const s = getComputedStyle(b); return b.getClientRects().length && s.visibility !== 'hidden' && s.display !== 'none' && !b.closest('[hidden]'); }).map(b => ({ text: b.innerText.trim(), aria: b.getAttribute('aria-label'), id: b.id, class: b.className, disabled: b.disabled })).slice(0, 45) }));
      const screenshot = `portal-screenshots/${browser.name.toLowerCase()}-${width}x${height}-${name}.png`;
      await page.screenshot({ path: join(output, screenshot) });
      result.steps.push({ name, screenshot, ...data });
    }
    await step('home');
    assert.match(result.steps.at(-1).text, /Try a shot/);
    assert.equal(await frame.locator('html').getAttribute('lang'), 'en');
    assert.equal(await frame.locator('body').evaluate(() => typeof window.__cgQA), 'undefined');
    async function click(name, locator) {
      try { await locator.click({ timeout: 7000 }); await page.waitForTimeout(900); await step(name); }
      catch (error) { result.steps.push({ name, actionError: String(error).slice(0, 700) }); }
    }
    await click('settings', frame.locator('#menu-sound-btn'));
    await click('settings-language', frame.locator('#tab-btn-language'));
    await click('settings-close', frame.getByRole('button', { name: /close|back|done/i }).last());
    await click('tutorial-open', frame.locator('#menu-tutorial-btn'));
    await click('tutorial-start', frame.locator('[data-game-mode="tutorial"][data-tutorial-type="basic"]'));
    await page.waitForTimeout(2000);
    await step('tutorial-board');
    await click('tutorial-menu', frame.getByRole('button', { name: /menu/i }).last());
    await click('tutorial-menu-confirm', frame.locator('[data-menu-confirm]'));
    await click('stage-open', frame.locator('[data-game-mode="stage"]'));
    await click('stage-start', frame.getByRole('button', { name: /start|play|enter/i }).last());
    await page.waitForTimeout(2000);
    await step('ai-board');
    await click('ai-menu', frame.getByRole('button', { name: /menu/i }).last());
    await click('ai-menu-confirm', frame.locator('[data-menu-confirm]'));
    await click('ai-return-main', frame.getByRole('button', { name: 'Return to Main' }));
    await context.close();
  } catch (error) { result.error = String(error); }
  finally { await app?.close(); }
}
// A separate fresh context reproduces a browser that denies local storage access.
if (!quick) {
  const result = { browser: 'Edge', width: 821, height: 462, dpr: 1, storageBlocked: true, externalRequests: [], consoleErrors: [], steps: [] };
  cases.push(result);
  let app;
  try {
    app = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
    const context = await app.newContext({ viewport: { width: 821, height: 462 }, deviceScaleFactor: 1, locale: 'en-US' });
    await context.addInitScript(() => Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('Storage blocked by test', 'SecurityError'); } }));
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return route.continue();
      result.externalRequests.push(route.request().url());
      return route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    page.on('pageerror', error => result.consoleErrors.push(error.message));
    await page.goto(`http://localhost:${port}/parent`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6000);
    const frame = page.frameLocator('iframe');
    const screenshot = 'portal-screenshots/edge-821x462-storage-blocked.png';
    await page.screenshot({ path: join(output, screenshot) });
    result.steps.push({ name: 'storage-blocked-home', screenshot, text: await frame.locator('body').innerText() });
    await frame.locator('#menu-tutorial-btn').click();
    await frame.locator('[data-game-mode="tutorial"][data-tutorial-type="basic"]').click();
    await page.waitForTimeout(1800);
    const tutorialScreenshot = 'portal-screenshots/edge-821x462-storage-blocked-tutorial.png';
    await page.screenshot({ path: join(output, tutorialScreenshot) });
    result.steps.push({ name: 'storage-blocked-tutorial', screenshot: tutorialScreenshot, text: await frame.locator('body').innerText() });
    await frame.getByRole('button', { name: 'Menu' }).first().click();
    await frame.locator('[data-menu-confirm]').click();
    await frame.locator('[data-game-mode="stage"]').click();
    await frame.locator('#pve-start-btn').click();
    await page.waitForTimeout(1800);
    const aiScreenshot = 'portal-screenshots/edge-821x462-storage-blocked-ai.png';
    await page.screenshot({ path: join(output, aiScreenshot) });
    result.steps.push({ name: 'storage-blocked-ai', screenshot: aiScreenshot, text: await frame.locator('body').innerText() });
    await context.close();
  } catch (error) { result.error = String(error); }
  finally { await app?.close(); }
}
await writeFile(join(output, quick ? 'portal-final-zip-results.json' : 'portal-results.json'), JSON.stringify({ testedAt: new Date().toISOString(), root, locale: 'ko-KR (fresh default English)', cases }, null, 2));
server.close();
for (const result of cases) {
  assert.equal(result.error, undefined, `${result.browser} ${result.width}: ${result.error}`);
  assert.deepEqual(result.externalRequests, []); assert.deepEqual(result.consoleErrors, []);
  assert.deepEqual(result.steps.filter(step => step.actionError), []);
}
console.log(`PASS ${cases.length} cross-origin iframe cases; original bundle ${root}`);
