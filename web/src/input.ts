import {
  BufferGeometry,
  Matrix4,
  MathUtils,
  Mesh,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  Spherical,
  Vector2,
  Vector3,
} from "three";
import {
  computeActionBarPlacement,
  type ActionBarAnchor,
  type ActionBarRect,
} from "./action-bar";
import {
  beginAim,
  beginDirectedAim,
  cancelAim,
  freezeCameraBasis,
  handleAimPieceRemoved,
  selectAimPiece,
  setAimApplicationPoint,
  startLaunchPulse,
  updateAimPointer,
  updateDirectedAim,
  type AimRuntime,
  type LaunchRequest,
} from "./aim";
import {
  clearStrikePreview,
  computeStrikeApplicationPoint,
  isRedDotHit,
  setAimPower,
  showAimError,
  updateStrikePreview,
  setStrikePointOverride,
  clearStrikePointOverride,
  resolveStrikeApplicationPoint,
  type AimParametersRuntime,
  type StrikeSolution,
} from "./aimparams";
import {
  CAMERA_PITCH_DEG,
  CAMERA_TARGET_TRANSITION_SECONDS,
  CAM_MIN_DISTANCE,
  CAM_PITCH_MAX,
  CAM_PITCH_MIN,
  MAX_DRAG_PIXELS,
  TOUCH_MAX_DRAG_MIN_PIXELS,
  TOUCH_MAX_DRAG_VIEWPORT_RATIO,
  TOUCH_PIECE_HIT_RADIUS_PIXELS,
  TOUCH_RED_DOT_HIT_RADIUS_MULTIPLIER,
} from "./config";
import { isTouchPointerEvent } from "./input-capability";
import type { PhysicsRuntime } from "./physics";
import {
  hideAimOccluders,
  restoreHiddenPieceMeshes,
  type SceneRuntime,
} from "./scene";
import { playPieceClickSound } from "./sound";
import {
  createStrikePointPanel,
  pickStrikePointFromPanel,
  updateStrikePointPanel,
  type StrikePointPanelRuntime,
} from "./strike-panel";

export type PointerState =
  | "idle"
  | "selected-preview"
  | "aiming"
  | "charging"
  | "launch"
  | "cancel";
export type InputMode = "classic" | "billiards";

export interface ScreenSpacePieceCandidate {
  // 선택 정책을 이미 통과한 말의 안정적인 런타임 식별자다.
  pieceId: string;
  // 월드 위치를 현재 카메라와 캔버스 영역으로 투영한 클라이언트 X 좌표다.
  clientX: number;
  // 월드 위치를 현재 카메라와 캔버스 영역으로 투영한 클라이언트 Y 좌표다.
  clientY: number;
}

export interface ScreenSpacePointer {
  // 이벤트별 마우스·터치 구분에 사용하는 브라우저 포인터 종류다.
  pointerType: string;
  // 터치 중심의 클라이언트 X 좌표다.
  clientX: number;
  // 터치 중심의 클라이언트 Y 좌표다.
  clientY: number;
}

export type BilliardsTouchPointerRoute =
  | "red-dot-aim"
  | "orbit"
  | "blocked";

export interface BilliardsTouchPointerContext {
  // 선택된 말이 있어 빨간 점 조준을 시작할 수 있는지 나타낸다.
  hasSelectedPiece: boolean;
  // 타점 선택 중에는 모든 캔버스 터치를 카메라에 양보한다.
  strikeMode: boolean;
  // 현재 터치가 확대된 빨간 점 화면 반경 안에 있는지 나타낸다.
  redDotHit: boolean;
  // 입력 런타임이 이미 조준 포인터 또는 탭 후보를 추적 중인지 나타낸다.
  activeInputPointer: boolean;
  // OrbitControls가 소유한 현재 터치 포인터 수다.
  orbitTouchCount: number;
}

interface CameraPolicy {
  // 모드 전환 뒤 같은 카메라 계약을 복원할 전략 식별자다.
  mode: InputMode;
  // OrbitControls의 polar 제한으로 변환할 월드 피치 범위다.
  minPitchDegrees: number;
  maxPitchDegrees: number;
  // 선택 말 AABB 중심과 판 중심 중 공전 기준을 고른다.
  usesSelectedTarget: boolean;
}

interface CameraTransition {
  // 실제 시간 보간이 TIME_SCALE 영향을 받지 않게 하는 시작 시각이다.
  startedAt: number;
  fromTarget: Vector3;
  toTarget: Vector3;
  fromSpherical: Spherical;
  toSpherical: Spherical;
  minDistance: number;
  maxDistance: number;
  minPolarAngle: number;
  maxPolarAngle: number;
}

interface PointerGesture {
  // 하나의 상태 기계에서 클래식·당구식 탭·빨간 점 충전을 구분한다.
  source:
    | "classic-canvas"
    | "billiards-canvas"
    | "red-dot";
  startX: number;
  startY: number;
  maximumDistance: number;
  // 포인터 시작 때의 최근접 교차만 탭 release까지 보존한다.
  candidatePieceId: string | null;
  // 조준 시작 시 viewport로 고정한 이번 드래그의 최대 세기 거리다.
  maxDragPixels: number;
}

export interface LaunchQueueOutcome {
  accepted: boolean;
  reason: string | null;
}

export interface InputModeStrategy {
  cameraPolicy: CameraPolicy;
  usesHitPoint: boolean;
  computeLaunchDirection: (runtime: InputRuntime) => Vector3;
  computeApplicationPoint: (runtime: InputRuntime) => Vector3;
  onAimBegin: (
    runtime: InputRuntime,
    pieceId: string,
    event?: PointerEvent,
  ) => void;
  onAimCancel: (runtime: InputRuntime) => void;
}

export interface InputPolicy {
  // 결과 화면 동안 포인터·키·카메라 입력을 한 가드로 막는 매치 상태 판정이다.
  isInputBlocked: () => boolean;
  // AI가 공유 조준 표시를 소유할 때 플레이어 선택 정리만 건너뛰는 판정이다.
  isExternalAimActive: () => boolean;
  canSelectPiece: (pieceId: string) => boolean;
  isCameraRotating: () => boolean;
  queueLaunch: (request: LaunchRequest) => LaunchQueueOutcome;
  onModeChanged: (mode: InputMode) => void;
}

export interface InputRuntime {
  // 입력 판정에서 렌더 메시와 물리 바디를 같은 id로 찾기 위한 런타임 연결이다.
  sceneRuntime: SceneRuntime;
  physicsRuntime: PhysicsRuntime;
  aimRuntime: AimRuntime;
  aimParametersRuntime: AimParametersRuntime;
  policy: InputPolicy;
  strategies: Record<InputMode, InputModeStrategy>;
  strategy: InputModeStrategy;
  mode: InputMode;
  raycaster: Raycaster;
  pointerNdc: Vector2;
  selectablePieceIds: Set<string>;
  state: PointerState;
  activePointerId: number | null;
  activeCaptureElement: HTMLElement | null;
  gesture: PointerGesture | null;
  // OrbitControls가 소유한 터치 집합을 추적해 추가 손가락이 조준으로 전환되지 않게 한다.
  orbitTouchPointerIds: Set<number>;
  cameraTransition: CameraTransition | null;
  preparedStrikeSolution: StrikeSolution | null;
  // 수평 성분이 퇴화할 때 직전 유효 방위를 유지해 높은 피치에서도 방향을 안정시킨다.
  lastValidAzimuth: number;
  // 실제 경과 시간으로 직접 구면좌표를 적분할 키 상태와 직전 갱신 시각이다.
  heldCameraKeys: Set<string>;
  lastUpdateTime: number | null;
  // 공유 재질을 건드리지 않고 조준 ray 앞의 메시만 복원하기 위한 id 목록이다.
  hiddenPieceIds: Set<string>;
  failureReason: string | null;
  // 선택 말과 빨간 점을 프러스텀 안에 두는 현재 최소 거리다.
  adaptiveCloseDistance: number | null;
  modeToggle: HTMLElement;
  // 담돌받기 / 타점선택 앙션 바.
  actionBar: HTMLElement;
  // 마지막 팝업 위치 계산에 사용한 선택 말 id다.
  actionBarSelectedPieceId: string | null;
  // 카메라 이동 중 DOM 위치 쓰기를 제한하는 마지막 계산 시각이다.
  actionBarLastPositionedAt: number;
  // 0.5px 미만 흔들림을 DOM에 다시 쓰지 않기 위한 마지막 X 좌표다.
  actionBarLastLeft: number | null;
  // 0.5px 미만 흔들림을 DOM에 다시 쓰지 않기 위한 마지막 Y 좌표다.
  actionBarLastTop: number | null;
  // 타점 패널 표시 전환 때 즉시 재배치하기 위한 직전 표시 상태다.
  actionBarPanelWasVisible: boolean;
  // true이면 기물 표면 탭으로 타점을 지정한다.
  strikeMode: boolean;
  // 3D 직접 클릭과 같은 override를 편집하는 확대 정면 패널 런타임이다.
  strikePointPanel: StrikePointPanelRuntime;
}

// 탭과 카메라 공전 드래그를 같은 캔버스 포인터에서 구별하는 최대 이동 거리다.
const TAP_MAX_DISTANCE_PIXELS = 6;

// 작은 빨간 점을 손가락으로도 안정적으로 누르게 하는 최소 화면 히트 반경이다.
const RED_DOT_HIT_RADIUS_PIXELS = 24;

// 모드 선택을 새로고침 뒤에도 유지하는 브라우저 저장 키다.
const INPUT_MODE_STORAGE_KEY = "chessAlkkagi.inputMode";

