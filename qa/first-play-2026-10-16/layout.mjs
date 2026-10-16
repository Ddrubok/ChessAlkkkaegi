import {chromium} from '../../.orca/ui-check/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
const browser=await chromium.launch({channel:'msedge',headless:true}),results=[];
try{
 for(const [width,height,lang] of [[320,568,'ko'],[320,568,'fr'],[320,568,'de'],[390,844,'ja'],[667,375,'ko'],[667,375,'fr']]){
  const context=await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
  await context.addInitScript(lang=>localStorage.setItem('app_language',lang),lang);
  await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  const page=await context.newPage();await page.goto('http://127.0.0.1:5227');await page.locator('#btn-guest-submit').click({timeout:40000});await page.locator('#menu-recommendation-btn').waitFor();
  await page.screenshot({path:`qa/first-play-2026-10-16/${width}-${height}-${lang}-lobby.png`});
  await page.locator('.lobby-other-modes>summary').click();
  const modes=await page.locator('.lobby-other-modes[open]').count();
  await page.locator('#menu-recommendation-btn').click();
  for(const step of [1,3]){
   if(step===3)await page.evaluate(()=>__firstQA.startModeAction('tutorial',3));
   await page.waitForFunction(()=>__firstQA.inputRuntime.cameraTransition===null);await page.waitForTimeout(350);
   const info=await page.evaluate(()=>{const r=__firstQA,coach=document.querySelector('.tutorial-coach-overlay'),c=coach.getBoundingClientRect(),v=r.sceneRuntime.renderer.domElement.getBoundingClientRect();const pieces=[...r.sceneRuntime.pieceMeshes].map(([id,m])=>{m.geometry.computeBoundingBox();m.updateMatrixWorld(true);const p=m.geometry.boundingBox.getCenter(m.position.clone()).applyMatrix4(m.matrixWorld).project(r.sceneRuntime.camera);return{id,x:v.x+(p.x+1)*v.width/2,y:v.y+(1-p.y)*v.height/2};});return{coach:c.toJSON(),canvas:v.toJSON(),pieces,overflow:document.documentElement.scrollWidth>innerWidth,motion:getComputedStyle(coach).animationName};});
   info.covered=info.pieces.filter(p=>p.x>=info.coach.left&&p.x<=info.coach.right&&p.y>=info.coach.top&&p.y<=info.coach.bottom).map(p=>p.id);
   results.push({width,height,lang,step,modes,...info});
   await page.screenshot({path:`qa/first-play-2026-10-16/${width}-${height}-${lang}-step${step}.png`});
  }
  await page.evaluate(()=>__firstQA.tutorialManager.completeTutorial());
  await page.screenshot({path:`qa/first-play-2026-10-16/${width}-${height}-${lang}-modal.png`});
  await context.close();
 }
}finally{await browser.close();await fs.writeFile('qa/first-play-2026-10-16/layout-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results.map(({width,height,lang,step,covered,overflow,motion})=>({width,height,lang,step,covered,overflow,motion}))));}
if(results.some(r=>r.covered.length||r.overflow||r.motion!=='none'))process.exitCode=1;
