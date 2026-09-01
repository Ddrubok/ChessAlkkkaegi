import { AmbientLight, Color, CylinderGeometry, DirectionalLight, Group, Mesh, MeshStandardMaterial, OrthographicCamera, Scene, SRGBColorSpace, Vector3, Vector4, WebGLRenderTarget, type BufferGeometry, type WebGLRenderer } from "three";
import type { ChessAssets } from "./assets";
import type { PieceType } from "./config";
import type { PieceStatMutationResult } from "./piece-stat-model";
import { PieceUpgradeEffects } from "./piece-upgrade-effects";

export interface PiecePreviewServices { renderer: WebGLRenderer; assets: ChessAssets }

const COARSE_POINTER_FIT_SCALE = 1.22;

/** 회전·5% 크기 강화까지 담는 보수적인 프레이밍. 공유 geometry는 변경하지 않는다. */
export function computePreviewFit(geometry: BufferGeometry, aspect: number, framingScale = 1) {
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const radius = Math.hypot(size.x, size.z) / 2;
  const pitch = Math.atan(0.28);
  const projectedHeight = size.y * Math.cos(pitch) + 2 * radius * Math.sin(pitch);
  const halfHeight = Math.max(projectedHeight / 2, radius / Math.max(aspect, 0.1)) * 1.12 * 1.05 * framingScale;
  return { center, bottom: box.min.y, height: size.y, radius, halfHeight };
}

/** 동일 렌더러를 잠깐 빌려 RT를 그린 뒤 모든 변경된 렌더 상태를 복원한다. */
export function renderPreviewTarget(renderer: WebGLRenderer, scene: Scene, camera: OrthographicCamera, target: WebGLRenderTarget, pixels: Uint8Array): void {
  const previousTarget = renderer.getRenderTarget();
  const previousFace = renderer.getActiveCubeFace();
  const previousMip = renderer.getActiveMipmapLevel();
  const viewport = renderer.getViewport(new Vector4());
  const scissor = renderer.getScissor(new Vector4());
  const scissorTest = renderer.getScissorTest();
  const autoClear = renderer.autoClear;
  try {
    renderer.setRenderTarget(target);
    renderer.setViewport(0, 0, target.width, target.height);
    renderer.setScissorTest(false);
    renderer.autoClear = true;
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, pixels);
  } finally {
    renderer.setRenderTarget(previousTarget, previousFace, previousMip);
    renderer.setViewport(viewport);
    renderer.setScissor(scissor);
    renderer.setScissorTest(scissorTest);
    renderer.autoClear = autoClear;
  }
}

