import type { PieceType } from "./config";
import type { PieceStatId, PieceStatMutationResult, PieceStatWorkbenchSummary, ResearchTier } from "./piece-stat-model";

export interface PieceStatWorkbenchAdapter {
  readonly mode: "strategy" | "research";
  getSummary(selectedPiece: PieceType): PieceStatWorkbenchSummary;
  increase(piece: PieceType, stat: PieceStatId): PieceStatMutationResult;
  decrease(piece: PieceType, stat: PieceStatId): PieceStatMutationResult;
  reset(): PieceStatMutationResult;
  executePrimaryAction?(): Promise<void>;
  setResearchTier?(tier: ResearchTier): void;
  increaseSize?(): PieceStatMutationResult;
  subscribe(listener: () => void): () => void;
}

export function createStatNotifications() {
  const listeners = new Set<() => void>();
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    notify() { listeners.forEach((listener) => listener()); },
  };
}
