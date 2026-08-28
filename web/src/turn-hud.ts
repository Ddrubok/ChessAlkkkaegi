import type { PieceSide } from "./layout";
import type { TurnRuntime } from "./turn";
import { tutorialManager } from "./tutorial";

export interface TurnHudRuntime {
  element: HTMLElement;
  update: (now: number, frameDelta: number) => void;
  destroy: () => void;
}

export interface TurnHudOptions {
  getGameMode: () => string;
  getMySide: () => PieceSide | null;
  isMenuVisible?: () => boolean;
  onTimeoutLaunch?: () => void;
}

const TURN_TIME_LIMIT_SECONDS = 20.0;

/**
 * 게임 상단에 표시되는 턴 인디케이터, 20초 카운트다운 타이머, 정착 가속 배지 HUD
 */
export function createTurnHud(
  parent: HTMLElement,
  turnRuntime: TurnRuntime,
  options: TurnHudOptions,
): TurnHudRuntime {
  const container = document.createElement("div");
  container.className = "turn-hud-container";

  const mainBadge = document.createElement("div");
  mainBadge.className = "turn-hud-badge";
  mainBadge.style.cssText = `
    background: #0f172a;
    border: 1px solid #334155;
    border-radius: 10px;
    padding: 6px 14px;
    display: flex;
    align-items: center;
    gap: 10px;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.4);
  `;

  const sideIndicator = document.createElement("div");
  sideIndicator.style.cssText = `
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: -0.02em;
  `;

  const timerWrapper = document.createElement("div");
  timerWrapper.style.cssText = `
    display: flex;
    align-items: center;
    gap: 6px;
  `;

  const timerText = document.createElement("span");
  timerText.style.cssText = `
    font-size: 15px;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    min-width: 38px;
    text-align: right;
  `;

  const progressBarTrack = document.createElement("div");
  progressBarTrack.style.cssText = `
    width: 50px;
    height: 5px;
    background: rgba(51, 65, 85, 0.8);
    border-radius: 3px;
    overflow: hidden;
  `;

  const progressBarFill = document.createElement("div");
  progressBarFill.style.cssText = `
    width: 100%;
    height: 100%;
    background: #22c55e;
    transition: width 0.1s linear, background-color 0.3s;
    border-radius: 3px;
  `;
  progressBarTrack.appendChild(progressBarFill);

  timerWrapper.appendChild(timerText);
  timerWrapper.appendChild(progressBarTrack);

  mainBadge.appendChild(sideIndicator);
  mainBadge.appendChild(timerWrapper);
  container.appendChild(mainBadge);

  // 정착 5초 초과 시 등장하는 가속 인디케이터 배지
  const accelBadge = document.createElement("div");
  accelBadge.style.cssText = `
    background: #c2410c;
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    padding: 3px 10px;
    border-radius: 6px;
    display: none;
    align-items: center;
    gap: 4px;
  `;
  accelBadge.innerHTML = `<span id="accel-text">물리 가속 (1.0x)</span>`;
  container.appendChild(accelBadge);

  parent.appendChild(container);

  let remainingSeconds = TURN_TIME_LIMIT_SECONDS;
  let lastSide: PieceSide | null = null;
  let timeoutTriggered = false;

  const update = (_now: number, frameDelta: number): void => {
    // 경기 종료 또는 메인 메뉴가 열려있는 경우 숨김
    if (turnRuntime.phase === "match-over" || (options.isMenuVisible && options.isMenuVisible())) {
      container.style.display = "none";
      return;
    }
    container.style.display = "flex";

    const gameMode = options.getGameMode();
    const mySide = options.getMySide();
    const currentSide = turnRuntime.currentSide;

    // 턴이 바뀌거나 새 턴 준비 단계로 오면 타이머 리셋
    if (lastSide !== currentSide) {
      lastSide = currentSide;
      remainingSeconds = TURN_TIME_LIMIT_SECONDS;
      timeoutTriggered = false;
    }

    // 턴 인디케이터 텍스트 및 스타일 갱신
    const isOnline = gameMode === "online";
    const isTutorial = gameMode === "tutorial";
    const isMyTurn = isOnline ? mySide === currentSide : true;

    if (isTutorial) {
      if (tutorialManager.currentStep < 5) {
        timerWrapper.style.display = "none";
        sideIndicator.innerHTML = `<span style="color:#38bdf8;">연습 모드</span> <span style="color:#94a3b8; font-size:12px;">(시간 무제한)</span>`;
        mainBadge.style.borderColor = "rgba(56, 189, 248, 0.3)";
      } else {
        timerWrapper.style.display = "flex";
        sideIndicator.innerHTML = `<span style="color:#22c55e;">실전 연습</span> <span style="color:#94a3b8; font-size:12px;">(20초 제한)</span>`;
        mainBadge.style.borderColor = "rgba(34, 197, 94, 0.4)";
      }
    } else if (isOnline) {
      timerWrapper.style.display = "flex";
      if (isMyTurn) {
        sideIndicator.innerHTML = `<span style="color:#22c55e;">내 턴</span> <span style="color:#94a3b8; font-size:12px;">(${currentSide === "white" ? "백" : "흑"})</span>`;
        mainBadge.style.borderColor = "rgba(34, 197, 94, 0.4)";
      } else {
        sideIndicator.innerHTML = `<span style="color:#38bdf8;">상대 턴</span> <span style="color:#94a3b8; font-size:12px;">(${currentSide === "white" ? "백" : "흑"})</span>`;
        mainBadge.style.borderColor = "rgba(56, 189, 248, 0.3)";
      }
    } else {
      timerWrapper.style.display = "flex";
      const sideName = currentSide === "white" ? "백(선공)" : "흑(후공)";
      sideIndicator.innerHTML = `<span style="color:${currentSide === "white" ? "#f8fafc" : "#94a3b8"};">${sideName}</span>`;
      mainBadge.style.borderColor = currentSide === "white" ? "rgba(248, 250, 252, 0.3)" : "rgba(148, 163, 184, 0.3)";
    }

    // 타이머 카운트다운 (ready 상태에서만 진행, 튜토리얼 1~4단계에서는 멈춤)
    if (turnRuntime.phase === "ready" && (!isTutorial || tutorialManager.currentStep === 5)) {
      remainingSeconds = Math.max(0, remainingSeconds - frameDelta);

      // 타임아웃 발생 처리
      if (remainingSeconds <= 0 && !timeoutTriggered) {
        timeoutTriggered = true;
        if (isMyTurn && options.onTimeoutLaunch) {
          options.onTimeoutLaunch();
        }
      }
    } else if (turnRuntime.phase === "settling") {
      // 발사 후 정착 중일 때는 직전 잔여시간 유지
    }

    // 타이머 텍스트 및 프로그레스 바 색상
    const displaySeconds = Math.ceil(remainingSeconds);
    timerText.textContent = `${displaySeconds}s`;

    const progressRatio = Math.max(0, Math.min(1, remainingSeconds / TURN_TIME_LIMIT_SECONDS));
    progressBarFill.style.width = `${(progressRatio * 100).toFixed(1)}%`;

    if (remainingSeconds <= 5.0) {
      timerText.style.color = "#ef4444";
      progressBarFill.style.backgroundColor = "#ef4444";
      timerText.style.animation = "pulse 0.8s infinite";
    } else if (remainingSeconds <= 10.0) {
      timerText.style.color = "#eab308";
      progressBarFill.style.backgroundColor = "#eab308";
      timerText.style.animation = "none";
    } else {
      timerText.style.color = "#22c55e";
      progressBarFill.style.backgroundColor = "#22c55e";
      timerText.style.animation = "none";
    }

    // 발사 후 5초 초과 정착 가속 인디케이터 배지
    if (turnRuntime.phase === "settling" && turnRuntime.settleSeconds > 5.0) {
      const accel = Math.min(4.5, 1.0 + (turnRuntime.settleSeconds - 5.0) * 0.7);
      accelBadge.style.display = "flex";
      const accelTextEl = accelBadge.querySelector("#accel-text");
      if (accelTextEl) {
        accelTextEl.textContent = `물리 가속 중 (${accel.toFixed(1)}x)`;
      }
    } else {
      accelBadge.style.display = "none";
    }
  };

  const destroy = (): void => {
    container.remove();
  };

  return {
    element: container,
    update,
    destroy,
  };
}
