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
import { progressStorage } from "./progress-storage";
import {
  PVE_MAX_STAGE,
  getInitialStage,
  safeRuntimeAssetUrl,
  renderHeaderActions,
  getRecommendation,
  renderProfileCard,
  renderRecommendationCard,
  renderModeCards,
  renderFooterLinks,
  renderTutorialBar,
  lobbyState,
} from "./lobby";
import type { LobbyMode } from "./lobby";
import { MASTERY_DEFINITIONS, type MasteryId } from "./mastery";
import { openMasteryBook } from "./mastery-ui";

function openLogoutConfirm(runtime: MainMenuRuntime): void {
  if (runtime.overlay.querySelector(".lobby-logout-confirm")) return;

  const previousFocus = runtime.overlay.querySelector<HTMLButtonElement>("#btn-logout");
  const dialog = document.createElement("section");
  dialog.className = "match-result-overlay menu-confirm-overlay lobby-logout-confirm";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "lobby-logout-confirm-title");
  dialog.innerHTML = `<div class="match-result-panel" style="max-width:380px; text-align:center; padding:24px;"><h1 id="lobby-logout-confirm-title">${escapeHtml(I18nManager.t("lobby.logout_confirm_title"))}</h1><div class="match-result-actions"><button type="button" data-logout-cancel>${escapeHtml(I18nManager.t("lobby.logout_confirm_no"))}</button><button type="button" data-logout-confirm>${escapeHtml(I18nManager.t("lobby.logout_confirm_yes"))}</button></div></div>`;

  const cancelButton = dialog.querySelector<HTMLButtonElement>("[data-logout-cancel]");
  const confirmButton = dialog.querySelector<HTMLButtonElement>("[data-logout-confirm]");
  if (!cancelButton || !confirmButton) return;

  const close = () => {
    dialog.remove();
    previousFocus?.focus();
  };
  cancelButton.addEventListener("click", close);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) close();
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Tab") {
      event.preventDefault();
      (document.activeElement === cancelButton ? confirmButton : cancelButton).focus();
    }
    event.stopPropagation();
  });
  confirmButton.addEventListener("click", async () => {
    cancelButton.disabled = true;
    confirmButton.disabled = true;
    await progressStorage.flush();
    const sb = getSupabaseClient();
    if (sb) await signOutUser(sb);
    localStorage.removeItem("ca_logged_in_user");
    runtime.userProfile = null;
    lobbyState.profileExpanded = false;
    lobbyState.tutorialExpanded = false;
    dialog.remove();
    renderMainMenu(runtime);
  });

  runtime.overlay.append(dialog);
  cancelButton.focus();
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
      ? I18nManager.t("lobby.stage_start_failed")
      : I18nManager.t("lobby.match_start_failed");
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
    panel.innerHTML = `<h1 id="main-menu-title">${escapeHtml(I18nManager.t("lobby.progress_title"))}</h1><p role="status">${escapeHtml(progressStorage.status)}</p><button type="button" id="progress-retry">${escapeHtml(I18nManager.t("lobby.progress_retry"))}</button>${progressStorage.conflict ? `<button type="button" id="progress-use-server">${escapeHtml(I18nManager.t("lobby.progress_use_server"))}</button>` : ''}<button type="button" id="progress-signout">${escapeHtml(I18nManager.t("common.logout"))}</button>`;
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
      <nav class="site-menu-links" aria-label="${escapeHtml(I18nManager.t("lobby.footer_guide"))}"><a href="./about.html">${escapeHtml(I18nManager.t("lobby.nav_about"))}</a><a href="./guide.html">${escapeHtml(I18nManager.t("lobby.nav_guide"))}</a><a href="./tiers.html">${escapeHtml(I18nManager.t("lobby.nav_tiers"))}</a><a href="./updates.html">${escapeHtml(I18nManager.t("lobby.footer_updates"))}</a><a href="./privacy.html">${escapeHtml(I18nManager.t("lobby.footer_privacy"))}</a></nav>
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
              <label style="display:block; font-size:12px; color:#94a3b8; margin-bottom:4px; font-weight:600;">${I18nManager.t("lobby.email_label")}</label>
              <input type="email" id="login-email-input" placeholder="user@example.com" style="width:100%; box-sizing:border-box; background:#0f172a; border:1px solid #334155; border-radius:8px; padding:10px; color:#f8fafc; font-size:14px;" />
            </div>
            <div>
              <label style="display:block; font-size:12px; color:#94a3b8; margin-bottom:4px; font-weight:600;">${I18nManager.t("lobby.pw_label")}</label>
              <input type="password" id="login-pw-input" placeholder="••••••••" style="width:100%; box-sizing:border-box; background:#0f172a; border:1px solid #334155; border-radius:8px; padding:10px; color:#f8fafc; font-size:14px;" />
            </div>
            <button id="btn-login-submit" style="background:#2563eb; color:white; border:none; border-radius:8px; padding:12px; font-size:14px; font-weight:700; cursor:pointer; margin-top:4px;">
              ${I18nManager.t("lobby.login_btn")}
            </button>
          </div>
        `;
        content.querySelector("#btn-login-submit")?.addEventListener("click", async () => {
          const email = (content.querySelector("#login-email-input") as HTMLInputElement)?.value;
          const pw = (content.querySelector("#login-pw-input") as HTMLInputElement)?.value;
          const sb = getSupabaseClient();
          if (!sb) {
            if (status) status.textContent = I18nManager.t("lobby.supabase_not_configured");
            return;
          }
          const res = await signInWithEmail(sb, email, pw);
          if (res.success && res.user) {
            localStorage.setItem("ca_logged_in_user", "true");
            runtime.userProfile = res.user;
            SocialService.init(res.user);
            renderMainMenu(runtime);
          } else {
            if (status) status.textContent = res.error || I18nManager.t("lobby.login_failed");
          }
        });
      } else {
        content.innerHTML = `
          <div style="display:flex; flex-direction:column; gap:10px;">
            <div>
              <label style="display:block; font-size:12px; color:#94a3b8; margin-bottom:4px; font-weight:600;">${I18nManager.t("lobby.email_label")}</label>
              <input type="email" id="signup-email-input" placeholder="user@example.com" style="width:100%; box-sizing:border-box; background:#0f172a; border:1px solid #334155; border-radius:8px; padding:10px; color:#f8fafc; font-size:14px;" />
            </div>
            <div>
              <label style="display:block; font-size:12px; color:#94a3b8; margin-bottom:4px; font-weight:600;">${I18nManager.t("lobby.pw_signup_label")}</label>
              <input type="password" id="signup-pw-input" placeholder="••••••••" style="width:100%; box-sizing:border-box; background:#0f172a; border:1px solid #334155; border-radius:8px; padding:10px; color:#f8fafc; font-size:14px;" />
            </div>
            <div>
              <label style="display:block; font-size:12px; color:#94a3b8; margin-bottom:4px; font-weight:600;">${I18nManager.t("lobby.nickname_label")}</label>
              <input type="text" id="signup-nick-input" placeholder="${escapeHtml(I18nManager.t("lobby.nickname_placeholder"))}" style="width:100%; box-sizing:border-box; background:#0f172a; border:1px solid #334155; border-radius:8px; padding:10px; color:#f8fafc; font-size:14px;" />
            </div>
            <button id="btn-signup-submit" style="background:#16a34a; color:white; border:none; border-radius:8px; padding:12px; font-size:14px; font-weight:700; cursor:pointer; margin-top:4px;">
              ${I18nManager.t("lobby.signup_btn")}
            </button>
          </div>
        `;
        content.querySelector("#btn-signup-submit")?.addEventListener("click", async () => {
          const email = (content.querySelector("#signup-email-input") as HTMLInputElement)?.value;
          const pw = (content.querySelector("#signup-pw-input") as HTMLInputElement)?.value;
          const nick = (content.querySelector("#signup-nick-input") as HTMLInputElement)?.value;
          const sb = getSupabaseClient();
          if (!sb) {
            if (status) status.textContent = I18nManager.t("lobby.supabase_not_configured");
            return;
          }
          const res = await signUpWithEmail(sb, email, pw, nick);
          if (res.success && res.user) {
            localStorage.setItem("ca_logged_in_user", "true");
            runtime.userProfile = res.user;
            SocialService.init(res.user);
            renderMainMenu(runtime);
          } else {
            if (status) status.textContent = res.error || I18nManager.t("lobby.signup_failed");
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

  panel.innerHTML = `<header class="lobby-header"><h1 id="main-menu-title">${I18nManager.t("lobby.title")}</h1>${renderHeaderActions({ showLogout: true })}</header>${renderProfileCard(user, runtime.metaRuntime.state.points)}<div data-progress-controls ${progressStorage.saveFailed || progressStorage.masteryPending || progressStorage.bannersPending ? "" : "hidden"}><p data-progress-status role="status">${escapeHtml(progressStorage.status)}</p><button type="button" id="progress-save">${escapeHtml(I18nManager.t("lobby.progress_retry_save"))}</button></div>${renderRecommendationCard(recommendation, heroAsset)}${renderTutorialBar()}${renderModeCards(runtime, maxClearedStage)}${renderFooterLinks()}<p class="main-menu-status" data-menu-status aria-live="polite"></p>`;
  panel.querySelector("#progress-save")?.addEventListener("click", () => { void progressStorage.retry(); });
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
    lobbyState.profileExpanded = !lobbyState.profileExpanded;
    renderMainMenu(runtime);
  });
  panel.querySelector("[data-open-mastery]")?.addEventListener("click", () => {
    openMasteryBook(runtime.overlay, progressStorage, (id: MasteryId) => {
      const route = MASTERY_DEFINITIONS.find(definition => definition.id === id)?.route;
      if (route === "puzzle") void startLobbyMode(runtime, "puzzle");
      else if (route === "tutorial") void startLobbyMode(runtime, "tutorial", 1, "basic");
      else openPveLobbyModal(runtime, stage => startLobbyMode(runtime, "stage", stage));
    }, () => renderMainMenu(runtime));
  });
  panel.querySelector("#menu-tutorial-btn")?.addEventListener("click", () => {
    lobbyState.tutorialExpanded = !lobbyState.tutorialExpanded;
    renderMainMenu(runtime);
  });
  panel.querySelector("#btn-logout")?.addEventListener("click", () => {
    openLogoutConfirm(runtime);
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
          heading.textContent = I18nManager.t("ingame.return_menu_failed");
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
