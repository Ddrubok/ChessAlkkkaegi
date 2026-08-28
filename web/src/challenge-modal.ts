import { I18nManager } from "./i18n";
import { SocialService, type ChallengeRequestPayload } from "./social-service";

export interface ChallengeModalCallbacks {
  onAccept: (payload: ChallengeRequestPayload) => void;
  onReject: (payload: ChallengeRequestPayload) => void;
}

/**
 * 1:1 대전 신청 수신 팝업 모달
 */
export function openChallengeReceivedModal(
  payload: ChallengeRequestPayload,
  callbacks: ChallengeModalCallbacks,
): void {
  const existing = document.querySelector(".challenge-received-overlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.className = "challenge-received-overlay";
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 120;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.8);
    padding: 16px;
    box-sizing: border-box;
    font-family: inherit;
  `;

  const card = document.createElement("div");
  card.style.cssText = `
    width: min(380px, 100%);
    background: #0f172a;
    border: 2px solid #3b82f6;
    border-radius: 14px;
    padding: 24px;
    text-align: center;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
    color: #f8fafc;
  `;

  let timeLeft = 15;
  let timerId: number | null = null;

  const modeName = payload.mode === "strategy" ? I18nManager.t("online.strategy_tab") : I18nManager.t("online.classic_tab");

  card.innerHTML = `
    <div style="font-size:36px; margin-bottom:8px;">⚔️</div>
    <h2 style="margin:0 0 6px; font-size:18px; font-weight:800;">
      ${I18nManager.t("friends.challenge_received_title")}
    </h2>
    <p style="color:#94a3b8; font-size:14px; margin:0 0 16px;">
      <strong style="color:#38bdf8; font-size:15px;">${payload.challengerNickname}</strong> (MMR ${payload.challengerMmr})님이<br>
      <span style="color:#fbbf24; font-weight:700;">[${modeName}]</span> 대전을 신청했습니다!
    </p>

    <div id="challenge-timer" style="font-size:13px; font-weight:700; color:#f59e0b; margin-bottom:20px;">
      남은 시간: 15초
    </div>

    <div style="display:flex; gap:10px;">
      <button id="challenge-accept-btn" style="flex:1; background:#16a34a; color:white; border:none; border-radius:8px; padding:12px; font-size:14px; font-weight:800; cursor:pointer;">
        ${I18nManager.t("friends.accept_btn")}
      </button>
      <button id="challenge-reject-btn" style="flex:1; background:#dc2626; color:white; border:none; border-radius:8px; padding:12px; font-size:14px; font-weight:800; cursor:pointer;">
        ${I18nManager.t("friends.reject_btn")}
      </button>
    </div>
  `;

  const timerDisplay = card.querySelector("#challenge-timer") as HTMLElement;

  const close = () => {
    if (timerId !== null) clearInterval(timerId);
    overlay.remove();
  };

  timerId = window.setInterval(() => {
    timeLeft -= 1;
    if (timeLeft <= 0) {
      close();
      void SocialService.respondChallenge(payload.challengerId, payload.roomId, false);
      callbacks.onReject(payload);
    } else {
      timerDisplay.textContent = `남은 시간: ${timeLeft}초`;
    }
  }, 1000);

  card.querySelector("#challenge-accept-btn")?.addEventListener("click", async () => {
    close();
    await SocialService.respondChallenge(payload.challengerId, payload.roomId, true);
    callbacks.onAccept(payload);
  });

  card.querySelector("#challenge-reject-btn")?.addEventListener("click", async () => {
    close();
    await SocialService.respondChallenge(payload.challengerId, payload.roomId, false);
    callbacks.onReject(payload);
  });

  overlay.appendChild(card);
  document.body.appendChild(overlay);
}
