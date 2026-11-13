import './headless-browser-env.mjs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { PerspectiveCamera, Mesh, SphereGeometry, MeshBasicMaterial, Raycaster, Vector2, Vector3, Group } from 'three';

globalThis.HTMLElement = class HTMLElement {};
globalThis.HTMLInputElement = class HTMLInputElement extends HTMLElement {};
globalThis.HTMLOutputElement = class HTMLOutputElement extends HTMLElement {};
globalThis.HTMLSelectElement = class HTMLSelectElement extends HTMLElement {};
globalThis.HTMLParagraphElement = class HTMLParagraphElement extends HTMLElement {};
globalThis.HTMLFieldSetElement = class HTMLFieldSetElement extends HTMLElement {};
globalThis.HTMLLabelElement = class HTMLLabelElement extends HTMLElement {};
globalThis.HTMLSpanElement = class HTMLSpanElement extends HTMLElement {};
globalThis.HTMLButtonElement = class HTMLButtonElement extends HTMLElement {};
globalThis.HTMLDivElement = class HTMLDivElement extends HTMLElement {};

globalThis.window = Object.assign(globalThis.window || {}, {
  location: { search: '' },
  localStorage: globalThis.localStorage,
});
const createMockElement = (tag) => {
  const children = [];
  const attrs = new Map();
  const classes = new Set();
  const element = {
    tagName: tag.toUpperCase(),
    style: {},
    dataset: {},
    className: '',
    hidden: false,
    textContent: '',
    children,
    parentElement: null,
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    },
    setAttribute: (k, v) => attrs.set(k, String(v)),
    getAttribute: (k) => attrs.get(k) ?? null,
    hasAttribute: (k) => attrs.has(k),
    removeAttribute: (k) => attrs.delete(k),
    append: (...items) => items.forEach((item) => {
      children.push(item);
      if (item && typeof item === 'object') item.parentElement = element;
    }),
    appendChild: (item) => {
      children.push(item);
      if (item && typeof item === 'object') item.parentElement = element;
      return item;
    },
    remove: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    querySelectorAll: () => [],
    querySelector: (sel) => {
      const child = createMockElement('span');
      child.className = sel.replace('.', '');
      return child;
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 40, width: 100, height: 40 }),
  };
  return element;
};
globalThis.document.createElement = (tag) => createMockElement(tag);

const webRoot = fileURLToPath(new URL('../..', import.meta.url));
const vite = await createServer({
  root: webRoot,
  configFile: false,
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false },
  plugins: [{
    name: 'classic-cancel-check-plugin',
    transform(code, id) {
      if (id.replaceAll('\\', '/').endsWith('/src/input.ts')) {
        return code + '\nexport { updateReachability as testUpdateReachability, handleCanvasPointerDown as pointerDown, handleCanvasPointerMove as pointerMove, handleCanvasPointerUp as pointerUp, cancelInteraction as internalCancel, createStrategies as testCreateStrategies, refreshBilliardsPreview as testRefreshBilliardsPreview };';
      }
    }
  }],
});

