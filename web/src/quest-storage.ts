import type { SupabaseClient } from "@supabase/supabase-js";
import { applyQuestEvent, materializeQuestProgress } from "./quest-evaluator";
import { eventSupportsMetric, questDefinitionById, questDefinitionsFor } from "./quest-definitions";
import { canonicalJson, isQuestPieceType, isQuestPuzzleId, isUtcIso, makeLocalPeriods, validatePeriodRef, validateQuestEvent, type QuestAcknowledgement, type QuestEvent, type QuestPeriod, type QuestProgress, type QuestSnapshot, type QuestSubmitResponse } from "./quest-model";

const GUEST_KEY = "ca_quest_guest_v1";
const ACCOUNT_PREFIX = "ca_quest_cache_v1:";
const MAX_CACHE_BYTES = 192 * 1024;
const MAX_BATCH_BYTES = 64 * 1024;
const MAX_OUTBOX_EVENTS = 512;
const MAX_PROCESSED_EVENTS = 512;
const MAX_HISTORY_PERIODS = 8;
const MAX_STALE_OUTCOMES = 256;

export type QuestSyncState = "loading" | "synced" | "provisional" | "pending" | "offline" | "missing-server" | "auth-error" | "data-error" | "storage-error";
interface PendingPvp { event: QuestEvent; capturedAt: string }
interface ProcessedEvent { at: string }
export interface QuestStaleOutcome { eventId: string; periodId: string; reason: "period-closed"; at: string }
interface QuestCache {
  schemaVersion: 1;
  periods: QuestPeriod[];
  historyPeriods: QuestPeriod[];
  progress: QuestProgress[];
  outbox: QuestEvent[];
  pendingPvp: Record<string, PendingPvp>;
  processedEvents: Record<string, ProcessedEvent>;
  staleOutcomes: QuestStaleOutcome[];
  syncState: QuestSyncState;
  lastServerAt: string | null;
  serverOffsetMs: number | null;
}
export interface QuestStorageView extends QuestCache { owner: string | null; ready: boolean; status: string; blocked: boolean; estimatedNow: string }
interface NetworkSession { generation: number; owner: string; client: SupabaseClient; tail: Promise<void>; flushQueued: boolean }

