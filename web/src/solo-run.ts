import { applyCardPick, cloneRunCardState, createRunCardState, drawUpgradeCards, type CardId, type RunCardState } from "./cards";
import { computeStageRunPayout, createStageRunPointState, type StageRunPointState } from "./meta";
import { readSoloState } from "./crazygames-solo";
import { PLATFORM } from "./platform";
import { portalStoragePersistent } from "./portal-browser-guards";

export interface SoloRun {
  schemaVersion: 3;
  // Older v3 runs have no platform; their storage key supplies the namespace.
  platform?: "itch" | "crazygames";
  rulesVersion: "itch-retry-v1";
  owner: string | null;
  runId: string;
  revision: number;
  startStage: number;
  stage: number;
  phase: "stage-ready" | "stage-result" | "awaiting-card" | "preparing-stage" | "ending" | "ended";
  cards: RunCardState;
  points: StageRunPointState;
  offer: { id: string; stage: number; choices: CardId[]; selected: CardId | null } | null;
  result: { winner: "black" | "draw"; ownOut: number; enemyOut: number; forced: boolean;
    observed?: boolean; byAI?: boolean; remainingOwn?: number; remainingEnemy?: number } | null;
  endReason: "user-ended" | "completed" | null;
  settlementId: string;
}

type Store = Pick<Storage, "getItem" | "setItem">;
const prefix = PLATFORM.id === "itch" ? "ca_itch" : "ca_cg";
const platform = PLATFORM.id === "itch" ? "itch" : "crazygames";
const key = (owner: string | null) => `${prefix}_solo_run_v3:${owner ?? "guest"}`;
const legacyKey = (owner: string | null) => `${prefix}_opening_v2:${owner ?? "guest"}`;
const idPattern = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const cardIds: readonly CardId[] = ["size", "weight", "force", "giantPawn", "proneStart"];
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const stageNumber = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 10;
const count = (n: unknown, max = Number.MAX_SAFE_INTEGER): n is number => Number.isSafeInteger(n) && (n as number) >= 0 && (n as number) <= max;
const ownerValid = (owner: unknown): owner is string | null => owner === null || (typeof owner === "string" && owner.length > 0);

function storageOrNull(storage?: Store): Store | null {
  if (storage) return storage;
  try { return globalThis.localStorage; } catch { return null; }
}

// The legacy checkpoint has no ID. Its exact bytes and owner produce a stable ID on every retry.
function legacyId(owner: string | null, raw: string): string {
  // Keep the original itch ID contract; namespace newly migrated CG receipts.
  const input = `${prefix === "ca_cg" ? "ca_cg\0" : ""}${owner ?? "guest"}\0${raw}`;
  return [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35].map(seed => {
    let h = seed;
    for (let i = 0; i < input.length; i += 1) h = Math.imul(h ^ input.charCodeAt(i), 0x01000193);
    return (h >>> 0).toString(16).padStart(8, "0");
  }).join("");
}

