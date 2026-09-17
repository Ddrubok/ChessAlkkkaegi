import type { PieceType } from './config';
import type { MasteryStorage } from './mastery';
import { recordBannerShot, recordBannerVictory } from './banner-progress';

export interface BannerMatch {
  owner: string | null;
  stage: number;
  eligible: boolean;
  comeback: boolean;
  launchType: PieceType | null;
}

export function observeBannerPosition(run: BannerMatch, own: number, enemy: number): void {
  if (run.eligible && own > 0 && own <= 2 && enemy >= 5) run.comeback = true;
}

export function createBannerMatch(owner: string | null, stage: number, eligible: boolean, own: number, enemy: number): BannerMatch {
  const run: BannerMatch = { owner, stage, eligible: eligible && owner !== null, comeback: false, launchType: null };
  observeBannerPosition(run, own, enemy);
  return run;
}

export function settleBannerMatch(storage: MasteryStorage & { owner: string | null }, run: BannerMatch, input: {
  eventId: string | null; enemyPieceIds: string[]; ownRemaining: number; enemyRemaining: number;
  playerLaunch: boolean; eligible: boolean;
}): void {
  run.eligible &&= input.eligible && storage.owner !== null && storage.owner === run.owner;
  observeBannerPosition(run, input.ownRemaining, input.enemyRemaining);
  if (run.eligible && input.playerLaunch && input.eventId && run.launchType) {
    recordBannerShot(storage, { eventId: input.eventId, pieceType: run.launchType, enemyPieceIds: input.enemyPieceIds });
  }
  run.launchType = null;
}

export function finishBannerMatch(storage: MasteryStorage & { owner: string | null }, run: BannerMatch, eventId: string, victory: boolean): void {
  if (victory && run.eligible && storage.owner !== null && storage.owner === run.owner) {
    recordBannerVictory(storage, { eventId, stage: run.stage, comebackEligible: run.comeback });
  }
  run.eligible = false;
}
