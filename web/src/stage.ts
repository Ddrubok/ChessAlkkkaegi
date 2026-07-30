import type { ChessSetMeta } from "./assets";
import {
  computeTunedGeneralCardEffect,
  isGiantPawnCardActive,
  isProneStartCardActive,
  type CardEffectTuning,
  type RunCardState,
} from "./cards";
import {
  CARD_EFFECT_SCALE,
  deriveBoardHalfExtent,
  ENEMY_STAGE_BUFF_SCALE,
  GIANT_PAWN_SIZE_MULTIPLIER,
  PLAYER_MAX_SIZE_SCALE,
  SPAWN_GAP,
  STAGE_BOARD_EXPANSION_SCALES_CELLS,
  STAGE_BOARD_SCALE,
  STAGE_FORCE_STEP,
  STAGE_MAX_PIECE_SCALE,
  STAGE_SIZE_MULTIPLIERS,
  STAGE_WEIGHT_STEP,
} from "./config";
import type { GameMode } from "./game-mode";
import {
  getCellCenter,
  type CellCenter,
  type PieceInstance,
} from "./layout";
import {
  computePermanentSizeFraction,
  computePermanentWeightFraction,
  type PermanentUpgrades,
} from "./meta";

// 확대된 폰 받침끼리 접촉하지 않도록 한 칸 간격에 추가하는 최소 여유다.
const PAWN_ZIGZAG_MARGIN = 0.02;

export type PawnTier = "none" | "rook" | "king";

export interface StageBuffs {
  // 2부터 현재까지 포함된 짝수 스테이지 수다.
  weightSteps: number;
  // 3부터 현재까지 포함된 홀수 스테이지 수다.
  forceSteps: number;
  // 기존 활성 구간 표시와 조절판 표시에 남긴 3의 배수 스테이지 수이며 크기 계산은 최종 표를 직접 쓴다.
  sizeSteps: number;
  // 기존 활성 시점을 보존하는 흑 거대 폰 구간이며 두 활성 값 모두 같은 1.3배를 쓴다.
  pawnTier: PawnTier;
}

export interface StageSpawnOptions {
  // 핫시트에서는 모든 스테이지 버프를 끄는 현재 대전 모드다.
  gameMode: GameMode;
  // 스테이지 모드에서 생성할 1 이상의 현재 단계다.
  stageNumber: number;
  // 플레이어 백 말에 매 리셋마다 다시 적용할 현재 일반 카드 등급과 특수 카드 상태다.
  runCards?: Readonly<RunCardState>;
  // 플레이어 백 말 종류별 중량에 매 리셋마다 합성할 영구 강화 상태다.
  permanentUpgrades?: Readonly<PermanentUpgrades>;
  // 런타임 조절판과 측정 하네스가 흑 중량·힘 단계 및 크기표 증가분에 공통 적용하며 생략하면 config 기본값을 쓴다.
  enemyBuffStepScale?: number;
  // 런타임 조절판과 측정 하네스가 백 크기·중량·힘 카드의 현재 등급 최종 효과에 공통 적용한다.
  cardEffectScale?: number;
  // Y 카드 조절판이 실제 런 카드와 합성할 등급·곡선·종류별 배수·특수 카드 설정이다.
  cardTuning?: Readonly<CardEffectTuning>;
}

export interface EnemyStageStepValues {
  // 현재 공통 배율이 적용된 흑 중량 한 단계 비율이다.
  weightStep: number;
  // 현재 공통 배율이 적용된 흑 AI 힘 한 단계 비율이다.
  forceStep: number;
}

export interface PieceSpawnPose {
  // 렌더와 물리가 공유하는 의도된 월드 중심 위치다.
  translation: {
    x: number;
    y: number;
    z: number;
  };
  // 직립 또는 포복 시작 자세를 나타내는 정규화된 월드 회전이다.
  rotation: {
    x: number;
    y: number;
    z: number;
    w: number;
  };
}

/**
 * 현재 모드·스테이지에서 렌더 보드와 물리 바닥이 함께 사용할 판 확대 배율을 계산한다.
 */
export function computeStageBoardScale(
  gameMode: GameMode,
  stageNumber: number,
): number {
  if (!Number.isInteger(stageNumber) || stageNumber < 1) {
    throw new Error(
      `판 배율 스테이지 번호 ${stageNumber}가 1 이상의 정수가 아닙니다.`,
    );
  }
  return gameMode === "stage" && stageNumber >= 2
    ? STAGE_BOARD_SCALE
    : 1;
}

/**
 * 메타 셀 크기에서 파생한 기본 반폭에 현재 스테이지 판 배율을 적용한다.
 */
