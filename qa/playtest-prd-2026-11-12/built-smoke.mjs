import assert from 'node:assert/strict';
import { preview } from '../../web/node_modules/vite/dist/node/index.js';
import { chromium } from '../../.orca/ui-check/node_modules/playwright/index.mjs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const out=resolve('qa/playtest-prd-2026-11-12/built-'+new Date().toISOString().replaceAll(':','-').replaceAll('.','-'));await mkdir(out,{recursive:true});
const server=await preview({root:resolve('web'),mode:'itch',logLevel:'error',build:{outDir:'dist-itch'},preview:{host:'127.0.0.1',port:0,open:false}});
const origin='http://127.0.0.1:'+server.httpServer.address().port;
const browser=await chromium.launch({channel:'msedge',headless:true});
const result={scope:'Final compiled itch build; fresh offline browser; scripted pointer input',build:JSON.parse(await readFile(resolve('web/dist-itch/build-info.json'),'utf8')),errors:[],checks:[],externalOrigins:[]};
try{
  const context=await browser.newContext({viewport:{width:1366,height:768},locale:'en-US',serviceWorkers:'block'});
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===origin)return route.continue();if(!result.externalOrigins.includes(url.origin))result.externalOrigins.push(url.origin);return route.abort();});
  await context.routeWebSocket('**/*',socket=>socket.close());const page=await context.newPage();page.on('pageerror',e=>result.errors.push(e.message));
  await page.goto(origin);const cue=page.locator('.tutorial-gesture circle');await cue.waitFor({timeout:30000});
  const x=Number(await cue.getAttribute('cx')),y=Number(await cue.getAttribute('cy'));
  await page.mouse.move(x,y);await page.mouse.down();const box=await page.locator('canvas.game-canvas').boundingBox();const distance=Math.min(box.width,box.height)*.18*.8/1.5;
  await page.mouse.move(x,y+distance*.5,{steps:8});await page.screenshot({path:resolve(out,'compiled-half-aim.png')});await page.mouse.up();
  await page.locator('#feedback-start-stage').waitFor({timeout:20000});result.checks.push('real pull/release completes the first flick in compiled build');
  await page.screenshot({path:resolve(out,'compiled-first-result.png')});assert.equal(result.errors.length,0);result.checks.push('no browser page errors');result.pass=true;
}catch(error){result.failure=error.stack;throw error;}
finally{await writeFile(resolve(out,'result.json'),JSON.stringify(result,null,2));await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));console.log(JSON.stringify({directory:out,pass:result.pass,checks:result.checks,failure:result.failure}));}
