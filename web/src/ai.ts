import { MathUtils, Vector3 } from "three";
import {
  beginDirectedAim,
  cancelAim,
  selectAimPiece,
  setAimApplicationPoint,
  updateDirectedAim,
  type AimRuntime,
} from "./aim";
import { computeStrikeApplicationPoint } from "./aimparams";
import {
  AI_AIM_CHARGE_SECONDS,
  AI_AIM_PREVIEW_DELAY,
} from "./config";
import type { GameMode } from "./game-mode";
import type { PieceSide } from "./layout";
import type { PhysicsRuntime } from "./physics";
import type { SceneRuntime } from "./scene";
import { computeStageAiSpeedMultiplier } from "./stage";
import {
  countRemainingPieces,
  queueTurnLaunch,
  type TurnRuntime,
} from "./turn";

export interface AiPiecePosition {
  // 결정 결과와 실제 바디를 다시 잇는 말 식별자다.
  id: string;
  // 컴퓨터 말과 플레이어 말을 나누는 진영이다.
  side: PieceSide;
  // 수평 거리 계산에 쓰는 월드 x 좌표다.
  x: number;
  // 수평 거리 계산에 쓰는 월드 z 좌표다.
  z: number;
}

export interface AiDecision {
  // 이번 수에 발사할 흑 말 id다.
  pieceId: string;
  // 발사 방향의 기준이 된 가장 가까운 백 말 id다.
  targetPieceId: string;
  // 결정적 각도 변형까지 적용한 수평 단위 방향이다.
  direction: { x: number; z: number };
  // 현재 두 말 사이의 수평 거리다.
  distance: number;
  // 거리 비례식과 최소·최대 제한을 거친 발사 세기다.
  power: number;
  // 샷 카운터 정수 해시에서 얻은 방위 보정 각도다.
  variationDegrees: number;
}

export interface AiTelegraph {
  // 순수 결정 함수가 한 번 만든 뒤 표시와 실제 발사가 함께 쓰는 원본 결정이다.
  decision: AiDecision;
  // 미리보기와 발사 요청에 같은 객체 값으로 전달하는 실제 수평 단위 방향이다.
  direction: Vector3;
  // 현재 자세와 조절판 타격 높이에서 계산한 실제 물리 적용점이다.
  applicationPoint: Vector3;
  // 흑 준비 턴 진입 뒤 선택 고리를 표시할 performance.now 기준 시각이다.
  previewAt: number;
  // 조준이 시작된 performance.now 기준 시각이며 아직 대기 중이면 null이다.
  chargeStartedAt: number | null;
}

export interface AiRuntime {
  // AI가 현재 말 위치와 바디를 읽는 물리 런타임이다.
  physicsRuntime: PhysicsRuntime;
  // 실제 메시 AABB 중심으로 플레이어와 같은 타점을 계산하는 씬 런타임이다.
  sceneRuntime: SceneRuntime;
  // 플레이어와 같은 발사 큐와 턴 상태를 사용하는 턴 런타임이다.
  turnRuntime: TurnRuntime;
  // 거리 비례 세기의 기준인 보드 한 칸 크기다.
  cellSize: number;
  // 모드 전환 뒤 최신 상태를 지연 실행 시점에도 다시 읽는 함수다.
  getGameMode: () => GameMode;
  // 다음 스테이지 진행 뒤 최신 AI 힘 단계를 읽는 함수다.
  getStageNumber: () => number;
  // 브라우저에서는 플레이어와 같은 조준 표시를 구동하고 헤드리스에서는 null이다.
  aimRuntime: AimRuntime | null;
  // 현재 판에서 승인된 AI 발사 수이며 재시작 때 0으로 돌아간다.
  shotCounter: number;
  // 시각 런타임이 없는 기존 헤드리스 회귀에서 0.8초 발사를 재현하는 시각이다.
  scheduledAt: number | null;
  // 브라우저에서 미리보기 대기와 실제 세기 충전을 보존하는 현재 연출 상태다.
  telegraph: AiTelegraph | null;
}

