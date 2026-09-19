import { QUEST_PIECE_TYPES, type QuestDefinition, type QuestProgress } from './quest-model';

export interface QuestTargetSummary {
  kind: 'pieces' | 'puzzles';
  achievedIds: string[];
  unrecordedIds: string[];
  remaining: number;
  complete: boolean;
}

export function summarizeQuestTargets(
  definition: QuestDefinition,
  progress: QuestProgress | undefined,
  periodId: string,
): QuestTargetSummary | null {
  const kind = definition.metric === 'piece-types' ? 'pieces'
    : ['distinct-puzzles', 'distinct-gold-puzzles'].includes(definition.metric) ? 'puzzles' : null;
  if (!kind) return null;
  const current = progress?.periodId === periodId && progress.questId === definition.id &&
    progress.conditionVersion === definition.conditionVersion ? progress : undefined;
  const ids = current?.progress.kind === 'distinct'
    ? Object.keys(current.progress.targetIds ?? {}) : [];
  const achievedIds = kind === 'pieces'
    ? QUEST_PIECE_TYPES.filter(id => ids.includes(id))
    : [...ids].sort();
  const remaining = Math.max(0, definition.target - achievedIds.length);
  const complete = current?.status === 'completed' || remaining === 0;
  return {
    kind, achievedIds,
    unrecordedIds: kind === 'pieces' && !complete
      ? QUEST_PIECE_TYPES.filter(id => !achievedIds.includes(id)) : [],
    remaining, complete,
  };
}
