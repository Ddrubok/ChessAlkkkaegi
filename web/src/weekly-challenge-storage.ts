import type { SupabaseClient } from "@supabase/supabase-js";
import { createFallbackPracticeDefinition, createLocalWeeklyDefinition, verifyLocalPracticeDefinitionHash, verifyWeeklyDefinitionHash } from "./weekly-challenge-definition";
import { compareWeeklyScores, createPracticeRun } from "./weekly-challenge-run";
import type {
  WeeklyChallengeAttemptWire, WeeklyChallengeDefinition,
  LocalPracticeDefinition,
  WeeklyChallengeEvent, WeeklyChallengeEventReceipt, WeeklyChallengeLocalRecord,
  WeeklyChallengePracticeRun, WeeklyChallengeRecord, WeeklyChallengeRpcResponse,
  WeeklyChallengeSnapshotData, WeeklyChallengeSyncState,
} from "./weekly-challenge-model";

const GUEST_KEY = "ca_weekly_challenge_guest_v1";
const ACCOUNT_PREFIX = "ca_weekly_challenge_account_v1:";
const SESSION_KEY = "ca_weekly_challenge_session_v1";
const SESSION_CHANNEL = "ca_weekly_challenge_session_channel_v1";
const MAX_CACHE_BYTES = 96 * 1024;
const MAX_OUTBOX = 32;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const HASH = /^[0-9a-f]{64}$/u;
const PRIORITIES = '[["force","weight","size"],["weight","size","giantPawn"],["force","size","proneStart"],["force","weight","size"],["force","size","giantPawn"],["weight","force","proneStart"],["force","weight","size"],["force","size","giantPawn"],["weight","size","proneStart"]]';

interface PendingOperation { attemptId: string; expectedRevision: number; clientSessionId: string; events: WeeklyChallengeEvent[] }
type PendingCommand =
  | { kind: "begin"; requestId: string; weekId: string; definitionHash: string; clientSessionId: string }
  | { kind: "control"; requestId: string; attemptId: string; command: "resume" | "takeover" | "terminate"; expectedRevision: number; clientSessionId: string };
