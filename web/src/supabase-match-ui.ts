import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getOrCreateUserProfile,
  getSessionEmail,
  signInWithEmail,
  signOutUser,
  signUpWithEmail,
  updateNickname,
  type UserProfile,
} from "./supabase-auth";
import {
  getSavedSupabaseConfig,
  getSupabaseClient,
  saveSupabaseConfig,
} from "./supabase-client";
import {
  SupabaseMatchmaker,
  type MatchmakingStatus,
} from "./supabase-matchmaker";
import type { PieceSide } from "./layout";
import type { OnlineTransport } from "./online";
import { I18nManager } from "./i18n";
import { createStrategyStatAdapter } from "./strategy-stat-adapter";
import { PieceStatWorkbench, bindWorkbenchModal } from "./piece-stat-workbench";
import type { PiecePreviewServices } from "./piece-preview-renderer";
import type { PieceType } from "./config";
import { EnergySystem, SVG_COIN_ICON } from "./energy-system";

export interface SupabaseMatchUiCallbacks {
  onMatchStarted: (
    transport: OnlineTransport,
    mySide: PieceSide,
    matchId: string,
    opponent: { id: string; nickname: string; mmr: number },
    myProfile: UserProfile,
    strategyDeck?: import("./strategy-deck").StrategyDeck | null,
    matchMode?: "classic" | "strategy",
  ) => Promise<void>;
  onOpenManualP2P: () => void;
  onClose: () => void;
}

export class SupabaseMatchUi {
  private container: HTMLElement;
  private callbacks: SupabaseMatchUiCallbacks;
  private client: SupabaseClient | null = null;
  private profile: UserProfile | null = null;
  private matchmaker: SupabaseMatchmaker | null = null;
  private userEmail: string | null = null;
  private workbench: PieceStatWorkbench | null = null;
  private selectedPiece: PieceType = "Pawn";
  private activePvpMode: "classic" | "strategy" = "classic";
  private unsubscribeLanguage: () => void;
  private unsubscribeReferral: (() => void) | null = null;
  private unbindModal: (() => void) | null = null;
  private coinInterval: any = null;
  private disposed = false;
  private renderVersion = 0;

  constructor(container: HTMLElement, callbacks: SupabaseMatchUiCallbacks, initialProfile: UserProfile | null = null, private readonly previewServices: PiecePreviewServices | null = null) {
    this.container = container;
    this.callbacks = callbacks;
    this.profile = initialProfile;

    this.unsubscribeLanguage = I18nManager.subscribe(() => {
      if (this.container.children.length > 0 && !this.matchmaker) {
        void this.renderLobby();
      }
    });
  }

