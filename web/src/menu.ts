import {
  PERMANENT_PLAYER_SIZE_COST,
  PERMANENT_PLAYER_SIZE_STEP,
  PERMANENT_UPGRADE_TIER_MAX_LEVEL,
  type PieceType,
} from "./config";
import type { GameMode } from "./game-mode";
import {
  computePermanentUpgradeCost,
  computePermanentTierEffect,
  getPermanentTierUpgradeLevel,
  isPermanentSizeUpgradeUnlocked,
  isPermanentUpgradeUnlocked,
  purchasePermanentUpgrade,
  purchasePermanentSizeUpgrade,
  resetPermanentUpgrades,
  getMaxClearedStage,
  type MetaRuntime,
  type PermanentUpgradeTier,
  type PermanentUpgradeTrack,
} from "./meta";
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
import { TutorialManager } from "./tutorial";

export interface MainMenuRuntime {
  overlay: HTMLElement;
  returnButton: HTMLButtonElement;
  confirmOverlay: HTMLElement;
  metaRuntime: MetaRuntime;
  ready: boolean;
  busy: boolean;
  visible: boolean;
  confirming: boolean;
  userProfile: UserProfile | null;
  onStartMode: (mode: GameMode, selectedStage?: number) => Promise<void>;
  onReturnToMenu: () => Promise<void>;
  onConfirmAbandon: () => Promise<void>;
  onStartFriendlyMatch?: (friend: any, roomId: string, isHost: boolean) => Promise<void> | void;
}

const getPieceLabel = (type: PieceType): string => {
  const keyMap: Record<PieceType, string> = {
    Pawn: "lobby.piece_pawn",
    Rook: "lobby.piece_rook",
    Knight: "lobby.piece_knight",
    Bishop: "lobby.piece_bishop",
    Queen: "lobby.piece_queen",
    King: "lobby.piece_king",
  };
  return I18nManager.t(keyMap[type]);
};

const getTrackLabel = (track: PermanentUpgradeTrack): string => {
  return track === "force" ? I18nManager.t("lobby.stat_force") : I18nManager.t("lobby.stat_weight");
};

const getTierLabel = (tier: PermanentUpgradeTier): string => {
  return tier === "basic" ? I18nManager.t("lobby.upgrade_basic") : I18nManager.t("lobby.upgrade_advanced");
};

const TREE_PIECE_ORDER = [
  "Pawn",
  "Knight",
  "King",
  "Rook",
  "Bishop",
  "Queen",
] as const satisfies readonly PieceType[];

/**
 * 기초·심화 힘·중량 구매 행 하나를 현재 선행 조건과 비용으로 만든다.
 */
function appendUpgradeRow(
  runtime: MainMenuRuntime,
  rows: HTMLElement,
  status: HTMLElement,
  tier: PermanentUpgradeTier,
  type: PieceType,
  track: PermanentUpgradeTrack,
): void {
  const level = getPermanentTierUpgradeLevel(
    runtime.metaRuntime.state.upgrades,
    tier,
    type,
    track,
  );
  const unlocked = isPermanentUpgradeUnlocked(
    runtime.metaRuntime.state.upgrades,
    tier,
    type,
  );
  const atMaximum =
    level >= PERMANENT_UPGRADE_TIER_MAX_LEVEL;
  const cost = atMaximum
    ? null
    : computePermanentUpgradeCost(tier, type, level);
  const row = document.createElement("div");
  row.className = "permanent-upgrade-row";
  row.dataset.locked = String(!unlocked);
  row.innerHTML = `
    <strong>${getTierLabel(tier)} · ${getPieceLabel(type)} · ${getTrackLabel(track)}</strong>
    <span>${level}/3</span>
    <span>+${(computePermanentTierEffect(tier, level) * 100).toFixed(0)}%</span>
    <span>${unlocked ? (cost === null ? I18nManager.t("lobby.upgrade_max") : `${cost} P`) : I18nManager.t("lobby.upgrade_locked")}</span>
  `;
  const purchaseButton = document.createElement("button");
  purchaseButton.type = "button";
  purchaseButton.textContent = atMaximum ? I18nManager.t("lobby.upgrade_max") : I18nManager.t("lobby.upgrade_buy");
  purchaseButton.disabled =
    runtime.busy ||
    !unlocked ||
    atMaximum ||
    (cost !== null && runtime.metaRuntime.state.points < cost);
  purchaseButton.addEventListener("click", () => {
    if (runtime.busy) {
      return;
    }
    const result = purchasePermanentUpgrade(
      runtime.metaRuntime,
      tier,
      type,
      track,
    );
    renderMainMenu(runtime);
    status.textContent =
      result.purchased
        ? `${getTierLabel(tier)} ${getPieceLabel(type)} ${getTrackLabel(track)}`
        : (result.reason ?? "");
  });
  row.append(purchaseButton);
  rows.append(row);
}