export class PiecePreviewRenderer {
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera();
  private readonly rotation = new Group();
  private readonly model = new Group();
  private readonly material = new MeshStandardMaterial({ color: 0xf2dfbb, roughness: 0.34, metalness: 0.12 });
  private readonly platformGeometry = new CylinderGeometry(1, 1, 0.07, 48);
  private readonly platformMaterial = new MeshStandardMaterial({ color: 0x354359, roughness: 0.7, metalness: 0.2 });
  private readonly platform = new Mesh(this.platformGeometry, this.platformMaterial);
  private readonly effects = new PieceUpgradeEffects();
  private readonly target = new WebGLRenderTarget(1, 1, { depthBuffer: true });
  private readonly context: CanvasRenderingContext2D | null;
  private readonly resizeObserver: ResizeObserver;
  private readonly motion = matchMedia("(prefers-reduced-motion: reduce)");
  private readonly coarsePointer = matchMedia("(pointer: coarse)");
  private mesh: Mesh | null = null;
  private pixels = new Uint8Array(4);
  private imageData: ImageData | null = null;
  private frame = 0;
  private lastFrame = 0;
  private disposed = false;
  private lost = false;
  private dirty = true;
  private sizeScale = 1;
  private pointer: number | null = null;
  private pointerX = 0;
  private resumeAt = 0;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly services: PiecePreviewServices, private readonly onAvailability: (available: boolean) => void) {
    this.context = canvas.getContext("2d");
    this.target.texture.colorSpace = SRGBColorSpace;
    this.scene.background = new Color(0x101b2d);
    const key = new DirectionalLight(0xfff0d3, 3.5);
    key.position.set(3, 5, 4);
    const rim = new DirectionalLight(0x91baff, 2);
    rim.position.set(-3, 2, -3);
    this.rotation.add(this.model);
    this.scene.add(this.rotation, this.platform, this.effects.group, new AmbientLight(0xc7dbff, 1.3), key, rim);
    this.resizeObserver = new ResizeObserver(this.wake);
    this.resizeObserver.observe(canvas);
    canvas.addEventListener("pointerdown", this.pointerDown);
    canvas.addEventListener("pointermove", this.pointerMove);
    canvas.addEventListener("pointerup", this.pointerUp);
    canvas.addEventListener("pointercancel", this.pointerUp);
    canvas.addEventListener("lostpointercapture", this.pointerUp);
    document.addEventListener("visibilitychange", this.wake);
    this.motion.addEventListener("change", this.motionChanged);
    services.renderer.domElement.addEventListener("webglcontextlost", this.contextLost);
    services.renderer.domElement.addEventListener("webglcontextrestored", this.contextRestored);
  }
  setPiece(type: PieceType): void {
    const geometry = this.services.assets.geometries.get(type);
    if (!geometry) { this.onAvailability(false); return; }
    if (this.mesh?.geometry === geometry) return;
    this.model.clear();
    this.mesh = new Mesh(geometry, this.material);
    this.model.add(this.mesh);
    this.fitEffects();
    this.resetView();
  }
  setSize(fraction: number): void { this.sizeScale = 1 + fraction; this.wake(); }
  resetView(): void { this.rotation.rotation.y = -0.35; this.resumeAt = performance.now() + 2500; this.wake(); }
  play(result: PieceStatMutationResult): void {
    if (!this.motion.matches) this.effects.play(result, performance.now());
    this.wake();
  }
  private readonly motionChanged = () => { this.effects.clear(); this.wake(); };
  private readonly contextLost = () => { this.lost = true; cancelAnimationFrame(this.frame); this.frame = 0; this.onAvailability(false); };
  private readonly contextRestored = () => { this.lost = false; this.wake(); };
  private readonly pointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    this.pointer = event.pointerId; this.pointerX = event.clientX;
    this.canvas.setPointerCapture(event.pointerId);
  };
  private readonly pointerMove = (event: PointerEvent) => {
    if (event.pointerId !== this.pointer) return;
    this.rotation.rotation.y += (event.clientX - this.pointerX) * 0.012;
    this.pointerX = event.clientX; this.wake();
  };
  private readonly pointerUp = (event: PointerEvent) => {
    if (event.pointerId !== this.pointer) return;
    this.pointer = null; this.resumeAt = performance.now() + 2500;
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    this.wake();
  };
  private readonly wake = () => { this.dirty = true; if (!this.frame && !this.disposed && !this.lost) this.frame = requestAnimationFrame(this.draw); };
  private readonly draw = (now: number) => {
    this.frame = 0;
    if (this.disposed || this.lost || !this.context || !this.mesh || document.hidden) return;
    const bounds = this.canvas.getBoundingClientRect();
    if (!this.canvas.isConnected || bounds.width < 1 || bounds.height < 1) return;
    const moving = !this.motion.matches;
    if (!this.dirty && now - this.lastFrame < 1000 / 30) { if (moving) this.frame = requestAnimationFrame(this.draw); return; }
    const elapsed = Math.min((now - this.lastFrame) / 1000, 0.1);
    this.lastFrame = now; this.dirty = false;
    const ratio = Math.min(devicePixelRatio, 1.5, 512 / Math.max(bounds.width, bounds.height));
    const width = Math.max(1, Math.round(bounds.width * ratio));
    const height = Math.max(1, Math.round(bounds.height * ratio));
    if (this.target.width !== width || this.target.height !== height) {
      this.target.setSize(width, height); this.canvas.width = width; this.canvas.height = height;
      this.pixels = new Uint8Array(width * height * 4); this.imageData = this.context.createImageData(width, height);
    }
    const fit = computePreviewFit(
      this.mesh.geometry,
      width / height,
      this.coarsePointer.matches ? COARSE_POINTER_FIT_SCALE : 1,
    );
    this.mesh.position.set(-fit.center.x, -fit.bottom, -fit.center.z);
    this.platform.scale.set(fit.radius * 1.4, fit.height, fit.radius * 1.4);
    this.platform.position.y = -fit.height * 0.04;
    this.camera.top = fit.halfHeight; this.camera.bottom = -fit.halfHeight;
    this.camera.right = fit.halfHeight * width / height; this.camera.left = -this.camera.right;
    this.camera.near = 0.001; this.camera.far = fit.height * 30 + fit.radius * 30;
    const depth = Math.max(fit.height, fit.radius) * 5;
    this.camera.position.set(0, fit.height * 0.5 * 1.025 + depth * 0.28, depth);
    this.camera.lookAt(0, fit.height * 0.5 * 1.025, 0); this.camera.updateProjectionMatrix();
    if (moving && this.pointer === null && now > this.resumeAt) this.rotation.rotation.y += elapsed * 0.24;
    this.effects.update(now, this.model, this.sizeScale);
    try {
      renderPreviewTarget(this.services.renderer, this.scene, this.camera, this.target, this.pixels);
      if (this.imageData) {
        const stride = width * 4;
        for (let y = 0; y < height; y++) this.imageData.data.set(this.pixels.subarray((height - y - 1) * stride, (height - y) * stride), y * stride);
        this.context.putImageData(this.imageData, 0, 0);
      }
      this.onAvailability(true);
    } catch (error) {
      console.warn("Piece preview render failed", error);
      this.onAvailability(false); this.lost = true; return;
    }
    if (moving) this.frame = requestAnimationFrame(this.draw);
  };
  fitEffects(): void {
    if (!this.mesh) return;
    const fit = computePreviewFit(this.mesh.geometry, 1);
    this.effects.fit(fit.radius, fit.height);
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; cancelAnimationFrame(this.frame); this.frame = 0;
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener("pointerdown", this.pointerDown);
    this.canvas.removeEventListener("pointermove", this.pointerMove);
    this.canvas.removeEventListener("pointerup", this.pointerUp);
    this.canvas.removeEventListener("pointercancel", this.pointerUp);
    this.canvas.removeEventListener("lostpointercapture", this.pointerUp);
    if (this.pointer !== null && this.canvas.hasPointerCapture(this.pointer)) this.canvas.releasePointerCapture(this.pointer);
    document.removeEventListener("visibilitychange", this.wake);
    this.motion.removeEventListener("change", this.motionChanged);
    this.services.renderer.domElement.removeEventListener("webglcontextlost", this.contextLost);
    this.services.renderer.domElement.removeEventListener("webglcontextrestored", this.contextRestored);
    this.target.dispose(); this.effects.dispose(); this.material.dispose();
    this.platformGeometry.dispose(); this.platformMaterial.dispose(); this.scene.clear();
    this.mesh = null; this.pixels = new Uint8Array(0); this.imageData = null;
  }
}
