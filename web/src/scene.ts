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
import { CAMERA_PITCH_DEG } from "./config";
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

export interface SceneRuntime {
  // 루프가 물리 자세를 개체별 렌더 메시로 복사하기 위한 연결표다.
  pieceMeshes: Map<string, Mesh>;
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  controls: OrbitControls;
  boardMesh: Mesh;
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

// 여백과 8개 셀이 실제 0.25:1 비율로 그려지는 캔버스 해상도다.
const BOARD_CANVAS_SIZE = 544;

// 한 셀을 정수 픽셀로 그려 경계가 흐려지지 않게 하는 크기다.
const BOARD_CELL_PIXELS = 64;

// 물리 여백 0.25셀과 같은 비율을 만드는 캔버스 테두리 두께다.
const BOARD_BORDER_PIXELS = 16;

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
 * 보드 여백과 8×8 무늬를 한 캔버스에 그려 시각 셀과 물리 셀의 크기를 일치시킨다.
 */
function createBoardTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = BOARD_CANVAS_SIZE;
  canvas.height = BOARD_CANVAS_SIZE;
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error("체스판 텍스처를 그릴 2D 캔버스를 만들지 못했습니다.");
  }

  context.fillStyle = "#4b3023";
  context.fillRect(0, 0, BOARD_CANVAS_SIZE, BOARD_CANVAS_SIZE);
  for (let rank = 0; rank < 8; rank += 1) {
    for (let file = 0; file < 8; file += 1) {
      // 파일 x축을 뒤집은 텍스처 대응에서 a1은 홀수 패리티의 어두운 칸, h1은 밝은 칸이어야 한다.
      context.fillStyle = (file + rank) % 2 === 1 ? "#7b4d35" : "#e3d2b2";
      context.fillRect(
        BOARD_BORDER_PIXELS + file * BOARD_CELL_PIXELS,
        BOARD_BORDER_PIXELS + rank * BOARD_CELL_PIXELS,
        BOARD_CELL_PIXELS,
        BOARD_CELL_PIXELS,
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
function createBoardMesh(
  boardHalfExtent: number,
  boardThickness: number,
): Mesh {
  const geometry = new BoxGeometry(
    boardHalfExtent * 2,
    boardThickness,
    boardHalfExtent * 2,
  );
  const sideMaterial = new MeshStandardMaterial({
    color: 0x36251f,
    roughness: 0.84,
  });
  const topMaterial = new MeshStandardMaterial({
    map: createBoardTexture(),
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
  board.name = "Board";
  board.position.y = -boardThickness / 2;
  board.receiveShadow = true;
  return board;
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

  const boardMesh = createBoardMesh(
    boardHalfExtent,
    assets.meta.boardThickness,
  );
  scene.add(boardMesh);

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
    scene,
    camera,
    renderer,
    controls,
    boardMesh,
    boardTop:
      boardMesh.position.y + assets.meta.boardThickness / 2,
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
 * 기존 말 메시 참조를 씬과 연결표에서 모두 제거하고 표준 32개 메시를 다시 등록한다.
 */
export function resetScenePieces(
  runtime: SceneRuntime,
  assets: ChessAssets,
  instances: readonly PieceInstance[],
  stageOptions: StageSpawnOptions = DEFAULT_STAGE_SPAWN_OPTIONS,
): void {
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
