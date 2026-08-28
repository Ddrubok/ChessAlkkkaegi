import { PERMANENT_PLAYER_SIZE_COST, PERMANENT_PLAYER_SIZE_STEP, PERMANENT_UPGRADE_TIER_MAX_LEVEL, type PieceType } from "./config";
import {
  computePermanentForceBonus, computePermanentWeightFraction, computePermanentSizeFraction,
  computePermanentTierEffect, computePermanentUpgradeCost, computePermanentUpgradeSpentPoints,
  isPermanentUpgradeUnlocked, isPermanentSizeUpgradeUnlocked, purchasePermanentUpgrade,
  purchasePermanentSizeUpgrade, resetPermanentUpgrades, type MetaRuntime,
} from "./meta";
import { createStatNotifications, type PieceStatWorkbenchAdapter } from "./piece-stat-adapter";
import { PIECE_STAT_ORDER, type PieceStatDisplayValue, type PieceStatId, type PieceStatMutationResult, type ResearchTier } from "./piece-stat-model";

export function createPermanentResearchAdapter(runtime: MetaRuntime): PieceStatWorkbenchAdapter {
  let tier: ResearchTier = "basic";
  const events = createStatNotifications();
  const effect = (piece: PieceType, stat: PieceStatId) => stat === "force"
    ? computePermanentForceBonus(runtime.state.upgrades, piece)
    : computePermanentWeightFraction(runtime.state.upgrades, piece);
  function lockReason(piece: PieceType): string | null {
    if (isPermanentUpgradeUnlocked(runtime.state.upgrades, tier, piece)) return null;
    if (tier === "advanced" && runtime.state.upgrades.playerSizeLevel === 0) return "advancedLocked";
    return `${piece === "King" ? "king" : "queen"}${tier === "basic" ? "Basic" : "Advanced"}Locked`;
  }
  function display(piece: PieceType, stat: PieceStatId): PieceStatDisplayValue {
    const upgrades = runtime.state.upgrades.pieces[piece];
    const level = upgrades[tier][stat];
    const atMaximum = level === PERMANENT_UPGRADE_TIER_MAX_LEVEL;
    const cost = atMaximum ? null : computePermanentUpgradeCost(tier, piece, level);
    const reason = lockReason(piece) ?? (atMaximum ? "maximum" : runtime.state.points < cost! ? "insufficientPoints" : null);
    const currentEffectFraction = effect(piece, stat);
    return {
      stat, level, minimumLevel: 0, maximumLevel: PERMANENT_UPGRADE_TIER_MAX_LEVEL,
      currentEffectFraction,
      nextEffectFraction: atMaximum ? null : currentEffectFraction - computePermanentTierEffect(tier, level) + computePermanentTierEffect(tier, level + 1),
      previousEffectFraction: null, canIncrease: reason === null, canDecrease: false, increaseCost: cost,
      disabledReasonKey: reason,
      breakdown: { basicLevel: upgrades.basic[stat], advancedLevel: upgrades.advanced[stat], basicEffect: computePermanentTierEffect("basic", upgrades.basic[stat]), advancedEffect: computePermanentTierEffect("advanced", upgrades.advanced[stat]) },
    };
  }
  return {
    mode: "research", subscribe: events.subscribe,
    setResearchTier(next) { tier = next; events.notify(); },
    getSummary(selectedPiece) {
      const sizeLevel = runtime.state.upgrades.playerSizeLevel;
      const sizeReason = sizeLevel === 1 ? "maximum" : !isPermanentSizeUpgradeUnlocked(runtime.state.upgrades) ? "sizeLocked" : runtime.state.points < PERMANENT_PLAYER_SIZE_COST ? "insufficientPoints" : null;
      const refund = computePermanentUpgradeSpentPoints(runtime.state.upgrades);
      return {
        mode: "research", titleKey: "researchTitle", descriptionKey: "researchDescription",
        resourceLabelKey: "pointsHeld", resourceCurrent: runtime.state.points, resourceMaximum: null,
        selectedPiece, researchTier: tier,
        pieces: PIECE_STAT_ORDER.map((type) => ({ type, force: display(type, "force"), weight: display(type, "weight"), locked: lockReason(type) !== null, lockReasonKey: lockReason(type) })),
        primaryActionKey: null, primaryActionEnabled: false, primaryActionDisabledReasonKey: null,
        resetActionKey: "resetResearch", resetEnabled: refund > 0, resetRefund: refund,
        size: { level: sizeLevel, currentEffectFraction: computePermanentSizeFraction(runtime.state.upgrades), nextEffectFraction: sizeLevel ? null : PERMANENT_PLAYER_SIZE_STEP, increaseCost: PERMANENT_PLAYER_SIZE_COST, canIncrease: sizeReason === null, disabledReasonKey: sizeReason },
      };
    },
    increase(piece, stat) {
      const before = effect(piece, stat);
      const reason = display(piece, stat).disabledReasonKey;
      const result = purchasePermanentUpgrade(runtime, tier, piece, stat);
      if (result.purchased) events.notify();
      return { changed: result.purchased, piece, stat, direction: "increase", effectBefore: before, effectAfter: effect(piece, stat), messageKey: result.purchased ? "purchaseSuccess" : reason ?? "purchaseFailed" };
    },
    decrease(piece, stat): PieceStatMutationResult {
      return { changed: false, piece, stat, direction: "decrease", effectBefore: effect(piece, stat), effectAfter: effect(piece, stat), messageKey: "researchNoDecrease" };
    },
    increaseSize() {
      const before = computePermanentSizeFraction(runtime.state.upgrades);
      const reason = this.getSummary("Pawn").size!.disabledReasonKey;
      const result = purchasePermanentSizeUpgrade(runtime);
      if (result.purchased) events.notify();
      return { changed: result.purchased, piece: null, stat: "size", direction: "increase", effectBefore: before, effectAfter: computePermanentSizeFraction(runtime.state.upgrades), messageKey: result.purchased ? "purchaseSuccess" : reason ?? "purchaseFailed" };
    },
    reset() {
      const refund = resetPermanentUpgrades(runtime);
      events.notify();
      return { changed: refund > 0, piece: null, stat: null, direction: "reset", effectBefore: null, effectAfter: null, messageKey: "researchReset" };
    },
  };
}
