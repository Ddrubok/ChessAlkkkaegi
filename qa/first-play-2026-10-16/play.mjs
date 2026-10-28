import {chromium} from '../../.orca/ui-check/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const out='qa/first-play-2026-10-16';
const browser=await chromium.launch({channel:'msedge',headless:true});
const results=[];
try {
 for(const [width,height,touch] of [[390,844,true],[320,568,true],[1280,800,false]]){
  const row={width,height,touch,errors:[],shots:[]};results.push(row);
  const context=await browser.newContext({viewport:{width,height},isMobile:touch,hasTouch:touch});
  await context.addInitScript(()=>localStorage.setItem('app_language','ko'));
  await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  const page=await context.newPage();page.on('pageerror',e=>row.errors.push(e.message));page.setDefaultTimeout(20000);
  const cdp=touch?await context.newCDPSession(page):null;
  const move=async(x,y)=>touch?cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y,id:0}]}):page.mouse.move(x,y,{steps:12});
  const down=async(x,y)=>{if(touch)await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:0}]});else{await page.mouse.move(x,y);await page.mouse.down();}};
  const up=async()=>touch?cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}):page.mouse.up();
  const state=()=>page.evaluate(()=>{const r=__firstQA;return {step:r.tutorialManager.currentStep,active:r.tutorialManager.isActive,transition:r.tutorialManager.isTransitioning,phase:r.turnRuntime.phase,side:r.turnRuntime.currentSide,mode:r.inputRuntime.mode,pieces:[...r.physicsRuntime.pieces.keys()],aiShots:r.aiRuntime.shotCounter,points:r.metaRuntime.state.points};});
  const cap=async name=>page.screenshot({path:`${out}/${width}-${name}.png`});
  async function shoot(white,black,pixels){
   await page.waitForFunction(()=>__firstQA.turnRuntime.phase==='ready'&&!__firstQA.tutorialManager.isTransitioning&&__firstQA.inputRuntime.cameraTransition===null);
   const start=await page.evaluate(id=>{const r=__firstQA,m=r.sceneRuntime.pieceMeshes.get(id);m.geometry.computeBoundingBox();m.updateMatrixWorld(true);const p=m.geometry.boundingBox.getCenter(m.position.clone()).applyMatrix4(m.matrixWorld).project(r.sceneRuntime.camera),v=r.sceneRuntime.renderer.domElement.getBoundingClientRect();return{x:v.x+(p.x+1)*v.width/2,y:v.y+(1-p.y)*v.height/2};},white);
   await down(start.x,start.y);
   const end=await page.evaluate(({white,black,pixels,start})=>{const r=__firstQA,a=r.inputRuntime.aimRuntime.activeAim;if(a?.pieceId!==white)throw Error('Wrong selected piece '+a?.pieceId);const p=r.physicsRuntime.pieces.get(white).body.translation(),q=r.physicsRuntime.pieces.get(black).body.translation();const dir=a.direction.clone().set(q.x-p.x,0,q.z-p.z).normalize();return{x:start.x-dir.dot(a.basis.right)*pixels,y:start.y+dir.dot(a.basis.forward)*pixels};},{white,black,pixels,start});
   assert.ok(end.x>0&&end.x<width&&end.y>0&&end.y<height,'release in viewport');
   await move(end.x,end.y);await page.waitForTimeout(150);await cap(`step${(await state()).step}-aim`);await up();
   row.shots.push({start,end,afterRelease:await state()});
  }
  try{
   await page.goto('http://127.0.0.1:5227');await page.locator('#btn-guest-submit').click({timeout:40000});await page.locator('#menu-recommendation-btn').waitFor();await cap('lobby');
   assert.equal(await page.locator('.lobby-other-modes').getAttribute('open'),null);
   await page.locator('#menu-recommendation-btn').click();await page.locator('.tutorial-coach-card').waitFor();await page.waitForTimeout(700);await cap('step1');
   assert.equal((await state()).mode,'classic');
   await shoot('white-pawn-d6','black-pawn-d8',100);
   await page.waitForFunction(()=>__firstQA.tutorialManager.currentStep===2&&!__firstQA.tutorialManager.isTransitioning,{},{timeout:25000});await cap('step2');
   await shoot('white-pawn-c5','black-pawn-f8',140);
   await page.waitForFunction(()=>__firstQA.tutorialManager.currentStep===3&&!__firstQA.tutorialManager.isTransitioning,{},{timeout:25000});await cap('step3');
   assert.equal((await state()).pieces.length,6);
   await shoot('white-rook-d3','black-king-d8',100);
   await page.locator('#btn-tutorial-start-stage').waitFor({timeout:30000});row.completed=await state();await cap('complete');
   await page.locator('#btn-tutorial-start-stage').click();await page.waitForFunction(()=>__firstQA.gameModeRuntime.mode==='stage'&&!__firstQA.gameModeRuntime.switching);await cap('stage-start');
   row.final=await state();assert.deepEqual(row.errors,[]);row.pass=true;
  }catch(e){row.pass=false;row.error=e.stack;row.state=await state().catch(()=>null);await cap('failure');}
  await context.close();await fs.writeFile(`${out}/play-results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(row));
  if(!row.pass)break;
 }
}finally{await browser.close();}
if(results.some(r=>!r.pass))process.exitCode=1;
