import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from '../../web/node_modules/vite/dist/node/index.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '../../.orca/ui-check/node_modules/playwright/index.mjs');
const baseline = process.argv.includes('--baseline');
if (baseline && !process.env.QA_BASELINE_ROOT) throw Error('Set QA_BASELINE_ROOT to the baseline worktree web directory.');
const root = baseline ? resolve(process.env.QA_BASELINE_ROOT) : resolve('web');
const out = resolve('qa/game-feel-2026-11-01', baseline ? 'baseline' : 'candidate');
await mkdir(out, {recursive:true});
const server = await createServer({root, cacheDir:resolve(out,'.vite'), mode:'staging', logLevel:'error', server:{host:'127.0.0.1',port:baseline?4180:4181,strictPort:true,hmr:false}, plugins:[{
 name:'observation-only',enforce:'pre',transform(code,id){
  if(id.replaceAll('\\','/').endsWith('/src/sound.ts')&&!baseline){
   return code.replace('      const event: ImpactFeedbackEvent = {',`(window.__feelImpacts??=[]).push({time:performance.now(),key,impulse,approaching,score});\n      const event: ImpactFeedbackEvent = {`);
  }
  if(!id.replaceAll('\\','/').endsWith('/src/loop.ts'))return;
  const marker='  const frame = (now: number): void => {';
  assert.ok(code.includes(marker));
  return code.replace(marker,`window.__feelFrames=[];window.__feelQA={sceneRuntime,physicsRuntime,aimRuntime,inputRuntime,turnRuntime};\n${marker}`).replace('    const metrics = collectMetrics(',`window.__feelFrames.push({now,phase:turnRuntime.phase,pending:!!aimRuntime.pendingLaunchFeedback,restore:!!aimRuntime.launchRestore,bow:aimRuntime.bowstring.visible});\n    const metrics = collectMetrics(`).replace('    fpsFrameCount += 1;',`if(!window.__feelContactCapture&&sceneRuntime.scene.children.some(x=>x.name==='contact-feedback'&&x.visible))window.__feelContactCapture=sceneRuntime.renderer.domElement.toDataURL();\n    fpsFrameCount += 1;`);
 }
}]});
await server.listen();
const browser=await chromium.launch({channel:'msedge',headless:true});
const results=[];
try{
 for(const [width,height,touch] of [[1280,720,false],[844,390,true],[390,844,true]]){
  const context=await browser.newContext({viewport:{width,height},hasTouch:touch,isMobile:touch,deviceScaleFactor:1,recordVideo:{dir:out,size:{width,height}}});
  await context.addInitScript(()=>localStorage.setItem('app_language','ko'));
  await context.route('**/*',r=>['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
  const page=await context.newPage(),errors=[],launches=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.text().startsWith('[발사]'))launches.push(m.text());});
  const row={width,height,touch,errors,launches,method:'real tutorial pointer input; source transform exposes references only; external network blocked'};results.push(row);
  try{
   await page.goto(`http://127.0.0.1:${baseline?4180:4181}/`);
   await page.waitForFunction(()=>window.__feelQA?.turnRuntime.phase==='ready'&&document.querySelector('.tutorial-coach-card'));
   await page.waitForTimeout(300);
   await page.screenshot({path:resolve(out,`${width}-ready.png`)});
   const point=await page.evaluate(()=>{
    const {sceneRuntime:s,physicsRuntime:p}=window.__feelQA;
    const b=[...p.pieces.values()].find(x=>x.instance.side==='white');
    const m=s.pieceMeshes.get(b.instance.id);m.geometry.computeBoundingBox();m.updateMatrixWorld();
    const v=m.geometry.boundingBox.getCenter(m.position.clone()).applyMatrix4(m.matrixWorld).project(s.camera),r=s.renderer.domElement.getBoundingClientRect();
    return {x:r.x+(v.x+1)*r.width/2,y:r.y+(1-v.y)*r.height/2,id:b.instance.id};
   });
   row.point=point;
   const cdp=await context.newCDPSession(page);
   const input=async(type,x,y)=>touch?cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y}]}):type==='touchStart'?page.mouse.down():type==='touchEnd'?page.mouse.up():page.mouse.move(x,y);
   if(!touch)await page.mouse.move(point.x,point.y);
   await input('touchStart',point.x,point.y);
   const end={x:point.x,y:Math.min(height-75,point.y+height*.22)};
   for(let i=1;i<=12;i++){await input('touchMove',point.x,point.y+(end.y-point.y)*i/12);await page.waitForTimeout(12);}
   row.aim=await page.evaluate(()=>({power:window.__feelQA.aimRuntime.activeAim?.normalizedPower,phase:window.__feelQA.turnRuntime.phase,display:document.querySelector('.aim-power')?.textContent,parameters:document.querySelector('.aim-parameters')?.textContent}));
   await page.screenshot({path:resolve(out,`${width}-pull.png`)});
   await page.waitForTimeout(250);
   row.heldPower=await page.evaluate(()=>window.__feelQA.aimRuntime.activeAim?.normalizedPower);
   assert.equal(row.heldPower,row.aim.power,'holding must not charge');
   await input('touchEnd',end.x,end.y);
   await page.waitForTimeout(2200);
   row.result=await page.evaluate(()=>({pieces:window.__feelQA.physicsRuntime.pieces.size,phase:window.__feelQA.turnRuntime.phase,tutorial:document.querySelector('.tutorial-coach-card')?.textContent}));
   row.restoreFrames=await page.evaluate(()=>window.__feelFrames.filter(f=>f.restore));
   row.impacts=await page.evaluate(()=>window.__feelImpacts??[]);
   row.frameTimes=await page.evaluate(()=>{const times=window.__feelFrames.slice(20).map(f=>f.now),dt=times.slice(1).map((t,i)=>t-times[i]).sort((a,b)=>a-b);return{samples:dt.length,median:dt[Math.floor(dt.length*.5)],p95:dt[Math.floor(dt.length*.95)]};});
   const capture=await page.evaluate(()=>window.__feelContactCapture);
   if(capture)await writeFile(resolve(out,`${width}-contact.png`),Buffer.from(capture.split(',')[1],'base64'));
   if(!baseline)assert.ok(row.restoreFrames.some(f=>f.bow),'actual launch must render the bowstring restore');
   await page.screenshot({path:resolve(out,`${width}-result.png`)});
   assert.ok(launches.length>0,'real pointer release must launch');
   assert.equal(errors.length,0,'no page runtime errors');
  }catch(e){row.failure=String(e);await page.screenshot({path:resolve(out,`${width}-failure.png`)}).catch(()=>{});}
  row.video=await page.video().path();await context.close();
  await writeFile(resolve(out,'results.json'),JSON.stringify(results,null,2));
  console.log(JSON.stringify(row));
 }
}finally{await browser.close();await server.close();}
assert.ok(results.every(r=>!r.failure),'browser check failed');