  /**
   * 온라인 매칭 로비 UI 렌더링
   */
  public async renderLobby(): Promise<void> {
    if (this.disposed) return;
    const version = ++this.renderVersion;
    this.disposeWorkbench();
    this.unbindModal?.(); this.unbindModal = null;
    this.container.innerHTML = "";
    this.client = getSupabaseClient();

    const root = document.createElement("div");
    root.className = "supabase-match-lobby piece-stat-modal";
    root.style.zIndex = "9999";
    root.setAttribute("aria-label", I18nManager.t("online.title"));
    const card = document.createElement("div");
    card.className = "piece-stat-modal-card";
    const attach = () => {
      root.append(card); this.container.append(root);
      this.unbindModal = bindWorkbenchModal(root, () => {
        const matchingCancel = root.querySelector<HTMLButtonElement>(".matching-modal-overlay button");
        const authClose = root.querySelector<HTMLButtonElement>("#auth-close-btn");
        if (matchingCancel) matchingCancel.click();
        else if (authClose) authClose.click();
        else { this.cancelSearch(); this.destroy(); this.callbacks.onClose(); }
      });
    };

    const header = document.createElement("div");
    header.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid #334155;
      padding-bottom: 14px;
    `;

    const titleGroup = document.createElement("div");
    titleGroup.style.cssText = "display:flex; align-items:center; gap:12px;";
    titleGroup.innerHTML = `
      <h2 style="margin:0; font-size:18px; font-weight:700; color:#f8fafc;">${I18nManager.t("online.title")}</h2>
    `;

    // 상단 코인 HUD 위젯
    const coinHud = document.createElement("div");
    coinHud.className = "coin-hud-badge";
    coinHud.title = "코인 충전소";
    coinHud.onclick = () => {
      this.openCoinModal(card, "info");
    };

    const updateCoinHud = () => {
      const state = EnergySystem.getState();
      const isMax = state.coins >= state.maxCoins;
      const mins = String(Math.floor(state.timeToNextMs / 60000)).padStart(2, "0");
      const secs = String(Math.floor((state.timeToNextMs % 60000) / 1000)).padStart(2, "0");
      const timeStr = isMax
        ? "<span class='coin-timer' style='color:#a7f3d0;'>MAX</span>"
        : `<span class='coin-timer'>${mins}:${secs}</span>`;
      coinHud.innerHTML = `${SVG_COIN_ICON} <span class="coin-count">${state.coins} / ${state.maxCoins}</span> ${timeStr}`;
    };
    updateCoinHud();
    if (this.coinInterval) clearInterval(this.coinInterval);
    this.coinInterval = setInterval(updateCoinHud, 1000);

    titleGroup.appendChild(coinHud);
    header.appendChild(titleGroup);

    const closeBtn = document.createElement("button");
    closeBtn.textContent = I18nManager.t("common.close");
    closeBtn.style.cssText = `
      background: transparent;
      border: none;
      color: #94a3b8;
      font-size: 14px;
      cursor: pointer;
      padding: 4px 8px;
    `;
    closeBtn.onclick = () => {
      this.cancelSearch();
      this.destroy();
      this.callbacks.onClose();
    };
    header.appendChild(closeBtn);
    card.appendChild(header);

    // Supabase 설정 미등록 시 설정 안내 폼 표시
    if (!this.client) {
      this.renderConfigForm(card);
      attach();
      return;
    }

    // 계정 상태 바 (이메일 로그인 vs 게스트)
    this.userEmail = await getSessionEmail(this.client);
    if (this.disposed || version !== this.renderVersion) return;
    const authBar = document.createElement("div");
    authBar.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 8px 12px;
      font-size: 13px;
    `;

    if (this.userEmail) {
      authBar.innerHTML = `
        <div style="color:#38bdf8; font-weight:600;">
          ${this.userEmail}
        </div>
      `;
      const signOutBtn = document.createElement("button");
      signOutBtn.textContent = I18nManager.t("common.logout");
      signOutBtn.style.cssText = "background:transparent; border:none; color:#f87171; font-size:12px; cursor:pointer;";
      signOutBtn.onclick = async () => {
        if (this.client) {
          await signOutUser(this.client);
          await this.renderLobby();
        }
      };
      authBar.appendChild(signOutBtn);
    } else {
      authBar.innerHTML = `
        <div style="color:#94a3b8;">
          ${I18nManager.t("online.guest_mode")}
        </div>
      `;
      const authBtn = document.createElement("button");
      authBtn.textContent = I18nManager.t("online.auth_btn");
      authBtn.style.cssText = `
        background: #3b82f6;
        color: white;
        border: none;
        border-radius: 6px;
        padding: 4px 10px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
      `;
      authBtn.onclick = () => {
        this.openAuthModal(card);
      };
      authBar.appendChild(authBtn);
    }
    card.appendChild(authBar);

    // 프로필 정보 로드
    const profileSection = document.createElement("div");
    profileSection.style.cssText = `
      background: #0f172a;
      border-radius: 12px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      border: 1px solid #334155;
    `;
    profileSection.innerHTML = `<div style="color:#94a3b8; font-size:14px; text-align:center;">${I18nManager.t("online.loading_profile")}</div>`;
    card.appendChild(profileSection);

    try {
      this.profile = await getOrCreateUserProfile(this.client);
      if (this.disposed || version !== this.renderVersion) return;
      this.renderProfileCard(profileSection, this.profile);

      // 초대한 유저(Referrer) 보상 서버 동기화 및 실시간 알림 리스너 연결
      if (this.profile && this.client) {
        void EnergySystem.syncReferralRewardsFromServer(this.profile.id, this.client);
        this.unsubscribeReferral?.();
        this.unsubscribeReferral = EnergySystem.subscribeReferralRealtime(this.profile.id, this.client);
      }
    } catch (err: any) {
      if (this.profile) {
        this.renderProfileCard(profileSection, this.profile);
      } else {
        profileSection.innerHTML = `
          <div style="color:#f87171; font-size:13px; text-align:center;">
            서버 접속 오류: ${err.message || "연결 실패"}
          </div>
        `;
      }
    }

    if (this.disposed || version !== this.renderVersion) return;

    // 클래식 vs 전략 랭크 탭
    const modeTabs = document.createElement("div");
    modeTabs.style.cssText = "display:flex; gap:8px; background:#0f172a; padding:4px; border-radius:8px;";
    
    const adapter = createStrategyStatAdapter({
      onMatch: async deck => {
        if (!this.profile || !this.client) throw new Error("Online profile is not ready.");
        await this.openMatchingModal(card, deck, "strategy");
      },
    });

    const actionContainer = document.createElement("div");
    actionContainer.style.cssText = "display:flex; flex-direction:column; gap:12px;";

    const renderActionArea = () => {
      this.disposeWorkbench();
      card.dataset.workbench = String(this.activePvpMode === "strategy");
      modeTabs.innerHTML = `
        <button id="pvp-tab-classic" style="flex:1; border:none; border-radius:6px; padding:8px; font-weight:700; font-size:13px; cursor:pointer; background:${this.activePvpMode === "classic" ? "#2563eb" : "transparent"}; color:${this.activePvpMode === "classic" ? "#fff" : "#94a3b8"};">${I18nManager.t("online.classic_tab")}</button>
        <button id="pvp-tab-strategy" style="flex:1; border:none; border-radius:6px; padding:8px; font-weight:700; font-size:13px; cursor:pointer; background:${this.activePvpMode === "strategy" ? "#7c3aed" : "transparent"}; color:${this.activePvpMode === "strategy" ? "#fff" : "#94a3b8"};">${I18nManager.t("online.strategy_tab")}</button>
      `;

      modeTabs.querySelector("#pvp-tab-classic")?.addEventListener("click", () => {
        this.activePvpMode = "classic";
        renderActionArea();
        modeTabs.querySelector<HTMLButtonElement>("#pvp-tab-classic")?.focus();
      });
      modeTabs.querySelector("#pvp-tab-strategy")?.addEventListener("click", () => {
        this.activePvpMode = "strategy";
        renderActionArea();
        modeTabs.querySelector<HTMLButtonElement>("#pvp-tab-strategy")?.focus();
      });

      actionContainer.innerHTML = "";

      if (this.activePvpMode === "classic") {
        const searchBtn = document.createElement("button");
        searchBtn.textContent = I18nManager.t("online.find_classic");
        searchBtn.style.cssText = `
          background: #2563eb;
          color: white;
          border: none;
          border-radius: 8px;
          padding: 14px 20px;
          font-size: 15px;
          font-weight: 700;
          cursor: pointer;
        `;
        searchBtn.onclick = () => {
          if (this.profile && this.client) {
            this.openMatchingModal(card, null, "classic");
          }
        };
        actionContainer.appendChild(searchBtn);
      } else {
        this.workbench = new PieceStatWorkbench(adapter, { selectedPiece: this.selectedPiece, previewServices: this.previewServices });
        actionContainer.append(this.workbench.element);
      }

      const manualBtn = document.createElement("button");
      manualBtn.textContent = I18nManager.t("online.friendly_btn");
      manualBtn.style.cssText = `
        background: #334155;
        color: #cbd5e1;
        border: 1px solid #475569;
        border-radius: 8px;
        padding: 10px 16px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
      `;
      manualBtn.onclick = () => {
        this.cancelSearch();
        this.destroy();
        this.callbacks.onOpenManualP2P();
      };
      actionContainer.appendChild(manualBtn);
    };

    renderActionArea();
    card.appendChild(modeTabs);
    card.appendChild(actionContainer);

    attach();
  }

