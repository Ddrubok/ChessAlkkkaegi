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

  constructor(container: HTMLElement, callbacks: SupabaseMatchUiCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
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
      <div style="display:flex; align-items:center; gap:8px;">
        <span style="font-size:24px;">♟️</span>
        <h2 style="margin:0; font-size:20px; font-weight:700; color:#e2e8f0;">온라인 랭크 대전</h2>
      </div>
    `;

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "✕";
    closeBtn.style.cssText = `
      background: transparent;
      border: none;
      color: #94a3b8;
      font-size: 20px;
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 6px;
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
        <div style="color:#38bdf8; display:flex; align-items:center; gap:6px;">
          <span>👤</span>
          <span style="font-weight:600;">${this.userEmail}</span>
        </div>
      `;
      const signOutBtn = document.createElement("button");
      signOutBtn.textContent = "로그아웃";
      signOutBtn.style.cssText = "background:transparent; border:none; color:#f87171; font-size:12px; cursor:pointer; text-decoration:underline;";
      signOutBtn.onclick = async () => {
        if (this.client) {
          await signOutUser(this.client);
          await this.renderLobby();
        }
      };
      authBar.appendChild(signOutBtn);
    } else {
      authBar.innerHTML = `
        <div style="color:#94a3b8; display:flex; align-items:center; gap:6px;">
          <span>👻</span>
          <span>게스트 모드</span>
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
      profileSection.innerHTML = `
        <div style="color:#f87171; font-size:13px; text-align:center;">
          서버 접속 오류: ${err.message || "연결 실패"}
        </div>
      `;
    }

    // 메인 액션 버튼 그룹
    const actionGroup = document.createElement("div");
    actionGroup.style.cssText = "display: flex; flex-direction: column; gap: 12px;";

    const searchBtn = document.createElement("button");
    searchBtn.textContent = "⚡ 빠른 랭크 매치 찾기";
    searchBtn.style.cssText = `
      background: linear-gradient(135deg, #3b82f6, #1d4ed8);
      color: white;
      border: none;
      border-radius: 10px;
      padding: 14px 20px;
      font-size: 16px;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(59, 130, 246, 0.4);
      transition: all 0.2s;
    `;
    searchBtn.onmouseover = () => {
      searchBtn.style.transform = "translateY(-2px)";
    };
    searchBtn.onmouseout = () => {
      searchBtn.style.transform = "none";
    };
    searchBtn.onclick = () => {
      if (this.profile && this.client) {
        this.openMatchingModal(card);
      }
    };
    actionGroup.appendChild(searchBtn);

    const manualBtn = document.createElement("button");
    manualBtn.textContent = "🔗 초대 코드 직접 입력 (친선전)";
    manualBtn.style.cssText = `
      background: #334155;
      color: #cbd5e1;
      border: 1px solid #475569;
      border-radius: 10px;
      padding: 12px 18px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    `;
    manualBtn.onmouseover = () => {
      manualBtn.style.background = "#475569";
    };
    manualBtn.onmouseout = () => {
      manualBtn.style.background = "#334155";
    };
    manualBtn.onclick = () => {
      this.cancelSearch();
      this.callbacks.onOpenManualP2P();
    };
    actionGroup.appendChild(manualBtn);

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

    card.appendChild(actionGroup);
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

    const mmrBadge = document.createElement("div");
    mmrBadge.style.cssText = `
      background: linear-gradient(135deg, #f59e0b, #d97706);
      color: #fff;
      padding: 4px 10px;
      border-radius: 9999px;
      font-size: 13px;
      font-weight: 800;
      box-shadow: 0 2px 6px rgba(245, 158, 11, 0.4);
    `;
    mmrBadge.textContent = `MMR ${profile.mmr}`;

    topRow.appendChild(nameWrapper);
    topRow.appendChild(mmrBadge);

    const statRow = document.createElement("div");
    statRow.style.cssText = "display:flex; justify-content:space-around; font-size:13px; color:#94a3b8; border-top:1px solid #1e293b; padding-top:8px;";
    statRow.innerHTML = `
      <div><span style="color:#22c55e; font-weight:700;">${profile.wins}</span> 승</div>
      <div><span style="color:#94a3b8; font-weight:700;">${profile.draws}</span> 무</div>
      <div><span style="color:#ef4444; font-weight:700;">${profile.losses}</span> 패</div>
    `;

    container.appendChild(topRow);
    container.appendChild(statRow);
  }

  /**
   * 실시간 매칭 검색 모달
   */
  private async openMatchingModal(parentCard: HTMLElement): Promise<void> {
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

    modalOverlay.innerHTML = `
      <div style="font-size:48px; animation: pulse 1.5s infinite;">🎯</div>
      <h3 style="margin:0; font-size:18px; color:#f8fafc; font-weight:700;">상대 플레이어 탐색 중</h3>
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

    this.matchmaker = new SupabaseMatchmaker(this.client, this.profile);
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
        if (oppEl) oppEl.textContent = `⚡ 연결 완료! ${mySide === "white" ? "백(선공)" : "흑(후공)"}으로 시작합니다.`;
        this.container.innerHTML = "";
        if (this.profile) {
          await this.callbacks.onMatchStarted(transport, mySide, matchId, opponent, this.profile);
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
          <h3 style="margin:0; font-size:18px; color:#f8fafc;">${mode === "signup" ? "📝 신규 회원가입" : "🔑 계정 로그인"}</h3>
          <button id="auth-close-btn" style="background:transparent; border:none; color:#94a3b8; font-size:18px; cursor:pointer;">✕</button>
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
        <div style="font-size:18px; font-weight:700; color:#f8fafc;">⚙️ Supabase 서버 연동 설정</div>
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