export function computeStageBoardHalfExtent(
  cellSize: number,
  gameMode: GameMode,
  stageNumber: number,
): number {
  if (!Number.isFinite(cellSize) || cellSize <= 0) {
    throw new Error(
      `판 반폭을 계산할 cellSize ${cellSize}가 유한한 양수가 아닙니다.`,
    );
  }
  return (
    deriveBoardHalfExtent(cellSize) *
    computeStageBoardScale(gameMode, stageNumber)
  );
}

/**
 * 확정된 여백식에서는 1을 반환하고, 역전 스위치를 켜면 판 배율만큼 셀 배치를 넓힌다.
 */
export function computeStageBoardCellScale(
  gameMode: GameMode,
  stageNumber: number,
  scalesCells: boolean = STAGE_BOARD_EXPANSION_SCALES_CELLS,
): number {
  return scalesCells
    ? computeStageBoardScale(gameMode, stageNumber)
    : 1;
}

// 카드 상태가 없는 핫시트와 기존 회귀 호출이 공유하는 불변 기본값이다.
const EMPTY_RUN_CARDS: Readonly<RunCardState> = {
  sizeGrade: 0,
  weightGrade: 0,
  forceGrade: 0,
  giantPawn: false,
  proneStart: false,
  picksSoFar: 0,
};

/**
 * 선택적 런 카드 상태를 효과가 없는 불변 기본값으로 정규화한다.
 */
function getRunCards(
  options: StageSpawnOptions,
): Readonly<RunCardState> {
  return options.runCards ?? EMPTY_RUN_CARDS;
}

/**
 * 카드 성장 배율을 검사해 측정값 또는 config 기본값을 반환한다.
 */
function getCardEffectScale(options: StageSpawnOptions): number {
  const scale =
    options.cardEffectScale ?? CARD_EFFECT_SCALE;
  if (!Number.isFinite(scale) || scale < 0) {
    throw new Error(
      `카드 효과 배율 ${scale}가 유한한 음이 아닌 수가 아닙니다.`,
    );
  }
  return scale;
}

/**
 * 흑 중량·힘 단계값에 같은 측정 배율을 적용하되 게임은 config 기본값을 사용한다.
 */
export function computeEnemyStageStepValues(
  scale: number = ENEMY_STAGE_BUFF_SCALE,
): EnemyStageStepValues {
  if (!Number.isFinite(scale) || scale < 0) {
    throw new Error(
      `흑 스테이지 버프 배율 ${scale}가 유한한 음이 아닌 수가 아닙니다.`,
    );
  }
  return {
    weightStep: STAGE_WEIGHT_STEP * scale,
    forceStep: STAGE_FORCE_STEP * scale,
  };
}

/**
 * 플래너 표의 스테이지별 일반 크기를 조회하고 디버그 배율은 1배 초과분에만 적용한다.
 */
export function computeEnemyStageSizeMultiplier(
  stageNumber: number,
  scale: number = ENEMY_STAGE_BUFF_SCALE,
): number {
  if (!Number.isInteger(stageNumber) || stageNumber < 1) {
    throw new Error(
      `스테이지 크기 배율 번호 ${stageNumber}가 1 이상의 정수가 아닙니다.`,
    );
  }
  if (!Number.isFinite(scale) || scale < 0) {
    throw new Error(
      `흑 스테이지 크기 배율 ${scale}가 유한한 음이 아닌 수가 아닙니다.`,
    );
  }
  const tableIndex = Math.min(
    stageNumber,
    STAGE_SIZE_MULTIPLIERS.length,
  ) - 1;
  const tableMultiplier = STAGE_SIZE_MULTIPLIERS[tableIndex];
  return 1 + (tableMultiplier - 1) * scale;
}

/**
 * 외부 상태에 의존하지 않고 스테이지 번호를 누적 버프 단계 수로 변환한다.
 */
export function computeStageBuffs(stageNumber: number): StageBuffs {
  if (!Number.isInteger(stageNumber) || stageNumber < 1) {
    throw new Error(
      `스테이지 번호 ${stageNumber}가 1 이상의 정수가 아닙니다.`,
    );
  }
  return {
    weightSteps: Math.floor(stageNumber / 2),
    forceSteps:
      stageNumber < 3 ? 0 : Math.floor((stageNumber - 1) / 2),
    sizeSteps: Math.floor(stageNumber / 3),
    pawnTier:
      stageNumber >= 10
        ? "king"
        : stageNumber >= 5
          ? "rook"
          : "none",
  };
}

/**
 * 현재 모드·스테이지에서 한 말에 적용할 균일 콜라이더·렌더 배율을 계산한다.
 */
