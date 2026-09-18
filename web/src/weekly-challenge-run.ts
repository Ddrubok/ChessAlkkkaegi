import { applyCardPick, createRunCardState, type CardId, type RunCardState } from "./cards";
import { createWeeklyCardOffer } from "./weekly-challenge-definition";
import type { WeeklyChallengeDefinition, WeeklyChallengeOutcome, WeeklyChallengePracticeRun, WeeklyChallengeScore } from "./weekly-challenge-model";

export function compareWeeklyScores(a: WeeklyChallengeScore, b: WeeklyChallengeScore): number {
  return a.completedStages !== b.completedStages
    ? a.completedStages - b.completedStages
    : b.completedStageOwnTurns - a.completedStageOwnTurns;
}
export function createPracticeRun(definition: WeeklyChallengePracticeRun["definition"]): WeeklyChallengePracticeRun {
  return { definition, stage: 1, score: { completedStages: 0, completedStageOwnTurns: 0 }, cards: createRunCardState(), stageOwnTurns: 0, pendingOffer: null, status: "ready-for-stage", endedBy: null };
}
export function countWeeklySettledTurn(run: WeeklyChallengePracticeRun, finishedSide: "white" | "black"): void {
  if (run.status === "playing" && finishedSide === "white") run.stageOwnTurns += 1;
}
export function finishWeeklyStage(run: WeeklyChallengePracticeRun, outcome: WeeklyChallengeOutcome, offerId = crypto.randomUUID()): void {
  if (run.status !== "playing") throw new Error("Weekly challenge stage is not playing.");
  if (outcome !== "white-win") { run.status = "finished"; run.endedBy = outcome; return; }
  run.score = { completedStages: run.stage, completedStageOwnTurns: run.score.completedStageOwnTurns + run.stageOwnTurns };
  if (run.stage === 10) { run.status = "finished"; run.endedBy = "white-win"; return; }
  const choices = createWeeklyCardOffer(run.stage, run.cards);
  if (choices.length === 0) { run.stage += 1; run.stageOwnTurns = 0; run.status = "ready-for-stage"; return; }
  run.pendingOffer = { offerId, completedStage: run.stage, choices };
  run.status = "awaiting-card";
}
export function pickWeeklyCard(run: WeeklyChallengePracticeRun, cardId: CardId): void {
  if (run.status !== "awaiting-card" || !run.pendingOffer?.choices.includes(cardId)) throw new Error("Invalid weekly challenge card choice.");
  applyCardPick(run.cards as RunCardState, cardId, 1);
  run.stage += 1; run.stageOwnTurns = 0; run.pendingOffer = null; run.status = "ready-for-stage";
}
export function isServerDefinition(value: WeeklyChallengePracticeRun["definition"]): value is WeeklyChallengeDefinition {
  return "weekId" in value;
}
