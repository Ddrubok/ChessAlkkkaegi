export const QUEST_SCHEMA_VERSION = 1 as const;
export const QUEST_CATALOGUE_VERSION = 1 as const;
export const QUEST_PIECE_TYPES = ["Pawn", "Knight", "Bishop", "Rook", "Queen", "King"] as const;
export const QUEST_PUZZLE_IDS = ["P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08", "P09", "P10", "P11", "P12"] as const;

export type QuestCadence = "daily" | "weekly";
export type QuestMetric = "wins" | "puzzle-clears" | "piece-types" | "distinct-puzzles" | "distinct-gold-puzzles";
export type QuestPieceType = typeof QUEST_PIECE_TYPES[number];
export type QuestPuzzleId = typeof QUEST_PUZZLE_IDS[number];

export interface QuestDefinition {
  id: string;
  conditionVersion: 1;
  cadence: QuestCadence;
  metric: QuestMetric;
  target: number;
}

export interface QuestPeriodRef { periodId: string; cadence: QuestCadence }
export interface QuestPeriod extends QuestPeriodRef {
  startsAt: string;
  endsAt: string;
  catalogueVersion: 1;
  definitions: QuestDefinition[];
  provisional?: boolean;
}

interface QuestEventBase {
  schemaVersion: 1;
  eventId: string;
  requestedPeriods: QuestPeriodRef[];
  occurredAtClient: string;
}
export type QuestEvent =
  | (QuestEventBase & { kind: "pve-win"; source: "stage"; identity: { runId: string; stageNumber: number; resultIndex: 1 }; payload: Record<string, never> })
  | (QuestEventBase & { kind: "pvp-win"; source: "online"; identity: { matchId: string }; payload: Record<string, never> })
  | (QuestEventBase & { kind: "puzzle-clear"; source: "puzzle"; identity: { attemptId: string }; payload: { puzzleId: QuestPuzzleId; puzzleRevision: number; medal: 1 | 2 | 3 } })
  | (QuestEventBase & { kind: "piece-launch"; source: "online"; identity: { matchId: string; turnIndex: number }; payload: { pieceType: QuestPieceType } })
  | (QuestEventBase & { kind: "piece-launch"; source: "stage" | "tutorial" | "puzzle"; identity: { runId: string; launchOrdinal: number }; payload: { pieceType: QuestPieceType } });

export interface QuestProgress {
  periodId: string;
  questId: string;
  conditionVersion: 1;
  status: "in-progress" | "completed" | "expired";
  progress: {
    kind: "count" | "distinct";
    count?: number;
    eventIds?: Record<string, { at: string }>;
    targetIds?: Record<string, { eventId: string; at: string; puzzleRevision?: number }>;
  };
  completedAt: string | null;
  updatedAt: string;
}

export interface QuestAcknowledgement {
  eventId: string;
  disposition: "accepted" | "stale" | "rejected";
  duplicate: boolean;
  periods: Array<{ periodId: string; disposition: "applied" | "stale"; appliedQuestIds: string[]; reason: "period-closed" | null }>;
}
export interface QuestSnapshot {
  schemaVersion: 1;
  serverNow: string;
  periods: QuestPeriod[];
  progress: QuestProgress[];
}
export interface QuestSubmitResponse extends QuestSnapshot { acknowledgements: QuestAcknowledgement[] }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MATCH_ID_RE = /^[A-Za-z0-9-]{8,128}$/u;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const PERIOD_RE = /^(daily|weekly):(\d{4}-\d{2}-\d{2})@05:00:Asia\/Seoul$/u;

export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID_RE.test(value);
export const isMatchId = (value: unknown): value is string => typeof value === "string" && MATCH_ID_RE.test(value);
export const isUtcIso = (value: unknown): value is string => typeof value === "string" && ISO_RE.test(value) && Number.isFinite(Date.parse(value));
export const isQuestPieceType = (value: unknown): value is QuestPieceType => typeof value === "string" && (QUEST_PIECE_TYPES as readonly string[]).includes(value);
export const isQuestPuzzleId = (value: unknown): value is QuestPuzzleId => typeof value === "string" && (QUEST_PUZZLE_IDS as readonly string[]).includes(value);

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && [...keys].sort().every((key, index) => actual[index] === key);
}
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function positiveInteger(value: unknown): value is number { return Number.isInteger(value) && Number(value) > 0; }

export function validatePeriodRef(value: unknown): value is QuestPeriodRef {
  if (!record(value) || !exactKeys(value, ["periodId", "cadence"]) || (value.cadence !== "daily" && value.cadence !== "weekly") || typeof value.periodId !== "string") return false;
  const match = PERIOD_RE.exec(value.periodId);
  if (match === null || match[1] !== value.cadence) return false;
  const [year, month, day] = match[2].split("-").map(Number), date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day && (value.cadence !== "weekly" || date.getUTCDay() === 1);
}

