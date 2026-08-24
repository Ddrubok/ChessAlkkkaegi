import {
  AmbientLight,
  Box3,
  BufferGeometry,
  Color,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  OrthographicCamera,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { isCoarsePointerEnvironment } from "./input-capability";

export interface StrikePanelProjection {
  // 패널 정중앙에 놓이는 선택 말의 월드 AABB 중심이다.
  center: Vector3;
  // 패널 오른쪽을 현재 카메라의 수평 오른쪽과 일치시키는 월드 축이다.
  cameraRight: Vector3;
  // 패널 위쪽을 실제 보드의 위쪽과 일치시키는 월드 축이다.
  worldUp: Vector3;
  // 카메라 쪽에서 말 표면으로 진행하는 정규화된 수평 광선 방향이다.
  viewDirection: Vector3;
  // 정규화 패널 X 좌표 1이 나타내는 월드 반폭이다.
  halfWidth: number;
  // 정규화 패널 Y 좌표 1이 나타내는 월드 반높이다.
  halfHeight: number;
  // 모든 표면보다 카메라 쪽에서 광선을 시작하게 하는 월드 여유 거리다.
  rayMargin: number;
}

export interface StrikePointPanelRuntime {
  // 게임 캔버스 위에 배치되는 전체 패널 요소다.
  root: HTMLElement;
  // 오프스크린 렌더 결과를 표시하고 포인터 좌표를 받는 2D 캔버스다.
  canvas: HTMLCanvasElement;
  // 현재 기본 또는 사용자 타점을 패널 위에 표시하는 표식이다.
  marker: HTMLElement;
  // 사용자 override를 지우고 기본 타점으로 복귀시키는 버튼이다.
  resetButton: HTMLButtonElement;
  // GPU 픽셀을 상하 반전해 표시하는 2D 컨텍스트다.
  context: CanvasRenderingContext2D;
  // 메인 WebGL 컨텍스트를 공유해 두 번째 컨텍스트 없이 그리는 렌더 타깃이다.
  renderTarget: WebGLRenderTarget;
  // 선택 말 하나와 중립 조명만 담는 패널 전용 씬이다.
  previewScene: Scene;
  // 현재 카메라 수평 방향과 같은 정면을 만드는 직교 카메라다.
  previewCamera: OrthographicCamera;
  // 선택 말의 geometry와 월드 변환을 복사해 그리는 중립 재질 메시다.
  previewMesh: Mesh;
  // 정면 광원을 선택 말 중심으로 향하게 하는 조명이다.
  previewLight: DirectionalLight;
  // 렌더 타깃에서 읽은 원본 RGBA 픽셀 버퍼다.
  pixels: Uint8Array;
  // 브라우저 캔버스에 쓸 상하 반전 이미지 버퍼다.
  imageData: ImageData;
  // 현재 패널 CSS·렌더 해상도에 대응하는 정사각 픽셀 크기다.
  pixelSize: number;
  // 마지막으로 패널에 그린 말 id다.
  selectedPieceId: string | null;
  // 타점선택 전환으로 다시 열릴 때 보존 화면 대신 명시적으로 재렌더할 이전 표시 상태다.
  wasVisible: boolean;
  // 마지막 렌더가 사용한 카메라 수평 방위다.
  renderedAzimuth: number | null;
  // 카메라 회전 렌더를 제한하는 마지막 실제 시각이다.
  lastRenderedAt: number;
  // 패널 좌표와 월드 표면을 왕복 변환하는 마지막 투영 계약이다.
  projection: StrikePanelProjection | null;
}

// 실루엣 바로 밖의 클릭을 작은 화면에서도 보정할 정규화 패널 반경이다.
const STRIKE_PANEL_SNAP_TOLERANCE = 0.06;

// 카메라 방위가 이 각도 이상 바뀔 때만 패널 정면을 다시 그린다.
const STRIKE_PANEL_AZIMUTH_THRESHOLD_RADIANS =
  (1.5 * Math.PI) / 180;

// 카메라 공전 중 동기 픽셀 읽기가 매 프레임 실행되지 않게 하는 실제 시간 간격이다.
const STRIKE_PANEL_RENDER_INTERVAL_MS = 100;

// 일반 화면에서 11rem 패널을 선명하게 표시할 내부 렌더 해상도다.
const STRIKE_PANEL_DESKTOP_PIXELS = 256;

// coarse pointer 화면에서 더 크게 보이는 패널의 내부 렌더 해상도다.
const STRIKE_PANEL_COARSE_PIXELS = 320;

/**
 * 정규화 패널 좌표를 카메라 쪽 직교 광선으로 바꿔 선택 말의 월드 표면점을 찾는다.
 */
export function pickStrikePanelWorldPoint(
  mesh: Mesh,
  projection: StrikePanelProjection,
  u: number,
  v: number,
  snapTolerance = STRIKE_PANEL_SNAP_TOLERANCE,
): Vector3 | null {
  mesh.updateWorldMatrix(true, false);
  const raycaster = new Raycaster();
  const directions = 16;
  const samples: { u: number; v: number; distanceSquared: number }[] = [
    { u, v, distanceSquared: 0 },
  ];
  if (snapTolerance > 0) {
    for (const ratio of [0.5, 1]) {
      const radius = snapTolerance * ratio;
      for (let index = 0; index < directions; index += 1) {
        const angle = (index / directions) * Math.PI * 2;
        samples.push({
          u: u + Math.cos(angle) * radius,
          v: v + Math.sin(angle) * radius,
          distanceSquared: radius * radius,
        });
      }
    }
  }
  samples.sort(
    (first, second) =>
      first.distanceSquared - second.distanceSquared,
  );
  for (const sample of samples) {
    const origin = projection.center
      .clone()
      .addScaledVector(
        projection.cameraRight,
        sample.u * projection.halfWidth,
      )
      .addScaledVector(
        projection.worldUp,
        sample.v * projection.halfHeight,
      )
      .addScaledVector(
        projection.viewDirection,
        -projection.rayMargin,
      );
    raycaster.set(origin, projection.viewDirection);
    const hit = raycaster.intersectObject(mesh, false)[0];
    if (hit !== undefined) {
      return hit.point.clone();
    }
  }
  return null;
}

/**
 * 월드 타점을 마지막 패널 투영의 -1~1 좌표로 되돌린다.
 */
export function projectStrikePointToPanel(
  point: Vector3,
  projection: StrikePanelProjection,
): { u: number; v: number } {
  const offset = point.clone().sub(projection.center);
  return {
    u:
      offset.dot(projection.cameraRight) /
      projection.halfWidth,
    v: offset.dot(projection.worldUp) / projection.halfHeight,
  };
}

/**
 * 실제 메시 모서리를 현재 카메라 수평축에 투영해 직교 카메라와 타점 광선의 공통 범위를 만든다.
 */
function computeStrikePanelProjection(
  mesh: Mesh,
  viewDirection: Vector3,
): StrikePanelProjection {
  if (mesh.geometry.boundingBox === null) {
    mesh.geometry.computeBoundingBox();
  }
  const localBounds = mesh.geometry.boundingBox;
  if (localBounds === null) {
    throw new Error(`${mesh.name} 타점 패널용 AABB가 없습니다.`);
  }
  mesh.updateWorldMatrix(true, false);
  const worldUp = new Vector3(0, 1, 0);
  const cameraRight = viewDirection
    .clone()
    .cross(worldUp)
    .normalize();
  const corners: Vector3[] = [];
  for (const x of [localBounds.min.x, localBounds.max.x]) {
    for (const y of [localBounds.min.y, localBounds.max.y]) {
      for (const z of [localBounds.min.z, localBounds.max.z]) {
        corners.push(
          new Vector3(x, y, z).applyMatrix4(mesh.matrixWorld),
        );
      }
    }
  }
  const center = new Box3().setFromPoints(corners).getCenter(
    new Vector3(),
  );
  let halfWidth = 0;
  let halfHeight = 0;
  let halfDepth = 0;
  for (const corner of corners) {
    const offset = corner.clone().sub(center);
    halfWidth = Math.max(
      halfWidth,
      Math.abs(offset.dot(cameraRight)),
    );
    halfHeight = Math.max(halfHeight, Math.abs(offset.y));
    halfDepth = Math.max(
      halfDepth,
      Math.abs(offset.dot(viewDirection)),
    );
  }
  // 정사각 패널에서 X·Y가 같은 월드 배율을 써 말의 실제 종횡비가 늘어나지 않게 한다.
  const viewHalfExtent = Math.max(
    Math.max(halfWidth, halfHeight) * 1.12,
    1e-4,
  );
  return {
    center,
    cameraRight,
    worldUp,
    viewDirection: viewDirection.clone(),
    halfWidth: viewHalfExtent,
    halfHeight: viewHalfExtent,
    rayMargin: Math.max(halfDepth + 0.08, 0.1),
  };
}

/**
 * 패널 DOM과 메인 렌더러가 사용할 오프스크린 씬·버퍼를 한 번 만든다.
 */
export function createStrikePointPanel(
  container: HTMLElement,
): StrikePointPanelRuntime {
  const root = document.createElement("section");
  root.className = "strike-point-panel";
  root.hidden = true;
  root.setAttribute("aria-label", "확대 타점 선택");

  const heading = document.createElement("strong");
  heading.textContent = "타점 선택";

  const viewport = document.createElement("div");
  viewport.className = "strike-point-panel-viewport";
  const canvas = document.createElement("canvas");
  canvas.className = "strike-point-panel-canvas";
  canvas.setAttribute(
    "aria-label",
    "선택한 말의 확대 정면 타점",
  );
  const marker = document.createElement("span");
  marker.className = "strike-point-panel-marker";
  marker.hidden = true;
  viewport.append(canvas, marker);

  const resetButton = document.createElement("button");
  resetButton.type = "button";
  resetButton.textContent = "타점 초기화";
  root.append(heading, viewport, resetButton);
  container.append(root);

  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error("타점 패널 2D 캔버스를 만들지 못했습니다.");
  }
  const coarse = isCoarsePointerEnvironment();
  const pixelSize = coarse
    ? STRIKE_PANEL_COARSE_PIXELS
    : STRIKE_PANEL_DESKTOP_PIXELS;
  root.classList.toggle("is-coarse", coarse);
  canvas.width = pixelSize;
  canvas.height = pixelSize;

  const renderTarget = new WebGLRenderTarget(pixelSize, pixelSize);
  renderTarget.texture.colorSpace = SRGBColorSpace;
  const previewScene = new Scene();
  previewScene.background = new Color(0x111820);
  previewScene.add(new AmbientLight(0xffffff, 1.7));
  const previewLight = new DirectionalLight(0xffffff, 3.2);
  previewScene.add(previewLight, previewLight.target);
  const previewMesh = new Mesh(
    new BufferGeometry(),
    new MeshStandardMaterial({
      color: 0xd9d4c7,
      roughness: 0.65,
      metalness: 0,
    }),
  );
  previewScene.add(previewMesh);
  const previewCamera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 10);

  return {
    root,
    canvas,
    marker,
    resetButton,
    context,
    renderTarget,
    previewScene,
    previewCamera,
    previewMesh,
    previewLight,
    pixels: new Uint8Array(pixelSize * pixelSize * 4),
    imageData: context.createImageData(pixelSize, pixelSize),
    pixelSize,
    selectedPieceId: null,
    wasVisible: false,
    renderedAzimuth: null,
    lastRenderedAt: Number.NEGATIVE_INFINITY,
    projection: null,
  };
}

