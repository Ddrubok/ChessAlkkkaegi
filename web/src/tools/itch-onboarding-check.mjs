import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from '../../../.orca/ui-check/node_modules/playwright/index.mjs';

const root = resolve('dist-itch');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://127.0.0.1').pathname;
    const file = resolve(root, '.' + decodeURIComponent(path === '/' ? '/index.html' : path));
    if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    res.setHeader('Content-Type', mime[extname(file)] ?? 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const [width, height] of [[800, 450], [390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    const coach = page.locator('.tutorial-coach-card');
    await coach.waitFor();
    await page.locator('.tutorial-gesture').waitFor();
    assert.equal(await page.locator('#menu-account-btn:visible').count(), 0, 'first visit starts on tutorial');
    const signIn = page.locator('.tutorial-itch-sign-in');
    assert.equal(await signIn.textContent(), 'Sign in with itch.io');
    assert.equal(await signIn.isVisible(), true);
    assert.equal(await page.locator('.tutorial-itch-cancel').isVisible(), false);
    const box = await coach.boundingBox();
    const cta = await signIn.boundingBox();
    await page.locator('.classic-cancel-control').evaluate(element => { element.hidden = false; element.style.display = 'block'; });
    const cancel = await page.locator('.classic-cancel-control').boundingBox();
    assert.ok(box && cta && cancel);
    assert.ok(box.y >= 0 && box.y + box.height < height * .55, 'coach leaves room for aimboard');
    assert.ok(cta.x >= 0 && cta.x + cta.width <= width);
    assert.ok(cancel.y >= box.y + box.height, 'aim cancel stays below coach');
    if (width === 800) {
      await signIn.click();
      await page.locator('.tutorial-itch-status:not(:empty)').waitFor();
      assert.ok((await page.locator('.tutorial-itch-status').textContent()).includes('itch.io') ||
        (await page.locator('.tutorial-itch-status').textContent()).includes('popup'));
    }
    await page.locator('.tutorial-skip-button').click();
    await page.locator('.tutorial-itch-sign-in').waitFor({ state: 'detached' });
    await page.reload();
    await page.locator('#menu-recommendation-btn').waitFor();
    assert.equal(await page.locator('.tutorial-itch-sign-in').count(), 0, 'returning guest keeps menu/checkpoint path');
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`PASS itch onboarding ${width}x${height}: direct first flick, guest CTA, board/cancel fit, returning lobby`);
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