// M3 패널과 같은 100ms 상한으로 카메라 공전 중 팝업 DOM 갱신을 제한한다.
const ACTION_BAR_POSITION_INTERVAL_MS = 100;

// 판·구·빨간 점이 화면 경계에 붙지 않도록 프러스텀 제약을 안쪽으로 줄이는 배율이다.
const CAMERA_CLOSE_FIT_MARGIN = 1.08;

// GLTF accessor에서 만든 보수적 구 대신 실제 POSITION 정점 구를 geometry마다 한 번만 계산한다.
const EXACT_BOUNDING_SPHERE_GEOMETRIES = new WeakSet<BufferGeometry>();

// 카메라 직접 적분에 참여하는 물리 키의 단일 목록이다.
const CAMERA_KEY_CODES = new Set([
  "KeyA",
  "KeyD",
  "KeyW",
  "KeyS",
]);

/**
 * 공전 중심이 선택 말에 있어도 판 네 모서리·말 구·빨간 점이 프러스텀 안에 드는 최소 거리를 계산한다.
 */
export function computeAdaptiveCloseDistance(
  camera: PerspectiveCamera,
  mesh: Mesh,
  target: Vector3,
  redDot: Vector3,
  boardHalfExtent: number,
  phi: number,
  theta: number,
): number {
  if (!EXACT_BOUNDING_SPHERE_GEOMETRIES.has(mesh.geometry)) {
    mesh.geometry.computeBoundingSphere();
    EXACT_BOUNDING_SPHERE_GEOMETRIES.add(mesh.geometry);
  }
  const localSphere = mesh.geometry.boundingSphere;
  if (localSphere === null) {
    throw new Error(`${mesh.name} 근접 거리용 bounding sphere가 없습니다.`);
  }
  mesh.updateMatrixWorld(true);
  const sphere = localSphere.clone().applyMatrix4(mesh.matrixWorld);
  const back = new Vector3().setFromSpherical(
    new Spherical(1, phi, theta),
  );
  const forward = back.clone().negate();
  const right = forward
    .clone()
    .cross(new Vector3(0, 1, 0))
    .normalize();
  const cameraUp = right.clone().cross(forward).normalize();
  const verticalHalfFov = MathUtils.degToRad(camera.fov / 2);
  const horizontalHalfFov = Math.atan(
    Math.tan(verticalHalfFov) * camera.aspect,
  );

  const sphereOffset = sphere.center.clone().sub(target);
  const sphereAlong = sphereOffset.dot(forward);
  const sphereHorizontal = Math.abs(sphereOffset.dot(right));
  const sphereVertical = Math.abs(sphereOffset.dot(cameraUp));
  // 평면까지의 부호 거리에서 구 반지름을 빼는 정확한 sphere-frustum 조건을 거리 식으로 푼다.
  const sphereDistance = Math.max(
    sphereHorizontal / Math.tan(horizontalHalfFov) +
      (sphere.radius * CAMERA_CLOSE_FIT_MARGIN) /
        Math.sin(horizontalHalfFov) -
      sphereAlong,
    sphereVertical / Math.tan(verticalHalfFov) +
      (sphere.radius * CAMERA_CLOSE_FIT_MARGIN) /
        Math.sin(verticalHalfFov) -
      sphereAlong,
    camera.near +
      sphere.radius * CAMERA_CLOSE_FIT_MARGIN -
      sphereAlong,
  );

  const dotOffset = redDot.clone().sub(target);
  const dotAlong = dotOffset.dot(forward);
  const dotDistance = Math.max(
    (Math.abs(dotOffset.dot(right)) * CAMERA_CLOSE_FIT_MARGIN) /
      Math.tan(horizontalHalfFov) -
      dotAlong,
    (Math.abs(dotOffset.dot(cameraUp)) * CAMERA_CLOSE_FIT_MARGIN) /
      Math.tan(verticalHalfFov) -
      dotAlong,
    camera.near - dotAlong,
  );
  let boardDistance = 0;
  for (const x of [-boardHalfExtent, boardHalfExtent]) {
    for (const z of [-boardHalfExtent, boardHalfExtent]) {
      const cornerOffset = new Vector3(x, 0, z).sub(target);
      const cornerAlong = cornerOffset.dot(forward);
      boardDistance = Math.max(
        boardDistance,
        (Math.abs(cornerOffset.dot(right)) *
          CAMERA_CLOSE_FIT_MARGIN) /
          Math.tan(horizontalHalfFov) -
          cornerAlong,
        (Math.abs(cornerOffset.dot(cameraUp)) *
          CAMERA_CLOSE_FIT_MARGIN) /
          Math.tan(verticalHalfFov) -
          cornerAlong,
        camera.near - cornerAlong,
      );
    }
  }
  return Math.max(
    CAM_MIN_DISTANCE,
    boardDistance,
    sphereDistance,
    dotDistance,
  );
}

/**
 * 포인터 캡처 release도 실제 캔버스 경계 기준으로 발사와 취소를 나누게 한다.
 */
function containsClientPoint(
  element: HTMLElement,
  event: PointerEvent,
): boolean {
  const rect = element.getBoundingClientRect();
  return (
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom
  );
}

/**
 * 숫자 직접 입력 중 WASD를 조작 키로 가로채지 않도록 포커스 대상을 판정한다.
 */
function isNumericInputTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement && target.type === "number";
}

/**
 * 예상하지 못한 예외도 stack을 보존해 화면과 콘솔에서 원인을 축약하지 않게 한다.
 */
function formatInteractionError(error: unknown): string {
  return error instanceof Error
    ? (error.stack ?? error.message)
    : String(error);
}

/**
 * 숨김 여부와 무관하게 모든 렌더 말을 대상으로 최근접 교차 하나만 선택한다.
 */
function raycastNearestPiece(
  runtime: InputRuntime,
  event: PointerEvent,
): string | null {
  const rect = runtime.sceneRuntime.renderer.domElement.getBoundingClientRect();
  runtime.pointerNdc.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
  runtime.raycaster.setFromCamera(
    runtime.pointerNdc,
    runtime.sceneRuntime.camera,
  );
  const intersections = runtime.raycaster.intersectObjects(
    [...runtime.sceneRuntime.pieceMeshes.values()],
    false,
  );
  return intersections[0]?.object.name ?? null;
}

/**
 * 터치일 때만 반경 안 후보 중 화면 거리가 가장 가까운 말을 고르며 동률은 id 순으로 고정한다.
 */
export function findNearestTouchPieceInScreenSpace(
  event: ScreenSpacePointer,
  candidates: readonly ScreenSpacePieceCandidate[],
  radiusPixels = TOUCH_PIECE_HIT_RADIUS_PIXELS,
): string | null {
  if (!isTouchPointerEvent(event) || radiusPixels < 0) {
    return null;
  }
  const radiusSquared = radiusPixels * radiusPixels;
  let nearestPieceId: string | null = null;
  let nearestDistanceSquared = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const distanceSquared =
      (candidate.clientX - event.clientX) ** 2 +
      (candidate.clientY - event.clientY) ** 2;
    if (
      distanceSquared > radiusSquared ||
      distanceSquared > nearestDistanceSquared ||
      (distanceSquared === nearestDistanceSquared &&
        nearestPieceId !== null &&
        candidate.pieceId >= nearestPieceId)
    ) {
      continue;
    }
    nearestPieceId = candidate.pieceId;
    nearestDistanceSquared = distanceSquared;
  }
  return nearestPieceId;
}

/**
 * 터치만 데스크톱 빨간 점 반경의 4배를 사용하고 마우스 판정은 그대로 유지한다.
 */
export function getRedDotHitRadiusPixels(
  event: Pick<ScreenSpacePointer, "pointerType">,
): number {
  return (
    RED_DOT_HIT_RADIUS_PIXELS *
    (isTouchPointerEvent(event)
      ? TOUCH_RED_DOT_HIT_RADIUS_MULTIPLIER
      : 1)
  );
}

/**
 * 터치는 현재 viewport 높이의 28%를 80~180px로 제한하고 마우스는 항상 180px를 쓴다.
 */
export function computeEffectiveMaxDragPixels(
  event: Pick<ScreenSpacePointer, "pointerType">,
  viewportHeight: number,
): number {
  if (!isTouchPointerEvent(event)) {
    return MAX_DRAG_PIXELS;
  }
  return Math.min(
    Math.max(
      viewportHeight * TOUCH_MAX_DRAG_VIEWPORT_RATIO,
      TOUCH_MAX_DRAG_MIN_PIXELS,
    ),
    MAX_DRAG_PIXELS,
  );
}

/**
 * 빨간 점에서 아래로 당긴 성분만 이번 드래그의 최대 거리 비율로 바꾼다.
 */
export function computeRedDotPullPower(
  startY: number,
  currentY: number,
  maxDragPixels = MAX_DRAG_PIXELS,
): number {
  const downwardPixels = Math.max(currentY - startY, 0);
  const normalizedPower = downwardPixels / maxDragPixels;
  // 시작 좌표와 소수 거리의 덧셈 오차로 최대점이 0.999…가 되는 경우만 정확히 1로 맞춘다.
  return normalizedPower >= 1 - Number.EPSILON
    ? 1
    : Math.min(normalizedPower, 1);
}

/**
 * 0보다 큰 아래 방향 충전만 실제 발사로 이어지게 한다.
 */
export function shouldLaunchRedDotPull(
  normalizedPower: number,
): boolean {
  return normalizedPower > 0;
}

/**
 * 당구식 터치 한 개를 조준·카메라·추가 포인터 차단 중 어디에 넘길지 결정한다.
 */