  /**
   * 프로필 카드 렌더링 및 닉네임 수정
   */
  private renderProfileCard(container: HTMLElement, profile: UserProfile): void {
    container.innerHTML = "";

    const topRow = document.createElement("div");
    topRow.style.cssText = "display:flex; justify-content:space-between; align-items:center;";

    const nameWrapper = document.createElement("div");
    nameWrapper.style.cssText = "display:flex; align-items:center; gap:8px;";

    const nickDisplay = document.createElement("span");
    nickDisplay.textContent = profile.nickname;
    nickDisplay.style.cssText = "font-size:17px; font-weight:700; color:#f1f5f9;";

    const editBtn = document.createElement("button");
    editBtn.textContent = "✎";
    editBtn.title = "닉네임 변경";
    editBtn.style.cssText = "background:transparent; border:none; color:#60a5fa; cursor:pointer; font-size:14px;";
    editBtn.onclick = async () => {
      const newName = prompt("새 닉네임을 입력하세요 (2~20자):", profile.nickname);
      if (newName && this.client) {
        const res = await updateNickname(this.client, profile.id, newName);
        if (res.success) {
          profile.nickname = newName.trim();
          this.renderProfileCard(container, profile);
        } else {
          alert(res.error || "닉네임 변경 실패");
        }
      }
    };

    nameWrapper.appendChild(nickDisplay);
    nameWrapper.appendChild(editBtn);

    const mmrContainer = document.createElement("div");
    mmrContainer.style.cssText = "display:flex; gap:6px; font-size:12px; font-weight:700;";
    mmrContainer.innerHTML = `
      <span style="background:#1d4ed8; color:#fff; padding:4px 8px; border-radius:6px;">${I18nManager.t("lobby.classic_mmr")} ${profile.classicMmr ?? profile.mmr}</span>
      <span style="background:#6d28d9; color:#fff; padding:4px 8px; border-radius:6px;">${I18nManager.t("lobby.strategy_mmr")} ${profile.strategyMmr ?? profile.mmr}</span>
    `;

    topRow.appendChild(nameWrapper);
    topRow.appendChild(mmrContainer);

    const statGrid = document.createElement("div");
    statGrid.style.cssText = "display:grid; grid-template-columns: 1fr 1fr; gap:8px; font-size:12px; border-top:1px solid #1e293b; padding-top:10px;";
    statGrid.innerHTML = `
      <div style="background:#0f172a; padding:8px; border-radius:6px; border:1px solid #1e3a8a;">
        <div style="color:#60a5fa; font-weight:700; margin-bottom:4px;">${I18nManager.t("online.classic_record")}</div>
        <div style="color:#94a3b8;">${I18nManager.t("lobby.win_draw_loss", { wins: profile.classicWins, draws: profile.classicDraws, losses: profile.classicLosses })}</div>
      </div>
      <div style="background:#0f172a; padding:8px; border-radius:6px; border:1px solid #581c87;">
        <div style="color:#c084fc; font-weight:700; margin-bottom:4px;">${I18nManager.t("online.strategy_record")}</div>
        <div style="color:#94a3b8;">${I18nManager.t("lobby.win_draw_loss", { wins: profile.strategyWins, draws: profile.strategyDraws, losses: profile.strategyLosses })}</div>
      </div>
    `;

    container.appendChild(topRow);
    container.appendChild(statGrid);
  }

