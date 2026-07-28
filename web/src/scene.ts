import {
  BoxGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  HemisphereLight,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  NearestFilter,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
  Vector3,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ChessAssets } from "./assets";
import {
  computeBoardRenderFloorRectangles,
  computeBoardSurfaceLayout,
  createBoardFloorGeometry,
} from "./board";
import { CAMERA_PITCH_DEG } from "./config";
import {
  computeBoardHoleRectangles,
  createBoardFloorLayoutKey,
  type BoardFloorRectangle,
  type BoardHoleRectangle,
} from "./holes";
import type { PhysicsRuntime } from "./physics";
import {
  getCellCenter,
  type PieceInstance,
  type PieceSide,
} from "./layout";
import {
  computeStagePieceScale,
  computeStageSpawnPose,
  selectStageSpawnInstances,
  type StageSpawnOptions,
} from "./stage";
import {
  computeBreakableWallSegments,
  computePocketKingBaseRadius,
  computePocketWallSegments,
  hasBreakableWalls,
  hasPocketWalls,
  type BreakableWallSegmentDefinition,
} from "./walls";

export interface BreakableWallMeshBinding {
  // 물리 조각과 같은 내구 변형·id·위치·크기를 제공하는 고정 배치 정의다.
  definition: BreakableWallSegmentDefinition;
  // 파괴 벽의 파란 띠 또는 불파괴 벽의 회백색 띠를 그리는 실제 박스 메시다.
  mesh: Mesh;
  // 파괴 변형에서만 같은 균열 텍스처를 매 프레임 다시 만들지 않는 마지막 표시 타격 수다.
  shownHitCount: number;
}

export interface SceneRuntime {
  // 루프가 물리 자세를 개체별 렌더 메시로 복사하기 위한 연결표다.
  pieceMeshes: Map<string, Mesh>;
  // 파괴 벽과 포켓 불파괴 벽을 같은 정의·메시 생성 경로로 동기화하는 연결표다.
  breakableWallMeshes: Map<string, BreakableWallMeshBinding>;
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  controls: OrbitControls;
  // 기존 단일 보드 API와 호환할 첫 번째 바닥 메시다.
  boardMesh: Mesh;
  // 구멍을 제외한 렌더 바닥 전체를 이루는 직사각형 메시들이다.
  boardMeshes: Mesh[];
  // 물리 바닥과 값 단위로 대조할 렌더 바닥 직사각형 목록이다.
  boardFloorRectangles: BoardFloorRectangle[];
  // 현재 렌더 보드에서 비워 둔 구멍 직사각형 목록이다.
  boardHoleRectangles: BoardHoleRectangle[];
  // 같은 반폭의 서로 다른 스테이지 보드를 구분하는 값 기반 키다.
  boardFloorLayoutKey: string;
  boardTop: number;
  // 세로 화면에서도 보드 전체가 들어오도록 현재 종횡비에서 계산한 최소 거리다.
  minimumCameraDistance: number;
  // 턴 회전이 현재 리사이즈 조건을 사용할 수 있도록 보드 반폭을 보존한다.
  boardHalfExtent: number;
  // 재시작 때 새 백 메시가 기존 공유 재질을 그대로 사용하도록 보존한다.
  whitePieceMaterial: MeshStandardMaterial;
  // 재시작 때 새 흑 메시가 기존 공유 재질을 그대로 사용하도록 보존한다.
  blackPieceMaterial: MeshStandardMaterial;
  // 리사이즈 뒤 현재 입력 모드의 거리·피치 계약을 다시 적용하는 선택적 연결점이다.
  onCameraFitChanged: (() => void) | null;
}

// 첫 화면과 핫시트 생성에서는 모든 렌더 메시를 원본 배율로 둔다.
const DEFAULT_STAGE_SPAWN_OPTIONS: StageSpawnOptions = {
  gameMode: "hotseat",
  stageNumber: 1,
};

/**
 * 조준 가림 때문에 숨긴 렌더 메시만 원래 표시 상태로 되돌린다.
 */
