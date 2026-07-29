import {
  CARD_GRADE_EFFECTS,
  GIANT_PAWN_SIZE_MULTIPLIER,
  PLAYER_MAX_SIZE_SCALE,
  STAGE_MAX_PIECE_SCALE,
} from "./config";
import type {
  CardEffectTuning,
  CardGrade,
} from "./cards";
import type { GameMode } from "./game-mode";

export interface CardTuningSettings {
  // 실제 런 등급과 비교할 디버그 중량 카드 등급이다.
  debugWeightGrade: CardGrade;
  // 실제 런 등급과 비교할 디버그 힘 카드 등급이다.
  debugForceGrade: CardGrade;
  // 실제 런 등급과 비교할 디버그 크기 카드 등급이다.
  debugSizeGrade: CardGrade;
  // 일반 등급이 교체할 최종 효과 비율이다.
  gradeEffect1: number;
  // 중급 등급이 교체할 최종 효과 비율이다.
  gradeEffect2: number;
  // 상급 등급이 교체할 최종 효과 비율이다.
  gradeEffect3: number;
  // 최상급 등급이 교체할 최종 효과 비율이다.
  gradeEffect4: number;
  // 레전드 등급이 교체할 최종 효과 비율이다.
  gradeEffect5: number;
  // 중량 카드의 등급 효과에 마지막으로 곱할 종류별 배수다.
  weightEffectMultiplier: number;
  // 힘 카드의 등급 효과에 마지막으로 곱할 종류별 배수다.
  forceEffectMultiplier: number;
  // 크기 카드의 등급 효과에 마지막으로 곱할 종류별 배수다.
  sizeEffectMultiplier: number;
  // 다음 보드 설정에서 디버그 거대 폰 구조를 적용할지 나타낸다.
  giantPawnEnabled: boolean;
  // 디버그 거대 폰의 원래 폰 대비 균일 크기 배수다.
  giantPawnSizeMultiplier: number;
  // 다음 보드 설정에서 디버그 포복 시작 자세를 적용할지 나타낸다.
  proneStartEnabled: boolean;
}

export type CardTuningKey = keyof CardTuningSettings;
type NumericCardTuningKey = {
  [Key in CardTuningKey]: CardTuningSettings[Key] extends number
    ? Key
    : never;
}[CardTuningKey];
type BooleanCardTuningKey = Exclude<
  CardTuningKey,
  NumericCardTuningKey
>;

// 카드 조절값을 기존 손맛 조절값과 같은 브라우저 접두사 아래 별도 계약으로 저장한다.
export const CARD_TUNING_STORAGE_KEY =
  "chessAlkkagi.tuning.cards";

export interface CardTuningStorage {
  // 저장된 카드 조절값 JSON 문자열을 읽는다.
  getItem: (key: string) => string | null;
  // 변경된 카드 조절값 JSON 문자열을 덮어쓴다.
  setItem: (key: string, value: string) => void;
  // 코드 기본값 복원 때 저장된 카드 조절값을 제거한다.
  removeItem: (key: string) => void;
}

export interface CardTuningLoadResult {
  // 필드별 검증을 통과하거나 해당 코드 기본값으로 대체된 설정이다.
  settings: CardTuningSettings;
  // 손상되어 해당 코드 기본값으로 대체된 필드 이름들이다.
  invalidKeys: CardTuningKey[];
  // 저장 접근 또는 JSON 파싱이 실패했을 때 패널에 한 번 보여 줄 상세다.
  warning: string | null;
}

export interface CardTuningAppliedValues {
  // 현재 보드가 실제로 사용하는 대전 모드다.
  gameMode: GameMode;
  // 현재 보드 설정에 사용된 합성 중량 등급이다.
  weightGrade: CardGrade;
  // 현재 발사 계산에 즉시 사용되는 합성 힘 등급이다.
  forceGrade: CardGrade;
  // 현재 보드 설정에 사용된 합성 크기 등급이다.
  sizeGrade: CardGrade;
  // 현재 보드 백 말 질량에 실제 반영된 카드 가산 비율이다.
  boardWeightFraction: number;
  // 현재 백 말 발사에 즉시 반영되는 카드 가산 비율이다.
  liveForceFraction: number;
  // 현재 보드 백 일반 말의 실제 균일 크기 배율이다.
  boardRegularSizeScale: number;
  // 현재 보드에 거대 폰이 있으면 그 실제 균일 크기 배율이다.
  boardGiantPawnScale: number | null;
  // 현재 보드에 실제 생성된 말 개수다.
  spawnedPieceCount: number;
  // 현재 보드가 포복 개시 자세로 생성됐는지 나타낸다.
  proneStartActive: boolean;
}

export interface CardTuningRelayoutSnapshot {
  // 다시 깔기 전후에 같아야 하는 현재 대전 모드다.
  gameMode: GameMode;
  // 다시 깔기 전후에 같아야 하는 현재 스테이지 번호다.
  stageNumber: number;
  // 런 카드 전체가 바뀌지 않았음을 값 비교할 직렬화 서명이다.
  runCardsSignature: string;
  // 영구 강화 전체가 바뀌지 않았음을 값 비교할 직렬화 서명이다.
  permanentUpgradesSignature: string;
  // 다시 깔기가 보상이나 구매를 일으키지 않았음을 비교할 메타 포인트다.
  points: number;
  // 스테이지 이동이 건너뛴 보상을 만들지 않았음을 비교할 런 임시 정산 상태다.
  stageRunPointsSignature: string;
}

