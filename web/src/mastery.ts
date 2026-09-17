import type { PieceType } from "./config";
import type { PuzzleProgressStore } from "./puzzle";

export const MASTERY_PROGRESS_KEY = "ca_mastery_progress_v1";
export const MASTERY_REWARDS_KEY = "ca_mastery_rewards_v1";
export const MASTERY_PREFERENCES_KEY = "ca_mastery_preferences_v1";
export const MASTERY_KEYS = [MASTERY_PROGRESS_KEY, MASTERY_REWARDS_KEY, MASTERY_PREFERENCES_KEY] as const;

export const MASTERY_IDS = ["M01", "M02", "M03", "M04", "M05", "M06", "M07", "M08"] as const;
export type MasteryId = typeof MASTERY_IDS[number];
export type MasteryCategory = "experience" | "skill";
export type EquipmentSlot = "badge" | "title" | "frame" | "banner";

export interface MasteryDefinition {
  id: MasteryId;
  category: MasteryCategory;
  threshold: number;
  eligibleModes: readonly ("stage" | "tutorial" | "puzzle")[];
  route: "stage" | "tutorial" | "puzzle";
}

export const MASTERY_DEFINITIONS: readonly MasteryDefinition[] = [
  { id: "M01", category: "experience", threshold: 1, eligibleModes: ["stage"], route: "stage" },
  { id: "M02", category: "experience", threshold: 6, eligibleModes: ["stage", "tutorial", "puzzle"], route: "tutorial" },
  { id: "M03", category: "experience", threshold: 3, eligibleModes: ["puzzle"], route: "puzzle" },
  { id: "M04", category: "skill", threshold: 3, eligibleModes: ["puzzle"], route: "puzzle" },
  { id: "M05", category: "experience", threshold: 5, eligibleModes: ["stage"], route: "stage" },
  { id: "M06", category: "skill", threshold: 2, eligibleModes: ["stage", "puzzle"], route: "puzzle" },
  { id: "M07", category: "skill", threshold: 1, eligibleModes: ["stage"], route: "stage" },
  { id: "M08", category: "experience", threshold: 3, eligibleModes: ["stage"], route: "stage" },
];

export const STAGE_TEMPLATE_IDS: Readonly<Record<number, string>> = {
  1: "plain:v1", 2: "plain:v1", 3: "breakable-perimeter:v1", 4: "breakable-perimeter:v1",
  5: "breakable-perimeter-center-hole:v1", 6: "breakable-perimeter-dual-hole:v1",
  7: "pocket-exits:v1", 8: "pocket-exits:v1", 9: "pinball-pillars:v1", 10: "plain:v1",
};

type Timestamped = { at: string };
type EventProgress = { eventIds: Record<string, Timestamped | (Timestamped & { enemyPieceId: string })> };
type TargetProgress = { targets: Record<string, { eventId: string; at: string; revision?: number }> };
type DoubleOutProgress = { bestDoubleOut: { eventId: string; enemyPieceIds: [string, string]; fallCount: number; at: string } | null };
export type MedalProgress = EventProgress | TargetProgress | DoubleOutProgress;
export interface MasteryVersionRecord {
  progress: MedalProgress;
  firstAchievedAt: string | null;
  personalRecord: { value: number; eventId: string; at: string } | null;
}

export interface BannerKnightProgress {
  fallenEnemies: Record<string, { eventId: string; at: string }>;
  firstAchievedAt: string | null;
}
export interface BannerCrimsonProgress {
  bestTripleOut: { eventId: string; enemyPieceIds: [string, string, string] | string[]; fallCount: number; at: string } | null;
  firstAchievedAt: string | null;
}
export interface BannerComebackProgress {
  eventIds: Record<string, { at: string; stage: number }>;
  firstAchievedAt: string | null;
}
export interface BannerProgressMap {
  banner_cosmic_knight?: BannerKnightProgress;
  banner_crimson_sun?: BannerCrimsonProgress;
  banner_hidden_myeongnyang?: BannerComebackProgress;
}
export interface MasteryProgressStore {
  schemaVersion: 1;
  records: Partial<Record<MasteryId, { versions: Record<string, MasteryVersionRecord> }>>;
  banners?: BannerProgressMap;
}
export interface RewardStore {
  schemaVersion: 1;
  grants: Record<string, { grantedAt: string; itemIds: string[] }>;
  items: Record<string, { grantId: string; grantedAt: string }>;
}
export interface PreferenceValue { itemId: string | null; updatedAt: string; deviceId: string }
export interface PreferenceStore {
  schemaVersion: 1;
  tracked: { medalId: MasteryId | null; updatedAt: string; deviceId: string };
  equipped: Partial<Record<EquipmentSlot, PreferenceValue>>;
}
export interface MasteryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  setItems?(values: Record<string, string>): void;
}
export interface MasterySnapshot {
  progress: MasteryProgressStore;
  rewards: RewardStore;
  preferences: PreferenceStore;
  malformed: boolean;
}
export interface MasteryProgressItem {
  medalId: MasteryId;
  before: number;
  after: number;
  threshold: number;
  achieved: boolean;
}
export interface MasteryUpdate { items: MasteryProgressItem[]; grantedItemIds: string[] }

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const ID_RE = /^[\x21-\x7e]{1,96}$/;
const PIECE_TYPES: readonly PieceType[] = ["Pawn", "Knight", "Bishop", "Rook", "Queen", "King"];
const PUZZLE_IDS = ["P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08", "P09", "P10", "P11", "P12"] as const;
const TEMPLATE_IDS = ["plain:v1", "breakable-perimeter:v1", "breakable-perimeter-center-hole:v1", "breakable-perimeter-dual-hole:v1", "pocket-exits:v1", "pinball-pillars:v1"] as const;
const LIMITS: Record<MasteryId, number> = { M01: 1, M02: 6, M03: 3, M04: 3, M05: 5, M06: 2, M07: 1, M08: 3 };

