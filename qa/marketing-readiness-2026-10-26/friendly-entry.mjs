import { chromium } from '../../.orca/ui-check/node_modules/playwright/index.mjs';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const results = [];
for (const [name, url] of [['dev','https://chessalkkagi-dev.pages.dev/'],['public','https://ddrubok.github.io/ChessAlkkkaegi/']]) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ko-KR' });
  const page = await context.newPage();
  const r = { name, checkedAt: new Date().toISOString(), steps: [], backend: [], websockets: [] };
  page.on('response', x => { try { const u = new URL(x.url()); if (u.hostname.endsWith('.supabase.co')) r.backend.push({host:u.hostname,path:u.pathname,status:x.status(),method:x.request().method()}); } catch {} });
  page.on('websocket', x => { const u = new URL(x.url()); const item = {host:u.hostname,path:u.pathname,openedAt:new Date().toISOString(),closed:false}; r.websockets.push(item); x.on('close',()=>{item.closed=true;item.closedAt=new Date().toISOString()}); });
  const snap = async step => { r.steps.push({step,text:(await page.locator('body').innerText()).slice(0,4500),buttons:await page.getByRole('button').allTextContents()}); await page.screenshot({path:new URL(`./screenshots/${name}-${step}.png`,import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'),fullPage:true}); };
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.locator('#guest-nickname-input').fill('QA_M04_20261026');
    await page.locator('#btn-guest-submit').click();
    await page.waitForTimeout(5000);
    if (name === 'dev') {
      const more = page.getByText('다른 모드와 활동', { exact: true });
      r.moreCount = await more.count();
      if (await more.isVisible().catch(()=>false)) await more.click();
    }
    await snap('friendly-before');
    const online = page.getByRole('button',{name:/온라인 친선전/});
    r.onlineButtonCount = await online.count();
    if (await online.first().isVisible().catch(()=>false)) {
      await online.first().click();
      await page.waitForTimeout(6000);
      await snap('friendly-open');
      const create = page.getByRole('button',{name:'새 방 만들기'});
      if (await create.isVisible().catch(()=>false)) {
        await create.click();
        await page.waitForTimeout(20000);
        const text = (await page.locator('body').innerText()).replace(/\b[A-Z0-9]{6,10}\b/g,'[ROOM_CODE]');
        r.steps.push({step:'friendly-host',text,buttons:await page.getByRole('button').allTextContents()});
      }
    }
  } catch(e) { r.error = String(e); }
  results.push(r);
  await context.close();
}
await browser.close();
await writeFile(new URL('./friendly-entry.json',import.meta.url),JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify(results.map(r=>({name:r.name,moreCount:r.moreCount,onlineButtonCount:r.onlineButtonCount,steps:r.steps.map(s=>({step:s.step,text:s.text.slice(0,1700),buttons:s.buttons.slice(0,30)})),backend:r.backend,websockets:r.websockets,error:r.error})),null,2));