type CardTuningAppliedKey =
  | "grades"
  | "weight"
  | "force"
  | "size"
  | "giantPawn"
  | "proneStart";

interface NumericDefinition {
  label: string;
  min: number;
  max: number;
  step: number;
  // 백분율 입력을 내부 0~1 값으로 변환하기 위한 화면 배율이다.
  displayScale: number;
  suffix: string;
  integer?: boolean;
}

export interface CardTuningRuntime {
  // 게임 적용 함수가 즉시 읽는 카드 디버그 숫자와 스위치의 단일 원본이다.
  settings: CardTuningSettings;
  // Y 키와 쿼리 문자열로 노출을 바꾸는 카드 조절판 컨테이너다.
  panel: HTMLElement;
  // 같은 숫자를 보여 주는 슬라이더·출력·숫자 입력을 함께 갱신한다.
  controls: Map<CardTuningKey, Set<HTMLElement>>;
  // 현재 보드에 실제 적용된 값만 갱신하는 읽기 전용 출력 요소들이다.
  currentValueElements: Map<CardTuningAppliedKey, HTMLElement>;
  // 현재 슬라이더가 다음 보드에 만들 값을 갱신하는 읽기 전용 출력 요소들이다.
  nextValueElements: Map<CardTuningAppliedKey, HTMLElement>;
  // 변경한 전체 카드 설정을 보존하는 선택적 브라우저 저장 연결이다.
  storage: CardTuningStorage | null;
  // 에셋에서 유도한 거대 폰 배수까지 포함한 이번 실행의 코드 기본값이다.
  defaultSettings: CardTuningSettings;
  // 저장·복원 상태 또는 한 번의 손상 경고를 보여 주는 패널 문구다.
  storageNotice: HTMLParagraphElement;
  // 온라인에서 카드 조절값이 무시됨을 별도로 보여 주는 패널 문구다.
  onlineNotice: HTMLParagraphElement;
  // 저장 오류가 반복돼도 패널과 콘솔에는 한 번만 경고하기 위한 상태다.
  storageWarningShown: boolean;
  // 현재 온라인 차단으로 모든 조작을 비활성화했는지 나타낸다.
  onlineDisabled: boolean;
  // 스테이지 이동 버튼의 모드별 활성 여부를 결정하는 현재 대전 모드다.
  gameMode: GameMode;
  // 이동할 스테이지를 1 이상의 정수로 받는 디버그 입력이다.
  stageJumpInput: HTMLInputElement;
  // 스테이지 모드에서만 기존 보드 리셋 경로를 실행하는 이동 버튼이다.
  stageJumpButton: HTMLButtonElement;
  // 핫시트에서 이동 기능을 쓸 수 없는 이유를 짧게 보여 주는 문구다.
  stageOnlyNotice: HTMLParagraphElement;
  // 힘처럼 다음 보드 없이 적용할 값의 읽기 전용 출력을 외부가 갱신하는 연결점이다.
  settingsChangedHandler: (() => void) | null;
  // 현재 모드·스테이지·런 상태를 보존한 기존 보드 리셋을 외부가 실행하는 연결점이다.
  relayoutHandler: (() => Promise<void>) | null;
  // 입력한 단계로 현재 런 번호만 바꾸고 기존 보드 리셋을 실행하는 연결점이다.
  stageJumpHandler:
    | ((stageNumber: number) => Promise<void>)
    | null;
}

const NUMERIC_DEFINITIONS: Record<
  NumericCardTuningKey,
  NumericDefinition
> = {
  debugWeightGrade: {
    label: "현재 중량 카드 등급 · 다음 보드",
    min: 0,
    max: 5,
    step: 1,
    displayScale: 1,
    suffix: "등급",
    integer: true,
  },
  debugForceGrade: {
    label: "현재 힘 카드 등급 · 즉시",
    min: 0,
    max: 5,
    step: 1,
    displayScale: 1,
    suffix: "등급",
    integer: true,
  },
  debugSizeGrade: {
    label: "현재 크기 카드 등급 · 다음 보드",
    min: 0,
    max: 5,
    step: 1,
    displayScale: 1,
    suffix: "등급",
    integer: true,
  },
  gradeEffect1: {
    label: "일반 등급 효과 · 즉시·다음 보드 공통",
    min: 0,
    max: 1,
    step: 0.001,
    displayScale: 100,
    suffix: "%",
  },
  gradeEffect2: {
    label: "중급 등급 효과 · 즉시·다음 보드 공통",
    min: 0,
    max: 1,
    step: 0.001,
    displayScale: 100,
    suffix: "%",
  },
  gradeEffect3: {
    label: "상급 등급 효과 · 즉시·다음 보드 공통",
    min: 0,
    max: 1,
    step: 0.001,
    displayScale: 100,
    suffix: "%",
  },
  gradeEffect4: {
    label: "최상급 등급 효과 · 즉시·다음 보드 공통",
    min: 0,
    max: 1,
    step: 0.001,
    displayScale: 100,
    suffix: "%",
  },
  gradeEffect5: {
    label: "레전드 등급 효과 · 즉시·다음 보드 공통",
    min: 0,
    max: 1,
    step: 0.001,
    displayScale: 100,
    suffix: "%",
  },
  weightEffectMultiplier: {
    label: "중량 카드 배수 · 다음 보드",
    min: 0,
    max: 5,
    step: 0.01,
    displayScale: 1,
    suffix: "×",
  },
  forceEffectMultiplier: {
    label: "힘 카드 배수 · 즉시",
    min: 0,
    max: 5,
    step: 0.01,
    displayScale: 1,
    suffix: "×",
  },
  sizeEffectMultiplier: {
    label: "크기 카드 배수 · 다음 보드",
    min: 0,
    max: 5,
    step: 0.01,
    displayScale: 1,
    suffix: "×",
  },
  giantPawnSizeMultiplier: {
    label: "거대 폰 크기 배수 · 다음 보드",
    min: 0.5,
    max: STAGE_MAX_PIECE_SCALE,
    step: 0.01,
    displayScale: 1,
    suffix: "×",
  },
};

