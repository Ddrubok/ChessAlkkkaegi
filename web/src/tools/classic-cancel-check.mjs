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
        return code + '\nexport { handleCanvasPointerDown as pointerDown, handleCanvasPointerMove as pointerMove, handleCanvasPointerUp as pointerUp, cancelInteraction as internalCancel, createStrategies as testCreateStrategies };';
      }
    }
  }],
});

try {
  const {
    pointerDown,
    pointerMove,
    pointerUp,
    internalCancel,
    isPointerOverElement,
    testCreateStrategies,
    cancelInputInteraction,
  } = await vite.ssrLoadModule('/src/input.ts');

  const { createAimRuntime } = await vite.ssrLoadModule('/src/aim.ts');
  const { createAimParametersRuntime } = await vite.ssrLoadModule('/src/aimparams.ts');
  const { createTuningRuntime } = await vite.ssrLoadModule('/src/tuning.ts');
  const { inputCancelCopy } = await vite.ssrLoadModule('/src/input-cancel-copy.ts');

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
  const mockCanvas = {
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
      isPointerOverCancel: false,
    };
    return runtime;
  };

  // 3. Test isPointerOverElement Helper
  console.log('[검증 3] isPointerOverElement 경계 및 판정 테스트');
  assert.equal(isPointerOverElement(mockCancelControl, 350, 30), false, 'hidden control must return false');
  mockCancelControl.hidden = false;
  assert.equal(isPointerOverElement(mockCancelControl, 350, 30), true, 'inside coordinates return true');
  assert.equal(isPointerOverElement(mockCancelControl, 300, 10), true, 'top-left boundary returns true');
  assert.equal(isPointerOverElement(mockCancelControl, 390, 60), true, 'bottom-right boundary returns true');
  assert.equal(isPointerOverElement(mockCancelControl, 299, 30), false, 'outside left returns false');
  assert.equal(isPointerOverElement(mockCancelControl, 391, 30), false, 'outside right returns false');
  assert.equal(isPointerOverElement(mockCancelControl, 350, 9), false, 'outside top returns false');
  assert.equal(isPointerOverElement(mockCancelControl, 350, 61), false, 'outside bottom returns false');
  mockCancelControl.hidden = true;
  console.log('  -> isPointerOverElement 경계값 및 히든 상태 판정 통과');

  // 4. Test Classic Aiming -> Drag to Cancel Zone -> PointerUp Cancellation
  console.log('[검증 4] 클래식 조준 중 취소 영역 드래그 릴리스 취소 (미발사)');
  {
    const runtime = createTestRuntime('classic');
    const point = whitePieceMesh.position.clone().project(camera);
    const canvasX = (point.x + 1) * 200;
    const canvasY = (1 - point.y) * 200;

    // Start aim by pointerdown on piece
    pointerDown(runtime, {
      clientX: canvasX, clientY: canvasY, pointerId: 1, pointerType: 'touch', button: 0,
      preventDefault() {}, stopImmediatePropagation() {},
    });
    assert.equal(runtime.state, 'aiming', 'State must be aiming');
    assert.equal(runtime.cancelControl.hidden, false, 'Cancel control must be visible during aim');
    assert.equal(capturedPointerIds.has(1), true, 'Pointer capture must be active');

    // Drag over cancel zone
    pointerMove(runtime, {
      clientX: 350, clientY: 30, pointerId: 1,
      preventDefault() {},
    });
    assert.equal(runtime.isPointerOverCancel, true, 'isPointerOverCancel must be true');
    assert.equal(mockCancelControl.classList.contains('is-hovered'), true, 'is-hovered class must be added');

    // Release over cancel zone
    pointerUp(runtime, {
      clientX: 350, clientY: 30, pointerId: 1, pointerType: 'touch',
      preventDefault() {},
    });

    assert.equal(launchQueueCalls.length, 0, 'Launch MUST NOT be queued/fired on cancel');
    assert.equal(runtime.state, 'selected-preview', 'State must return to selected-preview when selection is preserved');
    assert.equal(runtime.cancelControl.hidden, true, 'Cancel control must be hidden after cancel');
    assert.equal(capturedPointerIds.has(1), false, 'Pointer capture must be released');
    console.log('  -> 취소 영역 릴리스 취소 정상 작동 (발사 0회, 캡처 해제 완료)');
  }

  // 5. Test Desktop Right-Click Cancellation During Aim
  console.log('[검증 5] 데스크톱 우클릭(Secondary Mouse Down) 조준 취소');
  {
    const runtime = createTestRuntime('classic');
    const point = whitePieceMesh.position.clone().project(camera);
    const canvasX = (point.x + 1) * 200;
    const canvasY = (1 - point.y) * 200;

    // Start aim with mouse left button
    pointerDown(runtime, {
      clientX: canvasX, clientY: canvasY, pointerId: 1, pointerType: 'mouse', button: 0,
      preventDefault() {}, stopImmediatePropagation() {},
    });
    assert.equal(runtime.state, 'aiming', 'Mouse aim active');
    assert.equal(runtime.cancelControl.hidden, false, 'Cancel control visible');

    // Right-click down event during active aim
    pointerDown(runtime, {
      clientX: 250, clientY: 220, pointerId: 1, pointerType: 'mouse', button: 2,
      preventDefault() {}, stopImmediatePropagation() {},
    });

    assert.equal(launchQueueCalls.length, 0, 'No launch committed');
    assert.equal(runtime.state, 'selected-preview', 'Aiming cancelled by right click');
    assert.equal(runtime.cancelControl.hidden, true, 'Cancel control hidden');
    console.log('  -> 데스크톱 마우스 우클릭 즉시 취소 확인');
  }

  // 6. Test Mobile Multi-Touch / Second Touch Cancellation
  console.log('[검증 6] 모바일 드래그 중 두 번째 손가락 터치(멀티터치) 조준 취소');
  {
    const runtime = createTestRuntime('classic');
    const point = whitePieceMesh.position.clone().project(camera);
    const canvasX = (point.x + 1) * 200;
    const canvasY = (1 - point.y) * 200;

    // First finger down and aiming
    pointerDown(runtime, {
      clientX: canvasX, clientY: canvasY, pointerId: 10, pointerType: 'touch', button: 0,
      preventDefault() {}, stopImmediatePropagation() {},
    });
    assert.equal(runtime.state, 'aiming', 'First touch aiming');
    assert.equal(runtime.activePointerId, 10);

    // Second finger touches screen
    pointerDown(runtime, {
      clientX: 100, clientY: 100, pointerId: 11, pointerType: 'touch', button: 0,
      preventDefault() {}, stopImmediatePropagation() {},
    });

    assert.equal(launchQueueCalls.length, 0, 'No launch committed');
    assert.equal(runtime.state, 'selected-preview', 'Aiming cancelled by second touch');
    assert.equal(runtime.cancelControl.hidden, true, 'Cancel control hidden');
    assert.equal(capturedPointerIds.has(10), false, 'First pointer capture released');
    console.log('  -> 두 번째 손가락 터치 감지 시 즉시 안전 취소 확인');
  }

  // 7. Test Explicit cancelInputInteraction (Turn change / Mode change / Menu open)
  console.log('[검증 7] 외부 cancelInputInteraction 호출 (턴 전환 / 모드 변경 / 메뉴 오픈)');
  {
    const runtime = createTestRuntime('classic');
    const point = whitePieceMesh.position.clone().project(camera);
    const canvasX = (point.x + 1) * 200;
    const canvasY = (1 - point.y) * 200;

    pointerDown(runtime, {
      clientX: canvasX, clientY: canvasY, pointerId: 5, pointerType: 'touch', button: 0,
      preventDefault() {}, stopImmediatePropagation() {},
    });
    assert.equal(runtime.state, 'aiming');

    // External cancellation triggered
    cancelInputInteraction(runtime, true);

    assert.equal(runtime.state, 'idle');
    assert.equal(runtime.cancelControl.hidden, true);
    assert.equal(runtime.activePointerId, null);
    assert.equal(capturedPointerIds.has(5), false);
    assert.equal(launchQueueCalls.length, 0);
    console.log('  -> 외부 cancelInputInteraction 시 상태 및 포인터 캡처 완전 초기화 확인');
  }

  // 8. Normal Release (No Cancel) Commits Launch
  console.log('[검증 8] 일반 영역 릴리스 시 정상 발사 커밋 확인');
  {
    const runtime = createTestRuntime('classic');
    const point = whitePieceMesh.position.clone().project(camera);
    const canvasX = (point.x + 1) * 200;
    const canvasY = (1 - point.y) * 200;

    pointerDown(runtime, {
      clientX: canvasX, clientY: canvasY, pointerId: 7, pointerType: 'mouse', button: 0,
      preventDefault() {}, stopImmediatePropagation() {},
    });
    assert.equal(runtime.state, 'aiming');

    pointerMove(runtime, {
      clientX: canvasX + 40, clientY: canvasY + 40, pointerId: 7,
      preventDefault() {},
    });
    assert.equal(runtime.isPointerOverCancel, false);

    pointerUp(runtime, {
      clientX: canvasX + 40, clientY: canvasY + 40, pointerId: 7, pointerType: 'mouse',
      preventDefault() {},
    });

    assert.equal(launchQueueCalls.length, 1, 'Normal release must commit exactly 1 launch');
    assert.equal(launchQueueCalls[0].pieceId, 'white-pawn-a2');
    assert.equal(runtime.cancelControl.hidden, true, 'Cancel control hidden on launch');
    console.log('  -> 일반 조준 후 정상 릴리스 시 1회 발사 커밋 정상 동작');
  }

  console.log('\n========================================');
  console.log('PASS: Classic Firing Cancel UX Headless Verification Completed Successfully!');
  console.log('========================================');
} finally {
  await vite.close();
}