// 조준 시각 런타임이 없는 기존 물리 회귀가 사용해 온 실시간 대기 길이다.
const HEADLESS_AI_SHOT_DELAY_MILLISECONDS = 800;

// 겹친 두 점에서 정규화가 발산하지 않게 무시하는 수평 거리 제곱이다.
const ZERO_DISTANCE_EPSILON_SQUARED = 1e-18;

/**
 * 같은 샷 번호가 항상 같은 -5도 이상 5도 이하의 각도 변형을 만들게 한다.
 */
function computeVariationDegrees(shotCounter: number): number {
  const hash = Math.imul(shotCounter + 1, 2_654_435_761) >>> 0;
  return -5 + (hash / 0xffff_ffff) * 10;
}

/**
 * 두 말 거리와 칸 크기를 최소 0.35, 최대 1.0의 발사 세기로 변환한다.
 */
export function computeAiPower(
  distance: number,
  cellSize: number,
): number {
  if (!Number.isFinite(distance) || distance < 0) {
    throw new Error(`AI distance ${distance}가 유한한 음이 아닌 수가 아닙니다.`);
  }
  if (!Number.isFinite(cellSize) || cellSize <= 0) {
    throw new Error(`AI cellSize ${cellSize}가 유한한 양수가 아닙니다.`);
  }
  return MathUtils.clamp(
    0.35 + 0.5 * (distance / (4 * cellSize)),
    0.35,
    1,
  );
}

/**
 * 현재 수평 위치에서 가장 가까운 흑·백 쌍과 결정적 발사 방향·세기를 고른다.
 */
export function decideAiShot(
  pieces: readonly AiPiecePosition[],
  cellSize: number,
  shotCounter: number,
): AiDecision | null {
  if (!Number.isFinite(cellSize) || cellSize <= 0) {
    throw new Error(`AI cellSize ${cellSize}가 유한한 양수가 아닙니다.`);
  }
  const blackPieces = pieces
    .filter((piece) => piece.side === "black")
    .sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    );
  const whitePieces = pieces
    .filter((piece) => piece.side === "white")
    .sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    );
  let selectedBlack: AiPiecePosition | null = null;
  let selectedWhite: AiPiecePosition | null = null;
  let minimumDistanceSquared = Number.POSITIVE_INFINITY;
  for (const black of blackPieces) {
    for (const white of whitePieces) {
      const deltaX = white.x - black.x;
      const deltaZ = white.z - black.z;
      const distanceSquared = deltaX * deltaX + deltaZ * deltaZ;
      if (
        distanceSquared <= ZERO_DISTANCE_EPSILON_SQUARED ||
        distanceSquared >= minimumDistanceSquared
      ) {
        continue;
      }
      selectedBlack = black;
      selectedWhite = white;
      minimumDistanceSquared = distanceSquared;
    }
  }
  if (selectedBlack === null || selectedWhite === null) {
    return null;
  }
  const distance = Math.sqrt(minimumDistanceSquared);
  const baseDirectionX =
    (selectedWhite.x - selectedBlack.x) / distance;
  const baseDirectionZ =
    (selectedWhite.z - selectedBlack.z) / distance;
  const variationDegrees = computeVariationDegrees(shotCounter);
  const variationRadians = MathUtils.degToRad(variationDegrees);
  const cosine = Math.cos(variationRadians);
  const sine = Math.sin(variationRadians);
  const direction = {
    x: baseDirectionX * cosine - baseDirectionZ * sine,
    z: baseDirectionX * sine + baseDirectionZ * cosine,
  };
  const power = computeAiPower(distance, cellSize);
  return {
    pieceId: selectedBlack.id,
    targetPieceId: selectedWhite.id,
    direction,
    distance,
    power,
    variationDegrees,
  };
}

/**
 * 현재 월드의 살아 있는 말 위치를 순수 AI 결정 입력으로 복사한다.
 */