export function decideBilliardsTouchPointerRoute(
  context: BilliardsTouchPointerContext,
): BilliardsTouchPointerRoute {
  if (context.orbitTouchCount > 0) {
    return "orbit";
  }
  if (context.activeInputPointer) {
    return "blocked";
  }
  return context.hasSelectedPiece &&
    !context.strikeMode &&
    context.redDotHit
    ? "red-dot-aim"
    : "orbit";
}

/**
 * 선택 가능한 말만 현재 카메라로 투영해 터치 중심 44px 안의 최근접 후보를 찾는다.
 */
function findTouchFallbackPiece(
  runtime: InputRuntime,
  event: PointerEvent,
): string | null {
  const rect =
    runtime.sceneRuntime.renderer.domElement.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }
  const camera = runtime.sceneRuntime.camera;
  const worldPosition = new Vector3();
  const projectedPosition = new Vector3();
  const candidates: ScreenSpacePieceCandidate[] = [];
  for (const pieceId of runtime.selectablePieceIds) {
    if (!runtime.policy.canSelectPiece(pieceId)) {
      continue;
    }
    const mesh = runtime.sceneRuntime.pieceMeshes.get(pieceId);
    if (mesh === undefined) {
      continue;
    }
    mesh.getWorldPosition(worldPosition);
    projectedPosition.copy(worldPosition).project(camera);
    if (projectedPosition.z < -1 || projectedPosition.z > 1) {
      continue;
    }
    candidates.push({
      pieceId,
      clientX:
        rect.left + ((projectedPosition.x + 1) / 2) * rect.width,
      clientY:
        rect.top + ((1 - projectedPosition.y) / 2) * rect.height,
    });
  }
  return findNearestTouchPieceInScreenSpace(event, candidates);
}

/**
 * 현재 선택 말의 몸 원점이 아닌 월드 AABB 중심을 당구식 공전 중심으로 구한다.
 */
export function getSelectedTarget(runtime: InputRuntime): Vector3 {
  const pieceId = runtime.aimRuntime.selectedPieceId;
  if (pieceId === null) {
    return new Vector3();
  }
  const binding = runtime.physicsRuntime.pieces.get(pieceId);
  const mesh = runtime.sceneRuntime.pieceMeshes.get(pieceId);
  if (binding === undefined || mesh === undefined) {
    return new Vector3();
  }
  const translation = binding.body.translation();
  const rotation = binding.body.rotation();
  if (mesh.geometry.boundingBox === null) {
    mesh.geometry.computeBoundingBox();
  }
  const bounds = mesh.geometry.boundingBox;
  if (bounds === null) {
    throw new Error(`${pieceId} 공전 중심용 AABB가 없습니다.`);
  }
  // 실제 렌더 배율을 포함한 임시 행렬만 사용해 선택이 공유 메시 상태를 바꾸지 않게 한다.
  const matrix = new Matrix4().compose(
    new Vector3(translation.x, translation.y, translation.z),
    new Quaternion(rotation.x, rotation.y, rotation.z, rotation.w),
    mesh.scale,
  );
  return bounds.clone().applyMatrix4(matrix).getCenter(new Vector3());
}

/**
 * 모드와 선택 상태에 맞는 target·피치·거리 계약을 실제 시간 0.25초로 복원한다.
 */
function beginCameraRestore(
  runtime: InputRuntime,
  policy: CameraPolicy,
): void {
  const controls = runtime.sceneRuntime.controls;
  const camera = runtime.sceneRuntime.camera;
  const previousDamping = controls.enableDamping;
  controls.enableDamping = false;
  controls.update();
  controls.enableDamping = previousDamping;
  const fromTarget = controls.target.clone();
  const selected =
    policy.usesSelectedTarget &&
    runtime.aimRuntime.selectedPieceId !== null;
  const toTarget = selected ? getSelectedTarget(runtime) : new Vector3();
  const fromSpherical = new Spherical().setFromVector3(
    camera.position.clone().sub(fromTarget),
  );
  const wholeBoardDistance = runtime.sceneRuntime.minimumCameraDistance;
  const minPolarAngle = MathUtils.degToRad(
    90 - policy.maxPitchDegrees,
  );
  const maxPolarAngle = MathUtils.degToRad(
    90 - policy.minPitchDegrees,
  );
  const desiredPitch =
    policy.mode === "billiards" && selected
      ? runtime.aimParametersRuntime.tuningRuntime.settings.initialAimPitch
      : CAMERA_PITCH_DEG;
  const desiredPhi = MathUtils.clamp(
    Math.PI / 2 - MathUtils.degToRad(desiredPitch),
    minPolarAngle,
    maxPolarAngle,
  );
  const selectedId = runtime.aimRuntime.selectedPieceId;
  const selectedMesh =
    selectedId === null
      ? undefined
      : runtime.sceneRuntime.pieceMeshes.get(selectedId);
  const redDot = runtime.aimParametersRuntime.currentSolution
    ?.applicationPoint;
  const adaptiveDistance =
    selected &&
    selectedMesh !== undefined &&
    redDot !== undefined
      ? computeAdaptiveCloseDistance(
          camera,
          selectedMesh,
          toTarget,
          redDot,
          runtime.sceneRuntime.boardHalfExtent,
          desiredPhi,
          fromSpherical.theta,
        )
      : null;
  const maxDistance =
    policy.mode === "classic"
      ? Math.max(
          wholeBoardDistance * 1.8,
          runtime.sceneRuntime.boardHalfExtent * 4,
        )
      : Math.max(wholeBoardDistance, adaptiveDistance ?? 0);
  const minDistance =
    policy.mode === "classic"
      ? wholeBoardDistance
      : selected
        ? CAM_MIN_DISTANCE
        : wholeBoardDistance;
  const desiredRadius =
    policy.mode === "classic" || !selected
      ? wholeBoardDistance
      : adaptiveDistance ?? CAM_MIN_DISTANCE;
  runtime.adaptiveCloseDistance = adaptiveDistance;
  runtime.cameraTransition = {
    startedAt: performance.now(),
    fromTarget,
    toTarget,
    fromSpherical,
    toSpherical: new Spherical(
      desiredRadius,
      desiredPhi,
      fromSpherical.theta,
    ),
    minDistance,
    maxDistance,
    minPolarAngle,
    maxPolarAngle,
  };
  controls.enabled = false;
}

/**
 * OrbitControls 방위각으로 카메라에서 선택 말을 향하는 안정적인 수평 발사 방향을 만든다.
 */
export function getBilliardsHorizontalDirection(
  runtime: InputRuntime,
): Vector3 {
  const azimuth = runtime.sceneRuntime.controls.getAzimuthalAngle();
  if (Number.isFinite(azimuth)) {
    runtime.lastValidAzimuth = azimuth;
  }
  const stableAzimuth = Number.isFinite(runtime.lastValidAzimuth)
    ? runtime.lastValidAzimuth
    : 0;
  return new Vector3(
    -Math.sin(stableAzimuth),
    0,
    -Math.cos(stableAzimuth),
  ).normalize();
}

/**
 * 현재 선택과 카메라에서 당구식 해법을 한 번 계산해 점·화살표·발사 캐시에 함께 반영한다.
 */
function refreshBilliardsPreview(
  runtime: InputRuntime,
  horizontalOverride: Vector3 | null = null,
): void {
  const pieceId = runtime.aimRuntime.selectedPieceId;
  if (pieceId === null) {
    return;
  }
  const binding = runtime.physicsRuntime.pieces.get(pieceId);
  const mesh = runtime.sceneRuntime.pieceMeshes.get(pieceId);
  if (binding === undefined || mesh === undefined) {
    throw new Error(`${pieceId} 조준 미리보기 대상을 찾지 못했습니다.`);
  }
  const horizontal =
    horizontalOverride === null
      ? getBilliardsHorizontalDirection(runtime)
      : horizontalOverride.clone().normalize();
  if (runtime.aimRuntime.activeAim?.pieceId !== pieceId) {
    beginDirectedAim(runtime.aimRuntime, pieceId, horizontal, true);
  }
  const solution = updateStrikePreview(
    runtime.aimParametersRuntime,
    binding,
    mesh,
    horizontal,
  );
  runtime.preparedStrikeSolution = solution;
  updateDirectedAim(
    runtime.aimRuntime,
    solution.direction,
    runtime.aimParametersRuntime.normalizedPower,
  );
  setAimApplicationPoint(
    runtime.aimRuntime,
    solution.applicationPoint,
  );
  hideAimOccluders(
    runtime.sceneRuntime,
    pieceId,
    solution.applicationPoint,
    runtime.hiddenPieceIds,
  );
  if (runtime.failureReason !== null) {
    showAimError(runtime.aimParametersRuntime, runtime.failureReason);
  }
}

/**
 * 현재 시야의 전체 판 자동 거리를 갱신하되 사용자가 일부러 바꾼 가까운·먼 줌은 보존한다.
 */