interface WeeklyCache {
  schemaVersion: 1;
  snapshot: WeeklyChallengeSnapshotData | null;
  practice: WeeklyChallengePracticeRun | null;
  localDefinitions: LocalPracticeDefinition[];
  localRecords: WeeklyChallengeLocalRecord[];
  pending: PendingOperation[];
  pendingCommands: PendingCommand[];
  syncState: WeeklyChallengeSyncState;
  lastServerAt: string | null;
  lastServerLocalAt: string | null;
}
interface NetworkSession { generation: number; owner: string; client: SupabaseClient; clientSessionId: string; tail: Promise<void> }
export interface WeeklyChallengeView extends WeeklyCache {
  owner: string | null; ready: boolean; blocked: boolean; sessionId: string;
  recoveryHold: boolean; statusText: string;
}

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function isObject(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).sort().join("\n") === [...keys].sort().join("\n"); }
function iso(value: unknown): value is string { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) && !Number.isNaN(Date.parse(value)); }
function safeInt(value: unknown, min = 0, max = 2_147_483_647): value is number { return Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max; }
function key(owner: string | null): string { return owner ? `${ACCOUNT_PREFIX}${owner}` : GUEST_KEY; }
function fresh(): WeeklyCache { return { schemaVersion: 1, snapshot: null, practice: null, localDefinitions: [], localRecords: [], pending: [], pendingCommands: [], syncState: "loading", lastServerAt: null, lastServerLocalAt: null }; }
function isMissingRpc(error: { code?: string; message?: string } | null): boolean {
  return !!error && (error.code === "PGRST202" || /could not find.*function|schema cache/i.test(error.message ?? ""));
}
function validScore(value: unknown): boolean { return isObject(value) && exact(value, ["completedStages", "completedStageOwnTurns"]) && safeInt(value.completedStages, 0, 10) && safeInt(value.completedStageOwnTurns); }
function validCards(value: unknown): boolean { return isObject(value) && exact(value, ["sizeGrade", "weightGrade", "forceGrade", "giantPawn", "proneStart", "picksSoFar"]) && [value.sizeGrade, value.weightGrade, value.forceGrade].every((v) => safeInt(v, 0, 5)) && typeof value.giantPawn === "boolean" && typeof value.proneStart === "boolean" && safeInt(value.picksSoFar, 0, 9); }
function validDefinition(value: unknown): value is WeeklyChallengeDefinition {
  if (!isObject(value) || !exact(value, ["schemaVersion", "weekId", "startsAt", "endsAt", "definitionId", "definitionRevision", "rulesetVersion", "stageLayoutVersion", "physicsVersion", "aiVersion", "definitionHash", "stageCount", "playerSide", "researchEnabled", "cardEffectScale", "enemyStageBuffScale", "prioritySlots", "fallbackOrder"])) return false;
  return value.schemaVersion === 1 && typeof value.weekId === "string" && /^weekly:\d{4}-\d{2}-\d{2}@05:00:Asia\/Seoul$/u.test(value.weekId) && iso(value.startsAt) && iso(value.endsAt) && Date.parse(value.endsAt) - Date.parse(value.startsAt) === 604_800_000 && value.definitionId === "W01" && value.definitionRevision === 1 && value.rulesetVersion === "weekly-w01-r1" && value.stageLayoutVersion === "source:688bee1a5e931fba9bfbfd930995e73ab12ec206" && value.physicsVersion === "@dimforge/rapier3d-compat:0.19.3" && value.aiVersion === "source:688bee1a5e931fba9bfbfd930995e73ab12ec206" && typeof value.definitionHash === "string" && HASH.test(value.definitionHash) && value.stageCount === 10 && value.playerSide === "white" && value.researchEnabled === false && value.cardEffectScale === 1 && value.enemyStageBuffScale === 1 && JSON.stringify(value.prioritySlots) === PRIORITIES && Array.isArray(value.fallbackOrder) && value.fallbackOrder.join(",") === "force,weight,size,giantPawn,proneStart";
}
function validLocalDefinition(value: unknown): value is import("./weekly-challenge-model").LocalPracticeDefinition {
  return isObject(value) && exact(value, ["schemaVersion", "localPracticeId", "localStartsAt", "localEndsAt", "localDefinitionHash", "definitionId", "definitionRevision", "rulesetVersion", "stageLayoutVersion", "physicsVersion", "aiVersion", "stageCount", "playerSide", "researchEnabled", "cardEffectScale", "enemyStageBuffScale", "prioritySlots", "fallbackOrder"]) && value.schemaVersion === 1 && typeof value.localPracticeId === "string" && /^practice-local:\d{4}-\d{2}-\d{2}@05:00:Asia\/Seoul:W01:r1$/u.test(value.localPracticeId) && iso(value.localStartsAt) && iso(value.localEndsAt) && Date.parse(value.localEndsAt) - Date.parse(value.localStartsAt) === 604_800_000 && typeof value.localDefinitionHash === "string" && HASH.test(value.localDefinitionHash) && value.definitionId === "W01" && value.definitionRevision === 1 && value.rulesetVersion === "weekly-w01-r1" && value.stageLayoutVersion === "source:688bee1a5e931fba9bfbfd930995e73ab12ec206" && value.physicsVersion === "@dimforge/rapier3d-compat:0.19.3" && value.aiVersion === "source:688bee1a5e931fba9bfbfd930995e73ab12ec206" && value.stageCount === 10 && value.playerSide === "white" && value.researchEnabled === false && value.cardEffectScale === 1 && value.enemyStageBuffScale === 1 && JSON.stringify(value.prioritySlots) === PRIORITIES && Array.isArray(value.fallbackOrder) && value.fallbackOrder.join(",") === "force,weight,size,giantPawn,proneStart";
}
function validOffer(value: unknown): boolean { return value === null || isObject(value) && typeof value.offerId === "string" && UUID.test(value.offerId) && safeInt(value.completedStage, 1, 9) && Array.isArray(value.choices) && value.choices.length >= 1 && value.choices.length <= 3 && value.choices.every((id) => ["force", "weight", "size", "giantPawn", "proneStart"].includes(String(id))) && new Set(value.choices).size === value.choices.length; }
function validPractice(value: unknown): boolean {
  return value === null || isObject(value) && (validDefinition(value.definition) || validLocalDefinition(value.definition)) && safeInt(value.stage, 1, 10) && validScore(value.score) && validCards(value.cards) && safeInt(value.stageOwnTurns) && validOffer(value.pendingOffer) && ["ready-for-stage", "awaiting-card", "playing", "finished"].includes(String(value.status)) && (value.endedBy === null || ["white-win", "black-win", "draw"].includes(String(value.endedBy)));
}
function validEvent(value: unknown): value is WeeklyChallengeEvent {
  if (!isObject(value) || typeof value.clientEventId !== "string" || !UUID.test(value.clientEventId) || typeof value.kind !== "string") return false;
  if (value.kind === "action-begin") return exact(value, ["clientEventId", "kind", "actionId", "actionKind", "stage", "playerTurn", "commandId"]) && typeof value.actionId === "string" && UUID.test(value.actionId) && typeof value.commandId === "string" && UUID.test(value.commandId) && ["launch", "king-swap", "king-defense"].includes(String(value.actionKind)) && safeInt(value.stage, 1, 10) && (value.actionKind === "launch" ? safeInt(value.playerTurn, 1) : value.playerTurn === null);
  if (value.kind === "action-ack") return (exact(value, ["clientEventId", "kind", "actionId", "stage", "playerTurn", "forced"]) || exact(value, ["clientEventId", "kind", "actionId", "stage", "playerTurn", "forced", "postStateHash"])) && typeof value.actionId === "string" && UUID.test(value.actionId) && safeInt(value.stage, 1, 10) && (value.playerTurn === null || safeInt(value.playerTurn, 1)) && (value.forced === null || typeof value.forced === "boolean") && (value.postStateHash === undefined || typeof value.postStateHash === "string" && HASH.test(value.postStateHash));
  if (value.kind === "stage-result") return exact(value, ["clientEventId", "kind", "stage", "outcome"]) && safeInt(value.stage, 1, 10) && ["white-win", "black-win", "draw"].includes(String(value.outcome));
  return value.kind === "card-pick" && exact(value, ["clientEventId", "kind", "completedStage", "offerId", "cardId"]) && safeInt(value.completedStage, 1, 9) && typeof value.offerId === "string" && UUID.test(value.offerId) && ["force", "weight", "size", "giantPawn", "proneStart"].includes(String(value.cardId));
}
function validReceipt(value: unknown, events: readonly WeeklyChallengeEvent[]): value is WeeklyChallengeEventReceipt {
  if (!isObject(value) || !exact(value, ["eventIndex", "clientEventId", "disposition", "revisionAfter", "result", "checkpointSeq", "score"]) || !safeInt(value.eventIndex, 0, events.length - 1) || typeof value.clientEventId !== "string" || events[value.eventIndex]?.clientEventId !== value.clientEventId || !["applied", "duplicate"].includes(String(value.disposition)) || !safeInt(value.revisionAfter) || !["action-begun", "action-acknowledged", "stage-finished", "stage-cleared", "card-picked", "attempt-finished"].includes(String(value.result)) || !safeInt(value.checkpointSeq) || !validScore(value.score)) return false;
  return true;
}
function validAttempt(value: unknown): value is WeeklyChallengeAttemptWire {
  if (!isObject(value) || !exact(value, ["schemaVersion", "attemptId", "weekId", "definitionId", "definitionRevision", "definitionHash", "status", "revision", "ownerSessionId", "ownerFence", "currentStage", "score", "acknowledgedStageOwnTurns", "acknowledgedActionCount", "pendingAction", "boundaryCheckpoint", "finishedAt", "endedBy"]) || value.schemaVersion !== 1 || typeof value.attemptId !== "string" || !UUID.test(value.attemptId) || typeof value.weekId !== "string" || value.definitionId !== "W01" || value.definitionRevision !== 1 || typeof value.definitionHash !== "string" || !HASH.test(value.definitionHash) || !safeInt(value.revision) || !safeInt(value.ownerFence) || !safeInt(value.currentStage, 1, 10) || !validScore(value.score) || !safeInt(value.acknowledgedStageOwnTurns) || !safeInt(value.acknowledgedActionCount) || !(value.ownerSessionId === null || (typeof value.ownerSessionId === "string" && UUID.test(value.ownerSessionId))) || !isObject(value.boundaryCheckpoint)) return false;
  const cp = value.boundaryCheckpoint;
  const pending = value.pendingAction;
  const pendingValid = pending === null || isObject(pending) && exact(pending, ["actionId", "beginRequestId", "kind", "stage", "playerTurn", "commandId", "begunAt"]) && typeof pending.actionId === "string" && UUID.test(pending.actionId) && typeof pending.beginRequestId === "string" && UUID.test(pending.beginRequestId) && typeof pending.commandId === "string" && UUID.test(pending.commandId) && ["launch", "king-swap", "king-defense"].includes(String(pending.kind)) && safeInt(pending.stage, 1, 10) && (pending.kind === "launch" ? safeInt(pending.playerTurn, 1) : pending.playerTurn === null) && iso(pending.begunAt);
  return exact(cp, ["schemaVersion", "checkpointSeq", "boundary", "stageToPlay", "score", "cards", "pendingOffer"]) && cp.schemaVersion === 1 && safeInt(cp.checkpointSeq) && ["ready-for-stage", "awaiting-card"].includes(String(cp.boundary)) && safeInt(cp.stageToPlay, 1, 10) && validScore(cp.score) && validCards(cp.cards) && validOffer(cp.pendingOffer) && pendingValid && ["ready-for-stage", "awaiting-card", "playing", "pending-action", "finished", "terminated", "expired"].includes(String(value.status)) && (value.finishedAt === null || iso(value.finishedAt)) && (value.endedBy === null || ["white-win", "black-win", "draw", "terminated"].includes(String(value.endedBy)));
}
function validRecord(value: unknown): value is WeeklyChallengeRecord { return isObject(value) && exact(value, ["weekId", "definitionHash", "completedStages", "completedStageOwnTurns", "sourceAttemptId", "achievedAt"]) && typeof value.weekId === "string" && /^weekly:\d{4}-\d{2}-\d{2}@05:00:Asia\/Seoul$/u.test(value.weekId) && typeof value.definitionHash === "string" && HASH.test(value.definitionHash) && safeInt(value.completedStages, 0, 10) && safeInt(value.completedStageOwnTurns) && typeof value.sourceAttemptId === "string" && UUID.test(value.sourceAttemptId) && iso(value.achievedAt); }
function validLocalRecord(value: unknown): value is WeeklyChallengeLocalRecord { return isObject(value) && exact(value, ["identity", "definitionHash", "completedStages", "completedStageOwnTurns", "achievedAt"]) && typeof value.identity === "string" && value.identity.length <= 120 && typeof value.definitionHash === "string" && HASH.test(value.definitionHash) && safeInt(value.completedStages, 0, 10) && safeInt(value.completedStageOwnTurns) && iso(value.achievedAt); }
function validSnapshot(value: unknown): value is WeeklyChallengeSnapshotData {
  if (!isObject(value) || !exact(value, ["currentWeek", "previousWeek", "activeAttempt", "records", "capabilities"]) || !validDefinition(value.currentWeek) || !validDefinition(value.previousWeek) || !(value.activeAttempt === null || validAttempt(value.activeAttempt)) || !isObject(value.records) || !exact(value.records, ["current", "previous"]) || !(value.records.current === null || validRecord(value.records.current)) || !(value.records.previous === null || validRecord(value.records.previous)) || !isObject(value.capabilities) || !exact(value.capabilities, ["accountAttempts", "boundaryResume", "inStageRestore"])) return false;
  if (Date.parse(value.previousWeek.endsAt) !== Date.parse(value.currentWeek.startsAt)) return false;
  if (value.records.current && (value.records.current.weekId !== value.currentWeek.weekId || value.records.current.definitionHash !== value.currentWeek.definitionHash)) return false;
  if (value.records.previous && (value.records.previous.weekId !== value.previousWeek.weekId || value.records.previous.definitionHash !== value.previousWeek.definitionHash)) return false;
  if (value.activeAttempt) {
    const definition = value.activeAttempt.weekId === value.currentWeek.weekId ? value.currentWeek : value.activeAttempt.weekId === value.previousWeek.weekId ? value.previousWeek : null;
    if (!definition || value.activeAttempt.definitionHash !== definition.definitionHash) return false;
  }
  return value.capabilities.accountAttempts === true && value.capabilities.boundaryResume === true && value.capabilities.inStageRestore === false;
}
async function validSnapshotHashes(value: WeeklyChallengeSnapshotData): Promise<boolean> {
  return await verifyWeeklyDefinitionHash(value.currentWeek) && await verifyWeeklyDefinitionHash(value.previousWeek);
}
const ERROR_CODES = new Set(["WEEK_NOT_CURRENT", "DEFINITION_MISMATCH", "ACTIVE_ATTEMPT_EXISTS", "ATTEMPT_NOT_FOUND", "STALE_REVISION", "NOT_ATTEMPT_OWNER", "PENDING_ACTION", "ACTIVE_STAGE_NOT_RESTORABLE", "RECOVERY_HOLD", "WEEK_EXPIRED", "ATTEMPT_FINISHED", "INVALID_TRANSITION", "INVALID_CARD_PICK", "INVALID_STAGE_RESULT", "EVENT_ID_PAYLOAD_MISMATCH", "RPC_UNAVAILABLE"]);
function validFailure(value: unknown): boolean {
  if (!isObject(value) || !Object.keys(value).every((key) => ["ok", "code", "serverNow", "rejectedEventIndex", "receipts", "snapshot"].includes(key)) || value.ok !== false || typeof value.code !== "string" || !ERROR_CODES.has(value.code) || !iso(value.serverNow)) return false;
  if (value.rejectedEventIndex !== undefined && !safeInt(value.rejectedEventIndex)) return false;
  return value.snapshot === undefined || value.snapshot === null || validAttempt(value.snapshot);
}
function validBeginEnvelope(value: unknown, requestId: string): value is WeeklyChallengeRpcResponse<{ receipt: { requestId: string; disposition: "started" | "duplicate"; attemptId: string | null; revisionAfter: number | null }; snapshot: WeeklyChallengeAttemptWire | null }> {
  if (validFailure(value)) return true;
  if (!isObject(value) || value.ok !== true || value.code !== "OK" || !iso(value.serverNow) || !isObject(value.data) || !exact(value.data, ["receipt", "snapshot"]) || !isObject(value.data.receipt) || !exact(value.data.receipt, ["requestId", "disposition", "attemptId", "revisionAfter"])) return false;
  const receipt = value.data.receipt;
  return receipt.requestId === requestId && ["started", "duplicate"].includes(String(receipt.disposition)) && (receipt.attemptId === null || typeof receipt.attemptId === "string" && UUID.test(receipt.attemptId)) && (receipt.revisionAfter === null || safeInt(receipt.revisionAfter)) && (value.data.snapshot === null || validAttempt(value.data.snapshot));
}
function validControlEnvelope(value: unknown, requestId: string, command: string): value is WeeklyChallengeRpcResponse<{ receipt: { requestId: string; command: "resume" | "takeover" | "terminate"; disposition: "applied" | "duplicate"; revisionAfter: number }; snapshot: WeeklyChallengeAttemptWire | null }> {
  if (validFailure(value)) return true;
  if (!isObject(value) || value.ok !== true || value.code !== "OK" || !iso(value.serverNow) || !isObject(value.data) || !exact(value.data, ["receipt", "snapshot"]) || !isObject(value.data.receipt) || !exact(value.data.receipt, ["requestId", "command", "disposition", "revisionAfter"])) return false;
  const receipt = value.data.receipt;
  return receipt.requestId === requestId && receipt.command === command && ["applied", "duplicate"].includes(String(receipt.disposition)) && safeInt(receipt.revisionAfter) && (value.data.snapshot === null || validAttempt(value.data.snapshot));
}
function validCache(value: unknown): value is WeeklyCache {
  if (!isObject(value) || !exact(value, ["schemaVersion", "snapshot", "practice", "localDefinitions", "localRecords", "pending", "pendingCommands", "syncState", "lastServerAt", "lastServerLocalAt"]) || value.schemaVersion !== 1 || !(value.snapshot === null || validSnapshot(value.snapshot)) || !validPractice(value.practice) || !Array.isArray(value.localDefinitions) || value.localDefinitions.length > 2 || !value.localDefinitions.every(validLocalDefinition) || !Array.isArray(value.localRecords) || value.localRecords.length > 8 || !value.localRecords.every(validLocalRecord) || !Array.isArray(value.pending) || value.pending.length > MAX_OUTBOX || !Array.isArray(value.pendingCommands) || value.pendingCommands.length > 8 || !["loading", "synced", "practice", "offline", "missing-server", "error", "blocked"].includes(String(value.syncState)) || !(value.lastServerAt === null || iso(value.lastServerAt)) || !(value.lastServerLocalAt === null || iso(value.lastServerLocalAt)) || (value.lastServerAt === null) !== (value.lastServerLocalAt === null)) return false;
  const validCommands = value.pendingCommands.every((item) => {
    if (!isObject(item) || typeof item.requestId !== "string" || !UUID.test(item.requestId)) return false;
    if (item.kind === "begin") return exact(item, ["kind", "requestId", "weekId", "definitionHash", "clientSessionId"]) && typeof item.weekId === "string" && /^weekly:\d{4}-\d{2}-\d{2}@05:00:Asia\/Seoul$/u.test(item.weekId) && typeof item.definitionHash === "string" && HASH.test(item.definitionHash) && typeof item.clientSessionId === "string" && UUID.test(item.clientSessionId);
    return item.kind === "control" && exact(item, ["kind", "requestId", "attemptId", "command", "expectedRevision", "clientSessionId"]) && typeof item.attemptId === "string" && UUID.test(item.attemptId) && ["resume", "takeover", "terminate"].includes(String(item.command)) && safeInt(item.expectedRevision) && typeof item.clientSessionId === "string" && UUID.test(item.clientSessionId);
  });
  return validCommands && value.pending.every((item) => isObject(item) && exact(item, ["attemptId", "expectedRevision", "clientSessionId", "events"]) && typeof item.attemptId === "string" && UUID.test(item.attemptId) && safeInt(item.expectedRevision) && typeof item.clientSessionId === "string" && UUID.test(item.clientSessionId) && Array.isArray(item.events) && item.events.length > 0 && item.events.length <= 8 && item.events.every(validEvent));
}
function sessionId(): string {
  const existing = sessionStorage.getItem(SESSION_KEY);
  if (existing && UUID.test(existing)) return existing;
  const created = crypto.randomUUID(); sessionStorage.setItem(SESSION_KEY, created); return created;
}

