// Run from web: node src/tools/hud-layout-browser-check.mjs (Microsoft Edge required).
// Install the optional runner separately: npm install --prefix .qa-tools playwright
// Then set PLAYWRIGHT_MODULE to that installation's absolute index.mjs file URL
// (on Windows: file:///C:/path/to/.qa-tools/node_modules/playwright/index.mjs).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const style = await readFile(new URL('../style.css', import.meta.url), 'utf8');
const hud = await readFile(new URL('../game-hud.css', import.meta.url), 'utf8');
const browser = await chromium.launch({ channel: process.env.QA_BROWSER_CHANNEL ?? 'msedge', headless: true });
const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
try {
  for (const [width, height] of [[821, 462], [907, 510], [1077, 606], [1216, 684], [1280, 720], [1366, 768], [1536, 864], [1920, 1080]]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.setContent(`<style>html,body{margin:0;width:100%;height:100%;}#app{width:100vw;height:100vh}.game-canvas{background:#553f2e}.strike-action-bar{position:absolute}.aim-parameters{position:absolute}.aim-power,.aim-elevation{color:#fff}</style><div id="app"><canvas class="game-canvas"></canvas><div class="strike-point-panel"><strong>Strike Point</strong><div class="strike-point-panel-viewport"><canvas class="strike-point-panel-canvas"></canvas></div><button>Reset Strike</button></div><div class="aim-power">Power 100%</div><div class="aim-elevation"><div class="aim-elevation-dial"></div>Elevation 0°</div><div class="aim-parameters">Power 100% · Pitch 44° · Elevation 0°</div><div class="strike-action-bar"><button>Aim</button><button>Strike Point</button></div></div>`);
    await page.addStyleTag({ content: style });
    await page.addStyleTag({ content: hud });
    const boxes = await page.evaluate(() => Object.fromEntries(['.strike-point-panel', '.aim-power', '.aim-elevation', '.aim-parameters', '.strike-action-bar', '.game-canvas'].map(sel => [sel, document.querySelector(sel).getBoundingClientRect().toJSON()])));
    const panel = boxes['.strike-point-panel'];
    for (const selector of ['.aim-power', '.aim-elevation', '.aim-parameters', '.strike-action-bar']) {
      assert.ok(!overlap(panel, boxes[selector]), `${width}x${height}: panel covers ${selector}`);
    }
    assert.ok(panel.top >= boxes['.game-canvas'].top, `${width}x${height}: panel exceeds board top`);
    assert.ok(panel.bottom <= boxes['.game-canvas'].bottom, `${width}x${height}: panel exceeds board bottom`);
    assert.ok(panel.width >= 140 && panel.height >= 180, `${width}x${height}: panel shrank below usable size`);
    await page.close();
    console.log(`PASS ${width}x${height}: panel ${Math.round(panel.width)}x${Math.round(panel.height)}, no HUD overlap`);
  }
} finally {
  await browser.close();
}