function valid(run: unknown, owner?: string | null): run is SoloRun {
  if (!object(run) || run.schemaVersion !== 3 || run.rulesVersion !== "itch-retry-v1" ||
      (run.platform !== undefined && run.platform !== platform) || !ownerValid(run.owner) ||
      (owner !== undefined && run.owner !== owner) || typeof run.runId !== "string" || !idPattern.test(run.runId) ||
      typeof run.settlementId !== "string" || run.settlementId !== `solo-v1:${run.runId}` || !count(run.revision) ||
      !stageNumber(run.startStage) || !stageNumber(run.stage) || run.stage < run.startStage ||
      !["stage-ready", "stage-result", "awaiting-card", "preparing-stage", "ending", "ended"].includes(run.phase as string) ||
      !object(run.cards) || !object(run.points)) return false;
  const c = run.cards, p = run.points;
  if (![c.sizeGrade, c.weightGrade, c.forceGrade].every(n => count(n, 5)) ||
      typeof c.giantPawn !== "boolean" || typeof c.proneStart !== "boolean" || !count(c.picksSoFar, 9) ||
      c.picksSoFar !== (c.sizeGrade as number) + (c.weightGrade as number) + (c.forceGrade as number) + Number(c.giantPawn) + Number(c.proneStart) ||
      p.startedAtStage !== (run.startStage === 1 ? undefined : run.startStage) || !count(p.lastClearedStage, 10)) return false;
  const last = p.lastClearedStage as number;
  const phase = run.phase as SoloRun["phase"];
  const offer = run.offer;
  const result = run.result;
  if (offer !== null) {
    if (!object(offer) || typeof offer.id !== "string" || !stageNumber(offer.stage) || offer.stage >= 10 ||
        offer.id !== `${run.runId}:${offer.stage}` || !Array.isArray(offer.choices) || offer.choices.length < 1 || offer.choices.length > 3 ||
        new Set(offer.choices).size !== offer.choices.length || !offer.choices.every(id => cardIds.includes(id)) ||
        (offer.selected !== null && !offer.choices.includes(offer.selected))) return false;
  }
  if (result !== null && (!object(result) || !["black", "draw"].includes(result.winner as string) ||
      !count(result.ownOut, 16) || !count(result.enemyOut, 16) || typeof result.forced !== "boolean"
      || (result.observed !== undefined && typeof result.observed !== "boolean")
      || (result.byAI !== undefined && typeof result.byAI !== "boolean")
      || (result.remainingOwn !== undefined && !count(result.remainingOwn, 16))
      || (result.remainingEnemy !== undefined && !count(result.remainingEnemy, 16)))) return false;
  if (run.endReason !== null && !["user-ended", "completed"].includes(run.endReason as string)) return false;
  if ((phase === "ending" || phase === "ended") !== (run.endReason !== null)) return false;
  if (run.endReason === "completed" && (run.stage !== 10 || last !== 10 || result !== null)) return false;
  if (phase === "stage-ready" && (last !== run.stage - 1 || offer !== null || result !== null || c.picksSoFar !== run.stage - run.startStage)) return false;
  if (phase === "stage-result" && (last !== run.stage - 1 || offer !== null || result === null || c.picksSoFar !== run.stage - run.startStage)) return false;
  if (phase === "awaiting-card" && (last !== run.stage || offer === null || offer.stage !== run.stage || offer.selected !== null || result !== null || c.picksSoFar !== run.stage - run.startStage)) return false;
  if (phase === "preparing-stage" && (last !== run.stage - 1 || offer === null || offer.stage !== run.stage - 1 || offer.selected === null || result !== null || c.picksSoFar !== run.stage - run.startStage)) return false;
  if ((phase === "ending" || phase === "ended") && (last < run.startStage - 1 || last > run.stage ||
      c.picksSoFar < last - run.startStage || c.picksSoFar > last - run.startStage + 1)) return false;
  return true;
}

function requireRun(run: SoloRun): void { if (!valid(run)) throw new Error("Invalid solo run"); }
function requirePhase(run: SoloRun, phase: SoloRun["phase"]): void {
  requireRun(run);
  if (run.phase !== phase) throw new Error(`Expected ${phase}, got ${run.phase}`);
}
function next(run: SoloRun, patch: Partial<SoloRun>): SoloRun {
  const value = { ...run, ...patch, revision: run.revision + 1 };
  requireRun(value);
  return value;
}

export function createSoloRun(owner: string | null, stage: number, runId: string = crypto.randomUUID()): SoloRun {
  if (!ownerValid(owner) || !stageNumber(stage) || !idPattern.test(runId)) throw new Error("Invalid solo run origin");
  const run: SoloRun = { schemaVersion: 3, platform, rulesVersion: "itch-retry-v1", owner, runId, revision: 0,
    startStage: stage, stage, phase: "stage-ready", cards: createRunCardState(), points: createStageRunPointState(stage),
    offer: null, result: null, endReason: null, settlementId: `solo-v1:${runId}` };
  requireRun(run);
  return run;
}

export function readSoloRun(owner: string | null, storage?: Store): { run: SoloRun | null; issue: "invalid" | "storage" | null; migrated: boolean } {
  if (!ownerValid(owner)) return { run: null, issue: "invalid", migrated: false };
  const store = storageOrNull(storage);
  if (!store) return { run: null, issue: "storage", migrated: false };
  try {
    const raw = store.getItem(key(owner));
    if (raw !== null) {
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { return { run: null, issue: "invalid", migrated: false }; }
      return valid(parsed, owner) ? { run: parsed, issue: null, migrated: false } : { run: null, issue: "invalid", migrated: false };
    }
    const oldRaw = store.getItem(legacyKey(owner));
    if (oldRaw === null) return { run: null, issue: null, migrated: false };
    let oldEnvelope: unknown;
    try { oldEnvelope = JSON.parse(oldRaw); } catch { return { run: null, issue: "invalid", migrated: false }; }
    if (object(oldEnvelope) && oldEnvelope.run === null &&
        (oldEnvelope.intro === null || oldEnvelope.intro === "complete" || oldEnvelope.intro === "skipped")) {
      return { run: null, issue: null, migrated: false };
    }
    const old = readSoloState(owner, store).run;
    if (!old) return { run: null, issue: "invalid", migrated: false };
    const run: SoloRun = { ...createSoloRun(owner, old.points.startedAtStage ?? 1, legacyId(owner, oldRaw)),
      stage: old.stage, cards: cloneRunCardState(old.cards), points: { ...old.points } };
    if (!valid(run, owner)) return { run: null, issue: "invalid", migrated: false };
    return saveSoloRun(run, store) ? { run, issue: null, migrated: true } : { run, issue: "storage", migrated: true };
  } catch { return { run: null, issue: "storage", migrated: false }; }
}

