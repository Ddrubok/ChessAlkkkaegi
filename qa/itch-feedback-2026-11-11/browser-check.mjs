import assert from 'node:assert/strict';
import { createServer } from '../../web/node_modules/vite/dist/node/index.js';
import { chromium } from '../../.orca/ui-check/node_modules/playwright/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const out=resolve('qa/itch-feedback-2026-11-11');await mkdir(out,{recursive:true});
const vite=await createServer({root:resolve('web'),mode:'itch',logLevel:'error',cacheDir:resolve('.orca/feedback-browser-vite'),
  optimizeDeps:{noDiscovery:true,include:[]},server:{host:'127.0.0.1',port:0,open:false,hmr:false}});
await vite.listen();const address=vite.httpServer.address();const origin=`http://127.0.0.1:${address.port}`;
const browser=await chromium.launch({channel:'msedge',headless:true});
const result={pass:false,checks:[],errors:[],screenshots:[],externalRequestsBlocked:0};
const check=(condition,label)=>{assert.ok(condition,label);result.checks.push(label);};
let page;
async function shot(page,power){
  const cue=page.locator('.tutorial-gesture circle');await cue.waitFor({state:'visible'});
  const x=Number(await cue.getAttribute('cx')),y=Number(await cue.getAttribute('cy'));
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y+180*power,{steps:12});await page.mouse.up();
}
async function screenshot(name){await page.screenshot({path:resolve(out,name)});result.screenshots.push(name);}
const context=await browser.newContext({viewport:{width:1366,height:768},locale:'en-US'});
await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();result.externalRequestsBlocked++;return route.abort();});
try{
  page=await context.newPage();page.on('pageerror',error=>result.errors.push(error.message));
  await page.goto(origin);await page.locator('.tutorial-gesture circle').waitFor({timeout:30000});
  await screenshot('01-first-flick.png');
  await shot(page,.5);await page.locator('#feedback-start-stage').waitFor({timeout:20000});
  check(await page.locator('#feedback-practice-again').isVisible(),'successful first flick offers optional softer-shot practice');
  await page.locator('#feedback-start-stage').click();
  await page.locator('.mastery-hud-objective').filter({hasText:'Stage 1/10'}).waitFor();
  check(await page.locator('.feedback-stage-tip').textContent().then(s=>s.includes('not a one-shot')),'stage 1 explains three-pawn opening');
  const base=await page.evaluate(()=>JSON.parse(localStorage.getItem('ca_itch_opening_v2:guest')));
  await page.locator('.return-menu-button').click();const confirm=page.locator('.menu-confirm-overlay [data-menu-confirm]');if(await confirm.isVisible())await confirm.click();
  await page.getByRole('button',{name:'Return to Main',exact:true}).click();await page.locator('#menu-recommendation-btn').waitFor();
  await page.locator('#menu-sound-btn').click();await page.locator('#tab-btn-controls').click();
  await page.locator('[data-power-distance="360"]').click();
  check(await page.locator('[data-power-distance="360"]').getAttribute('aria-pressed')==='true','Controls selects precise pull distance');
  await screenshot('02-controls.png');await page.locator('#settings-power-reset').click();
  check(await page.locator('[data-power-distance="180"]').getAttribute('aria-pressed')==='true','Controls reset restores original distance');
  await page.locator('#settings-modal-close').click();
  // Isolated local QA checkpoint only; never touches a real account or hosted game.
  const checkpoint=structuredClone(base);checkpoint.run.stage=5;checkpoint.run.cards.forceGrade=4;checkpoint.run.cards.picksSoFar=4;checkpoint.run.points.lastClearedStage=4;
  await page.evaluate(value=>localStorage.setItem('ca_itch_opening_v2:guest',JSON.stringify(value)),checkpoint);await page.reload();
  await page.locator('#menu-recommendation-btn').waitFor();
  const before=await page.evaluate(()=>({checkpoint:localStorage.getItem('ca_itch_opening_v2:guest'),points:localStorage.getItem('chessAlkkagi.meta.points'),history:localStorage.getItem('has_completed_tutorial')}));
  await page.locator('#menu-tutorial-btn').click();await page.locator('[data-power-practice]').click();
  await page.getByText('Power control practice',{exact:true}).waitFor();await shot(page,.4);
  await page.locator('#feedback-practice-again').waitFor({timeout:20000});
  check(await page.getByText('You released a controlled shot!',{exact:true}).isVisible(),'real 40% pointer shot completes reward-free power practice');
  await screenshot('03-practice-complete.png');await page.locator('#feedback-practice-again').click();
  await page.locator('.tutorial-gesture circle').waitFor();await shot(page,.7);
  await page.locator('.tutorial-guide-text').filter({hasText:'70%'}).waitFor({timeout:20000});
  check(true,'70% shot gives power-specific retry hint');
  await page.waitForFunction(()=>document.querySelector('.tutorial-guide-text')?.textContent.includes('Pull a little'));
  await screenshot('04-power-practice.png');await shot(page,.4);await page.locator('#feedback-practice-menu').waitFor({timeout:20000});await page.locator('#feedback-practice-menu').click();
  await page.locator('#menu-recommendation-btn').waitFor();
  const after=await page.evaluate(()=>({checkpoint:localStorage.getItem('ca_itch_opening_v2:guest'),points:localStorage.getItem('chessAlkkagi.meta.points'),history:localStorage.getItem('has_completed_tutorial')}));
  assert.deepEqual(after,before);check(true,'practice success/retry/exit preserves Stage 5 checkpoint, points and tutorial history');
  await page.locator('[data-game-mode="online"]').click();await page.locator('[data-friendly-host]').waitFor();
  check((await page.locator('.feedback-online-guide').textContent()).includes('random opponent'),'guest friendly lobby explains friend codes vs signed-in matchmaking');
  await screenshot('05-guest-online-guide.png');await page.locator('[data-friendly-close]').click();
  await page.reload();await page.locator('#menu-recommendation-btn').waitFor();await page.locator('#menu-tutorial-btn').click();
  check(await page.locator('[data-power-practice]').isVisible(),'returning player has direct power practice entry');
  await page.locator('#lobby-tutorial-dialog [data-lobby-sheet-close]').click();
  for(const [width,height] of [[800,450],[390,844]]) {
    await page.setViewportSize({width,height});await page.locator('#menu-sound-btn').click();await page.locator('#tab-btn-controls').click();
    const controls=await page.locator('[data-power-distance]').all();
    for(const control of controls){const box=await control.boundingBox();check(box.x>=0&&box.x+box.width<=width,`control choice stays inside ${width}x${height}`);}
    await page.locator('#settings-power-reset').scrollIntoViewIfNeeded();await screenshot(`controls-${width}x${height}.png`);
    await page.locator('#settings-modal-close').click();
  }
  await page.setViewportSize({width:1366,height:768});
  // Real result UI rendered separately with explicitly labelled sample preview data.
  await page.route('**/__feedback_fixture',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><body><h1 style="font:14px sans-serif">Local QA fixture — sample card values</h1><script type="module">
    import '/src/style.css';import '/src/feedback-improvements.css';
    import {createMatchRuntime,showMatchResult,showSoloDrawResult} from '/src/match.ts';
    import {UPGRADE_CARDS} from '/src/cards.ts';
    const runtime=createMatchRuntime(document.body,async()=>{});
    window.qaCards=()=>showMatchResult(runtime,'white','stage',1,async()=>{},['weight','force','giantPawn'].map(id=>UPGRADE_CARDS.find(c=>c.id===id)),async()=>{},async()=>{},null,{weight:{before:0,after:.05,appliedValues:[{piece:'Pawn',stat:'mass',before:.02742,after:.02879}]},force:{before:0,after:.05},giantPawn:{pawnsLost:2}});
    window.qaDraw=()=>showSoloDrawResult(runtime,5,async()=>{},async()=>{});window.qaCards();
    </script></body></html>`}));
  await page.goto(origin+'/__feedback_fixture');await page.locator('.upgrade-card').first().waitFor();
  check(await page.locator('.cg-card-details').count()===1,'ordinary cards have no redundant Details; special card retains useful explanation');
  check(!(await page.locator('.match-card-choices').textContent()).includes('Shorter travel'),'card UI removes incorrect weight penalty');
  await screenshot('06-upgrade-cards.png');await page.setViewportSize({width:800,height:450});await screenshot('07-upgrade-small.png');
  await page.evaluate(()=>window.qaDraw());await page.getByRole('button',{name:'Replay Stage 5',exact:true}).waitFor();await screenshot('08-draw-replay.png');
  check(await page.locator('.match-result-details').textContent().then(s=>s.includes('current upgrades')),'draw UI offers same-stage replay with current upgrades');
  check(result.errors.length===0,'no browser page errors in tested flows');result.pass=true;
}catch(error){result.failure=error.stack;await page?.screenshot({path:resolve(out,'browser-failure.png')}).catch(()=>{});throw error;}
finally{await writeFile(resolve(out,'browser-result.json'),JSON.stringify(result,null,2));await browser.close();await vite.close();console.log(JSON.stringify(result));}