export function restoreHiddenPieceMeshes(
  runtime: SceneRuntime,
  hiddenPieceIds: Set<string>,
): void {
  for (const pieceId of hiddenPieceIds) {
    const mesh = runtime.pieceMeshes.get(pieceId);
    if (mesh !== undefined) {
      mesh.visible = true;
    }
  }
  hiddenPieceIds.clear();
}

/**
 * 카메라에서 빨간 점까지의 단일 ray에 먼저 닿는 말만 숨겨 실제 조준점을 볼 수 있게 한다.
 */
export function hideAimOccluders(
  runtime: SceneRuntime,
  selectedPieceId: string,
  target: Vector3,
  hiddenPieceIds: Set<string>,
): void {
  restoreHiddenPieceMeshes(runtime, hiddenPieceIds);
  const origin = runtime.camera.position;
  const direction = target.clone().sub(origin);
  const targetDistance = direction.length();
  if (targetDistance < 1e-9) {
    return;
  }
  const raycaster = new Raycaster(
    origin,
    direction.normalize(),
    0,
    targetDistance - 1e-6,
  );
  const intersections = raycaster.intersectObjects(
    [...runtime.pieceMeshes.values()],
    false,
  );
  for (const intersection of intersections) {
    const pieceId = intersection.object.name;
    if (
      pieceId === selectedPieceId ||
      hiddenPieceIds.has(pieceId)
    ) {
      continue;
    }
    const mesh = runtime.pieceMeshes.get(pieceId);
    if (mesh !== undefined) {
      mesh.visible = false;
      hiddenPieceIds.add(pieceId);
    }
  }
}

/**
 * 사전 정착과 매 프레임 동기화가 같은 방식으로 강체 자세를 개별 메시로 복사하게 한다.
 */
export function synchronizePieceMeshes(
  runtime: SceneRuntime,
  physicsRuntime: PhysicsRuntime,
): number {
  let maxSyncError = 0;
  for (const binding of physicsRuntime.pieces.values()) {
    const mesh = runtime.pieceMeshes.get(binding.instance.id);
    if (mesh === undefined) {
      throw new Error(
        `${binding.instance.id} 렌더 메시를 찾지 못했습니다.`,
      );
    }
    const translation = binding.body.translation();
    const rotation = binding.body.rotation();
    mesh.position.set(translation.x, translation.y, translation.z);
    mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    mesh.updateMatrixWorld(true);
    maxSyncError = Math.max(
      maxSyncError,
      Math.hypot(
        mesh.position.x - translation.x,
        mesh.position.y - translation.y,
        mesh.position.z - translation.z,
      ),
    );
  }
  return maxSyncError;
}

// 기본 판과 확대 여백 모두 한 셀에 같은 밀도의 텍셀을 배정하는 목표 해상도다.
const BOARD_CELL_PIXELS = 64;

// 화면 가장자리에서 보드가 잘리지 않도록 투영 계산에 소량의 여백을 더한다.
const CAMERA_FIT_MARGIN = 1.06;

/**
 * 고정 피치와 주어진 방위에서 보드 네 모서리가 화면 안에 드는 최소 카메라 거리를 계산한다.
 */
function computeMinimumCameraDistance(
  camera: PerspectiveCamera,
  horizontalDirection: Vector3,
  boardHalfExtent: number,
): number {
  const pitch = MathUtils.degToRad(CAMERA_PITCH_DEG);
  const verticalHalfFov = MathUtils.degToRad(camera.fov / 2);
  const horizontalHalfFov = Math.atan(
    Math.tan(verticalHalfFov) * camera.aspect,
  );
  const right = new Vector3(
    -horizontalDirection.z,
    0,
    horizontalDirection.x,
  );
  let requiredDistance = 0;
  for (const x of [-boardHalfExtent, boardHalfExtent]) {
    for (const z of [-boardHalfExtent, boardHalfExtent]) {
      const corner = new Vector3(x, 0, z);
      const alongView = corner.dot(horizontalDirection);
      const depthOffset = -alongView * Math.cos(pitch);
      const horizontalExtent = Math.abs(corner.dot(right));
      const verticalExtent = Math.abs(alongView * Math.sin(pitch));
      requiredDistance = Math.max(
        requiredDistance,
        horizontalExtent / Math.tan(horizontalHalfFov) - depthOffset,
        verticalExtent / Math.tan(verticalHalfFov) - depthOffset,
      );
    }
  }
  return requiredDistance * CAMERA_FIT_MARGIN;
}

