import {
  PERMANENT_ADVANCED_LEVEL_EFFECTS,
  PERMANENT_ADVANCED_REGULAR_COSTS,
  PERMANENT_ADVANCED_ROYAL_COSTS,
  PERMANENT_BASIC_LEVEL_EFFECTS,
  PERMANENT_BASIC_REGULAR_COSTS,
  PERMANENT_BASIC_ROYAL_COSTS,
  PERMANENT_PLAYER_SIZE_COST,
  PERMANENT_PLAYER_SIZE_STEP,
  PERMANENT_UPGRADE_TIER_MAX_LEVEL,
  PIECE_TYPES,
  STAGE_POINT_CONTRIBUTION_UNIT,
  STAGE_RUN_LENGTH,
  type PieceType,
} from "./config";

// 영구 포인트를 JSON 숫자로 저장하는 브라우저 계약 키다.
export const META_POINTS_STORAGE_KEY = "chessAlkkagi.meta.points";
// 버전이 포함된 영구 테크트리 전체를 JSON 객체로 저장하는 브라우저 계약 키다.
export const META_UPGRADES_STORAGE_KEY = "chessAlkkagi.meta.upgrades";
// 이전 평면형 저장과 새 테크트리를 명확히 구분하는 저장 스키마 버전이다.
export const PERMANENT_UPGRADE_SCHEMA_VERSION = 2;

export type PermanentUpgradeTrack = "force" | "weight";
export type PermanentUpgradeTier = "basic" | "advanced";

export interface PermanentTierPieceUpgrades {
  // 이 구간에서 해당 종류 백 말의 발사 속도에 더할 영구 힘 레벨이다.
  force: number;
  // 이 구간에서 해당 종류 백 말의 hull 질량에 더할 영구 중량 레벨이다.
  weight: number;
}

export interface PermanentPieceUpgrades {
  // 중앙 관문 전에 구매하는 0~3 기초 힘·중량 레벨이다.
  basic: PermanentTierPieceUpgrades;
  // 중앙 관문 뒤에 구매하는 0~3 심화 힘·중량 레벨이다.
  advanced: PermanentTierPieceUpgrades;
}

export interface PermanentUpgrades {
  // 이전 12개 평면 노드 저장을 새 형식으로 오인하지 않게 하는 버전이다.
  schemaVersion: typeof PERMANENT_UPGRADE_SCHEMA_VERSION;
  // 여섯 말 종류의 기초·심화 힘·중량 레벨을 보존하는 트리 원본이다.
  pieces: Record<PieceType, PermanentPieceUpgrades>;
  // 플레이어가 소유한 모든 말 종류에 +5% 크기를 적용하는 중앙 0/1 관문이다.
  playerSizeLevel: 0 | 1;
}

export interface MetaState {
  // 스테이지 보상과 구매·초기화 사이에서 유지되는 현재 보유 포인트다.
  points: number;
  // 선행 관계와 중앙 관문을 포함한 영구 강화 트리 상태다.
  upgrades: PermanentUpgrades;
}

export interface MetaStorage {
  // 지정한 영구 메타 키의 JSON 문자열을 읽는다.
  getItem: (key: string) => string | null;
  // 변경 직후 지정한 영구 메타 키에 JSON 문자열을 저장한다.
  setItem: (key: string, value: string) => void;
}

export interface MetaRuntime {
  // 저장 실패 뒤에도 세션 동안 계속 사용하는 메모리 원본이다.
  state: MetaState;
  // 브라우저 저장소를 사용할 수 없으면 null로 닫는 선택적 저장 연결이다.
  storage: MetaStorage | null;
}

export interface StageRunPointState {
  // 아직 영구 저장하지 않은 이번 런의 마지막 클리어 스테이지다.
  lastClearedStage: number;
}

export interface PurchaseResult {
  // 포인트 차감과 레벨 증가가 모두 적용됐는지 나타낸다.
  purchased: boolean;
  // 구매가 거절됐을 때 UI와 검사가 표시할 한국어 이유다.
  reason: string | null;
}

