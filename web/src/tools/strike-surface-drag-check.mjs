import assert from 'node:assert/strict';

export async function checkStrikeSurfaceDrag({ page, cdp, touch, width, height, output, caseName }) {
  const sameVector = (actual, expected, message) => assert.ok(Math.hypot(...actual.map((v, i) => v - expected[i])) < 1e-9, message);
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const state = () => page.evaluate(() => {
    const r = window.__strikeHudQA.runtime;
    return { id: r.activePointerId, source: r.gesture?.source ?? null, pending: r.strikeSurfacePending,
      panelId: r.strikePanelPointerId, selected: r.aimRuntime.selectedPieceId,
      override: r.aimParametersRuntime.strikePointOverride?.toArray() ?? null,
      camera: r.sceneRuntime.camera.position.toArray(), target: r.sceneRuntime.controls.target.toArray(),
      enabled: r.sceneRuntime.controls.enabled, power: r.aimParametersRuntime.normalizedPower,
      aimPower: r.aimRuntime.activeAim?.normalizedPower, keys: [...r.heldCameraKeys], transition: r.cameraTransition !== null };
  });
  const original = (await state()).selected;
  const prepare = async (id = original) => {
    await page.evaluate(async id => {
      const { cancelInputInteraction, selectPiece } = await import('/src/input.ts');
      const r = window.__strikeHudQA.runtime;
      cancelInputInteraction(r, true);
      selectPiece(r, id);
      r.actionBar.querySelector('[data-action="strike"]').click();
    }, id);
    await page.waitForTimeout(450);
  };
  const points = () => page.evaluate(() => {
    const { runtime: r, project, pick } = window.__strikeHudQA;
    const box = project(r.sceneRuntime.pieceMeshes.get(r.aimRuntime.selectedPieceId)).pieceRect;
    const hits = [];
    for (const fy of [.3, .5, .7, .2, .8]) for (const fx of [.5, .35, .65, .2, .8]) {
      const p = { x: box.left + (box.right - box.left) * fx, y: box.top + (box.bottom - box.top) * fy };
      if (document.elementFromPoint(p.x, p.y)?.classList.contains('game-canvas') && pick(p.x, p.y) === r.aimRuntime.selectedPieceId) hits.push(p);
    }
    if (!hits.length) return null;
    const a = hits[0];
    const b = hits.reduce((best, p) => Math.hypot(p.x-a.x,p.y-a.y)>Math.hypot(best.x-a.x,best.y-a.y)?p:best, a);
    const rect = r.sceneRuntime.renderer.domElement.getBoundingClientRect();
    let outside = null, free = 0, total = 0;
    for (let y=rect.top+25;y<rect.bottom-25;y+=20) for(let x=rect.left+25;x<rect.right-25;x+=20) {
      if (!document.elementFromPoint(x,y)?.classList.contains('game-canvas')) continue;
      total++;
      if (pick(x,y) === null) { free++; if(!outside && x>rect.left+rect.width*.35 && y>rect.top+rect.height*.3) outside={x,y}; }
    }
    return { a, b, outside, freeRatio: free/total };
  });
  const down = async p => {
    if(touch) await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:1}]});
    else { await page.mouse.move(p.x,p.y); await page.mouse.down(); }
    await settle();
  };
  const move = async p => {
    if(touch) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...p,id:1}]});
    else await page.mouse.move(p.x,p.y);
    await page.waitForTimeout(80); await settle();
  };
  const up = async () => {
    if(touch) await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    else await page.mouse.up();
    await settle();
  };
  const ended = async () => {
    const s=await state(); assert.equal(s.id,null,'Surface pointer stranded'); assert.equal(s.pending,null,'Surface pending stranded');
    assert.notEqual(s.source,'strike-surface','Surface gesture stranded');
  };
  await prepare();
  let pts=await points(); assert.ok(pts?.outside,'No surface/empty-space samples');
  if ((width===360 && height===800) || (width===667 && height===375)) {
    await page.screenshot({path:`${output}/${caseName}-strike-max-zoom-orbit.png`});
    console.log(`ORBIT SPACE ${caseName}: freeRatio=${pts.freeRatio.toFixed(3)} screenshot=${output}/${caseName}-strike-max-zoom-orbit.png`);
    const before=await state();
    await down(pts.outside);
    assert.notEqual((await state()).source,'strike-surface','Empty press starts surface drag');
    await move({x:pts.outside.x+35,y:pts.outside.y+15}); await up();
    assert.notDeepEqual((await state()).camera,before.camera,'Cannot orbit at maximum strike zoom');
    await prepare(); pts=await points();
  }

  // A held camera key may move before down, but never during the captured gesture.
  await page.keyboard.down('a');
  await down(pts.a);
  const start=await state();
  assert.equal(start.source,'strike-surface','Surface press did not start drag');
  assert.equal(start.enabled,false,'Surface press did not disable orbit');
  // The held key can rotate between sampling and pointerdown; use the captured view.
  pts=await points();
  await move((await points()).b);
  const moved=await state();
  assert.notDeepEqual(moved.override,start.override,'Surface does not follow before up');
  sameVector(moved.camera,start.camera,'Camera key/adaptive follow moved camera during drag');
  sameVector(moved.target,start.target,'Camera target moved during drag');
  await move(pts.outside); assert.deepEqual((await state()).override,moved.override,'Surface miss changes last hit');
  await move(pts.a); assert.notDeepEqual((await state()).override,moved.override,'Surface re-entry does not resume');
  await up(); await page.keyboard.up('a'); await ended();
  assert.deepEqual((await state()).keys,[],'Held keys persist after release');
  await page.waitForTimeout(450);
  assert.equal((await state()).enabled,true,'Orbit did not recover after release');
  assert.notDeepEqual((await state()).camera,start.camera,'Camera restore did not run after release');

  await prepare(); pts=await points();
  await down(pts.a); const tapped=await state(); await up();
  const tapEnd=await state();
  sameVector(tapEnd.override,tapped.override,'No-move tap changed strike');
  assert.equal(tapEnd.selected,original,'No-move tap changed selection');
  assert.equal(tapEnd.power,0,'No-move tap differs from old cancellation power');
  await page.waitForTimeout(450);

  for(const kind of ['pointercancel','lostpointercapture','Escape','reset','blocked','selection','external','action','blocked-up']) {
    await prepare(); pts=await points(); await down(pts.a);
    const before=await state();
    await page.evaluate(async ({kind, point})=>{
      const r=window.__strikeHudQA.runtime;
      r.sceneRuntime.renderer.domElement.dispatchEvent(new PointerEvent('pointermove',{pointerId:r.activePointerId,clientX:point.x,clientY:point.y,bubbles:true}));
      if(kind==='reset') r.strikePointPanel.resetButton.click();
      else if(kind==='Escape') window.dispatchEvent(new KeyboardEvent('keydown',{code:'Escape'}));
      else if(kind==='blocked' || kind==='blocked-up') {
        window.__surfaceOldBlocked=r.policy.isInputBlocked;r.policy.isInputBlocked=()=>true;
        if(kind==='blocked-up') r.sceneRuntime.renderer.domElement.dispatchEvent(new PointerEvent('pointerup',{pointerId:r.activePointerId,clientX:point.x,clientY:point.y,bubbles:true}));
      }
      else if(kind==='selection') {
        const {selectPiece}=await import('/src/input.ts');
        const next=[...r.physicsRuntime.pieces.values()].find(b=>b.instance.side==='white'&&b.instance.id!==r.aimRuntime.selectedPieceId);
        selectPiece(r,next.instance.id);
        window.__surfaceNewAim=r.aimRuntime.activeAim;
      } else if(kind==='external') {
        const {updateDirectedShotTelegraph}=await import('/src/ai.ts');
        const next=[...r.physicsRuntime.pieces.values()].find(b=>b.instance.side==='black');
        window.__surfaceOldExternal=r.policy.isExternalAimActive;r.policy.isExternalAimActive=()=>true;
        updateDirectedShotTelegraph(r.aimRuntime,{pieceId:next.instance.id,applicationPoint:r.aimParametersRuntime.currentSolution.applicationPoint.clone(),direction:r.aimRuntime.activeAim.direction.clone(),normalizedPower:.5,previewAt:0,chargeStartedAt:null},performance.now());
        window.__surfaceExternalAim=r.aimRuntime.activeAim;
        window.__surfaceExternalPoint=r.aimRuntime.applicationPoint?.clone();
      } else if(kind==='action') r.actionBar.querySelector('[data-action="strike"]').click();
      else r.sceneRuntime.renderer.domElement.dispatchEvent(new PointerEvent(kind,{pointerId:r.activePointerId,bubbles:true}));
    },{kind,point:pts.b});
    await settle(); await ended();
    if(kind==='external') {
      assert.ok(await page.evaluate(()=>{
        const r=window.__strikeHudQA.runtime;
        return r.aimRuntime.activeAim===window.__surfaceExternalAim && r.aimRuntime.applicationPoint?.equals(window.__surfaceExternalPoint);
      }),'Local cleanup destroyed external aim/applicationPoint');
    } else if(kind==='selection') {
      assert.ok(await page.evaluate(()=>window.__strikeHudQA.runtime.aimRuntime.activeAim===window.__surfaceNewAim),'Local cleanup destroyed new selection aim');
    } else {
      assert.deepEqual((await state()).override,kind==='reset'?null:before.override,`${kind}: pending point applied`);
    }
    await move(pts.b); await up();
    if(kind==='reset') assert.equal((await state()).override,null,'Reset was undone by move/up');
    await page.evaluate(kind=>{
      const r=window.__strikeHudQA.runtime;
      if(kind==='blocked' || kind==='blocked-up') r.policy.isInputBlocked=window.__surfaceOldBlocked;
      if(kind==='external') r.policy.isExternalAimActive=window.__surfaceOldExternal;
    },kind);
  }

  await prepare(); pts=await points();
  if (!touch) {
    for (const button of ['right', 'middle']) {
      await page.mouse.click(pts.a.x, pts.a.y, { button });
      await settle();
      assert.equal((await state()).override, null, `${button} click starts a strike`);
      assert.notEqual((await state()).source, 'strike-surface', `${button} starts surface gesture`);
    }
  }
  const guarded = await page.evaluate(async point => {
    const { cancelInputInteraction } = await import('/src/input.ts');
    const r = window.__strikeHudQA.runtime;
    const canvas = r.sceneRuntime.renderer.domElement;
    const originalCapture = canvas.setPointerCapture;
    const selected = r.sceneRuntime.pieceMeshes.get(r.aimRuntime.selectedPieceId);
    const other = [...r.sceneRuntime.pieceMeshes.values()].find(m => m !== selected && m.visible);
    const savedPosition = other.position.clone();
    const oldRotating = r.policy.isCameraRotating;
    const probe = () => {
      canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 999, pointerType: 'mouse', button: 0, clientX: point.x, clientY: point.y, bubbles: true }));
      return { source: r.gesture?.source, candidate: r.gesture?.candidatePieceId, override: r.aimParametersRuntime.strikePointOverride?.toArray() ?? null };
    };
    // Synthetic routing probes do not have a native pointer to capture.
    canvas.setPointerCapture = () => {};
    const stopSynthetic = event => { if (event.pointerId === 999) event.stopImmediatePropagation(); };
    canvas.addEventListener('pointerdown', stopSynthetic, true);
    try {
      r.policy.isCameraRotating = () => true;
      const rotating = probe();
      r.policy.isCameraRotating = oldRotating;
      r.kingSwapMode = true;
      const swapping = probe();
      r.kingSwapMode = false;
      cancelInputInteraction(r, false);
      const camera = r.sceneRuntime.camera;
      window.__strikeHudQA.pick(point.x, point.y);
      const hit = r.raycaster.intersectObject(selected, false)[0].point;
      other.position.copy(camera.position).lerp(hit, .7);
      other.updateMatrixWorld(true);
      const nearest = window.__strikeHudQA.pick(point.x, point.y);
      const occluded = probe();
      return { rotating, swapping, occluded, nearest, otherId: other.name };
    } finally {
      other.position.copy(savedPosition); other.updateMatrixWorld(true);
      r.policy.isCameraRotating = oldRotating;
      r.kingSwapMode = false;
      cancelInputInteraction(r, false);
      canvas.setPointerCapture = originalCapture;
      canvas.removeEventListener('pointerdown', stopSynthetic, true);
    }
  }, pts.a);
  assert.notEqual(guarded.rotating.source, 'strike-surface', 'Turn camera rotation allowed surface drag');
  assert.equal(guarded.rotating.override, null, 'Rotation guard changed strike');
  assert.equal(guarded.swapping.source, 'billiards-canvas', 'King swap lost input priority');
  assert.equal(guarded.nearest, guarded.otherId, 'Occlusion fixture did not cover selected piece');
  assert.equal(guarded.occluded.candidate, guarded.otherId, 'Occluding piece was not the tap candidate');
  assert.notEqual(guarded.occluded.source, 'strike-surface', 'Surface drag pierced visible occluder');
  assert.equal(guarded.occluded.override, null, 'Occluded press changed strike');

  await prepare(); pts=await points(); await down(pts.a);
  const lastHit = (await state()).override;
  await move({ x: 2, y: 2 }); await up(); await ended();
  assert.deepEqual((await state()).override, lastHit, 'Outside-canvas release changed strike');

  if(touch) {
    for(const area of ['canvas','panel']) {
      await prepare(); pts=await points(); await down(pts.a); const before=await state();
      const second=area==='canvas'?pts.outside:await page.evaluate(()=>{
        const rect=window.__strikeHudQA.runtime.strikePointPanel.canvas.getBoundingClientRect();return{x:rect.x+rect.width/2,y:rect.y+rect.height/2};
      });
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...pts.a,id:1},{...second,id:2}]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...pts.a,id:1},{x:second.x+5,y:second.y+5,id:2}]});
      await settle();
      assert.equal((await state()).id,before.id,`${area}: second pointer stole drag`);
      assert.equal((await state()).panelId,null,`${area}: concurrent panel drag`);
      assert.deepEqual((await state()).override,before.override,`${area}: second pointer changed point`);
      sameVector((await state()).camera,before.camera,`${area}: second pointer moved camera`);
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[{x:second.x+5,y:second.y+5,id:2}]});
      await move((await points()).b);assert.notDeepEqual((await state()).override,before.override,`${area}: first pointer stopped following`);
      await up();
    }
  }

  for(const [type,cap] of [['Rook',1],['Queen',1.5]]) {
    const id=await page.evaluate(type=>[...window.__strikeHudQA.runtime.physicsRuntime.pieces.values()].find(b=>b.instance.side==='white'&&b.instance.type===type).instance.id,type);
    await prepare(id);pts=await points(); assert.ok(pts,`No ${type} surface`);
    await page.evaluate(()=>{const r=window.__strikeHudQA.runtime;r.aimParametersRuntime.normalizedPower=1.5;r.aimRuntime.activeAim.normalizedPower=1.5;});
    await down(pts.a);await move((await points()).b);
    assert.equal((await state()).power,cap,`${type}: surface parameter power`);
    assert.equal((await state()).aimPower,cap,`${type}: surface active aim power`);
    await up();
  }
  await prepare();
  console.log(`PASS surface drag ${caseName}: follow/re-entry, frozen camera + held key, release/tap, cancel/lostcapture/Escape/reset/block/selection/external/action, mutual exclusion, occlusion/king-swap/rotation/button guards, Rook/Queen`);
}
