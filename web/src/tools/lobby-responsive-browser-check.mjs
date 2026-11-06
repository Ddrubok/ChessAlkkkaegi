// Optional browser QA: PLAYWRIGHT_MODULE may point to an existing Playwright install.
// Run from web/: node src/tools/lobby-responsive-browser-check.mjs [--portal] [--flows]
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer,preview} from 'vite';
const pw=process.env.PLAYWRIGHT_MODULE;
const {chromium}=await import(pw?pathToFileURL(resolve(pw)).href:'playwright');
const portal=process.argv.includes('--portal'), flows=process.argv.includes('--flows');
const built=process.argv.includes('--built');
const port=Number(process.env.LOBBY_QA_PORT||(portal?4195:4194));
const out=resolve(process.env.LOBBY_QA_OUTPUT||'../qa/menu-responsive-2026-11-03',(portal?'portal':'web')+(built?'-built':''));
await mkdir(out,{recursive:true});
const server=built?await preview({root:process.cwd(),mode:portal?'crazygames':'staging',logLevel:'error',preview:{host:'127.0.0.1',port,strictPort:true}}):await createServer({root:process.cwd(),cacheDir:resolve(out,'.vite'),mode:portal?'crazygames':'staging',logLevel:'error',server:{host:'127.0.0.1',port,strictPort:true,hmr:false}});
if(!built)await server.listen();
const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});
const results=[],failures=[];
try {
  for(const lang of (flows?['ko']:['ko','en','ja','fr','de','es','ru','pt-BR','zh-CN'])){
    const context=await browser.newContext({viewport:{width:844,height:390},deviceScaleFactor:2,hasTouch:true});
    await context.addInitScript(lang=>localStorage.setItem('app_language',lang),lang);
    await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
    const page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${port}`);
    await page.locator('.tutorial-skip-button').waitFor({timeout:45000});
    await page.locator('.tutorial-skip-button').click();
    await page.locator('.main-menu-panel.lobby-fit').waitFor();
    const sizes=portal?[[821,462],[800,450],[844,390],[390,844]]:[[844,390],[390,844],[360,800],[907,510],[1280,720]];
    for(const [width,height] of (flows?[[844,390]]:sizes)){
      await page.setViewportSize({width,height});await page.waitForTimeout(220);
      await page.evaluate(()=>document.querySelector('.main-menu-panel').scrollTop=0);
      const geometry=await page.evaluate(()=>{
        const panel=document.querySelector('.main-menu-panel');
        const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
        const actions=[...panel.querySelectorAll('button,a')].filter(e=>e.checkVisibility({visibilityProperty:true})&&!e.closest('dialog:not([open]),[hidden],[inert]'));
        const bounds=rect(panel);
        return {panel:{...bounds,scrollHeight:panel.scrollHeight,clientHeight:panel.clientHeight},
          actions:actions.map(e=>({text:e.textContent.trim(),...rect(e),hit:e.contains(document.elementFromPoint(e.getBoundingClientRect().x+e.getBoundingClientRect().width/2,e.getBoundingClientRect().y+e.getBoundingClientRect().height/2))})),
          overflow:[...panel.querySelectorAll('.lobby-fit-body,.lobby-fit-mode-area,.lobby-modes,.lobby-mode,.lobby-hero-content')].filter(e=>e.scrollHeight>e.clientHeight+2||e.scrollWidth>e.clientWidth+2).map(e=>({selector:e.className,text:e.textContent.trim(),scrollHeight:e.scrollHeight,height:e.clientHeight})),
          document:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight}};
      });
      const id=`${lang}-${width}x${height}`;results.push({id,...geometry,errors:[...errors]});
      if(geometry.panel.scrollHeight>geometry.panel.clientHeight+2)failures.push(`${id}: menu scrolls by ${geometry.panel.scrollHeight-geometry.panel.clientHeight}px`);
      for(const a of geometry.actions)if(a.x<0||a.y<0||a.right>width+1||a.bottom>height+1||!a.hit)failures.push(`${id}: obscured action ${a.text}`);
      if(geometry.overflow.length)failures.push(`${id}: content overflow ${geometry.overflow.map(e=>e.selector).join(',')}`);
      if(errors.length)failures.push(`${id}: ${errors.join('; ')}`);
      if(lang==='ko'||lang==='fr'||(lang==='de'&&width===844))await page.screenshot({path:resolve(out,`${id}.png`)});
      console.log(`${id}: scroll=${geometry.panel.scrollHeight-geometry.panel.clientHeight}, overflow=${geometry.overflow.length}, actions=${geometry.actions.length}`);
    }
    if(flows){
      async function sheet(opener){
        await page.locator(opener).click();await page.locator('.lobby-fit-dialog[open]').waitFor();
        assert.equal(await page.evaluate(()=>document.activeElement?.closest('dialog')!==null),true,'sheet focuses inside');
        for(let i=0;i<12;i++)await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(()=>document.activeElement?.closest('dialog')!==null),true,'tab stays in sheet');
        await page.keyboard.press('Escape');await page.locator('.lobby-fit-dialog[open]').waitFor({state:'hidden'});
        assert.equal(await page.locator(opener).evaluate(e=>e===document.activeElement),true,'Escape restores opener');
      }
      await sheet('#menu-tutorial-btn');
      if(!portal){
        await sheet('#menu-account-btn');await sheet('#menu-more-btn');
        await page.locator('#menu-account-btn').click();
        assert.equal(await page.locator('.lobby-fit-dialog[open] .lobby-profile-points').isVisible(),true,'profile points exposed');
        await page.locator('#btn-logout').click();await page.locator('.lobby-logout-confirm').waitFor();
        assert.equal(await page.locator('.lobby-fit-dialog[open]').count(),0,'account sheet closes before logout confirmation');
        await page.locator('[data-logout-cancel]').click();
        assert.equal(await page.locator('#menu-account-btn').evaluate(e=>e===document.activeElement),true,'logout cancellation restores visible account button');
        await page.locator('#menu-account-btn').click();
        await page.evaluate(async()=>{const {I18nManager}=await import('/src/i18n.ts');I18nManager.setLanguage('en');});
        await page.locator('.lobby-fit-dialog[open]').waitFor();
        await page.keyboard.press('Escape');await page.locator('.lobby-fit-dialog[open]').waitFor({state:'hidden'});
        assert.equal(await page.locator('#menu-account-btn').evaluate(e=>e===document.activeElement),true,'locale rerender preserves sheet and close focus');
        await page.evaluate(async()=>{const {I18nManager}=await import('/src/i18n.ts');I18nManager.setLanguage('ko');});
        await page.locator('#menu-more-btn').click();
        assert.equal(await page.evaluate(async()=>{const {backFromDialog}=await import('/src/android-back.ts');return backFromDialog(document.querySelector('.main-menu-overlay'));}),true,'Android Back path closes native sheet');
        await page.locator('.lobby-fit-dialog[open]').waitFor({state:'hidden'});
        for(const [opener,modal] of [['[data-open-quests]','.quest-modal'],['[data-open-weekly-challenge]','.weekly-modal']]){
          await page.locator(`.lobby-fit-nav ${opener}`).click();await page.locator(modal).waitFor();await page.keyboard.press('Escape');await page.locator(modal).waitFor({state:'hidden'});
        }
        await page.locator('.lobby-modes [data-game-mode="hotseat"]').click();await page.locator('.hotseat-map-overlay').waitFor();await page.keyboard.press('Escape');await page.locator('.hotseat-map-overlay').waitFor({state:'hidden'});
        await page.locator('#menu-puzzle-btn').click();await page.locator('.puzzle-ui-library-card').waitFor();await page.locator('.puzzle-ui-library-card [data-action="exit"]').click();await page.locator('.puzzle-ui-library-card').waitFor({state:'hidden'});
      }
      await page.locator('#menu-sound-btn').click();await page.locator('.settings-modal-overlay').waitFor();await page.keyboard.press('Escape');await page.locator('.settings-modal-overlay').waitFor({state:'hidden'});
      await page.locator('.lobby-modes [data-game-mode="stage"]').click();await page.locator('.pve-lobby-modal').waitFor({timeout:5000});await page.keyboard.press('Escape');await page.locator('.pve-lobby-modal').waitFor({state:'hidden'});
      await page.locator('#menu-tutorial-btn').click();await page.locator('.lobby-fit-dialog[open] [data-tutorial-type="basic"]').click();await page.locator('.tutorial-skip-button').waitFor();assert.equal(await page.locator('.lobby-fit-dialog[open]').count(),0,'sheet closed before starting tutorial');await page.locator('.tutorial-skip-button').click();await page.locator('.lobby-fit').waitFor();
      results.push({flows:'PASS: sheet focus/Tab/Escape, profile/logout cancellation/locale rerender/Android Back/quests/weekly/hotseat/puzzle (web), settings, stage open/close, tutorial start/return'});
    }
    await context.close();
  }
}catch(error){failures.push(error.stack||String(error));}
finally{await writeFile(resolve(out,flows?'flow-results.json':'layout-results.json'),JSON.stringify({results,failures},null,2));await browser.close();if(built)await new Promise(r=>server.httpServer.close(r));else await server.close();}
assert.deepEqual(failures,[],`Responsive menu checks failed:\n${failures.join('\n')}`);
console.log('PASS responsive menu browser checks');