/**
 * 플래너의 1.3배 거대 폰 기본값을 포함해 저장과 초기화가 공유할 코드 기본값을 만든다.
 */
export function createDefaultCardTuningSettings(
  giantPawnSizeMultiplier: number = GIANT_PAWN_SIZE_MULTIPLIER,
): CardTuningSettings {
  if (
    !Number.isFinite(giantPawnSizeMultiplier) ||
    giantPawnSizeMultiplier <
      NUMERIC_DEFINITIONS.giantPawnSizeMultiplier.min ||
    giantPawnSizeMultiplier >
      NUMERIC_DEFINITIONS.giantPawnSizeMultiplier.max
  ) {
    throw new Error(
      `기본 거대 폰 크기 배수 ${giantPawnSizeMultiplier}가 조절 범위 안의 유한한 수가 아닙니다.`,
    );
  }
  return {
    debugWeightGrade: 0,
    debugForceGrade: 0,
    debugSizeGrade: 0,
    gradeEffect1: CARD_GRADE_EFFECTS[0],
    gradeEffect2: CARD_GRADE_EFFECTS[1],
    gradeEffect3: CARD_GRADE_EFFECTS[2],
    gradeEffect4: CARD_GRADE_EFFECTS[3],
    gradeEffect5: CARD_GRADE_EFFECTS[4],
    weightEffectMultiplier: 1,
    forceEffectMultiplier: 1,
    sizeEffectMultiplier: 1,
    giantPawnEnabled: false,
    giantPawnSizeMultiplier,
    proneStartEnabled: false,
  };
}

/**
 * 저장용 평면 설정을 카드 계산 경로가 받는 등급표 프로필로 값 복사한다.
 */
export function createCardEffectTuning(
  settings: Readonly<CardTuningSettings>,
): CardEffectTuning {
  return {
    debugWeightGrade: settings.debugWeightGrade,
    debugForceGrade: settings.debugForceGrade,
    debugSizeGrade: settings.debugSizeGrade,
    gradeEffects: [
      settings.gradeEffect1,
      settings.gradeEffect2,
      settings.gradeEffect3,
      settings.gradeEffect4,
      settings.gradeEffect5,
    ],
    weightEffectMultiplier: settings.weightEffectMultiplier,
    forceEffectMultiplier: settings.forceEffectMultiplier,
    sizeEffectMultiplier: settings.sizeEffectMultiplier,
    giantPawnEnabled: settings.giantPawnEnabled,
    giantPawnSizeMultiplier: settings.giantPawnSizeMultiplier,
    proneStartEnabled: settings.proneStartEnabled,
  };
}

/**
 * 사생활 모드에서 localStorage getter 자체가 실패해도 부팅을 계속할 연결과 경고를 반환한다.
 */
function resolveBrowserCardTuningStorage(): {
  storage: CardTuningStorage | null;
  warning: string | null;
} {
  if (typeof window === "undefined") {
    return { storage: null, warning: null };
  }
  try {
    return { storage: window.localStorage, warning: null };
  } catch (error: unknown) {
    const detail =
      error instanceof Error ? error.message : String(error);
    return {
      storage: null,
      warning: `기기 저장소를 사용할 수 없어 이번 실행에서만 카드 조절값을 사용합니다: ${detail}`,
    };
  }
}

/**
 * 저장된 전체 객체를 필드별로 검사해 손상된 필드만 코드 기본값으로 되돌린다.
 */
export function loadCardTuningSettings(
  storage: CardTuningStorage | null,
  giantPawnSizeMultiplier: number,
): CardTuningLoadResult {
  const settings = createDefaultCardTuningSettings(
    giantPawnSizeMultiplier,
  );
  if (storage === null) {
    return { settings, invalidKeys: [], warning: null };
  }
  try {
    const raw = storage.getItem(CARD_TUNING_STORAGE_KEY);
    if (raw === null) {
      return { settings, invalidKeys: [], warning: null };
    }
    const parsed = JSON.parse(raw) as unknown;
    const source =
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    const invalidKeys: CardTuningKey[] = [];
    for (const key of Object.keys(settings) as CardTuningKey[]) {
      const value = source?.[key];
      if (key === "giantPawnEnabled" || key === "proneStartEnabled") {
        if (typeof value === "boolean") {
          settings[key] = value;
        } else {
          invalidKeys.push(key);
        }
        continue;
      }
      const definition = NUMERIC_DEFINITIONS[key];
      if (
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= definition.min &&
        value <= definition.max &&
        (!definition.integer || Number.isInteger(value))
      ) {
        settings[key] = value as never;
      } else {
        invalidKeys.push(key);
      }
    }
    return {
      settings,
      invalidKeys,
      warning:
        invalidKeys.length === 0
          ? null
          : `저장된 카드 조절값 중 ${invalidKeys.join(", ")} 필드를 코드 기본값으로 복원했습니다.`,
    };
  } catch (error: unknown) {
    const detail =
      error instanceof Error ? error.message : String(error);
    return {
      settings,
      invalidKeys: Object.keys(settings) as CardTuningKey[],
      warning: `저장된 카드 조절값을 읽지 못해 코드 기본값으로 시작합니다: ${detail}`,
    };
  }
}

