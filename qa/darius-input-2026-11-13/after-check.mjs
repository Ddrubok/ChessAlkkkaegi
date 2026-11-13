// Run from the repository root: node qa/darius-input-2026-11-13/after-check.mjs <unique-output-directory>
// Deliberately test-only instrumentation; no application source is edited.
import { createServer } from '../../web/node_modules/vite/dist/node/index.js';
import { chromium } from '../../.orca/ui-check/node_modules/playwright/index.mjs';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative } from 'node:path';

if (!process.argv[2]) throw new Error('Pass a unique output directory; the baseline directory must remain untouched.');
const root = resolve('web/src');
const out = resolve(process.argv[2]);
if (out === resolve('qa/darius-input-2026-11-13/baseline')) throw new Error('Refusing to overwrite baseline.');
await mkdir(out, { recursive: false });
async function hashes(dir = root) {
  const result = {};
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) Object.assign(result, await hashes(path));
    else if (entry.isFile()) result[relative(root, path).replaceAll('\\', '/')] = createHash('sha256').update(await readFile(path)).digest('hex');
  }
  return result;
}
const result = {
  scope: 'Fresh local headless Edge; itch Vite mode; full-board hotseat; real mouse pointer; projected geometry is a proxy, not a selectable board-corner claim or human-feel measurement',
  sourceBefore: await hashes(), deniedOrigins: [], pageErrors: [], checks: [], measurements: [], pointer: [], screenshots: [],
  relatedCoverage: 'Existing local browser-check.mjs covers billiards red-dot and touch-related flows; this focused run does not re-render every such angle.',
};
const check = (name, pass, detail) => result.checks.push({ name, pass: Boolean(pass), detail });
const server = await createServer({
  root: resolve('web'), mode: 'itch', logLevel: 'error', cacheDir: resolve('.orca/darius-after-vite'),
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { host: '127.0.0.1', port: 0, open: false, hmr: false },
  plugins: [{ name: 'darius-after-inspection', transform(code, id) {
    if (id.replaceAll('\\', '/').endsWith('/src/input.ts')) return code + '\nexport { raycastNearestPiece as qaPick };';
    if (!id.replaceAll('\\', '/').endsWith('/src/main.ts')) return;
    const anchor = 'let gameLoopStarted = false;';
    const queue = 'queueLaunch: (request) => {';
    if (!code.includes(anchor) || !code.includes(queue)) throw new Error('QA instrumentation anchor changed');
    return code.replace(anchor, 'globalThis.__playtestQA={sceneRuntime,inputRuntime,physicsRuntime,turnRuntime,aimRuntime,aimParametersRuntime,tutorialManager,selectPiece,switchInputMode,resetBoard,get gameMode(){return gameModeRuntime;}};' + anchor)
      .replace(queue, queue + ' (globalThis.__playtestEvents??=[]).push({pieceId:request.pieceId,power:request.normalizedPower});');
  } }],
});
let browser, context, page;
try {
  await server.listen();
  const origin = 'http://127.0.0.1:' + server.httpServer.address().port;
  result.origin = origin;
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: 'en-US', serviceWorkers: 'block' });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    if (!result.deniedOrigins.includes(url.origin)) result.deniedOrigins.push(url.origin);
    return route.abort();
  });
  await context.routeWebSocket('**/*', socket => socket.close());
  page = await context.newPage();
  page.on('pageerror', error => result.pageErrors.push(error.message));
  await page.goto(origin);
  await page.locator('.tutorial-gesture circle').waitFor({timeout:30000});
  await page.waitForFunction(() => globalThis.__playtestQA?.turnRuntime.phase === 'ready', null, { timeout: 30000 });
  // Finish the introductory shot and start stage 1 before constructing the
  // full-board fixture, so no intro result/progression overlay owns input.
  const cue = page.locator('.tutorial-gesture circle');
  const cueX=Number(await cue.getAttribute('cx')), cueY=Number(await cue.getAttribute('cy'));
  await page.mouse.move(cueX,cueY);await page.mouse.down();await page.mouse.move(cueX,cueY+100,{steps:8});await page.mouse.up();
  await page.locator('#feedback-start-stage').waitFor({timeout:30000});
  await page.locator('#feedback-start-stage').click();
  await page.locator('.mastery-hud-objective').filter({hasText:'Stage 1/10'}).waitFor({timeout:30000});

  async function fixture() {
    await page.evaluate(async () => {
      const q = globalThis.__playtestQA;
      q.tutorialManager.stop();
      q.gameMode.mode = 'hotseat';
      await q.resetBoard({ gameMode: 'hotseat', stageNumber: 1 });
      q.switchInputMode(q.inputRuntime, 'classic', false);
    });
    await page.waitForFunction(() => {
      const q = globalThis.__playtestQA;
      return q.turnRuntime.phase === 'ready' && q.inputRuntime.cameraTransition === null && q.physicsRuntime.pieces.size >= 16;
    }, null, { timeout: 30000 });
  }
  async function geometry() {
    return page.evaluate(async () => {
      const q = globalThis.__playtestQA, s = q.sceneRuntime, c = s.camera, r = s.renderer.domElement.getBoundingClientRect();
      c.updateMatrixWorld(true); c.updateProjectionMatrix();
      const project = v => { const p = v.clone().project(c); return { x: r.left + (p.x + 1) * r.width / 2, y: r.top + (1 - p.y) * r.height / 2 }; };
      const box = points => ({ left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)), top: Math.min(...points.map(p => p.y)), bottom: Math.max(...points.map(p => p.y)) });
      const half = s.boardHalfExtent, y = s.boardTop;
      const board = [[-half,y,-half],[half,y,-half],[half,y,half],[-half,y,half]].map(p => project(c.position.clone().set(...p)));
      const bb = box(board), controls = await import('/src/power-controls.ts'), { qaPick } = await import('/src/input.ts');
      const pieces = [...q.physicsRuntime.pieces.values()].map(binding => {
        const id = binding.instance.id, mesh = s.pieceMeshes.get(id);
        if (!mesh || !mesh.visible) return null;
        mesh.updateMatrixWorld(true); if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        const b = mesh.geometry.boundingBox, corners = [];
        for (const x of [b.min.x,b.max.x]) for (const yy of [b.min.y,b.max.y]) for (const z of [b.min.z,b.max.z]) corners.push(project(c.position.clone().set(x,yy,z).applyMatrix4(mesh.matrixWorld)));
        const hull = box(corners);
        let center = project(b.getCenter(c.position.clone()).applyMatrix4(mesh.matrixWorld));
        const candidates = [center];
        for (const yf of [.05,.1,.15,.3,.5,.7,.85,.95]) for (const xf of [.5,.3,.7]) candidates.push({ x:hull.left+(hull.right-hull.left)*xf, y:hull.top+(hull.bottom-hull.top)*yf });
        const grabPoints = candidates.filter(p => qaPick(q.inputRuntime, {clientX:p.x,clientY:p.y}) === id);
        const visible = grabPoints[0];
        if (visible) center = visible;
        return { id, side: binding.instance.side, type: binding.instance.type, center, hull,
          visibleGrabPoint: Boolean(visible),
          grabPoints,
          minCanvasMargin: Math.min(hull.left-r.left,r.right-hull.right,hull.top-r.top,r.bottom-hull.bottom) };
      }).filter(Boolean);
      const area = Math.abs(board.reduce((a,p,i) => a + p.x*board[(i+1)%4].y-p.y*board[(i+1)%4].x,0))/2;
      return { viewport: { width: innerWidth, height: innerHeight }, canvas: { left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height },
        board: { polygon:board,bbox:bb,width:bb.right-bb.left,height:bb.bottom-bb.top,area,areaRatio:area/(r.width*r.height),heightRatio:(bb.bottom-bb.top)/r.height },
        pieces, minPieceHullMargin:Math.min(...pieces.map(p=>p.minCanvasMargin)),
        camera: { position:c.position.toArray(), target:s.controls.target.toArray(),distance:c.position.distanceTo(s.controls.target),maxDistance:s.controls.maxDistance },
        preferredPowerDistance:controls.getMousePowerDistance(),effectivePowerDistance:controls.computeViewportPowerDistance(controls.getMousePowerDistance(),r.width,r.height),
        phase:q.turnRuntime.phase,mode:q.gameMode?.mode };
    });
  }
  async function state() {
    return page.evaluate(() => { const q = globalThis.__playtestQA, g=q.inputRuntime.gesture;
      return { selected:q.aimRuntime.selectedPieceId,power:q.aimRuntime.activeAim?.normalizedPower??null,
        gesture:g ? {source:g.source,maximumDistance:g.maximumDistance,maxDragPixels:g.maxDragPixels} : null,
        requests:(globalThis.__playtestEvents??[]).slice(),camera:q.sceneRuntime.camera.position.toArray(),phase:q.turnRuntime.phase };
    });
  }
  async function safeCancel() { await page.keyboard.press('Escape'); await page.mouse.up(); }
  async function cameraView() {
    return page.evaluate(() => { const q=globalThis.__playtestQA, c=q.sceneRuntime.camera;
      return {mode:q.inputRuntime.mode,selected:q.aimRuntime.selectedPieceId,strike:q.inputRuntime.strikeMode,
        offset:c.view?.enabled ? c.view.offsetY/c.view.fullHeight : 0,enabled:Boolean(c.view?.enabled)}; });
  }
  const delta = (a,b) => Math.max(...a.map((v,i)=>Math.abs(v-b[i])));
  const pointInside = (p,r) => p.x>=r.left && p.x<=r.right && p.y>=r.top && p.y<=r.bottom;
  async function overCancel(p) { return page.evaluate(({x,y}) => { const el=globalThis.__playtestQA.inputRuntime.cancelControl;if(!el||el.hidden)return false;const r=el.getBoundingClientRect();return x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom; },p); }
  async function aim(piece, direction, wantedPower, label, g, capture=false) {
    const start=piece.center, angle=direction*Math.PI/4;
    await page.mouse.move(start.x,start.y); await page.mouse.down();
    const armed=await state();
    // Use the application's shared inverse when present. The gesture stores
    // the exponent frozen at pointer-down, including any mouse/touch split.
    const scale=await page.evaluate(async power => {
      const q=globalThis.__playtestQA, gesture=q.inputRuntime.gesture;
      const mod=await import('/src/power-controls.ts');
      const exponent=Number.isFinite(gesture?.powerExponent) ? gesture.powerExponent : 1;
      const pixels=gesture?.maxDragPixels;
      const distance=typeof mod.pullDistanceForPower==='function'
        ? mod.pullDistanceForPower(power,pixels,exponent)
        : pixels*Math.pow(power,1/exponent);
      return {pixels,exponent,distance,ratio:distance/pixels};
    },wantedPower);
    if(!Number.isFinite(scale.distance)) {
      const record={label,piece:{id:piece.id,type:piece.type,side:piece.side},start,scale,selected:armed.selected,error:'pointer-down did not create a measurable gesture'};
      result.pointer.push(record);check(label+' gesture starts',false,record);return {...record,end:start};
    }
    const end={x:start.x+Math.cos(angle)*scale.distance,y:start.y+Math.sin(angle)*scale.distance};
    await page.mouse.move(end.x,end.y,{steps:6});
    const observed=await state();
    const record={label,piece:{id:piece.id,type:piece.type,side:piece.side},direction,wantedPower,start,end,scale,
      selected:observed.selected,power:observed.power,gesture:observed.gesture,releaseInside:pointInside(end,g.canvas),overCancel:await overCancel(end),cameraDelta:delta(armed.camera,observed.camera)};
    result.pointer.push(record);
    check(label+' selected',observed.selected===piece.id,record);
    check(label+' power',Math.abs((observed.power??NaN)-wantedPower)<0.015,record);
    check(label+' valid release location',record.releaseInside&&!record.overCancel,record);
    check(label+' camera fixed',record.cameraDelta<1e-5,record);
    if(capture){const name=label.replaceAll(/[^a-z0-9-]/gi,'-')+'.png';await page.screenshot({path:resolve(out,name)});result.screenshots.push(name);}
    return record;
  }

  for (const [width,height] of [[1920,1080],[1366,768],[800,450],[390,844]]) {
    await page.setViewportSize({width,height}); await fixture(); await page.waitForTimeout(180);
    const g=await geometry(); result.measurements.push(g);
    const screen=`${width}x${height}`;
    await page.screenshot({path:resolve(out,`board-${screen}.png`)});result.screenshots.push(`board-${screen}.png`);
    if(width>=1000) check(screen+' board height >=55%',g.board.heightRatio>=0.55,g.board.heightRatio);
    check(screen+' all piece hulls inside canvas',g.minPieceHullMargin>=0,g.minPieceHullMargin);
    const white=g.pieces.filter(p=>p.side==='white' && p.visibleGrabPoint);
    const center={x:(g.board.bbox.left+g.board.bbox.right)/2,y:(g.board.bbox.top+g.board.bbox.bottom)/2};
    const central=white.toSorted((a,b)=>Math.hypot(a.center.x-center.x,a.center.y-center.y)-Math.hypot(b.center.x-center.x,b.center.y-center.y))[0];
    const nearCorner=white.toSorted((a,b)=>Math.hypot(a.center.x-g.board.bbox.left,a.center.y-g.board.bbox.bottom)-Math.hypot(b.center.x-g.board.bbox.left,b.center.y-g.board.bbox.bottom))[0];
    const rook=white.find(p=>p.type==='Rook'),queen=white.find(p=>p.type==='Queen');
    check(screen+' full board fixture',g.mode==='hotseat'&&g.phase==='ready'&&g.pieces.length>=16,{mode:g.mode,phase:g.phase,pieces:g.pieces.length});
    let centralRadius=g.effectivePowerDistance*0.3;
    for(const [role,piece] of [['central',central],['near-corner',nearCorner]]) {
      if(!piece){check(screen+' '+role+' present',false);continue;}
      const record=await aim(piece,2,0.3,`${screen}-${role}-30`,g,true);
      if(role==='central') centralRadius=Math.hypot(record.end.x-record.start.x,record.end.y-record.start.y);
      if(width>=1000) (result.precisionTargets??=[]).push({viewport:{width,height},role,radius:Math.hypot(record.end.x-record.start.x,record.end.y-record.start.y),initialTarget:50,met:Math.hypot(record.end.x-record.start.x,record.end.y-record.start.y)>=50});
      await safeCancel();
    }
    for(const [role,piece] of [['rook',rook],['queen',queen]]) {
      if(!piece){check(screen+' '+role+' present',false);continue;}
      for(let direction=0;direction<8;direction++) {
        await aim(piece,direction,1.5,`${screen}-${role}-150-${direction}`,g,direction===2);
        await safeCancel();
      }
    }
    // Same pointer origin, same distance, small direction changes: report their
    // actual selected/power/validity values without claiming human accuracy.
    for(const degrees of [-15,-5,0,5,15]) {
      const base=central.center, radius=centralRadius, angle=(90+degrees)*Math.PI/180;
      await page.mouse.move(base.x,base.y);await page.mouse.down();
      const end={x:base.x+Math.cos(angle)*radius,y:base.y+Math.sin(angle)*radius};
      await page.mouse.move(end.x,end.y,{steps:5});
      result.pointer.push({label:`${screen}-perturb-${degrees}`,degrees,start:base,end,actual:await state(),releaseInside:pointInside(end,g.canvas),overCancel:await overCancel(end)});
      await safeCancel();
    }
    // Pure click and one-pixel jitter must never reach queueLaunch.
    const before=(await state()).requests.length;
    await page.mouse.click(central.center.x,central.center.y);
    await page.mouse.move(central.center.x,central.center.y);await page.mouse.down();await page.mouse.move(central.center.x,central.center.y+1);await page.mouse.up();
    check(screen+' click and jitter queue zero', (await state()).requests.length===before,{before,after:(await state()).requests.length});
    // A resize during an active drag must invalidate it before release.
    await aim(central,2,0.3,`${screen}-resize-setup`,g);
    const pending=(await state()).requests.length;
    await page.setViewportSize({width:width-1,height});
    await page.waitForFunction(() => globalThis.__playtestQA.inputRuntime.gesture === null, null, {timeout:2000});
    check(screen+' resize cancels gesture',(await state()).gesture===null);
    await page.mouse.up();
    check(screen+' release after resize queues zero',(await state()).requests.length===pending);
    await page.setViewportSize({width,height});await fixture();
    // The final mouse-up is the sole launch trigger, and another up cannot replay it.
    const shotGeometry=await geometry(),shotPiece=shotGeometry.pieces.filter(p=>p.side==='white').toSorted((a,b)=>Math.hypot(a.center.x-center.x,a.center.y-center.y)-Math.hypot(b.center.x-center.x,b.center.y-center.y))[0];
    const shotBefore=(await state()).requests.length;
    const shot=await aim(shotPiece,2,0.3,`${screen}-valid-shot`,shotGeometry,true);
    await page.mouse.up();const first=(await state()).requests.length;
    await page.mouse.up();const second=(await state()).requests.length;
    result.pointer.push({label:`${screen}-launch`,shot,before:shotBefore,afterFirstUp:first,afterRepeatedUp:second});
    check(screen+' one valid pointer launch',first===shotBefore+1,{shotBefore,first});
    check(screen+' repeated up does not replay',second===first,{first,second});
    await fixture();
    const cameraStart=await geometry();
    await page.mouse.move(width/2,height/2);await page.mouse.wheel(0,-10000);await page.waitForTimeout(450);
    const zoom=await geometry();
    result.measurements.push({viewport:{width,height},kind:'maximum-wheel-zoom',original:cameraStart.camera,zoomed:zoom.camera,board:zoom.board,minPieceHullMargin:zoom.minPieceHullMargin});
    check(screen+' wheel zoom remains finite',Number.isFinite(zoom.camera.distance),zoom.camera);
  }
  // A/D is a supported camera rotation. Own pieces can therefore lie at the
  // far edge; do not certify reachability from the initial near-side pose alone.
  await page.setViewportSize({width:1366,height:768});await fixture();
  await page.keyboard.down('a');await page.waitForTimeout(2000);await page.keyboard.up('a');await page.waitForTimeout(100);
  await page.mouse.wheel(0,-10000);await page.waitForTimeout(450);
  const reversed=await geometry();result.measurements.push({...reversed,kind:'reversed-own-side'});
  for(const type of ['King','Queen','Rook']) {
    const piece=reversed.pieces.find(p=>p.side==='white'&&p.type===type&&p.visibleGrabPoint);
    if(!piece){result.pointer.push({label:`reversed-${type}`,untested:'no visible grab point in sampled pixels'});continue;}
    for(let direction=0;direction<8;direction++) {
      await aim(piece,direction,type==='King'?1:1.5,`reversed-${type}-${direction}`,reversed,direction===6);
      await safeCancel();
    }
    const topGrab=piece.grabPoints.toSorted((a,b)=>a.y-b.y)[0];
    await aim({...piece,center:topGrab},6,type==='King'?1:1.5,`reversed-${type}-top-grab`,reversed,true);
    await safeCancel();
  }
  await fixture();
  result.cameraPolicies=[];
  for(const mode of ['billiards','classic']) {
    await page.evaluate(mode=>{const q=globalThis.__playtestQA;q.switchInputMode(q.inputRuntime,mode,false);},mode);
    await page.waitForFunction(()=>globalThis.__playtestQA.inputRuntime.cameraTransition===null);
    const view=await cameraView();result.cameraPolicies.push(view);
    check(`${mode} settled projection`,mode==='classic'?view.enabled:!view.enabled,view);
    if(mode==='billiards') {
      const g=await geometry(),piece=g.pieces.find(p=>p.side==='white'&&p.type==='Rook'&&p.visibleGrabPoint);
      await page.mouse.click(piece.center.x,piece.center.y);
      await page.waitForFunction(()=>globalThis.__playtestQA.inputRuntime.cameraTransition===null);
      const selected=await cameraView();result.cameraPolicies.push(selected);
      check('billiards selected projection cleared',!selected.enabled,selected);
      await page.locator('[data-action="strike"]').click();
      await page.waitForFunction(()=>globalThis.__playtestQA.inputRuntime.cameraTransition===null);
      const strike=await cameraView();result.cameraPolicies.push(strike);
      check('billiards strike projection cleared',!strike.enabled&&strike.strike,strike);
      await page.locator('[data-action="strike"]').click();
      await page.waitForFunction(()=>globalThis.__playtestQA.inputRuntime.cameraTransition===null);
    }
  }
  check('no page errors',result.pageErrors.length===0,result.pageErrors);
} catch(error) {
  result.failure=error.stack;
  if(page) await page.screenshot({path:resolve(out,'failure.png')}).catch(()=>{});
} finally {
  result.sourceAfter=await hashes();
  result.sourcesChangedDuringRun=Object.keys({...result.sourceBefore,...result.sourceAfter}).filter(k=>result.sourceBefore[k]!==result.sourceAfter[k]);
  check('sources unchanged during run',result.sourcesChangedDuringRun.length===0,result.sourcesChangedDuringRun);
  await writeFile(resolve(out,'result.json'),JSON.stringify(result,null,2));
  if(browser) await browser.close();
  await server.close();
  const failures=result.checks.filter(c=>!c.pass);
  console.log(JSON.stringify({out,checks:result.checks.length,failedChecks:failures.map(c=>c.name),failure:result.failure,sourcesChangedDuringRun:result.sourcesChangedDuringRun}));
  if(result.failure||failures.length) process.exitCode=1;
}