  /**
   * 실시간 매칭 검색 모달
   */
  private async openMatchingModal(
    parentCard: HTMLElement,
    strategyDeck: import("./strategy-deck").StrategyDeck | null = null,
    matchMode: "classic" | "strategy" = "classic",
  ): Promise<void> {
    if (!this.client || !this.profile) return;

    try {
      this.profile = await getOrCreateUserProfile(this.client);
    } catch {}
    if (this.disposed || !parentCard.isConnected || parentCard.querySelector(".matching-modal-overlay")) return;

    // 행동력(코인) 체크 및 1 코인 소모
    // 1단계: 코인 보유 잔액 사전 확인 (이 시점에는 차감하지 않음)
    if (!EnergySystem.hasEnoughCoin()) {
      this.openCoinModal(parentCard, "exhausted");
      return;
    }

    const modalOverlay = document.createElement("div");
    modalOverlay.className = "matching-modal-overlay";
    modalOverlay.style.cssText = `
      position: absolute;
      inset: 0;
      background: rgba(15, 23, 42, 0.96);
      border-radius: 16px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 18px;
      padding: 24px;
      z-index: 10;
    `;

    const modeName = matchMode === "strategy" ? I18nManager.t("online.strategy_tab") : I18nManager.t("online.classic_tab");
    modalOverlay.innerHTML = `
      <div style="font-size:48px; animation: pulse 1.5s infinite;"></div>
      <h3 style="margin:0; font-size:18px; color:#f8fafc; font-weight:700;">${I18nManager.t("online.searching_opponent", { mode: modeName })}</h3>
      <div id="matching-timer" style="font-size:15px; color:#38bdf8; font-weight:600;">${I18nManager.t("online.wait_time", { time: "00:00" })}</div>
      <div id="matching-range" style="font-size:13px; color:#94a3b8;">${I18nManager.t("online.search_range", { diff: 50 })}</div>
      <div id="matching-opponent" style="font-size:14px; color:#a7f3d0; font-weight:600; min-height:20px;"></div>
    `;

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = I18nManager.t("online.cancel_match");
    cancelBtn.style.cssText = `
      background: #ef4444;
      color: white;
      border: none;
      border-radius: 8px;
      padding: 10px 24px;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      margin-top: 10px;
    `;
    const background = [...parentCard.children] as HTMLElement[];
    const closeMatching = () => {
      background.forEach(element => { element.inert = false; });
      unbindMatching();
      modalOverlay.remove();
    };
    cancelBtn.onclick = () => {
      this.cancelSearch();
      closeMatching();
    };

    modalOverlay.appendChild(cancelBtn);
    parentCard.appendChild(modalOverlay);
    background.forEach(element => { element.inert = true; });
    const unbindMatching = bindWorkbenchModal(modalOverlay, () => cancelBtn.click());
    modalOverlay.setAttribute("aria-label", I18nManager.t("online.searching_opponent", { mode: modeName }));
    parentCard.scrollTop = 0;

    this.matchmaker = new SupabaseMatchmaker(this.client, this.profile, matchMode);
    void this.matchmaker.startMatching(
      (status: MatchmakingStatus) => {
        const timerEl = modalOverlay.querySelector("#matching-timer");
        const rangeEl = modalOverlay.querySelector("#matching-range");
        const oppEl = modalOverlay.querySelector("#matching-opponent");

        const mins = String(Math.floor(status.waitTimeSeconds / 60)).padStart(2, "0");
        const secs = String(status.waitTimeSeconds % 60).padStart(2, "0");
        if (timerEl) timerEl.textContent = I18nManager.t("online.wait_time", { time: `${mins}:${secs}` });
        if (rangeEl) rangeEl.textContent = I18nManager.t("online.search_range", { diff: status.allowedMmrDiff });

        if (status.opponent && oppEl) {
          oppEl.textContent = I18nManager.t("online.opponent_found", { name: status.opponent.nickname, mmr: status.opponent.mmr });
        }
      },
      async (transport, mySide, matchId, opponent) => {
        // ★ 상대 매칭 및 P2P 연결 성공: 인게임 대전 진입 확정 시점에 1코인 차감
        EnergySystem.consumeCoinOnGameStart();

        const oppEl = modalOverlay.querySelector("#matching-opponent");
        const sideStr = mySide === "white" ? I18nManager.t("ingame.turn_white") : I18nManager.t("ingame.turn_black");
        if (oppEl) oppEl.textContent = I18nManager.t("online.match_ready", { side: sideStr });
        closeMatching();
        this.destroy();
        this.container.innerHTML = "";
        if (this.profile) {
          await this.callbacks.onMatchStarted(transport, mySide, matchId, opponent, this.profile, strategyDeck, matchMode);
        }
      },
      (error) => {
        alert(`매칭 실패: ${error.message}`);
        closeMatching();
      },
    );
  }

