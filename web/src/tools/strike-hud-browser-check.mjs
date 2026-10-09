// Requires Playwright (or PLAYWRIGHT_MODULE pointing to an existing installation).
// Run from web: node src/tools/strike-hud-browser-check.mjs
// QA_EDGE=1 checks all locales, synthetic safe-area insets and classic cancellation.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const webRoot = fileURLToPath(new URL('../..', import.meta.url));
const output = process.env.QA_OUTPUT ?? fileURLToPath(new URL(process.env.QA_EDGE ? '../../../.orca/fixed-hud-edge-20261009/' : '../../../.orca/fixed-hud-journey-20261009/', import.meta.url));
await mkdir(output, { recursive: true });
const server = await createServer({ root: webRoot, logLevel: 'error',
  server: { host: '127.0.0.1', port: 5208, strictPort: true, hmr: false },
  plugins: [{ name: 'strike-hud-observation', enforce: 'pre', transform(code, id) {
    if (!id.replaceAll('\\', '/').endsWith('/src/input.ts')) return;
    // Expose references only in this test server; input, physics and policy stay unchanged.
    const marker = '  policy.onModeChanged(initialMode);';
    assert.ok(code.includes(marker), 'Input runtime observation marker changed');
    return code.replace(marker, `${marker}
window.__strikeHudQA = { runtime, project: mesh => {
  const viewport = sceneRuntime.renderer.domElement.getBoundingClientRect();
  mesh.geometry.computeBoundingBox();
  mesh.updateMatrixWorld(true);
  const box = mesh.geometry.boundingBox;
  const points = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const p = mesh.position.clone().set(x,y,z).applyMatrix4(mesh.matrixWorld).project(sceneRuntime.camera);
    points.push({x: viewport.left + (p.x+1)*viewport.width/2, y: viewport.top + (1-p.y)*viewport.height/2});
  }
  const center = mesh.getWorldPosition(mesh.position.clone()).project(sceneRuntime.camera);
  return {x:viewport.left+(center.x+1)*viewport.width/2, y:viewport.top+(1-center.y)*viewport.height/2,
    pieceRect:{left:Math.min(...points.map(p=>p.x)),right:Math.max(...points.map(p=>p.x)),top:Math.min(...points.map(p=>p.y)),bottom:Math.max(...points.map(p=>p.y))}};
}, redDotHitRadius: getRedDotHitRadiusPixels({pointerType: isCoarsePointerEnvironment() ? 'touch' : 'mouse'}), pick: (x, y) => raycastNearestPiece(runtime, { clientX: x, clientY: y }), fallback: (x, y) => findTouchFallbackPiece(runtime, { pointerType: 'touch', clientX: x, clientY: y }) };`);
  } }],
});
await server.listen();
let browser;
let currentPage;
const results = [];
const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
try {
  browser = await chromium.launch({ channel: process.env.QA_BROWSER_CHANNEL ?? 'msedge', headless: true });
  for (const [width, height, touch, language = 'ko'] of [[360, 800, true], [390, 844, true], [667, 375, true], [844, 390, true], [1280, 800, false], [360, 800, true, 'de'], [667, 375, true, 'de'], [320, 568, true]]) {
    if(process.env.QA_EDGE && (width!==667 || language!=='ko')) continue;
    if (process.env.QA_VIEWPORT && process.env.QA_VIEWPORT !== String(width)) continue;
    const caseName = `${width}-${touch ? 'touch' : 'mouse'}-${language}`;
    const context = await browser.newContext({ viewport: { width, height }, isMobile: touch, hasTouch: touch, deviceScaleFactor: 1, locale: 'ko-KR' });
    await context.addInitScript(language => {
      localStorage.setItem('app_language', language);
      window.__strikeHudEvents = [];
      for (const type of ['pointerdown', 'pointerup', 'click']) document.addEventListener(type, e => {
        window.__strikeHudEvents.push({ type, target: e.target.className, id: e.pointerId });
        if (window.__strikeHudEvents.length > 30) window.__strikeHudEvents.shift();
      }, true);
    }, language);
    const page = await context.newPage();
    currentPage = page;
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await context.route('**/*', r => {
      const u = new URL(r.request().url());
      return ['localhost', '127.0.0.1'].includes(u.hostname) || ['data:', 'blob:'].includes(u.protocol) ? r.continue() : r.abort();
    });
    const cdp = await context.newCDPSession(page);
    const tap = async (x, y) => {
      if (touch) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        await page.waitForTimeout(30);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else await page.mouse.click(x, y);
      await page.waitForTimeout(100);
    };
    const control = async selector => {
      await page.waitForFunction(selector => {
        const button = document.querySelector(selector);
        return button && !button.disabled;
      }, selector);
      await page.locator(selector).scrollIntoViewIfNeeded();
      const r = await page.locator(selector).boundingBox();
      assert.ok(r, `Hidden control: ${selector}`);
      await tap(r.x + r.width / 2, r.y + r.height / 2);
    };
    const snapshot = () => page.evaluate(() => {
      const { runtime: r, project } = window.__strikeHudQA;
      const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
      const dot = r.aimParametersRuntime.redDot.visible ? project(r.aimParametersRuntime.redDot) : null;
      const radius = window.__strikeHudQA.redDotHitRadius;
      return { selected: r.aimRuntime.selectedPieceId, strike: r.strikeMode,
        override: r.aimParametersRuntime.strikePointOverride?.toArray() ?? null,
        panel: !r.strikePointPanel.root.hidden, bar: !r.actionBar.hidden,
        hud: rect('.strike-action-bar'), marker: r.strikePointPanel.marker?.getAttribute('style') ?? document.querySelector('.strike-point-panel-marker').getAttribute('style'),
        pieces: [...r.sceneRuntime.pieceMeshes].filter(([, m]) => m.visible).map(([id, mesh]) => ({ id, ...project(mesh) })).filter(p => p.pieceRect),
        arrows: r.aimRuntime.groundChevrons.filter(m => m.visible).map(m => project(m)?.pieceRect).filter(Boolean),
        dotHit: dot ? { left: dot.x - radius, top: dot.y - radius, right: dot.x + radius, bottom: dot.y + radius } : null,
        turn: document.querySelector('.turn-hud-side').textContent,
        active: r.activePointerId, orbit: r.orbitTouchPointerIds.size,
        camera: r.sceneRuntime.camera.position.toArray(),
      };
    });
    const emptyPoint = async () => {
      const point = await page.evaluate(({ width, height, touch }) => {
        const { pick, fallback } = window.__strikeHudQA;
        // Chromium may retarget coarse taps near a button. Use clearly empty game space.
        const uiRects = [...document.querySelectorAll('button, .strike-point-panel, .player-banner, .aim-parameters, .aim-elevation')].map(e => e.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0);
        for (let y = 40; y < height - 16; y += 24) for (let x = 64; x < width - 16; x += 24) {
          if (uiRects.some(r => x >= r.left - 24 && x <= r.right + 24 && y >= r.top - 24 && y <= r.bottom + 24)) continue;
          if (document.elementFromPoint(x, y)?.classList.contains('game-canvas') && pick(x, y) === null && (!touch || fallback(x, y) === null)) return { x, y };
        }
        return null;
      }, { width, height, touch });
      assert.ok(point, 'No empty canvas tap available');
      return point;
    };
    const piecePoint = id => page.evaluate(id => {
      const { runtime, project, pick } = window.__strikeHudQA;
      const mesh = runtime.sceneRuntime.pieceMeshes.get(id);
      const r = mesh?.visible && project(mesh)?.pieceRect;
      if (!r) return null;
      for (const fy of [.35, .6, .8, .5, .2]) for (const fx of [.5, .35, .65]) {
        const x = r.left + (r.right - r.left) * fx, y = r.top + (r.bottom - r.top) * fy;
        if (document.elementFromPoint(x, y)?.classList.contains('game-canvas') && pick(x, y) === id) return { x, y };
      }
      return null;
    }, id);
    const selectPawn = async () => {
      const state = await snapshot();
      const pawn = state.pieces.find(p => p.id.includes('white-pawn') && p.x > width * .25 && p.x < width * .75);
      assert.ok(pawn, 'Visible white pawn missing');
      const point = await piecePoint(pawn.id);
      assert.ok(point, `No exposed surface for ${pawn.id}`);
      await tap(point.x, point.y);
      await page.waitForTimeout(650);
      assert.equal((await snapshot()).selected, pawn.id, 'Pawn selection failed');
    };
    const openAndSet = async () => {
      await control('[data-action="strike"]');
      await page.waitForTimeout(400);
      const panel = await page.locator('.strike-point-panel-canvas').boundingBox();
      await tap(panel.x + panel.width / 2, panel.y + panel.height * .23);
      await page.waitForTimeout(250);
      const state = await snapshot();
      assert.ok(state.panel && state.override, 'Strike edit did not set a real override');
      return state;
    };
    const checkCameraReturn = async (name, apply) => {
      // Observe every rendered frame: an end-state check misses a brief zoom-in.
      await page.evaluate(() => {
        const r = window.__strikeHudQA.runtime;
        window.__cameraReturnFrames = [];
        window.__cameraReturnRecording = true;
        const sample = () => {
          if (!window.__cameraReturnRecording) return;
          const camera = r.sceneRuntime.camera;
          window.__cameraReturnFrames.push({
            time: performance.now(),
            radius: camera.position.distanceTo(r.sceneRuntime.controls.target),
            destination: r.cameraTransition?.toSpherical.radius ?? null,
          });
          requestAnimationFrame(sample);
        };
        sample();
      });
      await apply();
      await page.waitForTimeout(450);
      const frames = await page.evaluate(() => {
        window.__cameraReturnRecording = false;
        return window.__cameraReturnFrames;
      });
      await writeFile(`${output}/${caseName}-${name}-camera.json`, JSON.stringify(frames, null, 2));
      assert.ok(frames.length >= 8, `${name}: insufficient camera samples`);
      const tolerance = .02;
      assert.ok(Math.min(...frames.map(f => f.radius)) >= frames[0].radius - tolerance,
        `${name}: camera moves closer than its starting distance`);
      for (let i = 1; i < frames.length; i++) {
        assert.ok(frames[i].radius >= frames[i - 1].radius - tolerance,
          `${name}: camera zooms in before returning (${frames[i - 1].radius} -> ${frames[i].radius})`);
      }
    };
    const assertHudSeparation = async () => {
      const hud = await page.evaluate(() => {
        const selectors = '.strike-action-bar,.classic-cancel-control,.player-banner,.aim-parameters,.aim-elevation,.aim-power,.strike-point-panel';
        return [...document.querySelectorAll(selectors)].filter(e => {
          const r=e.getBoundingClientRect();
          return r.width>0 && r.height>0 && getComputedStyle(e).visibility!=='hidden';
        }).map(e=>({name:e.className+(e.dataset.owner??''),...e.getBoundingClientRect().toJSON()}));
      });
      const bounds=page.viewportSize();
      for (const box of hud) assert.ok(box.left>=0 && box.top>=0 && box.right<=bounds.width && box.bottom<=bounds.height, `${box.name} outside viewport`);
      for (let i=0;i<hud.length;i++) for(let j=i+1;j<hud.length;j++) assert.ok(!overlap(hud[i],hud[j]),`HUD overlap: ${hud[i].name} / ${hud[j].name}`);
      const canvas = await page.locator('.game-canvas').boundingBox();
      const dock = hud.find(e=>e.name==='strike-action-bar'||e.name==='classic-cancel-control');
      if(dock) assert.ok(dock.top>=canvas.y+canvas.height,'Dock intrudes into rendered board');
      const aspect=await page.evaluate(()=>window.__strikeHudQA.runtime.sceneRuntime.camera.aspect);
      assert.ok(Math.abs(aspect-canvas.width/canvas.height)<.001,'Projection aspect differs from canvas');
    };
    const assertLayout = async name => {
      await assertHudSeparation();
      const state = await snapshot();
      await page.screenshot({ path: `${output}/${caseName}-${name}.png` });
      await writeFile(`${output}/${caseName}-${name}.json`, JSON.stringify(state, null, 2));
      assert.ok(state.bar && state.hud.width > 0, `${name}: action bar missing`);
      assert.ok(state.hud.left >= 0 && state.hud.top >= 0 && state.hud.right <= width && state.hud.bottom <= height, `${name}: action bar outside viewport`);
      const covered = state.pieces.filter(p => overlap(state.hud, p.pieceRect));
      assert.deepEqual(covered.map(p => p.id), [], `${name}: action bar covers pieces`);
      assert.ok(!state.arrows.some(r => overlap(state.hud, r)), `${name}: action bar covers aim arrows`);
      if (state.dotHit) assert.ok(!overlap(state.hud, state.dotHit), `${name}: action bar blocks red-dot input`);
      if (state.panel) assert.ok(!overlap(state.hud, await page.locator('.strike-point-panel').boundingBox().then(r => ({ left: r.x, top: r.y, right: r.x + r.width, bottom: r.y + r.height }))), `${name}: action bar covers strike panel`);
      const coveredUI = await page.evaluate(hud => [...document.querySelectorAll('.input-mode-toggle, .return-menu-button, .turn-hud-container, .player-banner, .aim-parameters, .aim-elevation, .aim-power, .classic-cancel-control, .king-swap-banner')].filter(e => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' && hud.left < r.right && hud.right > r.left && hud.top < r.bottom && hud.bottom > r.top;
      }).map(e => e.className), state.hud);
      assert.deepEqual(coveredUI, [], `${name}: action bar covers existing HUD`);
      if (touch) {
        const buttons = await page.locator('.strike-action-bar button:not([hidden])').evaluateAll(es => es.map(e => ({ width: e.getBoundingClientRect().width, height: e.getBoundingClientRect().height })));
        assert.ok(buttons.every(r => r.width >= 44 && r.height >= 44), `${name}: touch targets shrink`);
      }
      const stable = state.hud;
      await page.waitForTimeout(220);
      if (name !== 'rotated') assert.deepEqual((await snapshot()).hud, stable, `${name}: settled bar moves`);
      return { name, hud: state.hud, visiblePieces: state.pieces.length, covered: covered.length };
    };
    const restart = async () => {
      await control('.return-menu-button');
      if (await page.locator('[data-menu-confirm]').isVisible()) await control('[data-menu-confirm]');
      await control('[data-game-mode="hotseat"]');
      await control('[data-map-action="start"]');
      await page.waitForTimeout(500);
      const state = await snapshot();
      assert.equal(state.selected, null, 'Re-entry retains selection');
      assert.equal(state.override, null, 'Re-entry retains strike override');
      assert.equal(state.panel, false, 'Re-entry retains strike panel');
    };
    const checkFixedDock = async () => {
      await restart();
      await control('[data-mode="billiards"]');
      const king=(await snapshot()).pieces.find(p=>p.id.includes('white-king'));
      const kingPoint=await piecePoint(king.id);
      await tap(kingPoint.x,kingPoint.y); await page.waitForTimeout(650);
      assert.equal((await snapshot()).selected,king.id,'King selection failed');
      assert.equal(await page.locator('.strike-action-bar button:not([hidden])').count(),4,'King actions missing');
      await assertLayout('king');
      await control('[data-action="swap"]');
      await assertLayout('king-swap');
      await control('[data-action="swap"]');
      // Resize uses real browser layout/camera events; selection clears as before.
      await page.setViewportSize({width:height,height:width}); await page.waitForTimeout(700);
      assert.equal((await snapshot()).active,null,'Resize strands a pointer');
      const rotatedKing=await piecePoint(king.id);
      await tap(rotatedKing.x,rotatedKing.y); await page.waitForTimeout(650);
      await assertHudSeparation();
      await page.screenshot({path:`${output}/${caseName}-orientation.png`});
      await page.setViewportSize({width,height}); await page.waitForTimeout(700);
      await restart(); await control('[data-mode="billiards"]'); await selectPawn();
      const before=await snapshot();
      const dot=await page.evaluate(()=>{const {runtime:r,project}=window.__strikeHudQA;const p=project(r.aimParametersRuntime.redDot);return{x:p.x,y:p.y};});
      if(touch) {
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[dot]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:dot.x,y:dot.y+50}]});
      } else {
        await page.mouse.move(dot.x,dot.y);await page.mouse.down();await page.mouse.move(dot.x,dot.y+50,{steps:4});
      }
      assert.equal(await page.evaluate(()=>window.__strikeHudQA.runtime.state),'charging','Red-dot charge did not begin');
      assert.equal(await page.locator('.strike-action-bar').isVisible(),false,'Actions should yield dock to cancellation');
      await assertHudSeparation();
      await page.screenshot({path:`${output}/${caseName}-cancel-dock.png`});
      const cancel=await page.locator('.classic-cancel-control').boundingBox();
      const end={x:cancel.x+cancel.width/2,y:cancel.y+cancel.height/2};
      if(touch) {
        await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[end]});
        await page.waitForTimeout(40);
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      } else {await page.mouse.move(end.x,end.y,{steps:4});await page.mouse.up();}
      await page.waitForTimeout(250);
      assert.equal((await snapshot()).turn,before.turn,'Cancel dock launches a shot');
      assert.equal((await snapshot()).selected,before.selected,'Cancellation drops selection');
      assert.equal((await snapshot()).active,null,'Cancel retains pointer capture');
      assert.equal(await page.locator('.classic-cancel-control').isVisible(),false,'Cancel UI persists');
      assert.equal(await page.locator('.strike-action-bar').isVisible(),true,'Actions do not recover after cancellation');
      await assertHudSeparation();
      await restart();
    };
    await page.goto('http://127.0.0.1:5208/');
    await page.locator('#btn-guest-submit').waitFor();
    await page.waitForTimeout(1000);
    await control('#btn-guest-submit');
    await page.waitForTimeout(350);
    await page.reload();
    await control('[data-game-mode="hotseat"]');
    await control('[data-map-action="start"]');
    await page.waitForTimeout(500);
    await selectPawn();
    if(process.env.QA_EDGE) {
      const languages=['ko','en','ja','zh-CN','de','fr','es','ru','pt-BR'];
      const king=(await snapshot()).pieces.find(p=>p.id.includes('white-king'));
      const point=await piecePoint(king.id);
      await tap(point.x,point.y);await page.waitForTimeout(650);
      const layouts=[];
      for(const language of languages) {
        await page.evaluate(async language=>(await import('/src/i18n.ts')).I18nManager.setLanguage(language),language);
        await page.waitForTimeout(120);
        layouts.push(await assertLayout('king-'+language));
      }
      const safeCss=(await readFile(new URL('../game-hud.css',import.meta.url),'utf8'))
        .replaceAll('env(safe-area-inset-left, 0px)','44px')
        .replaceAll('env(safe-area-inset-right, 0px)','44px')
        .replaceAll('env(safe-area-inset-bottom, 0px)','21px');
      await page.addStyleTag({content:safeCss});
      await page.evaluate(()=>window.dispatchEvent(new Event('resize')));await page.waitForTimeout(600);
      const safeKing=await piecePoint(king.id);await tap(safeKing.x,safeKing.y);await page.waitForTimeout(650);
      for(const language of languages) {
        await page.evaluate(async language=>(await import('/src/i18n.ts')).I18nManager.setLanguage(language),language);
        await page.waitForTimeout(120);
        layouts.push(await assertLayout('safe-king-'+language));
      }
      await restart();await control('[data-mode="classic"]');
      await page.waitForFunction(()=>window.__strikeHudQA.runtime.cameraTransition===null && !window.__strikeHudQA.runtime.policy.isCameraRotating());
      const classicKing=await piecePoint(king.id);const turn=(await snapshot()).turn;
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[classicKing]});
      await page.waitForTimeout(50);
      assert.equal(await page.evaluate(()=>window.__strikeHudQA.runtime.state),'aiming');
      await assertHudSeparation();
      await page.screenshot({path:output+'/classic-cancel.png'});
      const cancel=await page.locator('.classic-cancel-control').boundingBox();
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:cancel.x+cancel.width/2,y:cancel.y+cancel.height/2}]});
      await page.waitForTimeout(40);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      await page.waitForTimeout(250);
      assert.equal((await snapshot()).turn,turn,'Classic cancellation launches');
      assert.equal((await snapshot()).active,null,'Classic cancellation strands capture');
      assert.equal(await page.locator('.classic-cancel-control').isVisible(),false);
      assert.deepEqual(errors,[],'Localized runtime errors');
      results.push({languages,layouts,syntheticSafeArea:{left:44,right:44,bottom:21},classicCancel:true,errors});
      console.log('PASS: 9 locales, 18 King layouts, synthetic safe area and classic cancellation');
      await context.close();
      continue;
    }
    const layouts = [await assertLayout('selected')];
    for (const id of ['white-pawn-a2', 'white-pawn-h2']) {
      const piece = (await snapshot()).pieces.find(p => p.id === id);
      assert.ok(piece, `Edge pawn not visible: ${id}`);
      const point = await piecePoint(id);
      assert.ok(point, `Edge pawn not accessible: ${id}`);
      await tap(point.x, point.y);
      await page.waitForTimeout(650);
      assert.equal((await snapshot()).selected, id, `Edge pawn selection failed: ${id}`);
      layouts.push(await assertLayout(id));
    }
    await selectPawn();
    const before = await openAndSet();
    layouts.push(await assertLayout('strike'));
    if (language !== 'ko') {
      await checkFixedDock();
      assert.deepEqual(errors, [], 'Localized runtime errors');
      results.push({ width, height, touch, language, layouts, localizedLayout: true, errors });
      console.log(`PASS ${caseName}: localized layout and touch targets`);
      await context.close();
      continue;
    }
    await checkCameraReturn('button-apply', () => control('[data-action="launch"]'));
    const buttonApplied = await snapshot();
    assert.equal(buttonApplied.panel, false, 'Aim button leaves strike panel open');
    assert.equal(buttonApplied.selected, before.selected, 'Aim button changes selection');
    assert.deepEqual(buttonApplied.override, before.override, 'Aim button changes strike');
    assert.equal(buttonApplied.turn, before.turn, 'Aim button launches');
    await control('[data-action="strike"]');
    await page.waitForTimeout(400);
    const empty = await emptyPoint();
    await checkCameraReturn('outside-apply', () => tap(empty.x, empty.y));
    const applied = await snapshot();
    assert.equal(applied.panel, false, 'Outside tap leaves strike panel open');
    assert.equal(applied.selected, before.selected, 'Outside tap changes selection');
    assert.deepEqual(applied.override, before.override, 'Outside tap changes strike');
    assert.equal(applied.turn, before.turn, 'Outside tap launches');
    layouts.push(await assertLayout('applied'));
    await control('[data-action="strike"]');
    await page.waitForTimeout(400);
    assert.deepEqual((await snapshot()).override, before.override, 'Reopened edit loses strike');
    const repeat = await emptyPoint();
    await tap(repeat.x, repeat.y);
    await tap(repeat.x, repeat.y);
    const repeated = await snapshot();
    assert.equal(repeated.turn, before.turn, 'Repeated outside taps launch');
    assert.equal(repeated.active, null, 'Repeated outside taps strand pointer');
    // The second tap is normal aim-mode input, so explicitly reselect after its deselection.
    if (repeated.selected === null) await selectPawn();
    await control('[data-action="strike"]');
    await page.waitForTimeout(400);
    await control('.strike-point-panel button');
    assert.equal((await snapshot()).override, null, 'Reset leaves custom strike');
    await checkCameraReturn('reset-aim', () => control('[data-action="launch"]'));
    assert.equal((await snapshot()).panel, false, 'Aim button leaves edit open');

    // A tap on another piece first applies, then a separate tap changes selection.
    await restart();
    await selectPawn();
    const otherBefore = await openAndSet();
    let other, otherPoint;
    // Choose a distant pawn so the separate red-dot touch target is not the tap target.
    for (const candidate of otherBefore.pieces.filter(p => p.id !== otherBefore.selected && p.id.includes('white-pawn') && p.x > width * .5).sort((a, b) => b.x - a.x)) {
      const point = await piecePoint(candidate.id);
      if (point) { other = candidate; otherPoint = point; break; }
    }
    assert.ok(other && otherPoint, 'No second pawn for selection check');
    await tap(otherPoint.x, otherPoint.y);
    await page.waitForTimeout(450);
    assert.equal((await snapshot()).selected, otherBefore.selected, 'Applying tap selects another piece');
    assert.deepEqual((await snapshot()).override, otherBefore.override, 'Applying on another piece loses strike');
    const currentOther = await piecePoint(other.id);
    assert.ok(currentOther, 'Other pawn is obscured after applying');
    await tap(currentOther.x, currentOther.y);
    await page.waitForTimeout(450);
    assert.equal((await snapshot()).selected, other.id, 'Second tap cannot select another piece');

    await restart();
    await selectPawn();
    const dragBefore = await openAndSet();
    const start = await emptyPoint();
    if (touch) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start.x, y: start.y }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x - 45, y: start.y - 15 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse.move(start.x, start.y); await page.mouse.down();
      await page.mouse.move(start.x - 45, start.y - 15, { steps: 5 }); await page.mouse.up();
    }
    await page.waitForTimeout(500);
    const dragAfter = await snapshot();
    assert.ok(dragAfter.panel, 'Outside drag applies strike');
    assert.deepEqual(dragAfter.override, dragBefore.override, 'Outside drag loses strike');
    assert.notDeepEqual(dragAfter.camera, dragBefore.camera, 'Outside drag cannot move camera');
    assert.deepEqual(dragAfter.hud,dragBefore.hud,'Camera rotation moves the dock');
    layouts.push(await assertLayout('rotated'));
    if (touch) {
      const pt = await emptyPoint();
      const second = await page.evaluate(pt => [[60, 0], [-60, 0], [0, 60], [0, -60]].map(([dx, dy]) => ({ x: pt.x + dx, y: pt.y + dy })).find(p => document.elementFromPoint(p.x, p.y)?.classList.contains('game-canvas')), pt);
      assert.ok(second, 'No second canvas touch available');
      const points = [{ x: pt.x, y: pt.y, id: 1 }, { ...second, id: 2 }];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [points[0]] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [points[1]] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      assert.ok((await snapshot()).panel, 'Two fingers apply strike');
      const cancel = await emptyPoint();
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cancel.x, y: cancel.y }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
      await page.waitForTimeout(100);
      const cancelled = await snapshot();
      assert.ok(cancelled.panel, 'Pointer cancellation applies strike');
      assert.equal(cancelled.active, null, 'Pointer cancellation retains active pointer');
      assert.equal(cancelled.orbit, 0, 'Pointer cancellation retains orbit fingers');
    }
    await control('[data-action="launch"]');
    await page.waitForTimeout(600);
    const launchBefore = await snapshot();
    const dot = await page.evaluate(() => {
      const r = window.__strikeHudQA.runtime;
      const p = window.__strikeHudQA.project(r.aimParametersRuntime.redDot);
      return { x: p.x, y: p.y };
    });
    const pull = Math.min(180, Math.max(80, height * .28)) * .4;
    if (touch) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [dot] });
      for (let step = 1; step <= 4; step++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: dot.x, y: dot.y + pull * step / 4 }] });
        await page.waitForTimeout(60);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse.move(dot.x, dot.y); await page.mouse.down();
      await page.mouse.move(dot.x, dot.y + 72, { steps: 4 }); await page.mouse.up();
    }
    await page.waitForFunction(turn => document.querySelector('.turn-hud-side').textContent !== turn, launchBefore.turn, { timeout: 6000 });
    const launched = await snapshot();
    assert.equal(launched.override, null, 'Launch retains strike override');
    assert.equal(launched.selected, null, 'Launch retains selection');
    assert.equal(launched.panel, false, 'Launch retains strike panel');
    await page.waitForFunction(() => !window.__strikeHudQA.runtime.policy.isInputBlocked() && !window.__strikeHudQA.runtime.policy.isCameraRotating());
    await page.waitForTimeout(500);
    await restart();
    await checkFixedDock();
    assert.deepEqual(errors, [], 'Runtime errors');
    results.push({ width, height, touch, language, layouts, outsideApplied: true, retainedStrike: true, reset: true, otherPiece: true, cameraDrag: true, multiTouchAndCancel: touch ? true : 'not applicable', launch: true, reentry: true, errors });
    console.log(`PASS ${width}x${height} ${touch ? 'touch' : 'mouse'}: layout, apply, reset, selection, orbit, launch, re-entry`);
    await context.close();
  }
  await writeFile(`${output}/browser-results.json`, JSON.stringify({ browser: browser.version(), results }, null, 2));
} catch (error) {
  if (currentPage && !currentPage.isClosed()) {
    await currentPage.screenshot({ path: `${output}/failure.png` });
    await writeFile(`${output}/failure.json`, JSON.stringify(await currentPage.evaluate(() => ({
      visibleButtons: [...document.querySelectorAll('button')].filter(e => e.getClientRects().length).map(e => ({ text: e.innerText, disabled: e.disabled, html: e.outerHTML.slice(0, 200) })),
      selected: window.__strikeHudQA?.runtime.aimRuntime.selectedPieceId,
      pointer: window.__strikeHudQA?.runtime.activePointerId,
      turn: document.querySelector('.turn-hud-container')?.innerText,
      events: window.__strikeHudEvents,
      blocked: window.__strikeHudQA?.runtime.policy.isInputBlocked(),
      rotating: window.__strikeHudQA?.runtime.policy.isCameraRotating(),
    })), null, 2));
  }
  throw error;
} finally { await browser?.close(); await server.close(); }
