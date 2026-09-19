import { uiText } from "./ui-text";
import { I18nManager } from "./i18n";
import { SocialService, type ChallengeRequestPayload } from "./social-service";
import { escapeHtml } from "./html";
import { renderTierBadge } from "./tier-view";

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
    <p style="color:#94a3b8; font-size:14px; margin:0 0 16px; line-height:1.5;">
      <span style="display:inline-flex; align-items:center; gap:6px; flex-wrap:wrap; justify-content:center;">
        <strong style="color:#38bdf8; font-size:15px;">${escapeHtml(I18nManager.t("friends.challenge_received_desc", {name: payload.challengerNickname}))}</strong>
        ${renderTierBadge(payload.challengerMmr, false)}
      </span><br>
      <span style="color:#fbbf24; font-weight:700;">[${escapeHtml(modeName)}]</span>
    </p>

    <div id="challenge-timer" style="font-size:13px; font-weight:700; color:#f59e0b; margin-bottom:20px;">
      ${uiText("remaining", {time:15})}
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
      void SocialService.respondChallenge(payload.challengerId, payload.roomId, false).catch(console.warn);
      callbacks.onReject(payload);
    } else {
      timerDisplay.textContent = uiText("remaining", {time:timeLeft});
    }
  }, 1000);

  card.querySelector("#challenge-accept-btn")?.addEventListener("click", async () => {
    if (timerId !== null) clearInterval(timerId);
    card.querySelectorAll('button').forEach(button => { button.disabled = true; });
    try {
      await SocialService.respondChallenge(payload.challengerId, payload.roomId, true);
      close();
      callbacks.onAccept(payload);
    } catch {
      timerDisplay.textContent = I18nManager.t('lobby.match_start_failed');
      const dismiss = card.querySelector<HTMLButtonElement>('#challenge-reject-btn');
      if (dismiss) { dismiss.disabled = false; dismiss.textContent = I18nManager.t('common.close'); }
    }
  });

  card.querySelector("#challenge-reject-btn")?.addEventListener("click", async () => {
    close();
    await SocialService.respondChallenge(payload.challengerId, payload.roomId, false).catch(console.warn);
    callbacks.onReject(payload);
  });

  overlay.appendChild(card);
  document.body.appendChild(overlay);
}
