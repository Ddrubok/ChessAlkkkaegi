import { chromium } from '../../.orca/ui-check/node_modules/playwright/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';

const root = new URL('./', import.meta.url);
await mkdir(new URL('./screenshots/', root), { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const results = [];
for (const [name, url] of [
  ['dev', 'https://chessalkkagi-dev.pages.dev/'],
  ['public', 'https://ddrubok.github.io/ChessAlkkkaegi/'],
]) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ko-KR' });
  const page = await context.newPage();
  const result = { name, url, checkedAt: new Date().toISOString(), errors: [], backendResponses: [], steps: [] };
  page.on('pageerror', e => result.errors.push(e.message.slice(0, 300)));
  page.on('response', r => {
    try { const u = new URL(r.url()); if (u.hostname.endsWith('.supabase.co')) result.backendResponses.push({ host: u.hostname, path: u.pathname, status: r.status(), method: r.request().method() }); } catch {}
  });
  try {
    const nav = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(10000);
    result.navigation = { status: nav?.status(), finalUrl: page.url(), title: await page.title() };
    const snap = async step => {
      const state = { step, at: new Date().toISOString(), text: (await page.locator('body').innerText()).slice(0, 5000), buttons: await page.getByRole('button').allTextContents(), inputs: await page.locator('input').evaluateAll(es => es.map(e => ({ id: e.id, placeholder: e.placeholder, type: e.type }))) };
      result.steps.push(state);
      await page.screenshot({ path: new URL(`./screenshots/${name}-${step}.png`, root).pathname.replace(/^\/([A-Za-z]:)/, '$1'), fullPage: true });
    };
    await snap('entry');
    const guestInput = page.locator('#guest-nickname-input');
    if (await guestInput.isVisible().catch(() => false)) {
      await guestInput.fill('QA_20261026');
      await page.locator('#btn-guest-submit').click();
      await page.waitForTimeout(5000);
      await snap('guest');
    }
    const first = name === 'dev' ? page.getByRole('button', { name: '한 번 튕겨보기' }) : page.getByRole('button', { name: '시작하기' });
    if (await first.isVisible().catch(() => false)) {
      await first.click();
      await page.waitForTimeout(5000);
      await snap('practice');
    }
    const ai = page.locator('[data-game-mode="ai"]');
    if (await ai.isVisible().catch(() => false)) {
      await ai.click();
      await page.waitForTimeout(5000);
      await snap('ai');
    }
  } catch (e) { result.error = String(e); }
  results.push(result);
  await context.close();
}
await browser.close();
await writeFile(new URL('./browser-smoke.json', root), JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify(results.map(r => ({ name: r.name, navigation: r.navigation, steps: r.steps.map(s => ({ step: s.step, text: s.text.slice(0, 1200), buttons: s.buttons.slice(0, 30) })), backendResponses: r.backendResponses, errors: r.errors, error: r.error })), null, 2));
