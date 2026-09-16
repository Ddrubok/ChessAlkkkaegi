import './headless-browser-env.mjs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { PerspectiveCamera, Mesh, SphereGeometry, MeshBasicMaterial, Raycaster, Vector2 } from 'three';

// Exercise the production pointer path without adding public test APIs.
const vite = await createServer({
  root: fileURLToPath(new URL('../..', import.meta.url)), configFile: false, logLevel: 'error',
  server: { middlewareMode: true, hmr: false },
  plugins: [{ name: 'selection-check', transform(code, id) {
    if (id.replaceAll('\\', '/').endsWith('/src/input.ts')) {
      return code + '\nexport { handleCanvasPointerDown as pointerDown, findTouchFallbackPiece as touchFallback, findSwapTargetPiece as swapTarget };';
    }
  } }],
});
try {
  const { pointerDown, touchFallback, swapTarget } = await vite.ssrLoadModule('/src/input.ts');
  const { hideAimOccluders, restoreHiddenPieceMeshes } = await vite.ssrLoadModule('/src/scene.ts');
  const { canSelectTurnPiece } = await vite.ssrLoadModule('/src/turn.ts');
  const camera = new PerspectiveCamera(45, 1, .1, 100);
  camera.position.set(0, 0, 5); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
  const makeMesh = (id, x, z, radius) => {
    const mesh = new Mesh(new SphereGeometry(radius, 24, 16), new MeshBasicMaterial());
    mesh.name = id; mesh.position.set(x, 0, z); mesh.updateMatrixWorld(true);
    return mesh;
  };
  const target = makeMesh('white-target', .35, 0, .2);
  const selected = makeMesh('white-selected', -.35, 0, .2);
  const occluder = makeMesh('occluder', 0, 1, .8);
  const pieceMeshes = new Map([target, selected, occluder].map(mesh => [mesh.name, mesh]));
  const bindings = new Map([...pieceMeshes.keys()].map(id => [id, {
    instance: { side: id.startsWith('white') ? 'white' : 'black' }, body: { translation: () => ({ y: 0 }) },
  }]));
  const physicsRuntime = { pieces: bindings };
  const turn = { phase: 'ready', currentSide: 'white', pendingRemovalIds: new Set(), physicsRuntime };
  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 400 }), setPointerCapture() {} };
  const scene = { camera, pieceMeshes, renderer: { domElement: canvas }, controls: { enabled: true } };
  const runtime = {
    sceneRuntime: scene, physicsRuntime, pointerNdc: new Vector2(), raycaster: new Raycaster(),
    selectablePieceIds: new Set(pieceMeshes.keys()), mode: 'billiards', kingSwapMode: false,
    strikeMode: false, cameraTransition: null, activePointerId: null, orbitTouchPointerIds: new Set(),
    aimRuntime: { selectedPieceId: selected.name }, aimParametersRuntime: { redDot: { visible: false }, currentSolution: null },
    policy: { isInputBlocked: () => false, isExternalAimActive: () => false, isCameraRotating: () => false,
      canSelectPiece: id => canSelectTurnPiece(turn, id) },
  };
  const point = target.position.clone().project(camera);
  const event = { clientX: (point.x + 1) * 200, clientY: (1 - point.y) * 200, pointerId: 1,
    pointerType: 'mouse', button: 0, preventDefault() {}, stopImmediatePropagation() {} };
  const pick = pointerType => {
    runtime.activePointerId = null; runtime.gesture = null; runtime.orbitTouchPointerIds.clear();
    pointerDown(runtime, { ...event, pointerType });
    return runtime.gesture?.candidatePieceId ?? null;
  };
  const hidden = new Set();
  hideAimOccluders(scene, selected.name, selected.position, hidden);
  assert.equal(occluder.visible, false, 'Production aim hiding must hide the occluder');
  for (const side of ['black', 'white']) {
    bindings.get(occluder.name).instance.side = side;
    for (const type of ['mouse', 'touch']) assert.equal(pick(type), target.name, `${side} hidden occluder, ${type}`);
  }
  const gap = { ...event, pointerType: 'touch', clientX: 201, clientY: 200 };
  assert.equal(touchFallback(runtime, gap), target.name, 'Touch proximity ignores hidden friendly');
  assert.equal(swapTarget(runtime, gap), target.name, 'King swap direct and proximity picks ignore hidden pieces');
  restoreHiddenPieceMeshes(scene, hidden);
  bindings.get(occluder.name).instance.side = 'black';
  assert.equal(pick('mouse'), null, 'Visible enemy must still block a mouse click through it');
  hideAimOccluders(scene, selected.name, selected.position, hidden);
  turn.phase = 'simulating';
  assert.equal(pick('mouse'), null, 'Moving turn remains unselectable');
  console.log('PASS selection: hidden friend/enemy, mouse/touch, touch fallback, king swap, visible occlusion and turn restriction');
} finally { await vite.close(); }

