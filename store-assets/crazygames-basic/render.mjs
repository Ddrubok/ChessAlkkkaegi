// Exact CSS viewport rendering; no dependence on a browser's command-line window decorations.
import { chromium } from '../../.orca/ui-check/node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../..');
const mime = { '.js': 'text/javascript', '.html': 'text/html' };
const server = createServer(async (req, res) => {
  try {
    const file = resolve(root, '.' + new URL(req.url, 'http://local').pathname);
    assert.ok(file.startsWith(root + sep));
    res.setHeader('Content-Type', mime[extname(file)] ?? 'application/octet-stream'); res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const [name, [width, height]] of Object.entries({ landscape: [1920,1080], portrait: [800,1200], square: [800,800] })) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.goto(`http://127.0.0.1:${server.address().port}/store-assets/crazygames-basic/cover.html?size=${name}`);
    await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
    assert.deepEqual(await page.evaluate(() => [innerWidth, innerHeight, document.querySelector('canvas').width, document.querySelector('canvas').height]), [width,height,width,height]);
    const png = await page.screenshot({ path: resolve(here, `cover-${name}.png`) });
    assert.equal(png.readUInt32BE(16), width); assert.equal(png.readUInt32BE(20), height);
    console.log(`PASS ${name}: ${width}x${height}, ${png.length} bytes`); await page.close();
  }
} finally { await browser.close(); await new Promise(r => server.close(r)); }