export class WeeklyChallengeStorage {
  owner: string | null = null;
  ready = false;
  blocked = false;
  clientSessionId = sessionId();
  private readonly tabNonce = crypto.randomUUID();
  private readonly sessionChannel: BroadcastChannel | null;
  private cache = fresh();
  private generation = 0;
  private network: NetworkSession | null = null;
  private listeners = new Set<() => void>();
  private serverMonotonicAnchor: { serverMs: number; monotonicMs: number } | null = null;

  constructor() {
    this.sessionChannel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(SESSION_CHANNEL);
    this.sessionChannel?.addEventListener("message", (event: MessageEvent<unknown>) => {
      const message = event.data;
      if (!isObject(message) || !["hello", "session"].includes(String(message.type)) || typeof message.sessionId !== "string" || !UUID.test(message.sessionId) || typeof message.nonce !== "string" || !UUID.test(message.nonce) || message.nonce === this.tabNonce) return;
      if (message.sessionId === this.clientSessionId && message.nonce < this.tabNonce) {
        this.clientSessionId = crypto.randomUUID();
        sessionStorage.setItem(SESSION_KEY, this.clientSessionId);
        this.sessionChannel?.postMessage({ type: "session", sessionId: this.clientSessionId, nonce: this.tabNonce });
        const priorNetwork = this.network;
        if (priorNetwork) void this.activate(priorNetwork.client, priorNetwork.owner);
        else this.emit();
      } else if (message.type === "hello") {
        this.sessionChannel?.postMessage({ type: "session", sessionId: this.clientSessionId, nonce: this.tabNonce });
      }
    });
    this.sessionChannel?.postMessage({ type: "hello", sessionId: this.clientSessionId, nonce: this.tabNonce });
  }

  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private emit(): void { this.listeners.forEach((listener) => listener()); }
  view(): WeeklyChallengeView {
    const attempt = this.cache.snapshot?.activeAttempt;
    const recoveryHold = !!attempt && (["playing", "pending-action"].includes(attempt.status) || this.cache.pending.some((item) => item.attemptId === attempt.attemptId));
    const statusText = ({ loading: "Loading", synced: "Saved to account", practice: "Personal practice", offline: "Offline practice available", "missing-server": "Server update required; practice available", error: "Could not synchronize", blocked: "Stored data needs recovery" } as const)[this.cache.syncState];
    return { ...clone(this.cache), owner: this.owner, ready: this.ready, blocked: this.blocked, sessionId: this.clientSessionId, recoveryHold, statusText };
  }
  estimatedNow(): number {
    if (this.serverMonotonicAnchor && typeof performance !== "undefined") return this.serverMonotonicAnchor.serverMs + Math.max(0, performance.now() - this.serverMonotonicAnchor.monotonicMs);
    if (this.cache.lastServerAt && this.cache.lastServerLocalAt) {
      return Date.parse(this.cache.lastServerAt) + Math.max(0, Date.now() - Date.parse(this.cache.lastServerLocalAt));
    }
    return Date.now();
  }
  private stampServer(next: WeeklyCache, serverNow: string): void {
    next.lastServerAt = serverNow;
    next.lastServerLocalAt = new Date().toISOString();
    this.serverMonotonicAnchor = { serverMs: Date.parse(serverNow), monotonicMs: performance.now() };
  }
  suspend(): void { this.generation += 1; this.owner = null; this.network = null; this.ready = false; this.serverMonotonicAnchor = null; this.emit(); }
  private persist(next: WeeklyCache): boolean {
    if (this.blocked || !validCache(next)) return false;
    const raw = JSON.stringify(next);
    if (new TextEncoder().encode(raw).length > MAX_CACHE_BYTES) { this.blocked = true; this.cache.syncState = "blocked"; this.emit(); return false; }
    try { localStorage.setItem(key(this.owner), raw); this.cache = next; return true; }
    catch { this.blocked = true; this.cache.syncState = "blocked"; this.emit(); return false; }
  }
  private current(session: NetworkSession): boolean { return this.network === session && session.generation === this.generation && session.owner === this.owner && session.clientSessionId === this.clientSessionId; }
  private queue<T>(session: NetworkSession, operation: () => Promise<T>): Promise<T | undefined> {
    const task = session.tail.then(async () => this.current(session) ? operation() : undefined);
    session.tail = task.then(() => undefined, () => undefined); return task;
  }
  async activate(client: SupabaseClient | null, owner: string | null): Promise<void> {
    const generation = ++this.generation; this.owner = owner; this.ready = false; this.blocked = false; this.serverMonotonicAnchor = null;
    this.network = owner && client ? { generation, owner, client, clientSessionId: this.clientSessionId, tail: Promise.resolve() } : null;
    const raw = localStorage.getItem(key(owner));
    if (raw !== null) {
      try {
        let parsed: unknown = JSON.parse(raw);
        if (isObject(parsed) && !Object.hasOwn(parsed, "pendingCommands") && exact(parsed, ["schemaVersion", "snapshot", "practice", "localRecords", "pending", "syncState", "lastServerAt"])) parsed = { ...parsed, pendingCommands: [], localDefinitions: [], lastServerLocalAt: parsed.lastServerAt ? new Date().toISOString() : null };
        else if (isObject(parsed) && !Object.hasOwn(parsed, "localDefinitions") && exact(parsed, ["schemaVersion", "snapshot", "practice", "localRecords", "pending", "pendingCommands", "syncState", "lastServerAt"])) parsed = { ...parsed, localDefinitions: [], lastServerLocalAt: parsed.lastServerAt ? new Date().toISOString() : null };
        else if (isObject(parsed) && !Object.hasOwn(parsed, "lastServerLocalAt") && exact(parsed, ["schemaVersion", "snapshot", "practice", "localDefinitions", "localRecords", "pending", "pendingCommands", "syncState", "lastServerAt"])) parsed = { ...parsed, lastServerLocalAt: parsed.lastServerAt ? new Date().toISOString() : null };
        if (!validCache(parsed)) throw new Error();
        const practiceDefinition = parsed.practice?.definition;
        const hashesValid = (!parsed.snapshot || await validSnapshotHashes(parsed.snapshot)) && (!practiceDefinition || ("definitionHash" in practiceDefinition ? await verifyWeeklyDefinitionHash(practiceDefinition) : await verifyLocalPracticeDefinitionHash(practiceDefinition))) && (await Promise.all(parsed.localDefinitions.map(verifyLocalPracticeDefinitionHash))).every(Boolean);
        if (generation !== this.generation || owner !== this.owner) return;
        if (!hashesValid) throw new Error();
        this.cache = parsed;
        if (parsed.lastServerAt) this.serverMonotonicAnchor = { serverMs: Date.parse(parsed.lastServerAt) + Math.max(0, Date.now() - Date.parse(parsed.lastServerLocalAt!)), monotonicMs: performance.now() };
      }
      catch { this.cache = fresh(); this.cache.syncState = "blocked"; this.blocked = true; this.ready = true; this.emit(); return; }
    } else this.cache = fresh();
    if (!this.network) {
      const localDefinition = await createFallbackPracticeDefinition();
      if (generation !== this.generation || owner !== this.owner) return;
      const previousDefinition = await createFallbackPracticeDefinition(new Date(), -1);
      if (generation !== this.generation || owner !== this.owner) return;
      this.cache.localDefinitions = [localDefinition, previousDefinition];
      const practiceIdentity = this.cache.practice?.definition && "localPracticeId" in this.cache.practice.definition ? this.cache.practice.definition.localPracticeId : null;
      if (!this.cache.practice || practiceIdentity !== localDefinition.localPracticeId || this.cache.practice.status === "playing") this.cache.practice = createPracticeRun(localDefinition);
      this.cache.syncState = owner ? "offline" : "practice";
      this.persist(clone(this.cache)); this.ready = true; this.emit(); return;
    }
    await this.refresh();
  }
  async refresh(): Promise<void> {
    const session = this.network;
    if (!session || this.blocked) { this.ready = true; this.emit(); return; }
    await this.queue(session, async () => {
      const response = await session.client.rpc("get_weekly_challenge_snapshot_v1", { p_expected_user_id: session.owner });
      if (!this.current(session)) return;
      if (response.error) {
        const next = clone(this.cache); next.syncState = isMissingRpc(response.error) ? "missing-server" : "offline";
        const localDefinition = await createFallbackPracticeDefinition();
        if (!this.current(session)) return;
        const previousDefinition = await createFallbackPracticeDefinition(new Date(), -1);
        if (!this.current(session)) return;
        next.localDefinitions = [localDefinition, previousDefinition];
        if (!next.practice) next.practice = createPracticeRun(localDefinition);
        this.persist(next); this.ready = true; this.emit(); return;
      }
      const envelope = response.data as unknown;
      if (!isObject(envelope) || !exact(envelope, ["ok", "code", "serverNow", "data"]) || envelope.ok !== true || envelope.code !== "OK" || !iso(envelope.serverNow) || !validSnapshot(envelope.data) || !await validSnapshotHashes(envelope.data)) {
        if (!this.current(session)) return;
        this.cache.syncState = "error"; this.ready = true; this.emit(); return;
      }
      if (!this.current(session)) return;
      const next = clone(this.cache); next.snapshot = clone(envelope.data); this.stampServer(next, envelope.serverNow); next.syncState = "synced";
      if (!this.persist(next)) return; this.ready = true; this.emit();
    });
    if (this.current(session) && this.cache.pendingCommands.length) {
      const command = this.cache.pendingCommands[0];
      if (command.kind === "begin") await this.beginAccountAttempt(); else await this.control(command.command);
    }
    if (this.current(session) && this.cache.pending.length) await this.flush(session);
  }
  async ensurePractice(selectedDefinition?: WeeklyChallengeDefinition | LocalPracticeDefinition): Promise<WeeklyChallengePracticeRun> {
    const generation = this.generation, owner = this.owner;
    const definition = selectedDefinition ?? this.cache.snapshot?.currentWeek ?? await createFallbackPracticeDefinition(new Date(this.estimatedNow()));
    if (generation !== this.generation || owner !== this.owner) throw new Error("Weekly challenge owner changed.");
    const identity = "weekId" in definition ? definition.weekId : definition.localPracticeId;
    const currentIdentity = this.cache.practice ? ("weekId" in this.cache.practice.definition ? this.cache.practice.definition.weekId : this.cache.practice.definition.localPracticeId) : null;
    if (this.cache.practice && currentIdentity === identity && ["ready-for-stage", "awaiting-card"].includes(this.cache.practice.status)) return this.cache.practice;
    const next = clone(this.cache); next.practice = createPracticeRun(definition); next.syncState = this.owner ? this.cache.syncState : "practice";
    if (!this.persist(next)) throw new Error("Unable to save weekly challenge practice."); this.emit(); return this.cache.practice!;
  }
  updatePractice(mutator: (run: WeeklyChallengePracticeRun) => void): boolean {
    if (!this.cache.practice || this.blocked) return false;
    const next = clone(this.cache); mutator(next.practice!);
    if (next.practice!.score.completedStages > 0) {
      const definition = next.practice!.definition;
      const identity = "weekId" in definition ? definition.weekId : definition.localPracticeId;
      const definitionHash = "definitionHash" in definition ? definition.definitionHash : definition.localDefinitionHash;
      const candidate: WeeklyChallengeLocalRecord = { identity, definitionHash, ...next.practice!.score, achievedAt: new Date().toISOString() };
      const prior = next.localRecords.find((item) => item.identity === identity && item.definitionHash === definitionHash);
      if (!prior || compareWeeklyScores(candidate, prior) > 0) next.localRecords = [candidate, ...next.localRecords.filter((item) => item !== prior)].slice(0, 8);
    }
    if (!this.persist(next)) return false; this.emit(); return true;
  }
  savePractice(run: WeeklyChallengePracticeRun): boolean {
    if (this.blocked) return false;
    const next = clone(this.cache); next.practice = clone(run);
    if (!this.persist(next)) return false; this.emit(); return true;
  }
  async beginAccountAttempt(): Promise<WeeklyChallengeRpcResponse<{ receipt: unknown; snapshot: WeeklyChallengeAttemptWire | null }> | null> {
    const session = this.network, definition = this.cache.snapshot?.currentWeek;
    if (!session || !definition) return null;
    const existing = this.cache.pendingCommands.find((item): item is Extract<PendingCommand, { kind: "begin" }> => item.kind === "begin");
    const operation = existing ?? { kind: "begin" as const, requestId: crypto.randomUUID(), weekId: definition.weekId, definitionHash: definition.definitionHash, clientSessionId: session.clientSessionId };
    if (!existing) { const next = clone(this.cache); next.pendingCommands.push(operation); if (!this.persist(next)) return null; this.emit(); }
    const { requestId } = operation;
    return (await this.queue(session, async () => {
      const response = await session.client.rpc("begin_weekly_challenge_attempt_v1", { p_week_id: operation.weekId, p_definition_hash: operation.definitionHash, p_request_id: requestId, p_client_session_id: operation.clientSessionId, p_expected_user_id: session.owner });
      if (!this.current(session) || response.error) return null;
      const raw = response.data as unknown;
      if (!validBeginEnvelope(raw, requestId)) { this.cache.syncState = "error"; this.emit(); return null; }
      const envelope = raw;
      const next = clone(this.cache); next.pendingCommands = next.pendingCommands.filter((item) => item.requestId !== requestId);
      if (envelope.ok && envelope.data.snapshot && next.snapshot) next.snapshot.activeAttempt = clone(envelope.data.snapshot);
      this.stampServer(next, envelope.serverNow); next.syncState = envelope.ok ? "synced" : "error"; this.persist(next); this.emit();
      return envelope;
    })) ?? null;
  }
  async control(command: "resume" | "takeover" | "terminate"): Promise<WeeklyChallengeRpcResponse<{ receipt: unknown; snapshot: WeeklyChallengeAttemptWire | null }> | null> {
    const session = this.network, attempt = this.cache.snapshot?.activeAttempt;
    if (!session || !attempt) return null;
    const existing = this.cache.pendingCommands.find((item): item is Extract<PendingCommand, { kind: "control" }> => item.kind === "control" && item.command === command);
    const operation = existing ?? { kind: "control" as const, requestId: crypto.randomUUID(), attemptId: attempt.attemptId, command, expectedRevision: attempt.revision, clientSessionId: session.clientSessionId };
    if (!existing) { const next = clone(this.cache); next.pendingCommands.push(operation); if (!this.persist(next)) return null; this.emit(); }
    const { requestId } = operation;
    return (await this.queue(session, async () => {
      const response = await session.client.rpc("control_weekly_challenge_attempt_v1", { p_attempt_id: operation.attemptId, p_command: operation.command, p_expected_revision: operation.expectedRevision, p_request_id: requestId, p_client_session_id: operation.clientSessionId, p_expected_user_id: session.owner });
      if (!this.current(session) || response.error) return null;
      const raw = response.data as unknown;
      if (!validControlEnvelope(raw, requestId, command)) { this.cache.syncState = "error"; this.emit(); return null; }
      const envelope = raw;
      const next = clone(this.cache); next.pendingCommands = next.pendingCommands.filter((item) => item.requestId !== requestId);
      if (envelope.ok && next.snapshot) next.snapshot.activeAttempt = envelope.data.snapshot ? clone(envelope.data.snapshot) : null;
      this.stampServer(next, envelope.serverNow); next.syncState = envelope.ok ? "synced" : "error"; this.persist(next); this.emit();
      return envelope;
    })) ?? null;
  }
  async append(attemptId: string, expectedRevision: number, events: readonly WeeklyChallengeEvent[]): Promise<WeeklyChallengeRpcResponse<{ receipts: WeeklyChallengeEventReceipt[]; snapshot: WeeklyChallengeAttemptWire }> | null> {
    const session = this.network;
    if (!session || events.length < 1 || events.length > 8) return null;
    const next = clone(this.cache);
    let requestedIds = new Set(events.map((event) => event.clientEventId));
    const existing = next.pending.flatMap((operation) => operation.events).filter((event) => requestedIds.has(event.clientEventId));
    if (existing.some((event) => JSON.stringify(event) !== JSON.stringify(events.find((candidate) => candidate.clientEventId === event.clientEventId)))) {
      next.syncState = "error"; this.persist(next); this.emit(); return null;
    }
    if (existing.length > 0) requestedIds = new Set(existing.map((event) => event.clientEventId));
    else {
      if (next.pending.length >= MAX_OUTBOX) { this.blocked = true; this.cache.syncState = "blocked"; this.emit(); return null; }
      next.pending.push({ attemptId, expectedRevision, clientSessionId: session.clientSessionId, events: clone([...events]) });
      if (!this.persist(next)) return null; this.emit();
    }
    return (await this.queue(session, async () => this.drain(session, requestedIds))) ?? null;
  }
  private async submitHead(session: NetworkSession): Promise<WeeklyChallengeRpcResponse<{ receipts: WeeklyChallengeEventReceipt[]; snapshot: WeeklyChallengeAttemptWire }> | null> {
      if (!this.current(session) || !this.cache.pending.length) return null;
      const operation = clone(this.cache.pending[0]);
      const response = await session.client.rpc("append_weekly_challenge_attempt_events_v1", { p_attempt_id: operation.attemptId, p_expected_revision: operation.expectedRevision, p_client_session_id: operation.clientSessionId, p_events: operation.events, p_expected_user_id: session.owner });
      if (!this.current(session) || response.error) return null;
      const envelope = response.data as unknown;
      if (!isObject(envelope) || typeof envelope.ok !== "boolean" || !iso(envelope.serverNow)) { this.cache.syncState = "error"; this.emit(); return null; }
      const data = isObject(envelope.data) ? envelope.data : null;
      const rawReceipts = envelope.ok ? data?.receipts : envelope.receipts ?? [];
      const snapshot = envelope.ok ? data?.snapshot : envelope.snapshot;
      const successShape = envelope.ok === true && exact(envelope, ["ok", "code", "serverNow", "data"]) && envelope.code === "OK" && data !== null && exact(data, ["receipts", "snapshot"]);
      const failureShape = envelope.ok === false && validFailure(envelope);
      const receiptList = Array.isArray(rawReceipts) ? rawReceipts : [];
      const receiptsValid = Array.isArray(rawReceipts) && receiptList.every((receipt) => validReceipt(receipt, operation.events)) && new Set(receiptList.map((receipt) => receipt.clientEventId)).size === receiptList.length;
      const indices = receiptsValid ? receiptList.map((receipt) => receipt.eventIndex).sort((a, b) => a - b) : [];
      const prefixValid = indices.every((index, position) => index === position);
      const failureIndexValid = envelope.ok || envelope.rejectedEventIndex === undefined ? true : envelope.rejectedEventIndex === receiptList.length;
      if ((!successShape && !failureShape) || !receiptsValid || !prefixValid || !failureIndexValid || (envelope.ok && (receiptList.length !== operation.events.length || !validAttempt(snapshot))) || (!envelope.ok && snapshot !== undefined && snapshot !== null && !validAttempt(snapshot)) || (!envelope.ok && receiptList.length > 0 && !validAttempt(snapshot))) { this.cache.syncState = "error"; this.emit(); return null; }
      const represented = new Set(receiptList.map((receipt) => receipt.clientEventId));
      const submitted = new Set(operation.events.map((event) => event.clientEventId));
      if ([...represented].some((id) => !submitted.has(id))) { this.cache.syncState = "error"; this.emit(); return null; }
      const pending = clone(this.cache.pending);
      if (pending[0]?.events[0]?.clientEventId !== operation.events[0]?.clientEventId) return null;
      const head = pending[0]; head.events = head.events.filter((event) => !represented.has(event.clientEventId));
      if (!head.events.length) pending.shift(); else if (snapshot && validAttempt(snapshot)) head.expectedRevision = snapshot.revision;
      if (snapshot && validAttempt(snapshot) && pending[0]?.attemptId === snapshot.attemptId) pending[0].expectedRevision = snapshot.revision;
      const updated = clone(this.cache); updated.pending = pending;
      if (snapshot && validAttempt(snapshot) && updated.snapshot) updated.snapshot.activeAttempt = clone(snapshot);
      this.stampServer(updated, envelope.serverNow); updated.syncState = envelope.ok ? "synced" : "error"; this.persist(updated); this.emit();
      return envelope as unknown as WeeklyChallengeRpcResponse<{ receipts: WeeklyChallengeEventReceipt[]; snapshot: WeeklyChallengeAttemptWire }>;
  }
  private async drain(session: NetworkSession, requestedIds?: ReadonlySet<string>): Promise<WeeklyChallengeRpcResponse<{ receipts: WeeklyChallengeEventReceipt[]; snapshot: WeeklyChallengeAttemptWire }> | null> {
    let callerResponse: WeeklyChallengeRpcResponse<{ receipts: WeeklyChallengeEventReceipt[]; snapshot: WeeklyChallengeAttemptWire }> | null = null;
    for (let count = 0; count < MAX_OUTBOX && this.current(session) && this.cache.pending.length; count += 1) {
      const response = await this.submitHead(session);
      if (!response) return callerResponse;
      const receipts = response.ok ? response.data.receipts : response.receipts ?? [];
      if (requestedIds && receipts.some((receipt) => requestedIds.has(receipt.clientEventId))) callerResponse = response;
      if (!response.ok) return callerResponse ?? (requestedIds ? null : response);
      if (requestedIds && [...requestedIds].every((id) => !this.cache.pending.some((operation) => operation.events.some((event) => event.clientEventId === id)))) return callerResponse;
    }
    return callerResponse;
  }
  private async flush(session = this.network): Promise<WeeklyChallengeRpcResponse<{ receipts: WeeklyChallengeEventReceipt[]; snapshot: WeeklyChallengeAttemptWire }> | null> {
    if (!session || !this.current(session) || !this.cache.pending.length) return null;
    return (await this.queue(session, async () => this.drain(session))) ?? null;
  }
  async currentLocalDefinitions(): Promise<{ current: WeeklyChallengeDefinition; previous: WeeklyChallengeDefinition }> {
    const now = new Date(this.estimatedNow());
    return { current: await createLocalWeeklyDefinition(now), previous: await createLocalWeeklyDefinition(now, -1) };
  }
  async refreshAtBoundary(): Promise<void> {
    const current = this.cache.snapshot?.currentWeek;
    if (this.network && current && this.estimatedNow() >= Date.parse(current.endsAt)) { await this.refresh(); return; }
    if (!this.network && (!this.cache.localDefinitions[0] || this.estimatedNow() >= Date.parse(this.cache.localDefinitions[0].localEndsAt))) {
      const generation = this.generation, owner = this.owner, now = new Date(this.estimatedNow());
      const localDefinition = await createFallbackPracticeDefinition(now);
      if (generation !== this.generation || owner !== this.owner) return;
      const previousDefinition = await createFallbackPracticeDefinition(now, -1);
      if (generation !== this.generation || owner !== this.owner) return;
      const next = clone(this.cache); next.localDefinitions = [localDefinition, previousDefinition];
      if (this.persist(next)) this.emit();
    }
  }
}

export const weeklyChallengeStorage = new WeeklyChallengeStorage();
