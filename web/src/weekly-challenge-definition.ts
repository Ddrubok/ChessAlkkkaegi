import { computeGeneralCardEffect, type CardId, type RunCardState } from "./cards";
import type { LocalPracticeDefinition, WeeklyChallengeDefinition } from "./weekly-challenge-model";

export const WEEKLY_PRIORITY_SLOTS = [
  ["force", "weight", "size"], ["weight", "size", "giantPawn"], ["force", "size", "proneStart"],
  ["force", "weight", "size"], ["force", "size", "giantPawn"], ["weight", "force", "proneStart"],
  ["force", "weight", "size"], ["force", "size", "giantPawn"], ["weight", "size", "proneStart"],
] as const satisfies readonly (readonly CardId[])[];
export const WEEKLY_FALLBACK_ORDER = ["force", "weight", "size", "giantPawn", "proneStart"] as const;
const SOURCE = "source:688bee1a5e931fba9bfbfd930995e73ab12ec206" as const;

function iso(ms: number): string { return new Date(ms).toISOString(); }
function mondayKstBounds(now: Date): { monday: string; startsAt: string; endsAt: string } {
  const kst = new Date(now.getTime() + 9 * 3_600_000);
  const date = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate(), 5));
  if (kst.getUTCHours() < 5) date.setUTCDate(date.getUTCDate() - 1);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1));
  const y = date.getUTCFullYear(), m = String(date.getUTCMonth() + 1).padStart(2, "0"), d = String(date.getUTCDate()).padStart(2, "0");
  const start = date.getTime() - 9 * 3_600_000;
  return { monday: `${y}-${m}-${d}`, startsAt: iso(start), endsAt: iso(start + 7 * 86_400_000) };
}
function canonical(identity: { weekId?: string; localPracticeId?: string; startsAt: string; endsAt: string }): string {
  const identityLine = identity.weekId ? `weekId=${identity.weekId}` : `localPracticeId=${identity.localPracticeId}`;
  return [
    "weekly-challenge-definition-v1", identityLine, `startsAt=${identity.startsAt}`, `endsAt=${identity.endsAt}`,
    "definitionId=W01", "definitionRevision=1", "rulesetVersion=weekly-w01-r1", `stageLayoutVersion=${SOURCE}`,
    "physicsVersion=@dimforge/rapier3d-compat:0.19.3", `aiVersion=${SOURCE}`, "stageCount=10", "playerSide=white",
    "researchEnabled=false", "cardEffectScale=1", "enemyStageBuffScale=1",
    ...WEEKLY_PRIORITY_SLOTS.map((slot, index) => `priority.${index + 1}=${slot.join(",")}`),
    `fallback=${WEEKLY_FALLBACK_ORDER.join(",")}`,
  ].join("\n");
}
async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyWeeklyDefinitionHash(definition: WeeklyChallengeDefinition): Promise<boolean> {
  return definition.definitionHash === await sha256(canonical({
    weekId: definition.weekId,
    startsAt: definition.startsAt,
    endsAt: definition.endsAt,
  }));
}

export async function verifyLocalPracticeDefinitionHash(definition: LocalPracticeDefinition): Promise<boolean> {
  return definition.localDefinitionHash === await sha256(canonical({
    localPracticeId: definition.localPracticeId,
    startsAt: definition.localStartsAt,
    endsAt: definition.localEndsAt,
  }));
}
function common() {
  return { schemaVersion: 1 as const, definitionId: "W01" as const, definitionRevision: 1 as const,
    rulesetVersion: "weekly-w01-r1" as const, stageLayoutVersion: SOURCE,
    physicsVersion: "@dimforge/rapier3d-compat:0.19.3" as const, aiVersion: SOURCE,
    stageCount: 10 as const, playerSide: "white" as const, researchEnabled: false as const,
    cardEffectScale: 1 as const, enemyStageBuffScale: 1 as const,
    prioritySlots: WEEKLY_PRIORITY_SLOTS, fallbackOrder: WEEKLY_FALLBACK_ORDER };
}
export async function createLocalWeeklyDefinition(now = new Date(), weekOffset = 0): Promise<WeeklyChallengeDefinition> {
  const current = mondayKstBounds(new Date(now.getTime() + weekOffset * 7 * 86_400_000));
  const weekId = `weekly:${current.monday}@05:00:Asia/Seoul`;
  const definitionHash = await sha256(canonical({ weekId, startsAt: current.startsAt, endsAt: current.endsAt }));
  return { ...common(), weekId, startsAt: current.startsAt, endsAt: current.endsAt, definitionHash };
}
export async function createFallbackPracticeDefinition(now = new Date(), weekOffset = 0): Promise<LocalPracticeDefinition> {
  const period = mondayKstBounds(new Date(now.getTime() + weekOffset * 7 * 86_400_000));
  const localPracticeId = `practice-local:${period.monday}@05:00:Asia/Seoul:W01:r1`;
  const localDefinitionHash = await sha256(canonical({ localPracticeId, startsAt: period.startsAt, endsAt: period.endsAt }));
  return { ...common(), localPracticeId, localStartsAt: period.startsAt, localEndsAt: period.endsAt, localDefinitionHash };
}
export function isWeeklyCardEligible(cardId: CardId, cards: Readonly<RunCardState>): boolean {
  if (cardId === "force") return cards.forceGrade < 5;
  if (cardId === "weight") return cards.weightGrade < 5;
  if (cardId === "size") return cards.sizeGrade < 5 && 1 + computeGeneralCardEffect(cards, "size", 1) < 1.2;
  if (cardId === "giantPawn") return !cards.giantPawn;
  return !cards.proneStart;
}
export function createWeeklyCardOffer(completedStage: number, cards: Readonly<RunCardState>): CardId[] {
  if (!Number.isInteger(completedStage) || completedStage < 1 || completedStage > 9) return [];
  const chosen: CardId[] = [];
  for (const preferred of WEEKLY_PRIORITY_SLOTS[completedStage - 1]) {
    const preferredChoice = !chosen.includes(preferred) && isWeeklyCardEligible(preferred, cards) ? preferred : undefined;
    const fallback = WEEKLY_FALLBACK_ORDER.find((card) => !chosen.includes(card) && isWeeklyCardEligible(card, cards));
    const choice = preferredChoice ?? fallback;
    if (choice) chosen.push(choice);
  }
  return chosen;
}