function updateAdaptiveCloseDistance(runtime: InputRuntime): void {
  const pieceId = runtime.aimRuntime.selectedPieceId;
  const solution = runtime.aimParametersRuntime.currentSolution;
  if (
    runtime.mode !== "billiards" ||
    pieceId === null ||
    solution === null ||
    runtime.cameraTransition !== null
  ) {
    return;
  }
  const mesh = runtime.sceneRuntime.pieceMeshes.get(pieceId);
  if (mesh === undefined) {
    return;
  }
  const controls = runtime.sceneRuntime.controls;
  const spherical = new Spherical().setFromVector3(
    runtime.sceneRuntime.camera.position.clone().sub(controls.target),
  );
  const nextDistance = computeAdaptiveCloseDistance(
    runtime.sceneRuntime.camera,
    mesh,
    controls.target,
    solution.applicationPoint,
    runtime.sceneRuntime.boardHalfExtent,
    spherical.phi,
    spherical.theta,
  );
  const previousDistance = runtime.adaptiveCloseDistance;
  const followedPreviousMinimum =
    previousDistance === null ||
    Math.abs(spherical.radius - previousDistance) < 0.02;
  const deliberatelyZoomedCloser =
    previousDistance !== null &&
    spherical.radius < previousDistance - 0.02;
  controls.minDistance = CAM_MIN_DISTANCE;
  controls.maxDistance = Math.max(
    controls.maxDistance,
    nextDistance,
  );
  // 자동 구도를 따를 때만 새 전체 판 거리를 적용하고 사용자가 의도적으로 가까이 당긴 줌은 보존한다.
  if (
    followedPreviousMinimum ||
    (!deliberatelyZoomedCloser && spherical.radius < nextDistance)
  ) {
    spherical.radius = nextDistance;
    runtime.sceneRuntime.camera.position
      .setFromSpherical(spherical)
      .add(controls.target);
    runtime.sceneRuntime.camera.lookAt(controls.target);
    controls.update();
  }
  runtime.adaptiveCloseDistance = nextDistance;
}

/**
 * 선택을 교체하고 당구식에서는 즉시 power 0 미리보기와 44도 카메라 복원을 시작한다.
 */
function selectPiece(
  runtime: InputRuntime,
  pieceId: string | null,
): void {
  if (runtime.aimRuntime.selectedPieceId === pieceId) {
    return;
  }
  restoreHiddenPieceMeshes(
    runtime.sceneRuntime,
    runtime.hiddenPieceIds,
  );
  cancelAim(runtime.aimRuntime, true);
  clearStrikePreview(runtime.aimParametersRuntime);
  runtime.preparedStrikeSolution = null;
  runtime.adaptiveCloseDistance = null;
  runtime.failureReason = null;
  selectAimPiece(runtime.aimRuntime, pieceId);
  setAimPower(runtime.aimParametersRuntime, 0);
  runtime.strikeMode = false;
  clearStrikePointOverride(runtime.aimParametersRuntime);
  updateActionBar(runtime);
  runtime.state =
    pieceId !== null
      ? "selected-preview"
      : "idle";
  if (pieceId !== null) {
    try {
      refreshBilliardsPreview(runtime);
    } catch (error: unknown) {
      const reason = formatInteractionError(error);
      cancelInteraction(runtime, true);
      beginCameraRestore(runtime, runtime.strategy.cameraPolicy);
      runtime.failureReason = reason;
      showAimError(runtime.aimParametersRuntime, reason);
      return;
    }
  }
  beginCameraRestore(runtime, runtime.strategy.cameraPolicy);
}

/**
 * 숨김·캡처·키·카메라 잠금을 단일 경로에서 복구하고 선택 유지 여부만 호출자가 정한다.
 */
function cancelInteraction(
  runtime: InputRuntime,
  clearSelection: boolean,
): void {
  const captureElement = runtime.activeCaptureElement;
  const pointerId = runtime.activePointerId;
  runtime.state = "cancel";
  runtime.strategy.onAimCancel(runtime);
  cancelAim(runtime.aimRuntime, clearSelection);
  clearStrikePreview(runtime.aimParametersRuntime);
  restoreHiddenPieceMeshes(
    runtime.sceneRuntime,
    runtime.hiddenPieceIds,
  );
  runtime.preparedStrikeSolution = null;
  if (clearSelection) {
    runtime.adaptiveCloseDistance = null;
    runtime.strikeMode = false;
    runtime.orbitTouchPointerIds.clear();
    clearStrikePointOverride(runtime.aimParametersRuntime);
    updateActionBar(runtime);
  }
  runtime.activePointerId = null;
  runtime.activeCaptureElement = null;
  runtime.gesture = null;
  runtime.heldCameraKeys.clear();
  if (
    captureElement !== null &&
    pointerId !== null &&
    captureElement.hasPointerCapture(pointerId)
  ) {
    captureElement.releasePointerCapture(pointerId);
  }
  const controls = runtime.sceneRuntime.controls;
  controls.enableDamping = true;
  controls.enabled =
    runtime.cameraTransition === null &&
    !runtime.policy.isCameraRotating() &&
    !runtime.policy.isInputBlocked();
  runtime.state =
    !clearSelection &&
    runtime.aimRuntime.selectedPieceId !== null
      ? "selected-preview"
      : "idle";
}
/**
 * 외부 튜닝 깨우기도 내부 취소와 동일한 정리 계약을 사용하도록 공개한다.
 */
export function cancelInputInteraction(
  runtime: InputRuntime,
  clearSelection = true,
): void {
  cancelInteraction(runtime, clearSelection);
  if (clearSelection && runtime.mode === "billiards") {
    beginCameraRestore(runtime, runtime.strategy.cameraPolicy);
  }
}

/**
 * 현재 전략의 캐시를 복사해 고정 step 발사 큐가 소비할 불변 요청을 만든다.
 */
function buildLaunchRequest(
  runtime: InputRuntime,
): LaunchRequest | null {
  const activeAim = runtime.aimRuntime.activeAim;
  if (activeAim === null || activeAim.normalizedPower <= 0) {
    return null;
  }
  return {
    pieceId: activeAim.pieceId,
    direction: runtime.strategy.computeLaunchDirection(runtime),
    normalizedPower: activeAim.normalizedPower,
    applicationPoint:
      runtime.strategy.computeApplicationPoint(runtime),
  };
}

/**
 * 큐 승인 때만 선택 해제와 펄스를 실행하고 거절 때는 미리보기와 원인을 남긴다.
 */
function commitActiveLaunch(runtime: InputRuntime): void {
  runtime.state = "launch";
  let request: LaunchRequest | null;
  try {
    request = buildLaunchRequest(runtime);
  } catch (error: unknown) {
    const reason = formatInteractionError(error);
    cancelInteraction(runtime, false);
    runtime.failureReason = reason;
    showAimError(runtime.aimParametersRuntime, reason);
    return;
  }
  if (request === null) {
    cancelInteraction(runtime, false);
    return;
  }
  const dotPoint =
    runtime.aimParametersRuntime.currentSolution?.applicationPoint;
  if (runtime.mode === "billiards" && dotPoint !== undefined) {
    const distance = dotPoint.distanceTo(request.applicationPoint);
    console.info(
      `[조준] 빨간 점-적용점 거리=${distance.toExponential(3)}`,
    );
    if (distance > 1e-6) {
      const reason =
        `빨간 점과 실제 적용점이 ${distance}만큼 어긋났습니다.`;
      cancelInteraction(runtime, false);
      runtime.failureReason = reason;
      showAimError(runtime.aimParametersRuntime, reason);
      return;
    }
  }
  let outcome: LaunchQueueOutcome;
  try {
    outcome = runtime.policy.queueLaunch(request);
  } catch (error: unknown) {
    const reason = formatInteractionError(error);
    cancelInteraction(runtime, false);
    runtime.failureReason = reason;
    showAimError(runtime.aimParametersRuntime, reason);
    return;
  }
  if (outcome.accepted) {
    runtime.failureReason = null;
    cancelInteraction(runtime, true);
    startLaunchPulse(runtime.aimRuntime, request.pieceId);
    return;
  }
  const reason = outcome.reason ?? "알 수 없는 이유로 발사 큐가 거절했습니다.";
  cancelInteraction(runtime, false);
  runtime.failureReason = reason;
  showAimError(runtime.aimParametersRuntime, reason);
}

/**
 * 클래식과 당구식이 같은 포인터 상태 기계에서 계산 전략만 교체하도록 구성한다.
 */
