import {
  BufferGeometry,
  MathUtils,
  Mesh,
  PerspectiveCamera,
  Raycaster,
  Spherical,
  Vector2,
  Vector3,
} from "three";
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
} from "./config";
import type { PhysicsRuntime } from "./physics";
import {
  hideAimOccluders,
  restoreHiddenPieceMeshes,
  type SceneRuntime,
} from "./scene";

export type PointerState =
  | "idle"
  | "selected-preview"
  | "aiming"
  | "charging"
  | "launch"
  | "cancel";
export type InputMode = "classic" | "billiards";

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
  // 하나의 상태 기계에서 기존 클래식, 카메라 제스처, 빨간 점 충전만 구분한다.
  source: "classic-canvas" | "billiards-canvas" | "red-dot";
  startX: number;
  startY: number;
  maximumDistance: number;
  // 포인터 시작 때의 최근접 교차만 탭 release까지 보존한다.
  candidatePieceId: string | null;
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
}

// 탭과 카메라 공전 드래그를 같은 캔버스 포인터에서 구별하는 최대 이동 거리다.
const TAP_MAX_DISTANCE_PIXELS = 6;

// 작은 빨간 점을 손가락으로도 안정적으로 누르게 하는 최소 화면 히트 반경이다.
const RED_DOT_HIT_RADIUS_PIXELS = 24;

// 모드 선택을 새로고침 뒤에도 유지하는 브라우저 저장 키다.
const INPUT_MODE_STORAGE_KEY = "chessAlkkagi.inputMode";

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
 * 현재 선택 말의 몸 원점이 아닌 월드 AABB 중심을 당구식 공전 중심으로 구한다.
 */
function getSelectedTarget(runtime: InputRuntime): Vector3 {
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
  mesh.position.set(translation.x, translation.y, translation.z);
  mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
  mesh.scale.setScalar(1);
  mesh.updateMatrixWorld(true);
  if (mesh.geometry.boundingBox === null) {
    mesh.geometry.computeBoundingBox();
  }
  const bounds = mesh.geometry.boundingBox;
  if (bounds === null) {
    throw new Error(`${pieceId} 공전 중심용 AABB가 없습니다.`);
  }
  return bounds.clone().applyMatrix4(mesh.matrixWorld).getCenter(new Vector3());
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
function refreshBilliardsPreview(runtime: InputRuntime): void {
  const pieceId = runtime.aimRuntime.selectedPieceId;
  if (runtime.mode !== "billiards" || pieceId === null) {
    return;
  }
  const binding = runtime.physicsRuntime.pieces.get(pieceId);
  const mesh = runtime.sceneRuntime.pieceMeshes.get(pieceId);
  if (binding === undefined || mesh === undefined) {
    throw new Error(`${pieceId} 조준 미리보기 대상을 찾지 못했습니다.`);
  }
  const horizontal = getBilliardsHorizontalDirection(runtime);
  if (runtime.aimRuntime.activeAim?.pieceId !== pieceId) {
    beginDirectedAim(runtime.aimRuntime, pieceId, horizontal);
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
  runtime.state =
    pieceId !== null && runtime.mode === "billiards"
      ? "selected-preview"
      : "idle";
  if (runtime.mode === "billiards") {
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
    runtime.mode === "billiards" &&
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
        return computeStrikeApplicationPoint(
          binding,
          mesh,
          runtime.aimParametersRuntime.tuningRuntime.settings
            .strikeHeightRatio,
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
          computeStrikeApplicationPoint(
            binding,
            mesh,
            runtime.aimParametersRuntime.tuningRuntime.settings
              .strikeHeightRatio,
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
  if (runtime.state === "charging") {
    event.preventDefault();
    event.stopImmediatePropagation();
    cancelInteraction(runtime, false);
    return;
  }
  if (runtime.activePointerId !== null) {
    if (
      runtime.mode === "billiards" &&
      runtime.gesture?.source === "billiards-canvas" &&
      event.pointerType === "touch"
    ) {
      runtime.gesture.candidatePieceId = null;
      runtime.gesture.maximumDistance = Number.POSITIVE_INFINITY;
      return;
    }
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

  const canvas = runtime.sceneRuntime.renderer.domElement;
  const selectedId = runtime.aimRuntime.selectedPieceId;
  const canCharge =
    runtime.mode === "billiards" &&
    selectedId !== null &&
    runtime.policy.canSelectPiece(selectedId) &&
    isRedDotHit(
      runtime.aimParametersRuntime,
      event.clientX,
      event.clientY,
      RED_DOT_HIT_RADIUS_PIXELS,
    );
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
    };
    setAimPower(runtime.aimParametersRuntime, 0);
    canvas.setPointerCapture(event.pointerId);
    return;
  }

  const nearestPieceId = raycastNearestPiece(runtime, event);
  const selectablePieceId =
    nearestPieceId !== null &&
    runtime.selectablePieceIds.has(nearestPieceId) &&
    runtime.policy.canSelectPiece(nearestPieceId)
      ? nearestPieceId
      : null;
  if (runtime.mode === "classic") {
    if (selectablePieceId === null) {
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
    };
    canvas.setPointerCapture(event.pointerId);
    runtime.strategy.onAimBegin(runtime, selectablePieceId, event);
    return;
  }

  runtime.activePointerId = event.pointerId;
  runtime.activeCaptureElement = canvas;
  runtime.gesture = {
    source: "billiards-canvas",
    startX: event.clientX,
    startY: event.clientY,
    maximumDistance: 0,
    candidatePieceId: selectablePieceId,
  };
  canvas.setPointerCapture(event.pointerId);
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
    const downwardPixels = Math.max(event.clientY - gesture.startY, 0);
    setAimPower(
      runtime.aimParametersRuntime,
      downwardPixels / MAX_DRAG_PIXELS,
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
    if (runtime.aimParametersRuntime.normalizedPower > 0) {
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
    ["classic", "클래식"],
    ["billiards", "당구식"],
  ] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.mode = mode;
    button.textContent = label;
    modeToggle.append(button);
  }
  sceneRuntime.renderer.domElement.parentElement?.append(modeToggle);
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
    cameraTransition: null,
    preparedStrikeSolution: null,
    lastValidAzimuth: sceneRuntime.controls.getAzimuthalAngle(),
    heldCameraKeys: new Set(),
    lastUpdateTime: null,
    hiddenPieceIds: new Set(),
    failureReason: null,
    adaptiveCloseDistance: null,
    modeToggle,
  };

  for (const button of modeToggle.querySelectorAll("button")) {
    button.addEventListener("click", () => {
      const mode = button.dataset.mode;
      if (mode === "classic" || mode === "billiards") {
        switchInputMode(runtime, mode);
      }
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
    pulse.mesh.scale.setScalar(1);
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
