import type { CardId, RunCardState } from "./cards";
import { computePlayerLaunchSpeedMultiplier } from "./cards";
import type { CardPreview } from "./crazygames-progression";
import type { ChessSetMeta } from "./assets";
import type { PieceBodyBinding } from "./physics";
import { computePermanentForceBonus } from "./meta";
import { computeStagePieceScale, computeUpgradeWeightFraction, selectStageSpawnInstances, type StageSpawnOptions } from "./stage";
import { PIECE_INSTANCES } from "./layout";
import { getMaxLaunchSpeed } from "./config";

/** Actual next-board values; card grade fractions must not be presented as travel distance. */
export function finalCardValues(
  id: CardId, before: RunCardState, after: RunCardState,
  options: StageSpawnOptions, meta: ChessSetMeta,
  pieces: Iterable<PieceBodyBinding>, maxLaunchSpeed: number, ko: boolean,
): NonNullable<CardPreview["appliedValues"]> {
  if (id !== "size" && id !== "weight" && id !== "force") return [];
  const referencePieces = [...pieces].filter(piece => piece.instance.side === "white");
  const unique = new Map(selectStageSpawnInstances(PIECE_INSTANCES, { ...options, runCards: before })
    .filter(piece => piece.side === "white").map(piece => [piece.type, piece]));
  const names = { Pawn: "폰", Knight: "나이트", Bishop: "비숍", Rook: "룩", Queen: "퀸", King: "킹" };
  const values: NonNullable<CardPreview["appliedValues"]>[number][] = [];
  for (const [type, instance] of unique) {
    const opts = (cards: RunCardState): StageSpawnOptions => ({ ...options, runCards: cards });
    const value = (cards: RunCardState): number | null => {
      if (id === "size") return computeStagePieceScale(instance, meta, opts(cards));
      if (id === "force") return getMaxLaunchSpeed("stage", type, maxLaunchSpeed) * computePlayerLaunchSpeedMultiplier(
        "stage", cards, options.permanentUpgrades ? computePermanentForceBonus(options.permanentUpgrades, type) : 0,
        options.cardEffectScale, options.cardTuning,
      );
      const binding = referencePieces.find(piece => piece.instance.type === type);
      if (!binding) return null;
      // Uniform hull scaling changes volume by scale cubed. The binding retains
      // its hull mass before added weight, so no collision simulation is needed.
      const scale = computeStagePieceScale(instance, meta, opts(cards));
      const hullMass = binding.originalHullMass * (scale / binding.uniformScale) ** 3;
      return hullMass * (1 + computeUpgradeWeightFraction(instance, opts(cards)));
    };
    const previous = value(before), next = value(after);
    if (previous === null || next === null) continue;
    values.push({ piece: ko ? names[type] : type,
      stat: id === "size" ? ko ? "크기" : "size" : id === "force" ? ko ? "초기 속도" : "launch speed" : ko ? "질량" : "mass",
      before: previous, after: next, unit: id === "size" ? "×" : undefined });
  }
  return values;
}
