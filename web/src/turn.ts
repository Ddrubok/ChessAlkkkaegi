import { MathUtils, Spherical, Vector3 } from "three";
import {
  CAMERA_PITCH_DEG,
  FALL_OUT_Y,
  MAX_SETTLE_SECONDS,
  REST_ANGULAR_EPS,
  REST_HOLD_SECONDS,
  REST_LINEAR_EPS,
} from "./config";
import type { LaunchRequest } from "./aim";
import type { GameMode } from "./game-mode";
import type { PieceSide } from "./layout";
import {
  determineMatchWinner,
  type MatchWinner,
} from "./match";
import type {
  PhysicsRuntime,
  PieceBodyBinding,
} from "./physics";
import {
  applyPendingBreakableWallDestructions,
  scanBreakableWallContacts,
} from "./physics";
import {
  synchronizeBreakableWallMeshes,
  type SceneRuntime,
} from "./scene";
import type { RuntimeTuningSettings } from "./tuning";

export type TurnPhase =
  | "settling"
  | "camera-rotating"
  | "ready"
  | "match-over";
export type TurnCameraMode = "classic" | "billiards";

export interface TurnLaunchRequest extends LaunchRequest {
  // 플레이어는 1을 생략하고 흑 AI 스테이지 힘 버프만 목표 속도를 배수로 높인다.
  speedMultiplier?: number;
}

interface CameraRotation {
  startedAt: number;
  fromTarget: Vector3;
  toTarget: Vector3;
  fromAzimuth: number;
  toAzimuth: number;
  fromDistance: number;
  toDistance: number;
  fromPitch: number;
  toPitch: number;
}

export interface TurnRuntime {
  physicsRuntime: PhysicsRuntime;
  sceneRuntime: SceneRuntime;
  // 백 선공 뒤 한 번의 유효 발사마다 교대하는 활성 진영이다.
  currentSide: PieceSide;
  // 정착 및 카메라 회전 동안 선택을 잠그는 턴 단계다.
  phase: TurnPhase;
  // 렌더 프레임이 아니라 다음 fixed-step 경계에 적용할 발사다.
  pendingLaunch: TurnLaunchRequest | null;
  // 초기 정착과 발사 뒤 정착을 구별해 전자에서는 턴을 넘기지 않는다.
  pendingTurnChange: boolean;
  // 모든 바디가 연속으로 느린 시간을 시뮬레이션 초로 누적한다.
  restHoldSeconds: number;
  // 안전한 강제 정착 판단을 시작할 시뮬레이션 경과 시간이다.
  settleSeconds: number;
  // 물리 순회 중 삭제하지 않도록 step 뒤 일괄 처리할 id를 모은다.
  pendingRemovalIds: Set<string>;
  lastLaunchPower: number;
  lastLaunchInitialSpeed: number;
  // 재현 로그가 발사를 정확한 fixed-step 경계에 다시 놓을 수 있게 누적 스텝 수를 보존한다.
  physicsStepNumber: number;
  // 타임아웃 정착 경로가 실제로 활성화된 횟수를 화면에 공개한다.
  forcedSettleCount: number;
  // 같은 정착 구간에서 매 step마다 강제 정착 횟수를 중복 증가시키지 않게 한다.
  forcedSettleCountedForCurrentSettle: boolean;
  // 활성 진영을 화면 아래로 옮기는 실제 시간 기반 카메라 보간 상태다.
  cameraRotation: CameraRotation | null;
  // 물리 제거와 입력 선택 목록 정리를 같은 경계에서 연결한다.
  onPieceRemoved: ((pieceId: string) => void) | null;
  // 마지막 정착 뒤 승자가 생기면 카메라 회전 대신 결과 화면을 여는 연결점이다.
  onMatchOver: ((winner: MatchWinner) => void) | null;
  // 수락된 모든 플레이어·AI·향후 네트워크 발사를 수동 기록 계층에 알리는 연결점이다.
  onLaunchAccepted:
    | ((request: TurnLaunchRequest, side: PieceSide) => void)
    | null;
  // 낙하 제거와 정착이 끝난 한 턴의 상태 해시 시점을 기록 계층에 알리는 연결점이다.
  onTurnSettled: (() => void) | null;
  // 당구식에서만 선택 중심과 근접 거리를 판 전체 보기로 함께 복원하도록 현재 모드를 보존한다.
  turnCameraMode: TurnCameraMode;
  // 턴 교대 카메라와 흑 AI 제어 여부를 구분하는 현재 대전 모드다.
  gameMode: GameMode;
  // 온라인에서 턴과 무관하게 이 브라우저의 진영을 화면 아래에 고정하며 다른 모드에서는 null이다.
  cameraPerspectiveSide: PieceSide | null;
  // 직전 발사 말에만 CCD를 유지하고 정착하면 즉시 해제하기 위한 id다.
  ccdPieceId: string | null;
  // 발사 강도와 라이브 물리값을 재생성 없이 참조하는 런타임 설정이다.
  tuningSettings: RuntimeTuningSettings;
}