function collectAiPiecePositions(
  physicsRuntime: PhysicsRuntime,
): AiPiecePosition[] {
  return [...physicsRuntime.pieces.values()].map((binding) => {
    const translation = binding.body.translation();
    return {
      id: binding.instance.id,
      side: binding.instance.side,
      x: translation.x,
      z: translation.z,
    };
  });
}

/**
 * 순수 결정 결과와 현재 자세의 실제 방향·적용점을 한 번 묶어 표시와 발사가 공유하게 한다.
 */
function prepareAiTelegraph(
  runtime: AiRuntime,
  previewAt: number,
): AiTelegraph | null {
  const decision = decideAiShot(
    collectAiPiecePositions(runtime.physicsRuntime),
    runtime.cellSize,
    runtime.shotCounter,
  );
  if (decision === null) {
    return null;
  }
  const binding = runtime.physicsRuntime.pieces.get(decision.pieceId);
  const mesh = runtime.sceneRuntime.pieceMeshes.get(decision.pieceId);
  if (binding === undefined || mesh === undefined) {
    return null;
  }
  const translation = binding.body.translation();
  const rotation = binding.body.rotation();
  mesh.position.set(translation.x, translation.y, translation.z);
  mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
  mesh.updateMatrixWorld(true);
  const direction = new Vector3(
    decision.direction.x,
    0,
    decision.direction.z,
  ).normalize();
  const applicationPoint = computeStrikeApplicationPoint(
    binding,
    mesh,
    runtime.turnRuntime.tuningSettings.strikeHeightRatio,
  );
  return {
    decision,
    direction,
    applicationPoint,
    previewAt,
    chargeStartedAt: null,
  };
}

/**
 * 연출이 보존한 결정과 실제 타점을 기존 플레이어 발사 큐에 그대로 넣는다.
 */
function queuePreparedAiTelegraph(
  runtime: AiRuntime,
  telegraph: AiTelegraph,
): boolean {
  const { decision, direction, applicationPoint } = telegraph;
  const speedMultiplier = computeStageAiSpeedMultiplier({
    gameMode: runtime.getGameMode(),
    stageNumber: runtime.getStageNumber(),
  });
  const outcome = queueTurnLaunch(runtime.turnRuntime, {
    pieceId: decision.pieceId,
    direction,
    normalizedPower: decision.power,
    applicationPoint,
    speedMultiplier,
  });
  if (!outcome.accepted) {
    console.warn(`[AI] 발사 큐 거절: ${outcome.reason ?? "원인 없음"}`);
    return false;
  }
  console.info(
    `[AI] shot=${runtime.shotCounter}, ${decision.pieceId} → ${decision.targetPieceId}, 거리=${decision.distance.toFixed(4)}, 보정=${decision.variationDegrees.toFixed(3)}°, power=${decision.power.toFixed(4)}, 속도 배수=${speedMultiplier.toFixed(4)}`,
  );
  runtime.shotCounter += 1;
  return true;
}

/**
 * 시각 런타임이 없는 기존 헤드리스 회귀에서 같은 결정·발사 경로를 즉시 준비해 실행한다.
 */
function queueAiDecision(runtime: AiRuntime): boolean {
  const telegraph = prepareAiTelegraph(runtime, 0);
  return telegraph === null
    ? false
    : queuePreparedAiTelegraph(runtime, telegraph);
}

/**
 * 현재 턴이 살아 있는 양 진영을 가진 스테이지 흑 준비 턴인지 확인한다.
 */
function canScheduleAiShot(runtime: AiRuntime): boolean {
  if (
    runtime.getGameMode() !== "stage" ||
    runtime.turnRuntime.phase !== "ready" ||
    runtime.turnRuntime.currentSide !== "black"
  ) {
    return false;
  }
  const remaining = countRemainingPieces(runtime.turnRuntime);
  return remaining.black > 0 && remaining.white > 0;
}

/**
 * 물리·씬·턴을 공유하는 결정적 AI 예약 상태를 만든다.
 */
