import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { BoxGeometry, Vector4 } from "three";
import { createServer } from "vite";
import "./headless-browser-env.mjs";

const frames = new Map(); let nextFrame = 0;
globalThis.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
globalThis.cancelAnimationFrame = id => frames.delete(id);
globalThis.devicePixelRatio = 1;
const tick = now => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(now)); };
const media = Object.assign(new EventTarget(), { matches: false });
globalThis.matchMedia = () => media;
globalThis.ResizeObserver = class { observe() {} disconnect() {} };

class Canvas extends EventTarget {
  width = 1; height = 1; isConnected = true; capture = null; paints = 0;
  getBoundingClientRect() { return { width: 80, height: 80 }; }
  getContext() { return { createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }), putImageData: () => { this.paints++; } }; }
  setPointerCapture(id) { this.capture = id; }
  hasPointerCapture(id) { return this.capture === id; }
  releasePointerCapture() { this.capture = null; }
}
const renderer = {
  domElement: new EventTarget(), autoClear: false, target: null, viewport: new Vector4(), scissor: new Vector4(), scissorTest: false, reads: 0,
  getRenderTarget() { return this.target; }, getActiveCubeFace() { return 0; }, getActiveMipmapLevel() { return 0; },
  getViewport(out) { return out.copy(this.viewport); }, getScissor(out) { return out.copy(this.scissor); }, getScissorTest() { return this.scissorTest; }, getPixelRatio() { return 1; },
  setRenderTarget(target) { this.target = target; }, setViewport(...args) { if (args[0] instanceof Vector4) this.viewport.copy(args[0]); else this.viewport.set(...args); },
  setScissor(value) { this.scissor.copy(value); }, setScissorTest(value) { this.scissorTest = value; }, render() {},
  readRenderTargetPixels() { this.reads++; },
};
const vite = await createServer({ root: fileURLToPath(new URL("../..", import.meta.url)), configFile: false, logLevel: "error", server: { middlewareMode: true } });
try {
  const { PiecePreviewRenderer } = await vite.ssrLoadModule("/src/piece-preview-renderer.ts");
  const canvas = new Canvas();
  const geometry = new BoxGeometry(1, 2, 1);
  const preview = new PiecePreviewRenderer(canvas, { renderer, assets: { geometries: new Map([["Pawn", geometry]]) } }, () => {});
  preview.setPiece("Pawn");
  const start = performance.now();
  tick(start + 50);
  assert.equal(renderer.reads, 1, "initial piece renders");
  for (let time = 100; time < 2400; time += 50) tick(start + time);
  assert.equal(renderer.reads, 1, "unchanged pause skips synchronous reads");
  globalThis.devicePixelRatio = 1.5;
  tick(start + 2400);
  assert.equal(renderer.reads, 2, "DPR change repaints a resized canvas even during rotation pause");
  assert.equal(canvas.width, 120);
  tick(start + 2550);
  assert.equal(renderer.reads, 3, "automatic rotation resumes after pause");
  tick(start + 2566); tick(start + 2582);
  assert.equal(renderer.reads, 3, "automatic rotation retains the 30 fps limit");
  tick(start + 2598);
  assert.equal(renderer.reads, 4);
  canvas.dispatchEvent(Object.assign(new Event("pointerdown"), { button: 0, pointerId: 7, clientX: 10 }));
  canvas.dispatchEvent(Object.assign(new Event("pointermove"), { pointerId: 7, clientX: 30 }));
  tick(start + 2600);
  assert.equal(renderer.reads, 5, "drag paints immediately, independent of auto rotation interval");
  canvas.dispatchEvent(Object.assign(new Event("pointerup"), { pointerId: 7 }));
  tick(start + 2610);
  assert.equal(renderer.reads, 6, "release paints the current view");
  preview.setSize(0.05); tick(start + 2620);
  assert.equal(renderer.reads, 7, "size change paints immediately");
  media.matches = true; media.dispatchEvent(new Event("change")); tick(start + 2720);
  assert.equal(frames.size, 0, "reduced motion stays on demand");
  preview.dispose(); geometry.dispose();
  assert.equal(frames.size, 0, "dispose cancels animation");
  console.log("PASS preview performance contract: paused reads skipped, auto rotation cadence, immediate drag/size updates, reduced motion, disposal");
} finally { await vite.close(); }