/**
 * 렌더 타깃 RGBA의 아래위 행을 뒤집어 전용 2D 캔버스에 복사한다.
 */
function copyRenderTargetToCanvas(
  runtime: StrikePointPanelRuntime,
  renderer: WebGLRenderer,
): void {
  renderer.readRenderTargetPixels(
    runtime.renderTarget,
    0,
    0,
    runtime.pixelSize,
    runtime.pixelSize,
    runtime.pixels,
  );
  const rowBytes = runtime.pixelSize * 4;
  for (let y = 0; y < runtime.pixelSize; y += 1) {
    const sourceStart =
      (runtime.pixelSize - 1 - y) * rowBytes;
    const targetStart = y * rowBytes;
    runtime.imageData.data.set(
      runtime.pixels.subarray(
        sourceStart,
        sourceStart + rowBytes,
      ),
      targetStart,
    );
  }
  runtime.context.putImageData(runtime.imageData, 0, 0);
}

/**
 * 선택 말과 현재 카메라 방위가 바뀐 경우에만 기존 WebGL 렌더러로 확대 정면을 다시 그린다.
 */
export function updateStrikePointPanel(
  runtime: StrikePointPanelRuntime,
  renderer: WebGLRenderer,
  mainCameraDirection: Vector3,
  selectedPieceId: string | null,
  selectedMesh: Mesh | null,
  visible: boolean,
  effectiveStrikePoint: Vector3 | null,
  now: number,
): void {
  const becameVisible = visible && !runtime.wasVisible;
  runtime.wasVisible = visible;
  runtime.root.hidden = !visible;
  if (!visible || selectedPieceId === null || selectedMesh === null) {
    runtime.marker.hidden = true;
    if (selectedPieceId === null) {
      // 판 재생성 뒤 같은 id를 다시 골라도 새 메시 배율·자세를 반드시 다시 그리게 한다.
      runtime.selectedPieceId = null;
      runtime.projection = null;
    }
    return;
  }
  const coarse = isCoarsePointerEnvironment();
  runtime.root.classList.toggle("is-coarse", coarse);
  const viewDirection = mainCameraDirection.clone();
  viewDirection.y = 0;
  if (viewDirection.lengthSq() < 1e-12) {
    runtime.marker.hidden = true;
    return;
  }
  viewDirection.normalize();
  const azimuth = Math.atan2(viewDirection.x, viewDirection.z);
  const rawDelta =
    runtime.renderedAzimuth === null
      ? Number.POSITIVE_INFINITY
      : Math.abs(azimuth - runtime.renderedAzimuth);
  const azimuthDelta = Math.min(
    rawDelta,
    Math.PI * 2 - Math.min(rawDelta, Math.PI * 2),
  );
  const selectionChanged =
    runtime.selectedPieceId !== selectedPieceId ||
    runtime.previewMesh.geometry !== selectedMesh.geometry;
  const cameraChanged =
    azimuthDelta >= STRIKE_PANEL_AZIMUTH_THRESHOLD_RADIANS;
  if (
    selectionChanged ||
    becameVisible ||
    (cameraChanged &&
      now - runtime.lastRenderedAt >=
        STRIKE_PANEL_RENDER_INTERVAL_MS)
  ) {
    const projection = computeStrikePanelProjection(
      selectedMesh,
      viewDirection,
    );
    runtime.projection = projection;
    runtime.selectedPieceId = selectedPieceId;
    runtime.renderedAzimuth = azimuth;
    runtime.lastRenderedAt = now;

    runtime.previewMesh.geometry = selectedMesh.geometry;
    selectedMesh.matrixWorld.decompose(
      runtime.previewMesh.position,
      runtime.previewMesh.quaternion,
      runtime.previewMesh.scale,
    );
    runtime.previewMesh.updateMatrixWorld(true);

    const camera = runtime.previewCamera;
    camera.left = -projection.halfWidth;
    camera.right = projection.halfWidth;
    camera.top = projection.halfHeight;
    camera.bottom = -projection.halfHeight;
    camera.near = 0.01;
    camera.far = projection.rayMargin * 3 + 1;
    camera.up.copy(projection.worldUp);
    camera.position
      .copy(projection.center)
      .addScaledVector(
        projection.viewDirection,
        -projection.rayMargin * 2,
      );
    camera.lookAt(projection.center);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    runtime.previewLight.position
      .copy(camera.position)
      .addScaledVector(projection.cameraRight, 0.4)
      .addScaledVector(projection.worldUp, 0.8);
    runtime.previewLight.target.position.copy(projection.center);
    runtime.previewLight.updateMatrixWorld(true);
    runtime.previewLight.target.updateMatrixWorld(true);

    const previousTarget = renderer.getRenderTarget();
    try {
      renderer.setRenderTarget(runtime.renderTarget);
      renderer.clear();
      renderer.render(runtime.previewScene, camera);
      copyRenderTargetToCanvas(runtime, renderer);
    } finally {
      // 패널 렌더가 실패해도 다음 메인 장면이 오프스크린에 갇히지 않게 원래 타깃을 복원한다.
      renderer.setRenderTarget(previousTarget);
    }
  }

  const projection = runtime.projection;
  if (projection === null || effectiveStrikePoint === null) {
    runtime.marker.hidden = true;
    return;
  }
  const markerPoint = projectStrikePointToPanel(
    effectiveStrikePoint,
    projection,
  );
  runtime.marker.hidden =
    Math.abs(markerPoint.u) > 1.1 ||
    Math.abs(markerPoint.v) > 1.1;
  runtime.marker.style.left = `${((markerPoint.u + 1) / 2) * 100}%`;
  runtime.marker.style.top = `${((1 - markerPoint.v) / 2) * 100}%`;
}

/**
 * 패널 포인터의 CSS 좌표를 마지막 직교 투영의 정규화 좌표로 바꿔 월드 표면점을 반환한다.
 */
export function pickStrikePointFromPanel(
  runtime: StrikePointPanelRuntime,
  mesh: Mesh,
  clientX: number,
  clientY: number,
): Vector3 | null {
  const projection = runtime.projection;
  if (projection === null) {
    return null;
  }
  const rect = runtime.canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }
  const u = ((clientX - rect.left) / rect.width) * 2 - 1;
  const v = 1 - ((clientY - rect.top) / rect.height) * 2;
  return pickStrikePanelWorldPoint(mesh, projection, u, v);
}
