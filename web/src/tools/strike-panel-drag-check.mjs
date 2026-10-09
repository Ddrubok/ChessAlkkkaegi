import assert from 'node:assert/strict';

export async function checkStrikePanelDrag({ page, cdp, touch }) {
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const state = () => page.evaluate(() => {
    const r = window.__strikeHudQA.runtime;
    return { id: r.strikePanelPointerId, pending: r.strikePanelPending,
      override: r.aimParametersRuntime.strikePointOverride?.toArray() ?? null,
      marker: r.strikePointPanel.marker.getAttribute('style'),
      camera: r.sceneRuntime.camera.position.toArray(),
      power: r.aimParametersRuntime.normalizedPower, aimPower: r.aimRuntime.activeAim?.normalizedPower,
      orbit: r.orbitTouchPointerIds.size, active: r.activePointerId };
  });
  const points = () => page.evaluate(async () => {
    const { pickStrikePointFromPanel } = await import('/src/strike-panel.ts');
    const r = window.__strikeHudQA.runtime;
    const mesh = r.sceneRuntime.pieceMeshes.get(r.aimRuntime.selectedPieceId);
    const rect = r.strikePointPanel.canvas.getBoundingClientRect();
    const hits = [];
    for (let fy = .15; fy < .9; fy += .08) {
      const p = { x: rect.x + rect.width / 2, y: rect.y + rect.height * fy };
      if (pickStrikePointFromPanel(r.strikePointPanel, mesh, p.x, p.y, 0)) hits.push(p);
    }
    return { a: hits[0], b: hits[Math.floor(hits.length / 2)], c: hits.at(-1),
      outside: { x: rect.x + 2, y: rect.y + 2 } };
  });
  let pts = await points();
  assert.ok(pts.a && pts.b && pts.c, 'Panel has too few surface samples');
  const down = async (p, expectCapture = true) => {
    if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...p, id: 1 }] });
    else { await page.mouse.move(p.x, p.y); await page.mouse.down(); }
    await settle();
    if (expectCapture) assert.notEqual((await state()).id, null, 'Panel did not capture pointer');
    else assert.equal((await state()).id, null, 'Outside press started a drag');
  };
  const move = async p => {
    if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...p, id: 1 }] });
    else await page.mouse.move(p.x, p.y);
    // CDP touch delivery may lag its command response by a compositor frame.
    await page.waitForTimeout(80);
    await settle();
  };
  const up = async () => {
    if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    else await page.mouse.up();
    await settle();
  };
  const assertEnded = async () => {
    const s = await state();
    assert.equal(s.id, null, 'Panel pointer stranded');
    assert.equal(s.pending, null, 'Pending point stranded');
  };
  await down(pts.a);
  const start = await state();
  await move(pts.b);
  const moved = await state();
  assert.notDeepEqual(moved.override, start.override, 'Override does not follow before up');
  assert.notEqual(moved.marker, start.marker, 'Marker does not follow before up');
  await move(pts.outside);
  assert.equal((await state()).id, moved.id, "Outside move ended panel drag");
  assert.deepEqual((await state()).override, moved.override, 'Outside silhouette changed last valid point');
  await move(pts.c);
  assert.notDeepEqual((await state()).override, moved.override, 'Re-entering silhouette did not resume');
  await up();
  await assertEnded();
  const released = await state();
  await down(pts.outside, false);
  await assertEnded();
  assert.deepEqual((await state()).override, released.override, 'Outside press changed strike');
  await move(pts.c);
  assert.deepEqual((await state()).override, released.override, 'Outside press began following on entry');
  await up();
  await assertEnded();

  const snap = await page.evaluate(async () => {
    const { pickStrikePointFromPanel: pick } = await import('/src/strike-panel.ts');
    const r = window.__strikeHudQA.runtime;
    const mesh = r.sceneRuntime.pieceMeshes.get(r.aimRuntime.selectedPieceId);
    const rect = r.strikePointPanel.canvas.getBoundingClientRect();
    const y = rect.y + rect.height * .6;
    for (let x = rect.x + rect.width / 2; x < rect.right; x += .5) {
      if (!pick(r.strikePointPanel, mesh, x, y, 0) && pick(r.strikePointPanel, mesh, x, y)) return { x, y };
    }
    return null;
  });
  assert.ok(snap, 'No snap-only surface sample');
  await down(snap);
  const snapped = await state();
  await move(pts.outside);
  assert.equal((await state()).id, snapped.id, 'Snap-zone drag ended outside');
  assert.deepEqual((await state()).override, snapped.override, 'Snap-zone exit changed point');
  await move(pts.b);
  assert.notDeepEqual((await state()).override, snapped.override, 'Snap-zone drag did not resume on real surface');
  await up();

  // Queue a move and cancel in the same task: pending coordinates must never apply.
  for (const cancel of ['pointercancel', 'lostpointercapture', 'Escape', 'reset', 'blocked']) {
    await down(pts.a);
    const before = await state();
    await page.evaluate(({ cancel, point }) => {
      const r = window.__strikeHudQA.runtime;
      const canvas = r.strikePointPanel.canvas;
      canvas.dispatchEvent(new PointerEvent('pointermove', { pointerId: r.strikePanelPointerId, clientX: point.x, clientY: point.y, bubbles: true }));
      if (cancel === 'Escape') window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }));
      else if (cancel === 'reset') r.strikePointPanel.resetButton.click();
      else if (cancel === 'blocked') {
        // Also test the no-pending, stationary-finger validity check.
        r.strikePanelPending = null;
        window.__savedStrikeBlocked = r.policy.isInputBlocked;
        r.policy.isInputBlocked = () => true;
      } else canvas.dispatchEvent(new PointerEvent(cancel, { pointerId: r.strikePanelPointerId, bubbles: true }));
    }, { cancel, point: pts.c });
    await settle();
    await assertEnded();
    assert.deepEqual((await state()).override, cancel === 'reset' ? null : before.override, `${cancel}: pending point applied`);
    if (cancel === 'blocked') await page.evaluate(() => {
      window.__strikeHudQA.runtime.policy.isInputBlocked = window.__savedStrikeBlocked;
    });
    await up();
    assert.deepEqual((await state()).override, cancel === 'reset' ? null : before.override, `${cancel}: pointerup reapplied point`);
  }

  if (touch) {
    for (const area of ['panel', 'canvas']) {
      const second = area === 'panel' ? pts.c : await page.evaluate(() => {
        const rect = window.__strikeHudQA.runtime.sceneRuntime.renderer.domElement.getBoundingClientRect();
        const point = { x: rect.x + rect.width * .7, y: rect.y + rect.height * .65 };
        if (!document.elementFromPoint(point.x, point.y)?.classList.contains('game-canvas')) throw new Error('Second pointer is not over game canvas');
        return point;
      });
      await down(pts.a);
      const before = await state();
      await page.evaluate(() => {
        const r = window.__strikeHudQA.runtime;
        window.__orbitStarts = 0;
        window.__orbitStartListener = () => window.__orbitStarts++;
        r.sceneRuntime.controls.addEventListener('start', window.__orbitStartListener);
      });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...pts.a, id: 1 }, { ...second, id: 2 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...pts.a, id: 1 }, { x: second.x + 10, y: second.y + 10, id: 2 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: second.x + 10, y: second.y + 10, id: 2 }] });
      await settle();
      const after = await state();
      assert.equal(after.id, before.id, `${area}: second pointer ended/took over drag`);
      assert.deepEqual(after.override, before.override, `${area}: second pointer changed strike`);
      assert.ok(Math.hypot(...after.camera.map((v, i) => v - before.camera[i])) < 1e-9, `${area}: second pointer moved camera`);
      assert.equal(after.active, null, `${area}: second pointer entered canvas input`);
      assert.equal(after.orbit, 0, `${area}: second pointer entered orbit tracking`);
      const starts = await page.evaluate(() => {
        window.__strikeHudQA.runtime.sceneRuntime.controls.removeEventListener('start', window.__orbitStartListener);
        return window.__orbitStarts;
      });
      assert.equal(starts, 0, `${area}: OrbitControls received second pointer`);
      await move(pts.b);
      const resumed = await state();
      assert.notDeepEqual(resumed.override, before.override, `${area}: first pointer no longer follows`);
      await up();
    }
  }

  const originalPiece = await page.evaluate(() => window.__strikeHudQA.runtime.aimRuntime.selectedPieceId);
  for (const [type, expected] of [['Rook', 1], ['Queen', 1.5]]) {
    await page.evaluate(async type => {
      const { selectPiece } = await import('/src/input.ts');
      const r = window.__strikeHudQA.runtime;
      const binding = [...r.physicsRuntime.pieces.values()].find(b => b.instance.side === 'white' && b.instance.type === type);
      selectPiece(r, binding.instance.id);
      r.strikeMode = true;
    }, type);
    await page.waitForTimeout(450);
    pts = await points();
    await page.evaluate(() => {
      const r = window.__strikeHudQA.runtime;
      r.aimParametersRuntime.normalizedPower = 1.5;
      r.aimRuntime.activeAim.normalizedPower = 1.5;
    });
    await down(pts.a);
    await move(pts.b);
    const powered = await state();
    assert.equal(powered.power, expected, `${type}: parameter power cap`);
    assert.equal(powered.aimPower, expected, `${type}: active aim power cap`);
    await up();
  }
  await page.evaluate(async id => {
    const { selectPiece } = await import('/src/input.ts');
    const r = window.__strikeHudQA.runtime;
    selectPiece(r, id);
    r.strikeMode = true;
  }, originalPiece);
  await page.waitForTimeout(450);

  const timing = await page.evaluate(async () => {
    const { pickStrikePointFromPanel } = await import('/src/strike-panel.ts');
    const r = window.__strikeHudQA.runtime;
    const mesh = r.sceneRuntime.pieceMeshes.get(r.aimRuntime.selectedPieceId);
    const rect = r.strikePointPanel.canvas.getBoundingClientRect();
    // A miss just beyond the silhouette exhausts all 33 snap rays.
    const y = rect.y + rect.height * .6;
    let edge = rect.x + rect.width / 2;
    while (edge < rect.right && pickStrikePointFromPanel(r.strikePointPanel, mesh, edge, y)) edge += 1;
    const raycast = mesh.raycast;
    const timings = {};
    for (const [name, tolerance] of [['down', undefined], ['move', 0]]) {
      let rays = 0;
      mesh.raycast = function (...args) { rays++; return raycast.apply(this, args); };
      const times = [];
      try {
        for (let i = 0; i < 30; i++) {
          const start = performance.now();
          pickStrikePointFromPanel(r.strikePointPanel, mesh, edge, y, tolerance);
          times.push(performance.now() - start);
        }
      } finally { mesh.raycast = raycast; }
      times.sort((a, b) => a - b);
      timings[name] = { raysPerPick: rays / times.length, medianMs: times[15], maxMs: times.at(-1) };
    }
    return timings;
  });
  assert.equal(timing.down.raysPerPick, 33, 'Timing sample did not exhaust silhouette snap rays');
  assert.equal(timing.move.raysPerPick, 1, 'Panel move used snap rays');
  console.log(`PASS panel drag ${touch ? 'touch' : 'mouse'}: live marker, exit/re-entry + snap-zone, outside press ignored, cancel/lostcapture/Escape/reset/block, multitouch, Rook/Queen; edge pick ${JSON.stringify(timing)}`);
}
