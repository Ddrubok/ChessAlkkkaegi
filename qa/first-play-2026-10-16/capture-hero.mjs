import {chromium} from '../../.orca/ui-check/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const context=await browser.newContext({viewport:{width:960,height:540}});
 await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 const page=await context.newPage();await page.goto('http://127.0.0.1:5227');await page.locator('#btn-guest-submit').click({timeout:40000});
 await page.evaluate(async()=>{const m=await import('/src/menu.ts');await m.startLobbyMode(__firstQA.menuRuntime,'hotseat');});
 await page.waitForTimeout(600);
 await page.evaluate(()=>{const r=__firstQA.sceneRuntime;r.controls.enableDamping=false;r.controls.minDistance=0;const h=r.boardHalfExtent;r.controls.target.set(0,r.boardTop,0);r.camera.position.set(h*1.25,h*1.8,-h*2.15);r.camera.lookAt(r.controls.target);r.controls.update();});
 await page.waitForTimeout(300);
 const file='web/public/assets/lobby/hero-tutorial.jpg';
 await fs.copyFile(file,'qa/first-play-2026-10-16/hero-tutorial-before.jpg');
 await page.locator('canvas').first().screenshot({path:file,type:'jpeg',quality:88});
 console.log('Captured actual hotseat board and original models: '+file);
}finally{await browser.close();}
