import { getTier, KING_MMR, QUEEN_MMR, DIVISION_MMR, TIER_START_MMR } from "./tier";
import { I18nManager } from "./i18n";
import { escapeHtml } from "./html";

const SYMBOLS = { pawn: "♟", knight: "♞", bishop: "♝", rook: "♜", queen: "♛", king: "♚" };

export function formatTier(mmr: number): string {
  const tier = getTier(mmr);
  const name = I18nManager.t(`lobby.piece_${tier.piece}`);
  if (tier.piece === "king") return `${name} · ${I18nManager.t("tier.points", { points: tier.points })}`;
  return tier.division === null ? name : `${name} ${tier.division}`;
}

export function formatTierProgress(mmr: number): string {
  const tier = getTier(mmr);
  return tier.pointsToNext === null
    ? I18nManager.t("tier.king_progress")
    : I18nManager.t("tier.next", { tier: tier.piece === "queen" ? I18nManager.t("lobby.piece_king") : formatTier(tier.mmr + tier.pointsToNext), points: tier.pointsToNext });
}

export function renderTierBadge(mmr: number, showProgress = false): string {
  const tier = getTier(mmr);
  const label = escapeHtml(formatTier(mmr));
  const detail = escapeHtml(formatTierProgress(mmr));
  return `<span class="tier-badge tier-${tier.piece}" title="${label} · MMR ${tier.mmr}"><span class="tier-emblem" aria-hidden="true">${SYMBOLS[tier.piece]}</span><span class="tier-label">${label}</span></span>` +
    (showProgress && tier.pointsToNext !== null ? `<span class="tier-progress-text">${detail}</span><progress class="tier-progress" max="1" value="${tier.progress}" aria-label="${detail}"></progress>` : "");
}

export function renderTierGuide(): string {
  const examples = [TIER_START_MMR, TIER_START_MMR + 5 * DIVISION_MMR, TIER_START_MMR + 10 * DIVISION_MMR, TIER_START_MMR + 15 * DIVISION_MMR];
  const ladder = examples.map(mmr => `${formatTier(mmr)} → ${formatTier(mmr + 4 * DIVISION_MMR)}`).join(" → ");
  return `<details class="tier-guide"><summary>${escapeHtml(I18nManager.t("tier.guide"))}</summary><p>${escapeHtml(ladder)} → ${escapeHtml(formatTier(KING_MMR - 1))} → ${escapeHtml(I18nManager.t("lobby.piece_king"))}</p><p>${escapeHtml(I18nManager.t("tier.rules", { start: TIER_START_MMR, step: DIVISION_MMR, queen: QUEEN_MMR, king: KING_MMR }))}</p></details>`;
}
