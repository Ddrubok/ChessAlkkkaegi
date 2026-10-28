import { chromium } from '../../.orca/ui-check/node_modules/playwright/index.mjs';

const browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
  await page.goto('http://127.0.0.1:5201/capture');
  await page.locator('#capture').click();
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('42') || document.querySelector('#status').textContent.includes('실패'), { timeout: 180_000 });
  const status = await page.locator('#status').textContent();
  if (!status.includes('42')) throw Error(status);
  console.log(status);
} finally { await browser.close(); }