export function saveSoloRun(run: SoloRun, storage?: Store): boolean {
  if (!valid(run)) return false;
  const store = storageOrNull(storage);
  if (!store) return false;
  try {
    const raw = store.getItem(key(run.owner));
    if (raw !== null) {
      let prior: unknown;
      try { prior = JSON.parse(raw); } catch { return false; }
      if (!valid(prior, run.owner)) return false;
      if (prior.runId !== run.runId) {
        if (prior.phase !== "ended") return false;
        // Replacing an ended run is an explicit new-run action by the caller.
        if (run.revision !== 0) return false;
      } else if (prior.revision > run.revision ||
          (prior.revision === run.revision && raw !== JSON.stringify(run))) return false;
    }
    store.setItem(key(run.owner), JSON.stringify(run));
    return typeof window === "undefined" || store !== window.localStorage || portalStoragePersistent;
  } catch { return false; }
}

/** Explicit fresh-run recovery keeps the damaged/unsupported bytes for later recovery. */
export function replaceInvalidSoloRun(run: SoloRun, storage?: Store): boolean {
  if (!valid(run) || run.revision !== 0) return false;
  const store = storageOrNull(storage);
  if (!store) return false;
  try {
    const raw = store.getItem(key(run.owner));
    if (raw === null) return saveSoloRun(run, store);
    try { if (valid(JSON.parse(raw), run.owner)) return false; } catch {}
    store.setItem(`${key(run.owner)}:invalid:${Date.now()}`, raw);
    store.setItem(key(run.owner), JSON.stringify(run));
    return typeof window === "undefined" || store !== window.localStorage || portalStoragePersistent;
  } catch { return false; }
}

export function recordSoloRunResult(run: SoloRun, winner: "white" | "black" | "draw", choices?: readonly CardId[], summary?: { ownOut: number; enemyOut: number; forced: boolean }): SoloRun {
  requirePhase(run, "stage-ready");
  if (!["white", "black", "draw"].includes(winner)) throw new Error("Invalid result");
  if (summary && (!count(summary.ownOut, 16) || !count(summary.enemyOut, 16) || typeof summary.forced !== "boolean")) throw new Error("Invalid result summary");
  if (winner !== "white") return next(run, { phase: "stage-result", result: { winner, ownOut: summary?.ownOut ?? 0, enemyOut: summary?.enemyOut ?? 0, forced: summary?.forced ?? false } });
  const points = { ...run.points, lastClearedStage: run.stage };
  if (run.stage === 10) return next(run, { phase: "ending", points, endReason: "completed" });
  const eligible = drawUpgradeCards(run.stage, run.cards).map(card => card.id);
  const selected = choices ? [...choices] : eligible;
  if (selected.length < 1 || selected.length > 3 || new Set(selected).size !== selected.length || !selected.every(id => eligible.includes(id))) throw new Error("Invalid card offer");
  return next(run, { phase: "awaiting-card", points, offer: { id: `${run.runId}:${run.stage}`, stage: run.stage, choices: selected, selected: null } });
}

export function chooseSoloRunCard(run: SoloRun, cardId: CardId, effectScale?: number): SoloRun {
  requirePhase(run, "awaiting-card");
  if (!run.offer?.choices.includes(cardId)) throw new Error("Card is not in the saved offer");
  const cards = cloneRunCardState(run.cards);
  applyCardPick(cards, cardId, effectScale);
  return next(run, { stage: run.stage + 1, phase: "preparing-stage", cards, offer: { ...run.offer, selected: cardId } });
}

export function retrySoloRun(run: SoloRun): SoloRun {
  requirePhase(run, "stage-result");
  return next(run, { phase: "stage-ready", result: null });
}

export function readySoloRun(run: SoloRun): SoloRun {
  requirePhase(run, "preparing-stage");
  return next(run, { phase: "stage-ready", offer: null });
}

export function endSoloRun(run: SoloRun, reason: "user-ended" | "completed" = "user-ended"): SoloRun {
  requireRun(run);
  if (run.phase === "ending" || run.phase === "ended") throw new Error("Run already ended");
  if (reason !== "user-ended") throw new Error("Completion follows the stage 10 victory");
  return next(run, { phase: "ending", endReason: reason });
}

export function finishSoloRun(run: SoloRun): SoloRun {
  requirePhase(run, "ending");
  return next(run, { phase: "ended" });
}

export function soloRunPayout(run: SoloRun): number {
  requireRun(run);
  return computeStageRunPayout(run.points.lastClearedStage) - computeStageRunPayout(run.startStage - 1);
}
