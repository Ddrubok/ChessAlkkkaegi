import { chromium } from '../../.orca/ui-check/node_modules/playwright/index.mjs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const evidence = { errors: [], failedFiles: [] };
page.on('pageerror', e => evidence.errors.push(e.message));
page.on('requestfailed', r => { if (r.url().startsWith('file:')) evidence.failedFiles.push(r.url()); });
try {
  await page.goto(pathToFileURL(resolve('web/dist-portable/체스알까기_체험판.html')).href);
  await page.getByRole('button', { name: /게스트로 바로 시작|Continue as Guest|Start as guest/i }).click();
  await page.locator('#menu-recommendation-btn').waitFor({ timeout: 30000 });
  await page.locator('#menu-recommendation-btn').click();
  await page.locator('.main-menu-overlay').waitFor({ state: 'hidden' });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: 'qa/polyhaven-model-2026-10-28/portable-tutorial.png' });
  evidence.body = await page.locator('body').innerText();
  assert.deepEqual(evidence.errors, []);
  evidence.missingCosmetics = evidence.failedFiles;
  assert.ok(evidence.failedFiles.every(url => url.endsWith('/assets/cosmetics/classic-frame.webp')));
  console.log('PASS model startup and tutorial via file://; missing classic frame recorded separately');
} finally {
  await writeFile('qa/polyhaven-model-2026-10-28/portable-smoke.json', JSON.stringify(evidence, null, 2));
  await browser.close();
}