// 턴 교대가 즉시 튀지 않으면서 조작 흐름을 오래 막지 않는 실제 시간 길이다.
const TURN_CAMERA_ROTATION_SECONDS = 0.55;

/**
 * 선속도와 각속도가 모두 문턱 아래인지 확인해 회전 중인 말을 정지로 오판하지 않는다.
 */
function isBodySlow(binding: PieceBodyBinding): boolean {
  const linearVelocity = binding.body.linvel();
  const angularVelocity = binding.body.angvel();
  return (
    Math.hypot(
      linearVelocity.x,
      linearVelocity.y,
      linearVelocity.z,
    ) < REST_LINEAR_EPS &&
    Math.hypot(
      angularVelocity.x,
      angularVelocity.y,
      angularVelocity.z,
    ) < REST_ANGULAR_EPS
  );
}

/**
 * 잠재 접촉 목록 중 실제 solver contact가 하나라도 있는 콜라이더 쌍만 인정한다.
 */
function hasSolverContact(
  physicsRuntime: PhysicsRuntime,
  first: PieceBodyBinding["collider"],
  second: PieceBodyBinding["collider"],
): boolean {
  let hasContact = false;
  physicsRuntime.world.contactPair(first, second, (manifold) => {
    if (manifold.numSolverContacts() > 0) {
      hasContact = true;
    }
  });
  return hasContact;
}

/**
 * 보드와 solver contact가 있는 말을 시작점으로 실제 말 접촉 그래프를 순회해 접지 집합을 만든다.
 */
export function collectGroundedPieceIds(
  runtime: TurnRuntime,
): Set<string> {
  const colliderOwners = new Map<number, string>();
  const neighbors = new Map<string, Set<string>>();
  const grounded = new Set<string>();
  const boardColliderHandles = new Set(
    runtime.physicsRuntime.boardColliders.map(
      (collider) => collider.handle,
    ),
  );
  for (const binding of runtime.physicsRuntime.pieces.values()) {
    colliderOwners.set(binding.collider.handle, binding.instance.id);
    neighbors.set(binding.instance.id, new Set());
  }

  for (const binding of runtime.physicsRuntime.pieces.values()) {
    runtime.physicsRuntime.world.contactPairsWith(
      binding.collider,
      (otherCollider) => {
        if (
          !hasSolverContact(
            runtime.physicsRuntime,
            binding.collider,
            otherCollider,
          )
        ) {
          return;
        }
        if (boardColliderHandles.has(otherCollider.handle)) {
          grounded.add(binding.instance.id);
          return;
        }
        const otherId = colliderOwners.get(otherCollider.handle);
        if (otherId === undefined || otherId === binding.instance.id) {
          return;
        }
        neighbors.get(binding.instance.id)?.add(otherId);
        neighbors.get(otherId)?.add(binding.instance.id);
      },
    );
  }

  const queue = [...grounded];
  for (let index = 0; index < queue.length; index += 1) {
    const pieceId = queue[index];
    for (const neighborId of neighbors.get(pieceId) ?? []) {
      if (grounded.has(neighborId)) {
        continue;
      }
      grounded.add(neighborId);
      queue.push(neighborId);
    }
  }
  return grounded;
}