  /**
   * 코인 정보 및 충전 모달 (mode: 'info' | 'exhausted')
   * - 타이머 기반 자동 닫기 없음: 사용자가 직접 [X] 또는 [닫기]를 누를 때까지 유지
   */
  private openCoinModal(parentCard: HTMLElement, mode: "info" | "exhausted" = "info"): void {
    if (parentCard.querySelector(".coin-modal-backdrop")) return;

    const overlay = document.createElement("div");
    overlay.className = "coin-modal-backdrop";

    const state = EnergySystem.getState();
    const isExhausted = mode === "exhausted";

    overlay.innerHTML = `
      <div class="coin-modal-card">
        <div class="coin-modal-header">
          <h3>${isExhausted ? "코인이 부족합니다!" : "코인 충전소"}</h3>
          <button class="coin-modal-close-btn" aria-label="닫기">&times;</button>
        </div>
        
        <p class="coin-modal-desc" style="${isExhausted ? "color:#f87171; font-weight:600;" : "color:#94a3b8;"}">
          ${
            isExhausted
              ? "게임을 플레이하려면 1코인이 필요합니다. 아래 방법으로 코인을 충전해보세요!"
              : `현재 보유 코인: <strong style="color:#f8fafc;">${state.coins} / ${state.maxCoins}</strong><br><span style="font-size:12px; opacity:0.85;">(최대 ${state.maxCoins}개까지 20분마다 1개씩 자동 충전)</span>`
          }
        </p>

        <div class="coin-charge-options">
          <button id="coin-watch-ad-btn" class="coin-charge-btn ad-btn">
            <span class="coin-btn-icon">📺</span>
            <div class="coin-btn-text">
              <strong>광고 시청하고 받기</strong>
              <span>시청 완료 시 +2 코인 충전 (${state.dailyAdLimit - state.adCountToday}/${state.dailyAdLimit})</span>
            </div>
          </button>

          <button id="coin-invite-friend-btn" class="coin-charge-btn invite-btn">
            <span class="coin-btn-icon">👥</span>
            <div class="coin-btn-text">
              <strong>친구 초대 링크 복사</strong>
              <span>친구가 접속 시 서로 +5 코인 지급</span>
            </div>
          </button>
        </div>

        <div style="margin-top: 4px;">
          <button id="coin-modal-bottom-close-btn" style="background:#334155; color:#cbd5e1; border:1px solid #475569; border-radius:8px; padding:8px 24px; font-size:13px; font-weight:600; cursor:pointer;">
            닫기
          </button>
        </div>
      </div>
    `;

    const topCloseBtn = overlay.querySelector<HTMLButtonElement>(".coin-modal-close-btn")!;
    const bottomCloseBtn = overlay.querySelector<HTMLButtonElement>("#coin-modal-bottom-close-btn")!;
    const adBtn = overlay.querySelector<HTMLButtonElement>("#coin-watch-ad-btn")!;
    const inviteBtn = overlay.querySelector<HTMLButtonElement>("#coin-invite-friend-btn")!;

    const updateAdBtnState = () => {
      const s = EnergySystem.getState();
      const strongEl = adBtn.querySelector("strong");
      const spanEl = adBtn.querySelector("span.coin-btn-text span");

      if (s.adCountToday >= s.dailyAdLimit) {
        adBtn.disabled = true;
        adBtn.style.opacity = "0.5";
        adBtn.style.cursor = "not-allowed";
        if (strongEl) strongEl.textContent = `오늘 광고 시청 완료 (${s.dailyAdLimit}/${s.dailyAdLimit})`;
        if (spanEl) spanEl.textContent = "내일 다시 시청할 수 있습니다.";
      } else if (s.adCooldownSec > 0) {
        adBtn.disabled = true;
        adBtn.style.opacity = "0.6";
        adBtn.style.cursor = "wait";
        if (strongEl) strongEl.textContent = `⏳ ${s.adCooldownSec}초 후 시청 가능`;
        if (spanEl) spanEl.textContent = `오늘 남은 횟수: ${s.dailyAdLimit - s.adCountToday}/${s.dailyAdLimit}`;
      } else {
        adBtn.disabled = false;
        adBtn.style.opacity = "1";
        adBtn.style.cursor = "pointer";
        if (strongEl) strongEl.textContent = "광고 시청하고 받기";
        if (spanEl) spanEl.textContent = `시청 완료 시 +2 코인 충전 (${s.dailyAdLimit - s.adCountToday}/${s.dailyAdLimit})`;
      }
    };
    updateAdBtnState();
    const modalAdInterval = setInterval(updateAdBtnState, 1000);

    const closeModal = () => {
      clearInterval(modalAdInterval);
      overlay.remove();
    };

    topCloseBtn.onclick = closeModal;
    bottomCloseBtn.onclick = closeModal;

    adBtn.onclick = async () => {
      const s = EnergySystem.getState();
      if (!s.adAvailable) {
        if (s.adCooldownSec > 0) {
          alert(`광고 재시청 대기 중입니다. ${s.adCooldownSec}초 후에 다시 시도해주세요.`);
        }
        return;
      }
      adBtn.disabled = true;
      adBtn.querySelector("strong")!.textContent = "광고 로딩 중...";
      const success = await EnergySystem.watchAdForCoins();
      if (success) {
        alert("광고 시청 완료! +2 코인이 지급되었습니다.");
        closeModal();
      } else {
        updateAdBtnState();
      }
    };

    inviteBtn.onclick = async () => {
      await EnergySystem.copyInviteLink(this.profile?.referralCode || this.profile?.id);
      closeModal();
    };

    parentCard.appendChild(overlay);
  }