function validIso(value: unknown): value is string {
  return typeof value === "string" && ISO_RE.test(value) && Number.isFinite(Date.parse(value));
}
function validId(value: unknown): value is string { return typeof value === "string" && ID_RE.test(value); }
function nowIso(value?: string): string { return validIso(value) ? value : new Date().toISOString(); }
function isMasteryId(value: unknown): value is MasteryId { return MASTERY_IDS.includes(value as MasteryId); }
function isObject(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function requireShape(value: unknown, allowed: readonly string[], required: readonly string[] = allowed): asserts value is Record<string, unknown> {
  if (!isObject(value)) throw new Error("mastery-object-malformed");
  const keys = Object.keys(value);
  if (keys.some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) throw new Error("mastery-object-keys-malformed");
}
function cloneJson<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function emptyProgress(): MasteryProgressStore { return { schemaVersion: 1, records: {} }; }
function emptyRewards(): RewardStore { return { schemaVersion: 1, grants: {}, items: {} }; }
function deviceId(storage?: MasteryStorage): string {
  const owner = (storage as { owner?: string | null } | undefined)?.owner;
  const key = `ca_mastery_device_v1:${owner ?? "guest"}`;
  try {
    const prior = localStorage.getItem(key);
    if (validId(prior)) return prior;
    const next = `device-${crypto.randomUUID()}`;
    localStorage.setItem(key, next);
    return next;
  } catch { return "device-local"; }
}
function emptyPreferences(): PreferenceStore {
  return { schemaVersion: 1, tracked: { medalId: null, updatedAt: "1970-01-01T00:00:00.000Z", deviceId: deviceId() }, equipped: {} };
}

function orderedEntries<T>(entries: Record<string, T & { at: string; eventId?: string }>, limit: number): Record<string, T & { at: string; eventId?: string }> {
  return Object.fromEntries(Object.entries(entries).filter(([key, value]) => validId(key) && validIso(value.at))
    .sort(([ak, a], [bk, b]) => a.at.localeCompare(b.at) || (a.eventId ?? ak).localeCompare(b.eventId ?? bk) || ak.localeCompare(bk)).slice(0, limit));
}

function normalizePersonal(raw: unknown): MasteryVersionRecord["personalRecord"] {
  if (raw === null) return null;
  requireShape(raw, ["value", "eventId", "at"]);
  if (typeof raw.value !== "number" || !Number.isFinite(raw.value) || raw.value < 0 || !validId(raw.eventId) || !validIso(raw.at)) throw new Error("mastery-personal-malformed");
  return { value: raw.value, eventId: raw.eventId, at: raw.at };
}

function normalizeVersion(id: MasteryId, raw: unknown, current: boolean): MasteryVersionRecord {
  requireShape(raw, ["progress", "firstAchievedAt", "personalRecord"]);
  if (!isObject(raw.progress) || (raw.firstAchievedAt !== null && !validIso(raw.firstAchievedAt))) throw new Error("mastery-version-malformed");
  const personalRecord = normalizePersonal(raw.personalRecord);
  if (!current) return cloneJson(raw) as unknown as MasteryVersionRecord;
  let progress: MedalProgress;
  if (id === "M06") {
    requireShape(raw.progress, ["bestDoubleOut"]);
    const best = raw.progress.bestDoubleOut;
    if (best === null) progress = { bestDoubleOut: null };
    else {
      requireShape(best, ["eventId", "enemyPieceIds", "fallCount", "at"]);
      const fallCount = typeof best.fallCount === "number" ? best.fallCount : Number.NaN;
      if (!validId(best.eventId) || !validIso(best.at) || !Array.isArray(best.enemyPieceIds) || best.enemyPieceIds.length !== 2
        || !best.enemyPieceIds.every(validId) || best.enemyPieceIds[0] === best.enemyPieceIds[1]
        || !Number.isInteger(fallCount) || fallCount < 2 || fallCount > 128) throw new Error("mastery-double-out-malformed");
      progress = { bestDoubleOut: { eventId: best.eventId, enemyPieceIds: [best.enemyPieceIds[0], best.enemyPieceIds[1]], fallCount, at: best.at } };
    }
  } else if (["M02", "M03", "M04", "M08"].includes(id)) {
    requireShape(raw.progress, ["targets"]);
    const targets = raw.progress.targets;
    if (!isObject(targets) || Object.keys(targets).length > LIMITS[id]) throw new Error("mastery-targets-malformed");
    const normalized: TargetProgress["targets"] = {};
    for (const [key, value] of Object.entries(targets)) {
      const puzzleTarget = id === "M03" || id === "M04";
      const allowedTarget = id === "M02" ? PIECE_TYPES.includes(key as PieceType) : puzzleTarget ? PUZZLE_IDS.includes(key as typeof PUZZLE_IDS[number]) : TEMPLATE_IDS.includes(key as typeof TEMPLATE_IDS[number]);
      if (!allowedTarget) throw new Error("mastery-target-id-malformed");
      requireShape(value, puzzleTarget ? ["eventId", "at", "revision"] : ["eventId", "at"]);
      if (!validId(value.eventId) || !validIso(value.at) || (puzzleTarget && (!Number.isInteger(value.revision) || (value.revision as number) < 1 || String(value.revision).length > 9))) throw new Error("mastery-target-malformed");
      normalized[key] = { eventId: value.eventId, at: value.at, ...(puzzleTarget ? { revision: value.revision as number } : {}) };
    }
    progress = { targets: orderedEntries(normalized, LIMITS[id]) };
  } else {
    requireShape(raw.progress, ["eventIds"]);
    const events = raw.progress.eventIds;
    if (!isObject(events) || Object.keys(events).length > LIMITS[id]) throw new Error("mastery-events-malformed");
    const normalized: EventProgress["eventIds"] = {};
    for (const [key, value] of Object.entries(events)) {
      if (!validId(key)) throw new Error("mastery-event-id-malformed");
      requireShape(value, id === "M07" ? ["at", "enemyPieceId"] : ["at"]);
      if (!validIso(value.at) || (id === "M07" && !validId(value.enemyPieceId))) throw new Error("mastery-event-malformed");
      normalized[key] = id === "M07" ? { at: value.at, enemyPieceId: value.enemyPieceId as string } : { at: value.at };
    }
    progress = { eventIds: orderedEntries(normalized, LIMITS[id]) };
  }
  const count = progressCount(id, progress);
  const evidenceTimes = id === "M06"
    ? [(progress as DoubleOutProgress).bestDoubleOut?.at].filter(validIso)
    : Object.values(["M02", "M03", "M04", "M08"].includes(id) ? (progress as TargetProgress).targets : (progress as EventProgress).eventIds).map(item => item.at).filter(validIso).sort();
  const derivedAchievement = count >= LIMITS[id] ? evidenceTimes[Math.min(LIMITS[id] - 1, evidenceTimes.length - 1)] ?? null : null;
  const firstAchievedAt = derivedAchievement ?? (count >= LIMITS[id] && validIso(raw.firstAchievedAt) ? raw.firstAchievedAt : null);
  return { progress, firstAchievedAt, personalRecord };
}

export function normalizeMasteryProgress(raw: unknown): MasteryProgressStore {
  requireShape(raw, ["schemaVersion", "records", "banners"], ["schemaVersion", "records"]);
  if (raw.schemaVersion !== 1 || !isObject(raw.records) || Object.keys(raw.records).length > 8) throw new Error("mastery-progress-malformed");
  const result: MasteryProgressStore = emptyProgress();
  for (const [idValue, recordRaw] of Object.entries(raw.records)) {
    if (!isMasteryId(idValue)) throw new Error("mastery-medal-id-malformed");
    requireShape(recordRaw, ["versions"]);
    const versionsRaw = recordRaw.versions;
    if (!isObject(versionsRaw) || Object.keys(versionsRaw).length > 4) throw new Error("mastery-versions-malformed");
    const versions: Record<string, MasteryVersionRecord> = {};
    for (const [conditionVersion, value] of Object.entries(versionsRaw)) {
      if (!/^[1-9]\d*$/.test(conditionVersion) || conditionVersion.length > 9) throw new Error("mastery-version-id-malformed");
      versions[conditionVersion] = normalizeVersion(idValue, value, conditionVersion === "1");
    }
    result.records[idValue] = { versions: Object.fromEntries(Object.entries(versions).sort(([a], [b]) => Number(a) - Number(b))) };
  }
  if (raw.banners !== undefined) {
    if (!isObject(raw.banners) || Object.keys(raw.banners).some(key => !["banner_cosmic_knight", "banner_crimson_sun", "banner_hidden_myeongnyang"].includes(key))) {
      throw new Error("mastery-banners-malformed");
    }
    const banners: BannerProgressMap = {};
    if (raw.banners.banner_cosmic_knight !== undefined) {
      const knightRaw = raw.banners.banner_cosmic_knight;
      requireShape(knightRaw, ["fallenEnemies", "firstAchievedAt"]);
      if (!isObject(knightRaw.fallenEnemies) || (knightRaw.firstAchievedAt !== null && !validIso(knightRaw.firstAchievedAt))) {
        throw new Error("mastery-banner-knight-malformed");
      }
      const enemies: Record<string, { eventId: string; at: string }> = {};
      for (const [enemyId, enemyVal] of Object.entries(knightRaw.fallenEnemies)) {
        if (!validId(enemyId)) throw new Error("mastery-enemy-id-malformed");
        requireShape(enemyVal, ["eventId", "at"]);
        if (!validId(enemyVal.eventId) || !validIso(enemyVal.at)) throw new Error("mastery-enemy-entry-malformed");
        enemies[enemyId] = { eventId: enemyVal.eventId as string, at: enemyVal.at as string };
      }
      const ordered = orderedEntries(enemies, 50);
      const times = Object.values(ordered).map(e => e.at).sort();
      const count = Object.keys(ordered).length;
      const derivedAchievement = count >= 50 ? times[49] ?? null : null;
      const firstAchievedAt = derivedAchievement ?? (count >= 50 && validIso(knightRaw.firstAchievedAt) ? knightRaw.firstAchievedAt : null);
      banners.banner_cosmic_knight = { fallenEnemies: ordered, firstAchievedAt };
    }
    if (raw.banners.banner_crimson_sun !== undefined) {
      const crimsonRaw = raw.banners.banner_crimson_sun;
      requireShape(crimsonRaw, ["bestTripleOut", "firstAchievedAt"]);
      if ((crimsonRaw.firstAchievedAt !== null && !validIso(crimsonRaw.firstAchievedAt))
        || (crimsonRaw.bestTripleOut !== null && !isObject(crimsonRaw.bestTripleOut))) {
        throw new Error("mastery-banner-crimson-malformed");
      }
      let bestTripleOut: BannerCrimsonProgress["bestTripleOut"] = null;
      if (crimsonRaw.bestTripleOut !== null) {
        const best = crimsonRaw.bestTripleOut;
        requireShape(best, ["eventId", "enemyPieceIds", "fallCount", "at"]);
        const fallCount = typeof best.fallCount === "number" ? best.fallCount : Number.NaN;
        if (!validId(best.eventId) || !validIso(best.at) || !Array.isArray(best.enemyPieceIds) || best.enemyPieceIds.length < 3
          || !best.enemyPieceIds.every(validId) || new Set(best.enemyPieceIds).size !== best.enemyPieceIds.length
          || !Number.isInteger(fallCount) || fallCount < 3 || fallCount > 128) {
          throw new Error("mastery-triple-out-malformed");
        }
        bestTripleOut = { eventId: best.eventId, enemyPieceIds: [...best.enemyPieceIds], fallCount, at: best.at };
      }
      const firstAchievedAt = bestTripleOut ? bestTripleOut.at : (validIso(crimsonRaw.firstAchievedAt) ? crimsonRaw.firstAchievedAt : null);
      banners.banner_crimson_sun = { bestTripleOut, firstAchievedAt };
    }
    if (raw.banners.banner_hidden_myeongnyang !== undefined) {
      const comebackRaw = raw.banners.banner_hidden_myeongnyang;
      requireShape(comebackRaw, ["eventIds", "firstAchievedAt"]);
      if (!isObject(comebackRaw.eventIds) || (comebackRaw.firstAchievedAt !== null && !validIso(comebackRaw.firstAchievedAt))) {
        throw new Error("mastery-banner-comeback-malformed");
      }
      const events: Record<string, { at: string; stage: number }> = {};
      for (const [evId, evVal] of Object.entries(comebackRaw.eventIds)) {
        if (!validId(evId)) throw new Error("mastery-comeback-event-id-malformed");
        requireShape(evVal, ["at", "stage"]);
        if (!validIso(evVal.at) || !Number.isInteger(evVal.stage) || (evVal.stage as number) < 5) throw new Error("mastery-comeback-entry-malformed");
        events[evId] = { at: evVal.at as string, stage: evVal.stage as number };
      }
      const ordered = orderedEntries(events, 1);
      const times = Object.values(ordered).map(e => e.at).sort();
      const firstAchievedAt = times[0] ?? (Object.keys(ordered).length >= 1 && validIso(comebackRaw.firstAchievedAt) ? comebackRaw.firstAchievedAt : null);
      banners.banner_hidden_myeongnyang = { eventIds: ordered, firstAchievedAt };
    }
    result.banners = banners;
  }
  return result;
}

function recognizedGrant(grantId: string, itemIds: readonly string[]): boolean {
  const medal = /^mastery:(M0[1-8]):v1$/.exec(grantId);
  if (medal) return itemIds.length === 1 && itemIds[0] === `badge:mastery-${medal[1].toLowerCase()}`;
  if (grantId === "mastery:milestone:four") return itemIds.length === 2 && itemIds.includes("title:explorer") && itemIds.includes("entitlement:woodgrain-set-scheduled");
  if (grantId === "mastery:milestone:eight") return itemIds.length === 1 && itemIds[0] === "frame:mastery-complete";
  if (grantId === "banner:banner_cosmic_knight:v1") return itemIds.length === 1 && itemIds[0] === "banner:banner_cosmic_knight";
  if (grantId === "banner:banner_crimson_sun:v1") return itemIds.length === 1 && itemIds[0] === "banner:banner_crimson_sun";
  if (grantId === "banner:banner_hidden_myeongnyang:v1") return itemIds.length === 1 && itemIds[0] === "banner:banner_hidden_myeongnyang";
  return false;
}
export function normalizeRewards(raw: unknown): RewardStore {
  requireShape(raw, ["schemaVersion", "grants", "items"]);
  if (raw.schemaVersion !== 1 || !isObject(raw.grants) || !isObject(raw.items)
    || Object.keys(raw.grants).length > 24 || Object.keys(raw.items).length > 24) throw new Error("mastery-rewards-malformed");
  const result = emptyRewards();
  for (const [id, grant] of Object.entries(raw.grants).sort(([a], [b]) => a.localeCompare(b))) {
    if (!validId(id)) throw new Error("mastery-grant-id-malformed");
    requireShape(grant, ["grantedAt", "itemIds"]);
    if (!validIso(grant.grantedAt) || !Array.isArray(grant.itemIds) || grant.itemIds.length > 3 || !grant.itemIds.every(validId)
      || new Set(grant.itemIds).size !== grant.itemIds.length || !recognizedGrant(id, grant.itemIds)) throw new Error("mastery-grant-malformed");
    result.grants[id] = { grantedAt: grant.grantedAt, itemIds: [...grant.itemIds].sort() };
  }
  for (const [itemId, item] of Object.entries(raw.items)) {
    if (!validId(itemId)) throw new Error("mastery-item-id-malformed");
    requireShape(item, ["grantId", "grantedAt"]);
    if (!validId(item.grantId) || !validIso(item.grantedAt)) throw new Error("mastery-item-malformed");
    const grant = result.grants[item.grantId];
    if (!grant || !grant.itemIds.includes(itemId) || grant.grantedAt !== item.grantedAt) throw new Error("mastery-item-orphaned");
    result.items[itemId] = { grantId: item.grantId, grantedAt: item.grantedAt };
  }
  for (const [grantId, grant] of Object.entries(result.grants)) for (const itemId of grant.itemIds) {
    const item = result.items[itemId];
    if (!item || item.grantId !== grantId || item.grantedAt !== grant.grantedAt) throw new Error("mastery-grant-item-missing");
  }
  return result;
}

function normalizePreferenceValue(raw: unknown): PreferenceValue {
  requireShape(raw, ["itemId", "updatedAt", "deviceId"]);
  if ((raw.itemId !== null && !validId(raw.itemId)) || !validIso(raw.updatedAt) || !validId(raw.deviceId)) throw new Error("mastery-preference-value-malformed");
  return { itemId: raw.itemId as string | null, updatedAt: raw.updatedAt, deviceId: raw.deviceId };
}
export function normalizePreferences(raw: unknown): PreferenceStore {
  requireShape(raw, ["schemaVersion", "tracked", "equipped"]);
  if (raw.schemaVersion !== 1 || !isObject(raw.equipped) || Object.keys(raw.equipped).some(key => !["badge", "title", "frame", "banner"].includes(key))) throw new Error("mastery-preferences-malformed");
  const result = emptyPreferences();
  requireShape(raw.tracked, ["medalId", "updatedAt", "deviceId"]);
  if ((raw.tracked.medalId !== null && !isMasteryId(raw.tracked.medalId)) || !validIso(raw.tracked.updatedAt) || !validId(raw.tracked.deviceId)) throw new Error("mastery-tracked-malformed");
  result.tracked = { medalId: raw.tracked.medalId as MasteryId | null, updatedAt: raw.tracked.updatedAt, deviceId: raw.tracked.deviceId };
  for (const slot of ["badge", "title", "frame", "banner"] as const) {
    if (Object.hasOwn(raw.equipped, slot)) result.equipped[slot] = normalizePreferenceValue(raw.equipped[slot]);
  }
  return result;
}

function readDomain<T>(storage: MasteryStorage, key: string, empty: () => T, normalize: (raw: unknown) => T): { value: T; malformed: boolean } {
  const raw = storage.getItem(key); if (raw === null) return { value: empty(), malformed: false };
  try { return { value: normalize(JSON.parse(raw)), malformed: false }; } catch { return { value: empty(), malformed: true }; }
}
function validBannerRewardProgress(progress: MasteryProgressStore, rewards: RewardStore): boolean {
  const b = progress.banners;
  return (!rewards.items["banner:banner_cosmic_knight"] || Object.keys(b?.banner_cosmic_knight?.fallenEnemies ?? {}).length >= 50)
    && (!rewards.items["banner:banner_crimson_sun"] || (b?.banner_crimson_sun?.bestTripleOut?.fallCount ?? 0) >= 3)
    && (!rewards.items["banner:banner_hidden_myeongnyang"] || Object.keys(b?.banner_hidden_myeongnyang?.eventIds ?? {}).length >= 1);
}

export function loadMasterySnapshot(storage: MasteryStorage): MasterySnapshot {
  const p = readDomain(storage, MASTERY_PROGRESS_KEY, emptyProgress, normalizeMasteryProgress);
  const r = readDomain(storage, MASTERY_REWARDS_KEY, emptyRewards, normalizeRewards);
  const f = readDomain(storage, MASTERY_PREFERENCES_KEY, emptyPreferences, normalizePreferences);
  let malformed = p.malformed || r.malformed || f.malformed || !validBannerRewardProgress(p.value, r.value) || (storage as { unsafeData?: boolean }).unsafeData === true;
  if (!malformed) for (const [slot, preference] of Object.entries(f.value.equipped) as [EquipmentSlot, PreferenceValue][]) {
    const itemId = preference.itemId;
    if (itemId !== null) {
      if (!itemId.startsWith(`${slot}:`)) malformed = true;
      else if (slot === "badge" && !/^badge:mastery-m0[1-8]$/.test(itemId)) malformed = true;
      else if (slot === "title" && itemId !== "title:explorer") malformed = true;
      else if (slot === "frame" && itemId !== "frame:mastery-complete") malformed = true;
      else if (slot === "banner") {
        if (!["banner:classic", "banner:slate", "banner:forest", "banner:banner_cosmic_knight", "banner:banner_crimson_sun", "banner:banner_hidden_myeongnyang"].includes(itemId)) malformed = true;
        else if (["banner:banner_cosmic_knight", "banner:banner_crimson_sun", "banner:banner_hidden_myeongnyang"].includes(itemId) && !r.value.items[itemId]) malformed = true;
      } else if (!r.value.items[itemId]) malformed = true;
    }
  }
  return { progress: p.value, rewards: r.value, preferences: f.value, malformed };
}

export function progressCount(id: MasteryId, progress: MedalProgress): number {
  if (id === "M06") return (progress as DoubleOutProgress).bestDoubleOut?.fallCount ?? 0;
  if (["M02", "M03", "M04", "M08"].includes(id)) return Object.keys((progress as TargetProgress).targets).length;
  return Object.keys((progress as EventProgress).eventIds).length;
}
export function medalProgress(store: MasteryProgressStore, id: MasteryId): number {
  const record = store.records[id]?.versions["1"];
  return record ? Math.min(LIMITS[id], progressCount(id, record.progress)) : 0;
}
export function isMedalEarned(store: MasteryProgressStore, id: MasteryId): boolean { return medalProgress(store, id) >= LIMITS[id]; }
export function earnedMedalCount(store: MasteryProgressStore): number { return MASTERY_IDS.filter(id => isMedalEarned(store, id)).length; }
function blankVersion(id: MasteryId): MasteryVersionRecord {
  const progress: MedalProgress = id === "M06" ? { bestDoubleOut: null }
    : ["M02", "M03", "M04", "M08"].includes(id) ? { targets: {} } : { eventIds: {} };
  return { progress, firstAchievedAt: null, personalRecord: null };
}
function version(store: MasteryProgressStore, id: MasteryId): MasteryVersionRecord {
  const record = store.records[id] ?? { versions: {} }; store.records[id] = record;
  return record.versions["1"] ?? (record.versions["1"] = blankVersion(id));
}
function setAchievement(id: MasteryId, record: MasteryVersionRecord, eventId: string, at: string): void {
  const value = progressCount(id, record.progress);
  const candidate = { value, eventId, at };
  if (!record.personalRecord || value > record.personalRecord.value || (value === record.personalRecord.value && eventId < record.personalRecord.eventId)) record.personalRecord = candidate;
  if (value >= LIMITS[id] && (!record.firstAchievedAt || at < record.firstAchievedAt)) record.firstAchievedAt = at;
}
function grant(store: RewardStore, grantId: string, itemIds: string[], at: string): void {
  const existing = store.grants[grantId];
  const grantedAt = existing && existing.grantedAt < at ? existing.grantedAt : at;
  store.grants[grantId] = { grantedAt, itemIds: [...itemIds].sort() };
  for (const itemId of itemIds) {
    const prior = store.items[itemId];
    if (!prior || grantedAt < prior.grantedAt || (grantedAt === prior.grantedAt && grantId < prior.grantId)) store.items[itemId] = { grantId, grantedAt };
  }
}
export function deriveRewards(snapshot: MasterySnapshot, at: string): string[] {
  const before = new Set(Object.keys(snapshot.rewards.items));
  for (const id of MASTERY_IDS) if (isMedalEarned(snapshot.progress, id)) {
    const achieved = snapshot.progress.records[id]!.versions["1"].firstAchievedAt ?? at;
    grant(snapshot.rewards, `mastery:${id}:v1`, [`badge:mastery-${id.toLowerCase()}`], achieved);
  }
  const count = earnedMedalCount(snapshot.progress);
  const achievementTimes = MASTERY_IDS.filter(id => isMedalEarned(snapshot.progress, id))
    .map(id => snapshot.progress.records[id]?.versions["1"].firstAchievedAt).filter(validIso).sort();
  if (count >= 4) grant(snapshot.rewards, "mastery:milestone:four", ["title:explorer", "entitlement:woodgrain-set-scheduled"], achievementTimes[3] ?? at);
  if (count >= 8) grant(snapshot.rewards, "mastery:milestone:eight", ["frame:mastery-complete"], achievementTimes[7] ?? at);

  if (snapshot.progress.banners) {
    const knight = snapshot.progress.banners.banner_cosmic_knight;
    if (knight && Object.keys(knight.fallenEnemies).length >= 50) {
      grant(snapshot.rewards, "banner:banner_cosmic_knight:v1", ["banner:banner_cosmic_knight"], knight.firstAchievedAt ?? at);
    }
    const crimson = snapshot.progress.banners.banner_crimson_sun;
    if (crimson?.bestTripleOut && crimson.bestTripleOut.fallCount >= 3) {
      grant(snapshot.rewards, "banner:banner_crimson_sun:v1", ["banner:banner_crimson_sun"], crimson.firstAchievedAt ?? at);
    }
    const comeback = snapshot.progress.banners.banner_hidden_myeongnyang;
    if (comeback && Object.keys(comeback.eventIds).length >= 1) {
      grant(snapshot.rewards, "banner:banner_hidden_myeongnyang:v1", ["banner:banner_hidden_myeongnyang"], comeback.firstAchievedAt ?? at);
    }
  }

  return Object.keys(snapshot.rewards.items).filter(id => !before.has(id));
}
export function saveSnapshot(storage: MasteryStorage, snapshot: MasterySnapshot): void {
  if (snapshot.malformed) throw new Error("mastery-storage-malformed");
  const values = {
    [MASTERY_PROGRESS_KEY]: JSON.stringify(snapshot.progress),
    [MASTERY_REWARDS_KEY]: JSON.stringify(snapshot.rewards),
    [MASTERY_PREFERENCES_KEY]: JSON.stringify(snapshot.preferences),
  };
  if (new TextEncoder().encode(values[MASTERY_PROGRESS_KEY]).length > 24576 || new TextEncoder().encode(values[MASTERY_REWARDS_KEY]).length > 8192 || new TextEncoder().encode(values[MASTERY_PREFERENCES_KEY]).length > 4096) throw new Error("mastery-storage-limit");
  if (storage.setItems) storage.setItems(values); else for (const [key, value] of Object.entries(values)) storage.setItem(key, value);
}
function apply(storage: MasteryStorage, mutate: (snapshot: MasterySnapshot, at: string) => void, timestamp?: string): MasteryUpdate {
  const snapshot = loadMasterySnapshot(storage); if (snapshot.malformed) return { items: [], grantedItemIds: [] };
  const before = Object.fromEntries(MASTERY_IDS.map(id => [id, medalProgress(snapshot.progress, id)])) as Record<MasteryId, number>;
  const at = nowIso(timestamp); mutate(snapshot, at);
  const grantedItemIds = deriveRewards(snapshot, at);
  saveSnapshot(storage, snapshot);
  return { items: MASTERY_IDS.map(id => ({ medalId: id, before: before[id], after: medalProgress(snapshot.progress, id), threshold: LIMITS[id], achieved: isMedalEarned(snapshot.progress, id) })).filter(item => item.after !== item.before), grantedItemIds };
}

export function recordMasteryLaunch(storage: MasteryStorage, input: { eventId: string; pieceType: PieceType; at?: string }): MasteryUpdate {
  if (!validId(input.eventId) || !PIECE_TYPES.includes(input.pieceType)) return { items: [], grantedItemIds: [] };
  return apply(storage, (snapshot, at) => {
    const record = version(snapshot.progress, "M02"); const targets = (record.progress as TargetProgress).targets;
    const prior = targets[input.pieceType];
    if (!prior || at < prior.at || (at === prior.at && input.eventId < prior.eventId)) targets[input.pieceType] = { eventId: input.eventId, at };
    record.progress = { targets: orderedEntries(targets, 6) }; setAchievement("M02", record, input.eventId, at);
  }, input.at);
}
export function recordMasteryDoubleOut(storage: MasteryStorage, input: { eventId: string; enemyPieceIds: string[]; fallCount: number; at?: string }): MasteryUpdate {
  const witnesses = [...new Set(input.enemyPieceIds.filter(validId))].sort();
  if (!validId(input.eventId) || witnesses.length < 2 || !Number.isInteger(input.fallCount) || input.fallCount < 2) return { items: [], grantedItemIds: [] };
  return apply(storage, (snapshot, at) => {
    const record = version(snapshot.progress, "M06"); const previous = (record.progress as DoubleOutProgress).bestDoubleOut;
    const next = { eventId: input.eventId, enemyPieceIds: [witnesses[0], witnesses[1]] as [string, string], fallCount: Math.min(128, input.fallCount), at };
    if (!previous || next.fallCount > previous.fallCount || (next.fallCount === previous.fallCount && next.eventId < previous.eventId)) record.progress = { bestDoubleOut: next };
    setAchievement("M06", record, input.eventId, at);
  }, input.at);
}
export function recordMasteryPveVictory(storage: MasteryStorage, input: { eventId: string; templateId: string; enemyPieceIds: string[]; playerEnemyPieceIds?: string[]; ownFallCount: number; at?: string }): MasteryUpdate {
  const enemies = [...new Set(input.enemyPieceIds.filter(validId))].sort();
  const playerEnemies = [...new Set((input.playerEnemyPieceIds ?? input.enemyPieceIds).filter(validId))].sort();
  if (!validId(input.eventId) || !TEMPLATE_IDS.includes(input.templateId as typeof TEMPLATE_IDS[number]) || enemies.length === 0 || !Number.isInteger(input.ownFallCount) || input.ownFallCount < 0) return { items: [], grantedItemIds: [] };
  return apply(storage, (snapshot, at) => {
    for (const id of ["M01", "M05"] as const) {
      const record = version(snapshot.progress, id); const events = (record.progress as EventProgress).eventIds;
      events[input.eventId] = { at }; record.progress = { eventIds: orderedEntries(events, LIMITS[id]) }; setAchievement(id, record, input.eventId, at);
    }
    if (input.ownFallCount === 0 && playerEnemies.length > 0) {
      const record = version(snapshot.progress, "M07"); const events = (record.progress as EventProgress).eventIds;
      events[input.eventId] = { at, enemyPieceId: playerEnemies[0] }; record.progress = { eventIds: orderedEntries(events, 1) }; setAchievement("M07", record, input.eventId, at);
    }
    const record = version(snapshot.progress, "M08"); const targets = (record.progress as TargetProgress).targets;
    const prior = targets[input.templateId];
    if (!prior || at < prior.at || (at === prior.at && input.eventId < prior.eventId)) targets[input.templateId] = { eventId: input.eventId, at };
    record.progress = { targets: orderedEntries(targets, 3) }; setAchievement("M08", record, input.eventId, at);
  }, input.at);
}
export function recordMasteryPuzzle(storage: MasteryStorage, input: { eventId: string; puzzleId: string; revision: number; gold: boolean; at?: string }): MasteryUpdate {
  if (!validId(input.eventId) || !PUZZLE_IDS.includes(input.puzzleId as typeof PUZZLE_IDS[number]) || !Number.isInteger(input.revision) || input.revision < 1 || String(input.revision).length > 9) return { items: [], grantedItemIds: [] };
  return apply(storage, (snapshot, at) => {
    for (const id of (input.gold ? ["M03", "M04"] : ["M03"]) as MasteryId[]) {
      const record = version(snapshot.progress, id); const targets = (record.progress as TargetProgress).targets;
      const prior = targets[input.puzzleId];
      if (!prior || at < prior.at || (at === prior.at && input.eventId < prior.eventId)) targets[input.puzzleId] = { eventId: input.eventId, at, revision: input.revision };
      record.progress = { targets: orderedEntries(targets, 3) }; setAchievement(id, record, input.eventId, at);
    }
  }, input.at);
}
export function backfillPuzzleMastery(storage: MasteryStorage, puzzle: PuzzleProgressStore): MasteryUpdate {
  let result: MasteryUpdate = { items: [], grantedItemIds: [] };
  for (const entry of Object.values(puzzle.records).sort((a, b) => a.puzzleId.localeCompare(b.puzzleId) || a.revision - b.revision)) {
    if (entry.bestMedal < 1) continue;
    const at = validIso(entry.completedAt) ? entry.completedAt : validIso(entry.lastShot?.finishedAt) ? entry.lastShot!.finishedAt : new Date().toISOString();
    const update = recordMasteryPuzzle(storage, { eventId: `retro-${entry.puzzleId}-${entry.revision}`, puzzleId: entry.puzzleId, revision: entry.revision, gold: entry.bestMedal >= 3, at });
    result = { items: [...result.items, ...update.items], grantedItemIds: [...new Set([...result.grantedItemIds, ...update.grantedItemIds])] };
  }
  return result;
}

function preferenceWins(a: PreferenceValue, b: PreferenceValue): PreferenceValue {
  const compare = a.updatedAt.localeCompare(b.updatedAt) || a.deviceId.localeCompare(b.deviceId) || (a.itemId ?? "").localeCompare(b.itemId ?? "");
  return compare >= 0 ? a : b;
}
export function setTrackedMastery(storage: MasteryStorage, medalId: MasteryId | null): boolean {
  const snapshot = loadMasterySnapshot(storage); if (snapshot.malformed) return false;
  snapshot.preferences.tracked = { medalId, updatedAt: new Date().toISOString(), deviceId: deviceId(storage) }; saveSnapshot(storage, snapshot); return true;
}
export function setEquippedMastery(storage: MasteryStorage, slot: EquipmentSlot, itemId: string | null): boolean {
  const snapshot = loadMasterySnapshot(storage); if (snapshot.malformed) return false;
  if (itemId !== null) {
    if (!itemId.startsWith(`${slot}:`)) return false;
    if (slot === "badge" && (!snapshot.rewards.items[itemId] || !/^badge:mastery-m0[1-8]$/.test(itemId))) return false;
    if (slot === "title" && (!snapshot.rewards.items[itemId] || itemId !== "title:explorer")) return false;
    if (slot === "frame" && (!snapshot.rewards.items[itemId] || itemId !== "frame:mastery-complete")) return false;
    if (slot === "banner") {
      if (!["banner:classic", "banner:slate", "banner:forest", "banner:banner_cosmic_knight", "banner:banner_crimson_sun", "banner:banner_hidden_myeongnyang"].includes(itemId)) return false;
      if (["banner:banner_cosmic_knight", "banner:banner_crimson_sun", "banner:banner_hidden_myeongnyang"].includes(itemId) && !snapshot.rewards.items[itemId]) return false;
    }
  }
  snapshot.preferences.equipped[slot] = { itemId, updatedAt: new Date().toISOString(), deviceId: deviceId(storage) }; saveSnapshot(storage, snapshot); return true;
}
export function equippedItem(snapshot: MasterySnapshot, slot: EquipmentSlot): string | null {
  const itemId = snapshot.preferences.equipped[slot]?.itemId ?? null;
  if (!itemId || !itemId.startsWith(`${slot}:`)) return null;
  if (slot === "banner" && ["banner:classic", "banner:slate", "banner:forest"].includes(itemId)) return itemId;
  return snapshot.rewards.items[itemId] ? itemId : null;
}

export function mergeMasteryValue(key: string, leftRaw: string | undefined, rightRaw: string | undefined): string | undefined {
  if (!leftRaw) return rightRaw; if (!rightRaw) return leftRaw;
  if (key === MASTERY_PROGRESS_KEY) {
    const left = normalizeMasteryProgress(JSON.parse(leftRaw)); const right = normalizeMasteryProgress(JSON.parse(rightRaw)); const merged = emptyProgress();
    for (const id of MASTERY_IDS) {
      const versions = new Set([...Object.keys(left.records[id]?.versions ?? {}), ...Object.keys(right.records[id]?.versions ?? {})]);
      const orderedVersions = [...versions].sort((a, b) => Number(a) - Number(b));
      const retainedVersions = orderedVersions.includes("1") ? ["1", ...orderedVersions.filter(value => value !== "1").slice(-3)] : orderedVersions.slice(-4);
      for (const v of retainedVersions) {
        const a = left.records[id]?.versions[v], b = right.records[id]?.versions[v];
        if (!a || !b) { const source = a ?? b; if (source) { (merged.records[id] ??= { versions: {} }).versions[v] = source; } continue; }
        if (v !== "1") {
          if (canonicalJson(a) !== canonicalJson(b)) throw new Error(`mastery-opaque-version-conflict:${id}:${v}`);
          (merged.records[id] ??= { versions: {} }).versions[v] = cloneJson(a);
          continue;
        }
        const record = blankVersion(id);
        if (id === "M06") {
          const candidates = [(a.progress as DoubleOutProgress).bestDoubleOut, (b.progress as DoubleOutProgress).bestDoubleOut].filter(Boolean) as NonNullable<DoubleOutProgress["bestDoubleOut"]>[];
          record.progress = { bestDoubleOut: candidates.sort((x, y) => y.fallCount - x.fallCount || x.eventId.localeCompare(y.eventId))[0] ?? null };
        } else if (["M02", "M03", "M04", "M08"].includes(id)) {
          const targets = { ...(a.progress as TargetProgress).targets, ...(b.progress as TargetProgress).targets };
          for (const key of new Set([...Object.keys((a.progress as TargetProgress).targets), ...Object.keys((b.progress as TargetProgress).targets)])) {
            const x = (a.progress as TargetProgress).targets[key], y = (b.progress as TargetProgress).targets[key]; if (x && y) targets[key] = x.at < y.at || (x.at === y.at && x.eventId <= y.eventId) ? x : y;
          }
          record.progress = { targets: orderedEntries(targets, LIMITS[id]) };
        } else {
          const events = { ...(a.progress as EventProgress).eventIds, ...(b.progress as EventProgress).eventIds };
          for (const key of new Set([...Object.keys((a.progress as EventProgress).eventIds), ...Object.keys((b.progress as EventProgress).eventIds)])) {
            const x = (a.progress as EventProgress).eventIds[key], y = (b.progress as EventProgress).eventIds[key]; if (x && y) events[key] = x.at <= y.at ? x : y;
          }
          record.progress = { eventIds: orderedEntries(events, LIMITS[id]) };
        }
        const mergedCount = progressCount(id, record.progress);
        const mergedTimes = id === "M06" ? [(record.progress as DoubleOutProgress).bestDoubleOut?.at].filter(validIso)
          : Object.values(["M02", "M03", "M04", "M08"].includes(id) ? (record.progress as TargetProgress).targets : (record.progress as EventProgress).eventIds).map(item => item.at).filter(validIso).sort();
        record.firstAchievedAt = mergedCount >= LIMITS[id] ? mergedTimes[Math.min(LIMITS[id] - 1, mergedTimes.length - 1)] ?? null : null;
        record.personalRecord = [a.personalRecord, b.personalRecord].filter(Boolean).sort((x, y) => y!.value - x!.value || x!.eventId.localeCompare(y!.eventId))[0] ?? null;
        (merged.records[id] ??= { versions: {} }).versions[v] = record;
      }
    }
    if (left.banners || right.banners) {
      const banners: BannerProgressMap = {};
      const knightA = left.banners?.banner_cosmic_knight, knightB = right.banners?.banner_cosmic_knight;
      if (knightA || knightB) {
        const enemies = { ...(knightA?.fallenEnemies ?? {}), ...(knightB?.fallenEnemies ?? {}) };
        for (const k of new Set([...Object.keys(knightA?.fallenEnemies ?? {}), ...Object.keys(knightB?.fallenEnemies ?? {})])) {
          const x = knightA?.fallenEnemies[k], y = knightB?.fallenEnemies[k];
          if (x && y) enemies[k] = x.at <= y.at ? x : y;
        }
        const ordered = orderedEntries(enemies, 50);
        const times = Object.values(ordered).map(e => e.at).sort();
        const firstAchievedAt = Object.keys(ordered).length >= 50 ? times[49] ?? null : null;
        banners.banner_cosmic_knight = { fallenEnemies: ordered, firstAchievedAt };
      }
      const crimsonA = left.banners?.banner_crimson_sun, crimsonB = right.banners?.banner_crimson_sun;
      if (crimsonA || crimsonB) {
        const candidates = [crimsonA?.bestTripleOut, crimsonB?.bestTripleOut].filter(Boolean) as NonNullable<BannerCrimsonProgress["bestTripleOut"]>[];
        const best = candidates.sort((x, y) => y.fallCount - x.fallCount || x.at.localeCompare(y.at) || x.eventId.localeCompare(y.eventId))[0] ?? null;
        banners.banner_crimson_sun = { bestTripleOut: best, firstAchievedAt: best ? best.at : null };
      }
      const comebackA = left.banners?.banner_hidden_myeongnyang, comebackB = right.banners?.banner_hidden_myeongnyang;
      if (comebackA || comebackB) {
        const events = { ...(comebackA?.eventIds ?? {}), ...(comebackB?.eventIds ?? {}) };
        for (const k of new Set([...Object.keys(comebackA?.eventIds ?? {}), ...Object.keys(comebackB?.eventIds ?? {})])) {
          const x = comebackA?.eventIds[k], y = comebackB?.eventIds[k];
          if (x && y) events[k] = x.at <= y.at ? x : y;
        }
        const ordered = orderedEntries(events, 1);
        const times = Object.values(ordered).map(e => e.at).sort();
        const firstAchievedAt = times[0] ?? null;
        banners.banner_hidden_myeongnyang = { eventIds: ordered, firstAchievedAt };
      }
      merged.banners = banners;
    }
    return JSON.stringify(merged);
  }
  if (key === MASTERY_REWARDS_KEY) {
    const left = normalizeRewards(JSON.parse(leftRaw)), right = normalizeRewards(JSON.parse(rightRaw)); const merged = emptyRewards();
    for (const [id, value] of [...Object.entries(left.grants), ...Object.entries(right.grants)].sort(([a], [b]) => a.localeCompare(b))) {
      const prior = merged.grants[id]; if (!prior || value.grantedAt < prior.grantedAt) merged.grants[id] = value;
    }
    for (const [grantId, grantValue] of Object.entries(merged.grants)) for (const itemId of grantValue.itemIds) merged.items[itemId] = { grantId, grantedAt: grantValue.grantedAt };
    return JSON.stringify(normalizeRewards(merged));
  }
  if (key === MASTERY_PREFERENCES_KEY) {
    const left = normalizePreferences(JSON.parse(leftRaw)), right = normalizePreferences(JSON.parse(rightRaw));
    const trackedLeft: PreferenceValue = { itemId: left.tracked.medalId, updatedAt: left.tracked.updatedAt, deviceId: left.tracked.deviceId };
    const trackedRight: PreferenceValue = { itemId: right.tracked.medalId, updatedAt: right.tracked.updatedAt, deviceId: right.tracked.deviceId };
    const tracked = preferenceWins(trackedLeft, trackedRight); const merged = emptyPreferences();
    merged.tracked = { medalId: isMasteryId(tracked.itemId) ? tracked.itemId : null, updatedAt: tracked.updatedAt, deviceId: tracked.deviceId };
    for (const slot of ["badge", "title", "frame", "banner"] as const) {
      const a = left.equipped[slot], b = right.equipped[slot]; if (a || b) merged.equipped[slot] = a && b ? preferenceWins(a, b) : (a ?? b)!;
    }
    return JSON.stringify(merged);
  }
  return rightRaw;
}

export function reconcileMasteryValues(data: Record<string, string>): Record<string, string> {
  if (!data[MASTERY_PROGRESS_KEY] && !data[MASTERY_REWARDS_KEY]) return data;
  const progress = data[MASTERY_PROGRESS_KEY] ? normalizeMasteryProgress(JSON.parse(data[MASTERY_PROGRESS_KEY])) : emptyProgress();
  const rewards = data[MASTERY_REWARDS_KEY] ? normalizeRewards(JSON.parse(data[MASTERY_REWARDS_KEY])) : emptyRewards();
  const snapshot: MasterySnapshot = { progress, rewards, preferences: emptyPreferences(), malformed: false };
  deriveRewards(snapshot, "1970-01-01T00:00:00.000Z");
  const next = { ...data, [MASTERY_PROGRESS_KEY]: JSON.stringify(snapshot.progress), [MASTERY_REWARDS_KEY]: JSON.stringify(snapshot.rewards) };
  validateMasteryValues(next);
  return next;
}

export function validateMasteryValues(data: Record<string, string>): void {
  const progress = data[MASTERY_PROGRESS_KEY] === undefined ? emptyProgress() : normalizeMasteryProgress(JSON.parse(data[MASTERY_PROGRESS_KEY]));
  const rewards = data[MASTERY_REWARDS_KEY] === undefined ? emptyRewards() : normalizeRewards(JSON.parse(data[MASTERY_REWARDS_KEY]));
  const preferences = data[MASTERY_PREFERENCES_KEY] === undefined ? emptyPreferences() : normalizePreferences(JSON.parse(data[MASTERY_PREFERENCES_KEY]));
  if (!validBannerRewardProgress(progress, rewards)) throw new Error("mastery-banner-reward-without-progress");
  for (const [slot, preference] of Object.entries(preferences.equipped) as [EquipmentSlot, PreferenceValue][]) {
    const itemId = preference.itemId;
    if (itemId !== null) {
      if (!itemId.startsWith(`${slot}:`)) throw new Error("mastery-equipment-malformed");
      if (slot === "badge" && !/^badge:mastery-m0[1-8]$/.test(itemId)) throw new Error("mastery-equipment-malformed");
      if (slot === "title" && itemId !== "title:explorer") throw new Error("mastery-equipment-malformed");
      if (slot === "frame" && itemId !== "frame:mastery-complete") throw new Error("mastery-equipment-malformed");
      if (slot === "banner") {
        if (!["banner:classic", "banner:slate", "banner:forest", "banner:banner_cosmic_knight", "banner:banner_crimson_sun", "banner:banner_hidden_myeongnyang"].includes(itemId)) throw new Error("mastery-equipment-malformed");
        if (["banner:banner_cosmic_knight", "banner:banner_crimson_sun", "banner:banner_hidden_myeongnyang"].includes(itemId) && !rewards.items[itemId]) throw new Error("mastery-equipment-malformed");
      } else if (!rewards.items[itemId]) throw new Error("mastery-equipment-malformed");
    }
  }
}
