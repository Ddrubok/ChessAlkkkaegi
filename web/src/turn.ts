import { MathUtils, Spherical, Vector3 } from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import {
  BISHOP_DEFLECTION_IMPULSE_FACTOR,
  BISHOP_SPIN_TORQUE_MULTIPLIER,
  CAMERA_PITCH_DEG,
  computeKnightEffectivePower,
  FALL_OUT_Y,
  isPieceInOpponentEndZone,
  KNIGHT_LAUNCH_ANGLE,
  MAX_SETTLE_SECONDS,
  PROMOTION_PIECE_CHOICES,
  REST_ANGULAR_EPS,
  REST_HOLD_SECONDS,
  REST_LINEAR_EPS,
  type PieceType,
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
  swapPiecePositions,
} from "./physics";
import {
  synchronizeBreakableWallMeshes,
  synchronizePieceMeshes,
  type SceneRuntime,
} from "./scene";
import type { RuntimeTuningSettings } from "./tuning";

export type TurnPhase =
  | "settling"
  | "camera-rotating"
  | "ready"
  | "promotion"
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
  // 타점 패널에서 기본 중심이 아닌 커스텀 타점으로 발사되었는지 여부
  lastLaunchHasCustomStrike: boolean;
  // 비숍 스핀 리코셰가 같은 기물에 중복 적용되지 않도록 이번 턴에서 충돌 처리된 기물 id 집합이다.
  bishopRicochetedPieceIds: Set<string>;
  // 발사 강도와 라이브 물리값을 재생성 없이 참조하는 런타임 설정이다.
  tuningSettings: RuntimeTuningSettings;
  // 폰 승급 대기 상태 관리 (폰 id -> 상대 끝 진영 도달 턴 및 진영)
  pendingPromotionPawns: Map<string, { reachedTurn: number; side: PieceSide }>;
  // 승급 선택을 외부(모달 UI)에 요청하는 연결점
  onPromotionReady:
    | ((
        pieceId: string,
        side: PieceSide,
        choices: readonly PieceType[],
        onSelect: (chosenType: PieceType) => void,
      ) => void)
    | null;
  // 승급이 확정되었을 때 물리/메시 교체를 수행하는 연결점
  onPiecePromoted: ((pieceId: string, newType: PieceType) => void) | null;
  // 총 완료된 턴 횟수
  turnNumber: number;
  // 순차 처리용 승급 대기 큐
  promotionQueue: string[];
  // 체스 보드 셀 크기
  cellSize: number;
  // 킹 특수 기믹(위치 변경 또는 방어) 사용 여부 (게임당 각 진영 1회 한정, 둘 중 하나만 사용 가능)
  kingSpecialUsed: { white: boolean; black: boolean };
  // 킹 위치 변경 기믹 사용 여부 (하위 호환)
  kingSwapUsed: { white: boolean; black: boolean };
  // 킹 방어(철벽) 기믹 활성화 여부
  kingDefenseActive: { white: boolean; black: boolean };
}

// 턴 교대가 즉시 튀지 않으면서 조작 흐름을 오래 막지 않는 실제 시간 길이다.
const TURN_CAMERA_ROTATION_SECONDS = 0.55;

/**
 * 선속도와 각속도가 모두 문턱 아래인지 확인해 회전 중인 말을 정지로 오판하지 않는다.
 */
function isBodySlow(binding: PieceBodyBinding): boolean {
  if (binding.body.isFixed()) {
    return true;
  }
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
    if (binding.body.isFixed() || runtime.kingDefenseActive[binding.instance.side]) {
      grounded.add(binding.instance.id);
    }
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
    checkAndTriggerPromotion(runtime);
    return;
  }

  // 동일 방위 유지 시 회전을 건너뛰고 즉시 ready 상태로 전환한다.
  if (Math.abs(shortestDelta) < 0.001 && runtime.turnCameraMode !== "billiards") {
    runtime.cameraRotation = null;
    runtime.phase = "ready";
    controls.enabled = true;
    checkAndTriggerPromotion(runtime);
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
    checkAndTriggerPromotion(runtime);
  }
}

/**
 * 사전 정착이 끝난 월드에서 계측을 0으로 시작하는 백 선공 턴 상태를 만든다.
 */
