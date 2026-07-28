import type { PieceSide } from "./layout";
import type { GameMode } from "./game-mode";
import type { CardId, UpgradeCard } from "./cards";

export interface RemainingPieceCounts {
  // 판에 남아 있는 백 말 수다.
  white: number;
  // 판에 남아 있는 흑 말 수다.
  black: number;
}

export type MatchWinner = PieceSide;

export interface MatchRuntime {
  // 게임 입력 위에 놓여 결과 확인 전까지 포인터를 차단하는 전체 화면 요소다.
  overlay: HTMLElement;
  // 결과 종류를 제목 위의 작은 문구로 구분하는 요소다.
  resultKicker: HTMLParagraphElement;
  // 승리 진영을 한국어로 표시하는 제목 요소다.
  winnerHeading: HTMLHeadingElement;
  // 런 정산액 또는 완주 감사 문구를 제목과 버튼 사이에 표시하는 영역이다.
  resultDetails: HTMLElement;
  // 새 판 준비를 한 번만 요청하는 다시 시작 버튼이다.
  restartButton: HTMLButtonElement;
  // 스테이지 패배 뒤 영구 메타를 보존하고 메인 메뉴로 돌아가는 보조 버튼이다.
  menuButton: HTMLButtonElement;
  // 스테이지 승리 때 별도 진행 버튼 대신 표시할 강화 카드 버튼 영역이다.
  cardChoices: HTMLElement;
  // 현재 결과 화면에 표시된 승리 진영이며 진행 중이면 null이다.
  winner: MatchWinner | null;
  // 중복 재시작 요청을 막는 비동기 작업 상태다.
  restarting: boolean;
  // 현재 결과의 다시 시작 또는 다음 스테이지 인플레이스 재생성 작업이다.
  onRestart: () => Promise<void>;
  // 현재 승리 화면에서 선택한 카드 효과와 다음 스테이지 준비를 함께 수행한다.
  onCardSelected: ((cardId: CardId) => Promise<void>) | null;
  // 스테이지 패배 결과에서 런을 정리하고 메인 메뉴를 표시하는 연결점이다.
  onReturnToMenu: (() => Promise<void>) | null;
}

export interface StageRunResultCopy {
  // 일반 종료 화면에만 제목 위에 표시할 작은 문구다.
  kicker: string | null;
  // 패배·이탈 스테이지 또는 완주 축하를 표시하는 큰 제목이다.
  heading: string;
  // 획득 포인트 또는 완주 안내를 순서대로 표시하는 본문 문구다.
  detailLines: readonly string[];
  // 런 종료 뒤 선택 가능한 유일한 메인 메뉴 이동 버튼 문구다.
  buttonLabel: string;
}

/**
 * 정착과 낙하 제거가 끝난 뒤 남은 말 수와 발사 진영으로 승자를 결정한다.
 */
export function determineMatchWinner(
  remaining: RemainingPieceCounts,
  launchingSide: PieceSide,
): MatchWinner | null {
  if (remaining.white > 0 && remaining.black > 0) {
    return null;
  }
  if (remaining.white === 0 && remaining.black === 0) {
    return launchingSide;
  }
  return remaining.white === 0 ? "black" : "white";
}

/**
 * 결과 표시와 인플레이스 재시작 버튼을 가진 접근 가능한 오버레이를 만든다.
 */