export function questPeriodBounds(period: QuestPeriodRef): { startsAt: number; endsAt: number } | null {
  if (!validatePeriodRef(period)) return null;
  const match = PERIOD_RE.exec(period.periodId)!;
  const [year, month, day] = match[2].split("-").map(Number), startsAt = Date.UTC(year, month - 1, day, 5) - 9 * 60 * 60 * 1000;
  return { startsAt, endsAt: startsAt + (period.cadence === "daily" ? 1 : 7) * 86400000 };
}

export function validateQuestEvent(value: unknown): value is QuestEvent {
  if (!record(value) || !exactKeys(value, ["schemaVersion", "eventId", "kind", "source", "requestedPeriods", "occurredAtClient", "identity", "payload"])) return false;
  if (value.schemaVersion !== 1 || typeof value.eventId !== "string" || value.eventId.length === 0 || value.eventId.length > 160 || !isUtcIso(value.occurredAtClient)) return false;
  if (!Array.isArray(value.requestedPeriods) || value.requestedPeriods.length < 1 || value.requestedPeriods.length > 2 || !value.requestedPeriods.every(validatePeriodRef)) return false;
  if (new Set(value.requestedPeriods.map((item) => item.cadence)).size !== value.requestedPeriods.length || !record(value.identity) || !record(value.payload)) return false;
  const occurredAt = Date.parse(value.occurredAtClient as string);
  if (!value.requestedPeriods.every((period) => { const bounds = questPeriodBounds(period); return bounds !== null && occurredAt >= bounds.startsAt && occurredAt < bounds.endsAt; })) return false;
  if (new TextEncoder().encode(canonicalJson(value.payload)).length > 2048) return false;
  if (value.kind === "pve-win" && value.source === "stage") {
    return exactKeys(value.identity, ["runId", "stageNumber", "resultIndex"]) && exactKeys(value.payload, []) && isUuid(value.identity.runId) && positiveInteger(value.identity.stageNumber) && Number(value.identity.stageNumber) <= 10 && value.identity.resultIndex === 1 && value.eventId === `quest:pve-win:${value.identity.runId}:stage:${value.identity.stageNumber}:1`;
  }
  if (value.kind === "pvp-win" && value.source === "online") {
    return exactKeys(value.identity, ["matchId"]) && exactKeys(value.payload, []) && isMatchId(value.identity.matchId) && value.eventId === `quest:pvp-win:${value.identity.matchId}`;
  }
  if (value.kind === "puzzle-clear" && value.source === "puzzle") {
    return exactKeys(value.identity, ["attemptId"]) && exactKeys(value.payload, ["puzzleId", "puzzleRevision", "medal"]) && isUuid(value.identity.attemptId) && isQuestPuzzleId(value.payload.puzzleId) && positiveInteger(value.payload.puzzleRevision) && Number.isInteger(value.payload.medal) && [1, 2, 3].includes(value.payload.medal as number) && value.eventId === `quest:puzzle:${value.identity.attemptId}:terminal`;
  }
  if (value.kind !== "piece-launch" || !exactKeys(value.payload, ["pieceType"]) || !isQuestPieceType(value.payload.pieceType)) return false;
  if (value.source === "online") return exactKeys(value.identity, ["matchId", "turnIndex"]) && isMatchId(value.identity.matchId) && Number.isInteger(value.identity.turnIndex) && Number(value.identity.turnIndex) >= 0 && Number(value.identity.turnIndex) <= 2147483647 && value.eventId === `quest:online-launch:${value.identity.matchId}:${value.identity.turnIndex}`;
  return ["stage", "tutorial", "puzzle"].includes(String(value.source)) && exactKeys(value.identity, ["runId", "launchOrdinal"]) && isUuid(value.identity.runId) && positiveInteger(value.identity.launchOrdinal) && value.eventId === `quest:launch:${value.identity.runId}:${value.identity.launchOrdinal}`;
}

export function makeLocalPeriods(now = new Date()): QuestPeriod[] {
  const shifted = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  if (shifted.getUTCHours() < 5) shifted.setUTCDate(shifted.getUTCDate() - 1);
  const dailyDate = shifted.toISOString().slice(0, 10);
  const monday = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
  const weekday = monday.getUTCDay();
  monday.setUTCDate(monday.getUTCDate() - (weekday === 0 ? 6 : weekday - 1));
  const weeklyDate = monday.toISOString().slice(0, 10);
  const build = (cadence: QuestCadence, dateText: string, days: number): QuestPeriod => {
    const [year, month, day] = dateText.split("-").map(Number);
    const startsAtMs = Date.UTC(year, month - 1, day, 5) - 9 * 60 * 60 * 1000;
    return { periodId: `${cadence}:${dateText}@05:00:Asia/Seoul`, cadence, startsAt: new Date(startsAtMs).toISOString(), endsAt: new Date(startsAtMs + days * 86400000).toISOString(), catalogueVersion: 1, definitions: [], provisional: true };
  };
  return [build("daily", dailyDate, 1), build("weekly", weeklyDate, 7)];
}