try {
  const input = await vite.ssrLoadModule('/src/input.ts');
  const {
    pointerDown,
    pointerMove,
    pointerUp,
    internalCancel,
    isPointerOverElement,
    testCreateStrategies,
    testRefreshBilliardsPreview,
    cancelInputInteraction,
  } = await vite.ssrLoadModule('/src/input.ts');

  const { createAimRuntime } = await vite.ssrLoadModule('/src/aim.ts');
  const { createAimParametersRuntime } = await vite.ssrLoadModule('/src/aimparams.ts');
  const { createTuningRuntime } = await vite.ssrLoadModule('/src/tuning.ts');
  const { inputCancelCopy } = await vite.ssrLoadModule('/src/input-cancel-copy.ts');
  const powerControls = await vite.ssrLoadModule('/src/power-controls.ts');

  // 1. 9-language copy dictionary validation
  console.log('[검증 1] 9개 언어 다국어 복사본 사전 검증');
  const supportedLanguages = ['ko', 'en', 'ja', 'zh-CN', 'de', 'fr', 'es', 'ru', 'pt-BR'];
  for (const lang of supportedLanguages) {
    const copy = inputCancelCopy(lang);
    assert.ok(copy, `Language copy missing for ${lang}`);
    assert.ok(copy.cancelTitle && copy.cancelTitle.length > 0, `cancelTitle missing for ${lang}`);
    assert.ok(copy.cancelHintDesktop && copy.cancelHintDesktop.length > 0, `cancelHintDesktop missing for ${lang}`);
    assert.ok(copy.cancelHintMobile && copy.cancelHintMobile.length > 0, `cancelHintMobile missing for ${lang}`);
    assert.ok(copy.cancelZoneText && copy.cancelZoneText.length > 0, `cancelZoneText missing for ${lang}`);
  }
  console.log('  -> 9개 언어 사전(ko, en, ja, zh-CN, de, fr, es, ru, pt-BR) 정상 로드 완료');

  // 2. Headless Mock Environment Setup
  console.log('[검증 2] 헤드리스 런타임 및 취소 UI 엘리먼트 셋업');
  const camera = new PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 5, 5);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);

  const makeMesh = (id, x, z, radius) => {
    const mesh = new Mesh(new SphereGeometry(radius, 24, 16), new MeshBasicMaterial());
    mesh.name = id;
    mesh.position.set(x, 0, z);
    mesh.updateMatrixWorld(true);
    return mesh;
  };

  const whitePieceMesh = makeMesh('white-pawn-a2', 0, 0, 0.3);
  const pieceMeshes = new Map([[whitePieceMesh.name, whitePieceMesh]]);
  const bindings = new Map([[whitePieceMesh.name, {
    instance: { id: whitePieceMesh.name, side: 'white', kind: 'pawn' },
    body: {
      isSleeping: () => true,
      translation: () => ({ x: 0, y: 0, z: 0 }),
      rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
      worldCom: () => ({ x: 0, y: 0, z: 0 }),
      linvel: () => ({ x: 0, y: 0, z: 0 }),
      angvel: () => ({ x: 0, y: 0, z: 0 }),
      collider: () => ({ shape: { radius: 0.3 } }),
      effectiveWorldInvInertia: () => ({ x: 1, y: 1, z: 1 }),
      mass: () => 1,
      invMass: () => 1,
    },
  }]]);

  let launchQueueCalls = [];
  const physicsRuntime = { pieces: bindings };

  const capturedPointerIds = new Set();
  const canvasClasses = new Set();
  const mockCanvas = {
    classList: {
      toggle: (name, active) => active ? canvasClasses.add(name) : canvasClasses.delete(name),
      remove: (name) => canvasClasses.delete(name),
      contains: (name) => canvasClasses.has(name),
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400 }),
    setPointerCapture: (id) => capturedPointerIds.add(id),
    releasePointerCapture: (id) => capturedPointerIds.delete(id),
    hasPointerCapture: (id) => capturedPointerIds.has(id),
    addEventListener: () => {},
    removeEventListener: () => {},
    parentElement: createMockElement('div'),
  };

  const classListSet = new Set();
  const mockCancelControl = {
    hidden: true,
    classList: {
      add: (cls) => classListSet.add(cls),
      remove: (cls) => classListSet.delete(cls),
      contains: (cls) => classListSet.has(cls),
    },
    getBoundingClientRect: () => ({ left: 300, top: 10, right: 390, bottom: 60, width: 90, height: 50 }),
    setAttribute: () => {},
    addEventListener: () => {},
  };

  const sceneGroup = new Group();
  const mockScene = {
    camera,
    pieceMeshes,
    renderer: { domElement: mockCanvas },
    scene: sceneGroup,
    controls: {
      enabled: true,
      enableDamping: true,
      target: new Vector3(0, 0, 0),
      minPolarAngle: 0,
      maxPolarAngle: Math.PI,
      minDistance: 1,
      maxDistance: 20,
      getAzimuthalAngle: () => 0,
      update: () => {},
    },
    minimumCameraDistance: 5,
    boardHalfExtent: 4,
  };

  const createTestRuntime = (mode = 'classic') => {
    launchQueueCalls = [];
    capturedPointerIds.clear();
    canvasClasses.clear();
    classListSet.clear();
    mockCancelControl.hidden = true;

    const strategies = testCreateStrategies();
    const aimRuntime = createAimRuntime(mockScene, camera);
    const tuningRuntime = createTuningRuntime(createMockElement('div'), mockScene, physicsRuntime, camera);
    const aimParametersRuntime = createAimParametersRuntime(createMockElement('div'), tuningRuntime, mockScene);

    const runtime = {
      sceneRuntime: mockScene,
      physicsRuntime,
      aimRuntime,
      aimParametersRuntime,
      policy: {
        isInputBlocked: () => false,
        isExternalAimActive: () => false,
        isCameraRotating: () => false,
        canSelectPiece: () => true,
        queueLaunch: (req) => {
          launchQueueCalls.push(req);
          return { accepted: true };
        },
        onModeChanged: () => {},
      },
      mode,
      strategies,
      strategy: strategies[mode],
      raycaster: new Raycaster(),
      pointerNdc: new Vector2(),
      selectablePieceIds: new Set([whitePieceMesh.name]),
      state: 'idle',
      activePointerId: null,
      activeCaptureElement: null,
      gesture: null,
      orbitTouchPointerIds: new Set(),
      cameraTransition: null,
      preparedStrikeSolution: null,
      lastValidAzimuth: 0,
      heldCameraKeys: new Set(),
      lastUpdateTime: null,
      hiddenPieceIds: new Set(),
      failureReason: null,
      adaptiveCloseDistance: null,
      modeToggle: { querySelectorAll: () => [] },
      actionBar: { querySelectorAll: () => [], style: {}, offsetWidth: 100, offsetHeight: 40 },
      actionBarSelectedPieceId: null,
      actionBarLastPositionedAt: 0,
      actionBarLastLeft: null,
      actionBarLastTop: null,
      actionBarPanelWasVisible: false,
      strikeMode: false,
      strikePointPanel: { root: { addEventListener: () => {} }, canvas: { addEventListener: () => {} }, resetButton: { addEventListener: () => {} } },
      kingSwapMode: false,
      kingSwapBanner: { hidden: true },
      cancelControl: mockCancelControl,
      cancelControlTitle: {},
      cancelControlHint: {},
      cancelFeedback: { hidden: true },
      isPointerOverCancel: false,
    };
    return runtime;
  };

  const point = whitePieceMesh.position.clone().project(camera);
  const startX = (point.x + 1) * 200;
  const startY = (1 - point.y) * 200;
  const event = (x, y, pointerId = 42, pointerType = 'mouse') => ({
    clientX: x, clientY: y, pointerId, pointerType, button: 0,
    preventDefault() {}, stopImmediatePropagation() {},
  });

  assert.equal(powerControls.getMousePowerDistance(), 180);
  for (const [distance, expected] of [[180, 180], [240, 240], [360, 360]]) {
    powerControls.setMousePowerDistance(distance);
    assert.equal(input.computeEffectiveMaxDragPixels({ pointerType: 'mouse' }, 800, 2000), powerControls.computeViewportPowerDistance(expected, 2000, 800));
    assert.ok(input.computeEffectiveMaxDragPixels({ pointerType: 'touch' }, 800) <= 180);
  }
  powerControls.resetMousePowerDistance();
  assert.equal(powerControls.getMousePowerDistance(), 180);

  const rect = { left: 0, right: 400, top: 0, bottom: 400 };
  assert.equal(powerControls.rayDistanceToRectEdge(200, 200, 0, 1, rect), 200);
  assert.equal(powerControls.rayDistanceToRectEdge(390, 200, 1, 0, rect), 10);
  assert.ok(powerControls.rayDistanceToRectEdge(200, 200, 1, 1, rect) > 280);
  assert.equal(input.computeRedDotPullPower(100, 100 + 180 * 1.5, 180, 1.5), 1.5);
  assert.equal(input.computeRedDotPullPower(100, 280, 180, 1.5), 1);
  assert.equal(input.computeRedDotPullPower(100, 100 + 180 * .3, 180, 1.5, 2), .09);
  assert.equal(input.computeRedDotPullPower(100, 100 + 180, 180, 1.5, 2), 1);
  assert.equal(input.computeRedDotPullPower(100, 100 + 180 * Math.sqrt(1.5), 180, 1.5, 2), 1.5);
  assert.equal(input.computeRedDotPullPower(100, 100 + 180 * .3, 180, 1.5, 1), .3);
  assert.equal(input.computeEffectiveMaxDragPixels({ pointerType: 'touch' }, 400, 400), 38.4);
  assert.ok(input.computeEffectiveMaxDragPixels({ pointerType: 'mouse' }, 400, 400) > 38.4);

  const canvasDistance = input.computeEffectiveMaxDragPixels({ pointerType: 'mouse' }, 400, 400);
  for (const [movePercent, releasePercent] of [[0.8, 0.3], [0.4, 1], [0.6, 0]]) {
    const runtime = createTestRuntime('classic');
    pointerDown(runtime, event(startX, startY));
    assert.equal(runtime.gesture.powerExponent, powerControls.MOUSE_POWER_EXPONENT);
    pointerMove(runtime, event(startX, startY + movePercent * canvasDistance));
    assert.ok(Math.abs(runtime.aimRuntime.activeAim.normalizedPower - movePercent ** powerControls.MOUSE_POWER_EXPONENT) < 1e-6);
    pointerUp(runtime, event(startX, startY + releasePercent * canvasDistance));
    assert.equal(launchQueueCalls.length, releasePercent > 0 ? 1 : 0);
    if (releasePercent > 0) assert.ok(Math.abs(launchQueueCalls[0].normalizedPower - releasePercent ** powerControls.MOUSE_POWER_EXPONENT) < 1e-6);
    pointerUp(runtime, event(startX, startY + releasePercent * canvasDistance));
    assert.equal(launchQueueCalls.length, releasePercent > 0 ? 1 : 0, 'once-only release');
  }
  {
    const runtime = createTestRuntime('classic');
    pointerDown(runtime, event(startX, startY, 45, 'touch'));
    const touchDistance = runtime.gesture.maxDragPixels;
    assert.equal(runtime.gesture.powerExponent, 1);
    pointerMove(runtime, event(startX, startY + touchDistance * .3, 45, 'touch'));
    assert.ok(Math.abs(runtime.aimRuntime.activeAim.normalizedPower - .3) < 1e-6);
    pointerUp(runtime, event(startX, startY + touchDistance * .4, 45, 'touch'));
    assert.ok(Math.abs(launchQueueCalls[0].normalizedPower - .4) < 1e-6);
  }
  for (const [pointerType, threshold] of [['mouse', 4], ['touch', 8]]) {
    const runtime = createTestRuntime('classic');
    pointerDown(runtime, event(startX, startY, 42, pointerType));
    pointerUp(runtime, event(startX, startY + threshold, 42, pointerType));
    assert.equal(launchQueueCalls.length, 0, `${pointerType} click jitter`);
    pointerDown(runtime, event(startX, startY, 43, pointerType));
    pointerMove(runtime, event(startX, startY + threshold + 1, 43, pointerType));
    pointerUp(runtime, event(startX, startY + 1, 43, pointerType));
    assert.equal(launchQueueCalls.length, 1, `${pointerType} armed pull back`);
    const releaseOnly = createTestRuntime('classic');
    pointerDown(releaseOnly, event(startX, startY, 44, pointerType));
    pointerUp(releaseOnly, event(startX, startY + threshold + 1, 44, pointerType));
    assert.equal(launchQueueCalls.length, 1, `${pointerType} release only movement`);
  }
  for (const pointerType of ['mouse', 'touch']) {
    for (const [label, x, y] of [['side margin', 2, 200], ['HUD center', 200, 440], ['HUD left', 100, 440], ['HUD right', 300, 440], ['banner left', 99.99, 440], ['banner right', 300.01, 440], ['power label', 40, 440], ['outside label', 81, 440], ['canvas bottom', 200, 400], ['above cancel', 200, 479.99], ['cancel top', 200, 480], ['cancel center', 200, 520], ['below cancel', 200, 600], ['screen outside', -1, 440], ['above canvas', 200, -1]]) {
      const runtime = createTestRuntime('classic');
      pointerDown(runtime, event(startX, startY, 42, pointerType));
      pointerMove(runtime, event(x, y, 42, pointerType));
      assert.ok(runtime.aimRuntime.activeAim.normalizedPower > 0, `${pointerType} ${label}: nonzero preview`);
    }
  }

  for (const distance of [180, 240, 360]) {
    powerControls.setMousePowerDistance(distance);
    const runtime = createTestRuntime('classic');
    pointerDown(runtime, event(startX, startY));
    assert.equal(runtime.gesture.maxDragPixels, powerControls.computeViewportPowerDistance(distance, 400, 400));
    powerControls.setMousePowerDistance(distance === 180 ? 240 : 180);
    pointerUp(runtime, event(startX, startY + 40));
    assert.equal(launchQueueCalls.length, 0, 'setting changed during gesture cancels');
  }
  {
    const runtime = createTestRuntime('billiards');
    runtime.aimRuntime.selectedPieceId = whitePieceMesh.name;
    testRefreshBilliardsPreview(runtime);
    runtime.state = 'charging';
    runtime.activePointerId = 42;
    runtime.activeCaptureElement = mockCanvas;
    runtime.gesture = { source: 'red-dot', startX: startX, startY: 100, maximumDistance: 0,
      candidatePieceId: whitePieceMesh.name, maxDragPixels: 180, mousePowerDistance: 180 };
    pointerMove(runtime, event(startX, 100 + 180 * .8));
    pointerUp(runtime, event(startX, 100 + 180 * .4));
    assert.equal(launchQueueCalls.length, 1);
    assert.ok(Math.abs(launchQueueCalls[0].normalizedPower - .4) < 1e-6, 'red-dot final pointerup sample');
    pointerUp(runtime, event(startX, 100 + 180 * .4));
    assert.equal(launchQueueCalls.length, 1, 'red-dot duplicate release');
  }
  {
    const runtime = createTestRuntime('billiards');
    runtime.aimRuntime.selectedPieceId = whitePieceMesh.name;
    testRefreshBilliardsPreview(runtime);
    runtime.state = 'charging';
    runtime.activePointerId = 42;
    runtime.activeCaptureElement = mockCanvas;
    runtime.gesture = { source: 'red-dot', startX, startY: 100, pointerType: 'mouse', powerExponent: 2, maximumDistance: 0,
      candidatePieceId: whitePieceMesh.name, maxDragPixels: 180, mousePowerDistance: 180 };
    pointerMove(runtime, event(startX, 100 + 180 * .8));
    assert.ok(Math.abs(runtime.aimParametersRuntime.normalizedPower - .64) < 1e-6);
    pointerUp(runtime, event(startX, 100 + 180 * .3));
    assert.equal(launchQueueCalls.length, 1);
    assert.ok(Math.abs(launchQueueCalls[0].normalizedPower - .09) < 1e-6, 'mouse red-dot final sample');
  }
  for (const [pointerType, threshold] of [['mouse', 4], ['touch', 8]]) {
    const runtime = createTestRuntime('billiards');
    runtime.aimRuntime.selectedPieceId = whitePieceMesh.name;
    testRefreshBilliardsPreview(runtime);
    runtime.state = 'charging';
    runtime.activePointerId = 42;
    runtime.activeCaptureElement = mockCanvas;
    runtime.gesture = { source: 'red-dot', startX, startY: 100, pointerType, maximumDistance: 0,
      candidatePieceId: whitePieceMesh.name, maxDragPixels: 180, mousePowerDistance: 180 };
    pointerUp(runtime, event(startX, 100 + threshold, 42, pointerType));
    assert.equal(launchQueueCalls.length, 0, `${pointerType} red-dot jitter`);
    const armed = createTestRuntime('billiards');
    armed.aimRuntime.selectedPieceId = whitePieceMesh.name;
    testRefreshBilliardsPreview(armed);
    armed.state = 'charging';
    armed.activePointerId = 43;
    armed.activeCaptureElement = mockCanvas;
    armed.gesture = { source: 'red-dot', startX, startY: 100, pointerType, maximumDistance: 0,
      candidatePieceId: whitePieceMesh.name, maxDragPixels: 180, mousePowerDistance: 180 };
    pointerMove(armed, event(startX, 100 + threshold + 1, 43, pointerType));
    pointerUp(armed, event(startX, 101, 43, pointerType));
    assert.equal(launchQueueCalls.length, 1, `${pointerType} red-dot armed pull back`);
    const releaseOnly = createTestRuntime('billiards');
    releaseOnly.aimRuntime.selectedPieceId = whitePieceMesh.name;
    testRefreshBilliardsPreview(releaseOnly);
    releaseOnly.state = 'charging';
    releaseOnly.activePointerId = 44;
    releaseOnly.activeCaptureElement = mockCanvas;
    releaseOnly.gesture = { source: 'red-dot', startX, startY: 100, pointerType, maximumDistance: 0,
      candidatePieceId: whitePieceMesh.name, maxDragPixels: 180, mousePowerDistance: 180 };
    pointerUp(releaseOnly, event(startX, 100 + threshold + 1, 44, pointerType));
    assert.equal(launchQueueCalls.length, 1, `${pointerType} red-dot release only movement`);
  }
  powerControls.resetMousePowerDistance();
  {
    const runtime=createTestRuntime('billiards');
    runtime.aimRuntime.selectedPieceId=whitePieceMesh.name;
    runtime.reachabilityFeedback={hidden:true,textContent:''};
    runtime.gesture={source:'red-dot',startX:50,startY:200,maxDragPixels:240,mousePowerDistance:180};
    runtime.cancelControl.hidden=false;
    runtime.cancelControl.getBoundingClientRect=()=>({left:100,right:300,top:480,bottom:550,width:200,height:70});
    input.testUpdateReachability(runtime,event(50,300));
    assert.equal(runtime.reachabilityFeedback.hidden,false,'a red-dot drag outside the dock column cannot use dock height');
    input.testUpdateReachability(runtime,event(200,300));
    assert.equal(runtime.reachabilityFeedback.hidden,true,'a valid dock column can extend the pull range');
  }
  console.log('itch power controls: precision mouse, linear touch, final classic/red-dot release, duplicate release, setting change passed');
} finally {
  await vite.close();
}