export function createMatchRuntime(
  container: HTMLElement,
  onRestart: () => Promise<void>,
): MatchRuntime {
  const overlay = document.createElement("section");
  overlay.className = "match-result-overlay";
  overlay.hidden = true;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "match-result-title");
  overlay.innerHTML = `
    <div class="match-result-panel">
      <p data-match-result-kicker>대국 종료</p>
      <h1 id="match-result-title"></h1>
      <div class="match-result-details" data-match-result-details hidden></div>
      <div class="match-card-choices" hidden></div>
      <div class="match-result-actions">
        <button type="button" data-match-restart>다시 시작</button>
        <button type="button" data-match-menu hidden>메뉴로</button>
      </div>
    </div>
  `;
  const resultKicker =
    overlay.querySelector<HTMLParagraphElement>(
      "[data-match-result-kicker]",
    );
  const winnerHeading =
    overlay.querySelector<HTMLHeadingElement>("#match-result-title");
  const resultDetails =
    overlay.querySelector<HTMLElement>(
      "[data-match-result-details]",
    );
  const restartButton =
    overlay.querySelector<HTMLButtonElement>("[data-match-restart]");
  const menuButton =
    overlay.querySelector<HTMLButtonElement>("[data-match-menu]");
  const cardChoices =
    overlay.querySelector<HTMLElement>(".match-card-choices");
  if (
    resultKicker === null ||
    winnerHeading === null ||
    resultDetails === null ||
    restartButton === null ||
    menuButton === null ||
    cardChoices === null
  ) {
    throw new Error("대국 결과 화면의 필수 요소를 만들지 못했습니다.");
  }
  const runtime: MatchRuntime = {
    overlay,
    resultKicker,
    winnerHeading,
    resultDetails,
    restartButton,
    menuButton,
    cardChoices,
    winner: null,
    restarting: false,
    onRestart,
    onCardSelected: null,
    onReturnToMenu: null,
  };
  restartButton.addEventListener("click", () => {
    if (runtime.restarting) {
      return;
    }
    runtime.restarting = true;
    restartButton.disabled = true;
    restartButton.textContent = "준비 중…";
    void runtime.onRestart().then(
      () => {
        runtime.winner = null;
        runtime.restarting = false;
        restartButton.disabled = false;
        restartButton.textContent = "다시 시작";
        overlay.hidden = true;
      },
      (error: unknown) => {
        const fullError =
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error);
        console.error(fullError);
        runtime.restarting = false;
        restartButton.disabled = false;
        restartButton.textContent = "다시 시도";
        winnerHeading.textContent = "다시 시작 실패";
      },
    );
  });
  menuButton.addEventListener("click", () => {
    if (
      runtime.restarting ||
      runtime.onReturnToMenu === null
    ) {
      return;
    }
    runtime.restarting = true;
    restartButton.disabled = true;
    menuButton.disabled = true;
    menuButton.textContent = "이동 중…";
    void runtime.onReturnToMenu().then(
      () => {
        runtime.winner = null;
        runtime.restarting = false;
        restartButton.disabled = false;
        menuButton.disabled = false;
        menuButton.textContent = "메뉴로";
        overlay.hidden = true;
      },
      (error: unknown) => {
        const fullError =
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error);
        console.error(fullError);
        runtime.restarting = false;
        restartButton.disabled = false;
        menuButton.disabled = false;
        menuButton.textContent = "다시 시도";
        winnerHeading.textContent = "메뉴 이동 실패";
      },
    );
  });
  overlay.addEventListener("keydown", (event) => {
    if (event.code === "Escape") {
      event.preventDefault();
      const firstCard =
        cardChoices.querySelector<HTMLButtonElement>("button");
      (firstCard ?? restartButton).focus();
    } else if (event.code === "Tab") {
      const focusableButtons = [
        ...overlay.querySelectorAll<HTMLButtonElement>("button"),
      ].filter(
        (button) => !button.hidden && !button.disabled,
      );
      if (focusableButtons.length > 0) {
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
            : (currentIndex +
                direction +
                focusableButtons.length) %
              focusableButtons.length;
        focusableButtons[nextIndex].focus();
      }
    }
    event.stopPropagation();
  });
  container.append(overlay);
  return runtime;
}

/**
 * 승자를 표시하고 다시 시작 버튼으로 초점을 옮겨 게임 입력을 결과 화면에 가둔다.
 */
