// Tier is derived from the server-owned MMR; never persist a second rating.
export const TIER_START_MMR = 1200;
export const DIVISION_MMR = 50;
export const QUEEN_MMR = TIER_START_MMR + 20 * DIVISION_MMR;
export const KING_MMR = QUEEN_MMR + 2 * DIVISION_MMR;

export type TierPiece = "pawn" | "knight" | "bishop" | "rook" | "queen" | "king";
export interface Tier {
  piece: TierPiece;
  division: number | null;
  level: number;
  mmr: number;
  points: number;
  pointsToNext: number | null;
  progress: number;
}

export function getTier(value: number): Tier {
  const mmr = Number.isFinite(value) ? Math.max(100, Math.floor(value)) : TIER_START_MMR;
  if (mmr >= KING_MMR) {
    return { piece: "king", division: null, level: 21, mmr, points: mmr - KING_MMR, pointsToNext: null, progress: 1 };
  }
  const level = Math.max(0, Math.min(20, Math.floor((mmr - TIER_START_MMR) / DIVISION_MMR)));
  const piece: TierPiece = level === 20 ? "queen" : (["pawn", "knight", "bishop", "rook"] as const)[Math.floor(level / 5)]!;
  const floor = TIER_START_MMR + level * DIVISION_MMR;
  const ceiling = level === 20 ? KING_MMR : floor + DIVISION_MMR;
  return {
    piece, division: level === 20 ? null : 5 - level % 5, level, mmr,
    points: Math.max(0, mmr - floor), pointsToNext: ceiling - mmr,
    progress: Math.max(0, (mmr - floor) / (ceiling - floor)),
  };
}
