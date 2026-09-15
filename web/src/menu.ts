import type { PieceType } from "./config";
import type { GameMode } from "./game-mode";
import { getMaxClearedStage, type MetaRuntime } from "./meta";
import { createPermanentResearchAdapter } from "./permanent-research-adapter";
import { PieceStatWorkbench, bindWorkbenchModal } from "./piece-stat-workbench";
import type { PiecePreviewServices } from "./piece-preview-renderer";
import { openSettingsModal } from "./settings-modal";
import { openRankingModal } from "./ranking-modal";
import { openFriendsModal } from "./friends-modal";
import { I18nManager } from "./i18n";
import { SocialService } from "./social-service";
import {
  getOrCreateUserProfile,
  signInWithEmail,
  signUpWithEmail,
  signOutUser,
  type UserProfile,
} from "./supabase-auth";
import { getSupabaseClient } from "./supabase-client";
import { AdManager } from "./ad-manager";
import { escapeHtml } from "./html";
import { formatTier, renderTierBadge } from "./tier-view";
import { isBasicTutorialCompleted, pickLobbyRecommendation } from "./lobby-recommendation";
import { resolveRuntimeAssetUrl } from "./portable-assets";
import { progressStorage } from "./progress-storage";
import { PUZZLE_CATALOG, getPuzzleProgress, loadPuzzleProgress } from "./puzzle";

const PVE_MAX_STAGE = 10;
let lobbyProfileExpanded = false;
type LobbyMode = "stage" | "puzzle" | "online" | "hotseat" | "tutorial";

function getInitialStage(storage: MetaRuntime["storage"]): number {
  return Math.min(PVE_MAX_STAGE, getMaxClearedStage(storage) + 1);
}