export function showMatchResult(
  runtime: MatchRuntime,
  winner: MatchWinner,
  gameMode: GameMode,
  stageNumber: number,
  onRestart: () => Promise<void>,
  upgradeCards: readonly UpgradeCard[] = [],
  onCardSelected: ((cardId: CardId) => Promise<void>) | null = null,
  onReturnToMenu: (() => Promise<void>) | null = null,
  localSide: PieceSide | null = null,
): void {
  runtime.winner = winner;
  runtime.onRestart = onRestart;
  runtime.onCardSelected = onCardSelected;
  runtime.onReturnToMenu = onReturnToMenu;
  runtime.resultKicker.hidden = false;
  runtime.resultKicker.textContent = "대국 종료";
  runtime.resultDetails.replaceChildren();
  runtime.resultDetails.hidden = true;
  runtime.winnerHeading.textContent =
    gameMode === "online"
      ? localSide === null
        ? "대국 종료"
        : winner === localSide
          ? "승리"
          : "패배"
      : gameMode === "stage"
      ? winner === "white"
        ? `승리! 스테이지 ${stageNumber} 클리어`
        : "패배"
      : winner === "white"
        ? "백 승리"
        : "흑 승리";
  const showsCards =
    gameMode === "stage" &&
    winner === "white" &&
    upgradeCards.length > 0 &&
    onCardSelected !== null;
  runtime.cardChoices.replaceChildren();
  runtime.cardChoices.hidden = !showsCards;
  runtime.restartButton.hidden =
    showsCards || gameMode === "online";
  runtime.restartButton.disabled = false;
  runtime.restartButton.textContent = "다시 시작";
  runtime.menuButton.hidden =
    showsCards ||
    (gameMode === "stage" && winner !== "black") ||
    (gameMode !== "stage" && gameMode !== "online") ||
    onReturnToMenu === null;
  runtime.menuButton.disabled = false;
  runtime.menuButton.textContent = "메뉴로";
  if (showsCards) {
    for (const card of upgradeCards) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "upgrade-card";
      button.innerHTML = `
        <strong>${card.name}</strong>
        <span>${card.description}</span>
      `;
      button.addEventListener("click", () => {
        if (runtime.restarting || runtime.onCardSelected === null) {
          return;
        }
        runtime.restarting = true;
        for (const cardButton of runtime.cardChoices.querySelectorAll(
          "button",
        )) {
          cardButton.disabled = true;
        }
        void runtime.onCardSelected(card.id).then(
          () => {
            runtime.winner = null;
            runtime.restarting = false;
            runtime.overlay.hidden = true;
          },
          (error: unknown) => {
            const fullError =
              error instanceof Error
                ? (error.stack ?? error.message)
                : String(error);
            console.error(fullError);
            runtime.restarting = false;
            for (const cardButton of runtime.cardChoices.querySelectorAll(
              "button",
            )) {
              cardButton.disabled = false;
            }
            runtime.winnerHeading.textContent = "강화 적용 실패";
          },
        );
      });
      runtime.cardChoices.append(button);
    }
  }
  runtime.overlay.hidden = false;
  const firstCard =
    runtime.cardChoices.querySelector<HTMLButtonElement>("button");
  (
    firstCard ??
    (runtime.restartButton.hidden
      ? runtime.menuButton
      : runtime.restartButton)
  ).focus();
}

/**
 * 기획 문구 그대로 패배·이탈 정산 화면 또는 10스테이지 완주 화면의 문구를 만든다.
 */