function createStrategies(): Record<InputMode, InputModeStrategy> {
  return {
    classic: {
      cameraPolicy: {
        mode: "classic",
        minPitchDegrees: CAMERA_PITCH_DEG,
        maxPitchDegrees: CAMERA_PITCH_DEG,
        usesSelectedTarget: false,
      },
      usesHitPoint: false,
      computeLaunchDirection: (runtime) => {
        const aim = runtime.aimRuntime.activeAim;
        if (aim === null) {
          throw new Error("클래식 발사 방향을 계산할 조준이 없습니다.");
        }
        return aim.direction.clone().normalize();
      },
      computeApplicationPoint: (runtime) => {
        const pieceId = runtime.aimRuntime.activeAim?.pieceId;
        if (pieceId === undefined) {
          throw new Error("클래식 발사 적용점이 준비되지 않았습니다.");
        }
        const binding = runtime.physicsRuntime.pieces.get(pieceId);
        const mesh = runtime.sceneRuntime.pieceMeshes.get(pieceId);
        if (binding === undefined || mesh === undefined) {
          throw new Error(`${pieceId} 클래식 적용점 대상을 찾지 못했습니다.`);
        }
        return resolveStrikeApplicationPoint(
          false,
          computeStrikeApplicationPoint(
            binding,
            mesh,
            runtime.aimParametersRuntime.tuningRuntime.settings
              .strikeHeightRatio,
          ),
          runtime.aimParametersRuntime.strikePointOverride,
        );
      },
      onAimBegin: (runtime, pieceId, event) => {
        if (event === undefined) {
          throw new Error("클래식 조준 시작 포인터가 없습니다.");
        }
        beginAim(
          runtime.aimRuntime,
          pieceId,
          event.clientX,
          event.clientY,
          freezeCameraBasis(runtime.sceneRuntime.camera),
        );
        const binding = runtime.physicsRuntime.pieces.get(pieceId);
        const mesh = runtime.sceneRuntime.pieceMeshes.get(pieceId);
        if (binding === undefined || mesh === undefined) {
          throw new Error(`${pieceId} 클래식 적용점 대상을 찾지 못했습니다.`);
        }
        setAimApplicationPoint(
          runtime.aimRuntime,
          resolveStrikeApplicationPoint(
            false,
            computeStrikeApplicationPoint(
              binding,
              mesh,
              runtime.aimParametersRuntime.tuningRuntime.settings
                .strikeHeightRatio,
            ),
            runtime.aimParametersRuntime.strikePointOverride,
          ),
        );
      },
      onAimCancel: () => {},
    },
    billiards: {
      cameraPolicy: {
        mode: "billiards",
        minPitchDegrees: CAM_PITCH_MIN,
        maxPitchDegrees: CAM_PITCH_MAX,
        usesSelectedTarget: true,
      },
      usesHitPoint: true,
      computeLaunchDirection: (runtime) => {
        if (runtime.preparedStrikeSolution === null) {
          throw new Error("당구식 발사 방향이 준비되지 않았습니다.");
        }
        return runtime.preparedStrikeSolution.direction.clone();
      },
      computeApplicationPoint: (runtime) => {
        if (runtime.preparedStrikeSolution === null) {
          throw new Error("당구식 실제 적용점이 준비되지 않았습니다.");
        }
        return runtime.preparedStrikeSolution.applicationPoint.clone();
      },
      onAimBegin: (runtime, pieceId) => {
        beginDirectedAim(
          runtime.aimRuntime,
          pieceId,
          getBilliardsHorizontalDirection(runtime),
          true,
        );
      },
      onAimCancel: (runtime) => {
        setAimPower(runtime.aimParametersRuntime, 0);
      },
    },
  };
}

/**
 * 모드 버튼의 pressed 상태를 현재 전략과 일치시킨다.
 */
function updateModeToggle(runtime: InputRuntime): void {
  for (const button of runtime.modeToggle.querySelectorAll("button")) {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.mode === runtime.mode),
    );
  }
}

/**
 * 담돌받기 / 타점선택 앙션 바를 현재 상태로 보여준다.
 */
function updateActionBar(runtime: InputRuntime): void {
  const selected =
    runtime.mode === "billiards" &&
    runtime.aimRuntime.selectedPieceId !== null;

  runtime.actionBar.hidden = !selected;
  // 선택·동작 전환 직후 다음 입력 프레임에서 위치를 반드시 다시 계산한다.
  runtime.actionBarLastPositionedAt = Number.NEGATIVE_INFINITY;
  for (const button of runtime.actionBar.querySelectorAll("button")) {
    const active =
      button.dataset.action === "strike"
        ? runtime.strikeMode
        : !runtime.strikeMode;
    button.setAttribute("aria-pressed", String(active));
  }
}

/**
 * 선택 말의 월드 AABB 여덟 꼭짓점을 화면으로 투영해 중심과 겹침 금지 외곽을 만든다.
 */
function projectActionBarAnchor(
  runtime: InputRuntime,
  mesh: Mesh,
  viewport: ActionBarRect,
): ActionBarAnchor | null {
  if (mesh.geometry.boundingBox === null) {
    mesh.geometry.computeBoundingBox();
  }
  const bounds = mesh.geometry.boundingBox;
  if (bounds === null) {
    return null;
  }
  mesh.updateWorldMatrix(true, false);
  const camera = runtime.sceneRuntime.camera;
  const projected = new Vector3();
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        projected
          .set(x, y, z)
          .applyMatrix4(mesh.matrixWorld)
          .project(camera);
        const clientX =
          viewport.left +
          ((projected.x + 1) / 2) *
            (viewport.right - viewport.left);
        const clientY =
          viewport.top +
          ((1 - projected.y) / 2) *
            (viewport.bottom - viewport.top);
        left = Math.min(left, clientX);
        top = Math.min(top, clientY);
        right = Math.max(right, clientX);
        bottom = Math.max(bottom, clientY);
      }
    }
  }
  if (![left, top, right, bottom].every(Number.isFinite)) {
    return null;
  }
  return {
    x: (left + right) / 2,
    y: (top + bottom) / 2,
    pieceRect: { left, top, right, bottom },
  };
}

/**
 * 선택·카메라·패널 변화만 100ms 간격으로 반영해 액션 바를 말 옆에 고정한다.
 */
function updateActionBarPosition(
  runtime: InputRuntime,
  now: number,
): void {
  const pieceId = runtime.aimRuntime.selectedPieceId;
  if (pieceId === null || runtime.actionBar.hidden) {
    runtime.actionBarSelectedPieceId = null;
    return;
  }
  const panelVisible = !runtime.strikePointPanel.root.hidden;
  const selectionChanged =
    runtime.actionBarSelectedPieceId !== pieceId;
  const panelVisibilityChanged =
    runtime.actionBarPanelWasVisible !== panelVisible;
  if (
    !selectionChanged &&
    !panelVisibilityChanged &&
    now - runtime.actionBarLastPositionedAt <
      ACTION_BAR_POSITION_INTERVAL_MS
  ) {
    return;
  }
  const mesh = runtime.sceneRuntime.pieceMeshes.get(pieceId);
  if (mesh === undefined) {
    return;
  }
  const canvasRect =
    runtime.sceneRuntime.renderer.domElement.getBoundingClientRect();
  const viewport: ActionBarRect = {
    left: canvasRect.left,
    top: canvasRect.top,
    right: canvasRect.right,
    bottom: canvasRect.bottom,
  };
  const anchor = projectActionBarAnchor(runtime, mesh, viewport);
  const popupRect = runtime.actionBar.getBoundingClientRect();
  if (
    anchor === null ||
    popupRect.width <= 0 ||
    popupRect.height <= 0
  ) {
    return;
  }
  const panelClientRect = panelVisible
    ? runtime.strikePointPanel.root.getBoundingClientRect()
    : null;
  const panelRect: ActionBarRect | null =
    panelClientRect === null
      ? null
      : {
          left: panelClientRect.left,
          top: panelClientRect.top,
          right: panelClientRect.right,
          bottom: panelClientRect.bottom,
        };
  const placement = computeActionBarPlacement(
    viewport,
    anchor,
    { width: popupRect.width, height: popupRect.height },
    panelRect,
  );
  const offsetParentRect =
    runtime.actionBar.offsetParent instanceof HTMLElement
      ? runtime.actionBar.offsetParent.getBoundingClientRect()
      : { left: 0, top: 0 };
  const localLeft = placement.left - offsetParentRect.left;
  const localTop = placement.top - offsetParentRect.top;
  if (
    runtime.actionBarLastLeft === null ||
    runtime.actionBarLastTop === null ||
    Math.abs(localLeft - runtime.actionBarLastLeft) >= 0.5 ||
    Math.abs(localTop - runtime.actionBarLastTop) >= 0.5 ||
    selectionChanged ||
    panelVisibilityChanged
  ) {
    runtime.actionBar.style.left = `${localLeft}px`;
    runtime.actionBar.style.top = `${localTop}px`;
    runtime.actionBar.dataset.side = placement.side;
    runtime.actionBarLastLeft = localLeft;
    runtime.actionBarLastTop = localTop;
  }
  runtime.actionBarSelectedPieceId = pieceId;
  runtime.actionBarPanelWasVisible = panelVisible;
  runtime.actionBarLastPositionedAt = now;
}

/**
 * 선택한 기물 표면을 킭했을 때 첫 교차점을 반환한다.
 */
function raycastSelectedPieceSurface(
  runtime: InputRuntime,
  event: PointerEvent,
): Vector3 | null {
  const pieceId = runtime.aimRuntime.selectedPieceId;
  if (pieceId === null) {
    return null;
  }
  const mesh = runtime.sceneRuntime.pieceMeshes.get(pieceId);
  if (mesh === undefined) {
    return null;
  }
  const rect = runtime.sceneRuntime.renderer.domElement.getBoundingClientRect();
  runtime.pointerNdc.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
  runtime.raycaster.setFromCamera(
    runtime.pointerNdc,
    runtime.sceneRuntime.camera,
  );
  const intersections = runtime.raycaster.intersectObject(mesh, false);
  return intersections[0]?.point.clone() ?? null;
}

/**
 * 모드 전환은 현재 상호작용을 완전히 정리한 뒤 대상 카메라 계약을 복원한다.
 */
export function switchInputMode(
  runtime: InputRuntime,
  mode: InputMode,
): void {
  if (runtime.mode === mode) {
    return;
  }
  cancelInteraction(runtime, true);
  runtime.mode = mode;
  runtime.strategy = runtime.strategies[mode];
  runtime.failureReason = null;
  window.localStorage.setItem(INPUT_MODE_STORAGE_KEY, mode);
  runtime.policy.onModeChanged(mode);
  updateModeToggle(runtime);
  updateActionBar(runtime);
  beginCameraRestore(runtime, runtime.strategy.cameraPolicy);
}

/**
 * 빨간 점을 캡처 단계에서 먼저 판정하고 미히트는 기존 OrbitControls 흐름에 넘긴다.
 */