/**
 * 카메라를 고정 피치로 다시 놓고 현재 화면에서 필요한 거리와 줌 한계를 갱신한다.
 */
export function fitCameraToBoard(runtime: SceneRuntime): void {
  const horizontalDirection = new Vector3(
    runtime.camera.position.x - runtime.controls.target.x,
    0,
    runtime.camera.position.z - runtime.controls.target.z,
  );
  if (horizontalDirection.lengthSq() < 1e-12) {
    horizontalDirection.set(0, 0, -1);
  }
  horizontalDirection.normalize();
  // 정사각형 보드는 대각선 방위가 가장 넓게 투영되므로 그 최악 조건을 모든 회전에 공통 적용해 중간 각도 잘림을 막는다.
  const worstCaseDirection = new Vector3(
    Math.SQRT1_2,
    0,
    Math.SQRT1_2,
  );
  const minimumDistance = computeMinimumCameraDistance(
    runtime.camera,
    worstCaseDirection,
    runtime.boardHalfExtent,
  );
  runtime.minimumCameraDistance = minimumDistance;
  if (runtime.onCameraFitChanged !== null) {
    runtime.onCameraFitChanged();
    return;
  }
  runtime.controls.minDistance = minimumDistance;
  runtime.controls.maxDistance = Math.max(
    minimumDistance * 1.8,
    runtime.boardHalfExtent * 4,
  );
  const currentDistance = runtime.camera.position.distanceTo(
    runtime.controls.target,
  );
  const distance = Math.max(currentDistance, minimumDistance);
  const pitch = MathUtils.degToRad(CAMERA_PITCH_DEG);
  runtime.camera.position.set(
    runtime.controls.target.x +
      horizontalDirection.x * Math.cos(pitch) * distance,
    runtime.controls.target.y + Math.sin(pitch) * distance,
    runtime.controls.target.z +
      horizontalDirection.z * Math.cos(pitch) * distance,
  );
  runtime.camera.lookAt(runtime.controls.target);
  runtime.controls.update();
}

/**
 * 새 외곽 목재 테두리 안쪽 전체에 기존 셀 크기와 위상이 이어지는 체크무늬를 그린다.
 */