/**
 * 현재 카메라 위치의 판 평면 방위각을 반환한다.
 */
function readCameraAzimuth(sceneRuntime: SceneRuntime): number {
  const offsetX =
    sceneRuntime.camera.position.x - sceneRuntime.controls.target.x;
  const offsetZ =
    sceneRuntime.camera.position.z - sceneRuntime.controls.target.z;
  return Math.atan2(offsetX, offsetZ);
}

/**
 * 활성 진영이 화면 아래에 오도록 반대편 방위로 부드러운 턴 카메라 회전을 시작한다.
 */
function beginTurnCameraRotation(runtime: TurnRuntime): void {
  const controls = runtime.sceneRuntime.controls;
  if (typeof controls.update !== "function") {
    // 브라우저 OrbitControls가 없는 헤드리스 물리 회귀는 카메라 애니메이션 없이 턴만 준비 상태로 넘긴다.
    runtime.cameraRotation = null;
    runtime.phase = "ready";
    controls.enabled = true;
    return;
  }
  const dampingEnabled = controls.enableDamping;
  controls.enableDamping = false;
  controls.update();
  controls.enableDamping = dampingEnabled;
  const fromTarget = controls.target.clone();
  const fromSpherical = new Spherical().setFromVector3(
    runtime.sceneRuntime.camera.position.clone().sub(fromTarget),
  );
  const fromAzimuth = readCameraAzimuth(runtime.sceneRuntime);
  const cameraSide =
    runtime.gameMode === "online" &&
    runtime.cameraPerspectiveSide !== null
      ? runtime.cameraPerspectiveSide
      : runtime.currentSide;
  const desiredAzimuth = cameraSide === "white" ? Math.PI : 0;
  const shortestDelta = MathUtils.euclideanModulo(
    desiredAzimuth - fromAzimuth + Math.PI,
    Math.PI * 2,
  ) - Math.PI;

  // 온라인 대전 중에는 각 플레이어가 자신의 진영 시점을 고정 유지하므로 턴 교대 시 회전하지 않는다.
  if (runtime.gameMode === "online") {
    runtime.cameraRotation = null;
    runtime.phase = "ready";
    controls.enabled = true;
    return;
  }

  // 동일 방위 유지 시 회전을 건너뛰고 즉시 ready 상태로 전환한다.
  if (Math.abs(shortestDelta) < 0.001 && runtime.turnCameraMode !== "billiards") {
    runtime.cameraRotation = null;
    runtime.phase = "ready";
    controls.enabled = true;
    return;
  }
  const startedAt = performance.now();
  runtime.cameraRotation = {
    startedAt,
    fromTarget,
    toTarget:
      runtime.turnCameraMode === "billiards"
        ? new Vector3()
        : fromTarget.clone(),
    fromAzimuth,
    toAzimuth: fromAzimuth + shortestDelta,
    fromDistance: fromSpherical.radius,
    toDistance:
      runtime.turnCameraMode === "billiards"
        ? runtime.sceneRuntime.minimumCameraDistance
        : Math.max(
            fromSpherical.radius,
            runtime.sceneRuntime.minimumCameraDistance,
          ),
    fromPitch: Math.PI / 2 - fromSpherical.phi,
    toPitch: MathUtils.degToRad(CAMERA_PITCH_DEG),
  };
  runtime.phase = "camera-rotating";
  controls.enabled = false;
}

/**
 * 턴 카메라의 중심·거리·피치·방위를 함께 보간하고 끝나면 선택을 다시 허용한다.
 */
