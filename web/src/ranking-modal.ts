import { I18nManager } from "./i18n";
import { SocialService } from "./social-service";
import type { UserProfile } from "./supabase-auth";

/**
 * 랭킹 순위표 모달 렌더러
 */
export async function openRankingModal(
  parentContainer: HTMLElement,
  userProfile: UserProfile | null,
): Promise<void> {
  const existing = document.querySelector(".ranking-modal-overlay");
  if (existing) existing.remove();

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
    padding: 16px;
    box-sizing: border-box;
  `;

  const card = document.createElement("div");
  card.className = "ranking-modal-card";
  card.style.cssText = `
    width: min(460px, 100%);
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

  const renderContent = async () => {
    card.innerHTML = `
      <!-- 헤더 -->
      <div style="display:flex; justify-content:space-between; align-items:center; padding:16px 20px; border-bottom:1px solid #1e293b;">
        <h2 style="margin:0; font-size:18px; font-weight:800; display:flex; align-items:center; gap:8px;">
          <span>🏆</span> ${I18nManager.t("ranking.title")}
        </h2>
        <button id="ranking-close-btn" style="background:transparent; border:none; color:#94a3b8; font-size:20px; cursor:pointer; padding:4px 8px; line-height:1;">✕</button>
      </div>

      <!-- 모드 탭 (클래식 / 전략) -->
      <div style="display:flex; gap:6px; padding:12px 20px; background:#1e293b; border-bottom:1px solid #334155;">
        <button id="tab-classic" style="flex:1; border:none; border-radius:6px; padding:8px; font-size:13px; font-weight:700; cursor:pointer; background:${currentMode === "classic" ? "#2563eb" : "transparent"}; color:${currentMode === "classic" ? "white" : "#94a3b8"}; white-space:nowrap; word-break:keep-all;">
          ${I18nManager.t("ranking.tab_classic")}
        </button>
        <button id="tab-strategy" style="flex:1; border:none; border-radius:6px; padding:8px; font-size:13px; font-weight:700; cursor:pointer; background:${currentMode === "strategy" ? "#7c3aed" : "transparent"}; color:${currentMode === "strategy" ? "white" : "#94a3b8"}; white-space:nowrap; word-break:keep-all;">
          ${I18nManager.t("ranking.tab_strategy")}
        </button>
      </div>

      <!-- 리더보드 컬럼 헤더 -->
      <div style="display:grid; grid-template-columns: 50px 1fr 80px 90px; padding:8px 20px; background:#0f172a; border-bottom:1px solid #1e293b; font-size:11px; font-weight:700; color:#64748b;">
        <span>${I18nManager.t("ranking.col_rank")}</span>
        <span>${I18nManager.t("ranking.col_player")}</span>
        <span style="text-align:right;">${I18nManager.t("ranking.col_mmr")}</span>
        <span style="text-align:right;">${I18nManager.t("ranking.col_record")}</span>
      </div>

      <!-- 랭킹 리스트 컨테이너 -->
      <div id="ranking-list-body" style="flex:1; overflow-y:auto; padding:8px 0; min-height:220px; max-height:360px;">
        <div style="padding:30px; text-align:center; color:#64748b; font-size:13px;">불러오는 중...</div>
      </div>

      <!-- 내 실시간 순위 하단 바 -->
      <div id="ranking-my-bar" style="padding:12px 20px; background:#1e293b; border-top:1px solid #334155; display:flex; justify-content:space-between; align-items:center; font-size:13px;">
      </div>
    `;

    card.querySelector("#ranking-close-btn")?.addEventListener("click", () => overlay.remove());

    card.querySelector("#tab-classic")?.addEventListener("click", () => {
      if (currentMode !== "classic") {
        currentMode = "classic";
        void renderContent();
      }
    });

    card.querySelector("#tab-strategy")?.addEventListener("click", () => {
      if (currentMode !== "strategy") {
        currentMode = "strategy";
        void renderContent();
      }
    });

    // 랭킹 데이터 로드
    const listBody = card.querySelector("#ranking-list-body") as HTMLElement;
    const myBar = card.querySelector("#ranking-my-bar") as HTMLElement;

    const [leaderboard, myRankInfo] = await Promise.all([
      SocialService.getLeaderboard(currentMode, 50),
      userProfile ? SocialService.getMyRank(userProfile.id, currentMode) : Promise.resolve(null),
    ]);

    if (!leaderboard || leaderboard.length === 0) {
      listBody.innerHTML = `
        <div style="padding:40px 20px; text-align:center; color:#64748b; font-size:13px;">
          ${I18nManager.t("ranking.empty")}
        </div>
      `;
    } else {
      listBody.innerHTML = "";
      leaderboard.forEach((item) => {
        const row = document.createElement("div");
        const isMe = userProfile && item.id === userProfile.id;
        row.style.cssText = `
          display: grid;
          grid-template-columns: 50px 1fr 80px 90px;
          align-items: center;
          padding: 10px 20px;
          border-bottom: 1px solid #1e293b;
          font-size: 13px;
          background: ${isMe ? "rgba(37, 99, 235, 0.15)" : "transparent"};
        `;

        let rankBadge = `${item.rank}`;
        if (item.rank === 1) rankBadge = "🥇";
        else if (item.rank === 2) rankBadge = "🥈";
        else if (item.rank === 3) rankBadge = "🥉";

        row.innerHTML = `
          <span style="font-weight:800; color:${item.rank <= 3 ? "#f59e0b" : "#94a3b8"};">${rankBadge}</span>
          <span style="font-weight:${isMe ? "800" : "600"}; color:${isMe ? "#38bdf8" : "#f8fafc"}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            ${item.nickname} ${isMe ? " (나)" : ""}
          </span>
          <span style="text-align:right; font-weight:700; color:#fbbf24;">${item.mmr}</span>
          <span style="text-align:right; font-size:12px; color:#94a3b8;">${item.wins}승 ${item.losses}패</span>
        `;
        listBody.appendChild(row);
      });
    }

    // 내 순위 바 렌더링
    if (userProfile && userProfile.id !== "local_guest") {
      const currentMmr = currentMode === "strategy" 
        ? (userProfile.strategyMmr ?? userProfile.mmr ?? 1200) 
        : (userProfile.classicMmr ?? userProfile.mmr ?? 1200);

      const rankText = myRankInfo && myRankInfo.rank > 0 
        ? `#${myRankInfo.rank}` 
        : I18nManager.t("ranking.unranked");

      const percentileText = myRankInfo && myRankInfo.totalPlayers > 0 && myRankInfo.rank > 0
        ? `<span style="color:#64748b; font-size:12px;">(상위 ${Math.max(1, Math.round((myRankInfo.rank / myRankInfo.totalPlayers) * 100))}%)</span>`
        : "";

      myBar.innerHTML = `
        <div style="display:flex; align-items:center; gap:8px; overflow:hidden;">
          <span style="color:#94a3b8; white-space:nowrap;">${I18nManager.t("ranking.my_rank")}:</span>
          <strong style="color:#38bdf8; font-size:15px; white-space:nowrap;">${rankText}</strong>
          ${percentileText}
          <span style="color:#cbd5e1; font-size:12px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">[${userProfile.nickname}]</span>
        </div>
        <div style="font-weight:700; color:#fbbf24; white-space:nowrap; margin-left:8px;">
          MMR: ${myRankInfo?.mmr ?? currentMmr}
        </div>
      `;
    } else if (userProfile && userProfile.id === "local_guest") {
      const currentMmr = currentMode === "strategy" 
        ? (userProfile.strategyMmr ?? userProfile.mmr ?? 1200) 
        : (userProfile.classicMmr ?? userProfile.mmr ?? 1200);
      myBar.innerHTML = `
        <div style="display:flex; align-items:center; gap:6px; overflow:hidden;">
          <span style="color:#f59e0b; font-weight:700; font-size:12px; white-space:nowrap;">[게스트]</span>
          <span style="color:#94a3b8; font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${userProfile.nickname} (랭킹 등록을 위해 회원가입 필요)</span>
        </div>
        <div style="font-weight:700; color:#fbbf24; white-space:nowrap; margin-left:8px;">
          MMR: ${currentMmr}
        </div>
      `;
    } else {
      myBar.innerHTML = `
        <div style="color:#64748b; font-size:12px;">게스트 또는 비로그인 상태입니다.</div>
      `;
    }
  };

  await renderContent();
  overlay.appendChild(card);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });

  parentContainer.appendChild(overlay);
}