const ROYAL_PIECE_TYPES = [
  "King",
  "Queen",
] as const satisfies readonly PieceType[];
const TRACKS = ["force", "weight"] as const;

let warnedStorageFailure = false;

/**
 * 저장·형식 오류를 한 세션에서 한 번만 알리고 안전한 새 상태로 계속한다.
 */
function warnStorageFailure(error: unknown): void {
  if (warnedStorageFailure) {
    return;
  }
  warnedStorageFailure = true;
  const detail =
    error instanceof Error ? error.message : String(error);
  console.warn(
    `[영구 메타] 저장값을 사용할 수 없어 새 상태로 시작합니다. ${detail}`,
  );
}

/**
 * 한 말 종류의 기초·심화 힘·중량을 모두 0으로 만든다.
 */
function createDefaultPieceUpgrades(): PermanentPieceUpgrades {
  return {
    basic: { force: 0, weight: 0 },
    advanced: { force: 0, weight: 0 },
  };
}

/**
 * 25개 구매 노드가 모두 비어 있는 안전한 영구 테크트리 원본을 만든다.
 */
export function createDefaultPermanentUpgrades(): PermanentUpgrades {
  return {
    schemaVersion: PERMANENT_UPGRADE_SCHEMA_VERSION,
    pieces: Object.fromEntries(
      PIECE_TYPES.map((type) => [
        type,
        createDefaultPieceUpgrades(),
      ]),
    ) as Record<PieceType, PermanentPieceUpgrades>,
    playerSizeLevel: 0,
  };
}

/**
 * 리플레이·롤백이 런타임 원본을 공유하지 않도록 테크트리 값을 깊게 복사한다.
 */
export function clonePermanentUpgrades(
  upgrades: Readonly<PermanentUpgrades>,
): PermanentUpgrades {
  return {
    schemaVersion: PERMANENT_UPGRADE_SCHEMA_VERSION,
    pieces: Object.fromEntries(
      PIECE_TYPES.map((type) => [
        type,
        {
          basic: { ...upgrades.pieces[type].basic },
          advanced: { ...upgrades.pieces[type].advanced },
        },
      ]),
    ) as Record<PieceType, PermanentPieceUpgrades>,
    playerSizeLevel: upgrades.playerSizeLevel,
  };
}

/**
 * 포인트와 테크트리가 비어 있는 새 영구 메타 상태를 만든다.
 */
export function createDefaultMetaState(): MetaState {
  return {
    points: 0,
    upgrades: createDefaultPermanentUpgrades(),
  };
}

function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * 저장된 힘·중량 레벨 하나를 0~3 정수로 엄격히 읽는다.
 */
function parseTierLevel(value: unknown, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > PERMANENT_UPGRADE_TIER_MAX_LEVEL
  ) {
    throw new Error(`${label} 레벨이 0~3 정수가 아닙니다.`);
  }
  return value;
}

/**
 * 한 구간의 힘·중량 저장값을 누락 없이 읽는다.
 */
function parseTierPieceUpgrades(
  value: unknown,
  label: string,
): PermanentTierPieceUpgrades {
  if (!isPlainObject(value)) {
    throw new Error(`${label} 구간이 객체가 아닙니다.`);
  }
  return {
    force: parseTierLevel(value.force, `${label}.force`),
    weight: parseTierLevel(value.weight, `${label}.weight`),
  };
}

/**
 * 지정 구간·말 종류의 힘과 중량이 모두 3/3인지 확인한다.
 */
function arePieceTracksComplete(
  upgrades: Readonly<PermanentUpgrades>,
  tier: PermanentUpgradeTier,
  types: readonly PieceType[],
): boolean {
  return types.every((type) =>
    TRACKS.every(
      (track) =>
        upgrades.pieces[type][tier][track] ===
        PERMANENT_UPGRADE_TIER_MAX_LEVEL,
    ),
  );
}