export function updateTurnCamera(
  runtime: TurnRuntime,
  now: number,
): void {
  const rotation = runtime.cameraRotation;
  if (rotation === null) {
    return;
  }
  const progress = Math.min(
    (now - rotation.startedAt) /
      1000 /
      TURN_CAMERA_ROTATION_SECONDS,
    1,
  );
  const eased = progress * progress * (3 - 2 * progress);
  const azimuth = MathUtils.lerp(
    rotation.fromAzimuth,
    rotation.toAzimuth,
    eased,
  );
  // 당구식의 중심·거리·피치 복원도 방위 회전과 같은 진행률을 써 두 모드의 잠금 시간을 일치시킨다.
  const target = runtime.sceneRuntime.controls.target.lerpVectors(
    rotation.fromTarget,
    rotation.toTarget,
    eased,
  );
  const pitch = MathUtils.lerp(
    rotation.fromPitch,
    rotation.toPitch,
    eased,
  );
  const distance = MathUtils.lerp(
    rotation.fromDistance,
    rotation.toDistance,
    eased,
  );
  runtime.sceneRuntime.camera.position.set(
    target.x + Math.sin(azimuth) * Math.cos(pitch) * distance,
    target.y + Math.sin(pitch) * distance,
    target.z + Math.cos(azimuth) * Math.cos(pitch) * distance,
  );
  runtime.sceneRuntime.camera.lookAt(target);
  if (progress >= 1) {
    if (runtime.turnCameraMode === "billiards") {
      runtime.sceneRuntime.controls.minDistance =
        runtime.sceneRuntime.minimumCameraDistance;
      runtime.sceneRuntime.controls.maxDistance =
        runtime.sceneRuntime.minimumCameraDistance;
    }
    runtime.cameraRotation = null;
    runtime.phase = "ready";
    runtime.sceneRuntime.controls.enabled = true;
  }
}

/**
 * 사전 정착이 끝난 월드에서 계측을 0으로 시작하는 백 선공 턴 상태를 만든다.
 */
export function createTurnRuntime(
  physicsRuntime: PhysicsRuntime,
  sceneRuntime: SceneRuntime,
  tuningSettings: RuntimeTuningSettings,
): TurnRuntime {
  return {
    physicsRuntime,
    sceneRuntime,
    currentSide: "white",
    phase: "ready",
    pendingLaunch: null,
    pendingTurnChange: false,
    restHoldSeconds: 0,
    settleSeconds: 0,
    pendingRemovalIds: new Set(),
    lastLaunchPower: 0,
    lastLaunchInitialSpeed: 0,
    physicsStepNumber: 0,
    forcedSettleCount: 0,
    forcedSettleCountedForCurrentSettle: false,
    cameraRotation: null,
    onPieceRemoved: null,
    onMatchOver: null,
    onLaunchAccepted: null,
    onTurnSettled: null,
    turnCameraMode: "billiards",
    gameMode: "hotseat",
    cameraPerspectiveSide: null,
    ccdPieceId: null,
    tuningSettings,
  };
}

/**
 * 두 모드 모두 턴 회전을 사용하되 당구식의 보드 중심·전체 거리 복원 여부를 선택한다.
 */
export function setTurnCameraMode(
  runtime: TurnRuntime,
  mode: TurnCameraMode,
): void {
  runtime.turnCameraMode = mode;
}

/**
 * 현재 대전 모드를 턴 교대 카메라 정책에 반영한다.
 */
export function setTurnGameMode(
  runtime: TurnRuntime,
  mode: GameMode,
): void {
  runtime.gameMode = mode;
}

/**
 * 온라인에서는 내 진영, 기존 모드에서는 null을 넣어 활성 턴 기준 방위를 사용한다.
 */
export function setTurnCameraPerspectiveSide(
  runtime: TurnRuntime,
  side: PieceSide | null,
): void {
  runtime.cameraPerspectiveSide = side;
}

/**
 * 온라인 대전 시 카메라를 플레이어 본인의 진영 시점으로 즉시 맞춘다.
 */
export function alignTurnCameraToPerspective(
  runtime: TurnRuntime,
  side: PieceSide,
): void {
  runtime.cameraPerspectiveSide = side;
  const controls = runtime.sceneRuntime.controls;
  if (!controls || typeof controls.update !== "function" || !controls.target) {
    runtime.cameraRotation = null;
    runtime.phase = "ready";
    return;
  }
  const distance = runtime.sceneRuntime.minimumCameraDistance;
  const minPolarAngle = controls.minPolarAngle ?? MathUtils.degToRad(20);
  const maxPolarAngle = controls.maxPolarAngle ?? MathUtils.degToRad(80);
  const phi = MathUtils.clamp(
    Math.PI / 2 - MathUtils.degToRad(CAMERA_PITCH_DEG),
    minPolarAngle,
    maxPolarAngle,
  );
  const azimuth = side === "white" ? Math.PI : 0;

  controls.target.set(0, 0, 0);
  runtime.sceneRuntime.camera.position
    .setFromSpherical(new Spherical(distance, phi, azimuth))
    .add(controls.target);
  runtime.sceneRuntime.camera.lookAt(controls.target);
  controls.update();

  runtime.cameraRotation = null;
  runtime.phase = "ready";
  controls.enabled = true;
}

