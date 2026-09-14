import { I18nManager } from "./i18n";
import { SocialService } from "./social-service";
import type { UserProfile } from "./supabase-auth";
import { escapeHtml } from "./html";
import { KING_MMR } from "./tier";
import { renderTierBadge } from "./tier-view";
import { bindWorkbenchModal } from "./piece-stat-workbench";

/**
 * 랭킹 순위표 모달 렌더러
 * - 클래식 / 전략 모드 탭 지원
 * - 전체(All) / 👑 킹(King) 랭킹 범위(Scope) 지원
 * - 킹 랭킹은 rating >= KING_MMR 서버 측 필터링 적용
 * - 킹 자격 충족자만 킹 순위 표시, 비자격자는 킹 진입 진행도 안내
 * - 비동기 race condition 및 닫기/재열림 가드
 */
export async function openRankingModal(
  parentContainer: HTMLElement,
  userProfile: UserProfile | null,
): Promise<void> {
  const existing = document.querySelector(".ranking-modal-overlay");
  if (existing) (existing.querySelector<HTMLButtonElement>("#ranking-close-btn"))?.click();

  let isClosed = false;
  let requestId = 0;
  let unbindModal = () => {};

  const overlay = document.createElement("div");
  overlay.className = "ranking-modal-overlay";
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.75);
    padding: 12px;
    box-sizing: border-box;
  `;

  const closeModal = () => {
    if (isClosed) return;
    isClosed = true;
    overlay.remove();
    unbindModal();
  };

  const card = document.createElement("div");
  card.className = "ranking-modal-card";
  card.style.cssText = `
    width: min(480px, 100%);
    max-height: 85vh;
    background: #0f172a;
    border: 1px solid #334155;
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.6);
    overflow: hidden;
    color: #f8fafc;
    font-family: inherit;
  `;

  let currentMode: "classic" | "strategy" = "classic";
  let currentScope: "all" | "king" = "all";

  // 카드 스켈레톤 마크업 렌더링
  card.innerHTML = `
    <!-- 헤더 -->
    <div style="display:flex; justify-content:space-between; align-items:center; padding:14px 16px; border-bottom:1px solid #1e293b;">
      <h2 style="margin:0; font-size:17px; font-weight:800; display:flex; align-items:center; gap:8px;">
        <span>🏆</span> ${I18nManager.t("ranking.title")}
      </h2>
      <button id="ranking-close-btn" aria-label="${escapeHtml(I18nManager.t("common.close"))}" style="background:transparent; border:none; color:#cbd5e1; font-size:20px; cursor:pointer; min-width:44px; min-height:44px; line-height:1;">✕</button>
    </div>

    <!-- 모드 탭 (클래식 / 전략) -->
    <div style="display:flex; gap:6px; padding:8px 16px; background:#1e293b; border-bottom:1px solid #334155;">
      <button id="tab-classic" style="flex:1; border:none; border-radius:6px; padding:8px; font-size:13px; font-weight:700; cursor:pointer; transition:all 0.15s ease; white-space:normal; word-break:keep-all;">
        ${I18nManager.t("ranking.tab_classic")}
      </button>
      <button id="tab-strategy" style="flex:1; border:none; border-radius:6px; padding:8px; font-size:13px; font-weight:700; cursor:pointer; transition:all 0.15s ease; white-space:normal; word-break:keep-all;">
        ${I18nManager.t("ranking.tab_strategy")}
      </button>
    </div>

    <!-- 랭킹 범위 탭 (전체 / 👑 킹) -->
    <div style="display:flex; gap:6px; padding:6px 16px; background:#131d31; border-bottom:1px solid #334155;">
      <button id="scope-all" style="flex:1; border:1px solid #334155; border-radius:6px; padding:6px 10px; font-size:12px; font-weight:700; cursor:pointer; transition:all 0.15s ease; white-space:normal;">
        ${I18nManager.t("tier.scope_all")}
      </button>
      <button id="scope-king" style="flex:1; border:1px solid #334155; border-radius:6px; padding:6px 10px; font-size:12px; font-weight:700; cursor:pointer; transition:all 0.15s ease; white-space:normal;">
        ${I18nManager.t("lobby.piece_king")}
      </button>
    </div>

    <!-- 리더보드 컬럼 헤더 -->
    <div class="ranking-columns" style="padding:8px 16px; border-bottom:1px solid #1e293b; font-size:11px; color:#94a3b8;">
      <span>${I18nManager.t("ranking.col_rank")}</span>
      <span>${I18nManager.t("ranking.col_player")}</span>
      <span id="ranking-tier-col-header" style="text-align:right;">${I18nManager.t("tier.column")}</span>
    </div>

    <!-- 랭킹 리스트 컨테이너 -->
    <div id="ranking-list-body" style="overflow-y:auto; padding:4px 0; min-height:136px; max-height:360px;">
    </div>

    <!-- 내 실시간 순위 하단 바 -->
    <div id="ranking-my-bar" aria-live="polite" style="padding:14px 16px; background:#1e293b; border-top:1px solid #334155; font-size:12px;">
    </div>
  `;

  const tabClassicBtn = card.querySelector("#tab-classic") as HTMLButtonElement;
  const tabStrategyBtn = card.querySelector("#tab-strategy") as HTMLButtonElement;
  const scopeAllBtn = card.querySelector("#scope-all") as HTMLButtonElement;
  const scopeKingBtn = card.querySelector("#scope-king") as HTMLButtonElement;
  const tierColHeader = card.querySelector("#ranking-tier-col-header") as HTMLElement;
  const listBody = card.querySelector("#ranking-list-body") as HTMLElement;
  const myBar = card.querySelector("#ranking-my-bar") as HTMLElement;

  const updateTabStyles = () => {
    for (const [button, selected] of [[tabClassicBtn, currentMode === "classic"], [tabStrategyBtn, currentMode === "strategy"], [scopeAllBtn, currentScope === "all"], [scopeKingBtn, currentScope === "king"]] as const) {
      button.setAttribute("aria-pressed", String(selected));
    }
    if (tabClassicBtn) {
      tabClassicBtn.style.background = currentMode === "classic" ? "#2563eb" : "transparent";
      tabClassicBtn.style.color = currentMode === "classic" ? "white" : "#94a3b8";
    }
    if (tabStrategyBtn) {
      tabStrategyBtn.style.background = currentMode === "strategy" ? "#7c3aed" : "transparent";
      tabStrategyBtn.style.color = currentMode === "strategy" ? "white" : "#94a3b8";
    }
    if (scopeAllBtn) {
      scopeAllBtn.style.background = currentScope === "all" ? "rgba(56, 189, 248, 0.18)" : "transparent";
      scopeAllBtn.style.color = currentScope === "all" ? "#38bdf8" : "#94a3b8";
      scopeAllBtn.style.borderColor = currentScope === "all" ? "#38bdf8" : "#334155";
    }
    if (scopeKingBtn) {
      scopeKingBtn.style.background = currentScope === "king" ? "rgba(245, 158, 11, 0.22)" : "transparent";
      scopeKingBtn.style.color = currentScope === "king" ? "#fbbf24" : "#94a3b8";
      scopeKingBtn.style.borderColor = currentScope === "king" ? "#f59e0b" : "#334155";
    }
    if (tierColHeader) {
      tierColHeader.textContent = I18nManager.t(currentScope === "king" ? "tier.king_score" : "tier.column");
    }
  };

  const updateContent = async () => {
    updateTabStyles();
    myBar.textContent = I18nManager.t("tier.loading");
    listBody.setAttribute("aria-busy", "true");

    listBody.innerHTML = `
      <div style="padding:40px 20px; text-align:center; color:#64748b; font-size:13px;">
        ${I18nManager.t("tier.loading")}
      </div>
    `;

    const myRequestId = ++requestId;
    const targetMode = currentMode;
    const targetScope = currentScope;
    const isKingScope = targetScope === "king";

    const [leaderboard, myRankInfo] = await Promise.all([
      SocialService.getLeaderboard(targetMode, 50, isKingScope),
      userProfile && userProfile.id !== "local_guest"
        ? SocialService.getMyRank(userProfile.id, targetMode)
        : Promise.resolve(null),
    ]);

    // 비동기 응답 도착 전 모달이 닫혔거나 탭이 바뀌었으면 폐기
    if (isClosed || overlay.isConnected === false || myRequestId !== requestId) return;
    listBody.setAttribute("aria-busy", "false");

    // 리더보드 목록 렌더링
    if (!leaderboard || leaderboard.length === 0) {
      const emptyMsg = leaderboard === null ? I18nManager.t("tier.load_error")
        : isKingScope ? I18nManager.t("tier.king_empty") : I18nManager.t("ranking.empty");
      listBody.innerHTML = `
        <div style="padding:40px 20px; text-align:center; color:#64748b; font-size:13px;">
          ${emptyMsg}
          ${leaderboard === null ? `<button type="button" id="ranking-retry" class="ranking-retry">${escapeHtml(I18nManager.t("tier.retry"))}</button>` : ""}
        </div>
      `;
      listBody.querySelector("#ranking-retry")?.addEventListener("click", () => { void updateContent(); });
    } else {
      listBody.innerHTML = "";
      leaderboard.forEach((item) => {
        const row = document.createElement("div");
        const isMe = userProfile && item.id === userProfile.id;
        row.className = "ranking-columns";
        row.style.cssText = `
          padding: 8px 16px;
          border-bottom: 1px solid #1e293b;
          font-size: 12px;
          background: ${isMe ? "rgba(37, 99, 235, 0.15)" : "transparent"};
        `;

        let rankBadge = `${item.rank}`;
        if (item.rank === 1) rankBadge = "🥇";
        else if (item.rank === 2) rankBadge = "🥈";
        else if (item.rank === 3) rankBadge = "🥉";

        const badgeHtml = renderTierBadge(item.mmr, false);

        row.innerHTML = `
          <span style="font-weight:800; text-align:center; color:${item.rank <= 3 ? "#f59e0b" : "#94a3b8"};">${rankBadge}</span>
          <span style="min-width:0;">
            <span style="display:block;font-weight:${isMe ? "800" : "600"}; color:${isMe ? "#38bdf8" : "#f8fafc"}; overflow-wrap:anywhere;" title="${escapeHtml(item.nickname)}">${escapeHtml(item.nickname)}${isMe ? ` (${escapeHtml(I18nManager.t("tier.you"))})` : ""}</span>
            <span class="ranking-record">${escapeHtml(I18nManager.t("lobby.win_draw_loss", { wins: item.wins, draws: item.draws ?? 0, losses: item.losses }))}</span>
          </span>
          <span style="display:inline-flex; align-items:center; justify-content:flex-end; text-align:right;">
            ${badgeHtml}
          </span>
        `;
        listBody.appendChild(row);
      });
    }

    // Keep one relevant next step: King eligibility OR confirmed standing.
    if (!userProfile) {
      myBar.textContent = I18nManager.t("tier.sign_in");
      return;
    }
    const rating = myRankInfo?.mmr ?? (targetMode === "strategy"
      ? userProfile.strategyMmr ?? userProfile.mmr : userProfile.classicMmr ?? userProfile.mmr);
    const guest = userProfile.id === "local_guest";
    const detail = guest ? I18nManager.t("tier.sign_in")
      : !myRankInfo ? I18nManager.t("tier.rank_unavailable")
      : isKingScope && rating < KING_MMR ? I18nManager.t("tier.to_king", { points: KING_MMR - rating })
      : I18nManager.t("ranking.my_rank") + " #" + myRankInfo.rank;
    myBar.innerHTML = `
      <div class="ranking-own-tier"><span>${escapeHtml(I18nManager.t("tier.your_tier"))}</span>${renderTierBadge(rating)}</div>
      <div class="ranking-own-detail">${escapeHtml(detail)}</div>
    `;
  };

  // 이벤트 리스너 바인딩
  card.querySelector("#ranking-close-btn")?.addEventListener("click", closeModal);

  tabClassicBtn?.addEventListener("click", () => {
    if (currentMode !== "classic") {
      currentMode = "classic";
      void updateContent();
    }
  });

  tabStrategyBtn?.addEventListener("click", () => {
    if (currentMode !== "strategy") {
      currentMode = "strategy";
      void updateContent();
    }
  });

  scopeAllBtn?.addEventListener("click", () => {
    if (currentScope !== "all") {
      currentScope = "all";
      void updateContent();
    }
  });

  scopeKingBtn?.addEventListener("click", () => {
    if (currentScope !== "king") {
      currentScope = "king";
      void updateContent();
    }
  });

  overlay.addEventListener("click", (e) => {
    if (e?.target === overlay) closeModal();
  });

  overlay.appendChild(card);
  parentContainer.appendChild(overlay);
  overlay.setAttribute("aria-label", I18nManager.t("ranking.title"));
  unbindModal = bindWorkbenchModal(overlay, closeModal);

  await updateContent();
}
