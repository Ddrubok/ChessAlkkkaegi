import type { CardId, RunCardState } from "./cards";

export type WeeklyChallengeStatus =
  | "ready-for-stage" | "awaiting-card" | "playing" | "pending-action"
  | "finished" | "terminated" | "expired";
export type WeeklyChallengeActionKind = "launch" | "king-swap" | "king-defense";
export type WeeklyChallengeOutcome = "white-win" | "black-win" | "draw";
export type WeeklyChallengeErrorCode =
  | "WEEK_NOT_CURRENT" | "DEFINITION_MISMATCH" | "ACTIVE_ATTEMPT_EXISTS"
  | "ATTEMPT_NOT_FOUND" | "STALE_REVISION" | "NOT_ATTEMPT_OWNER"
  | "PENDING_ACTION" | "ACTIVE_STAGE_NOT_RESTORABLE" | "RECOVERY_HOLD"
  | "WEEK_EXPIRED" | "ATTEMPT_FINISHED" | "INVALID_TRANSITION"
  | "INVALID_CARD_PICK" | "INVALID_STAGE_RESULT" | "EVENT_ID_PAYLOAD_MISMATCH"
  | "RPC_UNAVAILABLE";

export interface WeeklyChallengeScore {
  completedStages: number;
  completedStageOwnTurns: number;
}
export interface SerializedRunCards extends RunCardState {}
export interface WeeklyChallengeDefinition {
  schemaVersion: 1;
  weekId: string;
  startsAt: string;
  endsAt: string;
  definitionId: "W01";
  definitionRevision: 1;
  rulesetVersion: "weekly-w01-r1";
  stageLayoutVersion: "source:688bee1a5e931fba9bfbfd930995e73ab12ec206";
  physicsVersion: "@dimforge/rapier3d-compat:0.19.3";
  aiVersion: "source:688bee1a5e931fba9bfbfd930995e73ab12ec206";
  definitionHash: string;
  stageCount: 10;
  playerSide: "white";
  researchEnabled: false;
  cardEffectScale: 1;
  enemyStageBuffScale: 1;
  prioritySlots: readonly (readonly CardId[])[];
  fallbackOrder: readonly CardId[];
}
export interface LocalPracticeDefinition extends Omit<WeeklyChallengeDefinition, "weekId" | "startsAt" | "endsAt" | "definitionHash"> {
  localPracticeId: string;
  localStartsAt: string;
  localEndsAt: string;
  localDefinitionHash: string;
}
export interface WeeklyChallengePendingOffer {
  offerId: string;
  completedStage: number;
  choices: CardId[];
}
export interface WeeklyChallengeBoundaryCheckpoint {
  schemaVersion: 1;
  checkpointSeq: number;
  boundary: "ready-for-stage" | "awaiting-card";
  stageToPlay: number;
  score: WeeklyChallengeScore;
  cards: SerializedRunCards;
  pendingOffer: WeeklyChallengePendingOffer | null;
}
export interface WeeklyChallengePendingAction {
  actionId: string;
  beginRequestId: string;
  kind: WeeklyChallengeActionKind;
  stage: number;
  playerTurn: number | null;
  commandId: string;
  begunAt: string;
}
export interface WeeklyChallengeAttemptWire {
  schemaVersion: 1;
  attemptId: string;
  weekId: string;
  definitionId: "W01";
  definitionRevision: 1;
  definitionHash: string;
  status: WeeklyChallengeStatus;
  revision: number;
  ownerSessionId: string | null;
  ownerFence: number;
  currentStage: number;
  score: WeeklyChallengeScore;
  acknowledgedStageOwnTurns: number;
  acknowledgedActionCount: number;
  pendingAction: WeeklyChallengePendingAction | null;
  boundaryCheckpoint: WeeklyChallengeBoundaryCheckpoint;
  finishedAt: string | null;
  endedBy: WeeklyChallengeOutcome | "terminated" | null;
}
export interface WeeklyChallengeRecord {
  weekId: string;
  definitionHash: string;
  completedStages: number;
  completedStageOwnTurns: number;
  sourceAttemptId: string;
  achievedAt: string;
}
export interface WeeklyChallengeCapabilities {
  accountAttempts: true;
  boundaryResume: true;
  inStageRestore: false;
}
export interface WeeklyChallengeSnapshotData {
  currentWeek: WeeklyChallengeDefinition;
  previousWeek: WeeklyChallengeDefinition;
  activeAttempt: WeeklyChallengeAttemptWire | null;
  records: { current: WeeklyChallengeRecord | null; previous: WeeklyChallengeRecord | null };
  capabilities: WeeklyChallengeCapabilities;
}
export interface WeeklyChallengeRpcSuccess<T> { ok: true; code: "OK"; serverNow: string; data: T }
export interface WeeklyChallengeRpcFailure {
  ok: false; code: WeeklyChallengeErrorCode; serverNow: string;
  rejectedEventIndex?: number; receipts?: WeeklyChallengeEventReceipt[];
  snapshot?: WeeklyChallengeAttemptWire | null;
}
export type WeeklyChallengeRpcResponse<T> = WeeklyChallengeRpcSuccess<T> | WeeklyChallengeRpcFailure;

export interface WeeklyChallengeActionBeginEvent {
  clientEventId: string; kind: "action-begin"; actionId: string;
  actionKind: WeeklyChallengeActionKind; stage: number; playerTurn: number | null; commandId: string;
}
export interface WeeklyChallengeActionAckEvent {
  clientEventId: string; kind: "action-ack"; actionId: string; stage: number;
  playerTurn: number | null; forced: boolean | null; postStateHash?: string;
}
export interface WeeklyChallengeStageResultEvent {
  clientEventId: string; kind: "stage-result"; stage: number; outcome: WeeklyChallengeOutcome;
}
export interface WeeklyChallengeCardPickEvent {
  clientEventId: string; kind: "card-pick"; completedStage: number; offerId: string; cardId: CardId;
}
export type WeeklyChallengeEvent = WeeklyChallengeActionBeginEvent | WeeklyChallengeActionAckEvent | WeeklyChallengeStageResultEvent | WeeklyChallengeCardPickEvent;
export interface WeeklyChallengeEventReceipt {
  eventIndex: number; clientEventId: string; disposition: "applied" | "duplicate";
  revisionAfter: number;
  result: "action-begun" | "action-acknowledged" | "stage-finished" | "stage-cleared" | "card-picked" | "attempt-finished";
  checkpointSeq: number; score: WeeklyChallengeScore;
}

export type WeeklyChallengeSyncState = "loading" | "synced" | "practice" | "offline" | "missing-server" | "error" | "blocked";
export interface WeeklyChallengePracticeRun {
  definition: WeeklyChallengeDefinition | LocalPracticeDefinition;
  stage: number; score: WeeklyChallengeScore; cards: SerializedRunCards;
  stageOwnTurns: number; pendingOffer: WeeklyChallengePendingOffer | null;
  status: "ready-for-stage" | "awaiting-card" | "playing" | "finished";
  endedBy: WeeklyChallengeOutcome | null;
}
export interface WeeklyChallengeLocalRecord {
  identity: string; definitionHash: string; completedStages: number;
  completedStageOwnTurns: number; achievedAt: string;
}
