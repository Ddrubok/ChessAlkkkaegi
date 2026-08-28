import type { PieceType } from "./config";

export const PIECE_STAT_ORDER = [
  "Pawn", "Knight", "Bishop", "Rook", "Queen", "King",
] as const satisfies readonly PieceType[];

export type PieceStatId = "force" | "weight";
export type ResearchTier = "basic" | "advanced";

export interface PieceStatDisplayValue {
  stat: PieceStatId;
  level: number;
  minimumLevel: number;
  maximumLevel: number;
  currentEffectFraction: number;
  nextEffectFraction: number | null;
  previousEffectFraction: number | null;
  canIncrease: boolean;
  canDecrease: boolean;
  increaseCost: number | null;
  disabledReasonKey: string | null;
  breakdown?: {
    basicLevel: number;
    advancedLevel: number;
    basicEffect: number;
    advancedEffect: number;
  };
}

export interface PieceStatWorkbenchPiece {
  type: PieceType;
  force: PieceStatDisplayValue;
  weight: PieceStatDisplayValue;
  locked: boolean;
  lockReasonKey: string | null;
}

export interface PieceSizeDisplayValue {
  level: number;
  currentEffectFraction: number;
  nextEffectFraction: number | null;
  increaseCost: number;
  canIncrease: boolean;
  disabledReasonKey: string | null;
}

export interface PieceStatWorkbenchSummary {
  mode: "strategy" | "research";
  titleKey: string;
  descriptionKey: string;
  resourceLabelKey: string;
  resourceCurrent: number;
  resourceMaximum: number | null;
  selectedPiece: PieceType;
  pieces: readonly PieceStatWorkbenchPiece[];
  primaryActionKey: string | null;
  primaryActionEnabled: boolean;
  primaryActionDisabledReasonKey: string | null;
  resetActionKey: string;
  resetEnabled: boolean;
  resetRefund: number | null;
  researchTier?: ResearchTier;
  size?: PieceSizeDisplayValue;
}

export interface PieceStatMutationResult {
  changed: boolean;
  piece: PieceType | null;
  stat: PieceStatId | "size" | null;
  direction: "increase" | "decrease" | "reset" | null;
  effectBefore: number | null;
  effectAfter: number | null;
  messageKey: string | null;
}