/**
 * 중앙 전체 크기 0/1 관문을 현재 기초 완료 상태로 만든다.
 */
function appendSizeUpgradeRow(
  runtime: MainMenuRuntime,
  rows: HTMLElement,
  status: HTMLElement,
): void {
  const level = runtime.metaRuntime.state.upgrades.playerSizeLevel;
  const unlocked = isPermanentSizeUpgradeUnlocked(
    runtime.metaRuntime.state.upgrades,
  );
  const row = document.createElement("div");
  row.className =
    "permanent-upgrade-row permanent-upgrade-size-row";
  row.dataset.locked = String(!unlocked);
  row.innerHTML = `
    <strong>${I18nManager.t("lobby.upgrade_size_title")}</strong>
    <span>${level}/1</span>
    <span>${I18nManager.t("lobby.upgrade_size_effect", { val: (PERMANENT_PLAYER_SIZE_STEP * 100).toFixed(0) })}</span>
    <span>${unlocked ? (level === 1 ? I18nManager.t("lobby.upgrade_size_bought") : `${PERMANENT_PLAYER_SIZE_COST} P`) : I18nManager.t("lobby.upgrade_size_need_basic")}</span>
  `;
  const purchaseButton = document.createElement("button");
  purchaseButton.type = "button";
  purchaseButton.textContent = level === 1 ? I18nManager.t("lobby.upgrade_size_bought") : I18nManager.t("lobby.upgrade_buy");
  purchaseButton.disabled =
    runtime.busy ||
    !unlocked ||
    level === 1 ||
    runtime.metaRuntime.state.points <
      PERMANENT_PLAYER_SIZE_COST;
  purchaseButton.addEventListener("click", () => {
    if (runtime.busy) {
      return;
    }
    const result = purchasePermanentSizeUpgrade(
      runtime.metaRuntime,
    );
    renderMainMenu(runtime);
    status.textContent =
      result.purchased
        ? I18nManager.t("lobby.upgrade_size_title")
        : (result.reason ?? "");
  });
  row.append(purchaseButton);
  rows.append(row);
}


/**
 * PVE 로비 모달 (스테이지 선택 + 영구 강화 테크트리)을 연다.
 */