function handleCanvasPointerDown(
  runtime: InputRuntime,
  event: PointerEvent,
): void {
  if (runtime.policy.isInputBlocked()) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }
  if (runtime.policy.isExternalAimActive()) {
    // AI 조준 중에는 선택만 무시하고 이벤트를 막지 않아 OrbitControls 공전은 계속 허용한다.
    return;
  }
  const canvas = runtime.sceneRuntime.renderer.domElement;
  const selectedId = runtime.aimRuntime.selectedPieceId;
  const isBilliardsTouch =
    runtime.mode === "billiards" &&
    isTouchPointerEvent(event);
  const selectedCanAim =
    selectedId !== null &&
    runtime.policy.canSelectPiece(selectedId);
  const touchRoute = isBilliardsTouch
    ? decideBilliardsTouchPointerRoute({
        hasSelectedPiece: selectedCanAim,
        strikeMode: runtime.strikeMode,
        redDotHit:
          selectedCanAim &&
          isRedDotHit(
            runtime.aimParametersRuntime,
            event.clientX,
            event.clientY,
            getRedDotHitRadiusPixels(event),
          ),
        activeInputPointer:
          runtime.activePointerId !== null,
        orbitTouchCount:
          runtime.orbitTouchPointerIds.size,
      })
    : null;
  if (
    touchRoute === "orbit" &&
    runtime.orbitTouchPointerIds.size > 0
  ) {
    // OrbitControls가 시작한 멀티터치에는 새 손가락도 그대로 넘기고 탭 후보만 폐기한다.
    runtime.orbitTouchPointerIds.add(event.pointerId);
    if (runtime.gesture?.source === "billiards-canvas") {
      runtime.gesture.candidatePieceId = null;
      runtime.gesture.maximumDistance =
        Number.POSITIVE_INFINITY;
    }
    return;
  }
  if (touchRoute === "blocked") {
    // 빨간 점 조준 중 추가 손가락은 카메라까지 전달하지 않아 두 입력 소유자가 섞이지 않게 한다.
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }
  if (runtime.state === "charging") {
    event.preventDefault();
    event.stopImmediatePropagation();
    cancelInteraction(runtime, false);
    return;
  }
  if (runtime.activePointerId !== null) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }
  if (
    runtime.cameraTransition !== null ||
    runtime.policy.isCameraRotating()
  ) {
    return;
  }
  if (event.pointerType === "mouse" && event.button !== 0) {
    return;
  }

  const canCharge =
    runtime.mode === "billiards" &&
    selectedCanAim &&
    !runtime.strikeMode &&
    (touchRoute === "red-dot-aim" ||
      (!isBilliardsTouch &&
        isRedDotHit(
          runtime.aimParametersRuntime,
          event.clientX,
          event.clientY,
          getRedDotHitRadiusPixels(event),
        )));
  if (canCharge) {
    event.preventDefault();
    event.stopImmediatePropagation();
    runtime.sceneRuntime.controls.enabled = false;
    runtime.state = "charging";
    runtime.activePointerId = event.pointerId;
    runtime.activeCaptureElement = canvas;
    runtime.gesture = {
      source: "red-dot",
      startX: event.clientX,
      startY: event.clientY,
      maximumDistance: 0,
      candidatePieceId: selectedId,
      maxDragPixels: computeEffectiveMaxDragPixels(
        event,
        window.innerHeight,
      ),
    };
    setAimPower(runtime.aimParametersRuntime, 0);
    canvas.setPointerCapture(event.pointerId);
    return;
  }

  if (
    runtime.mode === "billiards" &&
    runtime.strikeMode &&
    selectedId !== null &&
    !isBilliardsTouch
  ) {
    event.preventDefault();
    event.stopImmediatePropagation();
    runtime.activePointerId = event.pointerId;
    runtime.activeCaptureElement = canvas;
    runtime.gesture = {
      source: "billiards-canvas",
      startX: event.clientX,
      startY: event.clientY,
      maximumDistance: 0,
      candidatePieceId: selectedId,
      maxDragPixels: MAX_DRAG_PIXELS,
    };
    canvas.setPointerCapture(event.pointerId);
    return;
  }

  const nearestPieceId = raycastNearestPiece(runtime, event);
  let selectablePieceId =
    nearestPieceId !== null &&
    runtime.selectablePieceIds.has(nearestPieceId) &&
    runtime.policy.canSelectPiece(nearestPieceId)
      ? nearestPieceId
      : null;
  if (
    selectablePieceId === null &&
    runtime.mode === "billiards" &&
    isTouchPointerEvent(event)
  ) {
    selectablePieceId = findTouchFallbackPiece(runtime, event);
  }
  if (runtime.mode === "classic") {
    if (selectablePieceId === null) {
      // 빈 판은 기존 OrbitControls가 그대로 카메라 제스처로 처리한다.
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    runtime.sceneRuntime.controls.enabled = false;
    runtime.state = "aiming";
    runtime.activePointerId = event.pointerId;
    runtime.activeCaptureElement = canvas;
    runtime.gesture = {
      source: "classic-canvas",
      startX: event.clientX,
      startY: event.clientY,
      maximumDistance: 0,
      candidatePieceId: selectablePieceId,
      maxDragPixels: MAX_DRAG_PIXELS,
    };
    canvas.setPointerCapture(event.pointerId);
    runtime.strategy.onAimBegin(runtime, selectablePieceId, event);
    playPieceClickSound();
    return;
  }

  runtime.activePointerId = event.pointerId;
  runtime.activeCaptureElement =
    isBilliardsTouch ? null : canvas;
  runtime.gesture = {
    source: "billiards-canvas",
    startX: event.clientX,
    startY: event.clientY,
    maximumDistance: 0,
    candidatePieceId: selectablePieceId,
    maxDragPixels: MAX_DRAG_PIXELS,
  };
  if (isBilliardsTouch) {
    // 카메라 터치는 OrbitControls가 pointer capture를 소유하도록 입력 런타임은 관찰만 한다.
    runtime.orbitTouchPointerIds.add(event.pointerId);
  } else {
    canvas.setPointerCapture(event.pointerId);
  }
}

/**
 * 활성 포인터 이동을 클래식 드래그, 카메라 탭 판정, 아래 방향 충전에만 반영한다.
 */
function handleCanvasPointerMove(
  runtime: InputRuntime,
  event: PointerEvent,
): void {
  if (runtime.policy.isInputBlocked()) {
    event.preventDefault();
    return;
  }
  const gesture = runtime.gesture;
  if (
    event.pointerId !== runtime.activePointerId ||
    gesture === null
  ) {
    return;
  }
  const distance = Math.hypot(
    event.clientX - gesture.startX,
    event.clientY - gesture.startY,
  );
  gesture.maximumDistance = Math.max(
    gesture.maximumDistance,
    distance,
  );
  if (gesture.source === "classic-canvas") {
    event.preventDefault();
    updateAimPointer(
      runtime.aimRuntime,
      event.clientX,
      event.clientY,
    );
  } else if (gesture.source === "red-dot") {
    event.preventDefault();
    setAimPower(
      runtime.aimParametersRuntime,
      computeRedDotPullPower(
        gesture.startY,
        event.clientY,
        gesture.maxDragPixels,
      ),
    );
    const solution = runtime.preparedStrikeSolution;
    if (solution !== null) {
      updateDirectedAim(
        runtime.aimRuntime,
        solution.direction,
        runtime.aimParametersRuntime.normalizedPower,
      );
    }
  }
}

/**
 * 빨간 점 release는 캔버스 안 어디서나 발사하고 나머지는 탭 선택 또는 클래식 발사로 끝낸다.
 */
function handleCanvasPointerUp(
  runtime: InputRuntime,
  event: PointerEvent,
): void {
  if (
    isTouchPointerEvent(event) &&
    runtime.orbitTouchPointerIds.delete(event.pointerId) &&
    event.pointerId !== runtime.activePointerId
  ) {
    // 보조 카메라 손가락은 OrbitControls만 마무리하고 입력 탭 판정에는 참여하지 않는다.
    return;
  }
  if (runtime.policy.isInputBlocked()) {
    event.preventDefault();
    return;
  }
  const gesture = runtime.gesture;
  if (
    event.pointerId !== runtime.activePointerId ||
    gesture === null
  ) {
    return;
  }
  const canvas = runtime.sceneRuntime.renderer.domElement;
  if (!containsClientPoint(canvas, event)) {
    cancelInteraction(runtime, false);
    return;
  }
  if (gesture.source === "red-dot") {
    event.preventDefault();
    if (
      shouldLaunchRedDotPull(
        runtime.aimParametersRuntime.normalizedPower,
      )
    ) {
      try {
        // 마지막 키 적분 뒤 카메라에서 다시 계산해 포인터다운 때가 아닌 릴리스 순간 방향을 발사 요청에 넣는다.
        refreshBilliardsPreview(runtime);
      } catch (error: unknown) {
        const reason = formatInteractionError(error);
        cancelInteraction(runtime, false);
        runtime.failureReason = reason;
        showAimError(runtime.aimParametersRuntime, reason);
        return;
      }
      commitActiveLaunch(runtime);
    } else {
      cancelInteraction(runtime, false);
    }
    return;
  }
  if (gesture.source === "classic-canvas") {
    event.preventDefault();
    commitActiveLaunch(runtime);
    return;
  }

  const tapped =
    gesture.maximumDistance <= TAP_MAX_DISTANCE_PIXELS;
  const candidatePieceId = gesture.candidatePieceId;
  if (tapped && candidatePieceId !== null) {
    playPieceClickSound();
  }
  if (
    tapped &&
    runtime.strikeMode &&
    candidatePieceId === runtime.aimRuntime.selectedPieceId
  ) {
    const point = raycastSelectedPieceSurface(runtime, event);
    if (point !== null) {
      setStrikePointOverride(runtime.aimParametersRuntime, point);
      try {
        refreshBilliardsPreview(runtime);
      } catch (error: unknown) {
        const reason = formatInteractionError(error);
        cancelInteraction(runtime, true);
        runtime.failureReason = reason;
        showAimError(runtime.aimParametersRuntime, reason);
        return;
      }
    }
    cancelInteraction(runtime, false);
    refreshBilliardsPreview(runtime);
    return;
  }
  cancelInteraction(runtime, false);
  if (tapped) {
    selectPiece(runtime, candidatePieceId);
  }
}

