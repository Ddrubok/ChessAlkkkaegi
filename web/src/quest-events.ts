import { makeLocalPeriods, validateQuestEvent, type QuestEvent, type QuestPeriod, type QuestPieceType, type QuestPuzzleId } from "./quest-model";

export function createQuestId(): string { return crypto.randomUUID(); }
function requested(periods: QuestPeriod[]): QuestEvent["requestedPeriods"] {
  return periods.map(({ periodId, cadence }) => ({ periodId, cadence })).sort((a, b) => a.cadence.localeCompare(b.cadence));
}
function checked<T extends QuestEvent>(event: T): T {
  if (!validateQuestEvent(event)) throw new Error("Invalid quest event envelope.");
  return event;
}
function context(periods?: QuestPeriod[], occurredAt?: string) {
  const at = occurredAt ?? new Date().toISOString();
  return { schemaVersion: 1 as const, requestedPeriods: requested(periods ?? makeLocalPeriods(new Date(at))), occurredAtClient: at };
}

export function makePveWinEvent(runId: string, stageNumber: number, periods?: QuestPeriod[], occurredAt?: string): QuestEvent {
  return checked({ ...context(periods, occurredAt), eventId: `quest:pve-win:${runId}:stage:${stageNumber}:1`, kind: "pve-win", source: "stage", identity: { runId, stageNumber, resultIndex: 1 }, payload: {} });
}
export function makePvpWinEvent(matchId: string, periods?: QuestPeriod[], occurredAt?: string): QuestEvent {
  return checked({ ...context(periods, occurredAt), eventId: `quest:pvp-win:${matchId}`, kind: "pvp-win", source: "online", identity: { matchId }, payload: {} });
}
export function makePuzzleClearEvent(attemptId: string, puzzleId: QuestPuzzleId, puzzleRevision: number, medal: 1 | 2 | 3, periods?: QuestPeriod[], occurredAt?: string): QuestEvent {
  return checked({ ...context(periods, occurredAt), eventId: `quest:puzzle:${attemptId}:terminal`, kind: "puzzle-clear", source: "puzzle", identity: { attemptId }, payload: { puzzleId, puzzleRevision, medal } });
}
export function makePieceLaunchEvent(input: { source: "stage" | "tutorial" | "puzzle"; runId: string; launchOrdinal: number; pieceType: QuestPieceType } | { source: "online"; matchId: string; turnIndex: number; pieceType: QuestPieceType }, periods?: QuestPeriod[], occurredAt?: string): QuestEvent {
  if (input.source === "online") return checked({ ...context(periods, occurredAt), eventId: `quest:online-launch:${input.matchId}:${input.turnIndex}`, kind: "piece-launch", source: "online", identity: { matchId: input.matchId, turnIndex: input.turnIndex }, payload: { pieceType: input.pieceType } });
  return checked({ ...context(periods, occurredAt), eventId: `quest:launch:${input.runId}:${input.launchOrdinal}`, kind: "piece-launch", source: input.source, identity: { runId: input.runId, launchOrdinal: input.launchOrdinal }, payload: { pieceType: input.pieceType } });
}