/**
 * 검증된 전체 카드 조절값을 단일 JSON으로 저장하고 실패 상세만 반환한다.
 */
export function saveCardTuningSettings(
  storage: CardTuningStorage | null,
  settings: Readonly<CardTuningSettings>,
): string | null {
  if (storage === null) {
    return null;
  }
  try {
    storage.setItem(
      CARD_TUNING_STORAGE_KEY,
      JSON.stringify(settings),
    );
    return null;
  } catch (error: unknown) {
    const detail =
      error instanceof Error ? error.message : String(error);
    return `카드 조절값을 기기에 저장하지 못했습니다: ${detail}`;
  }
}

/**
 * 초기화가 코드 기본값으로 돌아가는 동시에 저장된 카드 조절값을 제거한다.
 */
export function clearCardTuningSettings(
  storage: CardTuningStorage | null,
): string | null {
  if (storage === null) {
    return null;
  }
  try {
    storage.removeItem(CARD_TUNING_STORAGE_KEY);
    return null;
  } catch (error: unknown) {
    const detail =
      error instanceof Error ? error.message : String(error);
    return `저장된 카드 조절값을 삭제하지 못했습니다: ${detail}`;
  }
}

/**
 * 기존 보드 리셋을 실행하고 모드·스테이지·런 카드·영구 강화·포인트 보존을 검증한다.
 */
export async function relayoutCurrentCardTuningBoard(
  readSnapshot: () => CardTuningRelayoutSnapshot,
  resetBoard: (
    gameMode: GameMode,
    stageNumber: number,
  ) => Promise<void>,
): Promise<void> {
  const before = readSnapshot();
  if (before.gameMode === "online") {
    throw new Error(
      "온라인 대전에서는 카드 조절값으로 현재 판을 다시 깔 수 없습니다.",
    );
  }
  await resetBoard(before.gameMode, before.stageNumber);
  const after = readSnapshot();
  if (
    after.gameMode !== before.gameMode ||
    after.stageNumber !== before.stageNumber ||
    after.runCardsSignature !== before.runCardsSignature ||
    after.permanentUpgradesSignature !==
      before.permanentUpgradesSignature ||
    after.points !== before.points ||
    after.stageRunPointsSignature !==
      before.stageRunPointsSignature
  ) {
    throw new Error(
      `현재 판 다시 깔기가 런 상태를 바꿨습니다: before=${JSON.stringify(before)}, after=${JSON.stringify(after)}`,
    );
  }
}

/**
 * 보드 리셋 전후에 단계만 의도대로 달라지고 런 상태 서명은 모두 보존됐는지 확인한다.
 */
function matchesCardTuningJumpSnapshot(
  snapshot: CardTuningRelayoutSnapshot,
  reference: CardTuningRelayoutSnapshot,
  stageNumber: number,
): boolean {
  return (
    snapshot.gameMode === "stage" &&
    snapshot.stageNumber === stageNumber &&
    snapshot.runCardsSignature ===
      reference.runCardsSignature &&
    snapshot.permanentUpgradesSignature ===
      reference.permanentUpgradesSignature &&
    snapshot.points === reference.points &&
    snapshot.stageRunPointsSignature ===
      reference.stageRunPointsSignature
  );
}

/**
 * 스테이지 모드에서 현재 단계 번호만 바꾼 뒤 기존 보드 리셋으로 실제 맵과 버프를 다시 만든다.
 */
export async function jumpCardTuningStage(
  targetStageNumber: number,
  readSnapshot: () => CardTuningRelayoutSnapshot,
  setStageNumber: (stageNumber: number) => void,
  resetBoard: (
    gameMode: GameMode,
    stageNumber: number,
  ) => Promise<void>,
): Promise<void> {
  if (
    !Number.isInteger(targetStageNumber) ||
    targetStageNumber < 1
  ) {
    throw new Error(
      `이동할 스테이지 ${targetStageNumber}가 1 이상의 정수가 아닙니다.`,
    );
  }
  const before = readSnapshot();
  if (before.gameMode !== "stage") {
    throw new Error("스테이지 이동은 스테이지 모드 전용입니다.");
  }
  setStageNumber(targetStageNumber);
  try {
    await resetBoard("stage", targetStageNumber);
    const after = readSnapshot();
    if (
      !matchesCardTuningJumpSnapshot(
        after,
        before,
        targetStageNumber,
      )
    ) {
      throw new Error(
        `스테이지 이동이 단계 이외의 런 상태를 바꿨습니다: before=${JSON.stringify(before)}, after=${JSON.stringify(after)}`,
      );
    }
  } catch (targetError: unknown) {
    try {
      // 실패한 리셋이 말·벽·렌더를 변형했을 수 있으므로 번호만 되돌리지 않고 원래 판을 처음부터 다시 만든다.
      setStageNumber(before.stageNumber);
      await resetBoard("stage", before.stageNumber);
      const recovered = readSnapshot();
      if (
        !matchesCardTuningJumpSnapshot(
          recovered,
          before,
          before.stageNumber,
        )
      ) {
        throw new Error(
          `원래 스테이지 복구가 런 상태를 보존하지 못했습니다: before=${JSON.stringify(before)}, recovered=${JSON.stringify(recovered)}`,
        );
      }
    } catch (recoveryError: unknown) {
      const targetDetail =
        targetError instanceof Error
          ? targetError.message
          : String(targetError);
      const recoveryDetail =
        recoveryError instanceof Error
          ? recoveryError.message
          : String(recoveryError);
      throw new Error(
        `${targetStageNumber}스테이지 이동 실패 뒤 ${before.stageNumber}스테이지 복구에도 실패했습니다: 대상 실패=${targetDetail}; 복구 실패=${recoveryDetail}`,
      );
    }
    // 원래 판이 완전히 복구된 뒤에는 UI가 기존 대상 단계 거부 문구를 그대로 표시하게 한다.
    throw targetError;
  }
}