/**
 * 온라인 대국 시작 직후에도 기존 턴 교대 카메라 보간으로 내 진영을 아래에 놓는다.
 */
export function beginCurrentTurnCameraRotation(
  runtime: TurnRuntime,
): void {
  if (runtime.phase !== "ready") {
    throw new Error(
      `카메라 방향 준비는 ready 단계에서만 가능하지만 현재 ${runtime.phase}입니다.`,
    );
  }
  beginTurnCameraRotation(runtime);
}

/**
 * 개발 검증과 조절판 버튼이 같은 턴 초기화 경로로 전원을 깨우게 한다.
 */
export function wakeAllTurnPieces(runtime: TurnRuntime): void {
  if (runtime.phase !== "ready") {
    console.warn(
      "[물리] 전체 깨우기는 턴과 카메라가 준비된 상태에서만 실행됩니다.",
    );
    return;
  }
  for (const binding of runtime.physicsRuntime.pieces.values()) {
    binding.body.wakeUp();
  }
  runtime.phase = "settling";
  runtime.restHoldSeconds = 0;
  runtime.settleSeconds = 0;
  runtime.forcedSettleCountedForCurrentSettle = false;
}

/**
 * 낙하 제거 시 입력 목록도 같은 fixed-step 경계에서 정리하도록 후크를 연결한다.
 */
export function setPieceRemovalHandler(
  runtime: TurnRuntime,
  handler: (pieceId: string) => void,
): void {
  runtime.onPieceRemoved = handler;
}

/**
 * 턴 모듈이 DOM을 직접 알지 않고 결과 화면을 열도록 매치 종료 후크를 연결한다.
 */
export function setMatchOverHandler(
  runtime: TurnRuntime,
  handler: (winner: MatchWinner) => void,
): void {
  runtime.onMatchOver = handler;
}

/**
 * 성공한 발사 입력을 물리 적용 시각과 독립적인 수동 기록기로 전달한다.
 */
export function setLaunchAcceptedHandler(
  runtime: TurnRuntime,
  handler:
    | ((request: TurnLaunchRequest, side: PieceSide) => void)
    | null,
): void {
  runtime.onLaunchAccepted = handler;
}

/**
 * 한 발의 낙하 제거와 정착이 끝난 직후 상태 해시 후크를 연결한다.
 */
export function setTurnSettledHandler(
  runtime: TurnRuntime,
  handler: (() => void) | null,
): void {
  runtime.onTurnSettled = handler;
}

/**
 * 수동 개발 후크 오류를 전체 스택으로 알리되 게임 턴 진행은 그대로 유지한다.
 */
function invokePassiveHook(
  label: string,
  callback: () => void,
): void {
  try {
    callback();
  } catch (error: unknown) {
    const fullError =
      error instanceof Error
        ? (error.stack ?? error.message)
        : String(error);
    console.error(`[${label}] ${fullError}`);
  }
}

/**
 * 현재 턴이 준비됐고 제거 대기 중이 아닌 활성 진영의 말만 선택하도록 판정한다.
 */
export function canSelectTurnPiece(
  runtime: TurnRuntime,
  pieceId: string,
): boolean {
  const binding = runtime.physicsRuntime.pieces.get(pieceId);
  return (
    runtime.phase === "ready" &&
    binding !== undefined &&
    binding.instance.side === runtime.currentSide &&
    !runtime.pendingRemovalIds.has(pieceId)
  );
}

export interface LaunchQueueResult {
  // 입력 계층이 선택 해제와 펄스를 성공한 발사에만 적용하도록 명시하는 결과다.
  accepted: boolean;
  // 거절 원인을 화면과 콘솔에 그대로 전달할 수 있는 사용자용 설명이다.
  reason: string | null;
}

