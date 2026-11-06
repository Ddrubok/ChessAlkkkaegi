import assert from 'node:assert/strict';
import {createServer as httpServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createServer} from '../../web/node_modules/vite/dist/node/index.js';
import {chromium} from '../../.orca/ui-check/node_modules/playwright/index.mjs';
const out=resolve('qa/challenge-actions-fit-2026-11-04');await mkdir(out+'/screenshots',{recursive:true});
const vite=await createServer({root:resolve('web'),configFile:resolve('web/vite.config.ts'),server:{middlewareMode:true,hmr:false},logLevel:'error'});
const html=await readFile(out+'/fixture.html','utf8');
const server=httpServer(async(req,res)=>{
  if(req.url.startsWith('/__qa/fixture')){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(await vite.transformIndexHtml('/__qa/fixture',html));}
  else if(req.url==='/__qa/host'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><style>body{margin:0;background:#333}iframe{display:block;margin:30px;border:0}</style><iframe title="Game viewport fixture" src="/__qa/fixture" width="826" height="345"></iframe>');}
  else vite.middlewares(req,res);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:1280,height:900},locale:'ko-KR'});
const results={scope:'Production UI modules in synthetic UI-state fixture; local iframe is not live CrazyGames SDK QA',browser:browser.version(),cases:[],errors:[],checks:[]};
await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
const page=await context.newPage();page.on('pageerror',e=>results.errors.push(e.message));
const buttons={ 'puzzle-failure':'.puzzle-ui-result-card .puzzle-ui-footer button:not([hidden])','puzzle-success':'.puzzle-ui-result-card .puzzle-ui-footer button:not([hidden])','puzzle-briefing':'.puzzle-ui-briefing-card [data-action="start"]',weekly:'.weekly-actions button'};
async function inspect(frame,kind){return frame.locator(buttons[kind]??buttons.weekly).evaluateAll(nodes=>nodes.map(el=>{
  const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);
  return {text:el.textContent,action:el.dataset.action??el.dataset.weeklyAction,rect:{x:r.x,y:r.y,w:r.width,h:r.height},viewport:{w:innerWidth,h:innerHeight},visible:r.x>=-0.5&&r.y>=-0.5&&r.right<=innerWidth+0.5&&r.bottom<=innerHeight+0.5&&r.height>=43.5&&!!hit&&(hit===el||el.contains(hit)),disabled:el.disabled};
}));}
try{
  await page.goto(origin+'/__qa/host');let frame=page.frames().find(f=>f.parentFrame());await frame.waitForFunction(()=>!!window.qa);
  const sizes=[[826,345],[568,320],[320,568],[384,811],[480,280],[640,280],[800,450],[1024,576],[1280,720]];
  const languages=['ko','en','ja','fr','de','es','ru','pt-BR','zh-CN'];
  const kinds=['puzzle-failure','puzzle-success','puzzle-briefing','weekly-guest','weekly-takeover','weekly-offline'];
  for(const [w,h] of sizes){
    await page.setViewportSize({width:Math.max(1280,w+60),height:Math.max(900,h+60)});
    await page.locator('iframe').evaluate((el,s)=>{el.width=s[0];el.height=s[1];},[w,h]);
    for(const lang of (w===826||w===568||w===320?languages:['ko','fr']))for(const kind of kinds){
      await frame.evaluate(({kind,lang})=>window.qa.open(kind,lang),{kind,lang});await page.waitForTimeout(260);
      const actions=await inspect(frame,kind);const content=await frame.locator(kind.startsWith('puzzle')?'.puzzle-ui-body':'#weekly-panel').evaluate(el=>({height:el.clientHeight,scrollHeight:el.scrollHeight,scrollTop:el.scrollTop}));const row={mode:'iframe',w,h,lang,kind,actions,content,pass:actions.length>0&&actions.every(b=>b.visible)&&content.height>=40&&content.scrollTop===0};results.cases.push(row);
      if(!row.pass)console.log('FAIL',JSON.stringify(row));
      if((lang==='ko'&&[826,320,1280].includes(w))||(lang==='de'&&w===568)||!row.pass)await page.screenshot({path:out+`/screenshots/${w}x${h}-${lang}-${kind}.png`});
    }
  }
  await page.locator('iframe').evaluate(el=>{el.width=826;el.height=345;});
  await frame.evaluate(()=>window.qa.open('weekly-takeover','fr'));await page.waitForTimeout(300);
  await frame.locator('[data-weekly-details]').evaluate(el=>el.open=true);
  const scroller=frame.locator('#weekly-panel');
  assert.equal(await scroller.count(),1,'weekly content scroller');
  await scroller.evaluate(el=>el.scrollTop=el.scrollHeight);const oldTop=await scroller.evaluate(el=>el.scrollTop);
  await frame.locator('[data-weekly-action="takeover"]').focus();await frame.evaluate(()=>window.qa.refresh());
  const newTop=await scroller.evaluate(el=>el.scrollTop);
  assert.ok(oldTop>0&&Math.abs(oldTop-newTop)<2,'refresh retains content scroll');
  assert.equal(await frame.evaluate(()=>document.activeElement.dataset.weeklyAction),'takeover');
  assert.equal(await frame.locator('[data-weekly-details]').evaluate(el=>el.open),true);
  assert.ok((await inspect(frame,'weekly-takeover')).every(b=>b.visible));results.checks.push('expanded details, scroll, focused action survive refresh');
  await frame.locator('[data-weekly-action="takeover"]').click();assert.equal(await frame.evaluate(()=>window.qa.calls.at(-1)[0]),'takeover');
  await frame.evaluate(()=>window.qa.open('weekly-guest','ko'));await page.waitForTimeout(300);await frame.evaluate(()=>window.qa.failAction());await frame.locator('[data-weekly-action="practice"]').click();
  assert.ok(await frame.locator('.weekly-status').count());assert.ok((await inspect(frame,'weekly-guest')).every(b=>b.visible));results.checks.push('failed weekly action keeps status and visible retryable practice action');
  await frame.locator('[data-weekly-action="close"]').click();assert.equal(await frame.evaluate(()=>document.activeElement.id),'opener');assert.equal(await frame.locator('#app').evaluate(el=>el.inert),false);
  for(const kind of ['puzzle-failure','puzzle-success','puzzle-briefing']){
    await frame.evaluate(k=>window.qa.open(k,'ko'),kind);await page.waitForTimeout(260);
    const action=kind==='puzzle-failure'?'retry':kind==='puzzle-success'?'next':'start';await frame.locator(`[data-action="${action}"]`).click();
    if(action==='next'){assert.ok(await frame.locator('.puzzle-ui-briefing-card').count());await frame.locator('[data-action="start"]').click();}
    assert.ok(await frame.locator('.puzzle-ui-playing').count());assert.ok((await frame.evaluate(()=>window.qa.calls)).length);results.checks.push(kind+' action callback and playing HUD');
  }
  await frame.evaluate(()=>window.qa.open('weekly-guest','ko'));await page.waitForTimeout(260);await frame.locator('[data-weekly-tab="previous"]').click();assert.equal(await frame.locator('[data-weekly-tab="previous"]').getAttribute('aria-selected'),'true');
  await page.keyboard.press('Escape');assert.equal(await frame.locator('.weekly-modal').count(),0);results.checks.push('weekly previous tab, Escape and focus return');
  await page.goto(origin+'/__qa/fixture');await page.waitForFunction(()=>!!window.qa);
  for(const [w,h] of [[1920,1080],[1280,720],[826,345],[360,640],[568,320]])for(const kind of ['puzzle-success','weekly-takeover']){
    await page.setViewportSize({width:w,height:h});await page.evaluate(k=>window.qa.open(k,'fr'),kind);await page.waitForTimeout(260);const actions=await inspect(page,kind);results.cases.push({mode:'direct',w,h,lang:'fr',kind,actions,pass:actions.length>0&&actions.every(b=>b.visible)});
  }
  assert.equal(results.errors.length,0,JSON.stringify(results.errors));assert.ok(results.cases.every(c=>c.pass),'all action targets fit without scroll');
  results.pass=true;console.log(JSON.stringify({pass:true,cases:results.cases.length,checks:results.checks,errors:results.errors}));
}catch(e){results.pass=false;results.failure=e.stack;console.error(e);process.exitCode=1;}
finally{await writeFile(out+'/layout-results.json',JSON.stringify(results,null,2));await browser.close();await new Promise(r=>server.close(r));await vite.close();}