/**
 * 실제 시간 각속도를 구면 theta와 phi에 직접 한 번 적분해 프레임률별 damping 오차를 없앤다.
 */
function integrateKeyboardCamera(
  runtime: InputRuntime,
  wallDeltaSeconds: number,
): void {
  // 당구식 충전은 포인터 공전만 잠그고 이 키 적분은 계속해 당기는 동안에도 조준을 바꾸게 한다.
  if (
    wallDeltaSeconds <= 0 ||
    runtime.heldCameraKeys.size === 0 ||
    runtime.cameraTransition !== null ||
    runtime.policy.isCameraRotating() ||
    runtime.policy.isInputBlocked()
  ) {
    return;
  }
  const left =
    runtime.heldCameraKeys.has("KeyA") ? 1 : 0;
  const right =
    runtime.heldCameraKeys.has("KeyD") ? 1 : 0;
  const raise =
    runtime.mode === "billiards" &&
    runtime.heldCameraKeys.has("KeyW")
      ? 1
      : 0;
  const lower =
    runtime.mode === "billiards" &&
    runtime.heldCameraKeys.has("KeyS")
      ? 1
      : 0;
  const rate = MathUtils.degToRad(
    runtime.aimParametersRuntime.tuningRuntime.settings
      .cameraKeyDegreesPerSecond,
  );
  const controls = runtime.sceneRuntime.controls;
  const spherical = new Spherical().setFromVector3(
    runtime.sceneRuntime.camera.position
      .clone()
      .sub(controls.target),
  );
  spherical.theta += (left - right) * rate * wallDeltaSeconds;
  spherical.phi += (lower - raise) * rate * wallDeltaSeconds;
  spherical.phi = MathUtils.clamp(
    spherical.phi,
    controls.minPolarAngle,
    controls.maxPolarAngle,
  );
  controls.enableDamping = false;
  runtime.sceneRuntime.camera.position
    .setFromSpherical(spherical)
    .add(controls.target);
  runtime.sceneRuntime.camera.lookAt(controls.target);
  controls.update();
}

/**
 * 모드 버튼과 캔버스 이벤트를 하나의 공유 포인터·키 상태 기계에 연결한다.
 */
export function createInputRuntime(
  sceneRuntime: SceneRuntime,
  physicsRuntime: PhysicsRuntime,
  aimRuntime: AimRuntime,
  aimParametersRuntime: AimParametersRuntime,
  policy: InputPolicy,
): InputRuntime {
  const strategies = createStrategies();
  const storedMode = window.localStorage.getItem(
    INPUT_MODE_STORAGE_KEY,
  );
  const initialMode: InputMode =
    storedMode === "classic" || storedMode === "billiards"
      ? storedMode
      : "billiards";
  const modeToggle = document.createElement("div");
  modeToggle.className = "input-mode-toggle";
  modeToggle.setAttribute("role", "group");
  modeToggle.setAttribute("aria-label", "조작 모드");
  for (const [mode, label] of [
    ["billiards", "당구식"],
    ["classic", "클래식"],
  ] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.mode = mode;
    button.textContent = label;
    modeToggle.append(button);
  }
  sceneRuntime.renderer.domElement.parentElement?.append(modeToggle);
  const actionBar = document.createElement("div");
  actionBar.className = "strike-action-bar";
  actionBar.setAttribute("role", "group");
  actionBar.setAttribute("aria-label", "동작 선택");
  actionBar.hidden = true;
  for (const [action, label] of [
    ["launch", "발사"],
    ["strike", "타점선택"],
  ] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.action = action;
    button.textContent = label;
    actionBar.append(button);
  }
  sceneRuntime.renderer.domElement.parentElement?.append(actionBar);
  const overlayContainer =
    sceneRuntime.renderer.domElement.parentElement;
  if (overlayContainer === null) {
    throw new Error("타점 패널을 붙일 게임 컨테이너가 없습니다.");
  }
  const strikePointPanel =
    createStrikePointPanel(overlayContainer);
  const runtime: InputRuntime = {
    sceneRuntime,
    physicsRuntime,
    aimRuntime,
    aimParametersRuntime,
    policy,
    strategies,
    strategy: strategies[initialMode],
    mode: initialMode,
    raycaster: new Raycaster(),
    pointerNdc: new Vector2(),
    selectablePieceIds: new Set(physicsRuntime.pieces.keys()),
    state: "idle",
    activePointerId: null,
    activeCaptureElement: null,
    gesture: null,
    orbitTouchPointerIds: new Set(),
    cameraTransition: null,
    preparedStrikeSolution: null,
    lastValidAzimuth: sceneRuntime.controls.getAzimuthalAngle(),
    heldCameraKeys: new Set(),
    lastUpdateTime: null,
    hiddenPieceIds: new Set(),
    failureReason: null,
    adaptiveCloseDistance: null,
    modeToggle,
    actionBar,
    actionBarSelectedPieceId: null,
    actionBarLastPositionedAt: Number.NEGATIVE_INFINITY,
    actionBarLastLeft: null,
    actionBarLastTop: null,
    actionBarPanelWasVisible: false,
    strikeMode: false,
    strikePointPanel,
  };

  for (const eventName of [
    "pointerdown",
    "pointermove",
    "pointerup",
    "pointercancel",
  ]) {
    strikePointPanel.root.addEventListener(eventName, (event) => {
      event.stopPropagation();
    });
  }
  strikePointPanel.canvas.addEventListener(
    "pointerdown",
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (
        runtime.mode !== "billiards" ||
        !runtime.strikeMode
      ) {
        return;
      }
      const pieceId = runtime.aimRuntime.selectedPieceId;
      const mesh =
        pieceId === null
          ? undefined
          : runtime.sceneRuntime.pieceMeshes.get(pieceId);
      if (mesh === undefined) {
        return;
      }
      const point = pickStrikePointFromPanel(
        runtime.strikePointPanel,
        mesh,
        event.clientX,
        event.clientY,
      );
      if (point === null) {
        return;
      }
      playPieceClickSound();
      setStrikePointOverride(
        runtime.aimParametersRuntime,
        point,
      );
      try {
        refreshBilliardsPreview(runtime);
      } catch (error: unknown) {
        const reason = formatInteractionError(error);
        cancelInteraction(runtime, true);
        runtime.failureReason = reason;
        showAimError(runtime.aimParametersRuntime, reason);
      }
    },
  );
  strikePointPanel.resetButton.addEventListener("click", () => {
    clearStrikePointOverride(runtime.aimParametersRuntime);
    if (runtime.aimRuntime.selectedPieceId === null) {
      return;
    }
    try {
      refreshBilliardsPreview(runtime);
    } catch (error: unknown) {
      const reason = formatInteractionError(error);
      cancelInteraction(runtime, true);
      runtime.failureReason = reason;
      showAimError(runtime.aimParametersRuntime, reason);
    }
  });

  for (const button of modeToggle.querySelectorAll("button")) {
    button.addEventListener("click", () => {
      const mode = button.dataset.mode;
      if (mode === "classic" || mode === "billiards") {
        switchInputMode(runtime, mode);
      }
    });
  }
  updateActionBar(runtime);
  for (const button of actionBar.querySelectorAll("button")) {
    button.addEventListener("click", () => {
      if (runtime.mode !== "billiards") {
        // 클래식은 즉시 드래그 전용이라 숨은 동작 버튼을 강제로 눌러도 타점 모드에 들어가지 않는다.
        runtime.strikeMode = false;
        return;
      }
      const action = button.dataset.action;
      if (action === "strike") {
        runtime.strikeMode = true;
      } else if (action === "launch") {
        runtime.strikeMode = false;
        if (runtime.aimRuntime.selectedPieceId !== null) {
          try {
            refreshBilliardsPreview(runtime);
          } catch (error: unknown) {
            const reason = formatInteractionError(error);
            cancelInteraction(runtime, true);
            runtime.failureReason = reason;
            showAimError(runtime.aimParametersRuntime, reason);
          }
        }
      }
      updateActionBar(runtime);
    });
  }
  const canvas = sceneRuntime.renderer.domElement;
  canvas.addEventListener("contextmenu", (event) =>
    event.preventDefault(),
  );
  canvas.addEventListener(
    "pointerdown",
    (event) => handleCanvasPointerDown(runtime, event),
    { capture: true },
  );
  canvas.addEventListener("pointermove", (event) =>
    handleCanvasPointerMove(runtime, event),
  );
  canvas.addEventListener("pointerup", (event) =>
    handleCanvasPointerUp(runtime, event),
  );
  const cancelPointer = (event?: PointerEvent): void => {
    if (
      event !== undefined &&
      isTouchPointerEvent(event)
    ) {
      runtime.orbitTouchPointerIds.delete(event.pointerId);
    }
    if (
      runtime.activePointerId !== null &&
      (event === undefined ||
        event.pointerId === runtime.activePointerId)
    ) {
      cancelInteraction(runtime, false);
    }
  };
  canvas.addEventListener("pointercancel", cancelPointer);
  canvas.addEventListener("lostpointercapture", cancelPointer);

  window.addEventListener("keydown", (event) => {
    if (runtime.policy.isInputBlocked()) {
      if (
        event.code === "Escape" ||
        CAMERA_KEY_CODES.has(event.code)
      ) {
        event.preventDefault();
      }
      runtime.heldCameraKeys.clear();
      return;
    }
    if (event.code === "Escape") {
      cancelInteraction(runtime, false);
      return;
    }
    if (
      !CAMERA_KEY_CODES.has(event.code) ||
      isNumericInputTarget(event.target)
    ) {
      return;
    }
    if (
      runtime.mode === "classic" &&
      (event.code === "KeyW" || event.code === "KeyS")
    ) {
      return;
    }
    runtime.heldCameraKeys.add(event.code);
    event.preventDefault();
  });
  window.addEventListener("keyup", (event) => {
    runtime.heldCameraKeys.delete(event.code);
  });
  window.addEventListener("blur", () =>
    cancelInputInteraction(runtime, true),
  );
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") {
      cancelInputInteraction(runtime, true);
      runtime.lastUpdateTime = null;
    }
  });
  sceneRuntime.onCameraFitChanged = () => {
    cancelInteraction(runtime, true);
    beginCameraRestore(runtime, runtime.strategy.cameraPolicy);
  };
  updateModeToggle(runtime);
  policy.onModeChanged(initialMode);
  beginCameraRestore(runtime, runtime.strategy.cameraPolicy);
  return runtime;
}

