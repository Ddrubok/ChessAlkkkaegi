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

  constructor(container: HTMLElement, callbacks: SupabaseMatchUiCallbacks, initialProfile: UserProfile | null = null) {
    this.container = container;
    this.callbacks = callbacks;
    this.profile = initialProfile;
  }

  /**
   * 온라인 매칭 로비 UI 렌더링
   */
  public async renderLobby(): Promise<void> {
    this.container.innerHTML = "";
    this.client = getSupabaseClient();

    const root = document.createElement("div");
    root.className = "supabase-match-lobby";
    root.style.cssText = `
      position: absolute;
      inset: 0;
      background: rgba(15, 23, 42, 0.95);
      backdrop-filter: blur(12px);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      z-index: 9999;
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      padding: 20px;
      box-sizing: border-box;
    `;

    const card = document.createElement("div");
    card.style.cssText = `
      width: 100%;
      max-width: 460px;
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 16px;
      padding: 28px;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5);
      display: flex;
      flex-direction: column;
      gap: 18px;
      position: relative;
    `;

    // 헤더 영역
    const header = document.createElement("div");
    header.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid #334155;
      padding-bottom: 14px;
    `;
    header.innerHTML = `
      <div>
        <h2 style="margin:0; font-size:18px; font-weight:700; color:#f8fafc;">온라인 랭크 대전</h2>
      </div>
    `;

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "닫기";
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
      this.callbacks.onClose();
    };
    header.appendChild(closeBtn);
    card.appendChild(header);

    // Supabase 설정 미등록 시 설정 안내 폼 표시
    if (!this.client) {
      this.renderConfigForm(card);
      root.appendChild(card);
      this.container.appendChild(root);
      return;
    }

    // 계정 상태 바 (이메일 로그인 vs 게스트)
    this.userEmail = await getSessionEmail(this.client);
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
      signOutBtn.textContent = "로그아웃";
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
          게스트 모드
        </div>
      `;
      const authBtn = document.createElement("button");
      authBtn.textContent = "회원가입 / 로그인";
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
    profileSection.innerHTML = `<div style="color:#94a3b8; font-size:14px; text-align:center;">프로필 정보를 불러오는 중...</div>`;
    card.appendChild(profileSection);

    try {
      this.profile = await getOrCreateUserProfile(this.client);
      this.renderProfileCard(profileSection, this.profile);
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

    // 클래식 vs 전략 랭크 탭
    const modeTabs = document.createElement("div");
    modeTabs.style.cssText = "display:flex; gap:8px; background:#0f172a; padding:4px; border-radius:8px;";
    
    let activePvpMode: "classic" | "strategy" = "classic";

    const defaultStrategyDeck = {
      Pawn: { force: 0, weight: 0 },
      Knight: { force: 0, weight: 0 },
      Bishop: { force: 0, weight: 0 },
      Rook: { force: 0, weight: 0 },
      Queen: { force: 0, weight: 0 },
      King: { force: 0, weight: 0 },
    };
    let strategyDeck = defaultStrategyDeck;
    try {
      const saved = localStorage.getItem("ca_strategy_deck");
      if (saved) strategyDeck = JSON.parse(saved);
    } catch {}

    const actionContainer = document.createElement("div");
    actionContainer.style.cssText = "display:flex; flex-direction:column; gap:12px;";

    const renderActionArea = () => {
      modeTabs.innerHTML = `
        <button id="pvp-tab-classic" style="flex:1; border:none; border-radius:6px; padding:8px; font-weight:700; font-size:13px; cursor:pointer; background:${activePvpMode === "classic" ? "#2563eb" : "transparent"}; color:${activePvpMode === "classic" ? "#fff" : "#94a3b8"};">클래식 랭크</button>
        <button id="pvp-tab-strategy" style="flex:1; border:none; border-radius:6px; padding:8px; font-weight:700; font-size:13px; cursor:pointer; background:${activePvpMode === "strategy" ? "#7c3aed" : "transparent"}; color:${activePvpMode === "strategy" ? "#fff" : "#94a3b8"};">전략 랭크 (10P)</button>
      `;

      modeTabs.querySelector("#pvp-tab-classic")?.addEventListener("click", () => {
        activePvpMode = "classic";
        renderActionArea();
      });
      modeTabs.querySelector("#pvp-tab-strategy")?.addEventListener("click", () => {
        activePvpMode = "strategy";
        renderActionArea();
      });

      actionContainer.innerHTML = "";

      if (activePvpMode === "classic") {
        const searchBtn = document.createElement("button");
        searchBtn.textContent = "클래식 매치 찾기";
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
        // 전략 덱 세팅 창
        const deckBox = document.createElement("div");
        deckBox.style.cssText = "background:#0f172a; border:1px solid #334155; border-radius:8px; padding:12px; display:flex; flex-direction:column; gap:8px;";

        const calcSpent = () => {
          let spent = 0;
          for (const key of Object.keys(strategyDeck) as (keyof typeof strategyDeck)[]) {
            spent += strategyDeck[key].force + strategyDeck[key].weight;
          }
          return spent;
        };

        const deckHeader = document.createElement("div");
        deckHeader.style.cssText = "display:flex; justify-content:space-between; align-items:center; font-size:13px; font-weight:700;";
        const spent = calcSpent();
        deckHeader.innerHTML = `
          <span style="color:#cbd5e1;">전략 스탯 분배 (비공개)</span>
          <span style="color:${spent === 10 ? "#22c55e" : "#fbbf24"};">배분 포인트: ${spent} / 10 P</span>
        `;
        deckBox.appendChild(deckHeader);

        const pieceLabels: Record<keyof typeof strategyDeck, string> = {
          Pawn: "폰",
          Knight: "나이트",
          Bishop: "비숍",
          Rook: "룩",
          Queen: "퀸",
          King: "킹",
        };

        const rowsGrid = document.createElement("div");
        rowsGrid.style.cssText = "display:flex; flex-direction:column; gap:6px; max-height:180px; overflow-y:auto; padding-right:4px;";

        for (const pieceKey of Object.keys(pieceLabels) as (keyof typeof strategyDeck)[]) {
          const row = document.createElement("div");
          row.style.cssText = "display:flex; justify-content:space-between; align-items:center; background:#1e293b; padding:6px 10px; border-radius:6px; font-size:12px;";
          
          const label = document.createElement("span");
          label.style.cssText = "font-weight:600; width:60px;";
          label.textContent = pieceLabels[pieceKey];

          const controls = document.createElement("div");
          controls.style.cssText = "display:flex; align-items:center; gap:8px;";

          // Force control
          const forceBox = document.createElement("div");
          forceBox.style.cssText = "display:flex; align-items:center; gap:3px;";
          forceBox.innerHTML = `<span style="color:#f87171; font-weight:700;">힘</span>`;
          const forceMinus = document.createElement("button");
          forceMinus.textContent = "-";
          forceMinus.style.cssText = "width:20px; height:20px; background:#334155; color:white; border:none; border-radius:3px; cursor:pointer;";
          const forceVal = document.createElement("span");
          forceVal.textContent = String(strategyDeck[pieceKey].force);
          forceVal.style.cssText = "font-weight:700; min-width:14px; text-align:center;";
          const forcePlus = document.createElement("button");
          forcePlus.textContent = "+";
          forcePlus.style.cssText = "width:20px; height:20px; background:#334155; color:white; border:none; border-radius:3px; cursor:pointer;";

          forceMinus.onclick = () => {
            if (strategyDeck[pieceKey].force > 0) {
              strategyDeck[pieceKey].force -= 1;
              localStorage.setItem("ca_strategy_deck", JSON.stringify(strategyDeck));
              renderActionArea();
            }
          };
          forcePlus.onclick = () => {
            if (calcSpent() < 10 && strategyDeck[pieceKey].force < 4) {
              strategyDeck[pieceKey].force += 1;
              localStorage.setItem("ca_strategy_deck", JSON.stringify(strategyDeck));
              renderActionArea();
            }
          };
          forceBox.append(forceMinus, forceVal, forcePlus);

          // Weight control
          const weightBox = document.createElement("div");
          weightBox.style.cssText = "display:flex; align-items:center; gap:3px;";
          weightBox.innerHTML = `<span style="color:#38bdf8; font-weight:700;">중량</span>`;
          const weightMinus = document.createElement("button");
          weightMinus.textContent = "-";
          weightMinus.style.cssText = "width:20px; height:20px; background:#334155; color:white; border:none; border-radius:3px; cursor:pointer;";
          const weightVal = document.createElement("span");
          weightVal.textContent = String(strategyDeck[pieceKey].weight);
          weightVal.style.cssText = "font-weight:700; min-width:14px; text-align:center;";
          const weightPlus = document.createElement("button");
          weightPlus.textContent = "+";
          weightPlus.style.cssText = "width:20px; height:20px; background:#334155; color:white; border:none; border-radius:3px; cursor:pointer;";

          weightMinus.onclick = () => {
            if (strategyDeck[pieceKey].weight > 0) {
              strategyDeck[pieceKey].weight -= 1;
              localStorage.setItem("ca_strategy_deck", JSON.stringify(strategyDeck));
              renderActionArea();
            }
          };
          weightPlus.onclick = () => {
            if (calcSpent() < 10 && strategyDeck[pieceKey].weight < 4) {
              strategyDeck[pieceKey].weight += 1;
              localStorage.setItem("ca_strategy_deck", JSON.stringify(strategyDeck));
              renderActionArea();
            }
          };
          weightBox.append(weightMinus, weightVal, weightPlus);

          controls.append(forceBox, weightBox);
          row.append(label, controls);
          rowsGrid.appendChild(row);
        }

        deckBox.appendChild(rowsGrid);
        actionContainer.appendChild(deckBox);

        const searchStrategyBtn = document.createElement("button");
        searchStrategyBtn.textContent = "전략 매치 찾기";
        searchStrategyBtn.style.cssText = `
          background: #7c3aed;
          color: white;
          border: none;
          border-radius: 8px;
          padding: 14px 20px;
          font-size: 15px;
          font-weight: 700;
          cursor: pointer;
        `;
        searchStrategyBtn.onclick = () => {
          if (this.profile && this.client) {
            this.openMatchingModal(card, strategyDeck, "strategy");
          }
        };
        actionContainer.appendChild(searchStrategyBtn);
      }

      const manualBtn = document.createElement("button");
      manualBtn.textContent = "초대 코드로 접속 (친선전)";
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
        this.callbacks.onOpenManualP2P();
      };
      actionContainer.appendChild(manualBtn);
    };

    renderActionArea();
    card.appendChild(modeTabs);
    card.appendChild(actionContainer);

    // 하단 설정 링크
    const footerLink = document.createElement("div");
    footerLink.style.cssText = `
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      color: #64748b;
      margin-top: 4px;
    `;
    footerLink.innerHTML = `
      <span>Supabase BaaS 연동 활성화</span>
    `;

    const configBtn = document.createElement("a");
    configBtn.textContent = "서버 설정 변경";
    configBtn.style.cssText = "color: #94a3b8; text-decoration: underline; cursor: pointer;";
    configBtn.onclick = () => {
      card.innerHTML = "";
      this.renderConfigForm(card);
    };
    footerLink.appendChild(configBtn);
    card.appendChild(footerLink);

    root.appendChild(card);
    this.container.appendChild(root);
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
      <span style="background:#1d4ed8; color:#fff; padding:4px 8px; border-radius:6px;">클래식 ${profile.classicMmr ?? profile.mmr}</span>
      <span style="background:#6d28d9; color:#fff; padding:4px 8px; border-radius:6px;">전략 ${profile.strategyMmr ?? profile.mmr}</span>
    `;

    topRow.appendChild(nameWrapper);
    topRow.appendChild(mmrContainer);

    const statGrid = document.createElement("div");
    statGrid.style.cssText = "display:grid; grid-template-columns: 1fr 1fr; gap:8px; font-size:12px; border-top:1px solid #1e293b; padding-top:10px;";
    statGrid.innerHTML = `
      <div style="background:#0f172a; padding:8px; border-radius:6px; border:1px solid #1e3a8a;">
        <div style="color:#60a5fa; font-weight:700; margin-bottom:4px;">클래식 전적</div>
        <div style="color:#94a3b8;"><strong style="color:#22c55e;">${profile.classicWins}</strong>승 <strong style="color:#94a3b8;">${profile.classicDraws}</strong>무 <strong style="color:#ef4444;">${profile.classicLosses}</strong>패</div>
      </div>
      <div style="background:#0f172a; padding:8px; border-radius:6px; border:1px solid #581c87;">
        <div style="color:#c084fc; font-weight:700; margin-bottom:4px;">전략 전적 (10P)</div>
        <div style="color:#94a3b8;"><strong style="color:#22c55e;">${profile.strategyWins}</strong>승 <strong style="color:#94a3b8;">${profile.strategyDraws}</strong>무 <strong style="color:#ef4444;">${profile.strategyLosses}</strong>패</div>
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

    const modeName = matchMode === "strategy" ? "전략 랭크 (10P)" : "클래식 랭크";
    modalOverlay.innerHTML = `
      <div style="font-size:48px; animation: pulse 1.5s infinite;"></div>
      <h3 style="margin:0; font-size:18px; color:#f8fafc; font-weight:700;">${modeName} 상대 탐색 중</h3>
      <div id="matching-timer" style="font-size:15px; color:#38bdf8; font-weight:600;">대기 시간: 00:00</div>
      <div id="matching-range" style="font-size:13px; color:#94a3b8;">MMR 탐색 범위: ±50</div>
      <div id="matching-opponent" style="font-size:14px; color:#a7f3d0; font-weight:600; min-height:20px;"></div>
    `;

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "매칭 취소";
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
    cancelBtn.onclick = () => {
      this.cancelSearch();
      modalOverlay.remove();
    };

    modalOverlay.appendChild(cancelBtn);
    parentCard.appendChild(modalOverlay);

    this.matchmaker = new SupabaseMatchmaker(this.client, this.profile, matchMode);
    void this.matchmaker.startMatching(
      (status: MatchmakingStatus) => {
        const timerEl = modalOverlay.querySelector("#matching-timer");
        const rangeEl = modalOverlay.querySelector("#matching-range");
        const oppEl = modalOverlay.querySelector("#matching-opponent");

        const mins = String(Math.floor(status.waitTimeSeconds / 60)).padStart(2, "0");
        const secs = String(status.waitTimeSeconds % 60).padStart(2, "0");
        if (timerEl) timerEl.textContent = `대기 시간: ${mins}:${secs}`;
        if (rangeEl) rangeEl.textContent = `MMR 탐색 범위: ±${status.allowedMmrDiff}`;

        if (status.opponent && oppEl) {
          oppEl.textContent = `상대 발견: ${status.opponent.nickname} (${status.opponent.mmr})`;
        }
      },
      async (transport, mySide, matchId, opponent) => {
        const oppEl = modalOverlay.querySelector("#matching-opponent");
        if (oppEl) oppEl.textContent = `연결 완료! ${mySide === "white" ? "백(선공)" : "흑(후공)"}으로 시작합니다.`;
        this.container.innerHTML = "";
        if (this.profile) {
          await this.callbacks.onMatchStarted(transport, mySide, matchId, opponent, this.profile, strategyDeck, matchMode);
        }
      },
      (error) => {
        alert(`매칭 실패: ${error.message}`);
        modalOverlay.remove();
      },
    );
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