/**
 * 저장 오류나 손상 안내를 반복하지 않고 패널과 콘솔에 한 번만 남긴다.
 */
function showCardTuningStorageWarning(
  runtime: CardTuningRuntime,
  warning: string,
): void {
  if (runtime.storageWarningShown) {
    return;
  }
  runtime.storageWarningShown = true;
  runtime.storageNotice.textContent = warning;
  runtime.storageNotice.classList.add("tuning-storage-warning");
  console.warn(`[카드 효과 조절판] ${warning}`);
}

/**
 * 숫자 조절값 하나를 화면 범위에 맞춰 저장하고 모든 연결 UI에 반영한다.
 */
export function setCardTuningNumericValue(
  runtime: CardTuningRuntime,
  key: NumericCardTuningKey,
  value: number,
  persist = true,
): void {
  if (!Number.isFinite(value)) {
    return;
  }
  const definition = NUMERIC_DEFINITIONS[key];
  let clamped = Math.min(
    Math.max(value, definition.min),
    definition.max,
  );
  if (definition.integer) {
    clamped = Math.round(clamped);
  }
  runtime.settings[key] = clamped as never;
  for (const element of runtime.controls.get(key) ?? []) {
    if (element instanceof HTMLInputElement) {
      element.value = String(clamped * definition.displayScale);
    } else if (element instanceof HTMLOutputElement) {
      const digits =
        definition.integer || definition.step >= 1
          ? 0
          : definition.step < 0.01
            ? 1
            : 2;
      element.value = `${(clamped * definition.displayScale).toFixed(digits)}${definition.suffix}`;
    }
  }
  if (persist) {
    persistCardTuning(runtime);
    runtime.settingsChangedHandler?.();
  }
}

/**
 * 특수 카드 스위치를 저장하고 연결된 체크박스를 함께 갱신한다.
 */
export function setCardTuningBooleanValue(
  runtime: CardTuningRuntime,
  key: BooleanCardTuningKey,
  value: boolean,
  persist = true,
): void {
  runtime.settings[key] = value as never;
  for (const element of runtime.controls.get(key) ?? []) {
    if (element instanceof HTMLInputElement) {
      element.checked = value;
    }
  }
  if (persist) {
    persistCardTuning(runtime);
    runtime.settingsChangedHandler?.();
  }
}

/**
 * 현재 전체 설정을 저장하고 실패하면 이후 저장 시도를 중단한다.
 */
function persistCardTuning(runtime: CardTuningRuntime): void {
  const warning = saveCardTuningSettings(
    runtime.storage,
    runtime.settings,
  );
  if (warning !== null) {
    runtime.storage = null;
    showCardTuningStorageWarning(runtime, warning);
  } else if (!runtime.storageWarningShown) {
    runtime.storageNotice.textContent =
      "변경한 카드 조절값을 이 기기에 저장했습니다.";
  }
}

/**
 * 온라인에서는 모든 조작을 비활성화하되 저장된 로컬 값은 바꾸지 않는다.
 */
export function setCardTuningGameMode(
  runtime: CardTuningRuntime,
  gameMode: GameMode,
): void {
  const disabled = gameMode === "online";
  runtime.onlineDisabled = disabled;
  runtime.gameMode = gameMode;
  for (const elements of runtime.controls.values()) {
    for (const element of elements) {
      if (element instanceof HTMLInputElement) {
        element.disabled = disabled;
      }
    }
  }
  for (const button of runtime.panel.querySelectorAll<HTMLButtonElement>(
    "[data-card-tuning-reset], [data-card-tuning-relayout]",
  )) {
    button.disabled = disabled;
  }
  const stageJumpDisabled = gameMode !== "stage";
  runtime.stageJumpInput.disabled = stageJumpDisabled;
  runtime.stageJumpButton.disabled = stageJumpDisabled;
  runtime.stageOnlyNotice.hidden = gameMode !== "hotseat";
  runtime.onlineNotice.hidden = !disabled;
}

/**
 * 성공적으로 다시 깐 보드의 현재 단계를 이동 입력 기본값과 동기화한다.
 */
export function updateCardTuningStageNumber(
  runtime: CardTuningRuntime,
  stageNumber: number,
): void {
  if (!Number.isInteger(stageNumber) || stageNumber < 1) {
    throw new Error(
      `카드 조절판 현재 스테이지 ${stageNumber}가 1 이상의 정수가 아닙니다.`,
    );
  }
  runtime.stageJumpInput.value = String(stageNumber);
}

