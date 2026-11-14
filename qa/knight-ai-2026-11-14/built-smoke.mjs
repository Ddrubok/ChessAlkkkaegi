import { preview } from '../../web/node_modules/vite/dist/node/index.js';
import { chromium } from '../../.orca/ui-check/node_modules/playwright/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const out=resolve('qa/knight-ai-2026-11-14/built-smoke');
await mkdir(out,{recursive:false});
const server=await preview({configFile:false,root:resolve('web'),build:{outDir:resolve('qa/knight-ai-2026-11-14/dist-itch')},preview:{host:'127.0.0.1',port:0,open:false}});
const origin='http://127.0.0.1:'+server.httpServer.address().port;
const browser=await chromium.launch({channel:'msedge',headless:true});
const result={pageErrors:[],deniedOrigins:[],states:[]};
try{
  const context=await browser.newContext({viewport:{width:1366,height:768},locale:'en-US',serviceWorkers:'block'});
  await context.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===origin)return r.continue();
    if(!result.deniedOrigins.includes(u.origin))result.deniedOrigins.push(u.origin);return r.abort();});
  await context.routeWebSocket('**/*',s=>s.close());
  const page=await context.newPage();page.on('pageerror',e=>result.pageErrors.push(e.message));
  await page.goto(origin);const cue=page.locator('.tutorial-gesture circle');await cue.waitFor({timeout:30000});
  const x=Number(await cue.getAttribute('cx')),y=Number(await cue.getAttribute('cy'));
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y+100,{steps:8});await page.mouse.up();
  const start=page.locator('#feedback-start-stage');await start.waitFor({timeout:30000});await start.click();
  await page.locator('.mastery-hud-objective').filter({hasText:'Stage 1/10'}).waitFor({timeout:30000});
  for(const [width,height]of [[1366,768],[390,844]]){
    await page.setViewportSize({width,height});await page.waitForTimeout(200);
    result.states.push({width,height,stageVisible:await page.locator('.mastery-hud-objective').isVisible()});
    await page.screenshot({path:resolve(out,`stage-${width}.png`)});
  }
  if(result.pageErrors.length)throw new Error(result.pageErrors.join('\n'));
}catch(e){result.failure=e.stack;process.exitCode=1;}
finally{await writeFile(resolve(out,'result.json'),JSON.stringify(result,null,2));await browser.close();await new Promise(yes=>server.httpServer.close(yes));}
console.log(JSON.stringify(result));
