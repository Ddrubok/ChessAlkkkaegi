import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Group, OrthographicCamera, Scene, Vector3, Vector4, WebGLRenderTarget } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createServer } from "vite";
import "./headless-browser-env.mjs";

const vite = await createServer({ root: fileURLToPath(new URL("../..", import.meta.url)), configFile: false, logLevel: "error", server: { middlewareMode: true } });
class TrackedTarget extends EventTarget {
  listeners = new Map();
  addEventListener(type, handler, options) { super.addEventListener(type, handler, options); if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(handler); }
  removeEventListener(type, handler, options) { super.removeEventListener(type, handler, options); this.listeners.get(type)?.delete(handler); }
  get listenerCount() { return [...this.listeners.values()].reduce((n, set) => n + set.size, 0); }
}
const frames = new Map(); let nextFrame = 0;
globalThis.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
globalThis.cancelAnimationFrame = id => frames.delete(id);
const tick = now => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(cb => cb(now)); };
globalThis.devicePixelRatio = 1;
const motion = Object.assign(new TrackedTarget(), { matches: false });
const mobileLayout = Object.assign(new TrackedTarget(), { matches: false });
globalThis.matchMedia = query => query === "(max-width: 780px)" ? mobileLayout : motion;
const resizeObservers = new Set();
globalThis.ResizeObserver = class {
  constructor(callback) { this.callback = callback; resizeObservers.add(this); }
  observe() {}
  disconnect() { resizeObservers.delete(this); }
};
const resize = () => [...resizeObservers].forEach(observer => observer.callback());
class Canvas extends TrackedTarget {
  width = 1; height = 1; visible = true; isConnected = true; capture = null; paints = 0;
  getBoundingClientRect() { return { width: this.visible ? 280 : 0, height: this.visible ? 310 : 0 }; }
  getContext() { return { createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData: data => { this.paints++; this.image = data; } }; }
  setPointerCapture(id) { this.capture = id; }
  hasPointerCapture(id) { return this.capture === id; }
  releasePointerCapture() { this.capture = null; }
}
function rendererDouble() {
  const renderer = {
    domElement: new TrackedTarget(), autoClear: false,
    target: null, viewport: new Vector4(3, 4, 800, 600), scissor: new Vector4(5, 6, 700, 500), scissorTest: true,
    face: 2, mip: 1, renderCount: 0, targets: new Set(),
    getRenderTarget() { return this.target; }, getActiveCubeFace() { return this.face; }, getActiveMipmapLevel() { return this.mip; },
    getViewport(out) { return out.copy(this.viewport); }, getScissor(out) { return out.copy(this.scissor); }, getScissorTest() { return this.scissorTest; },
    setRenderTarget(target, face = 0, mip = 0) { this.target = target; this.face = face; this.mip = mip; },
    setViewport(...args) { if (args[0] instanceof Vector4) this.viewport.copy(args[0]); else this.viewport.set(...args); },
    setScissor(value) { this.scissor.copy(value); }, setScissorTest(value) { this.scissorTest = value; },
    render(scene, camera) { this.renderCount++; this.scene = scene; this.camera = camera; this.targets.add(this.target); if (this.fail) throw new Error("injected render failure"); },
    readRenderTargetPixels(_target, _x, _y, width, height, pixels) {
      if (this.failRead) throw new Error("injected read failure");
      for (let y = 0; y < height; y++) pixels.fill(y % 256, y * width * 4, (y + 1) * width * 4);
    },
  };
  return renderer;
}
try {
  const { computePreviewFit, renderPreviewTarget, PiecePreviewRenderer } = await vite.ssrLoadModule("/src/piece-preview-renderer.ts");
  const { PieceUpgradeEffects } = await vite.ssrLoadModule("/src/piece-upgrade-effects.ts");
  const bytes = await readFile(new URL("../../public/assets/chess-pieces.glb", import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
  const geometries = new Map();
  gltf.scene.traverse(object => { if (object.isMesh && ["Pawn", "Knight", "Bishop", "Rook", "Queen", "King"].includes(object.name)) geometries.set(object.name, object.geometry); });
  assert.equal(geometries.size, 6);
  let sharedDisposals = 0;
  for (const [type, geometry] of geometries) {
    geometry.addEventListener("dispose", () => sharedDisposals++);
    const original = Array.from(geometry.attributes.position.array);
    for (const aspect of [280 / 310, 320 / 240, 1.8]) {
      const fit = computePreviewFit(geometry, aspect);
      const camera = new OrthographicCamera(-fit.halfHeight * aspect, fit.halfHeight * aspect, fit.halfHeight, -fit.halfHeight, 0.001, 1000);
      const depth = Math.max(fit.height, fit.radius) * 5;
      camera.position.set(0, fit.height * 0.5 * 1.025 + depth * 0.28, depth);
      camera.lookAt(0, fit.height * 0.5 * 1.025, 0); camera.updateMatrixWorld(true);
      const position = geometry.attributes.position;
      for (const scale of [1, 1.05]) for (let yaw = 0; yaw < Math.PI * 2; yaw += Math.PI / 4) {
        let maximum = 0;
        for (let i = 0; i < position.count; i++) {
          const point = new Vector3().fromBufferAttribute(position, i);
          point.sub(new Vector3(fit.center.x, fit.bottom, fit.center.z)).multiplyScalar(scale).applyAxisAngle(new Vector3(0, 1, 0), yaw).project(camera);
          maximum = Math.max(maximum, Math.abs(point.x), Math.abs(point.y));
        }
        assert.ok(maximum < 0.94, `${type} clipped / insufficient margin: ${maximum}`);
      }
    }
    assert.deepEqual(Array.from(geometry.attributes.position.array), original, "shared vertices remain unchanged");
  }
  const renderer = rendererDouble(); const target = new WebGLRenderTarget(8, 8); const originalTarget = new WebGLRenderTarget(16, 16);
  renderer.setRenderTarget(originalTarget, 2, 1);
  for (const failure of [null, "fail", "failRead"]) {
    renderer.fail = failure === "fail"; renderer.failRead = failure === "failRead";
    const call = () => renderPreviewTarget(renderer, new Scene(), new OrthographicCamera(), target, new Uint8Array(256));
    if (failure) assert.throws(call, /injected/); else call();
    assert.equal(renderer.target, originalTarget); assert.equal(renderer.face, 2); assert.equal(renderer.mip, 1);
    assert.deepEqual(renderer.viewport.toArray(), [3, 4, 800, 600]);
    assert.deepEqual(renderer.scissor.toArray(), [5, 6, 700, 500]);
    assert.equal(renderer.scissorTest, true); assert.equal(renderer.autoClear, false);
  }
  renderer.fail = renderer.failRead = false;
  const effects = new PieceUpgradeEffects(); effects.fit(1, 2);
  const model = new Group();
  const event = { changed: true, piece: "Pawn", stat: "force", direction: "increase", effectBefore: 0, effectAfter: 0.02, messageKey: null };
  effects.play(event, 0); effects.update(325, model, 1);
  assert.notEqual(model.rotation.z, 0);
  effects.play({ ...event, direction: "decrease" }, 0); effects.update(175, model, 1);
  assert.ok(model.rotation.z > 0);
  effects.play({ ...event, stat: "weight" }, 0); effects.update(325, model, 1);
  assert.ok(model.scale.y < 1 && model.scale.x > 1);
  effects.play({ ...event, stat: "size", effectAfter: 0.05 }, 0); effects.update(325, model, 1.05);
  assert.ok(model.scale.x > 1 && model.scale.x < 1.05);
  effects.update(700, model, 1.05); assert.equal(model.scale.x, 1.05); assert.equal(effects.group.visible, false);
  effects.dispose();

  for (let cycle = 0; cycle < 25; cycle++) {
    mobileLayout.matches = false;
    const canvas = new Canvas(); const available = [];
    const preview = new PiecePreviewRenderer(canvas, { renderer, assets: { geometries } }, value => available.push(value));
    for (const type of geometries.keys()) { preview.setPiece(type); tick(performance.now() + 100); assert.ok(canvas.paints > 0); }
    const desktopHalfHeight = renderer.camera.top;
    mobileLayout.matches = true; mobileLayout.dispatchEvent(new Event("change")); tick(performance.now() + 150);
    assert.ok(Math.abs(renderer.camera.top * 0.72 - desktopHalfHeight) < 1e-12, `mobile preview must render the model at 72% of desktop size: desktop=${desktopHalfHeight}, mobile=${renderer.camera.top}`);
    assert.equal(canvas.image.data[0], (canvas.height - 1) % 256, "read pixels are vertically flipped");
    assert.equal(available.at(-1), true);
    const ownedMaterials = new Set(); const ownedGeometries = new Set();
    renderer.scene.traverse(object => {
      if (object.isMesh) { ownedMaterials.add(object.material); if (![...geometries.values()].includes(object.geometry)) ownedGeometries.add(object.geometry); }
    });
    let disposedMaterials = 0; let disposedGeometries = 0;
    ownedMaterials.forEach(material => material.addEventListener("dispose", () => disposedMaterials++));
    ownedGeometries.forEach(geometry => geometry.addEventListener("dispose", () => disposedGeometries++));
    canvas.visible = false; tick(performance.now() + 200);
    assert.equal(frames.size, 0, "hidden preview stops scheduling frames");
    canvas.visible = true; resize(); tick(performance.now() + 300);
    assert.equal(frames.size, 1);
    motion.matches = true; motion.dispatchEvent(new Event("change")); tick(performance.now() + 400);
    assert.equal(frames.size, 0, "reduced motion renders on demand only");
    preview.play(event); tick(performance.now() + 500);
    assert.equal(frames.size, 0);
    assert.equal(renderer.scene.children.find(object => object.isGroup).children[0].rotation.z, 0);
    motion.matches = false;
    renderer.domElement.dispatchEvent(new Event("webglcontextlost"));
    assert.equal(available.at(-1), false); assert.equal(frames.size, 0);
    renderer.domElement.dispatchEvent(new Event("webglcontextrestored")); tick(performance.now() + 600);
    assert.equal(available.at(-1), true);
    preview.dispose(); preview.dispose();
    assert.equal(disposedMaterials, ownedMaterials.size);
    assert.equal(disposedGeometries, ownedGeometries.size);
    assert.equal(canvas.listenerCount, 0); assert.equal(renderer.domElement.listenerCount, 0); assert.equal(motion.listenerCount, 0); assert.equal(mobileLayout.listenerCount, 0);
    assert.equal(frames.size, 0); assert.equal(resizeObservers.size, 0);
    assert.equal(sharedDisposals, 0, "shared GLB geometry must survive preview disposal");
  }
  target.dispose(); originalTarget.dispose();
  console.log("PASS preview contracts: six real GLB geometries at 1.0/1.05 scale, mobile model size 72% of desktop, state restoration on render/read failure, effect transforms, 25 lifecycle cycles, reduced motion, context recovery");
  console.log("NOTE: renderer/DOM doubles validate contracts, not GPU rendering or visual browser quality.");
} finally { await vite.close(); }