/**
 * 포인터 발사를 다음 fixed-step 직전까지 보관해 프레임률과 무관한 경계에서 적용한다.
 */
export function queueTurnLaunch(
  runtime: TurnRuntime,
  request: TurnLaunchRequest,
): LaunchQueueResult {
  if (!canSelectTurnPiece(runtime, request.pieceId)) {
    return {
      accepted: false,
      reason: `${request.pieceId} 말은 현재 턴에 발사할 수 없습니다.`,
    };
  }
  if (runtime.pendingLaunch !== null) {
    return {
      accepted: false,
      reason: "이미 처리 대기 중인 발사가 있습니다.",
    };
  }
  runtime.pendingLaunch = request;
  runtime.phase = "settling";
  runtime.pendingTurnChange = true;
  runtime.restHoldSeconds = 0;
  runtime.settleSeconds = 0;
  runtime.forcedSettleCountedForCurrentSettle = false;
  if (runtime.onLaunchAccepted !== null) {
    invokePassiveHook("대국 기록 발사 후크", () => {
      runtime.onLaunchAccepted?.(request, runtime.currentSide);
    });
  }
  return { accepted: true, reason: null };
}

/**
 * 입력 전략이 확정한 월드 적용점과 방향의 임펄스를 다음 물리 step 직전에 적용한다.
 */
export function applyPendingLaunchBeforeStep(
  runtime: TurnRuntime,
): void {
  applyPendingBreakableWallDestructions(
    runtime.physicsRuntime,
  );
  synchronizeBreakableWallMeshes(
    runtime.sceneRuntime,
    runtime.physicsRuntime,
  );
  const request = runtime.pendingLaunch;
  if (request === null) {
    return;
  }
  runtime.pendingLaunch = null;
  const binding = runtime.physicsRuntime.pieces.get(request.pieceId);
  const mesh = runtime.sceneRuntime.pieceMeshes.get(request.pieceId);
  if (binding === undefined || mesh === undefined) {
    return;
  }

  const preLaunchPosition = binding.body.translation();
  const preLaunchRotation = binding.body.rotation();
  const applicationPoint = request.applicationPoint;
  const speedMultiplier = request.speedMultiplier ?? 1;
  if (!Number.isFinite(speedMultiplier) || speedMultiplier <= 0) {
    throw new Error(
      `발사 속도 배수 ${speedMultiplier}가 유한한 양수가 아닙니다.`,
    );
  }
  const targetSpeed =
    request.normalizedPower *
    runtime.tuningSettings.maxLaunchSpeed *
    speedMultiplier;
  const impulseMagnitude = binding.body.mass() * targetSpeed;
  const impulse = {
    x: request.direction.x * impulseMagnitude,
    y: request.direction.y * impulseMagnitude,
    z: request.direction.z * impulseMagnitude,
  };
  const velocityBefore = binding.body.linvel();
  const before = new Vector3(
    velocityBefore.x,
    velocityBefore.y,
    velocityBefore.z,
  );
  if (runtime.ccdPieceId !== null && runtime.ccdPieceId !== request.pieceId) {
    runtime.physicsRuntime.pieces
      .get(runtime.ccdPieceId)
      ?.body.enableCcd(false);
  }
  binding.body.enableCcd(true);
  runtime.ccdPieceId = request.pieceId;
  binding.body.applyImpulseAtPoint(impulse, applicationPoint, true);
  const velocityAfter = binding.body.linvel();
  const deltaVelocity = new Vector3(
    velocityAfter.x,
    velocityAfter.y,
    velocityAfter.z,
  ).sub(before);
  const targetDelta = request.direction.clone().multiplyScalar(targetSpeed);
  const relativeError =
    targetSpeed > 0
      ? deltaVelocity.distanceTo(targetDelta) / targetSpeed
      : 0;
  runtime.lastLaunchPower = request.normalizedPower;
  runtime.lastLaunchInitialSpeed = deltaVelocity.length();

  const rotation = preLaunchRotation;
  const upDot = MathUtils.clamp(
    1 - 2 * (rotation.x * rotation.x + rotation.z * rotation.z),
    -1,
    1,
  );
  const posture =
    Math.acos(upDot) * (180 / Math.PI) < 30 ? "직립" : "넘어짐";
  console.info(
    `[발사] step=${runtime.physicsStepNumber + 1}, ${binding.instance.id}(${posture}), 시작 위치=(${preLaunchPosition.x.toFixed(6)}, ${preLaunchPosition.y.toFixed(6)}, ${preLaunchPosition.z.toFixed(6)}), 시작 회전=(${preLaunchRotation.x.toFixed(8)}, ${preLaunchRotation.y.toFixed(8)}, ${preLaunchRotation.z.toFixed(8)}, ${preLaunchRotation.w.toFixed(8)}), 방향=(${request.direction.x.toFixed(8)}, ${request.direction.y.toFixed(8)}, ${request.direction.z.toFixed(8)}), 적용점=(${applicationPoint.x.toFixed(6)}, ${applicationPoint.y.toFixed(6)}, ${applicationPoint.z.toFixed(6)}), power=${request.normalizedPower.toFixed(4)}, speed multiplier=${speedMultiplier.toFixed(4)}, target Δv=${targetSpeed.toFixed(6)}, actual Δv=${deltaVelocity.length().toFixed(6)}, 오차=${(relativeError * 100).toFixed(3)}%`,
  );
  if (relativeError > 0.01) {
    console.error(
      `[발사] ${binding.instance.type}의 초기 속도 오차가 1%를 넘었습니다: ${(relativeError * 100).toFixed(3)}%`,
    );
  }
}

