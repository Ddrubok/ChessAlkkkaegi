import {
  CARD_EFFECT_SCALE,
  CARD_GRADE_EFFECTS,
  PLAYER_MAX_SIZE_SCALE,
} from "./config";
import type { GameMode } from "./game-mode";

export type GeneralCardId = "size" | "weight" | "force";
export type SpecialCardId = "giantPawn" | "proneStart";
export type CardId = GeneralCardId | SpecialCardId;
export type CardGrade = 0 | 1 | 2 | 3 | 4 | 5;

export interface UpgradeCard {
  // 런 상태에 효과를 적용할 때 사용하는 안정적인 식별자다.
  id: CardId;
  // 카드 버튼의 첫 줄에 표시할 한국어 이름이다.
  name: string;
  // 카드 버튼의 둘째 줄에 표시할 효과 또는 규칙 설명이다.
  description: string;
  // 첫 두 슬롯의 강화 카드와 세 번째 슬롯 후보인 특수 카드를 구분한다.
  category: "general" | "special";
  // 한 번 고르면 남은 런의 추첨 풀에서 빠지는 효과인지 나타낸다.
  oneShot: boolean;
}

export interface RunCardState {
  // 크기 강화의 미획득 0부터 레전드 5까지 현재 등급이다.
  sizeGrade: CardGrade;
  // 중량 강화의 미획득 0부터 레전드 5까지 현재 등급이다.
  weightGrade: CardGrade;
  // 힘 강화의 미획득 0부터 레전드 5까지 현재 등급이다.
  forceGrade: CardGrade;
  // 거대 폰을 이미 골라 이번 런에 적용 중인지 나타낸다.
  giantPawn: boolean;
  // 포복 개시를 이미 골라 이번 런에 적용 중인지 나타낸다.
  proneStart: boolean;
  // 결정적 추첨 해시에 넣을 지금까지의 전체 선택 횟수다.
  picksSoFar: number;
}

export const CARD_GRADE_LABELS = [
  "일반",
  "중급",
  "상급",
  "최상급",
  "레전드",
] as const;

const MAX_CARD_GRADE = CARD_GRADE_EFFECTS.length as CardGrade;
const GENERAL_THIRD_SLOT_PERCENT = 70;

// 세 일반 강화는 개발자 해석에 따라 같은 풀에서 등급 성장하며 수치는 현재 등급 값으로 교체된다.
export const UPGRADE_CARDS: readonly UpgradeCard[] = [
  {
    id: "size",
    name: "크기 강화",
    description:
      "모델과 충돌 범위가 증가해 맞히기 쉬워지지만 상대에게도 잘 맞는다",
    category: "general",
    oneShot: false,
  },
  {
    id: "weight",
    name: "중량 강화",
    description:
      "충돌에 덜 밀리고 장외 저항이 증가하지만 같은 힘에서 이동거리는 감소한다",
    category: "general",
    oneShot: false,
  },
  {
    id: "force",
    name: "힘 강화",
    description:
      "이동거리와 상대를 밀어내는 힘이 증가하고 중량 증가의 이동 감소를 보완한다",
    category: "general",
    oneShot: false,
  },
  {
    id: "giantPawn",
    name: "거대 폰",
    description: "폰 4개를 잃고 남은 폰이 킹 크기가 된다",
    category: "special",
    oneShot: true,
  },
  {
    id: "proneStart",
    name: "포복 개시",
    description: "내 말이 모두 누운 채 시작한다",
    category: "special",
    oneShot: true,
  },
];

/**
 * 강화가 하나도 없는 새 스테이지 런 카드 상태를 만든다.
 */