export function computeStagePieceScale(
  instance: PieceInstance,
  _meta: ChessSetMeta,
  options: StageSpawnOptions,
): number {
  if (options.gameMode === "online") {
    return 1;
  }
  if (instance.side === "white") {
    const runCards = getRunCards(options);
    const permanentSizeFraction =
      options.permanentUpgrades === undefined
        ? 0
        : computePermanentSizeFraction(
            options.permanentUpgrades,
          );
    const generalScale =
      1 +
      // 카드 크기는 등급 최종값으로 교체되고, 영구 강화 크기는 그 위에 더해진다.
      computeTunedGeneralCardEffect(
        options.gameMode,
        runCards,
        "size",
        getCardEffectScale(options),
        options.cardTuning,
      ) +
      permanentSizeFraction;
    const giantPawnActive = isGiantPawnCardActive(
      options.gameMode,
      runCards,
      options.cardTuning,
    );
    const tierScale =
      instance.type === "Pawn" && giantPawnActive
        ? options.cardTuning?.giantPawnEnabled === true
          ? options.cardTuning.giantPawnSizeMultiplier
          : GIANT_PAWN_SIZE_MULTIPLIER
        : 1;
    return Math.min(
      generalScale * tierScale,
      tierScale > 1
        ? STAGE_MAX_PIECE_SCALE
        : PLAYER_MAX_SIZE_SCALE,
    );
  }
  if (options.gameMode !== "stage") {
    return 1;
  }
  const buffs = computeStageBuffs(options.stageNumber);
  const generalScale = computeEnemyStageSizeMultiplier(
    options.stageNumber,
    options.enemyBuffStepScale,
  );
  if (instance.type !== "Pawn" || buffs.pawnTier === "none") {
    return Math.min(generalScale, STAGE_MAX_PIECE_SCALE);
  }
  return Math.min(
    generalScale * GIANT_PAWN_SIZE_MULTIPLIER,
    STAGE_MAX_PIECE_SCALE,
  );
}

/**
 * 폰 콜라이더의 아래쪽 20% 점에서 최대 수평 반지름을 찾아 확대 후 받침 지름을 계산한다.
 */
export function computeScaledPawnSupportFlareDiameter(
  meta: ChessSetMeta,
  totalScale: number,
): number {
  const pawnMeta = meta.pieces.Pawn;
  const minimumY = Math.min(
    ...pawnMeta.colliderPoints.map((point) => point[1]),
  );
  const supportHeight = minimumY + pawnMeta.bounds.y * 0.2;
  let maximumRadius = 0;
  for (const point of pawnMeta.colliderPoints) {
    if (point[1] <= supportHeight) {
      maximumRadius = Math.max(
        maximumRadius,
        Math.hypot(point[0], point[2]),
      );
    }
  }
  if (maximumRadius <= 0) {
    throw new Error(
      "폰 콜라이더의 아래쪽 20%에서 받침 반지름을 찾지 못했습니다.",
    );
  }
  return maximumRadius * 2 * totalScale;
}

/**
 * 확대된 폰 받침이 한 줄 칸 간격에 여유를 두고 들어가지 않는지 판정한다.
 */
export function shouldUsePawnZigzag(
  instance: PieceInstance,
  meta: ChessSetMeta,
  cellSize: number,
  options: StageSpawnOptions,
): boolean {
  if (instance.type !== "Pawn") {
    return false;
  }
  if (
    instance.side === "white" &&
    isGiantPawnCardActive(
      options.gameMode,
      getRunCards(options),
      options.cardTuning,
    )
  ) {
    return false;
  }
  const totalScale = computeStagePieceScale(instance, meta, options);
  return (
    totalScale !== 1 &&
    computeScaledPawnSupportFlareDiameter(meta, totalScale) +
      PAWN_ZIGZAG_MARGIN >
      cellSize
  );
}

/**
 * 현재 크기 버프에 맞춰 폰 지그재그까지 포함한 의도된 월드 스폰 중심을 반환한다.
 */
export function computeStageSpawnCenter(
  instance: PieceInstance,
  meta: ChessSetMeta,
  options: StageSpawnOptions,
  scalesCells: boolean = STAGE_BOARD_EXPANSION_SCALES_CELLS,
): CellCenter {
  const center = getCellCenter(
    instance.startingSquare,
    meta.cellSize,
  );
  const cellScale = computeStageBoardCellScale(
    options.gameMode,
    options.stageNumber,
    scalesCells,
  );
  const fileIndex =
    instance.startingSquare.file.charCodeAt(0) -
    "a".charCodeAt(0);
  const isEvenNumberedPawn = fileIndex % 2 === 1;
  if (
    !isEvenNumberedPawn ||
    !shouldUsePawnZigzag(
      instance,
      meta,
      meta.cellSize * cellScale,
      options,
    )
  ) {
    return cellScale === 1
      ? center
      : {
          x: center.x * cellScale,
          z: center.z * cellScale,
        };
  }
  const zigzagCenter = {
    x: center.x,
    z:
      center.z +
      (instance.side === "black" ? -meta.cellSize : meta.cellSize),
  };
  return cellScale === 1
    ? zigzagCenter
    : {
        x: zigzagCenter.x * cellScale,
        z: zigzagCenter.z * cellScale,
      };
}

