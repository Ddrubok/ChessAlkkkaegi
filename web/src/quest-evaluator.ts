import { eventSupportsMetric, questDefinitionById, questDefinitionsFor } from "./quest-definitions";
import type { QuestDefinition, QuestEvent, QuestPeriod, QuestProgress } from "./quest-model";

function emptyProgress(period: QuestPeriod, definition: QuestDefinition, at: string): QuestProgress {
  const distinct = ["piece-types", "distinct-puzzles", "distinct-gold-puzzles"].includes(definition.metric);
  return {
    periodId: period.periodId,
    questId: definition.id,
    conditionVersion: 1,
    status: "in-progress",
    progress: distinct ? { kind: "distinct", targetIds: {} } : { kind: "count", count: 0, eventIds: {} },
    completedAt: null,
    updatedAt: at,
  };
}

function eventTarget(event: QuestEvent, definition: QuestDefinition): { id: string; puzzleRevision?: number } | null {
  if (definition.metric === "piece-types" && event.kind === "piece-launch") return { id: event.payload.pieceType };
  if ((definition.metric === "distinct-puzzles" || definition.metric === "distinct-gold-puzzles") && event.kind === "puzzle-clear") return { id: event.payload.puzzleId, puzzleRevision: event.payload.puzzleRevision };
  return null;
}

export function applyQuestEvent(progress: readonly QuestProgress[], periods: readonly QuestPeriod[], event: QuestEvent, now = new Date()): QuestProgress[] {
  const next = progress.map((item) => structuredClone(item));
  for (const request of event.requestedPeriods) {
    const period = periods.find((item) => item.periodId === request.periodId && item.cadence === request.cadence);
    if (!period || now.getTime() >= Date.parse(period.endsAt)) continue;
    for (const definition of questDefinitionsFor(request.cadence)) {
      const medal = event.kind === "puzzle-clear" ? event.payload.medal : undefined;
      if (!eventSupportsMetric(event.kind, definition.metric, medal)) continue;
      let item = next.find((candidate) => candidate.periodId === period.periodId && candidate.questId === definition.id && candidate.conditionVersion === 1);
      if (!item) { item = emptyProgress(period, definition, event.occurredAtClient); next.push(item); }
      if (item.status === "completed") continue;
      if (item.progress.kind === "count") {
        const events = item.progress.eventIds ?? {};
        if (!(event.eventId in events) && Object.keys(events).length < definition.target) events[event.eventId] = { at: event.occurredAtClient };
        item.progress.eventIds = events;
        item.progress.count = Object.keys(events).length;
      } else {
        const target = eventTarget(event, definition);
        const targets = item.progress.targetIds ?? {};
        if (target && !(target.id in targets) && Object.keys(targets).length < definition.target) targets[target.id] = { eventId: event.eventId, at: event.occurredAtClient, ...(target.puzzleRevision === undefined ? {} : { puzzleRevision: target.puzzleRevision }) };
        item.progress.targetIds = targets;
      }
      const count = questProgressCount(item);
      if (count >= definition.target) { item.status = "completed"; item.completedAt ??= event.occurredAtClient; }
      item.updatedAt = event.occurredAtClient;
    }
  }
  return next;
}

export function materializeQuestProgress(periods: readonly QuestPeriod[], progress: readonly QuestProgress[], now = new Date()): QuestProgress[] {
  const result = progress.map((item) => structuredClone(item));
  for (const period of periods) for (const definition of questDefinitionsFor(period.cadence)) {
    if (!result.some((item) => item.periodId === period.periodId && item.questId === definition.id)) result.push(emptyProgress(period, definition, now.toISOString()));
  }
  for (const item of result) if (item.status !== "completed") {
    const period = periods.find((candidate) => candidate.periodId === item.periodId);
    if (period && now.getTime() >= Date.parse(period.endsAt)) item.status = "expired";
  }
  return result;
}

export function questProgressCount(progress: QuestProgress): number {
  return progress.progress.kind === "count" ? Object.keys(progress.progress.eventIds ?? {}).length : Object.keys(progress.progress.targetIds ?? {}).length;
}
export function questProgressTarget(progress: QuestProgress): number { return questDefinitionById(progress.questId)?.target ?? 0; }