const clone = <T>(value: T): T => structuredClone(value);
function cacheKey(owner: string | null): string { return owner ? `${ACCOUNT_PREFIX}${owner}` : GUEST_KEY; }
function isObject(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { const actual = Object.keys(value).sort(); return actual.length === keys.length && [...keys].sort().every((key, index) => actual[index] === key); }
function isMissingRpc(error: { code?: string; message?: string } | null): boolean { return Boolean(error && (error.code === "PGRST202" || error.code === "42883" || /function .* does not exist|could not find.*function/i.test(error.message ?? ""))); }
function statusText(state: QuestSyncState): string {
  switch (state) {
    case "synced": return "quest.sync_synced";
    case "provisional": return "quest.sync_guest";
    case "pending": return "quest.sync_pending";
    case "offline": return "quest.sync_offline";
    case "missing-server": return "quest.sync_missing_server";
    case "auth-error": return "quest.sync_auth_error";
    case "data-error": return "quest.sync_data_error";
    case "storage-error": return "quest.sync_storage_error";
    default: return "quest.sync_loading";
  }
}

function localPeriods(now = new Date()): QuestPeriod[] { return makeLocalPeriods(now).map((period) => ({ ...period, definitions: questDefinitionsFor(period.cadence) })); }
function freshCache(now = new Date()): QuestCache {
  const periods = localPeriods(now);
  return { schemaVersion: 1, periods, historyPeriods: [], progress: materializeQuestProgress(periods, [], now), outbox: [], pendingPvp: {}, processedEvents: {}, staleOutcomes: [], syncState: "provisional", lastServerAt: null, serverOffsetMs: null };
}
function validDefinition(value: unknown, cadence: string): boolean {
  if (!isObject(value) || !exactKeys(value, ["id", "conditionVersion", "cadence", "metric", "target"])) return false;
  const expected = typeof value.id === "string" ? questDefinitionById(value.id) : undefined;
  return !!expected && value.conditionVersion === 1 && value.cadence === cadence && value.metric === expected.metric && value.target === expected.target && expected.cadence === cadence;
}
function validPeriod(value: unknown, allowProvisional: boolean): value is QuestPeriod {
  if (!isObject(value)) return false;
  const keys = ["periodId", "cadence", "startsAt", "endsAt", "catalogueVersion", "definitions", ...(value.provisional === undefined ? [] : ["provisional"])];
  if (!exactKeys(value, keys) || !validatePeriodRef({ periodId: value.periodId, cadence: value.cadence }) || !isUtcIso(value.startsAt) || !isUtcIso(value.endsAt) || value.catalogueVersion !== 1 || !Array.isArray(value.definitions) || (!allowProvisional && value.provisional !== undefined) || (value.provisional !== undefined && value.provisional !== true)) return false;
  const expected = questDefinitionsFor(value.cadence as "daily" | "weekly");
  if (value.definitions.length !== expected.length || new Set(value.definitions.map((item) => isObject(item) ? item.id : null)).size !== expected.length || !value.definitions.every((definition) => validDefinition(definition, String(value.cadence)))) return false;
  const canonical = makeLocalPeriods(new Date(Date.parse(String(value.startsAt)) + 1)).find((period) => period.cadence === value.cadence);
  return canonical !== undefined && canonical.periodId === value.periodId && canonical.startsAt === value.startsAt && canonical.endsAt === value.endsAt;
}
function validProgress(value: unknown, periodMap: ReadonlyMap<string, QuestPeriod>): value is QuestProgress {
  if (!isObject(value) || !exactKeys(value, ["periodId", "questId", "conditionVersion", "status", "progress", "completedAt", "updatedAt"]) || typeof value.periodId !== "string" || typeof value.questId !== "string" || value.conditionVersion !== 1 || !["in-progress", "completed", "expired"].includes(String(value.status)) || !(value.completedAt === null || isUtcIso(value.completedAt)) || !isUtcIso(value.updatedAt) || !isObject(value.progress)) return false;
  const definition = questDefinitionById(value.questId), period = periodMap.get(value.periodId); if (!definition || !period || definition.cadence !== period.cadence) return false;
  if (value.status === "completed" ? !isUtcIso(value.completedAt) : value.completedAt !== null) return false;
  const within = (at: unknown) => isUtcIso(at) && Date.parse(at) >= Date.parse(period.startsAt) && Date.parse(at) < Date.parse(period.endsAt);
  if (!within(value.updatedAt)) return false;
  const progress = value.progress;
  let count = 0;
  if (progress.kind === "count") {
    if (!["wins", "puzzle-clears"].includes(definition.metric)) return false;
    if (!exactKeys(progress, ["kind", "count", "eventIds"]) || !Number.isInteger(progress.count) || Number(progress.count) < 0 || Number(progress.count) > definition.target || !isObject(progress.eventIds)) return false;
    const entries = Object.entries(progress.eventIds); count = entries.length;
    if (entries.length !== progress.count || entries.length > definition.target || !entries.every(([id, item]) => id.length > 0 && id.length <= 160 && isObject(item) && exactKeys(item, ["at"]) && within(item.at))) return false;
  } else {
    if (!["piece-types", "distinct-puzzles", "distinct-gold-puzzles"].includes(definition.metric)) return false;
    if (progress.kind !== "distinct" || !exactKeys(progress, ["kind", "targetIds"]) || !isObject(progress.targetIds)) return false;
    const targets = Object.entries(progress.targetIds); count = targets.length; if (targets.length > definition.target) return false;
    if (!targets.every(([id, item]) => {
      if (!isObject(item) || typeof item.eventId !== "string" || item.eventId.length === 0 || item.eventId.length > 160 || !within(item.at)) return false;
      if (definition.metric === "piece-types") return exactKeys(item, ["eventId", "at"]) && isQuestPieceType(id);
      return exactKeys(item, ["eventId", "at", "puzzleRevision"]) && isQuestPuzzleId(id) && Number.isInteger(item.puzzleRevision) && Number(item.puzzleRevision) > 0;
    })) return false;
  }
  return value.status === "completed" ? count === definition.target && within(value.completedAt) : count < definition.target;
}
function validProgressSet(progress: unknown[], periods: QuestPeriod[], requireActive: boolean): progress is QuestProgress[] {
  const map = new Map(periods.map((period) => [period.periodId, period]));
  if (!progress.every((item) => validProgress(item, map))) return false;
  const keys = progress.map((item) => `${(item as QuestProgress).periodId}|${(item as QuestProgress).questId}|${(item as QuestProgress).conditionVersion}`);
  if (new Set(keys).size !== keys.length) return false;
  return !requireActive || progress.every((item) => map.has((item as QuestProgress).periodId));
}
function validPendingPvp(value: unknown): value is Record<string, PendingPvp> {
  return isObject(value) && Object.keys(value).length <= 64 && Object.entries(value).every(([matchId, entry]) => isObject(entry) && exactKeys(entry, ["event", "capturedAt"]) && validateQuestEvent(entry.event) && entry.event.kind === "pvp-win" && entry.event.identity.matchId === matchId && isUtcIso(entry.capturedAt));
}
function validCurrentCache(value: unknown): value is QuestCache {
  if (!isObject(value) || !exactKeys(value, ["schemaVersion", "periods", "historyPeriods", "progress", "outbox", "pendingPvp", "processedEvents", "staleOutcomes", "syncState", "lastServerAt", "serverOffsetMs"]) || value.schemaVersion !== 1 || !Array.isArray(value.periods) || !Array.isArray(value.historyPeriods) || !Array.isArray(value.progress) || !Array.isArray(value.outbox) || !validPendingPvp(value.pendingPvp) || !isObject(value.processedEvents) || !Array.isArray(value.staleOutcomes) || typeof value.syncState !== "string" || !(value.lastServerAt === null || isUtcIso(value.lastServerAt)) || !(value.serverOffsetMs === null || Number.isSafeInteger(value.serverOffsetMs))) return false;
  const allPeriods = [...value.periods, ...value.historyPeriods] as QuestPeriod[];
  if (value.periods.length !== 2 || value.historyPeriods.length > MAX_HISTORY_PERIODS || !allPeriods.every((period) => validPeriod(period, true)) || new Set(value.periods.map((period) => (period as QuestPeriod).cadence)).size !== 2 || new Set(allPeriods.map((period) => period.periodId)).size !== allPeriods.length || !validProgressSet(value.progress, allPeriods, false) || !value.outbox.every(validateQuestEvent) || value.outbox.length > MAX_OUTBOX_EVENTS || !["loading", "synced", "provisional", "pending", "offline", "missing-server", "auth-error", "data-error", "storage-error"].includes(value.syncState as string)) return false;
  const progressKeys = new Set(value.progress.map((item) => `${(item as QuestProgress).periodId}|${(item as QuestProgress).questId}|1`));
  if (!(value.periods as QuestPeriod[]).every((period) => period.definitions.every((definition) => progressKeys.has(`${period.periodId}|${definition.id}|1`)))) return false;
  const outboxIds = value.outbox.map((event) => event.eventId); if (new Set(outboxIds).size !== outboxIds.length) return false;
  if (Object.keys(value.processedEvents).length > MAX_PROCESSED_EVENTS || !Object.entries(value.processedEvents).every(([id, item]) => id.length > 0 && id.length <= 160 && isObject(item) && exactKeys(item, ["at"]) && isUtcIso(item.at))) return false;
  return value.staleOutcomes.length <= MAX_STALE_OUTCOMES && value.staleOutcomes.every((item) => isObject(item) && exactKeys(item, ["eventId", "periodId", "reason", "at"]) && typeof item.eventId === "string" && item.eventId.length > 0 && item.eventId.length <= 160 && typeof item.periodId === "string" && item.reason === "period-closed" && isUtcIso(item.at));
}
function upgradeLegacyCache(value: unknown): QuestCache | null {
  if (!isObject(value) || !exactKeys(value, ["schemaVersion", "periods", "progress", "outbox", "pendingPvp", "staleEventIds", "syncState", "lastServerAt"]) || value.schemaVersion !== 1 || !Array.isArray(value.periods) || !Array.isArray(value.progress) || !Array.isArray(value.outbox) || !Array.isArray(value.staleEventIds) || value.staleEventIds.some((id) => typeof id !== "string" || id.length === 0 || id.length > 160) || !validPendingPvp(value.pendingPvp)) return null;
  const periods = value.periods as QuestPeriod[];
  if (periods.length !== 2 || !periods.every((period) => validPeriod(period, true)) || !validProgressSet(value.progress, periods, false) || !value.outbox.every(validateQuestEvent) || value.outbox.length > MAX_OUTBOX_EVENTS || typeof value.syncState !== "string" || !(value.lastServerAt === null || isUtcIso(value.lastServerAt))) return null;
  const progressKeys = new Set((value.progress as QuestProgress[]).map((item) => `${item.periodId}|${item.questId}|1`));
  if (!periods.every((period) => period.definitions.every((definition) => progressKeys.has(`${period.periodId}|${definition.id}|1`)))) return null;
  return { schemaVersion: 1, periods: clone(periods), historyPeriods: [], progress: clone(value.progress as QuestProgress[]), outbox: clone(value.outbox as QuestEvent[]), pendingPvp: clone(value.pendingPvp), processedEvents: {}, staleOutcomes: [], syncState: value.syncState as QuestSyncState, lastServerAt: value.lastServerAt as string | null, serverOffsetMs: null };
}
function validSnapshot(value: unknown): value is QuestSnapshot {
  if (!isObject(value) || !exactKeys(value, ["schemaVersion", "serverNow", "periods", "progress"]) || value.schemaVersion !== 1 || !isUtcIso(value.serverNow) || !Array.isArray(value.periods) || value.periods.length !== 2 || !value.periods.every((period) => validPeriod(period, false)) || new Set(value.periods.map((period) => (period as QuestPeriod).cadence)).size !== 2 || !Array.isArray(value.progress)) return false;
  const now = Date.parse(value.serverNow);
  const expectedKeys = (value.periods as QuestPeriod[]).flatMap((period) => period.definitions.map((definition) => `${period.periodId}|${definition.id}|1`)).sort();
  const actualKeys = value.progress.map((item) => isObject(item) ? `${item.periodId}|${item.questId}|${item.conditionVersion}` : "").sort();
  return value.periods.every((period) => now >= Date.parse((period as QuestPeriod).startsAt) && now < Date.parse((period as QuestPeriod).endsAt)) && actualKeys.join("\n") === expectedKeys.join("\n") && validProgressSet(value.progress, value.periods as QuestPeriod[], true) && value.progress.every((item) => (item as QuestProgress).status !== "expired");
}
function validAcknowledgement(value: unknown, event: QuestEvent): value is QuestAcknowledgement {
  if (!isObject(value) || !exactKeys(value, ["eventId", "disposition", "duplicate", "periods"]) || value.eventId !== event.eventId || !["accepted", "stale"].includes(String(value.disposition)) || typeof value.duplicate !== "boolean" || !Array.isArray(value.periods) || value.periods.length !== event.requestedPeriods.length) return false;
  const requests = new Map(event.requestedPeriods.map((request) => [request.periodId, request]));
  if (new Set(value.periods.map((item) => isObject(item) ? item.periodId : null)).size !== value.periods.length) return false;
  let applied = false;
  for (const raw of value.periods) {
    if (!isObject(raw) || !exactKeys(raw, ["periodId", "disposition", "appliedQuestIds", "reason"]) || typeof raw.periodId !== "string" || !requests.has(raw.periodId) || !["applied", "stale"].includes(String(raw.disposition)) || !Array.isArray(raw.appliedQuestIds) || new Set(raw.appliedQuestIds).size !== raw.appliedQuestIds.length || raw.appliedQuestIds.some((id) => typeof id !== "string")) return false;
    const request = requests.get(raw.periodId)!;
    if (raw.appliedQuestIds.some((id) => { const definition = questDefinitionById(id as string); const medal = event.kind === "puzzle-clear" ? event.payload.medal : undefined; return !definition || definition.cadence !== request.cadence || !eventSupportsMetric(event.kind, definition.metric, medal); })) return false;
    if (raw.disposition === "applied") {
      const medal = event.kind === "puzzle-clear" ? event.payload.medal : undefined;
      const expectedIds = questDefinitionsFor(request.cadence).filter((definition) => eventSupportsMetric(event.kind, definition.metric, medal)).map((definition) => definition.id).sort();
      if (raw.reason !== null || [...raw.appliedQuestIds].sort().join("\n") !== expectedIds.join("\n")) return false;
      applied = true;
    }
    else if (raw.reason !== "period-closed" || raw.appliedQuestIds.length !== 0) return false;
  }
  return value.disposition === (applied ? "accepted" : "stale");
}
function validSubmitResponse(value: unknown, batch: readonly QuestEvent[]): value is QuestSubmitResponse {
  if (!isObject(value) || !exactKeys(value, ["schemaVersion", "serverNow", "periods", "progress", "acknowledgements"]) || !Array.isArray(value.acknowledgements)) return false;
  const snapshot = { schemaVersion: value.schemaVersion, serverNow: value.serverNow, periods: value.periods, progress: value.progress };
  if (!validSnapshot(snapshot) || value.acknowledgements.length !== batch.length) return false;
  const byId = new Map(batch.map((event) => [event.eventId, event]));
  if (new Set(value.acknowledgements.map((ack) => isObject(ack) ? ack.eventId : null)).size !== batch.length) return false;
  return value.acknowledgements.every((ack) => isObject(ack) && typeof ack.eventId === "string" && byId.has(ack.eventId) && validAcknowledgement(ack, byId.get(ack.eventId)!));
}

export class QuestStorage {
  owner: string | null = null;
  ready = false;
  private client: SupabaseClient | null = null;
  private cache: QuestCache = freshCache();
  private generation = 0;
  private blocked = false;
  private retryTimer: number | null = null;
  private boundaryTimer: number | null = null;
  private retryAttempt = 0;
  private listeners = new Set<() => void>();
  private network: NetworkSession | null = null;

  get statusKey(): string { return statusText(this.cache.syncState); }
  get syncState(): QuestSyncState { return this.cache.syncState; }
  get isBlocked(): boolean { return this.blocked; }
  estimatedNow(): Date { return new Date(Date.now() + (this.cache.serverOffsetMs ?? 0)); }
  view(): QuestStorageView { return { ...clone(this.cache), owner: this.owner, ready: this.ready, status: this.statusKey, blocked: this.blocked, estimatedNow: this.estimatedNow().toISOString() }; }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private emit(): void { for (const listener of this.listeners) listener(); }
  private clearTimers(): void { if (this.retryTimer !== null) window.clearTimeout(this.retryTimer); if (this.boundaryTimer !== null) window.clearTimeout(this.boundaryTimer); this.retryTimer = null; this.boundaryTimer = null; }

  suspend(): void {
    this.generation += 1; this.ready = false; this.client = null; this.network = null; this.clearTimers(); this.retryAttempt = 0; this.emit();
  }

  async activate(client: SupabaseClient | null, owner: string | null): Promise<void> {
    const generation = ++this.generation;
    this.owner = owner; this.client = client; this.network = owner && client ? { generation, owner, client, tail: Promise.resolve(), flushQueued: false } : null;
    this.ready = false; this.blocked = false; this.clearTimers();
    const raw = localStorage.getItem(cacheKey(owner));
    if (raw !== null) {
      try {
        const parsed: unknown = JSON.parse(raw), upgraded = validCurrentCache(parsed) ? parsed : upgradeLegacyCache(parsed);
        if (!upgraded) throw new Error("invalid cache");
        this.cache = upgraded;
      } catch {
        this.cache = freshCache(); this.cache.syncState = "data-error"; this.blocked = true; this.ready = true; this.emit(); return;
      }
    } else this.cache = freshCache();
    if (owner === null || client === null) {
      if (owner === null && this.cache.outbox.length) {
        for (const event of this.cache.outbox) this.cache.processedEvents[event.eventId] = { at: event.occurredAtClient };
        this.cache.processedEvents = this.trimProcessed(this.cache.processedEvents);
        this.cache.outbox = [];
      }
      this.cache.syncState = owner === null ? "provisional" : "offline"; this.rollLocalPeriods(this.estimatedNow()); this.persistCurrent(); this.ready = true; this.scheduleBoundary(); this.emit(); return;
    }
    await this.refreshServer(generation);
  }

  private rollLocalPeriods(now = this.estimatedNow()): void {
    const periods = localPeriods(now), activeIds = new Set(periods.map((period) => period.periodId));
    const historical = [...this.cache.historyPeriods, ...this.cache.periods.filter((period) => !activeIds.has(period.periodId))]
      .filter((period, index, all) => all.findIndex((item) => item.periodId === period.periodId) === index)
      .sort((a, b) => Date.parse(b.endsAt) - Date.parse(a.endsAt)).slice(0, MAX_HISTORY_PERIODS);
    const retainedIds = new Set([...periods, ...historical].map((period) => period.periodId));
    const retained = this.cache.progress.filter((item) => retainedIds.has(item.periodId)).map((item) => activeIds.has(item.periodId) || item.status === "completed" ? item : { ...item, status: "expired" as const });
    this.cache.historyPeriods = historical; this.cache.periods = periods; this.cache.progress = materializeQuestProgress(periods, retained, now);
  }
  private trimProcessed(processed: Record<string, ProcessedEvent>): Record<string, ProcessedEvent> {
    return Object.fromEntries(Object.entries(processed).sort((a, b) => a[1].at.localeCompare(b[1].at) || a[0].localeCompare(b[0])).slice(-MAX_PROCESSED_EVENTS));
  }
  private commit(next: QuestCache): boolean {
    if (this.blocked || !validCurrentCache(next)) return false;
    const json = JSON.stringify(next);
    if (new TextEncoder().encode(json).length > MAX_CACHE_BYTES) { this.cache.syncState = "storage-error"; this.blocked = true; this.emit(); return false; }
    try { localStorage.setItem(cacheKey(this.owner), json); this.cache = next; return true; }
    catch { this.cache.syncState = "storage-error"; this.blocked = true; this.emit(); return false; }
  }
  private persistCurrent(): boolean { return this.commit(clone(this.cache)); }
  private setRecoverableError(state: QuestSyncState, block = false): void {
    const next = clone(this.cache); next.syncState = state;
    if (this.commit(next)) { this.blocked = block; this.emit(); }
  }
  private applySnapshotTo(next: QuestCache, snapshot: QuestSnapshot, requestStartedAt: number, receivedAt: number): void {
    const active = new Set(snapshot.periods.map((period) => period.periodId));
    next.historyPeriods = [...next.historyPeriods, ...next.periods.filter((period) => !active.has(period.periodId))]
      .filter((period, index, all) => all.findIndex((item) => item.periodId === period.periodId) === index)
      .sort((a, b) => Date.parse(b.endsAt) - Date.parse(a.endsAt)).slice(0, MAX_HISTORY_PERIODS);
    const historyIds = new Set(next.historyPeriods.map((period) => period.periodId));
    const historyProgress = next.progress.filter((item) => historyIds.has(item.periodId)).map((item) => item.status === "completed" ? item : { ...item, status: "expired" as const });
    next.periods = clone(snapshot.periods);
    let progress = [...historyProgress, ...clone(snapshot.progress)];
    for (const event of next.outbox) progress = applyQuestEvent(progress, next.periods, event, new Date(snapshot.serverNow));
    next.progress = materializeQuestProgress(next.periods, progress, new Date(snapshot.serverNow));
    next.lastServerAt = snapshot.serverNow; next.serverOffsetMs = Math.round(Date.parse(snapshot.serverNow) - ((requestStartedAt + receivedAt) / 2));
  }
  private queueNetwork(session: NetworkSession, operation: () => Promise<void>): Promise<void> {
    const task = session.tail.then(async () => { if (this.network !== session || session.generation !== this.generation || session.owner !== this.owner) return; await operation(); });
    session.tail = task.catch(() => undefined); return task;
  }

  private async refreshServer(generation: number): Promise<void> {
    const session = this.network; if (!session || session.generation !== generation || this.blocked) return;
    await this.queueNetwork(session, async () => {
      const started = Date.now(), response = await session.client.rpc("get_quest_snapshot_v1", { p_expected_user_id: session.owner }), received = Date.now();
      if (this.network !== session || generation !== this.generation || session.owner !== this.owner) return;
      if (response.error) {
        const next = clone(this.cache); next.syncState = isMissingRpc(response.error) ? "missing-server" : response.error.code === "42501" ? "auth-error" : "offline";
        this.cache = next; this.rollLocalPeriods(this.estimatedNow()); this.ready = true; this.persistCurrent(); this.scheduleBoundary(); this.emit(); this.scheduleRetry(); return;
      }
      if (!validSnapshot(response.data)) { this.ready = true; this.setRecoverableError("data-error", true); return; }
      const next = clone(this.cache); this.applySnapshotTo(next, response.data, started, received); next.syncState = next.outbox.length ? "pending" : "synced";
      if (!this.commit(next)) return;
      this.retryAttempt = 0; this.ready = true; this.scheduleBoundary(); this.emit();
    });
    if (this.network === session && this.cache.outbox.length) await this.flush();
  }

  captureContext(): { periods: QuestPeriod[]; occurredAt: string } | null {
    if (!this.ready || this.blocked) return null;
    const now = this.estimatedNow();
    if (this.cache.periods.some((period) => now.getTime() < Date.parse(period.startsAt) || now.getTime() >= Date.parse(period.endsAt))) {
      const before = clone(this.cache); this.rollLocalPeriods(now);
      if (!this.persistCurrent()) { this.cache = before; return null; }
      this.scheduleBoundary(); this.emit(); if (this.owner && this.client) void this.retry();
    }
    return { periods: clone(this.cache.periods), occurredAt: now.toISOString() };
  }

  enqueue(event: QuestEvent): boolean {
    if (!this.ready || this.blocked || !validateQuestEvent(event)) return false;
    if (this.cache.processedEvents[event.eventId]) return true;
    const duplicate = this.cache.outbox.find((item) => item.eventId === event.eventId);
    if (duplicate) return canonicalJson(duplicate) === canonicalJson(event);
    const next = clone(this.cache);
    if (this.owner !== null) {
      if (next.outbox.length >= MAX_OUTBOX_EVENTS) { this.setRecoverableError("storage-error", true); return false; }
      next.outbox.push(clone(event));
    } else next.processedEvents[event.eventId] = { at: event.occurredAtClient };
    next.processedEvents = this.trimProcessed(next.processedEvents);
    next.progress = applyQuestEvent(next.progress, next.periods, event, new Date(event.occurredAtClient));
    next.syncState = this.owner === null ? "provisional" : this.client ? "pending" : "offline";
    if (!this.commit(next)) return false;
    this.emit(); if (this.owner && this.client) void this.flush(); return true;
  }

  capturePendingPvp(event: QuestEvent): boolean {
    if (event.kind !== "pvp-win" || !this.ready || this.blocked) return false;
    const matchId = event.identity.matchId;
    if (this.cache.processedEvents[event.eventId] || this.cache.outbox.some((item) => item.eventId === event.eventId) || this.cache.pendingPvp[matchId]) return true;
    if (Object.keys(this.cache.pendingPvp).length >= 64) { this.setRecoverableError("storage-error", true); return false; }
    const next = clone(this.cache); next.pendingPvp[matchId] = { event: clone(event), capturedAt: event.occurredAtClient };
    if (!this.commit(next)) return false; this.emit(); return true;
  }
  confirmPendingPvp(matchId: string): boolean {
    const pending = this.cache.pendingPvp[matchId];
    if (!pending) return this.cache.processedEvents[`quest:pvp-win:${matchId}`] !== undefined;
    const before = clone(this.cache), next = clone(this.cache); delete next.pendingPvp[matchId]; this.cache = next;
    if (!this.enqueue(pending.event)) { this.cache = before; return false; }
    return true;
  }
  discardPendingPvp(matchId: string): void { if (this.cache.pendingPvp[matchId]) { const next = clone(this.cache); delete next.pendingPvp[matchId]; if (this.commit(next)) this.emit(); } }

  async flush(): Promise<void> {
    const session = this.network; if (!session || session.flushQueued || this.blocked || !this.ready || this.cache.outbox.length === 0) return;
    session.flushQueued = true;
    await this.queueNetwork(session, async () => {
      try {
        while (this.network === session && session.generation === this.generation && session.owner === this.owner && this.cache.outbox.length) {
          const batch: QuestEvent[] = [];
          for (const event of this.cache.outbox.slice(0, 32)) { const candidate = [...batch, event]; if (new TextEncoder().encode(JSON.stringify(candidate)).length > MAX_BATCH_BYTES) break; batch.push(clone(event)); }
          if (batch.length === 0) { this.setRecoverableError("storage-error", true); return; }
          const started = Date.now(), response = await session.client.rpc("submit_quest_events_v1", { p_events: batch, p_expected_user_id: session.owner }), received = Date.now();
          if (this.network !== session || session.generation !== this.generation || session.owner !== this.owner) return;
          if (response.error) {
            const state = isMissingRpc(response.error) ? "missing-server" : response.error.code === "42501" ? "auth-error" : response.error.code === "22023" ? "data-error" : "offline";
            this.setRecoverableError(state, response.error.code === "22023"); this.scheduleRetry(); return;
          }
          if (!validSubmitResponse(response.data, batch)) { this.setRecoverableError("data-error", true); return; }
          const data = response.data as QuestSubmitResponse, batchIds = new Set(batch.map((event) => event.eventId)), next = clone(this.cache);
          next.outbox = next.outbox.filter((event) => !batchIds.has(event.eventId));
          for (const ack of data.acknowledgements) {
            next.processedEvents[ack.eventId] = { at: data.serverNow };
            for (const period of ack.periods) if (period.disposition === "stale") next.staleOutcomes.push({ eventId: ack.eventId, periodId: period.periodId, reason: "period-closed", at: data.serverNow });
          }
          next.processedEvents = this.trimProcessed(next.processedEvents);
          next.staleOutcomes = next.staleOutcomes.filter((item, index, all) => all.findIndex((other) => other.eventId === item.eventId && other.periodId === item.periodId) === index).slice(-MAX_STALE_OUTCOMES);
          this.applySnapshotTo(next, data, started, received); next.syncState = next.outbox.length ? "pending" : "synced";
          if (!this.commit(next)) return; this.emit();
        }
      } finally { if (this.network === session) session.flushQueued = false; }
    });
  }

  async retry(): Promise<void> {
    if (this.blocked) return;
    this.retryAttempt = 0;
    if (this.owner && this.client) { await this.refreshServer(this.generation); return; }
    this.rollLocalPeriods(this.estimatedNow()); this.persistCurrent(); this.scheduleBoundary(); this.emit();
  }
  private scheduleRetry(): void {
    if (this.retryTimer !== null || this.blocked || this.retryAttempt >= 5) return;
    const generation = this.generation, delay = Math.min(300000, 30000 * 2 ** this.retryAttempt++);
    this.retryTimer = window.setTimeout(() => { this.retryTimer = null; if (generation === this.generation) void this.retry(); }, delay);
  }
  private scheduleBoundary(): void {
    if (this.boundaryTimer !== null) window.clearTimeout(this.boundaryTimer);
    const now = this.estimatedNow().getTime(), nextEnd = Math.min(...this.cache.periods.map((period) => Date.parse(period.endsAt))), delay = Math.max(1000, Math.min(2147483647, nextEnd - now + 50)), generation = this.generation;
    this.boundaryTimer = window.setTimeout(() => { this.boundaryTimer = null; if (generation === this.generation) void this.retry(); }, delay);
  }
}

export const questStorage = new QuestStorage();
