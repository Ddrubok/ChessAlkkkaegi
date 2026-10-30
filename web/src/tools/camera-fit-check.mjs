import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../../.orca/ui-check/node_modules/playwright/index.mjs';

// Observe coordinates only. Normal pointer events drive the game controller and physics.
const out = fileURLToPath(new URL('../../../qa/quality-2026-10-30/browser/', import.meta.url));
await mkdir(out, {recursive:true});
const url = process.env.QUALITY_URL ?? 'http://127.0.0.1:5283/';
const browser = await chromium.launch({channel:'msedge',headless:true});
const results=[];
try {
  for(const [width,height,language,touch] of [
    [821,462,'en',false],[907,510,'fr',false],[1077,606,'ja',false],
    [1216,684,'ko',false],[1280,720,'en',false],[1366,768,'de',false],
    [1536,864,'es',false],[1920,1080,'pt-BR',false],
    [800,450,'ko',true],[360,800,'fr',true],
    [821,462,'zh-CN',false],[907,510,'ru',false],
  ]) {
    const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,hasTouch:touch,isMobile:touch,
      ...(width===1280?{recordVideo:{dir:out,size:{width,height}}}:{})});
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(({language})=>{
      localStorage.setItem('app_language',language);
      localStorage.setItem('chessAlkkagi.inputMode','billiards');
    },{language});
    await page.route('**/*', async route=>{
      const requestUrl=new URL(route.request().url());
      if(requestUrl.hostname!=='127.0.0.1') return route.abort();
      if(requestUrl.pathname==='/src/main.ts') {
        const response=await route.fetch();
        const body=await response.text();
        const marker='if (!localBalancePreview && firstTutorialCandidate';
        assert(body.includes(marker),'test observer insertion point');
        const observer=`window.__qualityRead = () => {
          const scene=sceneRuntime, rect=scene.renderer.domElement.getBoundingClientRect();
          const project = p => { const q=p.clone().project(scene.camera); return {x:rect.x+(q.x+1)*rect.width/2,y:rect.y+(1-q.y)*rect.height/2}; };
          const corners=[];
          for(const x of [-scene.boardHalfExtent,scene.boardHalfExtent]) for(const z of [-scene.boardHalfExtent,scene.boardHalfExtent]) corners.push(project(scene.camera.position.clone().set(x,0,z)));
          return {canvas:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},corners,
            distance:scene.camera.position.distanceTo(scene.controls.target),minimum:scene.minimumCameraDistance,
            pieces:[...scene.pieceMeshes].filter(([id,m])=>m.visible).map(([id,m])=>({id,...project(m.position),world:m.position.toArray()})),
            inputMode:inputRuntime.mode,inputState:inputRuntime.state,selected:inputRuntime.aimRuntime.selectedPieceId,
            mode:gameModeRuntime?.mode,step:tutorialManager.currentStep};
        };\n`;
        return route.fulfill({response,body:body.replace(marker,observer+marker)});
      }
      return route.continue();
    });
    await page.goto(url,{waitUntil:'domcontentloaded'});
    await page.locator('.tutorial-coach-card').waitFor({timeout:30000});
    await page.waitForTimeout(1100);
    const state=await page.evaluate(()=>window.__qualityRead());
    const coach=await page.locator('.tutorial-coach-card').boundingBox();
    const turnBadge=await page.locator('.turn-hud-badge').boundingBox();
    assert(turnBadge.y+turnBadge.height<=coach.y,`${width}: turn label overlap`);
    assert(coach.y+coach.height<=state.canvas.y+1,`${width}: coach overlap`);
    for(const corner of state.corners) {
      assert(corner.x>=-1 && corner.x<=width+1 && corner.y>=state.canvas.y-1 && corner.y<=state.canvas.y+state.canvas.height+1,`${width}: board clipped`);
    }
    assert.equal(state.inputMode,'classic');
    assert.equal(await page.evaluate(()=>localStorage.getItem('chessAlkkagi.inputMode')),'billiards');
    await page.screenshot({path:`${out}/${width}x${height}-${language}-tutorial.png`});
    const record={width,height,language,touch,initial:state,errors};
    if([821,1280,800].includes(width)) {
      const white=state.pieces.find(p=>p.id==='white-pawn-d6');
      const black=state.pieces.find(p=>p.id==='black-pawn-d8');
      assert(white && black,'basic step 1 pieces');
      const dx=white.x-black.x,dy=white.y-black.y,len=Math.hypot(dx,dy);
      const from={x:white.x,y:white.y-5};
      const drag=180;
      const to={x:from.x+dx/len*drag,y:Math.min(height-12,from.y+dy/len*drag)};
      if(width===821 && language==='en') {
        await page.mouse.move(from.x,from.y);await page.mouse.down();
        await page.mouse.move(from.x,from.y+30,{steps:4});
        const cancel=await page.locator('.classic-cancel-btn').boundingBox();
        await page.mouse.move(cancel.x+cancel.width/2,cancel.y+cancel.height/2,{steps:5});await page.mouse.up();
        await page.waitForTimeout(300);
        assert.equal((await page.evaluate(()=>window.__qualityRead())).step,1);
        assert(await page.locator('.classic-cancel-control').isHidden(),'explicit cancel ends the charge');
        const cancelled=await page.evaluate(()=>window.__qualityRead());
        assert.equal(cancelled.step,1);
        assert(Math.abs(cancelled.pieces.find(p=>p.id===white.id).world[2]-white.world[2])<0.01,'cancel does not launch the pawn');
        record.explicitCancel=true;
      }
      if(touch) {
        const cdp=await context.newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[from]});
        for(let i=1;i<=10;i++) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:from.x+(to.x-from.x)*i/10,y:from.y+(to.y-from.y)*i/10}]});
        await page.screenshot({path:`${out}/${width}x${height}-${language}-aim.png`});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      } else {
        await page.mouse.move(from.x,from.y);await page.mouse.down();
        await page.mouse.move(to.x,to.y,{steps:15});
        await page.screenshot({path:`${out}/${width}x${height}-${language}-aim.png`});
        await page.mouse.up();
      }
      await page.waitForFunction(()=>window.__qualityRead().step===2,{},{timeout:20000}).catch(async error=>{
        await page.screenshot({path:`${out}/${width}x${height}-failure.png`});
        await writeFile(`${out}/${width}-failure.json`,JSON.stringify({state:await page.evaluate(()=>window.__qualityRead()),text:await page.locator('body').innerText(),errors},null,2));
        throw error;
      });
      record.realFirstRingOut=true;
      await page.screenshot({path:`${out}/${width}x${height}-${language}-step2.png`});
    }
    await page.locator('.tutorial-skip-button').click();
    await page.locator('#menu-recommendation-btn').waitFor({state:'visible'});
    assert.equal(await page.evaluate(()=>localStorage.getItem('chessAlkkagi.inputMode')),'billiards');
    assert.equal((await page.evaluate(()=>window.__qualityRead())).inputMode,'billiards');
    await page.reload();
    await page.locator('#menu-recommendation-btn').waitFor({state:'visible',timeout:30000});
    assert.equal(await page.locator('.tutorial-coach-card').count(),0);
    record.skipAndReturningMenu=true;
    await page.locator('[data-game-mode="stage"]').first().click();
    await page.locator('#pve-start-btn').click();
    await page.waitForTimeout(1200);
    await page.screenshot({path:`${out}/${width}x${height}-${language}-stage1.png`});
    record.stage=await page.evaluate(()=>window.__qualityRead());
    assert.equal(record.stage.mode,'stage');
    if(width===1280) {
      const pawn=record.stage.pieces.find(p=>p.id.startsWith('white-pawn'));
      assert(pawn);
      await page.mouse.click(pawn.x,pawn.y-6);
      await page.waitForTimeout(500);
      const selected=(await page.evaluate(()=>window.__qualityRead())).selected;
      assert(selected,'stage pawn selection');
      await page.setViewportSize({width:907,height:510});
      await page.waitForTimeout(500);
      assert.equal((await page.evaluate(()=>window.__qualityRead())).selected,selected,'resize preserves selection');
      await page.screenshot({path:`${out}/resize-selected.png`});
      await page.keyboard.press('Escape');
      await page.locator('.input-mode-toggle [data-mode="classic"]').click();
      await page.waitForTimeout(600);
      await page.mouse.move(100,200);await page.mouse.down();
      await page.mouse.move(350,200,{steps:20});await page.mouse.up();
      await page.waitForTimeout(600);
      const rotated=await page.evaluate(()=>window.__qualityRead());
      for(const corner of rotated.corners) assert(corner.x>=-1 && corner.x<=908 && corner.y>=rotated.canvas.y-1 && corner.y<=rotated.canvas.y+rotated.canvas.height+1,'rotated board fits');
      record.resizeSelectionAndOrbit=true;
      await page.screenshot({path:`${out}/orbit-board.png`});
    }
    assert.deepEqual(errors,[]);
    results.push(record);
    console.log(`PASS ${width}x${height} ${language} ${touch?'touch':'mouse'}${record.realFirstRingOut?' real shot/ring-out':''}, skip, return, stage`);
    const video=page.video();
    await context.close();
    if(video) await video.saveAs(`${out}/firstplay-mouse-1280.webm`);
  }
} finally {
  await writeFile(`${out}/results.json`,JSON.stringify(results,null,2));
  await browser.close();
}
