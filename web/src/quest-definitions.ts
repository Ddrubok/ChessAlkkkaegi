import type { QuestCadence, QuestDefinition, QuestMetric } from "./quest-model";

export const QUEST_DEFINITIONS: readonly QuestDefinition[] = Object.freeze([
  { id: "daily-wins", conditionVersion: 1, cadence: "daily", metric: "wins", target: 2 },
  { id: "daily-puzzle-clears", conditionVersion: 1, cadence: "daily", metric: "puzzle-clears", target: 1 },
  { id: "daily-piece-types", conditionVersion: 1, cadence: "daily", metric: "piece-types", target: 2 },
  { id: "weekly-wins", conditionVersion: 1, cadence: "weekly", metric: "wins", target: 10 },
  { id: "weekly-puzzle-clears", conditionVersion: 1, cadence: "weekly", metric: "puzzle-clears", target: 5 },
  { id: "weekly-distinct-puzzles", conditionVersion: 1, cadence: "weekly", metric: "distinct-puzzles", target: 3 },
  { id: "weekly-piece-types", conditionVersion: 1, cadence: "weekly", metric: "piece-types", target: 6 },
  { id: "weekly-distinct-gold-puzzles", conditionVersion: 1, cadence: "weekly", metric: "distinct-gold-puzzles", target: 3 },
]);

export const questDefinitionsFor = (cadence: QuestCadence): QuestDefinition[] => QUEST_DEFINITIONS.filter((item) => item.cadence === cadence).map((item) => ({ ...item }));
export const questDefinitionById = (id: string): QuestDefinition | undefined => QUEST_DEFINITIONS.find((item) => item.id === id);

export function eventSupportsMetric(kind: string, metric: QuestMetric, medal?: number): boolean {
  if (metric === "wins") return kind === "pve-win" || kind === "pvp-win";
  if (metric === "puzzle-clears" || metric === "distinct-puzzles") return kind === "puzzle-clear";
  if (metric === "distinct-gold-puzzles") return kind === "puzzle-clear" && medal === 3;
  return metric === "piece-types" && kind === "piece-launch";
}