/**
 * 낙하한 말의 전체 연결 상태를 모아 순회가 끝난 뒤 일괄 제거한다.
 */
function removeFallenPieces(runtime: TurnRuntime): void {
  runtime.pendingRemovalIds.clear();
  for (const binding of runtime.physicsRuntime.pieces.values()) {
    if (binding.body.translation().y < FALL_OUT_Y) {
      runtime.pendingRemovalIds.add(binding.instance.id);
    }
  }
  for (const pieceId of runtime.pendingRemovalIds) {
    const binding = runtime.physicsRuntime.pieces.get(pieceId);
    const mesh = runtime.sceneRuntime.pieceMeshes.get(pieceId);
    if (binding === undefined) {
      continue;
    }
    runtime.physicsRuntime.world.removeRigidBody(binding.body);
    runtime.physicsRuntime.pieces.delete(pieceId);
    if (runtime.ccdPieceId === pieceId) {
      runtime.ccdPieceId = null;
    }
    if (mesh !== undefined) {
      runtime.sceneRuntime.scene.remove(mesh);
      runtime.sceneRuntime.pieceMeshes.delete(pieceId);
    }
    runtime.onPieceRemoved?.(pieceId);
  }
  runtime.pendingRemovalIds.clear();
}

/**
 * 타임아웃에서는 보드 접지 그래프에 속하며 저속인 말만 정지시켜 공중 바디를 얼리지 않는다.
 */
function settleEligibleBodies(runtime: TurnRuntime): boolean {
  const groundedPieceIds = collectGroundedPieceIds(runtime);
  let everyBodyEligible = true;
  for (const binding of runtime.physicsRuntime.pieces.values()) {
    const slow = isBodySlow(binding);
    const grounded = groundedPieceIds.has(binding.instance.id);
    if (slow && grounded) {
      binding.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      binding.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      binding.body.sleep();
    } else {
      everyBodyEligible = false;
    }
  }
  return everyBodyEligible;
}

/**
 * 정착 완료 시 초기 준비를 끝내거나 상대 턴으로 넘기고 카메라 회전을 시작한다.
 */
