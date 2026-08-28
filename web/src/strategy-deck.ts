import type { PieceType } from "./config";
import { PIECE_STAT_ORDER } from "./piece-stat-model";

export interface PieceStrategyStat {
  force: number;
  weight: number;
}

export type StrategyDeck = Record<PieceType, PieceStrategyStat>;

export const DEFAULT_STRATEGY_DECK: StrategyDeck = {
  Pawn: { force: 0, weight: 0 },
  Knight: { force: 0, weight: 0 },
  Bishop: { force: 0, weight: 0 },
  Rook: { force: 0, weight: 0 },
  Queen: { force: 0, weight: 0 },
  King: { force: 0, weight: 0 },
};

/**
 * 1포인트당 스탯 가중치 (힘: +2%, 중량: +2%)
 */
export const STRATEGY_STAT_STEP = 0.02;

export const STRATEGY_TOTAL_POINTS = 10;
export const STRATEGY_MAX_POINTS_PER_TRACK = 4;
// Keep the existing online validation exports on the same UI contract.
export const MAX_STRATEGY_DECK_POINTS = STRATEGY_TOTAL_POINTS;
export const MAX_SINGLE_STAT_POINTS = STRATEGY_MAX_POINTS_PER_TRACK;
export const STRATEGY_STORAGE_KEY = "ca_strategy_deck";
type StrategyStorage = Pick<Storage, "getItem" | "setItem">;

export interface StrategyDeckValidationResult {
  isValid: boolean;
  reason?: string;
  totalPoints: number;
}

/**
 * 상대방 또는 로컬의 전략 덱 유효성 및 10P 한도 검증
 */
export function validateStrategyDeck(deck: unknown): StrategyDeckValidationResult {
  if (!deck || typeof deck !== "object" || Array.isArray(deck)) {
    return { isValid: false, reason: "덱 데이터 형식이 올바르지 않습니다.", totalPoints: 0 };
  }

  let totalPoints = 0;

  for (const piece of PIECE_STAT_ORDER) {
    const stat = (deck as Record<string, unknown>)[piece] as PieceStrategyStat | undefined;
    if (!stat || typeof stat !== "object" || Array.isArray(stat)) {
      return { isValid: false, reason: `${piece} 기물의 스탯 데이터가 누락되었습니다.`, totalPoints };
    }

    const { force, weight } = stat;
    if (!Number.isInteger(force) || !Number.isInteger(weight)) {
      return { isValid: false, reason: "스탯은 0 이상의 정수여야 합니다.", totalPoints };
    }

    if (force < 0 || weight < 0) {
      return { isValid: false, reason: "스탯 수치에는 음수가 허용되지 않습니다.", totalPoints };
    }

    if (force > MAX_SINGLE_STAT_POINTS || weight > MAX_SINGLE_STAT_POINTS) {
      return { isValid: false, reason: `단일 스탯은 최대 ${MAX_SINGLE_STAT_POINTS}P를 초과할 수 없습니다.`, totalPoints };
    }

    totalPoints += force + weight;
  }

  if (totalPoints > MAX_STRATEGY_DECK_POINTS) {
    return { isValid: false, reason: `전략 포인트 한도를 초과했습니다 (배분 포인트: ${totalPoints}P / 최대 ${MAX_STRATEGY_DECK_POINTS}P)`, totalPoints };
  }

  return { isValid: true, totalPoints };
}

export function createDefaultStrategyDeck(): StrategyDeck {
  return Object.fromEntries(
    PIECE_STAT_ORDER.map((piece) => [piece, { force: 0, weight: 0 }]),
  ) as StrategyDeck;
}

export function cloneStrategyDeck(deck: Readonly<StrategyDeck>): StrategyDeck {
  return Object.fromEntries(
    PIECE_STAT_ORDER.map((piece) => [piece, { force: deck[piece].force, weight: deck[piece].weight }]),
  ) as StrategyDeck;
}

export function parseStrategyDeck(value: unknown): StrategyDeck {
  return validateStrategyDeck(value).isValid
    ? cloneStrategyDeck(value as StrategyDeck)
    : createDefaultStrategyDeck();
}

function browserStorage(): StrategyStorage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function loadStrategyDeck(storage: StrategyStorage | undefined = browserStorage()): StrategyDeck {
  try {
    const saved = storage?.getItem(STRATEGY_STORAGE_KEY);
    if (saved) return parseStrategyDeck(JSON.parse(saved));
  } catch {}
  return createDefaultStrategyDeck();
}

export const getSavedStrategyDeck = loadStrategyDeck;

export function saveStrategyDeck(deck: Readonly<StrategyDeck>, storage: StrategyStorage | undefined = browserStorage()): boolean {
  if (!validateStrategyDeck(deck).isValid || !storage) return false;
  try {
    storage.setItem(STRATEGY_STORAGE_KEY, JSON.stringify(deck));
    return true;
  } catch {
    return false;
  }
}

export function countStrategyPoints(deck: Readonly<StrategyDeck>): number {
  return PIECE_STAT_ORDER.reduce((sum, piece) => sum + deck[piece].force + deck[piece].weight, 0);
}

export function canIncreaseStrategyStat(deck: Readonly<StrategyDeck>, piece: PieceType, stat: keyof PieceStrategyStat): boolean {
  return deck[piece][stat] < STRATEGY_MAX_POINTS_PER_TRACK && countStrategyPoints(deck) < STRATEGY_TOTAL_POINTS;
}

export function changeStrategyStat(deck: StrategyDeck, piece: PieceType, stat: keyof PieceStrategyStat, delta: -1 | 1): boolean {
  if (delta === 1 ? !canIncreaseStrategyStat(deck, piece, stat) : deck[piece][stat] <= 0) return false;
  deck[piece][stat] += delta;
  return true;
}
