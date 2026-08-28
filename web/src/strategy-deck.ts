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

export function getSavedStrategyDeck(): StrategyDeck {
  try {
    const saved = localStorage.getItem("ca_strategy_deck");
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        Pawn: parsed.Pawn ?? { force: 0, weight: 0 },
        Knight: parsed.Knight ?? { force: 0, weight: 0 },
        Bishop: parsed.Bishop ?? { force: 0, weight: 0 },
        Rook: parsed.Rook ?? { force: 0, weight: 0 },
        Queen: parsed.Queen ?? { force: 0, weight: 0 },
        King: parsed.King ?? { force: 0, weight: 0 },
      };
    }
  } catch {}
  return { ...DEFAULT_STRATEGY_DECK };
}