export function createRunCardState(): RunCardState {
  return {
    sizeGrade: 0,
    weightGrade: 0,
    forceGrade: 0,
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
 * 카드 효과 배율을 공통 계약에 맞춰 검사한다.
 */
function validateCardEffectScale(cardEffectScale: number): void {
  if (!Number.isFinite(cardEffectScale) || cardEffectScale < 0) {
    throw new Error(
      `카드 효과 배율 ${cardEffectScale}가 유한한 음이 아닌 수가 아닙니다.`,
    );
  }
}

/**
 * 0~5 등급을 기획서 최종 수치로 바꾸며 이전 등급 값은 더하지 않는다.
 */
export function computeCardGradeEffect(
  grade: CardGrade,
  cardEffectScale: number = CARD_EFFECT_SCALE,
): number {
  validateCardEffectScale(cardEffectScale);
  if (
    !Number.isInteger(grade) ||
    grade < 0 ||
    grade > MAX_CARD_GRADE
  ) {
    throw new Error(`카드 등급 ${grade}가 0~5 정수가 아닙니다.`);
  }
  return grade === 0
    ? 0
    : CARD_GRADE_EFFECTS[grade - 1] * cardEffectScale;
}

/**
 * 일반 강화 id에 해당하는 현재 0~5 등급을 반환한다.
 */
export function getGeneralCardGrade(
  state: Readonly<RunCardState>,
  cardId: GeneralCardId,
): CardGrade {
  if (cardId === "size") {
    return state.sizeGrade;
  }
  if (cardId === "weight") {
    return state.weightGrade;
  }
  return state.forceGrade;
}

/**
 * 일반 강화의 현재 등급 최종 효과에 조절 배율을 적용한다.
 */
export function computeGeneralCardEffect(
  state: Readonly<RunCardState>,
  cardId: GeneralCardId,
  cardEffectScale: number = CARD_EFFECT_SCALE,
): number {
  return computeCardGradeEffect(
    getGeneralCardGrade(state, cardId),
    cardEffectScale,
  );
}

/**
 * 일반 강화의 현재 등급을 한 단계 올린다.
 */
function promoteGeneralCard(
  state: RunCardState,
  cardId: GeneralCardId,
): void {
  const nextGrade = (getGeneralCardGrade(state, cardId) +
    1) as CardGrade;
  if (cardId === "size") {
    state.sizeGrade = nextGrade;
  } else if (cardId === "weight") {
    state.weightGrade = nextGrade;
  } else {
    state.forceGrade = nextGrade;
  }
}

/**
 * 현재 크기 등급 효과가 백 일반 말의 물리 배치 상한에 닿았는지 확인한다.
 */
function isSizeAtCap(
  state: Readonly<RunCardState>,
  cardEffectScale: number,
): boolean {
  return (
    1 +
      computeGeneralCardEffect(
        state,
        "size",
        cardEffectScale,
      ) >=
    PLAYER_MAX_SIZE_SCALE
  );
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
 * 현재 풀에서 해시가 가리키는 카드 하나를 제거해 중복 없는 슬롯을 만든다.
 */
function takeDeterministicCard(
  pool: UpgradeCard[],
  hash: number,
): UpgradeCard | null {
  if (pool.length === 0) {
    return null;
  }
  const selectedIndex = hash % pool.length;
  return pool.splice(selectedIndex, 1)[0];
}

/**
 * 일반 카드는 이번 선택으로 도달할 등급명과 실제 교체 수치를 함께 표시한다.
 */
function createDisplayedCard(
  card: UpgradeCard,
  state: Readonly<RunCardState>,
  cardEffectScale: number,
): UpgradeCard {
  if (card.category === "special") {
    return card;
  }
  const nextGrade = (getGeneralCardGrade(
    state,
    card.id as GeneralCardId,
  ) + 1) as CardGrade;
  const baseEffect = computeCardGradeEffect(nextGrade);
  const actualEffect = computeCardGradeEffect(
    nextGrade,
    cardEffectScale,
  );
  const effectText =
    Math.abs(actualEffect - baseEffect) < 1e-12
      ? `효과 +${Math.round(actualEffect * 100)}%`
      : `효과 +${Math.round(actualEffect * 100)}% (등급 기준 +${Math.round(baseEffect * 100)}%)`;
  return {
    ...card,
    name: `${card.name} · ${CARD_GRADE_LABELS[nextGrade - 1]}`,
    description: `${card.description} · ${effectText}`,
  };
}

/**
 * 레전드 일반 카드와 이미 고른 특수 카드, 크기 상한 도달 카드를 제외한다.
 */
export function getRemainingCardPool(
  state: Readonly<RunCardState>,
  cardEffectScale: number = CARD_EFFECT_SCALE,
): UpgradeCard[] {
  validateCardEffectScale(cardEffectScale);
  return UPGRADE_CARDS.filter((card) => {
    if (card.category === "general") {
      const cardId = card.id as GeneralCardId;
      return (
        getGeneralCardGrade(state, cardId) < MAX_CARD_GRADE &&
        (cardId !== "size" ||
          !isSizeAtCap(state, cardEffectScale))
      );
    }
    return card.id === "giantPawn"
      ? !state.giantPawn
      : !state.proneStart;
  });
}

/**
 * 일반 두 장을 먼저 보장하고 세 번째를 결정적 일반 70%·특수 30%로 뽑는다.
 */
export function drawUpgradeCards(
  stageNumber: number,
  state: Readonly<RunCardState>,
  cardEffectScale: number = CARD_EFFECT_SCALE,
): UpgradeCard[] {
  if (!Number.isInteger(stageNumber) || stageNumber < 1) {
    throw new Error(
      `카드를 뽑을 스테이지 ${stageNumber}가 1 이상의 정수가 아닙니다.`,
    );
  }
  const remaining = getRemainingCardPool(
    state,
    cardEffectScale,
  );
  const generalPool = remaining.filter(
    (card) => card.category === "general",
  );
  const specialPool = remaining.filter(
    (card) => card.category === "special",
  );
  const drawn: UpgradeCard[] = [];
  let hash = hashCardDraw(stageNumber, state.picksSoFar);
  for (
    let slot = 0;
    slot < 2 && generalPool.length > 0;
    slot += 1
  ) {
    hash = hashCardDraw(hash + slot + 1, state.picksSoFar);
    const card = takeDeterministicCard(generalPool, hash);
    if (card !== null) {
      drawn.push(card);
    }
  }

  const categoryHash = hashCardDraw(
    stageNumber ^ 0x6d2b79f5,
    state.picksSoFar + 17,
  );
  const prefersGeneral =
    categoryHash % 100 < GENERAL_THIRD_SLOT_PERCENT;
  const preferredPool = prefersGeneral
    ? generalPool
    : specialPool;
  const fallbackPool = prefersGeneral
    ? specialPool
    : generalPool;
  const thirdCard =
    takeDeterministicCard(preferredPool, categoryHash) ??
    takeDeterministicCard(fallbackPool, categoryHash);
  if (thirdCard !== null) {
    drawn.push(thirdCard);
  }

  return drawn.map((card) =>
    createDisplayedCard(card, state, cardEffectScale),
  );
}

/**
 * 일반 카드는 한 등급 승급하고 특수 카드는 기존 일회성 규칙을 적용한다.
 */
export function applyCardPick(
  state: RunCardState,
  cardId: CardId,
  cardEffectScale: number = CARD_EFFECT_SCALE,
): void {
  validateCardEffectScale(cardEffectScale);
  if (cardId === "size" || cardId === "weight" || cardId === "force") {
    if (
      getGeneralCardGrade(state, cardId) >= MAX_CARD_GRADE ||
      (cardId === "size" &&
        isSizeAtCap(state, cardEffectScale))
    ) {
      throw new Error(`카드 ${cardId}는 이번 런에서 더 고를 수 없습니다.`);
    }
    promoteGeneralCard(state, cardId);
  } else if (cardId === "giantPawn") {
    if (state.giantPawn) {
      throw new Error(`카드 ${cardId}는 이번 런에서 더 고를 수 없습니다.`);
    }
    state.giantPawn = true;
  } else {
    if (state.proneStart) {
      throw new Error(`카드 ${cardId}는 이번 런에서 더 고를 수 없습니다.`);
    }
    state.proneStart = true;
  }
  state.picksSoFar += 1;
}

/**
 * 핫시트에는 영향을 주지 않고 현재 힘 등급을 플레이어 목표 발사 속도 배율로 바꾼다.
 */
export function computePlayerLaunchSpeedMultiplier(
  gameMode: GameMode,
  state: Readonly<RunCardState>,
  permanentForceBonus = 0,
  cardEffectScale: number = CARD_EFFECT_SCALE,
): number {
  validateCardEffectScale(cardEffectScale);
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
        computeGeneralCardEffect(
          state,
          "force",
          cardEffectScale,
        ) +
        permanentForceBonus
    : 1;
}