  private disposeWorkbench(): void {
    if (this.workbench) this.selectedPiece = this.workbench.selection;
    this.workbench?.dispose(); this.workbench = null;
  }

  public destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.coinInterval) {
      clearInterval(this.coinInterval);
      this.coinInterval = null;
    }
    this.unsubscribeReferral?.();
    this.unsubscribeReferral = null;
    this.disposeWorkbench(); this.unsubscribeLanguage();
    this.unbindModal?.(); this.unbindModal = null;
  }

  private cancelSearch(): void {
    if (this.matchmaker) {
      this.matchmaker.cancel();
      this.matchmaker = null;
    }
  }

  /**
   * 이메일 회원가입 및 로그인 모달
   */
  private openAuthModal(parentCard: HTMLElement): void {
    if (!this.client) return;

    let mode: "signin" | "signup" = "signup";

    const modalOverlay = document.createElement("div");
    modalOverlay.className = "auth-modal-overlay";
    modalOverlay.style.cssText = `
      position: absolute;
      inset: 0;
      background: rgba(15, 23, 42, 0.98);
      border-radius: 16px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding: 24px;
      z-index: 20;
      box-sizing: border-box;
    `;

    const renderAuthForm = () => {
      modalOverlay.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #334155; padding-bottom:10px;">
          <h3 style="margin:0; font-size:18px; color:#f8fafc;">${mode === "signup" ? "신규 회원가입" : "계정 로그인"}</h3>
          <button id="auth-close-btn" style="background:transparent; border:none; color:#94a3b8; font-size:18px; cursor:pointer;">닫기</button>
        </div>

        <div style="display:flex; gap:8px; background:#0f172a; padding:4px; border-radius:8px;">
          <button id="tab-signup" style="flex:1; border:none; border-radius:6px; padding:8px; font-weight:700; font-size:13px; cursor:pointer; background:${mode === "signup" ? "#3b82f6" : "transparent"}; color:${mode === "signup" ? "#fff" : "#94a3b8"};">회원가입</button>
          <button id="tab-signin" style="flex:1; border:none; border-radius:6px; padding:8px; font-weight:700; font-size:13px; cursor:pointer; background:${mode === "signin" ? "#3b82f6" : "transparent"}; color:${mode === "signin" ? "#fff" : "#94a3b8"};">로그인</button>
        </div>

        <div style="display:flex; flex-direction:column; gap:10px; margin-top:4px;">
          <div>
            <label style="display:block; font-size:12px; color:#cbd5e1; margin-bottom:4px;">이메일</label>
            <input id="auth-email" type="email" placeholder="example@email.com" style="width:100%; box-sizing:border-box; background:#0f172a; border:1px solid #475569; border-radius:6px; padding:9px; color:#f8fafc; font-size:13px;" />
          </div>

          <div>
            <label style="display:block; font-size:12px; color:#cbd5e1; margin-bottom:4px;">비밀번호 (6자 이상)</label>
            <input id="auth-password" type="password" placeholder="••••••••" style="width:100%; box-sizing:border-box; background:#0f172a; border:1px solid #475569; border-radius:6px; padding:9px; color:#f8fafc; font-size:13px;" />
          </div>

          ${mode === "signup" ? `
            <div>
              <label style="display:block; font-size:12px; color:#cbd5e1; margin-bottom:4px;">닉네임 (2~20자)</label>
              <input id="auth-nickname" type="text" placeholder="체스마스터" value="${this.profile?.nickname || ""}" style="width:100%; box-sizing:border-box; background:#0f172a; border:1px solid #475569; border-radius:6px; padding:9px; color:#f8fafc; font-size:13px;" />
            </div>
          ` : ""}
        </div>

        <div id="auth-error-msg" style="color:#f87171; font-size:12px; min-height:16px;"></div>

        <button id="auth-submit-btn" style="background:#3b82f6; color:white; border:none; border-radius:8px; padding:12px; font-weight:700; font-size:14px; cursor:pointer; margin-top:4px;">
          ${mode === "signup" ? "회원가입 완료" : "로그인"}
        </button>
      `;

      modalOverlay.querySelector("#auth-close-btn")?.addEventListener("click", () => {
        modalOverlay.remove();
      });

      modalOverlay.querySelector("#tab-signup")?.addEventListener("click", () => {
        mode = "signup";
        renderAuthForm();
      });

      modalOverlay.querySelector("#tab-signin")?.addEventListener("click", () => {
        mode = "signin";
        renderAuthForm();
      });

      const submitBtn = modalOverlay.querySelector("#auth-submit-btn") as HTMLButtonElement;
      submitBtn?.addEventListener("click", async () => {
        if (!this.client) return;
        const email = (modalOverlay.querySelector("#auth-email") as HTMLInputElement)?.value.trim();
        const password = (modalOverlay.querySelector("#auth-password") as HTMLInputElement)?.value;
        const errorEl = modalOverlay.querySelector("#auth-error-msg") as HTMLElement;

        if (errorEl) errorEl.textContent = "";
        submitBtn.disabled = true;
        submitBtn.textContent = "처리 중...";

        if (mode === "signup") {
          const nickname = (modalOverlay.querySelector("#auth-nickname") as HTMLInputElement)?.value.trim();
          const res = await signUpWithEmail(this.client, email, password, nickname);
          if (res.success) {
            modalOverlay.remove();
            alert(`회원가입 완료! 환영합니다, ${nickname}님.`);
            await this.renderLobby();
          } else {
            if (errorEl) errorEl.textContent = res.error || "회원가입 실패";
            submitBtn.disabled = false;
            submitBtn.textContent = "회원가입 완료";
          }
        } else {
          const res = await signInWithEmail(this.client, email, password);
          if (res.success) {
            modalOverlay.remove();
            alert(`로그인 성공! ${res.user?.nickname}님으로 접속되었습니다.`);
            await this.renderLobby();
          } else {
            if (errorEl) errorEl.textContent = res.error || "로그인 실패";
            submitBtn.disabled = false;
            submitBtn.textContent = "로그인";
          }
        }
      });
    };

    renderAuthForm();
    parentCard.appendChild(modalOverlay);
  }

  /**
   * Supabase URL 및 Anon Key 설정 폼
   */
  private renderConfigForm(container: HTMLElement): void {
    container.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:14px;">
        <div style="font-size:18px; font-weight:700; color:#f8fafc;">서버 연동 설정</div>
        <p style="margin:0; font-size:13px; color:#94a3b8; line-height:1.5;">
          멀티플레이어 자동 매칭 및 Elo 랭킹 시스템을 활성화하려면 Supabase Project URL 및 Anon Key를 등록해주세요.
        </p>
        <div>
          <label style="display:block; font-size:12px; color:#cbd5e1; margin-bottom:4px;">Project URL</label>
          <input id="sb-url-input" type="text" placeholder="https://xxxx.supabase.co" style="width:100%; box-sizing:border-box; background:#0f172a; border:1px solid #475569; border-radius:6px; padding:10px; color:#f8fafc; font-size:13px;" />
        </div>
        <div>
          <label style="display:block; font-size:12px; color:#cbd5e1; margin-bottom:4px;">Anon Public API Key</label>
          <input id="sb-key-input" type="password" placeholder="eyJhbGciOi..." style="width:100%; box-sizing:border-box; background:#0f172a; border:1px solid #475569; border-radius:6px; padding:10px; color:#f8fafc; font-size:13px;" />
        </div>
      </div>
    `;

    const saved = getSavedSupabaseConfig();
    const urlInput = container.querySelector("#sb-url-input") as HTMLInputElement;
    const keyInput = container.querySelector("#sb-key-input") as HTMLInputElement;
    if (saved) {
      if (urlInput) urlInput.value = saved.url;
      if (keyInput) keyInput.value = saved.anonKey;
    }

    const btnGroup = document.createElement("div");
    btnGroup.style.cssText = "display:flex; gap:10px; margin-top:14px;";

    const saveBtn = document.createElement("button");
    saveBtn.textContent = "저장 및 연결";
    saveBtn.style.cssText = `
      flex: 1;
      background: #3b82f6;
      color: white;
      border: none;
      border-radius: 8px;
      padding: 12px;
      font-weight: 700;
      cursor: pointer;
    `;
    saveBtn.onclick = async () => {
      const url = urlInput.value.trim();
      const key = keyInput.value.trim();
      if (!url || !key) {
        alert("URL과 Anon Key를 모두 입력해주세요.");
        return;
      }
      try {
        saveSupabaseConfig({ url, anonKey: key });
        await this.renderLobby();
      } catch (err: any) {
        alert(`연결 설정 오류: ${err.message}`);
      }
    };

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "닫기";
    cancelBtn.style.cssText = `
      background: #334155;
      color: #94a3b8;
      border: none;
      border-radius: 8px;
      padding: 12px 18px;
      cursor: pointer;
    `;
    cancelBtn.onclick = () => {
      this.callbacks.onClose();
    };

    btnGroup.appendChild(saveBtn);
    btnGroup.appendChild(cancelBtn);
    container.appendChild(btnGroup);
  }
}
