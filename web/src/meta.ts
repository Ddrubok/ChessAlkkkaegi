import {
  PERMANENT_UPGRADE_COST_UNIT,
  PERMANENT_UPGRADE_MAX_LEVEL,
  PERMANENT_UPGRADE_STEP,
  PIECE_TYPES,
  STAGE_CLEAR_POINTS,
  type PieceType,
} from "./config";

// 영구 포인트를 JSON 숫자로 저장하는 브라우저 계약 키다.
export const META_POINTS_STORAGE_KEY = "chessAlkkagi.meta.points";
// 여섯 말 종류의 힘·중량 레벨 표를 JSON 객체로 저장하는 브라우저 계약 키다.
export const META_UPGRADES_STORAGE_KEY = "chessAlkkagi.meta.upgrades";

export type PermanentUpgradeTrack = "force" | "weight";

export interface PermanentPieceUpgrades {
  // 이 종류의 백 말을 발사할 때 목표 속도에 더하는 영구 힘 레벨이다.
  force: number;
  // 이 종류의 백 말 hull 질량에 더하는 영구 중량 레벨이다.
  weight: number;
}

export type PermanentUpgrades = Record<
  PieceType,
  PermanentPieceUpgrades
>;

export interface MetaState {
  // 스테이지 클리어와 구매 사이에서 유지되는 현재 보유 포인트다.
  points: number;
  // 여섯 말 종류의 힘·중량 영구 레벨을 보존하는 평면형 강화 상태다.
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
  // 브라우저 저장소를 사용할 수 없으면 null로 남는 선택적 저장 연결이다.
  storage: MetaStorage | null;
}

export interface PurchaseResult {
  // 포인트 차감과 레벨 증가가 모두 적용됐는지 나타낸다.
  purchased: boolean;
  // 구매가 거절됐을 때 UI와 검사에 제공하는 한국어 이유다.
  reason: string | null;
}

let warnedStorageFailure = false;

/**
 * 저장 접근 오류를 한 세션에 한 번만 알리고 메모리 진행은 막지 않는다.
 */
function warnStorageFailure(error: unknown): void {
  if (warnedStorageFailure) {
    return;
  }
  warnedStorageFailure = true;
  const detail =
    error instanceof Error ? error.message : String(error);
  console.warn(
    `[영구 메타] 저장소를 사용할 수 없어 세션 메모리로 계속합니다: ${detail}`,
  );
}

/**
 * 여섯 종류 모두 레벨 0인 안전한 영구 강화 원본을 만든다.
 */
export function createDefaultPermanentUpgrades(): PermanentUpgrades {
  return Object.fromEntries(
    PIECE_TYPES.map((type) => [
      type,
      { force: 0, weight: 0 },
    ]),
  ) as PermanentUpgrades;
}

/**
 * 포인트와 강화가 비어 있는 새 영구 메타 상태를 만든다.
 */
export function createDefaultMetaState(): MetaState {
  return {
    points: 0,
    upgrades: createDefaultPermanentUpgrades(),
  };
}

/**
 * 저장된 레벨 하나를 0~최대 레벨 정수로 검증하고 잘못된 값은 0으로 돌린다.
 */
function sanitizeLevel(value: unknown): number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= PERMANENT_UPGRADE_MAX_LEVEL
    ? value
    : 0;
}

/**
 * JSON에서 읽은 임의 값을 누락 없는 여섯 종류 강화 표로 정규화한다.
 */
function sanitizeUpgrades(value: unknown): PermanentUpgrades {
  const source =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  const upgrades = createDefaultPermanentUpgrades();
  for (const type of PIECE_TYPES) {
    const rawPiece = source[type];
    if (typeof rawPiece !== "object" || rawPiece === null) {
      continue;
    }
    const rawTracks = rawPiece as Record<string, unknown>;
    upgrades[type] = {
      force: sanitizeLevel(rawTracks.force),
      weight: sanitizeLevel(rawTracks.weight),
    };
  }
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
 * 두 저장 키를 독립적으로 읽어 손상된 JSON은 안전 기본값으로 대체한다.
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
    const parsedPoints =
      rawPoints === null ? 0 : (JSON.parse(rawPoints) as unknown);
    const parsedUpgrades =
      rawUpgrades === null
        ? defaults.upgrades
        : (JSON.parse(rawUpgrades) as unknown);
    return {
      points:
        typeof parsedPoints === "number" &&
        Number.isInteger(parsedPoints) &&
        parsedPoints >= 0
          ? parsedPoints
          : 0,
      upgrades: sanitizeUpgrades(parsedUpgrades),
    };
  } catch (error: unknown) {
    warnStorageFailure(error);
    return defaults;
  }
}

/**
 * 현재 메모리 상태를 두 계약 키에 즉시 JSON으로 저장한다.
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

/**
 * 현재 레벨 N에서 N+1로 올리는 선형 포인트 비용을 계산한다.
 */
export function computePermanentUpgradeCost(
  currentLevel: number,
): number {
  if (
    !Number.isInteger(currentLevel) ||
    currentLevel < 0 ||
    currentLevel >= PERMANENT_UPGRADE_MAX_LEVEL
  ) {
    throw new Error(
      `영구 강화 비용을 계산할 현재 레벨 ${currentLevel}가 0~${PERMANENT_UPGRADE_MAX_LEVEL - 1} 범위의 정수가 아닙니다.`,
    );
  }
  return PERMANENT_UPGRADE_COST_UNIT * (currentLevel + 1);
}

/**
 * 한 말 종류와 트랙의 현재 영구 강화 레벨을 반환한다.
 */
export function getPermanentUpgradeLevel(
  upgrades: Readonly<PermanentUpgrades>,
  type: PieceType,
  track: PermanentUpgradeTrack,
): number {
  return upgrades[type][track];
}

/**
 * 한 종류 백 말의 영구 힘 레벨을 가산 발사 속도 비율로 바꾼다.
 */
export function computePermanentForceBonus(
  upgrades: Readonly<PermanentUpgrades>,
  type: PieceType,
): number {
  return upgrades[type].force * PERMANENT_UPGRADE_STEP;
}

/**
 * 한 종류 백 말의 영구 중량 레벨을 가산 hull 질량 비율로 바꾼다.
 */
export function computePermanentWeightFraction(
  upgrades: Readonly<PermanentUpgrades>,
  type: PieceType,
): number {
  return upgrades[type].weight * PERMANENT_UPGRADE_STEP;
}

/**
 * 포인트가 충분한 평면형 노드 하나를 구매하고 즉시 저장한다.
 */
export function purchasePermanentUpgrade(
  runtime: MetaRuntime,
  type: PieceType,
  track: PermanentUpgradeTrack,
): PurchaseResult {
  const pieceUpgrades = runtime.state.upgrades[type];
  const currentLevel = pieceUpgrades[track];
  if (currentLevel >= PERMANENT_UPGRADE_MAX_LEVEL) {
    return { purchased: false, reason: "이미 최대 레벨입니다." };
  }
  const cost = computePermanentUpgradeCost(currentLevel);
  if (runtime.state.points < cost) {
    return { purchased: false, reason: "포인트가 부족합니다." };
  }
  runtime.state.points -= cost;
  pieceUpgrades[track] = currentLevel + 1;
  saveMetaState(runtime);
  return { purchased: true, reason: null };
}

/**
 * 스테이지 승리 보상 100포인트를 카드 선택 전에 더하고 즉시 저장한다.
 */
export function awardStageClearPoints(runtime: MetaRuntime): void {
  runtime.state.points += STAGE_CLEAR_POINTS;
  saveMetaState(runtime);
}