export function openPveLobbyModal(
  runtime: MainMenuRuntime,
  onStartStage: (stage: number) => Promise<void>,
): void {
  const modal = document.createElement("div");
  modal.className = "pve-lobby-modal";
  modal.style.cssText = `
    position: absolute;
    inset: 0;
    background: #0f172a;
    z-index: 50;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 20px;
    box-sizing: border-box;
    color: #f8fafc;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  `;

  const card = document.createElement("div");
  card.style.cssText = `
    width: 100%;
    max-width: 640px;
    max-height: 90vh;
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 16px;
    padding: 24px;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
    gap: 16px;
    overflow: hidden;
  `;

  let activeTab: "stages" | "upgrades" = "stages";
  let selectedStage = 1;

  const renderContent = () => {
    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #334155; padding-bottom:12px;">
        <h2 style="margin:0; font-size:18px; font-weight:700;">${I18nManager.t("lobby.stage_modal_title")}</h2>
        <div style="display:flex; align-items:center; gap:12px;">
          <span style="font-size:13px; color:#38bdf8; font-weight:600;">${I18nManager.t("lobby.stage_points_held", { points: runtime.metaRuntime.state.points })}</span>
          <button id="pve-close-btn" style="background:transparent; border:none; color:#94a3b8; font-size:18px; cursor:pointer;">${I18nManager.t("common.close")}</button>
        </div>
      </div>

      <div style="display:flex; gap:8px; background:#0f172a; padding:4px; border-radius:8px;">
        <button id="tab-stages" style="flex:1; border:none; border-radius:6px; padding:8px; font-weight:700; font-size:13px; cursor:pointer; background:${activeTab === "stages" ? "#3b82f6" : "transparent"}; color:${activeTab === "stages" ? "#fff" : "#94a3b8"};">${I18nManager.t("lobby.stage_tab_stages")}</button>
        <button id="tab-upgrades" style="flex:1; border:none; border-radius:6px; padding:8px; font-weight:700; font-size:13px; cursor:pointer; background:${activeTab === "upgrades" ? "#3b82f6" : "transparent"}; color:${activeTab === "upgrades" ? "#fff" : "#94a3b8"};">${I18nManager.t("lobby.stage_tab_upgrades")}</button>
      </div>

      <div id="pve-tab-body" style="flex:1; overflow-y:auto; min-height:280px; max-height:460px; padding-right:4px;"></div>
    `;

    card.querySelector("#pve-close-btn")?.addEventListener("click", () => modal.remove());
    card.querySelector("#tab-stages")?.addEventListener("click", () => {
      activeTab = "stages";
      renderContent();
    });
    card.querySelector("#tab-upgrades")?.addEventListener("click", () => {
      activeTab = "upgrades";
      renderContent();
    });

    const body = card.querySelector("#pve-tab-body") as HTMLElement;

    if (activeTab === "stages") {
      const maxClearedStage = getMaxClearedStage(runtime.metaRuntime.storage);
      const unlockedMaxStage = Math.min(10, maxClearedStage + 1);
      if (selectedStage > unlockedMaxStage) {
        selectedStage = unlockedMaxStage;
      }

      const grid = document.createElement("div");
      grid.style.cssText = "display:grid; grid-template-columns: repeat(5, 1fr); gap:10px; margin-top:8px;";
      for (let s = 1; s <= 10; s++) {
        const btn = document.createElement("button");
        const isCleared = s <= maxClearedStage;
        const isUnlocked = s <= unlockedMaxStage;
        const isSelected = selectedStage === s && isUnlocked;

        let statusText = isCleared ? I18nManager.t("lobby.stage_cleared") : s === unlockedMaxStage ? I18nManager.t("lobby.stage_challenge") : I18nManager.t("lobby.stage_locked");
        let bgColor = isSelected ? "#0284c7" : isCleared ? "#1e3a8a" : isUnlocked ? "#0f172a" : "#1e293b";
        let borderColor = isSelected ? "#38bdf8" : isCleared ? "#3b82f6" : isUnlocked ? "#475569" : "#334155";
        let textColor = isUnlocked ? "#ffffff" : "#64748b";

        btn.disabled = !isUnlocked;
        btn.innerHTML = `
          <div style="font-weight:700; font-size:14px;">Stage ${s}</div>
          <div style="font-size:11px; margin-top:4px; opacity:0.85; color:${isCleared ? "#86efac" : isUnlocked ? "#93c5fd" : "#64748b"};">${statusText}</div>
        `;
        btn.style.cssText = `
          padding: 12px 6px;
          border-radius: 8px;
          border: 1px solid ${borderColor};
          background: ${bgColor};
          color: ${textColor};
          cursor: ${isUnlocked ? "pointer" : "not-allowed"};
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
        `;
        if (isUnlocked) {
          btn.onclick = () => {
            selectedStage = s;
            renderContent();
          };
        }
        grid.appendChild(btn);
      }
      body.appendChild(grid);

      const startBox = document.createElement("div");
      startBox.style.cssText = "margin-top:20px; display:flex; flex-direction:column; gap:10px;";
      startBox.innerHTML = `
        <div style="background:#0f172a; padding:12px; border-radius:8px; border:1px solid #334155; font-size:13px; color:#94a3b8;">
          ${I18nManager.t("lobby.stage_desc", { stage: selectedStage, max: maxClearedStage })}
        </div>
        <button id="pve-start-btn" style="background:#16a34a; color:#fff; border:none; border-radius:8px; padding:14px; font-weight:700; font-size:15px; cursor:pointer;">
          ${I18nManager.t("lobby.stage_start_btn", { stage: selectedStage })}
        </button>
      `;
      body.appendChild(startBox);

      startBox.querySelector("#pve-start-btn")?.addEventListener("click", async () => {
        modal.remove();
        await onStartStage(selectedStage);
      });
    } else {
      // 영구 강화 탭
      const upgradeContainer = document.createElement("div");
      upgradeContainer.style.cssText = "display:flex; flex-direction:column; gap:10px;";
      
      const statusText = document.createElement("div");
      statusText.style.cssText = "font-size:12px; color:#38bdf8; min-height:16px;";
      upgradeContainer.appendChild(statusText);

      const rowsWrapper = document.createElement("div");
      rowsWrapper.className = "permanent-upgrade-panel";
      rowsWrapper.innerHTML = `
        <div class="permanent-upgrade-heading" aria-hidden="true" style="margin-bottom:8px;">
          <span>${I18nManager.t("lobby.upgrade_col_piece")}</span>
          <span>${I18nManager.t("lobby.upgrade_col_level")}</span>
          <span>${I18nManager.t("lobby.upgrade_col_effect")}</span>
          <span>${I18nManager.t("lobby.upgrade_col_cost")}</span>
          <span>${I18nManager.t("lobby.upgrade_col_buy")}</span>
        </div>
        <div id="pve-upgrade-rows"></div>
      `;
      upgradeContainer.appendChild(rowsWrapper);

      const rows = rowsWrapper.querySelector("#pve-upgrade-rows") as HTMLElement;

      for (const tier of ["basic", "advanced"] as const) {
        const heading = document.createElement("h3");
        heading.className = "permanent-upgrade-tier-title";
        heading.textContent = tier === "basic" ? I18nManager.t("lobby.upgrade_basic") : I18nManager.t("lobby.upgrade_advanced");
        if (tier === "advanced") {
          appendSizeUpgradeRow(runtime, rows, statusText);
        }
        rows.append(heading);
        for (const type of TREE_PIECE_ORDER) {
          for (const track of ["force", "weight"] as const) {
            appendUpgradeRow(runtime, rows, statusText, tier, type, track);
          }
        }
      }

      const resetBtn = document.createElement("button");
      resetBtn.className = "permanent-upgrade-reset";
      resetBtn.textContent = I18nManager.t("lobby.upgrade_reset_btn");
      resetBtn.style.cssText = "margin-top:12px; padding:10px; width:100%; background:#ef4444; color:white; border:none; border-radius:8px; font-weight:700; cursor:pointer;";
      resetBtn.onclick = () => {
        resetPermanentUpgrades(runtime.metaRuntime);
        renderContent();
      };
      upgradeContainer.appendChild(resetBtn);

      body.appendChild(upgradeContainer);
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
    .querySelector<HTMLButtonElement>("[data-game-mode]")
    ?.focus();
}

/**
 * 모드 보드와 상대 준비가 모두 끝난 뒤 메뉴를 닫고 인게임 메뉴 버튼을 연다.
 */
export function hideMainMenuAfterModeStart(
  runtime: MainMenuRuntime,
): void {
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

  const points = runtime.metaRuntime.state.points;
  const user = runtime.userProfile;

  if (user === null) {
    // -------------------------------------------------------------
    // 1. 미로그인 상태: 로그인 / 회원가입 / 게스트 로그인 뷰
    // -------------------------------------------------------------
    panel.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:12px;">
        <h1 id="main-menu-title" style="font-size:22px; font-weight:800; margin:0; letter-spacing:-0.03em; color:#f8fafc; flex-shrink:0;">${I18nManager.t("lobby.title")}</h1>
        <div style="display:flex; gap:6px; flex-wrap:nowrap; overflow-x:auto;">
          <button id="menu-ranking-btn" style="background:#1e293b; color:#f8fafc; border:1px solid #334155; border-radius:8px; padding:6px 10px; font-size:12px; font-weight:700; cursor:pointer; white-space:nowrap; word-break:keep-all;">
            🏆 ${I18nManager.t("common.ranking_btn")}
          </button>
          <button id="menu-friends-btn" style="background:#1e293b; color:#f8fafc; border:1px solid #334155; border-radius:8px; padding:6px 10px; font-size:12px; font-weight:700; cursor:pointer; white-space:nowrap; word-break:keep-all;">
            👥 ${I18nManager.t("common.friends_btn")}
          </button>
          <button id="menu-sound-btn" style="background:#334155; color:#f8fafc; border:none; border-radius:8px; padding:6px 10px; font-size:12px; font-weight:700; cursor:pointer; white-space:nowrap; word-break:keep-all;">
            ⚙️ ${I18nManager.t("common.settings")}
          </button>
        </div>
      </div>
      <p style="font-size:13px; color:#94a3b8; margin:0 0 16px 0;">${I18nManager.t("lobby.subtitle")}</p>

      <!-- 탭 선택 바 -->
      <div style="display:flex; gap:6px; background:#0f172a; padding:4px; border-radius:8px; margin-bottom:16px;">
        <button id="auth-tab-guest" style="flex:1; border:none; border-radius:6px; padding:8px 4px; font-size:12px; font-weight:700; cursor:pointer; background:#2563eb; color:white;">${I18nManager.t("lobby.guest_tab")}</button>
        <button id="auth-tab-login" style="flex:1; border:none; border-radius:6px; padding:8px 4px; font-size:12px; font-weight:700; cursor:pointer; background:transparent; color:#94a3b8;">${I18nManager.t("lobby.login_tab")}</button>
        <button id="auth-tab-signup" style="flex:1; border:none; border-radius:6px; padding:8px 4px; font-size:12px; font-weight:700; cursor:pointer; background:transparent; color:#94a3b8;">${I18nManager.t("lobby.signup_tab")}</button>
      </div>

      <div id="auth-tab-content"></div>
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
              <input type="text" id="guest-nickname-input" value="${savedNick}" style="width:100%; box-sizing:border-box; background:#0f172a; border:1px solid #334155; border-radius:8px; padding:10px; color:#f8fafc; font-size:14px;" />
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
  panel.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:12px;">
      <h1 id="main-menu-title" style="font-size:22px; font-weight:800; margin:0; letter-spacing:-0.03em; color:#f8fafc; flex-shrink:0;">${I18nManager.t("lobby.title")}</h1>
      <div style="display:flex; gap:6px; flex-wrap:nowrap; overflow-x:auto;">
        <button id="menu-ranking-btn" style="background:#1e293b; color:#f8fafc; border:1px solid #334155; border-radius:8px; padding:6px 10px; font-size:12px; font-weight:700; cursor:pointer; white-space:nowrap; word-break:keep-all;">
          🏆 ${I18nManager.t("common.ranking_btn")}
        </button>
        <button id="menu-friends-btn" style="background:#1e293b; color:#f8fafc; border:1px solid #334155; border-radius:8px; padding:6px 10px; font-size:12px; font-weight:700; cursor:pointer; white-space:nowrap; word-break:keep-all;">
          👥 ${I18nManager.t("common.friends_btn")}
        </button>
        <button id="menu-sound-btn" style="background:#334155; color:#f8fafc; border:none; border-radius:8px; padding:6px 10px; font-size:12px; font-weight:700; cursor:pointer; white-space:nowrap; word-break:keep-all;">
          ⚙️ ${I18nManager.t("common.settings")}
        </button>
      </div>
    </div>

    <!-- 유저 프로필 카드 -->
    <div style="background:#0f172a; border:1px solid #334155; border-radius:12px; padding:14px 16px; margin-bottom:18px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <div style="font-size:15px; font-weight:700; color:#f8fafc;">
          ${user.nickname} <span style="font-size:12px; color:#94a3b8; font-weight:normal; margin-left:6px;">| ${I18nManager.t("common.points")}: <strong style="color:#38bdf8;">${points} P</strong></span>
        </div>
        <button id="btn-logout" style="background:transparent; border:none; color:#94a3b8; font-size:12px; cursor:pointer; text-decoration:underline; padding:2px 4px;">
          ${I18nManager.t("common.logout")}
        </button>
      </div>
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px; font-size:12px;">
        <div style="background:#1e293b; padding:8px 10px; border-radius:6px; border:1px solid #1e3a8a;">
          <div style="color:#60a5fa; font-weight:700; margin-bottom:2px;">${I18nManager.t("lobby.classic_mmr")} ${user.classicMmr ?? user.mmr}</div>
          <div style="color:#94a3b8;">${I18nManager.t("lobby.win_draw_loss", { wins: user.classicWins ?? 0, draws: user.classicDraws ?? 0, losses: user.classicLosses ?? 0 })}</div>
        </div>
        <div style="background:#1e293b; padding:8px 10px; border-radius:6px; border:1px solid #581c87;">
          <div style="color:#c084fc; font-weight:700; margin-bottom:2px;">${I18nManager.t("lobby.strategy_mmr")} ${user.strategyMmr ?? user.mmr}</div>
          <div style="color:#94a3b8;">${I18nManager.t("lobby.win_draw_loss", { wins: user.strategyWins ?? 0, draws: user.strategyDraws ?? 0, losses: user.strategyLosses ?? 0 })}</div>
        </div>
      </div>
    </div>

    <!-- 게임 모드 선택 목록 (모바일 친화적 2x2 그리드) -->
    <div class="main-menu-modes" role="group" aria-label="대전 모드" style="display:grid; grid-template-columns: repeat(2, 1fr); gap:10px; width:100%; box-sizing:border-box;">
      <button type="button" data-game-mode="tutorial" style="padding:14px 10px; font-size:14px; font-weight:700; border-radius:8px; background:#059669; color:white; border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; text-align:center;">${I18nManager.t("lobby.mode_tutorial")}</button>
      <button type="button" data-game-mode="stage" style="padding:14px 10px; font-size:14px; font-weight:700; border-radius:8px; background:#2563eb; color:white; border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; text-align:center;">${I18nManager.t("lobby.mode_stage")}</button>
      <button type="button" data-game-mode="online" style="padding:14px 10px; font-size:14px; font-weight:700; border-radius:8px; background:#7c3aed; color:white; border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; text-align:center;">${I18nManager.t("lobby.mode_online")}</button>
      <button type="button" data-game-mode="hotseat" style="padding:14px 10px; font-size:14px; font-weight:700; border-radius:8px; background:#334155; color:#f8fafc; border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; text-align:center;">${I18nManager.t("lobby.mode_2p")}</button>
    </div>
    <p class="main-menu-status" data-menu-status aria-live="polite" style="margin-top:14px; font-size:13px;"></p>
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

  panel.querySelector("#btn-logout")?.addEventListener("click", async () => {
    const sb = getSupabaseClient();
    if (sb) await signOutUser(sb);
    localStorage.removeItem("ca_logged_in_user");
    runtime.userProfile = null;
    renderMainMenu(runtime);
  });

  for (const button of panel.querySelectorAll<HTMLButtonElement>("[data-game-mode]")) {
    button.disabled = !runtime.ready || runtime.busy;
    button.addEventListener("click", () => {
      const mode = button.dataset.gameMode;
      if (
        runtime.busy ||
        !runtime.ready ||
        (mode !== "hotseat" &&
          mode !== "stage" &&
          mode !== "online" &&
          mode !== "tutorial")
      ) {
        return;
      }

      if (mode === "tutorial") {
        runtime.busy = true;
        renderMainMenu(runtime);
        void runtime.onStartMode("tutorial", 1)
          .then(() => hideMainMenuAfterModeStart(runtime))
          .catch((err) => {
            console.error(err);
            runtime.busy = false;
          });
        return;
      }

      if (mode === "stage") {
        openPveLobbyModal(runtime, async (selectedStage) => {
          runtime.busy = true;
          renderMainMenu(runtime);
          try {
            await runtime.onStartMode("stage", selectedStage);
            hideMainMenuAfterModeStart(runtime);
          } catch (error: unknown) {
            const fullError =
              error instanceof Error
                ? (error.stack ?? error.message)
                : String(error);
            console.error(fullError);
            runtime.busy = false;
            const status =
              runtime.overlay.querySelector<HTMLElement>(
                "[data-menu-status]",
              );
            if (status !== null) {
              status.textContent = "스테이지 대전을 시작하지 못했습니다.";
            }
            renderMainMenu(runtime);
          }
        });
        return;
      }

      runtime.busy = true;
      renderMainMenu(runtime);
      void runtime.onStartMode(mode).then(
        () => {
          hideMainMenuAfterModeStart(runtime);
        },
        (error: unknown) => {
          const fullError =
            error instanceof Error
              ? (error.stack ?? error.message)
              : String(error);
          console.error(fullError);
          runtime.busy = false;
          const status =
            runtime.overlay.querySelector<HTMLElement>(
              "[data-menu-status]",
            );
          if (status !== null) {
            status.textContent = "대전을 시작하지 못했습니다.";
          }
          renderMainMenu(runtime);
        },
      );
    });
  }

  // 최초 접속 시 튜토리얼 권장 팝업 1회 표시
  TutorialManager.checkFirstVisitAndPrompt(
    () => {
      runtime.busy = true;
      renderMainMenu(runtime);
      void runtime.onStartMode("tutorial", 1)
        .then(() => hideMainMenuAfterModeStart(runtime))
        .catch((err) => {
          console.error(err);
          runtime.busy = false;
        });
    },
    () => {},
  );
}

/**
 * 메인 메뉴·인게임 메뉴 버튼·비차단 포기 확인 화면을 함께 만든다.
 */
export function createMainMenu(
  container: HTMLElement,
  metaRuntime: MetaRuntime,
  onStartMode: (mode: GameMode, selectedStage?: number) => Promise<void>,
  onReturnToMenu: () => Promise<void>,
  onConfirmAbandon: () => Promise<void>,
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
    ready: false,
    busy: false,
    visible: true,
    confirming: false,
    userProfile: initialProfile,
    onStartMode,
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