export function createStageRunResultCopy(
  stageNumber: number,
  payout: number,
  completed: boolean,
): StageRunResultCopy {
  if (!Number.isInteger(stageNumber) || stageNumber < 1) {
    throw new Error(
      `런 결과 스테이지 ${stageNumber}가 1 이상의 정수가 아닙니다.`,
    );
  }
  if (!Number.isInteger(payout) || payout < 0) {
    throw new Error(
      `런 결과 포인트 ${payout}가 0 이상의 정수가 아닙니다.`,
    );
  }
  return completed
    ? {
        kicker: null,
        heading: "축하합니다.",
        detailLines: [
          "데모 버전 스테이지를 전부 클리어하셨습니다.",
          "플레이해 주셔서 감사합니다.",
        ],
        buttonLabel: "메인으로 이동",
      }
    : {
        kicker: "대국 종료",
        heading: `스테이지 ${stageNumber} 종료`,
        detailLines: [`획득 포인트 : ${payout}점`],
        buttonLabel: "메인으로 이동",
      };
}

/**
 * 끝난 스테이지 런은 카드나 다시 시작 없이 정산 문구와 메인 이동 한 동작만 표시한다.
 */
export function showStageRunResult(
  runtime: MatchRuntime,
  stageNumber: number,
  payout: number,
  completed: boolean,
  onReturnToMenu: () => Promise<void>,
): void {
  const copy = createStageRunResultCopy(
    stageNumber,
    payout,
    completed,
  );
  runtime.winner = completed ? "white" : "black";
  runtime.restarting = false;
  runtime.onCardSelected = null;
  runtime.onReturnToMenu = onReturnToMenu;
  runtime.resultKicker.hidden = copy.kicker === null;
  runtime.resultKicker.textContent = copy.kicker ?? "";
  runtime.winnerHeading.textContent = copy.heading;
  runtime.resultDetails.replaceChildren(
    ...copy.detailLines.map((line) => {
      const paragraph = document.createElement("p");
      paragraph.textContent = line;
      return paragraph;
    }),
  );
  runtime.resultDetails.hidden = false;
  runtime.cardChoices.replaceChildren();
  runtime.cardChoices.hidden = true;
  runtime.restartButton.hidden = true;
  runtime.restartButton.disabled = false;
  runtime.menuButton.hidden = false;
  runtime.menuButton.disabled = false;
  runtime.menuButton.textContent = copy.buttonLabel;
  runtime.overlay.hidden = false;
  runtime.menuButton.focus();
}

/**
 * 심판 없는 연결 단절은 승패를 만들지 않고 메뉴로만 이동 가능한 종료 화면으로 표시한다.
 */
export function showDisconnectedMatchEnd(
  runtime: MatchRuntime,
  onReturnToMenu: () => Promise<void>,
): void {
  runtime.winner = null;
  runtime.restarting = false;
  runtime.onCardSelected = null;
  runtime.onReturnToMenu = onReturnToMenu;
  runtime.resultKicker.hidden = false;
  runtime.resultKicker.textContent = "대국 종료";
  runtime.winnerHeading.textContent =
    "상대와 연결이 끊겨 대국이 종료되었습니다";
  runtime.resultDetails.replaceChildren();
  runtime.resultDetails.hidden = true;
  runtime.cardChoices.replaceChildren();
  runtime.cardChoices.hidden = true;
  runtime.restartButton.hidden = true;
  runtime.restartButton.disabled = false;
  runtime.menuButton.hidden = false;
  runtime.menuButton.disabled = false;
  runtime.menuButton.textContent = "메뉴로";
  runtime.overlay.hidden = false;
  runtime.menuButton.focus();
}

/**
 * 메뉴 복귀 뒤 이전 결과 화면이 다음 대전 위에 다시 나타나지 않도록 상태와 DOM을 닫는다.
 */
export function hideMatchResult(runtime: MatchRuntime): void {
  runtime.overlay.hidden = true;
  runtime.winner = null;
  runtime.restarting = false;
  runtime.onCardSelected = null;
  runtime.onReturnToMenu = null;
  runtime.resultKicker.hidden = false;
  runtime.resultKicker.textContent = "대국 종료";
  runtime.resultDetails.replaceChildren();
  runtime.resultDetails.hidden = true;
  runtime.cardChoices.replaceChildren();
  runtime.cardChoices.hidden = true;
}