/**
 * 현재 트리에서 지정 힘·중량 노드의 선행 조건이 열렸는지 반환한다.
 */
export function isPermanentUpgradeUnlocked(
  upgrades: Readonly<PermanentUpgrades>,
  tier: PermanentUpgradeTier,
  type: PieceType,
): boolean {
  if (tier === "basic") {
    if (type === "King") {
      return arePieceTracksComplete(
        upgrades,
        "basic",
        ["Pawn", "Knight"],
      );
    }
    if (type === "Queen") {
      return arePieceTracksComplete(
        upgrades,
        "basic",
        ["Rook", "Bishop"],
      );
    }
    return true;
  }
  if (upgrades.playerSizeLevel !== 1) {
    return false;
  }
  if (type === "King") {
    return arePieceTracksComplete(
      upgrades,
      "advanced",
      ["Pawn", "Knight"],
    );
  }
  if (type === "Queen") {
    return arePieceTracksComplete(
      upgrades,
      "advanced",
      ["Rook", "Bishop"],
    );
  }
  return true;
}

/**
 * 기초 12개 힘·중량 트랙이 모두 3/3이라 중앙 크기 관문이 열렸는지 반환한다.
 */
export function isPermanentSizeUpgradeUnlocked(
  upgrades: Readonly<PermanentUpgrades>,
): boolean {
  return arePieceTracksComplete(
    upgrades,
    "basic",
    PIECE_TYPES,
  );
}

/**
 * 현재 저장 트리가 각 구매 노드의 선행 관계를 위반하지 않는지 확인한다.
 */
function validatePermanentUpgradePrerequisites(
  upgrades: Readonly<PermanentUpgrades>,
): void {
  for (const tier of ["basic", "advanced"] as const) {
    for (const type of PIECE_TYPES) {
      const hasPurchase = TRACKS.some(
        (track) => upgrades.pieces[type][tier][track] > 0,
      );
      if (
        hasPurchase &&
        !isPermanentUpgradeUnlocked(upgrades, tier, type)
      ) {
        throw new Error(
          `${tier}.${type} 저장값이 선행 조건을 건너뛰었습니다.`,
        );
      }
    }
  }
  if (
    upgrades.playerSizeLevel === 1 &&
    !isPermanentSizeUpgradeUnlocked(upgrades)
  ) {
    throw new Error("전체 크기 저장값이 기초 완료 조건을 건너뛰었습니다.");
  }
}

/**
 * 새 버전 영구 테크트리 JSON을 엄격히 읽고 이전·손상 형식을 거절한다.
 */
export function parsePermanentUpgrades(
  value: unknown,
): PermanentUpgrades {
  if (!isPlainObject(value)) {
    throw new Error("영구 강화 저장값이 객체가 아닙니다.");
  }
  if (value.schemaVersion !== PERMANENT_UPGRADE_SCHEMA_VERSION) {
    throw new Error("이전 영구 강화 저장 형식입니다.");
  }
  if (!isPlainObject(value.pieces)) {
    throw new Error("영구 강화 pieces 표가 없습니다.");
  }
  const pieces = {} as Record<PieceType, PermanentPieceUpgrades>;
  for (const type of PIECE_TYPES) {
    const piece = value.pieces[type];
    if (!isPlainObject(piece)) {
      throw new Error(`영구 강화에 ${type} 항목이 없습니다.`);
    }
    pieces[type] = {
      basic: parseTierPieceUpgrades(
        piece.basic,
        `${type}.basic`,
      ),
      advanced: parseTierPieceUpgrades(
        piece.advanced,
        `${type}.advanced`,
      ),
    };
  }
  if (value.playerSizeLevel !== 0 && value.playerSizeLevel !== 1) {
    throw new Error("전체 크기 레벨이 0 또는 1이 아닙니다.");
  }
  const upgrades: PermanentUpgrades = {
    schemaVersion: PERMANENT_UPGRADE_SCHEMA_VERSION,
    pieces,
    playerSizeLevel: value.playerSizeLevel,
  };
  validatePermanentUpgradePrerequisites(upgrades);
  return upgrades;
}