function createBoardTexture(
  boardHalfExtent: number,
  cellSize: number,
  rectangle: Readonly<BoardFloorRectangle>,
): CanvasTexture {
  const layout = computeBoardSurfaceLayout(
    cellSize,
    boardHalfExtent,
  );
  const canvasWidth = Math.ceil(
    ((rectangle.maxX - rectangle.minX) * BOARD_CELL_PIXELS) /
      cellSize,
  );
  const canvasHeight = Math.ceil(
    ((rectangle.maxZ - rectangle.minZ) * BOARD_CELL_PIXELS) /
      cellSize,
  );
  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error("체스판 텍스처를 그릴 2D 캔버스를 만들지 못했습니다.");
  }
  context.imageSmoothingEnabled = false;

  context.fillStyle = "#4b3023";
  context.fillRect(0, 0, canvasWidth, canvasHeight);
  const pixelsPerWorldUnitX =
    canvasWidth / (rectangle.maxX - rectangle.minX);
  const pixelsPerWorldUnitZ =
    canvasHeight / (rectangle.maxZ - rectangle.minZ);
  const firstCellIndex = Math.floor(
    -layout.checkerHalfExtent / cellSize,
  );
  const lastCellIndex = Math.ceil(
    layout.checkerHalfExtent / cellSize,
  );
  for (
    let rankIndex = firstCellIndex;
    rankIndex < lastCellIndex;
    rankIndex += 1
  ) {
    for (
      let fileIndex = firstCellIndex;
      fileIndex < lastCellIndex;
      fileIndex += 1
    ) {
      const minimumX = Math.max(
        fileIndex * cellSize,
        -layout.checkerHalfExtent,
        rectangle.minX,
      );
      const maximumX = Math.min(
        (fileIndex + 1) * cellSize,
        layout.checkerHalfExtent,
        rectangle.maxX,
      );
      const minimumZ = Math.max(
        rankIndex * cellSize,
        -layout.checkerHalfExtent,
        rectangle.minZ,
      );
      const maximumZ = Math.min(
        (rankIndex + 1) * cellSize,
        layout.checkerHalfExtent,
        rectangle.maxZ,
      );
      if (minimumX >= maximumX || minimumZ >= maximumZ) {
        continue;
      }
      // 원점을 기준으로 이어지는 셀 인덱스를 써 기존 8×8 경계에도 위상 이음새를 만들지 않는다.
      context.fillStyle =
        ((fileIndex + rankIndex) & 1) === 1
          ? "#7b4d35"
          : "#e3d2b2";
      context.fillRect(
        (minimumX - rectangle.minX) * pixelsPerWorldUnitX,
        (minimumZ - rectangle.minZ) * pixelsPerWorldUnitZ,
        (maximumX - minimumX) * pixelsPerWorldUnitX,
        (maximumZ - minimumZ) * pixelsPerWorldUnitZ,
      );
    }
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * BoxGeometry의 위쪽 면 그룹에만 체크무늬 재질을 배정해 옆면을 평평한 단색으로 둔다.
 */
function createBoardMeshes(
  boardHalfExtent: number,
  boardThickness: number,
  cellSize: number,
  stageOptions: StageSpawnOptions,
): {
  meshes: Mesh[];
  floorRectangles: BoardFloorRectangle[];
  holeRectangles: BoardHoleRectangle[];
  layoutKey: string;
} {
  const holeRectangles = computeBoardHoleRectangles(
    cellSize,
    stageOptions.gameMode,
    stageOptions.stageNumber,
  );
  const floorRectangles = computeBoardRenderFloorRectangles(
    boardHalfExtent,
    cellSize,
    stageOptions.gameMode,
    stageOptions.stageNumber,
  );
  const meshes = floorRectangles.map((rectangle, index) => {
    const geometry = createBoardFloorGeometry(
      rectangle,
      boardThickness,
    );
    const sideMaterial = new MeshStandardMaterial({
      color: 0x36251f,
      roughness: 0.84,
    });
    const topMaterial = new MeshStandardMaterial({
      map: createBoardTexture(
        boardHalfExtent,
        cellSize,
        rectangle,
      ),
      roughness: 0.72,
    });
    const materials = [
      sideMaterial,
      sideMaterial,
      topMaterial,
      sideMaterial,
      sideMaterial,
      sideMaterial,
    ];
    const board = new Mesh(geometry, materials);
    board.name = `Board-${index}`;
    board.position.set(
      (rectangle.minX + rectangle.maxX) / 2,
      -boardThickness / 2,
      (rectangle.minZ + rectangle.maxZ) / 2,
    );
    board.receiveShadow = true;
    return board;
  });
  if (meshes.length === 0) {
    throw new Error("구멍 분할 뒤 렌더 보드 바닥이 하나도 남지 않았습니다.");
  }
  return {
    meshes,
    floorRectangles,
    holeRectangles,
    layoutKey: createBoardFloorLayoutKey(
      boardHalfExtent,
      floorRectangles,
    ),
  };
}

/**
 * 보드 한 조각의 지오메트리·재질·캔버스 텍스처를 누수 없이 해제한다.
 */
function disposeBoardMesh(mesh: Mesh): void {
  mesh.geometry.dispose();
  const materials = Array.isArray(mesh.material)
    ? mesh.material
    : [mesh.material];
  for (const material of new Set(materials)) {
    if (material instanceof MeshStandardMaterial) {
      material.map?.dispose();
    }
    material.dispose();
  }
}

/**
 * 조각 순번만으로 같은 갈라짐을 만드는 작은 파란 캔버스 텍스처를 생성한다.
 */
function createWallCrackTexture(segmentIndex: number): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error("벽 균열 캔버스의 2D 문맥을 만들 수 없습니다.");
  }
  context.fillStyle = "#176d94";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "#d8eef5";
  context.lineWidth = 4;
  context.lineCap = "round";
  context.lineJoin = "round";
  let seed = ((segmentIndex + 1) * 2654435761) >>> 0;
  context.beginPath();
  context.moveTo(canvas.width * 0.5, 2);
  for (let step = 1; step <= 6; step += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const offset = ((seed >>> 16) / 0xffff - 0.5) * 30;
    context.lineTo(
      canvas.width * 0.5 + offset,
      (canvas.height * step) / 7,
    );
  }
  context.lineTo(canvas.width * 0.5, canvas.height - 2);
  context.stroke();
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * 한 벽 정의를 내구 변형에 맞는 파란색 또는 회백색 박스 메시로 만들어 등록한다.
 */