export function createTurnRuntime(
  physicsRuntime: PhysicsRuntime,
  sceneRuntime: SceneRuntime,
  tuningSettings: RuntimeTuningSettings,
  cellSize?: number,
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
    lastLaunchHasCustomStrike: false,
    bishopRicochetedPieceIds: new Set(),
    tuningSettings,
    pendingPromotionPawns: new Map(),
    onPromotionReady: null,
    onPiecePromoted: null,
    turnNumber: 0,
    promotionQueue: [],
    cellSize:
      cellSize ??
      (physicsRuntime.cellSize ?? physicsRuntime.boardHalfExtent / 4.25),
    kingSpecialUsed: { white: false, black: false },
    kingSwapUsed: { white: false, black: false },
    kingDefenseActive: { white: false, black: false },
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

  // 킹 방어 활성화 상태로 Fixed였던 기물이라면 발사를 위해 Dynamic으로 전환
  if (binding.body.isFixed()) {
    binding.body.setBodyType(
      RAPIER.RigidBodyType.Dynamic,
      true,
    );
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
  const effectivePower =
    binding.instance.type === "Knight"
      ? computeKnightEffectivePower(request.normalizedPower)
      : request.normalizedPower;
  const targetSpeed =
    effectivePower *
    runtime.tuningSettings.maxLaunchSpeed *
    speedMultiplier;

  let launchDirection = request.direction.clone();
  if (binding.instance.type === "Knight" && launchDirection.y < 0.2) {
    const horiz = new Vector3(launchDirection.x, 0, launchDirection.z);
    if (horiz.lengthSq() > 1e-12) {
      horiz.normalize();
    } else {
      horiz.set(0, 0, 1);
    }
    const cosAngle = Math.cos(KNIGHT_LAUNCH_ANGLE);
    const sinAngle = Math.sin(KNIGHT_LAUNCH_ANGLE);
    launchDirection.set(
      horiz.x * cosAngle,
      sinAngle,
      horiz.z * cosAngle,
    ).normalize();
  } else {
    launchDirection.normalize();
  }

  const impulseMagnitude = binding.body.mass() * targetSpeed;
  const impulse = {
    x: launchDirection.x * impulseMagnitude,
    y: launchDirection.y * impulseMagnitude,
    z: launchDirection.z * impulseMagnitude,
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
  runtime.bishopRicochetedPieceIds.clear();
  binding.body.applyImpulseAtPoint(impulse, applicationPoint, true);
  if (binding.instance.type === "Bishop" || binding.instance.type === "Queen") {
    // 편심 타점 시 회전 토크를 추가 인가하여 2.2배의 맹렬한 스핀 각속도를 형성
    const leverX = applicationPoint.x - preLaunchPosition.x;
    const leverZ = applicationPoint.z - preLaunchPosition.z;
    const torqueY = leverX * impulse.z - leverZ * impulse.x;
    if (Math.abs(torqueY) > 1e-6) {
      const extraTorqueY = torqueY * (BISHOP_SPIN_TORQUE_MULTIPLIER - 1);
      binding.body.applyTorqueImpulse({ x: 0, y: extraTorqueY, z: 0 }, true);
    }
  }
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
  runtime.lastLaunchHasCustomStrike =
    Math.hypot(
      applicationPoint.x - preLaunchPosition.x,
      applicationPoint.z - preLaunchPosition.z,
    ) > 0.04;

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
    runtime.pendingPromotionPawns.delete(pieceId);
    runtime.promotionQueue = runtime.promotionQueue.filter(
      (id) => id !== pieceId,
    );
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

  // 방어가 활성화된 킹이 보드 위에 생존해 있다면 정착 완료 후 다시 Fixed 상태로 고정하여 벽처럼 만든다.
  for (const side of ["white", "black"] as const) {
    if (runtime.kingDefenseActive[side]) {
      for (const binding of runtime.physicsRuntime.pieces.values()) {
        if (
          binding.instance.type === "King" &&
          binding.instance.side === side &&
          !runtime.pendingRemovalIds.has(binding.instance.id) &&
          binding.body.translation().y >= FALL_OUT_Y
        ) {
          binding.body.setBodyType(
            RAPIER.RigidBodyType.Fixed,
            true,
          );
          binding.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
          binding.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        }
      }
    }
  }

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

  // 살아남은 폰들의 상대 끝 진영 도달 및 생존 상태 판정
  for (const binding of runtime.physicsRuntime.pieces.values()) {
    if (
      binding.instance.type !== "Pawn" ||
      runtime.pendingRemovalIds.has(binding.instance.id)
    ) {
      continue;
    }
    const pos = binding.body.translation();
    const inEndZone = isPieceInOpponentEndZone(
      binding.instance.side,
      pos.z,
      runtime.cellSize,
    );
    const pieceId = binding.instance.id;
    if (inEndZone) {
      if (!runtime.pendingPromotionPawns.has(pieceId)) {
        runtime.pendingPromotionPawns.set(pieceId, {
          reachedTurn: runtime.turnNumber,
          side: binding.instance.side,
        });
        console.info(
          `[승급 대기] 폰 ${pieceId}(${binding.instance.side})가 턴 ${runtime.turnNumber}에 상대 진영 끝에 안착했습니다.`,
        );
      }
    } else {
      if (runtime.pendingPromotionPawns.has(pieceId)) {
        runtime.pendingPromotionPawns.delete(pieceId);
        console.info(
          `[승급 취소] 폰 ${pieceId}가 상대 진영 끝을 벗어났습니다.`,
        );
      }
    }
  }

  runtime.turnNumber += 1;
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
 * 비숍이 고속 회전(스핀) 중 다른 기물과 충돌할 때, 스핀 방향과 크기에 비례하는 횡방향 임펄스를 가해
 * 예리한 대각선 각도(45°~75°)로 굴절 튕겨나가는 리코셰(Ricochet) 역학을 인가한다.
 */
function applyBishopSpinRicochet(runtime: TurnRuntime): void {
  if (runtime.ccdPieceId === null) {
    return;
  }
  const launcher = runtime.physicsRuntime.pieces.get(runtime.ccdPieceId);
  if (
    launcher === undefined ||
    (launcher.instance.type !== "Bishop" && launcher.instance.type !== "Queen")
  ) {
    return;
  }
  const spinY = launcher.body.angvel().y;
  if (Math.abs(spinY) < 0.5) {
    return;
  }
  const launcherPos = launcher.body.translation();
  const launcherLinvel = launcher.body.linvel();
  const speed = Math.hypot(launcherLinvel.x, launcherLinvel.z);

  for (const other of runtime.physicsRuntime.pieces.values()) {
    if (other.instance.id === launcher.instance.id) {
      continue;
    }
    if (runtime.bishopRicochetedPieceIds.has(other.instance.id)) {
      continue;
    }
    let hasContact = false;
    runtime.physicsRuntime.world.contactPair(
      launcher.collider,
      other.collider,
      (manifold) => {
        if (manifold.numSolverContacts() > 0) {
          hasContact = true;
        }
      },
    );
    if (!hasContact) {
      continue;
    }
    runtime.bishopRicochetedPieceIds.add(other.instance.id);

    const otherPos = other.body.translation();
    const dx = otherPos.x - launcherPos.x;
    const dz = otherPos.z - launcherPos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-6) {
      continue;
    }
    const nx = dx / dist;
    const nz = dz / dist;
    // 충돌 법선에 수직인 접선 벡터 (XZ 평면)
    const tx = -nz;
    const tz = nx;

    // spinY > 0 이면 시계 반대방향(CCW)이므로 비숍 표면이 충돌면에서 +t로 비비며 비숍은 -t로 반작용 굴절
    const tangentSign = spinY > 0 ? -1 : 1;
    const mass = launcher.body.mass();
    const deflectionSpeed =
      Math.min(Math.abs(spinY) * 0.15, 1.2) *
      Math.max(speed, 3.5) *
      BISHOP_DEFLECTION_IMPULSE_FACTOR;
    const impulseMagnitude = mass * deflectionSpeed;

    const impulseX = tx * tangentSign * impulseMagnitude;
    const impulseZ = tz * tangentSign * impulseMagnitude;

    launcher.body.applyImpulse({ x: impulseX, y: 0, z: impulseZ }, true);
    // 상대 기물에게도 반작용 임펄스 및 회전 토크 전이
    other.body.applyImpulse(
      { x: -impulseX * 0.7, y: 0, z: -impulseZ * 0.7 },
      true,
    );
    other.body.applyTorqueImpulse({ x: 0, y: -spinY * 0.006, z: 0 }, true);

    // 비숍의 스핀 일부가 굴절 운동에너지로 전환되어 회전 감쇠
    launcher.body.setAngvel(
      { x: 0, y: spinY * 0.55, z: 0 },
      true,
    );
  }
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
  applyBishopSpinRicochet(runtime);
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
  runtime.pendingPromotionPawns.clear();
  runtime.promotionQueue = [];
  runtime.turnNumber = 0;
  runtime.kingSpecialUsed = { white: false, black: false };
  runtime.kingSwapUsed = { white: false, black: false };
  runtime.kingDefenseActive = { white: false, black: false };
}

/**
 * 현재 턴 시작 시, 상대 끝 진영에서 1턴 이상 생존한 폰이 있는지 확인하고 승급 절차를 시작한다.
 */
export function checkAndTriggerPromotion(runtime: TurnRuntime): void {
  if (runtime.phase !== "ready") {
    return;
  }

  for (const [pieceId, record] of runtime.pendingPromotionPawns.entries()) {
    if (record.side !== runtime.currentSide) {
      continue;
    }
    const binding = runtime.physicsRuntime.pieces.get(pieceId);
    if (
      !binding ||
      binding.instance.type !== "Pawn" ||
      runtime.pendingRemovalIds.has(pieceId)
    ) {
      runtime.pendingPromotionPawns.delete(pieceId);
      continue;
    }
    // 상대방의 1턴 반격을 버텨내고 살아남음 (도달 턴 + 2턴 이상 경과: 내 턴 -> 상대 턴 -> 다시 내 턴)
    if (runtime.turnNumber >= record.reachedTurn + 2) {
      if (!runtime.promotionQueue.includes(pieceId)) {
        runtime.promotionQueue.push(pieceId);
      }
    }
  }

  processNextPromotionInQueue(runtime);
}

/**
 * 큐에 대기 중인 승급을 순차적으로 처리한다.
 */
function processNextPromotionInQueue(runtime: TurnRuntime): void {
  if (runtime.promotionQueue.length === 0) {
    return;
  }
  const pieceId = runtime.promotionQueue[0];
  const binding = runtime.physicsRuntime.pieces.get(pieceId);
  if (
    !binding ||
    binding.instance.type !== "Pawn" ||
    runtime.pendingRemovalIds.has(pieceId)
  ) {
    runtime.promotionQueue.shift();
    runtime.pendingPromotionPawns.delete(pieceId);
    processNextPromotionInQueue(runtime);
    return;
  }

  // AI(흑) 차례인 경우 자동 승급 (Queen)
  if (runtime.currentSide === "black" && runtime.gameMode === "stage") {
    runtime.promotionQueue.shift();
    runtime.pendingPromotionPawns.delete(pieceId);
    runtime.onPiecePromoted?.(pieceId, "Queen");
    console.info(`[AI 승급] 흑 폰 ${pieceId}가 퀸(Queen)으로 승급했습니다.`);
    if (runtime.promotionQueue.length > 0) {
      processNextPromotionInQueue(runtime);
    }
    return;
  }

  runtime.phase = "promotion";
  runtime.sceneRuntime.controls.enabled = false;

  if (runtime.onPromotionReady !== null) {
    runtime.onPromotionReady(
      pieceId,
      runtime.currentSide,
      PROMOTION_PIECE_CHOICES,
      (chosenType: PieceType) => {
        runtime.promotionQueue.shift();
        runtime.pendingPromotionPawns.delete(pieceId);
        runtime.onPiecePromoted?.(pieceId, chosenType);
        if (runtime.promotionQueue.length > 0) {
          processNextPromotionInQueue(runtime);
        } else {
          runtime.phase = "ready";
          runtime.sceneRuntime.controls.enabled = true;
        }
      },
    );
  }
}

/**
 * 킹 위치 변경(스왑): 게임당 각 진영 1회 한정으로 보드 위의 다른 기물과 킹의 위치를 맞바꾼다.
 * 위치 변경과 방어 둘 중 하나만 사용할 수 있다.
 */
export function executeKingSwap(
  runtime: TurnRuntime,
  kingPieceId: string,
  targetPieceId: string,
): boolean {
  const side = runtime.currentSide;
  if (runtime.kingSpecialUsed[side] || runtime.kingSwapUsed[side] || runtime.kingDefenseActive[side]) {
    return false;
  }
  const kingBinding = runtime.physicsRuntime.pieces.get(kingPieceId);
  const targetBinding = runtime.physicsRuntime.pieces.get(targetPieceId);
  if (kingBinding === undefined || targetBinding === undefined) {
    return false;
  }
  if (kingBinding.instance.type !== "King" || kingBinding.instance.side !== side) {
    return false;
  }
  if (kingPieceId === targetPieceId) {
    return false;
  }

  const success = swapPiecePositions(
    runtime.physicsRuntime,
    kingPieceId,
    targetPieceId,
  );
  if (success) {
    synchronizePieceMeshes(runtime.sceneRuntime, runtime.physicsRuntime);
    runtime.kingSpecialUsed[side] = true;
    runtime.kingSwapUsed[side] = true;
    return true;
  }
  return false;
}

/**
 * 킹 방어(철벽): 게임당 각 진영 1회 한정(스왑과 택1)으로 킹을 벽처럼 고정하여 다른 기물이 부딪혀도 꿈쩍하지 않고 벽처럼 튕겨내게 한다.
 */
export function executeKingDefense(
  runtime: TurnRuntime,
  kingPieceId: string,
): boolean {
  const side = runtime.currentSide;
  if (runtime.kingSpecialUsed[side] || runtime.kingSwapUsed[side] || runtime.kingDefenseActive[side]) {
    return false;
  }
  const kingBinding = runtime.physicsRuntime.pieces.get(kingPieceId);
  if (kingBinding === undefined) {
    return false;
  }
  if (kingBinding.instance.type !== "King" || kingBinding.instance.side !== side) {
    return false;
  }

  runtime.kingSpecialUsed[side] = true;
  runtime.kingDefenseActive[side] = true;
  kingBinding.body.setBodyType(
    RAPIER.RigidBodyType.Fixed,
    true,
  );
  kingBinding.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  kingBinding.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  return true;
}


