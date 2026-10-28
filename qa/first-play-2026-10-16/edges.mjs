import {chromium} from '../../.orca/ui-check/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const out='qa/first-play-2026-10-16', results=[];
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
await context.addInitScript(()=>localStorage.setItem('app_language','ko'));
await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
const page=await context.newPage(), errors=[];
page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(25000);
const cdp=await context.newCDPSession(page);
const state=()=>page.evaluate(()=>{const r=__firstQA;return{step:r.tutorialManager.currentStep,active:r.tutorialManager.isActive,pending:r.tutorialManager.isTransitioning,mode:r.gameModeRuntime.mode,phase:r.turnRuntime.phase,side:r.turnRuntime.currentSide,pieces:[...r.physicsRuntime.pieces.keys()],aiShots:r.aiRuntime.shotCounter,points:r.metaRuntime.state.points};});
const ready=()=>page.waitForFunction(()=>__firstQA.turnRuntime.phase==='ready'&&!__firstQA.tutorialManager.isTransitioning&&__firstQA.inputRuntime.cameraTransition===null);
async function shot(id,dx,dy,cancel=false){
 await ready();
 const p=await page.evaluate(id=>{const r=__firstQA,m=r.sceneRuntime.pieceMeshes.get(id);m.geometry.computeBoundingBox();m.updateMatrixWorld(true);const p=m.geometry.boundingBox.getCenter(m.position.clone()).applyMatrix4(m.matrixWorld).project(r.sceneRuntime.camera),v=r.sceneRuntime.renderer.domElement.getBoundingClientRect();return{x:v.x+(p.x+1)*v.width/2,y:v.y+(1-p.y)*v.height/2};},id);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:0}]});
 assert.equal(await page.evaluate(()=>__firstQA.inputRuntime.aimRuntime.activeAim?.pieceId),id);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:p.x+dx,y:p.y+dy,id:0}]});
 if(cancel)await page.keyboard.press('Escape');
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
}
async function setup(step,type='basic'){
 await page.evaluate(async({step,type})=>{await __firstQA.startModeAction('tutorial',step,type);},{step,type});await ready();
}
async function check(name,fn){try{await fn();results.push({name,pass:true});}catch(e){results.push({name,pass:false,error:e.stack,state:await state()});await page.screenshot({path:`${out}/edge-failure-${results.length}.png`});throw e;}finally{await fs.writeFile(`${out}/edge-results.json`,JSON.stringify({results,errors},null,2));}}
try{
 await page.goto('http://127.0.0.1:5227');await page.locator('#btn-guest-submit').click({timeout:40000});await page.locator('#menu-recommendation-btn').click();await page.locator('.tutorial-coach-card').waitFor();
 await check('Missed shot retries same step without credit',async()=>{
  await shot('white-pawn-d6',50,0);await page.waitForFunction(()=>__firstQA.tutorialManager.isTransitioning);await page.waitForFunction(()=>!__firstQA.tutorialManager.isTransitioning);
  const s=await state();assert.equal(s.step,1);assert.equal(s.points,0);assert.equal(s.pieces.length,2);assert.equal(s.side,'white');assert.match(await page.locator('.tutorial-guide-text').textContent(),/당겼다/);
 });
 await check('Actual AI turn follows an unsuccessful practice shot',async()=>{
  await setup(3);await shot('white-pawn-c2',20,0);
  await page.waitForFunction(()=>__firstQA.aiRuntime.shotCounter>0,{},{timeout:35000});
  await page.screenshot({path:`${out}/practice-ai-shot.png`});
  await page.waitForFunction(()=>__firstQA.turnRuntime.currentSide==='white'&&__firstQA.turnRuntime.phase==='ready'&&!__firstQA.tutorialManager.isTransitioning,{},{timeout:35000});
  assert.equal((await state()).step,3);assert.equal((await state()).points,0);
 });
 await check('Losing own King retries practice instead of granting victory',async()=>{
  await setup(3);await shot('white-pawn-c2',20,0);
  await page.evaluate(()=>__firstQA.physicsRuntime.pieces.get('white-king-e1').body.setTranslation({x:0,y:-10,z:0},true));
  await page.waitForFunction(()=>__firstQA.tutorialManager.isTransitioning);await page.waitForFunction(()=>!__firstQA.tutorialManager.isTransitioning);
  const s=await state();assert.equal(s.step,3);assert.equal(s.points,0);assert.equal(s.pieces.length,6);assert.ok(s.pieces.includes('white-king-e1'));
 });
 await check('Exit while success delay is pending cannot reset next mode',async()=>{
  await setup(1);await page.evaluate(()=>{void __firstQA.tutorialManager.handleStepSuccess();});
  await page.evaluate(()=>__firstQA.startModeAction('hotseat'));await page.waitForTimeout(1500);
  const s=await state();assert.equal(s.mode,'hotseat');assert.equal(s.active,false);assert.equal(s.points,0);assert.equal(s.pieces.length,32);
 });
 await check('Advanced keeps five steps and requires custom strike on step three',async()=>{
  await setup(3,'advanced');const a=await page.evaluate(()=>{const t=__firstQA.tutorialManager;return{count:t.stepCount,without:t.checkStepClear(1,[{type:'Pawn'}],true,false),with:t.checkStepClear(1,[{type:'Pawn'}],true,true),mode:__firstQA.inputRuntime.mode};});
  assert.equal(a.count,5);assert.equal(a.without.cleared,false);assert.equal(a.with.cleared,true);assert.equal(a.mode,'billiards');
 });
 await check('Completion credits once, traps focus and Android Back returns to lobby',async()=>{
  await setup(3);await page.evaluate(()=>{__firstQA.tutorialManager.completeTutorial();__firstQA.tutorialManager.completeTutorial();});
  assert.equal((await state()).points,100);assert.equal(await page.evaluate(()=>document.activeElement?.id),'btn-tutorial-start-stage');
  await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement?.id),'btn-tutorial-accept-adv');
  await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement?.id),'btn-tutorial-start-stage');
  const handled=await page.evaluate(async()=>{const m=await import('/src/android-back.ts');return m.backFromDialog(__firstQA.menuRuntime.overlay);});assert.equal(handled,true);
  await page.waitForFunction(()=>__firstQA.menuRuntime.visible);assert.equal(await page.locator('.tutorial-modal-overlay').count(),0);assert.equal(await page.locator('.lobby-other-modes').count(),0);
 });
 assert.deepEqual(errors,[]);
}catch(e){console.error(e.stack);process.exitCode=1;}finally{await browser.close();console.log(JSON.stringify({results,errors}));}