/**
 * 브라우저 localStorage getter 자체가 실패하는 사생활 모드도 안전하게 처리한다.
 */
export function resolveBrowserMetaStorage(): MetaStorage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch (error: unknown) {
    warnStorageFailure(error);
    return null;
  }
}

/**
 * 새 저장 형식을 엄격히 읽고 이전·손상 저장은 경고 뒤 새 상태로 대체한다.
 */
export function loadMetaState(
  storage: MetaStorage | null,
): MetaState {
  const defaults = createDefaultMetaState();
  if (storage === null) {
    return defaults;
  }
  try {
    const rawPoints = storage.getItem(META_POINTS_STORAGE_KEY);
    const rawUpgrades = storage.getItem(META_UPGRADES_STORAGE_KEY);
    if (rawPoints === null && rawUpgrades === null) {
      return defaults;
    }
    if (rawPoints === null || rawUpgrades === null) {
      throw new Error("영구 메타 저장 키가 일부만 존재합니다.");
    }
    const points = JSON.parse(rawPoints) as unknown;
    if (
      typeof points !== "number" ||
      !Number.isInteger(points) ||
      points < 0
    ) {
      throw new Error("보유 포인트가 0 이상의 정수가 아닙니다.");
    }
    return {
      points,
      upgrades: parsePermanentUpgrades(
        JSON.parse(rawUpgrades) as unknown,
      ),
    };
  } catch (error: unknown) {
    warnStorageFailure(error);
    return defaults;
  }
}

/**
 * 현재 메타 상태를 두 계약 키에 즉시 저장한다.
 */
export function saveMetaState(runtime: MetaRuntime): void {
  if (runtime.storage === null) {
    return;
  }
  try {
    runtime.storage.setItem(
      META_POINTS_STORAGE_KEY,
      JSON.stringify(runtime.state.points),
    );
    runtime.storage.setItem(
      META_UPGRADES_STORAGE_KEY,
      JSON.stringify(runtime.state.upgrades),
    );
  } catch (error: unknown) {
    warnStorageFailure(error);
    runtime.storage = null;
  }
}

/**
 * 부팅 시 저장된 값을 읽어 영구 메타 런타임을 만든다.
 */
export function createMetaRuntime(
  storage: MetaStorage | null = resolveBrowserMetaStorage(),
): MetaRuntime {
  return {
    state: loadMetaState(storage),
    storage,
  };
}

function isRoyalPiece(type: PieceType): boolean {
  return ROYAL_PIECE_TYPES.includes(
    type as (typeof ROYAL_PIECE_TYPES)[number],
  );
}

/**
 * 구간·말 종류·현재 레벨에 해당하는 문서의 고정 구매 비용을 반환한다.
 */
export function computePermanentUpgradeCost(
  tier: PermanentUpgradeTier,
  type: PieceType,
  currentLevel: number,
): number {
  if (
    !Number.isInteger(currentLevel) ||
    currentLevel < 0 ||
    currentLevel >= PERMANENT_UPGRADE_TIER_MAX_LEVEL
  ) {
    throw new Error(
      `영구 강화 비용의 현재 레벨 ${currentLevel}가 0~2 정수가 아닙니다.`,
    );
  }
  if (tier === "basic") {
    return (
      isRoyalPiece(type)
        ? PERMANENT_BASIC_ROYAL_COSTS
        : PERMANENT_BASIC_REGULAR_COSTS
    )[currentLevel];
  }
  return (
    isRoyalPiece(type)
      ? PERMANENT_ADVANCED_ROYAL_COSTS
      : PERMANENT_ADVANCED_REGULAR_COSTS
  )[currentLevel];
}

