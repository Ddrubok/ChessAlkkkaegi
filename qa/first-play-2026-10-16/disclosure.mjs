import {chromium} from '../../.orca/ui-check/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const context=await browser.newContext({viewport:{width:320,height:568},hasTouch:true,isMobile:true});
 await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 const page=await context.newPage();await page.goto('http://127.0.0.1:5227');await page.locator('#btn-guest-submit').click({timeout:40000});
 await page.locator('.lobby-other-modes>summary').click();
 await page.evaluate(async()=>{const {renderMainMenu}=await import('/src/menu.ts');renderMainMenu(__firstQA.menuRuntime);});
 assert.equal(await page.locator('.lobby-other-modes').evaluate(e=>e.open),true);
 await page.locator('#menu-tutorial-btn').click();
 await page.locator('[data-tutorial-type="advanced"]').click();
 await page.waitForFunction(()=>__firstQA.tutorialManager.isActive&&!__firstQA.gameModeRuntime.switching);
 assert.equal(await page.evaluate(()=>__firstQA.tutorialManager.tutorialType),'advanced');
 await fs.writeFile('qa/first-play-2026-10-16/disclosure-results.json',JSON.stringify({pass:true,checks:['Open activities remain open after lobby refresh','Advanced tutorial reachable through nested activity controls']},null,2));
 console.log('PASS disclosure state and nested advanced tutorial entry');
}finally{await browser.close();}
