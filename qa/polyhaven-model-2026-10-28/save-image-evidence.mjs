import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../.orca/ui-check/node_modules/playwright/index.mjs';

const qa = new URL('./', import.meta.url);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  const image = async (url, width, label) => {
    const bytes = await readFile(url);
    const mime = url.pathname.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    return `<figure style="margin:0"><img style="display:block;width:${width}px;height:auto" src="data:${mime};base64,${bytes.toString('base64')}"><figcaption style="padding:5px;color:#eee;font:13px system-ui">${label}</figcaption></figure>`;
  };
  const lobby = await Promise.all([
    image(new URL('../../web/public/assets/lobby/hero-stage.jpg', import.meta.url), 567, 'Stage board'),
    image(new URL('../../web/public/assets/lobby/hero-tutorial.jpg', import.meta.url), 600, 'Tutorial board'),
    image(new URL('../../web/public/assets/lobby/avatar-knight.jpg', import.meta.url), 160, 'Knight avatar'),
  ]);
  await page.setContent(`<body style="margin:12px;background:#171410;display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">${lobby.join('')}</body>`);
  await page.locator('img').last().evaluate(img => img.decode());
  await page.screenshot({ path: fileURLToPath(new URL('evidence-lobby.png', qa)), fullPage: true });

  const ids = ['classic', 'gm-blocks-and-hole-v1', 'gm-bounce-corridor-v1', 'gm-bounce-ramps-v1', 'gm-breakable-bridge-v1', 'gm-collapsing-center-v1', 'gm-collapsing-crown-v1', 'gm-control-square-v1', 'gm-ice-gate-v1', 'gm-ice-lane-v1', 'gm-ice-pockets-v1', 'gm-launch-ramps-v1', 'gm-push-blocks-v1', 'gm-rotating-gate-v1'];
  const previews = await Promise.all(ids.map(id => image(new URL(`../../web/src/assets/map-previews/${id}-thumb.webp`, import.meta.url), 240, id)));
  await page.setContent(`<body style="margin:12px;background:#171410;display:grid;grid-template-columns:repeat(4,240px);gap:14px">${previews.join('')}</body>`);
  await page.locator('img').last().evaluate(img => img.decode());
  await page.screenshot({ path: fileURLToPath(new URL('evidence-map-thumbs.png', qa)), fullPage: true });
} finally { await browser.close(); }