/**
 * 숫자 슬라이더·출력·직접 입력을 한 행에 묶어 동일한 설정값에 연결한다.
 */
function appendNumericControl(
  runtime: CardTuningRuntime,
  parent: HTMLElement,
  key: NumericCardTuningKey,
): void {
  const definition = NUMERIC_DEFINITIONS[key];
  const row = document.createElement("label");
  row.className = "tuning-control";
  const label = document.createElement("span");
  label.textContent = definition.label;
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = String(definition.min * definition.displayScale);
  slider.max = String(definition.max * definition.displayScale);
  slider.step = String(definition.step * definition.displayScale);
  const output = document.createElement("output");
  const numeric = document.createElement("input");
  numeric.type = "number";
  numeric.min = slider.min;
  numeric.max = slider.max;
  numeric.step = slider.step;
  row.append(label, slider, output, numeric);
  parent.append(row);
  for (const element of [slider, output, numeric]) {
    let elements = runtime.controls.get(key);
    if (elements === undefined) {
      elements = new Set();
      runtime.controls.set(key, elements);
    }
    elements.add(element);
  }
  const handleInput = (element: HTMLInputElement): void => {
    setCardTuningNumericValue(
      runtime,
      key,
      Number(element.value) / definition.displayScale,
    );
  };
  slider.addEventListener("input", () => handleInput(slider));
  numeric.addEventListener("input", () => handleInput(numeric));
  setCardTuningNumericValue(
    runtime,
    key,
    runtime.settings[key],
    false,
  );
}

/**
 * 실제 효과가 있는 특수 카드 스위치를 체크박스 행으로 연결한다.
 */
function appendBooleanControl(
  runtime: CardTuningRuntime,
  parent: HTMLElement,
  key: BooleanCardTuningKey,
  labelText: string,
): void {
  const row = document.createElement("label");
  row.className = "tuning-control tuning-toggle";
  const label = document.createElement("span");
  label.textContent = labelText;
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = runtime.settings[key];
  row.append(label, checkbox);
  parent.append(row);
  runtime.controls.set(key, new Set([checkbox]));
  checkbox.addEventListener("change", () => {
    setCardTuningBooleanValue(
      runtime,
      key,
      checkbox.checked,
    );
  });
}

/**
 * 카드 가산 비율을 읽기 쉬운 백분율로 바꾼다.
 */
function formatPercent(fraction: number): string {
  const percentage = (fraction * 100).toFixed(2);
  return `+${percentage.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")}%`;
}

/**
 * 한 읽기 전용 항목을 현재 보드와 다음 보드가 공유하는 문구로 변환한다.
 */
function formatCardTuningAppliedValue(
  key: CardTuningAppliedKey,
  values: CardTuningAppliedValues,
): string {
  if (values.gameMode === "online") {
    return "온라인 비활성";
  }
  if (key === "grades") {
    return `중량 ${values.weightGrade} / 힘 ${values.forceGrade} / 크기 ${values.sizeGrade}`;
  }
  if (key === "weight") {
    return formatPercent(values.boardWeightFraction);
  }
  if (key === "force") {
    return `${formatPercent(values.liveForceFraction)} (즉시)`;
  }
  if (key === "size") {
    return `${values.boardRegularSizeScale.toFixed(3)}×${values.boardRegularSizeScale >= PLAYER_MAX_SIZE_SCALE ? " (상한 도달)" : ""}`;
  }
  if (key === "giantPawn") {
    return values.boardGiantPawnScale === null
      ? `꺼짐 · 말 ${values.spawnedPieceCount}개`
      : `${values.boardGiantPawnScale.toFixed(3)}× · 말 ${values.spawnedPieceCount}개`;
  }
  return values.proneStartActive ? "켜짐" : "꺼짐";
}

/**
 * 현재 실제값과 다음 보드 예상값을 분리하고 예상 그룹에는 변화 방향을 함께 표시한다.
 */
export function updateCardTuningAppliedValues(
  runtime: CardTuningRuntime,
  currentValues: CardTuningAppliedValues,
  nextValues: CardTuningAppliedValues,
): void {
  for (const key of runtime.currentValueElements.keys()) {
    const currentElement = runtime.currentValueElements.get(key);
    const nextElement = runtime.nextValueElements.get(key);
    if (currentElement === undefined || nextElement === undefined) {
      throw new Error(`카드 적용 시점 출력 ${key}를 찾지 못했습니다.`);
    }
    const currentText = formatCardTuningAppliedValue(
      key,
      currentValues,
    );
    const nextText = formatCardTuningAppliedValue(key, nextValues);
    currentElement.textContent = currentText;
    nextElement.textContent =
      nextValues.gameMode === "online"
        ? nextText
        : `${currentText} → ${nextText}`;
  }
}

/**
 * 현재 보드 또는 다음 보드 카드 값을 표시할 읽기 전용 그룹을 만든다.
 */
function appendAppliedValuesGroup(
  runtime: CardTuningRuntime,
  title: string,
  elements: Map<CardTuningAppliedKey, HTMLElement>,
): void {
  const fieldset = document.createElement("fieldset");
  const legend = document.createElement("legend");
  legend.textContent = title;
  const list = document.createElement("dl");
  list.className = "tuning-readout";
  const definitions: ReadonlyArray<{
    key: CardTuningAppliedKey;
    label: string;
  }> = [
    { key: "grades", label: "합성 카드 등급" },
    { key: "weight", label: "중량 카드 효과" },
    { key: "force", label: "힘 카드 효과 · 즉시" },
    { key: "size", label: "일반 크기" },
    { key: "giantPawn", label: "거대 폰" },
    { key: "proneStart", label: "포복 개시" },
  ];
  for (const definition of definitions) {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    const value = document.createElement("dd");
    term.textContent = definition.label;
    value.textContent = "해당 없음";
    row.append(term, value);
    list.append(row);
    elements.set(definition.key, value);
  }
  fieldset.append(legend, list);
  runtime.panel.append(fieldset);
}