export function createAiRuntime(
  physicsRuntime: PhysicsRuntime,
  sceneRuntime: SceneRuntime,
  turnRuntime: TurnRuntime,
  cellSize: number,
  getGameMode: () => GameMode,
  getStageNumber: () => number = () => 1,
  aimRuntime: AimRuntime | null = null,
): AiRuntime {
  return {
    physicsRuntime,
    sceneRuntime,
    turnRuntime,
    cellSize,
    getGameMode,
    getStageNumber,
    aimRuntime,
    shotCounter: 0,
    scheduledAt: null,
    telegraph: null,
  };
}

/**
 * 현재 AI 조준 연출과 예약을 모두 지워 이후 프레임에서 발사되지 않게 한다.
 */
function cancelAiSequence(runtime: AiRuntime): void {
  const hadTelegraph = runtime.telegraph !== null;
  runtime.scheduledAt = null;
  runtime.telegraph = null;
  if (hadTelegraph && runtime.aimRuntime !== null) {
    cancelAim(runtime.aimRuntime, true);
  }
}

/**
 * 입력 가드가 AI 조준을 플레이어 선택 정리와 구분하도록 현재 소유 상태를 반환한다.
 */
export function isAiTelegraphActive(runtime: AiRuntime): boolean {
  return runtime.telegraph !== null;
}

/**
 * 모드 전환·재시작 때 연출과 지연 발사를 취소하고 같은 판 재현용 샷 번호를 초기화한다.
 */
export function resetAiMatch(runtime: AiRuntime): void {
  cancelAiSequence(runtime);
  runtime.shotCounter = 0;
}

/**
 * 시각 런타임이 없는 헤드리스 검사에서는 기존 0.8초 예약을 그대로 재현한다.
 */
function updateHeadlessAiRuntime(
  runtime: AiRuntime,
  now: number,
): void {
  if (runtime.scheduledAt === null) {
    runtime.scheduledAt =
      now + HEADLESS_AI_SHOT_DELAY_MILLISECONDS;
    return;
  }
  if (now < runtime.scheduledAt) {
    return;
  }
  runtime.scheduledAt = null;
  queueAiDecision(runtime);
}

/**
 * 흑 준비 턴에 실제 결정 방향·세기로 선택 고리와 조준 충전을 보여 준 뒤 기존 큐로 발사한다.
 */
export function updateAiRuntime(
  runtime: AiRuntime,
  now: number,
): void {
  if (!canScheduleAiShot(runtime)) {
    cancelAiSequence(runtime);
    return;
  }
  if (runtime.aimRuntime === null) {
    updateHeadlessAiRuntime(runtime, now);
    return;
  }

  if (runtime.telegraph === null) {
    runtime.telegraph = prepareAiTelegraph(
      runtime,
      now + AI_AIM_PREVIEW_DELAY * 1000,
    );
    return;
  }
  const telegraph = runtime.telegraph;
  if (now < telegraph.previewAt) {
    return;
  }
  if (telegraph.chargeStartedAt === null) {
    selectAimPiece(
      runtime.aimRuntime,
      telegraph.decision.pieceId,
    );
    setAimApplicationPoint(
      runtime.aimRuntime,
      telegraph.applicationPoint,
    );
    beginDirectedAim(
      runtime.aimRuntime,
      telegraph.decision.pieceId,
      telegraph.direction,
    );
    updateDirectedAim(
      runtime.aimRuntime,
      telegraph.direction,
      0,
    );
    telegraph.chargeStartedAt = now;
    return;
  }

  const chargeProgress = Math.min(
    Math.max(
      (now - telegraph.chargeStartedAt) /
        1000 /
        AI_AIM_CHARGE_SECONDS,
      0,
    ),
    1,
  );
  updateDirectedAim(
    runtime.aimRuntime,
    telegraph.direction,
    telegraph.decision.power * chargeProgress,
  );
  if (chargeProgress < 1) {
    return;
  }
  queuePreparedAiTelegraph(runtime, telegraph);
  cancelAim(runtime.aimRuntime, true);
  runtime.telegraph = null;
}