/**
 * 한 말 종류·구간·트랙의 현재 레벨을 반환한다.
 */
export function getPermanentTierUpgradeLevel(
  upgrades: Readonly<PermanentUpgrades>,
  tier: PermanentUpgradeTier,
  type: PieceType,
  track: PermanentUpgradeTrack,
): number {
  return upgrades.pieces[type][tier][track];
}

/**
 * 한 말 종류·트랙의 기초와 심화 레벨을 더한 0~6 최종 레벨을 반환한다.
 */
export function getPermanentUpgradeLevel(
  upgrades: Readonly<PermanentUpgrades>,
  type: PieceType,
  track: PermanentUpgradeTrack,
): number {
  return (
    upgrades.pieces[type].basic[track] +
    upgrades.pieces[type].advanced[track]
  );
}

/**
 * 기초·심화의 현재 레벨을 해당 구간 총효과 표에서 조회한다.
 */
export function computePermanentTierEffect(
  tier: PermanentUpgradeTier,
  level: number,
): number {
  if (
    !Number.isInteger(level) ||
    level < 0 ||
    level > PERMANENT_UPGRADE_TIER_MAX_LEVEL
  ) {
    throw new Error(
      `${tier} 영구 강화 레벨 ${level}이 0~3 정수가 아닙니다.`,
    );
  }
  if (level === 0) {
    return 0;
  }
  const table =
    tier === "basic"
      ? PERMANENT_BASIC_LEVEL_EFFECTS
      : PERMANENT_ADVANCED_LEVEL_EFFECTS;
  return table[level - 1];
}

/**
 * 한 말 종류·트랙의 기초와 심화 총효과를 합산한다.
 */
function computePermanentTrackEffect(
  upgrades: Readonly<PermanentUpgrades>,
  type: PieceType,
  track: PermanentUpgradeTrack,
): number {
  return (
    computePermanentTierEffect(
      "basic",
      upgrades.pieces[type].basic[track],
    ) +
    computePermanentTierEffect(
      "advanced",
      upgrades.pieces[type].advanced[track],
    )
  );
}

/**
 * 한 종류 백 말의 최종 영구 힘을 기초·심화 현재 레벨 총효과의 합으로 반환한다.
 */
export function computePermanentForceBonus(
  upgrades: Readonly<PermanentUpgrades>,
  type: PieceType,
): number {
  return computePermanentTrackEffect(upgrades, type, "force");
}

/**
 * 한 종류 백 말의 최종 영구 중량을 기초·심화 현재 레벨 총효과의 합으로 반환한다.
 */
export function computePermanentWeightFraction(
  upgrades: Readonly<PermanentUpgrades>,
  type: PieceType,
): number {
  return computePermanentTrackEffect(upgrades, type, "weight");
}

/**
 * 중앙 관문을 구매한 플레이어 백 말 전체의 영구 크기 비율을 반환한다.
 */
export function computePermanentSizeFraction(
  upgrades: Readonly<PermanentUpgrades>,
): number {
  return upgrades.playerSizeLevel * PERMANENT_PLAYER_SIZE_STEP;
}

/**
 * 지정 힘·중량 노드를 선행 조건과 고정 비용에 따라 한 단계 구매한다.
 */
export function purchasePermanentUpgrade(
  runtime: MetaRuntime,
  tier: PermanentUpgradeTier,
  type: PieceType,
  track: PermanentUpgradeTrack,
): PurchaseResult {
  const node = runtime.state.upgrades.pieces[type][tier];
  if (!isPermanentUpgradeUnlocked(runtime.state.upgrades, tier, type)) {
    return { purchased: false, reason: "연결된 선행 강화를 먼저 완료해야 합니다." };
  }
  if (node[track] >= PERMANENT_UPGRADE_TIER_MAX_LEVEL) {
    return { purchased: false, reason: "이미 최대 레벨입니다." };
  }
  const cost = computePermanentUpgradeCost(
    tier,
    type,
    node[track],
  );
  if (runtime.state.points < cost) {
    return { purchased: false, reason: "포인트가 부족합니다." };
  }
  runtime.state.points -= cost;
  node[track] += 1;
  saveMetaState(runtime);
  return { purchased: true, reason: null };
}

