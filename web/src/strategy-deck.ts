import type { PieceType } from "./config";

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

export const MAX_STRATEGY_DECK_POINTS = 10;
export const MAX_SINGLE_STAT_POINTS = 5;

export interface StrategyDeckValidationResult {
  isValid: boolean;
  reason?: string;
  totalPoints: number;
}

/**
 * 상대방 또는 로컬의 전략 덱 유효성 및 10P 한도 검증
 */
export function validateStrategyDeck(deck: unknown): StrategyDeckValidationResult {
  if (!deck || typeof deck !== "object") {
    return { isValid: false, reason: "덱 데이터 형식이 올바르지 않습니다.", totalPoints: 0 };
  }

  const validPieces: PieceType[] = ["Pawn", "Knight", "Bishop", "Rook", "Queen", "King"];
  let totalPoints = 0;

  for (const piece of validPieces) {
    const stat = (deck as Record<string, unknown>)[piece] as PieceStrategyStat | undefined;
    if (!stat || typeof stat !== "object") {
      return { isValid: false, reason: `${piece} 기물의 스탯 데이터가 누락되었습니다.`, totalPoints };
    }

    const force = Number(stat.force) || 0;
    const weight = Number(stat.weight) || 0;

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

export function getSavedStrategyDeck(): StrategyDeck {
  try {
    const saved = localStorage.getItem("ca_strategy_deck");
    if (saved) {
      const parsed = JSON.parse(saved);
      const deck: StrategyDeck = {
        Pawn: parsed.Pawn ?? { force: 0, weight: 0 },
        Knight: parsed.Knight ?? { force: 0, weight: 0 },
        Bishop: parsed.Bishop ?? { force: 0, weight: 0 },
        Rook: parsed.Rook ?? { force: 0, weight: 0 },
        Queen: parsed.Queen ?? { force: 0, weight: 0 },
        King: parsed.King ?? { force: 0, weight: 0 },
      };
      if (validateStrategyDeck(deck).isValid) {
        return deck;
      }
    }
  } catch {}
  return { ...DEFAULT_STRATEGY_DECK };
}