function completeSettlement(runtime: TurnRuntime): void {
  disableLaunchCcdAfterTurn(runtime);
  runtime.restHoldSeconds = 0;
  runtime.settleSeconds = 0;
  if (!runtime.pendingTurnChange) {
    runtime.phase = "ready";
    return;
  }
  runtime.pendingTurnChange = false;
  if (runtime.onTurnSettled !== null) {
    invokePassiveHook("대국 기록 정착 후크", () => {
      runtime.onTurnSettled?.();
    });
  }
  const winner = determineMatchWinner(
    countRemainingPieces(runtime),
    runtime.currentSide,
  );
  if (winner !== null) {
    runtime.cameraRotation = null;
    runtime.phase = "match-over";
    runtime.sceneRuntime.controls.enabled = false;
    runtime.onMatchOver?.(winner);
    return;
  }
  runtime.currentSide =
    runtime.currentSide === "white" ? "black" : "white";
  // 스테이지 대전도 2인 대전과 같은 턴 카메라 회전을 쓴다 (07-26 개발자 결정으로 백 시점 고정 폐기).
  beginTurnCameraRotation(runtime);
}

/**
 * 같은 정착 구간의 후속 충돌까지 보호한 뒤 전체 턴이 끝날 때 발사 말의 CCD를 해제한다.
 */
function disableLaunchCcdAfterTurn(runtime: TurnRuntime): void {
  if (runtime.ccdPieceId === null) {
    return;
  }
  const binding = runtime.physicsRuntime.pieces.get(runtime.ccdPieceId);
  if (binding === undefined) {
    runtime.ccdPieceId = null;
    return;
  }
  binding.body.enableCcd(false);
  runtime.ccdPieceId = null;
}

/**
 * fixed step 직후 낙하 제거를 먼저 수행한 다음 선속도와 각속도로 정착 및 턴을 판정한다.
 */
export function updateTurnAfterStep(
  runtime: TurnRuntime,
  fixedStep: number,
): void {
  runtime.physicsStepNumber += 1;
  scanBreakableWallContacts(runtime.physicsRuntime);
  synchronizeBreakableWallMeshes(
    runtime.sceneRuntime,
    runtime.physicsRuntime,
  );
  removeFallenPieces(runtime);
  if (runtime.phase !== "settling") {
    return;
  }
  runtime.settleSeconds += fixedStep;
  const allAtRest = [...runtime.physicsRuntime.pieces.values()].every(
    (binding) => binding.body.isSleeping() || isBodySlow(binding),
  );
  if (allAtRest) {
    runtime.restHoldSeconds += fixedStep;
  } else {
    runtime.restHoldSeconds = 0;
  }
  if (runtime.restHoldSeconds >= REST_HOLD_SECONDS) {
    completeSettlement(runtime);
    return;
  }
  if (runtime.settleSeconds >= MAX_SETTLE_SECONDS) {
    if (!runtime.forcedSettleCountedForCurrentSettle) {
      runtime.forcedSettleCount += 1;
      runtime.forcedSettleCountedForCurrentSettle = true;
    }
    if (settleEligibleBodies(runtime)) {
      completeSettlement(runtime);
    }
  }
}

/**
 * 현재 살아 있는 말을 진영별로 세어 디버그 표시와 이후 규칙 확장에 제공한다.
 */
export function countRemainingPieces(
  runtime: TurnRuntime,
): { white: number; black: number } {
  let white = 0;
  let black = 0;
  for (const binding of runtime.physicsRuntime.pieces.values()) {
    if (binding.instance.side === "white") {
      white += 1;
    } else {
      black += 1;
    }
  }
  return { white, black };
}

/**
 * 새 물리·렌더 말이 준비된 뒤 콜백과 입력 모드는 보존하고 백 선공 상태만 초기화한다.
 */
export function resetTurnRuntime(runtime: TurnRuntime): void {
  runtime.currentSide = "white";
  runtime.phase = "ready";
  runtime.pendingLaunch = null;
  runtime.pendingTurnChange = false;
  runtime.restHoldSeconds = 0;
  runtime.settleSeconds = 0;
  runtime.pendingRemovalIds.clear();
  runtime.lastLaunchPower = 0;
  runtime.lastLaunchInitialSpeed = 0;
  runtime.physicsStepNumber = 0;
  runtime.forcedSettleCount = 0;
  runtime.forcedSettleCountedForCurrentSettle = false;
  runtime.cameraRotation = null;
  runtime.ccdPieceId = null;
}