/**
 * 기초 12트랙 완료 뒤 플레이어 백 말 전체 크기 +3% 관문을 한 번 구매한다.
 */
export function purchasePermanentSizeUpgrade(
  runtime: MetaRuntime,
): PurchaseResult {
  if (!isPermanentSizeUpgradeUnlocked(runtime.state.upgrades)) {
    return { purchased: false, reason: "기초 강화를 모두 완료해야 합니다." };
  }
  if (runtime.state.upgrades.playerSizeLevel === 1) {
    return { purchased: false, reason: "이미 구매한 전체 크기 강화입니다." };
  }
  if (runtime.state.points < PERMANENT_PLAYER_SIZE_COST) {
    return { purchased: false, reason: "포인트가 부족합니다." };
  }
  runtime.state.points -= PERMANENT_PLAYER_SIZE_COST;
  runtime.state.upgrades.playerSizeLevel = 1;
  saveMetaState(runtime);
  return { purchased: true, reason: null };
}

/**
 * 현재 테크트리에 실제로 사용한 포인트를 고정 비용표에서 다시 계산한다.
 */
export function computePermanentUpgradeSpentPoints(
  upgrades: Readonly<PermanentUpgrades>,
): number {
  let spent = upgrades.playerSizeLevel * PERMANENT_PLAYER_SIZE_COST;
  for (const tier of ["basic", "advanced"] as const) {
    for (const type of PIECE_TYPES) {
      for (const track of TRACKS) {
        const level = upgrades.pieces[type][tier][track];
        for (let currentLevel = 0; currentLevel < level; currentLevel += 1) {
          spent += computePermanentUpgradeCost(
            tier,
            type,
            currentLevel,
          );
        }
      }
    }
  }
  return spent;
}

/**
 * 25개 구매 노드를 모두 채웠을 때 드는 총 포인트를 비용표로 계산한다.
 */
export function computePermanentUpgradeTreeTotalCost(): number {
  const completed = createDefaultPermanentUpgrades();
  completed.playerSizeLevel = 1;
  for (const tier of ["basic", "advanced"] as const) {
    for (const type of PIECE_TYPES) {
      for (const track of TRACKS) {
        completed.pieces[type][tier][track] =
          PERMANENT_UPGRADE_TIER_MAX_LEVEL;
      }
    }
  }
  return computePermanentUpgradeSpentPoints(completed);
}

/**
 * 모든 영구 강화를 한 번에 지우고 사용 포인트 100%를 무료로 반환한다.
 */
export function resetPermanentUpgrades(runtime: MetaRuntime): number {
  const refund = computePermanentUpgradeSpentPoints(
    runtime.state.upgrades,
  );
  runtime.state.points += refund;
  runtime.state.upgrades = createDefaultPermanentUpgrades();
  saveMetaState(runtime);
  return refund;
}

/**
 * 새 런이 아직 어느 스테이지도 클리어하지 않은 임시 정산 상태를 만든다.
 */
export function createStageRunPointState(): StageRunPointState {
  return { lastClearedStage: 0 };
}

/**
 * 마지막 클리어 스테이지까지 N배 기본 단위를 누적해 런 정산액을 계산한다.
 */
export function computeStageRunPayout(
  lastClearedStage: number,
): number {
  if (
    !Number.isInteger(lastClearedStage) ||
    lastClearedStage < 0 ||
    lastClearedStage > STAGE_RUN_LENGTH
  ) {
    throw new Error(
      `마지막 클리어 스테이지 ${lastClearedStage}가 0~${STAGE_RUN_LENGTH} 정수가 아닙니다.`,
    );
  }
  let payout = 0;
  for (let stage = 1; stage <= lastClearedStage; stage += 1) {
    payout += stage * STAGE_POINT_CONTRIBUTION_UNIT;
  }
  return payout;
}

