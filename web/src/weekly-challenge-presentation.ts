import type { WeeklyChallengeView } from './weekly-challenge-storage';
import type {
  LocalPracticeDefinition, WeeklyChallengeDefinition,
  WeeklyChallengePracticeRun,
} from './weekly-challenge-model';

type Definition = WeeklyChallengeDefinition | LocalPracticeDefinition;
export type WeeklyTab = 'current' | 'previous';
export type AccountAction = 'start' | 'resume' | 'takeover' | 'terminate';
export interface WeeklyPresentation {
  definition: Definition | null;
  practice: 'start' | 'resume';
  practiceStage: number | null;
  accountActions: AccountAction[];
  canRetry: boolean;
  canPractice: boolean;
  recoveryHold: boolean;
  expired: boolean;
}

export function definitionIdentity(value: Definition): string {
  return 'weekId' in value ? value.weekId : value.localPracticeId;
}

export function canResumePractice(
  run: WeeklyChallengePracticeRun | null,
  selected: Definition | null,
): boolean {
  return !!run && !!selected &&
    definitionIdentity(run.definition) === definitionIdentity(selected) &&
    (run.status === 'ready-for-stage' || run.status === 'awaiting-card');
}

export function deriveWeeklyPresentation(
  view: WeeklyChallengeView, tab: WeeklyTab, nowMs: number,
): WeeklyPresentation {
  const definition = tab === 'current'
    ? view.snapshot?.currentWeek ?? view.localDefinitions[0] ?? view.practice?.definition ?? null
    : view.snapshot?.previousWeek ?? view.localDefinitions[1] ?? null;
  const end = definition
    ? ('endsAt' in definition ? definition.endsAt : definition.localEndsAt)
    : null;
  const expired = end !== null && nowMs >= Date.parse(end);
  const resume = canResumePractice(view.practice, definition);
  const result: WeeklyPresentation = {
    definition,
    practice: resume ? 'resume' : 'start',
    practiceStage: resume ? view.practice!.stage : null,
    accountActions: [],
    canRetry: view.ready && !!view.owner && !view.blocked &&
      ['offline', 'missing-server', 'error'].includes(view.syncState),
    canPractice: view.ready && !view.blocked && definition !== null,
    recoveryHold: view.recoveryHold,
    expired,
  };
  if (tab !== 'current' || !view.ready || !view.owner || view.blocked ||
      view.syncState !== 'synced') return result;
  const stored = view.snapshot?.activeAttempt;
  const attempt = stored && !['finished', 'terminated', 'expired'].includes(stored.status)
    ? stored : null;
  if (!attempt) {
    if (!expired && definition && 'weekId' in definition) result.accountActions = ['start'];
    return result;
  }
  const current = view.snapshot?.currentWeek;
  const matches = !!current && attempt.weekId === current.weekId &&
    attempt.definitionHash === current.definitionHash;
  if (expired || !matches || view.recoveryHold) result.accountActions = ['terminate'];
  else if (attempt.ownerSessionId === view.sessionId) result.accountActions = ['resume'];
  else result.accountActions = ['takeover', 'terminate'];
  return result;
}