/**
 * 거대 폰 카드에 따라 소멸할 백 폰을 제외한 실제 스폰 개체 목록을 반환한다.
 */
export function selectStageSpawnInstances(
  instances: readonly PieceInstance[],
  options: StageSpawnOptions,
): PieceInstance[] {
  if (
    !isGiantPawnCardActive(
      options.gameMode,
      getRunCards(options),
      options.cardTuning,
    )
  ) {
    return [...instances];
  }
  return instances.filter(
    (instance) =>
      !(
        instance.side === "white" &&
        instance.type === "Pawn" &&
        ["a", "c", "e", "g"].includes(
          instance.startingSquare.file,
        )
      ),
  );
}

/**
 * 포복 카드까지 포함해 한 말의 정확한 시작 위치와 회전을 계산한다.
 */
export function computeStageSpawnPose(
  instance: PieceInstance,
  meta: ChessSetMeta,
  options: StageSpawnOptions,
): PieceSpawnPose {
  const center = computeStageSpawnCenter(instance, meta, options);
  const uniformScale = computeStagePieceScale(instance, meta, options);
  const usesProneStart =
    instance.side === "white" &&
    isProneStartCardActive(
      options.gameMode,
      getRunCards(options),
      options.cardTuning,
    );
  if (!usesProneStart) {
    return {
      translation: { x: center.x, y: SPAWN_GAP, z: center.z },
      rotation:
        instance.side === "black"
          ? { x: 0, y: 1, z: 0, w: 0 }
          : { x: 0, y: 0, z: 0, w: 1 },
    };
  }
  const halfSqrt = Math.SQRT1_2;
  if (instance.type === "Pawn") {
    const minimumRotatedY = Math.min(
      ...meta.pieces.Pawn.colliderPoints.map((point) => point[0]),
    );
    return {
      translation: {
        x: center.x,
        y: SPAWN_GAP - minimumRotatedY * uniformScale,
        z: center.z,
      },
      rotation: { x: 0, y: 0, z: halfSqrt, w: halfSqrt },
    };
  }
  const minimumRotatedY = Math.min(
    ...meta.pieces[instance.type].colliderPoints.map(
      (point) => -point[2],
    ),
  );
  return {
    translation: {
      x: center.x,
      y: SPAWN_GAP - minimumRotatedY * uniformScale,
      z:
        -deriveBoardHalfExtent(meta.cellSize) *
        computeStageBoardCellScale(
          options.gameMode,
          options.stageNumber,
        ),
    },
    rotation: { x: halfSqrt, y: 0, z: 0, w: halfSqrt },
  };
}

/**
 * 한 말의 원래 hull 질량에 더할 스테이지·카드 합산 질량 비율을 반환한다.
 */
export function computeUpgradeWeightFraction(
  instance: PieceInstance,
  options: StageSpawnOptions,
): number {
  if (options.gameMode === "online") {
    return 0;
  }
  if (instance.side === "white") {
    const cardFraction =
      computeTunedGeneralCardEffect(
        options.gameMode,
        getRunCards(options),
        "weight",
        getCardEffectScale(options),
        options.cardTuning,
      );
    const permanentFraction =
      options.permanentUpgrades === undefined
        ? 0
        : computePermanentWeightFraction(
            options.permanentUpgrades,
            instance.type,
          );
    return cardFraction + permanentFraction;
  }
  if (options.gameMode !== "stage") {
    return 0;
  }
  return (
    computeEnemyStageStepValues(
      options.enemyBuffStepScale,
    ).weightStep *
    computeStageBuffs(options.stageNumber).weightSteps
  );
}

/**
 * 현재 스테이지의 흑 AI 목표 발사 속도 배수를 계산한다.
 */
export function computeStageAiSpeedMultiplier(
  options: StageSpawnOptions,
): number {
  if (options.gameMode !== "stage") {
    return 1;
  }
  return (
    1 +
    computeEnemyStageStepValues(
      options.enemyBuffStepScale,
    ).forceStep *
      computeStageBuffs(options.stageNumber).forceSteps
  );
}
