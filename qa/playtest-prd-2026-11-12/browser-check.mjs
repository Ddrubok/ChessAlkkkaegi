import assert from 'node:assert/strict';
import { createServer } from '../../web/node_modules/vite/dist/node/index.js';
import { chromium } from '../../.orca/ui-check/node_modules/playwright/index.mjs';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const phase=process.argv[2]??'after';
const stamp=new Date().toISOString().replaceAll(':','-').replaceAll('.','-');
const out=resolve('qa/playtest-prd-2026-11-12',phase+'-'+stamp);await mkdir(out,{recursive:true});
const files=['input.ts','power-controls.ts','scene.ts','main.ts','tutorial.ts','settings-modal.ts','piece-identity.ts','piece-identity.css','crazygames-opening.css','game-hud.css'];
async function hashes(){return Object.fromEntries(await Promise.all(files.map(async file=>[file,createHash('sha256').update(await readFile(resolve('web/src',file))).digest('hex')])));}
const before=await hashes();
const server=await createServer({root:resolve('web'),mode:'itch',logLevel:'error',cacheDir:resolve('.orca/playtest-browser-vite'),optimizeDeps:{noDiscovery:true,include:[]},server:{host:'127.0.0.1',port:0,open:false,hmr:false},plugins:[{name:'local-playtest-inspection',transform(code,id){
  if(!id.replaceAll('\\','/').endsWith('/src/main.ts'))return;
  return code.replace('let gameLoopStarted = false;',`globalThis.__playtestQA={sceneRuntime,inputRuntime,physicsRuntime,turnRuntime,aimRuntime,aimParametersRuntime,tutorialManager,selectPiece,switchInputMode,resetBoard,get gameMode(){return gameModeRuntime;}};let gameLoopStarted = false;`)
    .replace('queueLaunch: (request) => {','queueLaunch: (request) => { (globalThis.__playtestEvents??=[]).push({pieceId:request.pieceId,power:request.normalizedPower});');
}}]});
await server.listen();const origin='http://127.0.0.1:'+server.httpServer.address().port;
const browser=await chromium.launch({channel:'msedge',headless:true});
const result={phase,scope:'Local browser; test-only runtime instrumentation; scripted pointer input; no hosted account or server operations',checks:[],observations:[],pageErrors:[],blockedOrigins:[],screenshots:[],sourceBefore:before};
const context=await browser.newContext({viewport:{width:1366,height:768},locale:'en-US',serviceWorkers:'block'});
await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===origin)return route.continue();if(!result.blockedOrigins.includes(url.origin))result.blockedOrigins.push(url.origin);return route.abort();});
await context.routeWebSocket('**/*',socket=>socket.close());
let page;
async function screenshot(name){await page.screenshot({path:resolve(out,name)});result.screenshots.push(name);}
async function state(){return page.evaluate(()=>{const q=globalThis.__playtestQA;const rect=q.sceneRuntime.renderer.domElement.getBoundingClientRect();return {phase:q.turnRuntime.phase,side:q.turnRuntime.currentSide,selected:q.aimRuntime.selectedPieceId,canvas:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},requests:globalThis.__playtestEvents??[]};});}
const check=(condition,label)=>{assert.ok(condition,label);result.checks.push(label);};
try{
  page=await context.newPage();page.on('pageerror',e=>result.pageErrors.push(e.message));
  await page.goto(origin);await page.locator('.tutorial-gesture circle').waitFor({timeout:30000});
  await page.waitForFunction(()=>globalThis.__playtestQA?.turnRuntime.phase==='ready');
  await screenshot('01-first-flick.png');
  const cue=page.locator('.tutorial-gesture circle');const x=Number(await cue.getAttribute('cx')),y=Number(await cue.getAttribute('cy'));
  const initial=await state();await page.mouse.click(x,y);await page.waitForTimeout(120);const clicked=await state();
  check(clicked.requests.length===initial.requests.length,'pure click does not queue a shot');
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y+1);await page.mouse.up();await page.waitForTimeout(120);
  const jitter=await state();result.observations.push({name:'one-pixel-jitter',before:initial,after:jitter});
  if(phase==='after')check(jitter.requests.length===initial.requests.length,'one-pixel jitter does not queue a shot');
  await screenshot('02-after-jitter.png');
  if(phase==='baseline'){
    result.observations.push({name:'baseline',jitterQueued:jitter.requests.length>initial.requests.length});
  }else{
    const module=await page.evaluate(async()=>{const p=await import('/src/power-controls.ts');const q=globalThis.__playtestQA;const r=q.sceneRuntime.renderer.domElement.getBoundingClientRect();return {effective:p.computeViewportPowerDistance(p.getMousePowerDistance(),r.width,r.height),preferred:p.getMousePowerDistance()};});
    await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y+module.effective*.5,{steps:8});await screenshot('03-half-power-aim.png');
    const aim=await page.evaluate(()=>({power:globalThis.__playtestQA.aimRuntime.activeAim?.normalizedPower,distance:globalThis.__playtestQA.inputRuntime.gesture?.maxDragPixels}));
    check(Math.abs(aim.power-.5)<.005,'50% drag displays computed 50% power');await page.mouse.up();
    await page.locator('#feedback-start-stage').waitFor({timeout:20000});check((await state()).requests.length===initial.requests.length+1,'one valid release queues exactly one shot');
    await screenshot('04-first-shot-result.png');
    await page.locator('#feedback-start-stage').click();await page.locator('.mastery-hud-objective').filter({hasText:'Stage 1/10'}).waitFor();await screenshot('05-stage1.png');
    for(const [width,height] of [[1366,768],[1280,720],[1920,1080],[800,450],[390,844]]){
      await page.setViewportSize({width,height});await page.waitForTimeout(250);
      const geometry=await page.evaluate(()=>{const q=globalThis.__playtestQA,c=q.sceneRuntime.camera,r=q.sceneRuntime.renderer.domElement.getBoundingClientRect();c.updateMatrixWorld(true);return {canvas:{width:r.width,height:r.height},pieces:[...q.sceneRuntime.pieceMeshes].map(([id,m])=>{const p=m.getWorldPosition(m.position.clone()).project(c);return {id,x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2};})};});
      result.observations.push({name:'stage1-geometry',viewport:{width,height},...geometry});await screenshot(`stage1-${width}x${height}.png`);
    }
    // The real full-board reset is invoked through test instrumentation. These are
    // scripted geometry tasks, not a claim about human selection or comfort.
    for(const [width,height] of [[1366,768],[800,450],[390,844]]){
      await page.setViewportSize({width,height});
      await page.evaluate(async()=>{const q=globalThis.__playtestQA;q.tutorialManager.stop();q.gameMode.mode='hotseat';await q.resetBoard({gameMode:'hotseat',stageNumber:1});q.switchInputMode(q.inputRuntime,'classic',false);});
      await page.waitForFunction(()=>globalThis.__playtestQA.turnRuntime.phase==='ready'&&globalThis.__playtestQA.inputRuntime.cameraTransition===null);
      const pieces=await page.evaluate(()=>{const q=globalThis.__playtestQA;return [...q.physicsRuntime.pieces.values()].filter(p=>p.instance.side==='white').map(p=>({id:p.instance.id,type:p.instance.type}));});
      const chosen=pieces.filter(p=>p.type==='Rook'||p.type==='Queen'||p.type==='King').slice(0,4);
      for(const piece of chosen){
        for(let direction=0;direction<8;direction++){
          const point=await page.evaluate(({id})=>{const q=globalThis.__playtestQA,m=q.sceneRuntime.pieceMeshes.get(id);m.updateMatrixWorld(true);m.geometry.computeBoundingBox();const p=m.geometry.boundingBox.getCenter(m.position.clone()).applyMatrix4(m.matrixWorld).project(q.sceneRuntime.camera);const r=q.sceneRuntime.renderer.domElement.getBoundingClientRect();return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2,width:r.width,height:r.height};},piece);
          const distance=await page.evaluate(async({width,height})=>{const p=await import('/src/power-controls.ts');return p.computeViewportPowerDistance(p.getMousePowerDistance(),width,height);},point);
          const power=piece.type==='Rook'||piece.type==='Queen'?1.5:1;
          const angle=direction*Math.PI/4;
          await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x+Math.cos(angle)*distance*power,point.y+Math.sin(angle)*distance*power,{steps:2});
          const end={x:point.x+Math.cos(angle)*distance*power,y:point.y+Math.sin(angle)*distance*power};
          const aimed=await page.evaluate(({x,y})=>{const q=globalThis.__playtestQA,r=q.sceneRuntime.renderer.domElement.getBoundingClientRect(),cancel=q.inputRuntime.cancelControl;const c=cancel?.hidden===false?cancel.getBoundingClientRect():null;return {id:q.aimRuntime.selectedPieceId,power:q.aimRuntime.activeAim?.normalizedPower,camera:q.sceneRuntime.camera.position.toArray(),releaseInside:x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom,overCancel:c&&x>=c.left&&x<=c.right&&y>=c.top&&y<=c.bottom};},end);
          result.observations.push({name:'full-board-direction',viewport:{width,height},piece,direction,expectedPower:power,actual:aimed});
          if(aimed.id===piece.id)check(Math.abs(aimed.power-power)<.005,`${width}x${height} ${piece.type} direction ${direction} reaches ${power*100}%`);
          else throw new Error(`Pointer selected ${aimed.id} instead of ${piece.id}`);
          check(aimed.releaseInside&&!aimed.overCancel,`${width}x${height} ${piece.type} direction ${direction} release stays valid`);
          if(direction===2&&piece===chosen[0]){
            await page.keyboard.down('KeyA');await page.waitForTimeout(100);await page.keyboard.up('KeyA');
            const camera=await page.evaluate(()=>globalThis.__playtestQA.sceneRuntime.camera.position.toArray());check(camera.every((n,i)=>Math.abs(n-aimed.camera[i])<1e-9),'camera stays fixed while pulling and holding A');
            const separation=await page.evaluate(()=>{const power=document.querySelector('.aim-power').getBoundingClientRect(),cancel=globalThis.__playtestQA.inputRuntime.cancelControl.getBoundingClientRect();return {power:{x:power.x,y:power.y,w:power.width,h:power.height},cancel:{x:cancel.x,y:cancel.y,w:cancel.width,h:cancel.height},overlap:power.left<cancel.right&&power.right>cancel.left&&power.top<cancel.bottom&&power.bottom>cancel.top};});
            check(!separation.overlap,'power readout is not covered by cancel target');
          }
          if(direction===2&&piece.type==='Rook')await screenshot(`rook-150-${width}x${height}.png`);
          if(direction===2&&piece===chosen[0]){
            const requests=(await state()).requests.length;
            await page.setViewportSize({width:width-1,height});
            check(await page.evaluate(()=>globalThis.__playtestQA.inputRuntime.gesture===null),'resize cancels an active power gesture');
            await page.mouse.up();check((await state()).requests.length===requests,'release after resize does not fire');
            await page.setViewportSize({width,height});
          }
          await page.keyboard.press('Escape');await page.mouse.up();
        }
      }
      await page.evaluate(()=>{const q=globalThis.__playtestQA;q.selectPiece(q.inputRuntime,[...q.physicsRuntime.pieces.values()].find(p=>p.instance.type==='Rook'&&p.instance.side==='white').instance.id);});
      await page.locator('.piece-identity').waitFor({state:'visible'});await screenshot(`piece-hint-${width}x${height}.png`);
      check((await page.locator('.piece-identity summary').textContent()).includes('150%'),'selected rook shows its actual central-strike cap');
      const hintClear=await page.locator('.piece-identity').evaluate(el=>{const r=el.getBoundingClientRect();return [...document.querySelectorAll('.player-banner:not([hidden]),.turn-hud-badge')].filter(e=>getComputedStyle(e).display!=='none').every(e=>{const p=e.getBoundingClientRect();return !(r.left<p.right&&r.right>p.left&&r.top<p.bottom&&r.bottom>p.top);});});check(hintClear,'piece summary does not cover player identity or turn');
      await page.locator('.piece-identity summary').click();check(await page.locator('.piece-identity').getAttribute('open')!==null,'native details opens without launching');
      await page.evaluate(async()=>{(await import('/src/settings-modal.ts')).openSettingsModal();});await page.locator('#tab-btn-controls').click();
      const actualCopy=await page.locator('.power-controls-settings').textContent();check(actualCopy.includes('Actual on this screen'),'settings discloses actual viewport distance');
      await page.locator('#settings-power-240').focus();await page.setViewportSize({width:width-1,height});await page.waitForTimeout(80);
      check(await page.locator('#settings-power-240').evaluate(el=>el===document.activeElement),'controls choice keeps keyboard focus after resize');
      await page.setViewportSize({width,height});await page.waitForTimeout(80);await screenshot(`controls-${width}x${height}.png`);await page.locator('#settings-modal-close').click();
      await page.evaluate(()=>{const q=globalThis.__playtestQA;q.switchInputMode(q.inputRuntime,'billiards',false);q.selectPiece(q.inputRuntime,[...q.physicsRuntime.pieces.values()].find(p=>p.instance.type==='Rook'&&p.instance.side==='white').instance.id);});
      await page.waitForFunction(()=>globalThis.__playtestQA.inputRuntime.cameraTransition===null);
      const dot=await page.evaluate(async()=>{const q=globalThis.__playtestQA,r=q.sceneRuntime.renderer.domElement.getBoundingClientRect(),p=q.aimParametersRuntime.redDot.position.clone().project(q.sceneRuntime.camera),controls=await import('/src/power-controls.ts');return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2,d:controls.computeViewportPowerDistance(controls.getMousePowerDistance(),r.width,r.height),requests:(globalThis.__playtestEvents??[]).length};});
      await page.mouse.move(dot.x,dot.y);await page.mouse.down();await page.mouse.move(dot.x,dot.y+1.5*dot.d,{steps:5});
      const billiards=await page.evaluate(()=>({source:globalThis.__playtestQA.inputRuntime.gesture?.source,power:globalThis.__playtestQA.aimParametersRuntime.normalizedPower}));
      result.observations.push({name:'billiards-maximum',viewport:{width,height},dot,actual:billiards});
      check(billiards.source==='red-dot'&&Math.abs(billiards.power-1.5)<.005,`${width}x${height} billiards red dot reaches 150%`);await screenshot(`billiards-150-${width}x${height}.png`);await page.mouse.up();
      check((await state()).requests.length===dot.requests+1,`${width}x${height} billiards release queues exactly one maximum shot`);
    }
    await page.evaluate(async()=>{(await import('/src/i18n.ts')).I18nManager.setLanguage('ko');(await import('/src/settings-modal.ts')).openSettingsModal();});
    await page.locator('#tab-btn-controls').click();await screenshot('controls-ko-390x844.png');
    check((await page.locator('.power-controls-settings').textContent()).includes('실제 사용'),'Korean controls show the effective distance');
    for(const [width,height] of [[800,450],[390,844]]){
      const fresh=await browser.newContext({viewport:{width,height},locale:'en-US',serviceWorkers:'block'});
      await fresh.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());await fresh.routeWebSocket('**/*',socket=>socket.close());
      page=await fresh.newPage();page.on('pageerror',e=>result.pageErrors.push(e.message));await page.goto(origin);await page.locator('.tutorial-gesture path').waitFor({state:'attached'});
      await page.waitForFunction(()=>document.querySelector('.tutorial-gesture path')?.getAttribute('d'));
      check(!!await page.locator('.tutorial-gesture path').getAttribute('d'),`${width}x${height} first-flick direction arrow remains visible at the effective pull distance`);await screenshot(`first-cue-${width}x${height}.png`);await fresh.close();
    }
  }
  check(result.pageErrors.length===0,'no page errors in exercised flow');
}catch(error){result.failure=error.stack;if(page)await screenshot('failure.png').catch(()=>{});throw error;}
finally{result.sourceAfter=await hashes();result.sourcesChangedDuringRun=files.filter(f=>result.sourceBefore[f]!==result.sourceAfter[f]);await writeFile(resolve(out,'result.json'),JSON.stringify(result,null,2));await browser.close();await server.close();console.log(JSON.stringify({directory:out,checks:result.checks.length,observations:result.observations.length,sourcesChangedDuringRun:result.sourcesChangedDuringRun,failure:result.failure}));}