/**
 * 카메라 복원과 실제 시간 키 적분 뒤 선택 상태의 점·화살표를 매 프레임 갱신한다.
 */
export function updateInputRuntime(
  runtime: InputRuntime,
  now: number,
): void {
  const wallDeltaSeconds =
    runtime.lastUpdateTime === null
      ? 0
      : Math.max((now - runtime.lastUpdateTime) / 1000, 0);
  runtime.lastUpdateTime = now;

  const transition = runtime.cameraTransition;
  if (transition !== null) {
    const progress = Math.min(
      (now - transition.startedAt) /
        1000 /
        CAMERA_TARGET_TRANSITION_SECONDS,
      1,
    );
    const eased = progress * progress * (3 - 2 * progress);
    runtime.sceneRuntime.controls.target.lerpVectors(
      transition.fromTarget,
      transition.toTarget,
      eased,
    );
    const spherical = new Spherical(
      MathUtils.lerp(
        transition.fromSpherical.radius,
        transition.toSpherical.radius,
        eased,
      ),
      MathUtils.lerp(
        transition.fromSpherical.phi,
        transition.toSpherical.phi,
        eased,
      ),
      MathUtils.lerp(
        transition.fromSpherical.theta,
        transition.toSpherical.theta,
        eased,
      ),
    );
    runtime.sceneRuntime.camera.position
      .setFromSpherical(spherical)
      .add(runtime.sceneRuntime.controls.target);
    runtime.sceneRuntime.camera.lookAt(
      runtime.sceneRuntime.controls.target,
    );
    if (progress >= 1) {
      runtime.sceneRuntime.controls.minDistance =
        transition.minDistance;
      runtime.sceneRuntime.controls.maxDistance =
        transition.maxDistance;
      runtime.sceneRuntime.controls.minPolarAngle =
        transition.minPolarAngle;
      runtime.sceneRuntime.controls.maxPolarAngle =
        transition.maxPolarAngle;
      runtime.cameraTransition = null;
    }
  }

  const externalAimActive =
    runtime.policy.isExternalAimActive();
  const selectedId = runtime.aimRuntime.selectedPieceId;
  if (selectedId !== null && !externalAimActive) {
    const binding = runtime.physicsRuntime.pieces.get(selectedId);
    if (
      binding === undefined ||
      !binding.body.isSleeping() ||
      !runtime.policy.canSelectPiece(selectedId)
    ) {
      cancelInteraction(runtime, true);
      if (runtime.mode === "billiards") {
        beginCameraRestore(runtime, runtime.strategy.cameraPolicy);
      }
      return;
    }
  }

  integrateKeyboardCamera(runtime, wallDeltaSeconds);
  const controls = runtime.sceneRuntime.controls;
  const aimingWithCamera =
    runtime.mode === "billiards" &&
    runtime.aimRuntime.selectedPieceId !== null &&
    !externalAimActive;
  controls.enableDamping = !aimingWithCamera;
  controls.enabled =
    runtime.cameraTransition === null &&
    runtime.state !== "charging" &&
    runtime.state !== "aiming" &&
    !runtime.policy.isCameraRotating() &&
    !runtime.policy.isInputBlocked();
  if (aimingWithCamera) {
    try {
      refreshBilliardsPreview(runtime);
      updateAdaptiveCloseDistance(runtime);
      runtime.state =
        runtime.state === "charging"
          ? "charging"
          : "selected-preview";
    } catch (error: unknown) {
      const reason = formatInteractionError(error);
      cancelInteraction(runtime, true);
      beginCameraRestore(runtime, runtime.strategy.cameraPolicy);
      runtime.failureReason = reason;
      showAimError(runtime.aimParametersRuntime, reason);
    }
  }

  const panelSelectedId = runtime.aimRuntime.selectedPieceId;
  const panelMesh =
    panelSelectedId === null
      ? null
      : (runtime.sceneRuntime.pieceMeshes.get(panelSelectedId) ??
        null);
  const panelCameraDirection = new Vector3();
  runtime.sceneRuntime.camera.getWorldDirection(
    panelCameraDirection,
  );
  updateStrikePointPanel(
    runtime.strikePointPanel,
    runtime.sceneRuntime.renderer,
    panelCameraDirection,
    panelSelectedId,
    panelMesh,
    runtime.mode === "billiards" &&
      runtime.strikeMode &&
      panelSelectedId !== null &&
      !externalAimActive,
    runtime.mode === "billiards"
      ? (runtime.aimParametersRuntime.strikePointOverride ??
        runtime.aimParametersRuntime.currentSolution
          ?.applicationPoint ??
        null)
      : null,
    now,
  );
  updateActionBarPosition(runtime, now);
}

/**
 * 턴 카메라와 입력 카메라 전환이 겹치지 않도록 외부 루프에 잠금 상태를 알린다.
 */
export function isInputCameraTransitioning(
  runtime: InputRuntime,
): boolean {
  return runtime.cameraTransition !== null;
}

/**
 * 제거된 말은 선택 목록과 가림 목록에서 빼고 선택 중이면 공통 취소 경로를 탄다.
 */
export function handleInputPieceRemoved(
  runtime: InputRuntime,
  pieceId: string,
): void {
  const wasSelected =
    runtime.aimRuntime.selectedPieceId === pieceId ||
    runtime.aimRuntime.activeAim?.pieceId === pieceId;
  runtime.selectablePieceIds.delete(pieceId);
  if (wasSelected) {
    cancelInteraction(runtime, true);
  }
  runtime.hiddenPieceIds.delete(pieceId);
  handleAimPieceRemoved(runtime.aimRuntime, pieceId);
  if (wasSelected && runtime.mode === "billiards") {
    beginCameraRestore(runtime, runtime.strategy.cameraPolicy);
  }
}

/**
 * 결과 화면이 열릴 때 진행 중 입력·펄스·카메라 보간을 정리하고 조작을 잠근다.
 */
export function lockInputForMatchOver(runtime: InputRuntime): void {
  cancelInteraction(runtime, true);
  runtime.cameraTransition = null;
  runtime.heldCameraKeys.clear();
  for (const pulse of runtime.aimRuntime.pulses.values()) {
    pulse.mesh.scale.copy(pulse.baseScale);
  }
  runtime.aimRuntime.pulses.clear();
  runtime.sceneRuntime.controls.enabled = false;
}

/**
 * 새 32개 말 id를 선택 목록에 넣고 현재 모드를 보존한 백 기본 시점으로 즉시 돌아간다.
 */
export function resetInputAfterMatch(
  runtime: InputRuntime,
  pieceIds: Iterable<string>,
): void {
  cancelInteraction(runtime, true);
  runtime.cameraTransition = null;
  runtime.selectablePieceIds = new Set(pieceIds);
  runtime.heldCameraKeys.clear();
  runtime.lastUpdateTime = null;
  runtime.adaptiveCloseDistance = null;
  runtime.failureReason = null;
  const controls = runtime.sceneRuntime.controls;
  const policy = runtime.strategy.cameraPolicy;
  const distance = runtime.sceneRuntime.minimumCameraDistance;
  const minPolarAngle = MathUtils.degToRad(
    90 - policy.maxPitchDegrees,
  );
  const maxPolarAngle = MathUtils.degToRad(
    90 - policy.minPitchDegrees,
  );
  const phi = MathUtils.clamp(
    Math.PI / 2 - MathUtils.degToRad(CAMERA_PITCH_DEG),
    minPolarAngle,
    maxPolarAngle,
  );
  controls.target.set(0, 0, 0);
  controls.minPolarAngle = minPolarAngle;
  controls.maxPolarAngle = maxPolarAngle;
  controls.minDistance = distance;
  controls.maxDistance =
    runtime.mode === "classic"
      ? Math.max(
          distance * 1.8,
          runtime.sceneRuntime.boardHalfExtent * 4,
        )
      : distance;
  runtime.sceneRuntime.camera.position
    .setFromSpherical(new Spherical(distance, phi, Math.PI))
    .add(controls.target);
  runtime.sceneRuntime.camera.lookAt(controls.target);
  runtime.lastValidAzimuth = Math.PI;
  controls.enableDamping = true;
  controls.enabled = true;
  controls.update();
}