/**
 * Y 키로 여는 카드 등급·곡선·종류별 배수·특수 카드 라이브 조절판을 만든다.
 */
export function createCardTuningRuntime(
  container: HTMLElement,
  giantPawnSizeMultiplier: number = GIANT_PAWN_SIZE_MULTIPLIER,
  storage?: CardTuningStorage | null,
): CardTuningRuntime {
  const resolvedStorage =
    storage === undefined
      ? resolveBrowserCardTuningStorage()
      : { storage, warning: null };
  const defaultSettings = createDefaultCardTuningSettings(
    giantPawnSizeMultiplier,
  );
  const loaded = loadCardTuningSettings(
    resolvedStorage.storage,
    giantPawnSizeMultiplier,
  );
  const panel = document.createElement("aside");
  panel.className = "tuning-panel card-tuning-panel";
  panel.hidden =
    new URLSearchParams(window.location.search).get("cardTune") !==
    "1";
  panel.innerHTML = "<h2>카드 효과 조절판 · Y</h2>";
  container.append(panel);
  const storageNotice = document.createElement("p");
  storageNotice.className = "tuning-note tuning-storage-notice";
  storageNotice.textContent =
    resolvedStorage.storage === null
      ? "이 조절판은 기기 저장을 사용하지 않습니다."
      : "변경한 카드 조절값은 이 기기에 자동 저장됩니다.";
  const onlineNotice = document.createElement("p");
  onlineNotice.className = "tuning-note tuning-online-notice";
  onlineNotice.textContent =
    "온라인 대전에서는 양쪽 물리 결정성을 위해 카드 조절값을 모두 무시합니다.";
  onlineNotice.hidden = true;
  const stageJumpInput = document.createElement("input");
  stageJumpInput.type = "number";
  stageJumpInput.min = "1";
  stageJumpInput.step = "1";
  stageJumpInput.value = "1";
  stageJumpInput.disabled = true;
  const stageJumpButton = document.createElement("button");
  stageJumpButton.type = "button";
  stageJumpButton.dataset.cardTuningStageJump = "";
  stageJumpButton.textContent = "이 스테이지로 이동";
  stageJumpButton.disabled = true;
  const stageOnlyNotice = document.createElement("p");
  stageOnlyNotice.className = "tuning-note";
  stageOnlyNotice.textContent = "스테이지 모드 전용";
  const runtime: CardTuningRuntime = {
    settings: loaded.settings,
    panel,
    controls: new Map(),
    currentValueElements: new Map(),
    nextValueElements: new Map(),
    storage: resolvedStorage.storage,
    defaultSettings,
    storageNotice,
    onlineNotice,
    storageWarningShown: false,
    onlineDisabled: false,
    gameMode: "hotseat",
    stageJumpInput,
    stageJumpButton,
    stageOnlyNotice,
    settingsChangedHandler: null,
    relayoutHandler: null,
    stageJumpHandler: null,
  };
  const initialWarning =
    resolvedStorage.warning ?? loaded.warning;
  if (initialWarning !== null) {
    showCardTuningStorageWarning(runtime, initialWarning);
  }
  appendAppliedValuesGroup(
    runtime,
    "현재 보드 적용값 · 실제",
    runtime.currentValueElements,
  );
  appendAppliedValuesGroup(
    runtime,
    "다음 보드 예상값 · 현재 조절값",
    runtime.nextValueElements,
  );
  const groups: ReadonlyArray<{
    title: string;
    keys: readonly NumericCardTuningKey[];
  }> = [
    {
      title: "현재 디버그 카드 등급 · 적용 시점은 항목별 표시",
      keys: [
        "debugWeightGrade",
        "debugForceGrade",
        "debugSizeGrade",
      ],
    },
    {
      title: "등급별 교체 효과 수치 · 즉시·다음 보드 공통",
      keys: [
        "gradeEffect1",
        "gradeEffect2",
        "gradeEffect3",
        "gradeEffect4",
        "gradeEffect5",
      ],
    },
    {
      title: "카드 종류별 최종 배수 · 적용 시점은 항목별 표시",
      keys: [
        "weightEffectMultiplier",
        "forceEffectMultiplier",
        "sizeEffectMultiplier",
      ],
    },
  ];
  for (const group of groups) {
    const fieldset = document.createElement("fieldset");
    const legend = document.createElement("legend");
    legend.textContent = group.title;
    fieldset.append(legend);
    for (const key of group.keys) {
      appendNumericControl(runtime, fieldset, key);
    }
    panel.append(fieldset);
  }
  const specialFieldset = document.createElement("fieldset");
  const specialLegend = document.createElement("legend");
  specialLegend.textContent = "특수 카드 · 다음 보드 설정부터 적용";
  specialFieldset.append(specialLegend);
  appendBooleanControl(
    runtime,
    specialFieldset,
    "giantPawnEnabled",
    "거대 폰 적용 · 다음 보드",
  );
  appendNumericControl(
    runtime,
    specialFieldset,
    "giantPawnSizeMultiplier",
  );
  appendBooleanControl(
    runtime,
    specialFieldset,
    "proneStartEnabled",
    "포복 개시 적용 · 다음 보드",
  );
  panel.append(specialFieldset);
  const stageJumpFieldset = document.createElement("fieldset");
  const stageJumpLegend = document.createElement("legend");
  stageJumpLegend.textContent = "스테이지 이동 · 디버그";
  const stageJumpControl = document.createElement("label");
  stageJumpControl.className = "tuning-control";
  const stageJumpLabel = document.createElement("span");
  stageJumpLabel.textContent = "이동할 스테이지";
  stageJumpControl.append(stageJumpLabel, stageJumpInput);
  const stageJumpActions = document.createElement("div");
  stageJumpActions.className = "tuning-actions";
  stageJumpActions.append(stageJumpButton);
  stageJumpFieldset.append(
    stageJumpLegend,
    stageJumpControl,
    stageJumpActions,
    stageOnlyNotice,
  );
  panel.append(stageJumpFieldset);
  const compositionNote = document.createElement("p");
  compositionNote.className = "tuning-note";
  compositionNote.textContent =
    "핫시트와 스테이지의 백 말에 적용됩니다. 힘은 즉시, 중량·크기·특수 카드는 다음 보드 설정부터 적용됩니다. 스테이지에서는 실제 런 카드와 디버그 카드 중 높은 등급이 이 곡선·종류별 배수를 사용합니다.";
  const actions = document.createElement("div");
  actions.className = "tuning-actions";
  const relayoutButton = document.createElement("button");
  relayoutButton.type = "button";
  relayoutButton.dataset.cardTuningRelayout = "";
  relayoutButton.textContent = "현재 판 다시 깔기 · 런 상태 유지";
  const actionNotice = document.createElement("p");
  actionNotice.className = "tuning-note";
  actionNotice.setAttribute("aria-live", "polite");
  actionNotice.hidden = true;
  stageJumpButton.addEventListener("click", () => {
    if (
      runtime.gameMode !== "stage" ||
      runtime.stageJumpHandler === null
    ) {
      return;
    }
    const targetStageNumber = Number(stageJumpInput.value);
    stageJumpButton.disabled = true;
    actionNotice.hidden = false;
    actionNotice.textContent =
      `${targetStageNumber}스테이지의 실제 맵과 버프로 이동하는 중입니다.`;
    void runtime
      .stageJumpHandler(targetStageNumber)
      .then(() => {
        actionNotice.textContent =
          `${targetStageNumber}스테이지로 이동했습니다. 카드와 포인트는 유지됐습니다.`;
      })
      .catch((error: unknown) => {
        const detail =
          error instanceof Error ? error.message : String(error);
        actionNotice.textContent =
          `스테이지로 이동하지 못했습니다: ${detail}`;
        console.error(error);
      })
      .finally(() => {
        stageJumpButton.disabled =
          runtime.gameMode !== "stage";
      });
  });
  relayoutButton.addEventListener("click", () => {
    if (
      runtime.onlineDisabled ||
      runtime.relayoutHandler === null
    ) {
      return;
    }
    relayoutButton.disabled = true;
    actionNotice.hidden = false;
    actionNotice.textContent =
      "현재 모드와 런 상태를 유지한 채 보드를 다시 까는 중입니다.";
    void runtime
      .relayoutHandler()
      .then(() => {
        actionNotice.textContent =
          "현재 조절값으로 보드를 다시 깔았습니다. 스테이지와 런 상태는 유지됐습니다.";
      })
      .catch((error: unknown) => {
        const detail =
          error instanceof Error ? error.message : String(error);
        actionNotice.textContent =
          `현재 판을 다시 깔지 못했습니다: ${detail}`;
        console.error(error);
      })
      .finally(() => {
        relayoutButton.disabled = runtime.onlineDisabled;
      });
  });
  const resetButton = document.createElement("button");
  resetButton.type = "button";
  resetButton.dataset.cardTuningReset = "";
  resetButton.textContent = "코드 기본값 복원 · 저장 삭제";
  resetButton.addEventListener("click", () => {
    for (const key of Object.keys(
      runtime.defaultSettings,
    ) as CardTuningKey[]) {
      const value = runtime.defaultSettings[key];
      if (typeof value === "boolean") {
        setCardTuningBooleanValue(
          runtime,
          key as BooleanCardTuningKey,
          value,
          false,
        );
      } else {
        setCardTuningNumericValue(
          runtime,
          key as NumericCardTuningKey,
          value,
          false,
        );
      }
    }
    const warning = clearCardTuningSettings(runtime.storage);
    if (warning !== null) {
      runtime.storage = null;
      showCardTuningStorageWarning(runtime, warning);
    } else if (!runtime.storageWarningShown) {
      runtime.storageNotice.textContent =
        "코드 기본값으로 복원하고 카드 기기 저장값을 삭제했습니다.";
    }
    runtime.settingsChangedHandler?.();
  });
  actions.append(relayoutButton, resetButton);
  panel.append(
    compositionNote,
    storageNotice,
    onlineNotice,
    actionNotice,
    actions,
  );
  window.addEventListener("keydown", (event) => {
    const target = event.target;
    if (
      event.code === "KeyY" &&
      !event.repeat &&
      !(target instanceof HTMLInputElement)
    ) {
      panel.hidden = !panel.hidden;
    }
  });
  return runtime;
}