function readLobbyStorage(key: string): string | null {
  try {
    return progressStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeRuntimeAssetUrl(asset: Parameters<typeof resolveRuntimeAssetUrl>[0]): string {
  try {
    return resolveRuntimeAssetUrl(asset);
  } catch {
    return "";
  }
}

type HeaderActionIcon = "ranking" | "friends" | "settings" | "profile" | "tutorial" | "trophy" | "users" | "gear" | "globe" | "flag" | "bulb" | "gamepad" | "chevron" | "logout";

function renderHeaderActions(options?: { showLogout?: boolean }): string;
function renderHeaderActions(name: HeaderActionIcon, iconSize?: number): string;
function renderHeaderActions(nameOrOptions?: HeaderActionIcon | { showLogout?: boolean }, iconSize = 16): string {
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

function openLobbySheet(
  overlay: HTMLElement,
  options: {
    title: string;
    bodyHtml: string;
    onMount?: (sheet: HTMLElement, close: () => void) => void;
  },
): void {
  const sheet = document.createElement("section");
  sheet.className = "lobby-sheet-overlay";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.tabIndex = -1;
  sheet.innerHTML = `<div class="lobby-sheet"><div class="lobby-sheet-handle" aria-hidden="true"></div><header class="lobby-sheet-header"><h2 id="lobby-sheet-title">${escapeHtml(options.title)}</h2><button type="button" class="lobby-sheet-close" aria-label="${escapeHtml(I18nManager.t("common.close"))}">${I18nManager.t("common.close")}</button></header><div class="lobby-sheet-body">${options.bodyHtml}</div></div>`;
  sheet.setAttribute("aria-labelledby", "lobby-sheet-title");
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const close = () => {
    sheet.remove();
    previousFocus?.focus();
  };
  sheet.addEventListener("click", (event) => {
    if (event.target === sheet) close();
  });
  sheet.querySelector<HTMLButtonElement>(".lobby-sheet-close")?.addEventListener("click", close);
  sheet.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  });
  overlay.append(sheet);
  options.onMount?.(sheet, close);
  sheet.querySelector<HTMLButtonElement>(".lobby-sheet-close")?.focus();
}

function getRecommendation(runtime: MainMenuRuntime): { mode: LobbyMode; tutorialType: "basic" | "advanced"; stage: number; assetId: "lobbyHeroStage" | "lobbyHeroTutorial" | "lobbyAvatar"; eyebrow: string; title: string; body: string; cta: string } {
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

function renderProfileChip(user: UserProfile): string {
  const avatar = safeRuntimeAssetUrl("lobbyAvatar");
  return `<button type="button" id="menu-profile-btn" class="lobby-chip" data-profile-toggle aria-expanded="${lobbyProfileExpanded}" aria-controls="menu-profile-panel" aria-label="${escapeHtml(I18nManager.t("lobby.profile_chip_open"))}"><img src="${escapeHtml(avatar)}" alt="" width="30" height="30"><span class="lobby-chip-name">${escapeHtml(user.nickname)}</span><span class="lobby-chip-tier">${renderTierBadge(user.classicMmr ?? user.mmr, false)}</span><span class="lobby-chip-chevron">${renderHeaderActions("chevron")}</span></button>`;
}

function renderRecommendationCard(recommendation: ReturnType<typeof getRecommendation>, heroAsset: string): string {
  return `<section class="lobby-hero" data-kind="${escapeHtml(recommendation.mode)}"><img class="lobby-hero-media" src="${escapeHtml(heroAsset)}" alt=""><div class="lobby-hero-scrim"></div><div class="lobby-hero-content"><div><span class="lobby-hero-eyebrow">${escapeHtml(recommendation.eyebrow)}</span><h2 class="lobby-hero-title">${escapeHtml(recommendation.title)}</h2><p class="lobby-hero-sub">${escapeHtml(recommendation.body)}</p></div><button type="button" id="menu-recommendation-btn" class="lobby-cta">${escapeHtml(recommendation.cta)}</button></div></section>`;
}

function renderModeCards(runtime: MainMenuRuntime, maxClearedStage: number): string {
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

function renderFooterLinks(): string {
  return `<nav class="lobby-footer" aria-label="${escapeHtml(I18nManager.t("lobby.footer_guide"))}"><button type="button" data-lobby-footer="tutorial">${escapeHtml(I18nManager.t("lobby.footer_tutorial"))}</button><a href="./guide.html">${escapeHtml(I18nManager.t("lobby.footer_guide"))}</a><a href="./updates.html">${escapeHtml(I18nManager.t("lobby.footer_updates"))}</a><a href="./privacy.html">${escapeHtml(I18nManager.t("lobby.footer_privacy"))}</a></nav>`;
}

function renderProfilePanel(user: UserProfile, points: number): string {
  const inert = lobbyProfileExpanded ? "" : " inert";
  return `<div class="lobby-profile-body"><div id="menu-profile-panel" class="lobby-profile-panel" aria-hidden="${!lobbyProfileExpanded}"${inert}><p class="lobby-profile-points">${escapeHtml(I18nManager.t("common.points"))} <strong>${points} P</strong></p><div class="menu-tier-columns"><div class="menu-tier-column"><div class="tier-label tier-label-classic">${I18nManager.t("online.classic_tab")}</div><div>${renderTierBadge(user.classicMmr ?? user.mmr, true)}</div><div class="menu-tier-record">${escapeHtml(I18nManager.t("lobby.win_draw_loss", { wins: user.classicWins ?? 0, draws: user.classicDraws ?? 0, losses: user.classicLosses ?? 0 }))}</div></div><div class="menu-tier-column"><div class="tier-label tier-label-strategy">${I18nManager.t("online.strategy_tab")}</div><div>${renderTierBadge(user.strategyMmr ?? user.mmr, true)}</div><div class="menu-tier-record">${escapeHtml(I18nManager.t("lobby.win_draw_loss", { wins: user.strategyWins ?? 0, draws: user.strategyDraws ?? 0, losses: user.strategyLosses ?? 0 }))}</div></div></div></div></div>`;
}

function renderProfileCard(user: UserProfile, points: number): string {
  const expanded = lobbyProfileExpanded ? " is-expanded" : "";
  return `<div class="lobby-profile${expanded}" data-expanded="${lobbyProfileExpanded}">${renderProfileChip(user)}${renderProfilePanel(user, points)}</div>`;
}

function openTutorialSheet(runtime: MainMenuRuntime): void {
  openLobbySheet(runtime.overlay, {
    title: I18nManager.t("lobby.tutorial_sheet_title"),
    bodyHtml: `<div class="lobby-tutorial-sheet"><p class="lobby-tutorial-copy">${escapeHtml(I18nManager.t("lobby.hero_sub_tutorial"))}</p><div class="lobby-tutorial-actions"><button type="button" data-sheet-mode="tutorial" data-tutorial-type="basic" class="lobby-sheet-action">${escapeHtml(I18nManager.t("lobby.tutorial_basic"))}</button><button type="button" data-sheet-mode="tutorial" data-tutorial-type="advanced" class="lobby-sheet-action">${escapeHtml(I18nManager.t("lobby.tutorial_advanced"))}</button></div></div>`,
    onMount: (sheet, close) => sheet.querySelectorAll<HTMLButtonElement>("[data-sheet-mode]").forEach((button) => button.addEventListener("click", () => { const type = (button.dataset.tutorialType as "basic" | "advanced") ?? "basic"; close(); void startLobbyMode(runtime, "tutorial", 1, type); })),
  });
}

async function startLobbyMode(
  runtime: MainMenuRuntime,
  mode: LobbyMode,
  selectedStage = getInitialStage(runtime.metaRuntime.storage),
  tutorialType: "basic" | "advanced" = "basic",
): Promise<void> {
  if (runtime.busy || !runtime.ready || !progressStorage.ready) return;
  if (mode === "puzzle") {
    runtime.onOpenPuzzles?.();
    return;
  }
  runtime.busy = true;
  renderMainMenu(runtime);
  try {
    if (mode === "tutorial") await runtime.onStartMode("tutorial", 1, tutorialType);
    else if (mode === "stage") await runtime.onStartMode("stage", selectedStage);
    else await runtime.onStartMode(mode);
    hideMainMenuAfterModeStart(runtime);
  } catch (error: unknown) {
    console.error(error);
    const status = runtime.overlay.querySelector<HTMLElement>("[data-menu-status]");
    runtime.busy = false;
    renderMainMenu(runtime);
    const nextStatus = runtime.overlay.querySelector<HTMLElement>("[data-menu-status]");
    const message = mode === "stage"
      ? "스테이지 대전을 시작하지 못했습니다."
      : "대전을 시작하지 못했습니다.";
    if (nextStatus) nextStatus.textContent = message;
    else if (status) status.textContent = message;
  }
}

export interface MainMenuRuntime {
  overlay: HTMLElement;
  returnButton: HTMLButtonElement;
  confirmOverlay: HTMLElement;
  metaRuntime: MetaRuntime;
  piecePreviewServices: PiecePreviewServices | null;
  closePveLobby?: () => void;
  ready: boolean;
  busy: boolean;
  visible: boolean;
  confirming: boolean;
  userProfile: UserProfile | null;
  onStartMode: (mode: GameMode, selectedStage?: number, tutorialType?: "basic" | "advanced") => Promise<void>;
  /** 퍼즐 목록을 여는 선택적 연결점입니다. 퍼즐 모듈이 없는 빌드에서는 버튼을 숨깁니다. */
  onOpenPuzzles?: () => void;
  onReturnToMenu: () => Promise<void>;
  onConfirmAbandon: () => Promise<void>;
  onStartFriendlyMatch?: (friend: any, roomId: string, isHost: boolean) => Promise<void> | void;
}

/**
 * PVE 로비 모달 (스테이지 선택 + 영구 강화 테크트리)을 연다.
 */
export function openPveLobbyModal(
  runtime: MainMenuRuntime,
  onStartStage: (stage: number) => Promise<void>,
  initialStage?: number,
): void {
  if (!progressStorage.ready) return;
  const modal = document.createElement("div");
  runtime.closePveLobby?.();
  modal.className = "pve-lobby-modal piece-stat-modal";
  modal.setAttribute("aria-label", I18nManager.t("lobby.stage_modal_title"));
  const card = document.createElement("div");
  card.className = "piece-stat-modal-card";
  const adapter = createPermanentResearchAdapter(runtime.metaRuntime);
  let workbench: PieceStatWorkbench | null = null;
  let selectedPiece: PieceType = "Pawn";
  const unsubscribeLang = I18nManager.subscribe(() => {
    if (modal.isConnected) renderContent();
  });
  const close = () => {
    unsubscribeLang();
    workbench?.dispose(); workbench = null;
    modal.remove(); runtime.closePveLobby = undefined;
    renderMainMenu(runtime); unbindModal();
    runtime.overlay.querySelector<HTMLButtonElement>('[data-game-mode="stage"]')?.focus();
  };
  const unbindModal = bindWorkbenchModal(modal, close);
  runtime.closePveLobby = close;

  let activeTab: "stages" | "upgrades" = "stages";
  let selectedStage = Math.min(PVE_MAX_STAGE, Math.max(1, initialStage ?? 1));

  const renderContent = () => {
    if (workbench) selectedPiece = workbench.selection;
    workbench?.dispose(); workbench = null;
    card.dataset.activeTab = activeTab;
    modal.setAttribute("aria-label", I18nManager.t("lobby.stage_modal_title"));
    card.innerHTML = `
      <header class="pve-lobby-header">
        <h2>${I18nManager.t("lobby.stage_modal_title")}</h2>
        <div class="pve-lobby-header-actions">
          <span id="pve-points-held">${I18nManager.t("lobby.stage_points_held", { points: runtime.metaRuntime.state.points })}</span>
          <button type="button" id="pve-close-btn">${I18nManager.t("common.close")}</button>
        </div>
      </header>

      <div class="pve-lobby-tabs" role="tablist" aria-label="${I18nManager.t("lobby.stage_modal_title")}">
        <button type="button" id="tab-stages" role="tab" aria-selected="${activeTab === "stages"}" aria-controls="pve-tab-body">${I18nManager.t("lobby.stage_tab_stages")}</button>
        <button type="button" id="tab-upgrades" role="tab" aria-selected="${activeTab === "upgrades"}" aria-controls="pve-tab-body">${I18nManager.t("lobby.stage_tab_upgrades")}</button>
      </div>

      <div id="pve-tab-body" role="tabpanel" aria-labelledby="${activeTab === "stages" ? "tab-stages" : "tab-upgrades"}"></div>
    `;

    card.querySelector("#pve-close-btn")?.addEventListener("click", close);
    card.querySelector("#tab-stages")?.addEventListener("click", () => {
      activeTab = "stages";
      renderContent();
      card.querySelector<HTMLButtonElement>("#tab-stages")?.focus();
    });
    card.querySelector("#tab-upgrades")?.addEventListener("click", () => {
      activeTab = "upgrades";
      renderContent();
      card.querySelector<HTMLButtonElement>("#tab-upgrades")?.focus();
    });

    const body = card.querySelector("#pve-tab-body") as HTMLElement;

    if (activeTab === "stages") {
      const maxClearedStage = getMaxClearedStage(runtime.metaRuntime.storage);
      const unlockedMaxStage = Math.min(PVE_MAX_STAGE, maxClearedStage + 1);
      if (selectedStage > unlockedMaxStage) {
        selectedStage = unlockedMaxStage;
      }

      const stagePanel = document.createElement("section");
      stagePanel.className = "pve-stage-panel";
      const heading = document.createElement("header");
      heading.className = "pve-stage-heading";
      heading.innerHTML = `<h3>${I18nManager.t("lobby.stage_tab_stages")}</h3><p>${I18nManager.t("lobby.stage_desc", { stage: selectedStage, max: maxClearedStage })}</p>`;
      stagePanel.append(heading);
      const grid = document.createElement("div");
      grid.className = "pve-stage-grid";
      for (let s = 1; s <= PVE_MAX_STAGE; s++) {
        const btn = document.createElement("button");
        const isCleared = s <= maxClearedStage;
        const isUnlocked = s <= unlockedMaxStage;
        const isSelected = selectedStage === s && isUnlocked;

        let statusText = isCleared ? I18nManager.t("lobby.stage_cleared") : s === unlockedMaxStage ? I18nManager.t("lobby.stage_challenge") : I18nManager.t("lobby.stage_locked");
        btn.type = "button";
        btn.className = "pve-stage-card";
        btn.dataset.stage = String(s);
        btn.dataset.cleared = String(isCleared);
        btn.setAttribute("aria-pressed", String(isSelected));
        btn.disabled = !isUnlocked;
        btn.innerHTML = `
          <strong>${I18nManager.t("lobby.stage_label", { stage: s })}</strong>
          <span>${statusText}</span>
        `;
        if (isUnlocked) {
          btn.onclick = () => {
            selectedStage = s;
            renderContent();
            card.querySelector<HTMLButtonElement>(`[data-stage="${s}"]`)?.focus();
          };
        }
        grid.appendChild(btn);
      }
      stagePanel.appendChild(grid);

      const startBox = document.createElement("div");
      startBox.className = "pve-stage-footer";
      startBox.innerHTML = `
        <button type="button" id="pve-start-btn">
          ${I18nManager.t("lobby.stage_start_btn", { stage: selectedStage })}
        </button>
      `;
      stagePanel.appendChild(startBox);
      body.appendChild(stagePanel);

      startBox.querySelector("#pve-start-btn")?.addEventListener("click", async () => {
        close();
        await onStartStage(selectedStage);
      });
    } else {
      workbench = new PieceStatWorkbench(adapter, {
        selectedPiece,
        previewServices: runtime.piecePreviewServices,
        onSummaryChange: () => {
          const points = card.querySelector("#pve-points-held");
          if (points) points.textContent = I18nManager.t("lobby.stage_points_held", { points: runtime.metaRuntime.state.points });
        },
      });
      body.append(workbench.element);
    }
  };

  renderContent();
  modal.appendChild(card);
  runtime.overlay.appendChild(modal);
}

/**
 * 게임 월드 준비 여부를 반영해 모드 시작 버튼을 갱신한다.
 */
export function setMainMenuReady(
  runtime: MainMenuRuntime,
  ready: boolean,
): void {
  runtime.ready = ready;
  renderMainMenu(runtime);
}

/**
 * 인게임 UI를 가리고 영구 메타가 보존된 메인 메뉴를 표시한다.
 */
export function showMainMenu(runtime: MainMenuRuntime): void {
  runtime.busy = false;
  runtime.ready = true;
  runtime.visible = true;
  runtime.confirming = false;
  runtime.overlay.hidden = false;
  runtime.confirmOverlay.hidden = true;
  runtime.returnButton.hidden = true;
  renderMainMenu(runtime);
  void AdManager.showBanner();
  runtime.overlay
    .querySelector<HTMLButtonElement>(".lobby-modes [data-game-mode], [data-game-mode], #auth-tab-guest")
    ?.focus();
}

/**
 * 모드 보드와 상대 준비가 모두 끝난 뒤 메뉴를 닫고 인게임 메뉴 버튼을 연다.
 */
export function hideMainMenuAfterModeStart(
  runtime: MainMenuRuntime,
): void {
  runtime.closePveLobby?.();
  runtime.busy = false;
  runtime.visible = false;
  runtime.overlay.hidden = true;
  runtime.returnButton.hidden = false;
}

/**
 * 메뉴와 포기 확인 중에는 키보드·포인터 게임 입력을 모두 막아야 함을 반환한다.
 */
export function isMenuBlocking(runtime: MainMenuRuntime): boolean {
  return runtime.visible || runtime.confirming || runtime.busy;
}

/**
 * 포기 확인 없이 이미 끝난 대국에서 런 정리 후 메뉴로 돌아간다.
 */
export async function returnToMainMenu(
  runtime: MainMenuRuntime,
): Promise<void> {
  runtime.busy = true;
  try {
    await runtime.onReturnToMenu();
  } finally {
    runtime.busy = false;
    runtime.ready = true;
    showMainMenu(runtime);
  }
}
/**
 * 메인 메뉴 화면을 갱신한다. (로그인 전: 게스트/로그인/가입 폼 / 로그인 후: 유저 프로필 + 게임 모드 선택)
 */
export function renderMainMenu(runtime: MainMenuRuntime): void {
  const panel = runtime.overlay.querySelector<HTMLElement>(".main-menu-panel");
  if (panel === null) return;

  if (localStorage.getItem("ca_logged_in_user") === "true") {
    const classicMmr = Number(localStorage.getItem("ca_local_classic_mmr") || localStorage.getItem("ca_local_mmr") || 1200);
    const strategyMmr = Number(localStorage.getItem("ca_local_strategy_mmr") || localStorage.getItem("ca_local_mmr") || 1200);
    const classicWins = Number(localStorage.getItem("ca_local_classic_wins") || 0);
    const classicDraws = Number(localStorage.getItem("ca_local_classic_draws") || 0);
    const classicLosses = Number(localStorage.getItem("ca_local_classic_losses") || 0);
    const strategyWins = Number(localStorage.getItem("ca_local_strategy_wins") || 0);
    const strategyDraws = Number(localStorage.getItem("ca_local_strategy_draws") || 0);
    const strategyLosses = Number(localStorage.getItem("ca_local_strategy_losses") || 0);

    runtime.userProfile = {
      id: runtime.userProfile?.id || localStorage.getItem("ca_guest_user_uuid") || "local_guest",
      nickname: localStorage.getItem("ca_local_nickname") || runtime.userProfile?.nickname || "알까기플레이어",
      mmr: classicMmr,
      classicMmr,
      strategyMmr,
      wins: classicWins + strategyWins,
      losses: classicLosses + strategyLosses,
      draws: classicDraws + strategyDraws,
      classicWins,
      classicDraws,
      classicLosses,
      strategyWins,
      strategyDraws,
      strategyLosses,
    };
  }

  const user = runtime.userProfile as UserProfile;

  if (!progressStorage.ready) {
    panel.innerHTML = `<h1 id="main-menu-title">계정 진행도</h1><p role="status">${escapeHtml(progressStorage.status)}</p><button type="button" id="progress-retry">다시 불러오기</button>${progressStorage.conflict ? '<button type="button" id="progress-use-server">기기 기록 백업 후 서버 기록 사용</button>' : ''}<button type="button" id="progress-signout">로그아웃</button>`;
    panel.querySelector("#progress-retry")?.addEventListener("click", () => { void progressStorage.retry(); });
    panel.querySelector("#progress-use-server")?.addEventListener("click", async () => { await progressStorage.useServer(); if (progressStorage.ready) window.location.reload(); });
    panel.querySelector("#progress-signout")?.addEventListener("click", async () => {
      const client = getSupabaseClient();
      if (client) await signOutUser(client);
      localStorage.removeItem("ca_logged_in_user");
      window.location.reload();
    });
    return;
  }

  if (user === null) {
    // -------------------------------------------------------------
    // 1. 미로그인 상태: 로그인 / 회원가입 / 게스트 로그인 뷰
    // -------------------------------------------------------------
    panel.innerHTML = `
      <header class="lobby-header"><h1 id="main-menu-title">${I18nManager.t("lobby.title")}</h1>${renderHeaderActions()}</header>
      <div style="display:flex; gap:6px; background:#0f172a; padding:4px; border-radius:8px; margin-bottom:16px;">
        <button id="auth-tab-guest" style="flex:1; border:none; border-radius:6px; padding:8px 4px; font-size:12px; font-weight:700; cursor:pointer; background:#2563eb; color:white;">${I18nManager.t("lobby.guest_tab")}</button>
        <button id="auth-tab-login" style="flex:1; border:none; border-radius:6px; padding:8px 4px; font-size:12px; font-weight:700; cursor:pointer; background:transparent; color:#94a3b8;">${I18nManager.t("lobby.login_tab")}</button>
        <button id="auth-tab-signup" style="flex:1; border:none; border-radius:6px; padding:8px 4px; font-size:12px; font-weight:700; cursor:pointer; background:transparent; color:#94a3b8;">${I18nManager.t("lobby.signup_tab")}</button>
      </div>

      <div id="auth-tab-content"></div>
      <nav class="site-menu-links" aria-label="게임 안내"><a href="./about.html">소개·문의</a><a href="./guide.html">조작법·규칙</a><a href="./tiers.html">티어</a><a href="./updates.html">업데이트</a><a href="./privacy.html">개인정보</a></nav>
      <p class="main-menu-status" data-menu-status aria-live="polite" style="margin-top:12px; font-size:13px; min-height:16px; color:#ef4444;"></p>
    `;

    panel.querySelector("#menu-ranking-btn")?.addEventListener("click", () => {
      void openRankingModal(runtime.overlay, runtime.userProfile);
    });

    panel.querySelector("#menu-friends-btn")?.addEventListener("click", () => {
      void openFriendsModal(runtime.overlay, runtime.userProfile, {
        onStartFriendlyMatch: (friend, roomId, isHost) => {
          void runtime.onStartFriendlyMatch?.(friend, roomId, isHost);
        },
      });
    });

    panel.querySelector("#menu-sound-btn")?.addEventListener("click", () => {
      openSettingsModal(runtime.overlay);
    });

    let currentAuthTab: "guest" | "login" | "signup" = "guest";

    const renderAuthTab = () => {
      const content = panel.querySelector("#auth-tab-content") as HTMLElement;
      if (!content) return;

      const tabGuest = panel.querySelector("#auth-tab-guest") as HTMLElement;
      const tabLogin = panel.querySelector("#auth-tab-login") as HTMLElement;
      const tabSignup = panel.querySelector("#auth-tab-signup") as HTMLElement;

      tabGuest.style.background = currentAuthTab === "guest" ? "#2563eb" : "transparent";
      tabGuest.style.color = currentAuthTab === "guest" ? "white" : "#94a3b8";

      tabLogin.style.background = currentAuthTab === "login" ? "#2563eb" : "transparent";
      tabLogin.style.color = currentAuthTab === "login" ? "white" : "#94a3b8";

      tabSignup.style.background = currentAuthTab === "signup" ? "#2563eb" : "transparent";
      tabSignup.style.color = currentAuthTab === "signup" ? "white" : "#94a3b8";

      const status = panel.querySelector<HTMLElement>("[data-menu-status]");
      if (status) status.textContent = "";

      if (currentAuthTab === "guest") {
        const savedNick = localStorage.getItem("ca_local_nickname") || `Player_${Math.floor(1000 + Math.random() * 9000)}`;
        content.innerHTML = `
          <div style="display:flex; flex-direction:column; gap:10px;">
            <div>
              <label style="display:block; font-size:12px; color:#94a3b8; margin-bottom:4px; font-weight:600;">${I18nManager.t("lobby.nickname_label")}</label>
              <input type="text" id="guest-nickname-input" value="${escapeHtml(savedNick)}" style="width:100%; box-sizing:border-box; background:#0f172a; border:1px solid #334155; border-radius:8px; padding:10px; color:#f8fafc; font-size:14px;" />
            </div>
            <button id="btn-guest-submit" style="background:#2563eb; color:white; border:none; border-radius:8px; padding:12px; font-size:14px; font-weight:700; cursor:pointer; margin-top:4px;">
              ${I18nManager.t("lobby.guest_btn")}
            </button>
          </div>
        `;
        content.querySelector("#btn-guest-submit")?.addEventListener("click", async () => {
          const nickInput = content.querySelector("#guest-nickname-input") as HTMLInputElement;
          const nick = nickInput?.value.trim() || savedNick;
          localStorage.setItem("ca_local_nickname", nick);
          localStorage.setItem("ca_logged_in_user", "true");

          const sb = getSupabaseClient();
          if (sb) {
            const prof = await getOrCreateUserProfile(sb);
            prof.nickname = nick;
            runtime.userProfile = prof;
          } else {
            const classicMmr = Number(localStorage.getItem("ca_local_classic_mmr") || localStorage.getItem("ca_local_mmr") || 1200);
            const strategyMmr = Number(localStorage.getItem("ca_local_strategy_mmr") || localStorage.getItem("ca_local_mmr") || 1200);
            const classicWins = Number(localStorage.getItem("ca_local_classic_wins") || 0);
            const classicDraws = Number(localStorage.getItem("ca_local_classic_draws") || 0);
            const classicLosses = Number(localStorage.getItem("ca_local_classic_losses") || 0);
            const strategyWins = Number(localStorage.getItem("ca_local_strategy_wins") || 0);
            const strategyDraws = Number(localStorage.getItem("ca_local_strategy_draws") || 0);
            const strategyLosses = Number(localStorage.getItem("ca_local_strategy_losses") || 0);
            runtime.userProfile = {
              id: "local_guest",
              nickname: nick,
              mmr: classicMmr,
              classicMmr,
              strategyMmr,
              wins: classicWins + strategyWins,
              losses: classicLosses + strategyLosses,
              draws: classicDraws + strategyDraws,
              classicWins,
              classicDraws,
              classicLosses,
              strategyWins,
              strategyDraws,
              strategyLosses,
            };
          }
          renderMainMenu(runtime);
        });
      } else if (currentAuthTab === "login") {
        content.innerHTML = `
          <div style="display:flex; flex-direction:column; gap:10px;">
            <div>
              <label style="display:block; font-size:12px; color:#94a3b8; margin-bottom:4px; font-weight:600;">이메일</label>
              <input type="email" id="login-email-input" placeholder="user@example.com" style="width:100%; box-sizing:border-box; background:#0f172a; border:1px solid #334155; border-radius:8px; padding:10px; color:#f8fafc; font-size:14px;" />
            </div>
            <div>
              <label style="display:block; font-size:12px; color:#94a3b8; margin-bottom:4px; font-weight:600;">비밀번호</label>
              <input type="password" id="login-pw-input" placeholder="••••••••" style="width:100%; box-sizing:border-box; background:#0f172a; border:1px solid #334155; border-radius:8px; padding:10px; color:#f8fafc; font-size:14px;" />
            </div>
            <button id="btn-login-submit" style="background:#2563eb; color:white; border:none; border-radius:8px; padding:12px; font-size:14px; font-weight:700; cursor:pointer; margin-top:4px;">
              이메일 로그인
            </button>
          </div>
        `;
        content.querySelector("#btn-login-submit")?.addEventListener("click", async () => {
          const email = (content.querySelector("#login-email-input") as HTMLInputElement)?.value;
          const pw = (content.querySelector("#login-pw-input") as HTMLInputElement)?.value;
          const sb = getSupabaseClient();
          if (!sb) {
            if (status) status.textContent = "Supabase 서버 연결이 구성되지 않았습니다.";
            return;
          }
          const res = await signInWithEmail(sb, email, pw);
          if (res.success && res.user) {
            localStorage.setItem("ca_logged_in_user", "true");
            runtime.userProfile = res.user;
            SocialService.init(res.user);
            renderMainMenu(runtime);
          } else {
            if (status) status.textContent = res.error || "로그인에 실패했습니다.";
          }
        });
      } else {
        content.innerHTML = `
          <div style="display:flex; flex-direction:column; gap:10px;">
            <div>
              <label style="display:block; font-size:12px; color:#94a3b8; margin-bottom:4px; font-weight:600;">이메일</label>
              <input type="email" id="signup-email-input" placeholder="user@example.com" style="width:100%; box-sizing:border-box; background:#0f172a; border:1px solid #334155; border-radius:8px; padding:10px; color:#f8fafc; font-size:14px;" />
            </div>
            <div>
              <label style="display:block; font-size:12px; color:#94a3b8; margin-bottom:4px; font-weight:600;">비밀번호 (6자 이상)</label>
              <input type="password" id="signup-pw-input" placeholder="••••••••" style="width:100%; box-sizing:border-box; background:#0f172a; border:1px solid #334155; border-radius:8px; padding:10px; color:#f8fafc; font-size:14px;" />
            </div>
            <div>
              <label style="display:block; font-size:12px; color:#94a3b8; margin-bottom:4px; font-weight:600;">닉네임</label>
              <input type="text" id="signup-nick-input" placeholder="알까기마스터" style="width:100%; box-sizing:border-box; background:#0f172a; border:1px solid #334155; border-radius:8px; padding:10px; color:#f8fafc; font-size:14px;" />
            </div>
            <button id="btn-signup-submit" style="background:#16a34a; color:white; border:none; border-radius:8px; padding:12px; font-size:14px; font-weight:700; cursor:pointer; margin-top:4px;">
              회원가입 및 시작
            </button>
          </div>
        `;
        content.querySelector("#btn-signup-submit")?.addEventListener("click", async () => {
          const email = (content.querySelector("#signup-email-input") as HTMLInputElement)?.value;
          const pw = (content.querySelector("#signup-pw-input") as HTMLInputElement)?.value;
          const nick = (content.querySelector("#signup-nick-input") as HTMLInputElement)?.value;
          const sb = getSupabaseClient();
          if (!sb) {
            if (status) status.textContent = "Supabase 서버 연결이 구성되지 않았습니다.";
            return;
          }
          const res = await signUpWithEmail(sb, email, pw, nick);
          if (res.success && res.user) {
            localStorage.setItem("ca_logged_in_user", "true");
            runtime.userProfile = res.user;
            SocialService.init(res.user);
            renderMainMenu(runtime);
          } else {
            if (status) status.textContent = res.error || "회원가입에 실패했습니다.";
          }
        });
      }
    };

    panel.querySelector("#auth-tab-guest")?.addEventListener("click", () => {
      currentAuthTab = "guest";
      renderAuthTab();
    });
    panel.querySelector("#auth-tab-login")?.addEventListener("click", () => {
      currentAuthTab = "login";
      renderAuthTab();
    });
    panel.querySelector("#auth-tab-signup")?.addEventListener("click", () => {
      currentAuthTab = "signup";
      renderAuthTab();
    });

    renderAuthTab();
    return;
  }

  // -------------------------------------------------------------
  // 2. 로그인 완료 상태: 유저 정보 + 게임 모드 선택 뷰
  // -------------------------------------------------------------
  const maxClearedStage = getMaxClearedStage(runtime.metaRuntime.storage);
  const recommendation = getRecommendation(runtime);
  const heroAsset = safeRuntimeAssetUrl(recommendation.assetId);

  panel.innerHTML = `<header class="lobby-header"><h1 id="main-menu-title">${I18nManager.t("lobby.title")}</h1>${renderHeaderActions({ showLogout: true })}</header>${renderProfileCard(user, runtime.metaRuntime.state.points)}<div data-progress-controls><p data-progress-status role="status">${escapeHtml(progressStorage.status)}</p>${progressStorage.owner ? '<button type="button" id="progress-save">저장 다시 시도</button>' : ''}${progressStorage.canImport() ? '<p>이 기기에 이전 진행도가 있습니다. 본인의 기록인 경우에만 가져오세요.</p><button type="button" id="progress-import">이 기기 기록 가져오기</button><button type="button" id="progress-skip-import">새로 시작</button>' : ''}</div>${renderRecommendationCard(recommendation, heroAsset)}${renderModeCards(runtime, maxClearedStage)}${renderFooterLinks()}<p class="main-menu-status" data-menu-status aria-live="polite"></p>`;
  panel.querySelector("#progress-save")?.addEventListener("click", () => { void progressStorage.retry(); });
  panel.querySelector("#progress-import")?.addEventListener("click", () => { void progressStorage.importLocal(); });
  panel.querySelector("#progress-skip-import")?.addEventListener("click", () => { progressStorage.dismissImport(); renderMainMenu(runtime); });
  panel.querySelector("#menu-ranking-btn")?.addEventListener("click", () => {
    void openRankingModal(runtime.overlay, runtime.userProfile);
  });

  panel.querySelector("#menu-friends-btn")?.addEventListener("click", () => {
    void openFriendsModal(runtime.overlay, runtime.userProfile, {
      onStartFriendlyMatch: (friend, roomId, isHost) => {
        void runtime.onStartFriendlyMatch?.(friend, roomId, isHost);
      },
    });
  });

  panel.querySelector("#menu-sound-btn")?.addEventListener("click", () => {
    openSettingsModal(runtime.overlay);
  });

  panel.querySelector("#menu-profile-btn")?.addEventListener("click", () => {
    lobbyProfileExpanded = !lobbyProfileExpanded;
    renderMainMenu(runtime);
  });
  panel.querySelector("#btn-logout")?.addEventListener("click", async () => {
    await progressStorage.flush();
    const sb = getSupabaseClient();
    if (sb) await signOutUser(sb);
    localStorage.removeItem("ca_logged_in_user");
    runtime.userProfile = null;
    lobbyProfileExpanded = false;
    renderMainMenu(runtime);
  });
  panel.querySelector('[data-lobby-footer="tutorial"]')?.addEventListener("click", () => {
    openTutorialSheet(runtime);
  });
  panel.querySelector("#menu-recommendation-btn")?.addEventListener("click", () => {
    if (recommendation.mode === "stage") {
      openPveLobbyModal(runtime, (stage) => startLobbyMode(runtime, "stage", stage), recommendation.stage);
    } else {
      void startLobbyMode(runtime, recommendation.mode, recommendation.stage, recommendation.tutorialType);
    }
  });

  const puzzleButton = panel.querySelector<HTMLButtonElement>("#menu-puzzle-btn");
  if (puzzleButton) {
    puzzleButton.hidden = !runtime.onOpenPuzzles;
    puzzleButton.disabled = !runtime.ready || runtime.busy || !runtime.onOpenPuzzles;
  }

  for (const button of panel.querySelectorAll<HTMLButtonElement>("[data-game-mode]")) {
    button.disabled = !runtime.ready || runtime.busy || (button.dataset.gameMode === "puzzle" && !runtime.onOpenPuzzles);
    button.addEventListener("click", () => {
      const mode = button.dataset.gameMode as LobbyMode | undefined;
      if (!mode || runtime.busy || !runtime.ready) return;
      if (mode === "stage") {
        openPveLobbyModal(runtime, (stage) => startLobbyMode(runtime, "stage", stage));
        return;
      }
      if (mode === "tutorial") {
        const tutorialType = (button.dataset.tutorialType as "basic" | "advanced") ?? "basic";
        void startLobbyMode(runtime, "tutorial", 1, tutorialType);
        return;
      }
      if (mode === "puzzle") {
        void startLobbyMode(runtime, "puzzle");
        return;
      }
      if (mode === "online" || mode === "hotseat") {
        void startLobbyMode(runtime, mode);
        return;
      }
    });
  }

  // 최초 접속 시 기본 튜토리얼 권장 팝업 1회 표시
}

/**
 * 메인 메뉴·인게임 메뉴 버튼·비차단 포기 확인 화면을 함께 만든다.
 */
export function createMainMenu(
  container: HTMLElement,
  metaRuntime: MetaRuntime,
  onStartMode: (mode: GameMode, selectedStage?: number, tutorialType?: "basic" | "advanced") => Promise<void>,
  onReturnToMenu: () => Promise<void>,
  onConfirmAbandon: () => Promise<void>,
  onOpenPuzzles?: () => void,
): MainMenuRuntime {
  const overlay = document.createElement("section");
  overlay.className = "main-menu-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "main-menu-title");
  overlay.innerHTML = `
    <div class="main-menu-panel" style="max-width:440px; padding:28px;"></div>
  `;

  const returnButton = document.createElement("button");
  returnButton.type = "button";
  returnButton.className = "return-menu-button";
  returnButton.textContent = I18nManager.t("ingame.menu_btn");
  returnButton.hidden = true;

  const confirmOverlay = document.createElement("section");
  confirmOverlay.className =
    "match-result-overlay menu-confirm-overlay";
  confirmOverlay.hidden = true;
  confirmOverlay.setAttribute("role", "dialog");
  confirmOverlay.setAttribute("aria-modal", "true");
  confirmOverlay.setAttribute(
    "aria-labelledby",
    "menu-confirm-title",
  );
  confirmOverlay.innerHTML = `
    <div class="match-result-panel" style="max-width:380px; text-align:center; padding:24px;">
      <h1 id="menu-confirm-title" style="font-size:22px; font-weight:800; color:#ffe7a3; margin:0 0 10px 0;">${I18nManager.t("ingame.abandon_title")}</h1>
      <p id="menu-confirm-desc" style="font-size:13px; color:#94a3b8; margin:0 0 20px 0; line-height:1.5;">${I18nManager.t("ingame.abandon_desc")}</p>
      <div class="match-result-actions" style="display:flex; gap:10px; justify-content:center;">
        <button type="button" data-menu-cancel style="flex:1; padding:10px 14px; font-weight:700; border-radius:8px; background:#334155; color:#f8fafc; border:none; cursor:pointer;">${I18nManager.t("ingame.continue_btn")}</button>
        <button type="button" data-menu-confirm style="flex:1; padding:10px 14px; font-weight:700; border-radius:8px; background:#ef4444; color:white; border:none; cursor:pointer;">${I18nManager.t("ingame.menu_btn")}</button>
      </div>
    </div>
  `;
  const cancelButton =
    confirmOverlay.querySelector<HTMLButtonElement>(
      "[data-menu-cancel]",
    );
  const confirmButton =
    confirmOverlay.querySelector<HTMLButtonElement>(
      "[data-menu-confirm]",
    );
  if (cancelButton === null || confirmButton === null) {
    throw new Error("메뉴 복귀 확인 버튼을 만들지 못했습니다.");
  }

  const savedLoggedIn = localStorage.getItem("ca_logged_in_user") === "true";
  let initialProfile: UserProfile | null = null;
  if (savedLoggedIn) {
    const classicMmr = Number(localStorage.getItem("ca_local_classic_mmr") || localStorage.getItem("ca_local_mmr") || 1200);
    const strategyMmr = Number(localStorage.getItem("ca_local_strategy_mmr") || localStorage.getItem("ca_local_mmr") || 1200);
    const classicWins = Number(localStorage.getItem("ca_local_classic_wins") || 0);
    const classicDraws = Number(localStorage.getItem("ca_local_classic_draws") || 0);
    const classicLosses = Number(localStorage.getItem("ca_local_classic_losses") || 0);
    const strategyWins = Number(localStorage.getItem("ca_local_strategy_wins") || 0);
    const strategyDraws = Number(localStorage.getItem("ca_local_strategy_draws") || 0);
    const strategyLosses = Number(localStorage.getItem("ca_local_strategy_losses") || 0);
    initialProfile = {
      id: localStorage.getItem("ca_guest_user_uuid") || "local_guest",
      nickname: localStorage.getItem("ca_local_nickname") || "알까기플레이어",
      mmr: classicMmr,
      classicMmr,
      strategyMmr,
      wins: classicWins + strategyWins,
      losses: classicLosses + strategyLosses,
      draws: classicDraws + strategyDraws,
      classicWins,
      classicDraws,
      classicLosses,
      strategyWins,
      strategyDraws,
      strategyLosses,
    };
  }

  const runtime: MainMenuRuntime = {
    overlay,
    returnButton,
    confirmOverlay,
    metaRuntime,
    piecePreviewServices: null,
    ready: false,
    busy: false,
    visible: true,
    confirming: false,
    userProfile: initialProfile,
    onStartMode,
    onOpenPuzzles,
    onReturnToMenu,
    onConfirmAbandon,
  };

  renderMainMenu(runtime);
  I18nManager.subscribe(() => {
    returnButton.textContent = I18nManager.t("ingame.menu_btn");
    const confirmH1 = confirmOverlay.querySelector("#menu-confirm-title");
    if (confirmH1) confirmH1.textContent = I18nManager.t("ingame.abandon_title");
    const confirmDesc = confirmOverlay.querySelector("#menu-confirm-desc");
    if (confirmDesc) confirmDesc.textContent = I18nManager.t("ingame.abandon_desc");
    const cancelBtn = confirmOverlay.querySelector("[data-menu-cancel]");
    if (cancelBtn) cancelBtn.textContent = I18nManager.t("ingame.continue_btn");
    const confirmBtn = confirmOverlay.querySelector("[data-menu-confirm]");
    if (confirmBtn) confirmBtn.textContent = I18nManager.t("ingame.menu_btn");

    if (runtime.visible) {
      renderMainMenu(runtime);
    }
  });
  overlay.addEventListener("keydown", (event) => {
    if (event.code !== "Tab") {
      if (event.code === "Escape") {
        event.preventDefault();
      }
      return;
    }
    const focusableButtons = [
      ...overlay.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ),
    ];
    if (focusableButtons.length === 0) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    const currentIndex = focusableButtons.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    const direction = event.shiftKey ? -1 : 1;
    const nextIndex =
      currentIndex < 0
        ? event.shiftKey
          ? focusableButtons.length - 1
          : 0
        : (currentIndex + direction + focusableButtons.length) %
          focusableButtons.length;
    focusableButtons[nextIndex].focus();
  });

  returnButton.addEventListener("click", () => {
    if (runtime.busy || runtime.visible) {
      return;
    }
    const heading =
      confirmOverlay.querySelector<HTMLHeadingElement>(
        "#menu-confirm-title",
      );
    if (heading !== null) {
      heading.textContent = I18nManager.t("ingame.abandon_title");
    }
    const desc =
      confirmOverlay.querySelector<HTMLParagraphElement>(
        "#menu-confirm-desc",
      );
    if (desc !== null) {
      desc.textContent = I18nManager.t("ingame.abandon_desc");
    }
    runtime.confirming = true;
    runtime.confirmOverlay.hidden = false;
    confirmButton.focus();
  });
  cancelButton.addEventListener("click", () => {
    runtime.confirming = false;
    runtime.confirmOverlay.hidden = true;
    runtime.returnButton.focus();
  });
  confirmButton.addEventListener("click", () => {
    if (runtime.busy) {
      return;
    }
    confirmButton.disabled = true;
    cancelButton.disabled = true;
    void runtime.onConfirmAbandon().then(
      () => {
        runtime.confirming = false;
        runtime.confirmOverlay.hidden = true;
        confirmButton.disabled = false;
        cancelButton.disabled = false;
      },
      (error: unknown) => {
        const fullError =
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error);
        console.error(fullError);
        const heading =
          confirmOverlay.querySelector<HTMLHeadingElement>(
            "#menu-confirm-title",
          );
        if (heading !== null) {
          heading.textContent = "메뉴로 돌아가지 못했습니다.";
        }
        confirmButton.disabled = false;
        cancelButton.disabled = false;
      },
    );
  });
  confirmOverlay.addEventListener("keydown", (event) => {
    if (event.code === "Escape") {
      event.preventDefault();
      cancelButton.click();
    } else if (event.code === "Tab") {
      event.preventDefault();
      (document.activeElement === confirmButton
        ? cancelButton
        : confirmButton
      ).focus();
    }
    event.stopPropagation();
  });

  container.append(returnButton, overlay, confirmOverlay);
  renderMainMenu(runtime);
  return runtime;
}
