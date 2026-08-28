import type { PieceType } from "./config";
import { createStatNotifications, type PieceStatWorkbenchAdapter } from "./piece-stat-adapter";
import { PIECE_STAT_ORDER, type PieceStatDisplayValue, type PieceStatId, type PieceStatMutationResult } from "./piece-stat-model";
import {
  canIncreaseStrategyStat, changeStrategyStat, cloneStrategyDeck, countStrategyPoints,
  createDefaultStrategyDeck, loadStrategyDeck, saveStrategyDeck,
  STRATEGY_MAX_POINTS_PER_TRACK, STRATEGY_STAT_STEP, STRATEGY_TOTAL_POINTS, type StrategyDeck,
} from "./strategy-deck";

export function createStrategyStatAdapter(options: {
  storage?: Pick<Storage, "getItem" | "setItem">;
  onMatch: (deck: StrategyDeck) => Promise<void>;
}): PieceStatWorkbenchAdapter {
  let deck = loadStrategyDeck(options.storage);
  const events = createStatNotifications();
  function display(piece: PieceType, stat: PieceStatId): PieceStatDisplayValue {
    const level = deck[piece][stat];
    const canIncrease = canIncreaseStrategyStat(deck, piece, stat);
    return {
      stat, level, minimumLevel: 0, maximumLevel: STRATEGY_MAX_POINTS_PER_TRACK,
      currentEffectFraction: level * STRATEGY_STAT_STEP,
      nextEffectFraction: level < STRATEGY_MAX_POINTS_PER_TRACK ? (level + 1) * STRATEGY_STAT_STEP : null,
      previousEffectFraction: level > 0 ? (level - 1) * STRATEGY_STAT_STEP : null,
      canIncrease, canDecrease: level > 0, increaseCost: null,
      disabledReasonKey: canIncrease ? null : level === STRATEGY_MAX_POINTS_PER_TRACK ? "maximum" : "budgetSpent",
    };
  }
  function mutate(piece: PieceType, stat: PieceStatId, delta: -1 | 1): PieceStatMutationResult {
    const before = deck[piece][stat] * STRATEGY_STAT_STEP;
    const changed = changeStrategyStat(deck, piece, stat, delta);
    const saved = changed && saveStrategyDeck(deck, options.storage);
    if (changed) events.notify();
    return {
      changed, piece, stat, direction: delta === 1 ? "increase" : "decrease",
      effectBefore: before, effectAfter: deck[piece][stat] * STRATEGY_STAT_STEP,
      messageKey: changed ? (saved ? "allocationSaved" : "storageUnavailable") : (delta === 1 ? display(piece, stat).disabledReasonKey : "minimum"),
    };
  }
  return {
    mode: "strategy", subscribe: events.subscribe,
    getSummary(selectedPiece) {
      const spent = countStrategyPoints(deck);
      return {
        mode: "strategy", titleKey: "strategyTitle", descriptionKey: "strategyDescription",
        resourceLabelKey: "allocated", resourceCurrent: spent, resourceMaximum: STRATEGY_TOTAL_POINTS,
        selectedPiece, pieces: PIECE_STAT_ORDER.map((type) => ({ type, force: display(type, "force"), weight: display(type, "weight"), locked: false, lockReasonKey: null })),
        primaryActionKey: "findMatch", primaryActionEnabled: true, primaryActionDisabledReasonKey: null,
        resetActionKey: "resetAllocation", resetEnabled: spent > 0, resetRefund: null,
      };
    },
    increase: (piece, stat) => mutate(piece, stat, 1),
    decrease: (piece, stat) => mutate(piece, stat, -1),
    reset() {
      const changed = countStrategyPoints(deck) > 0;
      deck = createDefaultStrategyDeck();
      const saved = saveStrategyDeck(deck, options.storage);
      events.notify();
      return { changed, piece: null, stat: null, direction: "reset", effectBefore: null, effectAfter: null, messageKey: saved ? "allocationReset" : "storageUnavailable" };
    },
    executePrimaryAction: () => options.onMatch(cloneStrategyDeck(deck)),
  };
}