/**
 * 순서대로 클리어한 스테이지만 임시 상태에 기록하고 영구 저장은 하지 않는다.
 */
export function recordStageRunClear(
  state: StageRunPointState,
  stageNumber: number,
): number {
  if (
    !Number.isInteger(stageNumber) ||
    stageNumber < 1 ||
    stageNumber > STAGE_RUN_LENGTH
  ) {
    throw new Error(
      `클리어 스테이지 ${stageNumber}가 1~${STAGE_RUN_LENGTH} 정수가 아닙니다.`,
    );
  }
  if (stageNumber !== state.lastClearedStage + 1) {
    throw new Error(
      `스테이지 클리어 순서가 올바르지 않습니다: ${state.lastClearedStage} 다음에 ${stageNumber}`,
    );
  }
  state.lastClearedStage = stageNumber;
  return computeStageRunPayout(state.lastClearedStage);
}

/**
 * 패배 또는 10스테이지 완주 때만 임시 포인트를 영구 메타에 더하고 저장한다.
 */
export function settleStageRunPoints(
  runtime: MetaRuntime,
  state: StageRunPointState,
): number {
  const payout = computeStageRunPayout(state.lastClearedStage);
  state.lastClearedStage = 0;
  if (payout > 0) {
    runtime.state.points += payout;
    saveMetaState(runtime);
  }
  return payout;
}

/**
 * 런 이탈 때 임시 정산액을 지급하지 않고 전부 버린다.
 */
export function discardStageRunPoints(
  state: StageRunPointState,
): number {
  const discarded = computeStageRunPayout(
    state.lastClearedStage,
  );
  state.lastClearedStage = 0;
  return discarded;
}

/**
 * 1~9 스테이지 클리어만 다음 스테이지용 카드 선택으로 이어지는지 반환한다.
 */
export function shouldOfferStageClearCards(
  completedStage: number,
): boolean {
  if (
    !Number.isInteger(completedStage) ||
    completedStage < 1 ||
    completedStage > STAGE_RUN_LENGTH
  ) {
    throw new Error(
      `카드 제공 판정 스테이지 ${completedStage}가 1~${STAGE_RUN_LENGTH} 정수가 아닙니다.`,
    );
  }
  return completedStage < STAGE_RUN_LENGTH;
}

export const META_MAX_STAGE_STORAGE_KEY = "chessAlkkagi.meta.maxStage";

/**
 * 영구 저장된 최대 클리어 스테이지(0~10)를 가져온다. (기본값: 0)
 */
export function getMaxClearedStage(storage: MetaStorage | null): number {
  if (storage === null) {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(META_MAX_STAGE_STORAGE_KEY);
      const num = raw ? parseInt(raw, 10) : 0;
      return Number.isFinite(num) && num >= 0 ? Math.min(STAGE_RUN_LENGTH, num) : 0;
    }
    return 0;
  }
  const raw = storage.getItem(META_MAX_STAGE_STORAGE_KEY);
  if (raw === null) return 0;
  const num = parseInt(raw, 10);
  return Number.isFinite(num) && num >= 0 ? Math.min(STAGE_RUN_LENGTH, num) : 0;
}

/**
 * 새로 클리어한 스테이지를 반영하여 최대 클리어 스테이지를 영구 저장한다.
 */
export function saveMaxClearedStage(
  storage: MetaStorage | null,
  clearedStage: number,
): void {
  const current = getMaxClearedStage(storage);
  if (clearedStage > current) {
    const nextVal = Math.min(STAGE_RUN_LENGTH, clearedStage);
    if (storage !== null) {
      storage.setItem(META_MAX_STAGE_STORAGE_KEY, String(nextVal));
    }
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(META_MAX_STAGE_STORAGE_KEY, String(nextVal));
    }
  }
}
