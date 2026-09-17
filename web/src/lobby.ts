import type { MainMenuRuntime } from "./menu";
import { getMaxClearedStage, type MetaRuntime } from "./meta";
import { I18nManager } from "./i18n";
import type { UserProfile } from "./supabase-auth";
import { escapeHtml } from "./html";
import { formatTier, renderTierBadge } from "./tier-view";
import { isBasicTutorialCompleted, pickLobbyRecommendation } from "./lobby-recommendation";
import { resolveRuntimeAssetUrl } from "./portable-assets";
import { progressStorage } from "./progress-storage";
import { PUZZLE_CATALOG, getPuzzleProgress, loadPuzzleProgress } from "./puzzle";
import { equippedItem, loadMasterySnapshot } from "./mastery";
import { masteryCopy, renderMasteryProfileSummary } from "./mastery-ui";
import { questStorage } from "./quest-storage";
import { renderQuestProfileSummary } from "./quest-ui";

export const PVE_MAX_STAGE = 10;
export const lobbyState = { profileExpanded: false, tutorialExpanded: false };
export type LobbyMode = "stage" | "puzzle" | "online" | "hotseat" | "tutorial";

export function getInitialStage(storage: MetaRuntime["storage"]): number {
  return Math.min(PVE_MAX_STAGE, getMaxClearedStage(storage) + 1);
}