function addBreakableWallMesh(
  scene: Scene,
  wallMeshes: Map<string, BreakableWallMeshBinding>,
  definition: BreakableWallSegmentDefinition,
): void {
  const geometry = new BoxGeometry(
    definition.halfExtents.x * 2,
    definition.halfExtents.y * 2,
    definition.halfExtents.z * 2,
  );
  const material = new MeshStandardMaterial({
    color:
      definition.variant === "breakable"
        ? 0x176d94
        : 0xd9dee3,
    roughness: 0.7,
    polygonOffset: true,
    polygonOffsetFactor:
      definition.sideIndex % 2 === 0 ? -1 : -2,
    polygonOffsetUnits: -1,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = definition.id;
  mesh.position.set(
    definition.center.x,
    definition.center.y,
    definition.center.z,
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  wallMeshes.set(definition.id, {
    definition,
    mesh,
    shownHitCount: 0,
  });
}

/**
 * 벽 메시와 균열 텍스처가 소유한 GPU 자원을 함께 해제한다.
 */
function disposeBreakableWallMesh(
  scene: Scene,
  binding: BreakableWallMeshBinding,
): void {
  scene.remove(binding.mesh);
  binding.mesh.geometry.dispose();
  const materials = Array.isArray(binding.mesh.material)
    ? binding.mesh.material
    : [binding.mesh.material];
  for (const material of materials) {
    if (material instanceof MeshStandardMaterial) {
      material.map?.dispose();
    }
    material.dispose();
  }
}

/**
 * 진영별 공유 재질을 선택해 32개 개별 메시가 지오메트리와 재질만 공유하게 한다.
 */
function choosePieceMaterial(
  side: PieceSide,
  whiteMaterial: MeshStandardMaterial,
  blackMaterial: MeshStandardMaterial,
): MeshStandardMaterial {
  return side === "white" ? whiteMaterial : blackMaterial;
}

/**
 * 공유 지오메트리·재질로 한 개체의 시작 메시를 만들고 씬 연결표에 등록한다.
 */
function addPieceMesh(
  scene: Scene,
  pieceMeshes: Map<string, Mesh>,
  assets: ChessAssets,
  instance: PieceInstance,
  whiteMaterial: MeshStandardMaterial,
  blackMaterial: MeshStandardMaterial,
  stageOptions: StageSpawnOptions,
): void {
  const geometry = assets.geometries.get(instance.type);
  if (geometry === undefined) {
    throw new Error(`${instance.type} 공유 지오메트리를 찾지 못했습니다.`);
  }
  const mesh = new Mesh(
    geometry,
    choosePieceMaterial(instance.side, whiteMaterial, blackMaterial),
  );
  const pose = computeStageSpawnPose(
    instance,
    assets.meta,
    stageOptions,
  );
  mesh.name = instance.id;
  mesh.position.set(
    pose.translation.x,
    pose.translation.y,
    pose.translation.z,
  );
  mesh.quaternion.set(
    pose.rotation.x,
    pose.rotation.y,
    pose.rotation.z,
    pose.rotation.w,
  );
  mesh.scale.setScalar(
    computeStagePieceScale(instance, assets.meta, stageOptions),
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  pieceMeshes.set(instance.id, mesh);
}

/**
 * 카메라·조명·절차 보드와 개별 말 메시를 구성하고 리사이즈 동기화를 연결한다.
 */
export function createSceneRuntime(
  container: HTMLElement,
  assets: ChessAssets,
  instances: readonly PieceInstance[],
  boardHalfExtent: number,
  stageOptions: StageSpawnOptions = DEFAULT_STAGE_SPAWN_OPTIONS,
): SceneRuntime {
  const scene = new Scene();
  scene.background = new Color(0x171410);

  const camera = new PerspectiveCamera(
    42,
    window.innerWidth / window.innerHeight,
    0.05,
    100,
  );
  camera.position.set(
    0,
    boardHalfExtent * 1.65,
    -boardHalfExtent * 1.85,
  );

  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.domElement.className = "game-canvas";
  renderer.domElement.setAttribute("aria-label", "ChessAlkkagi 3D 체스판");
  container.append(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.target.set(0, 0, 0);
  controls.minDistance = boardHalfExtent * 0.75;
  controls.maxDistance = boardHalfExtent * 4;
  const fixedPolarAngle =
    Math.PI / 2 - MathUtils.degToRad(CAMERA_PITCH_DEG);
  controls.minPolarAngle = fixedPolarAngle;
  controls.maxPolarAngle = fixedPolarAngle;
  controls.update();

  const hemisphere = new HemisphereLight(0xfff4df, 0x282d38, 1.65);
  scene.add(hemisphere);

  const sunlight = new DirectionalLight(0xfff0d4, 3.2);
  sunlight.position.set(
    -boardHalfExtent,
    boardHalfExtent * 2.7,
    -boardHalfExtent * 1.15,
  );
  sunlight.castShadow = true;
  sunlight.shadow.mapSize.set(2048, 2048);
  sunlight.shadow.camera.left = -boardHalfExtent * 1.35;
  sunlight.shadow.camera.right = boardHalfExtent * 1.35;
  sunlight.shadow.camera.top = boardHalfExtent * 1.35;
  sunlight.shadow.camera.bottom = -boardHalfExtent * 1.35;
  sunlight.shadow.camera.near = 0.1;
  sunlight.shadow.camera.far = boardHalfExtent * 7;
  sunlight.shadow.bias = -0.0002;
  sunlight.target.position.set(0, 0, 0);
  scene.add(sunlight, sunlight.target);

  const board = createBoardMeshes(
    boardHalfExtent,
    assets.meta.boardThickness,
    assets.meta.cellSize,
    stageOptions,
  );
  scene.add(...board.meshes);
  const boardMesh = board.meshes[0];
  if (boardMesh === undefined) {
    throw new Error("대표 렌더 보드 메시가 없습니다.");
  }
  const boardTop =
    boardMesh.position.y + assets.meta.boardThickness / 2;
  const breakableWallMeshes = new Map<
    string,
    BreakableWallMeshBinding
  >();
  const breakable = hasBreakableWalls(
    stageOptions.gameMode,
    stageOptions.stageNumber,
  );
  const pocket = hasPocketWalls(
    stageOptions.gameMode,
    stageOptions.stageNumber,
  );
  if (breakable || pocket) {
    const definitions = breakable
      ? computeBreakableWallSegments(
          boardHalfExtent,
          boardTop,
          assets.meta.cellSize,
        )
      : computePocketWallSegments(
          boardHalfExtent,
          boardTop,
          computePocketKingBaseRadius(
            assets.meta.pieces.King.colliderPoints,
            assets.meta.pieces.King.bounds.y,
          ),
        );
    for (const definition of definitions) {
      addBreakableWallMesh(
        scene,
        breakableWallMeshes,
        definition,
      );
    }
  }

  const whiteMaterial = new MeshStandardMaterial({
    color: 0xf1eadc,
    roughness: 0.52,
    metalness: 0.03,
  });
  const blackMaterial = new MeshStandardMaterial({
    color: 0x292b2f,
    roughness: 0.5,
    metalness: 0.08,
  });
  const pieceMeshes = new Map<string, Mesh>();
  const spawnInstances = selectStageSpawnInstances(
    instances,
    stageOptions,
  );
  for (const instance of spawnInstances) {
    addPieceMesh(
      scene,
      pieceMeshes,
      assets,
      instance,
      whiteMaterial,
      blackMaterial,
      stageOptions,
    );
  }

  const runtime: SceneRuntime = {
    pieceMeshes,
    breakableWallMeshes,
    scene,
    camera,
    renderer,
    controls,
    boardMesh,
    boardMeshes: board.meshes,
    boardFloorRectangles: board.floorRectangles,
    boardHoleRectangles: board.holeRectangles,
    boardFloorLayoutKey: board.layoutKey,
    boardTop,
    minimumCameraDistance: 0,
    boardHalfExtent,
    whitePieceMaterial: whiteMaterial,
    blackPieceMaterial: blackMaterial,
    onCameraFitChanged: null,
  };

  /**
   * 리사이즈 때 투영 비율과 보드 맞춤 거리를 함께 갱신해 세로 화면 잘림을 막는다.
   */
  const handleResize = (): void => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    fitCameraToBoard(runtime);
  };
  window.addEventListener("resize", handleResize);
  fitCameraToBoard(runtime);
  if (import.meta.env.DEV) {
    camera.updateMatrixWorld(true);
    const canvasRect = renderer.domElement.getBoundingClientRect();
    // 백 시점에서 a1이 h1보다 실제 화면 왼쪽에 놓였는지 숫자로 비교할 수 있게 투영 좌표를 남긴다.
    const projectSquare = (file: "a" | "h"): string => {
      const center = getCellCenter(
        { file, rank: 1 },
        assets.meta.cellSize,
      );
      const projected = new Vector3(center.x, 0, center.z).project(camera);
      const screenX =
        canvasRect.left + ((projected.x + 1) / 2) * canvasRect.width;
      const screenY =
        canvasRect.top + ((1 - projected.y) / 2) * canvasRect.height;
      return `${file}1 NDC=(${projected.x.toFixed(4)}, ${projected.y.toFixed(4)}), 화면=(${screenX.toFixed(1)}, ${screenY.toFixed(1)})`;
    };
    console.info(
      `[배치] 백 시점 투영: ${projectSquare("a")} / ${projectSquare("h")}`,
    );
  }
  return runtime;
}

/**
 * 말 메시와 카메라 객체는 유지한 채 판 메시만 새 반폭으로 교체하고 현재 화면 맞춤값을 갱신한다.
 */
export function rebuildSceneBoard(
  runtime: SceneRuntime,
  assets: ChessAssets,
  boardHalfExtent: number,
  stageOptions: StageSpawnOptions = DEFAULT_STAGE_SPAWN_OPTIONS,
): void {
  const nextFloorRectangles = computeBoardRenderFloorRectangles(
    boardHalfExtent,
    assets.meta.cellSize,
    stageOptions.gameMode,
    stageOptions.stageNumber,
  );
  const nextLayoutKey = createBoardFloorLayoutKey(
    boardHalfExtent,
    nextFloorRectangles,
  );
  if (runtime.boardFloorLayoutKey === nextLayoutKey) {
    return;
  }
  const previousBoards = runtime.boardMeshes;
  const nextBoard = createBoardMeshes(
    boardHalfExtent,
    assets.meta.boardThickness,
    assets.meta.cellSize,
    stageOptions,
  );
  for (const previousBoard of previousBoards) {
    runtime.scene.remove(previousBoard);
    disposeBoardMesh(previousBoard);
  }
  runtime.scene.add(...nextBoard.meshes);
  const representative = nextBoard.meshes[0];
  if (representative === undefined) {
    throw new Error("재구축한 대표 렌더 보드 메시가 없습니다.");
  }
  runtime.boardMesh = representative;
  runtime.boardMeshes = nextBoard.meshes;
  runtime.boardFloorRectangles = nextBoard.floorRectangles;
  runtime.boardHoleRectangles = nextBoard.holeRectangles;
  runtime.boardFloorLayoutKey = nextBoard.layoutKey;
  runtime.boardTop =
    representative.position.y + assets.meta.boardThickness / 2;
  runtime.boardHalfExtent = boardHalfExtent;
  fitCameraToBoard(runtime);
}

/**
 * 이전 균열·파괴 상태를 버리고 현재 스테이지 보드 외곽의 벽 메시를 새로 만든다.
 */
export function resetSceneBreakableWalls(
  runtime: SceneRuntime,
  assets: ChessAssets,
  stageOptions: StageSpawnOptions = DEFAULT_STAGE_SPAWN_OPTIONS,
): void {
  for (const binding of runtime.breakableWallMeshes.values()) {
    disposeBreakableWallMesh(runtime.scene, binding);
  }
  runtime.breakableWallMeshes.clear();
  const breakable = hasBreakableWalls(
    stageOptions.gameMode,
    stageOptions.stageNumber,
  );
  const pocket = hasPocketWalls(
    stageOptions.gameMode,
    stageOptions.stageNumber,
  );
  if (!breakable && !pocket) {
    return;
  }
  const definitions = breakable
    ? computeBreakableWallSegments(
        runtime.boardHalfExtent,
        runtime.boardTop,
        assets.meta.cellSize,
      )
    : computePocketWallSegments(
        runtime.boardHalfExtent,
        runtime.boardTop,
        computePocketKingBaseRadius(
          assets.meta.pieces.King.colliderPoints,
          assets.meta.pieces.King.bounds.y,
        ),
      );
  for (const definition of definitions) {
    addBreakableWallMesh(
      runtime.scene,
      runtime.breakableWallMeshes,
      definition,
    );
  }
}

/**
 * 첫 타격에는 결정적 균열을 붙이고 물리에서 제거된 조각은 같은 fixed-step 경계에 숨긴다.
 */
export function synchronizeBreakableWallMeshes(
  runtime: SceneRuntime,
  physicsRuntime: PhysicsRuntime,
): void {
  const wallMeshes = runtime.breakableWallMeshes;
  if (wallMeshes === undefined) {
    // 리플레이·헤드리스 검증의 최소 씬은 벽 렌더를 소유하지 않는다.
    return;
  }
  for (const [wallId, binding] of [...wallMeshes]) {
    const physicsBinding =
      physicsRuntime.breakableWalls.get(wallId);
    if (physicsBinding === undefined) {
      disposeBreakableWallMesh(runtime.scene, binding);
      wallMeshes.delete(wallId);
      continue;
    }
    if (
      binding.definition.variant === "breakable" &&
      physicsBinding.hitCount >= 1 &&
      binding.shownHitCount < 1
    ) {
      const previousMaterial = binding.mesh.material;
      const crackMaterial = new MeshStandardMaterial({
        map: createWallCrackTexture(
          binding.definition.index,
        ),
        roughness: 0.7,
        polygonOffset: true,
        polygonOffsetFactor:
          binding.definition.sideIndex % 2 === 0
            ? -1
            : -2,
        polygonOffsetUnits: -1,
      });
      binding.mesh.material = crackMaterial;
      const materials = Array.isArray(previousMaterial)
        ? previousMaterial
        : [previousMaterial];
      for (const material of materials) {
        if (material instanceof MeshStandardMaterial) {
          material.map?.dispose();
        }
        material.dispose();
      }
      binding.shownHitCount = physicsBinding.hitCount;
    }
  }
}

/**
 * 기존 말 메시 참조를 씬과 연결표에서 모두 제거하고 표준 32개 메시를 다시 등록한다.
 */
export function resetScenePieces(
  runtime: SceneRuntime,
  assets: ChessAssets,
  instances: readonly PieceInstance[],
  stageOptions: StageSpawnOptions = DEFAULT_STAGE_SPAWN_OPTIONS,
): void {
  resetSceneBreakableWalls(runtime, assets, stageOptions);
  for (const mesh of runtime.pieceMeshes.values()) {
    runtime.scene.remove(mesh);
  }
  runtime.pieceMeshes.clear();
  const spawnInstances = selectStageSpawnInstances(
    instances,
    stageOptions,
  );
  for (const instance of spawnInstances) {
    addPieceMesh(
      runtime.scene,
      runtime.pieceMeshes,
      assets,
      instance,
      runtime.whitePieceMaterial,
      runtime.blackPieceMaterial,
      stageOptions,
    );
  }
  const pieceIds = new Set(
    spawnInstances.map((instance) => instance.id),
  );
  const attachedPieceMeshCount = runtime.scene.children.filter((child) =>
    pieceIds.has(child.name),
  ).length;
  if (
    runtime.pieceMeshes.size !== spawnInstances.length ||
    attachedPieceMeshCount !== spawnInstances.length
  ) {
    throw new Error(
      `재시작 렌더 연결 누수 검사 실패: 연결표 ${runtime.pieceMeshes.size}/${spawnInstances.length}, 씬 ${attachedPieceMeshCount}/${spawnInstances.length}`,
    );
  }
}
