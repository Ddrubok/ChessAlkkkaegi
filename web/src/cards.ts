import {
  CARD_FORCE_STEP,
  CARD_SIZE_STEP,
  PLAYER_MAX_SIZE_SCALE,
} from "./config";
import type { GameMode } from "./game-mode";

export type CardId =
  | "size"
  | "weight"
  | "force"
  | "giantPawn"
  | "proneStart";

export interface UpgradeCard {
  // 런 상태에 효과를 적용할 때 사용하는 안정적인 식별자다.
  id: CardId;
  // 카드 버튼의 첫 줄에 표시할 한국어 이름이다.
  name: string;
  // 카드 버튼의 둘째 줄에 표시할 한 문장 설명이다.
  description: string;
  // 한 번 고르면 남은 런의 추첨 풀에서 빠지는 효과인지 나타낸다.
  oneShot: boolean;
}

export interface RunCardState {
  // 크기 카드의 가산 누적 횟수다.
  sizePicks: number;
  // 중량 카드의 가산 누적 횟수다.
  weightPicks: number;
  // 힘 카드의 가산 누적 횟수다.
  forcePicks: number;
  // 거대 폰을 이미 골라 이번 런에 적용 중인지 나타낸다.
  giantPawn: boolean;
  // 포복 개시를 이미 골라 이번 런에 적용 중인지 나타낸다.
  proneStart: boolean;
  // 결정적 추첨 해시에 넣을 지금까지의 전체 선택 횟수다.
  picksSoFar: number;
}

// 카드 이름과 설명은 기획 문구를 그대로 보존하는 단일 풀이다.
export const UPGRADE_CARDS: readonly UpgradeCard[] = [
  {
    id: "size",
    name: "크기 상승",
    description: "내 모든 말이 조금 커진다",
    oneShot: false,
  },
  {
    id: "weight",
    name: "중량 상승",
    description: "내 모든 말이 무거워진다",
    oneShot: false,
  },
  {
    id: "force",
    name: "힘 상승",
    description: "발사 세기가 강해진다",
    oneShot: false,
  },
  {
    id: "giantPawn",
    name: "거대 폰",
    description: "폰 4개를 잃고 남은 폰이 킹 크기가 된다",
    oneShot: true,
  },
  {
    id: "proneStart",
    name: "포복 개시",
    description: "내 말이 모두 누운 채 시작한다",
    oneShot: true,
  },
];

/**
 * 강화가 하나도 없는 새 스테이지 런 카드 상태를 만든다.
 */
export function createRunCardState(): RunCardState {
  return {
    sizePicks: 0,
    weightPicks: 0,
    forcePicks: 0,
    giantPawn: false,
    proneStart: false,
    picksSoFar: 0,
  };
}

/**
 * 비동기 보드 재생성 실패 때 정확히 되돌릴 수 있도록 런 상태를 값으로 복사한다.
 */
export function cloneRunCardState(
  state: Readonly<RunCardState>,
): RunCardState {
  return { ...state };
}

/**
 * 기존 참조를 유지한 채 패배나 모드 전환으로 모든 런 카드 효과를 지운다.
 */
export function resetRunCardState(state: RunCardState): void {
  Object.assign(state, createRunCardState());
}

/**
 * 실패한 다음 스테이지 준비를 복구하도록 저장해 둔 런 상태를 제자리에서 복원한다.
 */
export function restoreRunCardState(
  state: RunCardState,
  snapshot: Readonly<RunCardState>,
): void {
  Object.assign(state, snapshot);
}

/**
 * 스테이지와 누적 선택 수를 32비트 결정적 정수로 섞는다.
 */
function hashCardDraw(stageNumber: number, picksSoFar: number): number {
  let hash =
    Math.imul(stageNumber, 0x9e3779b1) ^
    Math.imul(picksSoFar + 1, 0x85ebca6b);
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  return (hash ^ (hash >>> 16)) >>> 0;
}

/**
 * 이미 고른 일회성 카드를 제외한 현재 추첨 풀을 순서가 안정적인 배열로 반환한다.
 */
export function getRemainingCardPool(
  state: Readonly<RunCardState>,
): UpgradeCard[] {
  const sizeReachedCap =
    1 + CARD_SIZE_STEP * state.sizePicks >=
    PLAYER_MAX_SIZE_SCALE;
  return UPGRADE_CARDS.filter(
    (card) =>
      (card.id !== "size" || !sizeReachedCap) &&
      (card.id !== "giantPawn" || !state.giantPawn) &&
      (card.id !== "proneStart" || !state.proneStart),
  );
}

/**
 * 남은 풀에서 서로 다른 카드를 최대 3장 결정적으로 뽑는다.
 */
export function drawUpgradeCards(
  stageNumber: number,
  state: Readonly<RunCardState>,
): UpgradeCard[] {
  if (!Number.isInteger(stageNumber) || stageNumber < 1) {
    throw new Error(
      `카드를 뽑을 스테이지 ${stageNumber}가 1 이상의 정수가 아닙니다.`,
    );
  }
  const remaining = getRemainingCardPool(state);
  const drawCount = Math.min(3, remaining.length);
  const drawn: UpgradeCard[] = [];
  let hash = hashCardDraw(stageNumber, state.picksSoFar);
  for (let drawIndex = 0; drawIndex < drawCount; drawIndex += 1) {
    hash = hashCardDraw(hash + drawIndex + 1, state.picksSoFar);
    const selectedIndex = hash % remaining.length;
    drawn.push(remaining.splice(selectedIndex, 1)[0]);
  }
  return drawn;
}

/**
 * 선택한 카드 하나를 현재 런에 적용하고 다음 추첨용 선택 횟수를 올린다.
 */
export function applyCardPick(
  state: RunCardState,
  cardId: CardId,
): void {
  if (
    (cardId === "size" &&
      1 + CARD_SIZE_STEP * state.sizePicks >=
        PLAYER_MAX_SIZE_SCALE) ||
    (cardId === "giantPawn" && state.giantPawn) ||
    (cardId === "proneStart" && state.proneStart)
  ) {
    throw new Error(`카드 ${cardId}는 이번 런에서 더 고를 수 없습니다.`);
  }
  if (cardId === "size") {
    state.sizePicks += 1;
  } else if (cardId === "weight") {
    state.weightPicks += 1;
  } else if (cardId === "force") {
    state.forcePicks += 1;
  } else if (cardId === "giantPawn") {
    state.giantPawn = true;
  } else {
    state.proneStart = true;
  }
  state.picksSoFar += 1;
}

/**
 * 핫시트에는 영향을 주지 않고 플레이어 카드 힘을 목표 발사 속도 배율로 바꾼다.
 */
export function computePlayerLaunchSpeedMultiplier(
  gameMode: GameMode,
  state: Readonly<RunCardState>,
  permanentForceBonus = 0,
): number {
  if (
    !Number.isFinite(permanentForceBonus) ||
    permanentForceBonus < 0
  ) {
    throw new Error(
      `영구 힘 보너스 ${permanentForceBonus}가 유한한 음이 아닌 수가 아닙니다.`,
    );
  }
  return gameMode === "stage"
    ? 1 +
        CARD_FORCE_STEP * state.forcePicks +
        permanentForceBonus
    : 1;
}
