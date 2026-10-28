import {chromium} from '../../.orca/ui-check/node_modules/playwright/index.mjs';
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await page.addInitScript(()=>localStorage.setItem('app_language','ko'));
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 await page.goto('http://127.0.0.1:5227');await page.locator('#btn-guest-submit').click({timeout:40000});
 await page.locator('#menu-recommendation-btn').waitFor();await page.screenshot({path:'qa/first-play-2026-10-16/before-lobby.png'});
 await page.locator('#menu-recommendation-btn').click();await page.locator('.tutorial-coach-card').waitFor();await page.waitForTimeout(1000);
 await page.screenshot({path:'qa/first-play-2026-10-16/before-tutorial.png'});
 console.log(await page.evaluate(()=>({step:window.__firstQA.tutorialManager.currentStep,text:document.querySelector('.tutorial-coach-card').textContent,pieces:[...window.__firstQA.physicsRuntime.pieces.keys()]})));
}finally{await browser.close();}