export function readLobbyStorage(key: string): string | null {
  try {
    return progressStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeRuntimeAssetUrl(asset: Parameters<typeof resolveRuntimeAssetUrl>[0]): string {
  try {
    return resolveRuntimeAssetUrl(asset);
  } catch {
    return "";
  }
}

export type HeaderActionIcon = "ranking" | "friends" | "settings" | "profile" | "tutorial" | "trophy" | "users" | "gear" | "globe" | "flag" | "bulb" | "gamepad" | "chevron" | "logout";

export function renderHeaderActions(options?: { showLogout?: boolean }): string;
export function renderHeaderActions(name: HeaderActionIcon, iconSize?: number): string;
export function renderHeaderActions(nameOrOptions?: HeaderActionIcon | { showLogout?: boolean }, iconSize = 16): string {
  if (typeof nameOrOptions !== "string") {
    const showLogout = nameOrOptions?.showLogout === true;
    const logout = showLogout ? `<button id="btn-logout" type="button" class="lobby-icon-btn" aria-label="${escapeHtml(I18nManager.t("common.logout"))}" title="${escapeHtml(I18nManager.t("common.logout"))}">${renderHeaderActions("logout", 20)}</button>` : "";
    return `<div class="lobby-header-actions">${logout}<button id="menu-ranking-btn" type="button" class="lobby-icon-btn" aria-label="${escapeHtml(I18nManager.t("common.ranking_btn"))}" title="${escapeHtml(I18nManager.t("common.ranking_btn"))}">${renderHeaderActions("trophy", 20)}</button><button id="menu-friends-btn" type="button" class="lobby-icon-btn" aria-label="${escapeHtml(I18nManager.t("common.friends_btn"))}" title="${escapeHtml(I18nManager.t("common.friends_btn"))}">${renderHeaderActions("users", 20)}</button><button id="menu-sound-btn" type="button" class="lobby-icon-btn" aria-label="${escapeHtml(I18nManager.t("common.settings"))}" title="${escapeHtml(I18nManager.t("common.settings"))}">${renderHeaderActions("gear", 20)}</button></div>`;
  }
  const name = nameOrOptions;
  const paths: Record<typeof name, string> = {
    ranking: '<path d="M5 19v-8m7 8V5m7 14v-5"/><path d="M3 19h18"/>',
    friends: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3.5 19c.4-3.1 2.2-4.7 5.5-4.7s5.1 1.6 5.5 4.7M14 14.8c2.9-.4 5.1 1 5.6 4.2"/>',
    settings: '<path d="M12 8.7a3.3 3.3 0 1 0 0 6.6 3.3 3.3 0 0 0 0-6.6Z"/><path d="m19.4 15 .1.1-1.7 2.9-.2-.1a2 2 0 0 0-2.1 0l-.2.1-1.7-2.9.1-.1a2 2 0 0 0 0-2.2l-.1-.1 1.7-2.9.2.1a2 2 0 0 0 2.1 0l.2-.1 1.7 2.9-.1.1a2 2 0 0 0 0 2.2ZM4.6 15l-.1.1 1.7 2.9.2-.1a2 2 0 0 1 2.1 0l.2.1 1.7-2.9-.1-.1a2 2 0 0 1 0-2.2l.1-.1-1.7-2.9-.2.1a2 2 0 0 1-2.1 0l-.2-.1-1.7 2.9.1.1a2 2 0 0 1 0 2.2Z"/>',
    profile: '<circle cx="12" cy="8" r="3.2"/><path d="M5 20c.5-3.4 2.8-5.2 7-5.2s6.5 1.8 7 5.2"/>',
    tutorial: '<circle cx="12" cy="12" r="8.5"/><path d="M12 10.5v5M12 7.5h.01"/>',
    trophy: '<path d="M8 5h8v4a4 4 0 0 1-8 0V5Z"/><path d="M8 7H5v1a3 3 0 0 0 3 3M16 7h3v1a3 3 0 0 1-3 3M12 13v4M8 20h8M9 17h6"/>',
    users: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3.5 19c.4-3.1 2.2-4.7 5.5-4.7s5.1 1.6 5.5 4.7M14 14.8c2.9-.4 5.1 1 5.6 4.2"/>',
    gear: '<circle cx="12" cy="12" r="3.2"/><path d="m19 13 .1.1-1.2 2.1-.2-.1a2 2 0 0 0-2.1 0l-.2.1-1.2-2.1.1-.1a2.1 2.1 0 0 0 0-2.1l-.1-.1 1.2-2.1.2.1a2 2 0 0 0 2.1 0l.2-.1 1.2 2.1-.1.1A2.1 2.1 0 0 0 19 13ZM5 13l-.1.1 1.2 2.1.2-.1a2 2 0 0 1 2.1 0l.2.1 1.2-2.1-.1-.1a2.1 2.1 0 0 1 0-2.1l.1-.1-1.2-2.1-.2.1a2 2 0 0 1-2.1 0l-.2-.1-1.2 2.1.1.1A2.1 2.1 0 0 1 5 13Z"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.2 2.4 3.2 5.2 3.2 8.5S14.2 18.1 12 20.5c-2.2-2.4-3.2-5.2-3.2-8.5S9.8 5.9 12 3.5Z"/>',
    flag: '<path d="M5 20V4m0 1c4-2 6 2 10 0v8c-4 2-6-2-10 0"/>',
    bulb: '<path d="M9 18h6M10 21h4"/><path d="M8.5 14.5A5 5 0 1 1 15.5 14c-.9.7-1.5 1.6-1.5 2.8h-4c0-1.2-.6-2.1-1.5-2.8Z"/>',
    gamepad: '<path d="M7 9h10a4 4 0 0 1 3.8 5.2l-1 3.1a2.4 2.4 0 0 1-4.2.7L14 16H10l-1.6 2a2.4 2.4 0 0 1-4.2-.7l-1-3.1A4 4 0 0 1 7 9Z"/><path d="M7 12v3m-1.5-1.5h3M16.5 13h.01M18.5 14.5h.01"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    logout: '<path d="M10 17l5-5-5-5M15 12H3"/><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" width="${iconSize}" height="${iconSize}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
}

export function getRecommendation(runtime: MainMenuRuntime): { mode: LobbyMode; tutorialType: "basic" | "advanced"; stage: number; assetId: "lobbyHeroStage" | "lobbyHeroTutorial" | "lobbyAvatar"; eyebrow: string; title: string; body: string; cta: string } {
  const basicTutorialCompleted = isBasicTutorialCompleted(readLobbyStorage("has_completed_tutorial"));
  const picked = pickLobbyRecommendation({
    basicTutorialCompleted,
    maxClearedStage: getMaxClearedStage(runtime.metaRuntime.storage),
    maxStage: PVE_MAX_STAGE,
  });
  const recommendation = picked;
  if (recommendation.kind === "tutorial") {
    return {
      mode: "tutorial",
      tutorialType: "basic",
      stage: 1,
      assetId: "lobbyHeroTutorial",
      eyebrow: I18nManager.t("lobby.hero_eyebrow_new"),
      title: I18nManager.t("lobby.hero_title_tutorial"),
      body: I18nManager.t("lobby.hero_sub_tutorial"),
      cta: I18nManager.t("lobby.hero_cta_tutorial"),
    };
  }
  if (recommendation.kind === "online") {
    return {
      mode: "online",
      tutorialType: "basic",
      stage: 1,
      assetId: "lobbyHeroTutorial",
      eyebrow: I18nManager.t("lobby.hero_eyebrow_ranked"),
      title: I18nManager.t("lobby.mode_online"),
      body: I18nManager.t("lobby.hero_sub_online", { tier: formatTier(runtime.userProfile?.classicMmr ?? runtime.userProfile?.mmr ?? 1200), wins: runtime.userProfile?.classicWins ?? 0, losses: runtime.userProfile?.classicLosses ?? 0 }),
      cta: I18nManager.t("lobby.hero_cta_online"),
    };
  }
  const stage = recommendation.stage;
  return {
    mode: "stage",
    tutorialType: "basic",
    stage,
    assetId: "lobbyHeroStage",
    eyebrow: I18nManager.t("lobby.hero_eyebrow_continue"),
    title: I18nManager.t("lobby.hero_title_stage", { stage }),
    body: I18nManager.t("lobby.hero_sub_stage", { cleared: getMaxClearedStage(runtime.metaRuntime.storage), max: PVE_MAX_STAGE, points: runtime.metaRuntime.state.points }),
    cta: I18nManager.t("lobby.hero_cta_stage"),
  };
}

export function renderProfileChip(user: UserProfile): string {
  const avatar = safeRuntimeAssetUrl("lobbyAvatar");
  const snapshot = loadMasterySnapshot(progressStorage);
  const frame = equippedItem(snapshot, "frame");
  const title = equippedItem(snapshot, "title") === "title:explorer" ? masteryCopy().explorer : "";
  return `<button type="button" id="menu-profile-btn" class="lobby-chip${frame ? " mastery-frame-equipped" : ""}" data-profile-toggle aria-expanded="${lobbyState.profileExpanded}" aria-controls="menu-profile-panel" aria-label="${escapeHtml(I18nManager.t("lobby.profile_chip_open"))}"><img src="${escapeHtml(avatar)}" alt="" width="30" height="30"><span class="lobby-chip-name">${escapeHtml(user.nickname)}${title ? `<small class="mastery-equipped-title">${escapeHtml(title)}</small>` : ""}</span><span class="lobby-chip-tier">${renderTierBadge(user.classicMmr ?? user.mmr, false)}</span><span class="lobby-chip-chevron">${renderHeaderActions("chevron")}</span></button>`;
}

export function renderRecommendationCard(recommendation: ReturnType<typeof getRecommendation>, heroAsset: string): string {
  return `<section class="lobby-hero" data-kind="${escapeHtml(recommendation.mode)}"><img class="lobby-hero-media" src="${escapeHtml(heroAsset)}" alt=""><div class="lobby-hero-scrim"></div><div class="lobby-hero-content"><div><span class="lobby-hero-eyebrow">${escapeHtml(recommendation.eyebrow)}</span><h2 class="lobby-hero-title">${escapeHtml(recommendation.title)}</h2><p class="lobby-hero-sub">${escapeHtml(recommendation.body)}</p></div><button type="button" id="menu-recommendation-btn" class="lobby-cta">${escapeHtml(recommendation.cta)}</button></div></section>`;
}

export function renderModeCards(runtime: MainMenuRuntime, maxClearedStage: number): string {
  const cards = [
    { mode: "online" as const, icon: "globe" as const, label: "lobby.mode_online", status: "lobby.card_online_status", detail: "" },
    { mode: "stage" as const, icon: "flag" as const, label: "lobby.mode_stage_short", status: "lobby.card_stage_status", detail: "" },
    { mode: "puzzle" as const, icon: "bulb" as const, label: "lobby.mode_puzzle", status: "lobby.card_puzzle_status", detail: "" },
    { mode: "hotseat" as const, icon: "gamepad" as const, label: "lobby.mode_2p_short", status: "lobby.card_2p_status", detail: "" },
  ];
  const puzzleProgress = loadPuzzleProgress();
  const puzzleCount = PUZZLE_CATALOG.filter(puzzle =>
    (getPuzzleProgress(puzzleProgress, puzzle.puzzleId, puzzle.revision)?.bestMedal ?? 0) > 0).length;
  const statusByMode: Record<LobbyMode, string> = {
    stage: I18nManager.t("lobby.card_stage_status", { cleared: maxClearedStage, max: PVE_MAX_STAGE }),
    puzzle: I18nManager.t("lobby.card_puzzle_status", { count: puzzleCount }),
    online: I18nManager.t("lobby.card_online_status", { tier: formatTier(runtime.userProfile?.classicMmr ?? runtime.userProfile?.mmr ?? 1200), wins: runtime.userProfile?.classicWins ?? 0, losses: runtime.userProfile?.classicLosses ?? 0 }),
    hotseat: I18nManager.t("lobby.card_2p_status"),
    tutorial: "",
  };
  return `<div class="lobby-modes" role="group" aria-label="${escapeHtml(I18nManager.t("lobby.title"))}">${cards.map((card) => `<button type="button"${card.mode === "puzzle" ? ' id="menu-puzzle-btn"' : ""} data-game-mode="${card.mode}" class="lobby-mode" ${card.mode === "puzzle" && !runtime.onOpenPuzzles ? "disabled" : ""}><span class="lobby-mode-icon">${renderHeaderActions(card.icon)}</span><span class="lobby-mode-title">${escapeHtml(I18nManager.t(card.label))}</span><small class="lobby-mode-status" data-mode-status="${card.mode}">${escapeHtml(statusByMode[card.mode])}</small></button>`).join("")}</div>`;
}

export function renderFooterLinks(): string {
  return `<nav class="lobby-footer" aria-label="${escapeHtml(I18nManager.t("lobby.footer_guide"))}"><a href="./guide.html">${escapeHtml(I18nManager.t("lobby.footer_guide"))}</a><a href="./updates.html">${escapeHtml(I18nManager.t("lobby.footer_updates"))}</a><a href="./privacy.html">${escapeHtml(I18nManager.t("lobby.footer_privacy"))}</a></nav>`;
}

export function renderProfilePanel(user: UserProfile, points: number): string {
  const inert = lobbyState.profileExpanded ? "" : " inert";
  return `<div class="lobby-profile-body"><div id="menu-profile-panel" class="lobby-profile-panel" aria-hidden="${!lobbyState.profileExpanded}"${inert}><p class="lobby-profile-points">${escapeHtml(I18nManager.t("common.points"))} <strong>${points} P</strong></p><div class="menu-tier-columns"><div class="menu-tier-column"><div class="tier-label tier-label-classic">${I18nManager.t("online.classic_tab")}</div><div>${renderTierBadge(user.classicMmr ?? user.mmr, true)}</div><div class="menu-tier-record">${escapeHtml(I18nManager.t("lobby.win_draw_loss", { wins: user.classicWins ?? 0, draws: user.classicDraws ?? 0, losses: user.classicLosses ?? 0 }))}</div></div><div class="menu-tier-column"><div class="tier-label tier-label-strategy">${I18nManager.t("online.strategy_tab")}</div><div>${renderTierBadge(user.strategyMmr ?? user.mmr, true)}</div><div class="menu-tier-record">${escapeHtml(I18nManager.t("lobby.win_draw_loss", { wins: user.strategyWins ?? 0, draws: user.strategyDraws ?? 0, losses: user.strategyLosses ?? 0 }))}</div></div></div>${renderMasteryProfileSummary(progressStorage)}${renderQuestProfileSummary(questStorage)}</div></div>`;
}

export function renderProfileCard(user: UserProfile, points: number): string {
  const expanded = lobbyState.profileExpanded ? " is-expanded" : "";
  return `<div class="lobby-profile${expanded}" data-expanded="${lobbyState.profileExpanded}">${renderProfileChip(user)}${renderProfilePanel(user, points)}</div>`;
}

export function renderTutorialBar(): string {
  const inert = lobbyState.tutorialExpanded ? "" : " inert";
  return `<section class="lobby-tutorial" data-expanded="${lobbyState.tutorialExpanded}"><button type="button" id="menu-tutorial-btn" class="lobby-tutorial-bar" aria-expanded="${lobbyState.tutorialExpanded}" aria-controls="menu-tutorial-panel"><span class="lobby-tutorial-icon"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11a2 2 0 0 1 2 2v15a2 2 0 0 0-2-2H6.5A2.5 2.5 0 0 0 4 20.5Z"/><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v17a2 2 0 0 1 2-2h2.5a2.5 2.5 0 0 1 2.5 2.5Z"/></svg></span><span class="lobby-tutorial-label">${escapeHtml(I18nManager.t("lobby.footer_tutorial"))}</span><span class="lobby-chip-chevron">${renderHeaderActions("chevron")}</span></button><div class="lobby-tutorial-body"><div id="menu-tutorial-panel" class="lobby-tutorial-panel" aria-hidden="${!lobbyState.tutorialExpanded}"${inert}><button type="button" class="lobby-tutorial-choice" data-game-mode="tutorial" data-tutorial-type="basic">${escapeHtml(I18nManager.t("lobby.tutorial_basic"))}</button><button type="button" class="lobby-tutorial-choice" data-game-mode="tutorial" data-tutorial-type="advanced">${escapeHtml(I18nManager.t("lobby.tutorial_advanced"))}</button></div></div></section>`;
}
