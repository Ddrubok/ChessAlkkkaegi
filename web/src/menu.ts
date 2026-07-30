import {
  PERMANENT_PLAYER_SIZE_COST,
  PERMANENT_PLAYER_SIZE_STEP,
  PERMANENT_UPGRADE_STEP,
  PERMANENT_UPGRADE_TIER_MAX_LEVEL,
  type PieceType,
} from "./config";
import type { GameMode } from "./game-mode";
import {
  computePermanentUpgradeSpentPoints,
  computePermanentUpgradeCost,
  getPermanentTierUpgradeLevel,
  isPermanentSizeUpgradeUnlocked,
  isPermanentUpgradeUnlocked,
  purchasePermanentUpgrade,
  purchasePermanentSizeUpgrade,
  resetPermanentUpgrades,
  type MetaRuntime,
  type PermanentUpgradeTier,
  type PermanentUpgradeTrack,
} from "./meta";
import {
  ensureOrientationOverlay,
  releaseAfterMatch,
  requestLandscapeForMatch,
  setMatchOrientationActive,
} from "./orientation";

export interface MainMenuRuntime {
  // 게임 화면 위를 덮고 모드 선택과 영구 강화 표를 보여 주는 메인 메뉴다.
  overlay: HTMLElement;
  // 메뉴가 숨겨져도 우상단에서 포기 확인을 여는 인게임 버튼이다.
  returnButton: HTMLButtonElement;
  // 브라우저 기본 확인창 대신 기존 결과 화면 스타일로 포기 여부를 묻는 오버레이다.
  confirmOverlay: HTMLElement;
  // 포인트와 강화 레벨의 메모리·저장 원본이다.
  metaRuntime: MetaRuntime;
  // 게임 월드 준비 전 모드 버튼만 비활성화하는 상태다.
  ready: boolean;
  // 모드 시작·메뉴 복귀 중 중복 입력을 막는 상태다.
  busy: boolean;
  // 현재 메인 메뉴가 게임 입력을 가리고 있는지 나타낸다.
  visible: boolean;
  // 현재 포기 확인 화면이 게임 입력을 가리고 있는지 나타낸다.
  confirming: boolean;
  // 선택한 모드로 보드를 준비하고 최초 게임 루프를 시작하는 연결점이다.
  onStartMode: (mode: GameMode) => Promise<void>;
  // 런 상태를 지우고 안전한 보드로 되돌리는 연결점이다.
  onReturnToMenu: () => Promise<void>;
  // 포기 확인 뒤 현재 모드에 맞는 런 종료 또는 즉시 메뉴 복귀를 수행하는 연결점이다.
  onConfirmAbandon: () => Promise<void>;
}

const PIECE_LABELS: Readonly<Record<PieceType, string>> = {
  Pawn: "폰",
  Rook: "룩",
  Knight: "나이트",
  Bishop: "비숍",
  Queen: "퀸",
  King: "킹",
};

const TRACK_LABELS: Readonly<
  Record<PermanentUpgradeTrack, string>
> = {
  force: "힘",
  weight: "중량",
};

const TIER_LABELS: Readonly<
  Record<PermanentUpgradeTier, string>
> = {
  basic: "기초",
  advanced: "심화",
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
    <strong>${TIER_LABELS[tier]} · ${PIECE_LABELS[type]} · ${TRACK_LABELS[track]}</strong>
    <span>${level}/3</span>
    <span>+${(level * PERMANENT_UPGRADE_STEP * 100).toFixed(0)}%</span>
    <span>${unlocked ? (cost === null ? "최대" : `${cost} P`) : "잠김"}</span>
  `;
  const purchaseButton = document.createElement("button");
  purchaseButton.type = "button";
  purchaseButton.textContent = atMaximum ? "최대" : "구매";
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
        ? `${TIER_LABELS[tier]} ${PIECE_LABELS[type]} ${TRACK_LABELS[track]} 강화를 구매했습니다.`
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
    <strong>중앙 · 전체 말 크기</strong>
    <span>${level}/1</span>
    <span>백 전체 +${(PERMANENT_PLAYER_SIZE_STEP * 100).toFixed(0)}%</span>
    <span>${unlocked ? (level === 1 ? "구매 완료" : `${PERMANENT_PLAYER_SIZE_COST} P`) : "기초 전체 완료 필요"}</span>
  `;
  const purchaseButton = document.createElement("button");
  purchaseButton.type = "button";
  purchaseButton.textContent = level === 1 ? "구매 완료" : "구매";
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
        ? "플레이어 전체 말 크기 +3% 강화를 구매했습니다."
        : (result.reason ?? "");
  });
  row.append(purchaseButton);
  rows.append(row);
}

/**
 * 메인 메뉴의 포인트·25개 구매 노드·선행 잠금·초기화 상태를 다시 그린다.
 */
export function renderMainMenu(runtime: MainMenuRuntime): void {
  const points =
    runtime.overlay.querySelector<HTMLElement>("[data-menu-points]");
  const rows =
    runtime.overlay.querySelector<HTMLElement>("[data-upgrade-rows]");
  const status =
    runtime.overlay.querySelector<HTMLElement>("[data-menu-status]");
  const resetButton =
    runtime.overlay.querySelector<HTMLButtonElement>(
      "[data-upgrade-reset]",
    );
  if (
    points === null ||
    rows === null ||
    status === null ||
    resetButton === null
  ) {
    throw new Error("메인 메뉴의 갱신 대상 요소를 찾지 못했습니다.");
  }
  points.textContent = `${runtime.metaRuntime.state.points} P`;
  if (!runtime.ready) {
    status.textContent = "게임 월드를 준비하는 중입니다…";
  } else if (
    status.textContent === "게임 월드를 준비하는 중입니다…"
  ) {
    status.textContent = "";
  }
  rows.replaceChildren();

  for (const tier of ["basic", "advanced"] as const) {
    const heading = document.createElement("h3");
    heading.className = "permanent-upgrade-tier-title";
    heading.textContent =
      tier === "basic"
        ? "기초 강화 · 폰·나이트→킹 / 룩·비숍→퀸"
        : "심화 강화 · 폰·나이트→킹 / 룩·비숍→퀸";
    if (tier === "advanced") {
      appendSizeUpgradeRow(runtime, rows, status);
    }
    rows.append(heading);
    for (const type of TREE_PIECE_ORDER) {
      for (const track of ["force", "weight"] as const) {
        appendUpgradeRow(
          runtime,
          rows,
          status,
          tier,
          type,
          track,
        );
      }
    }
  }
  resetButton.disabled =
    runtime.busy ||
    computePermanentUpgradeSpentPoints(
      runtime.metaRuntime.state.upgrades,
    ) === 0;

  for (const button of runtime.overlay.querySelectorAll<HTMLButtonElement>(
    "[data-game-mode]",
  )) {
    button.disabled = !runtime.ready || runtime.busy;
  }
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
  setMatchOrientationActive(false);
  runtime.visible = true;
  runtime.confirming = false;
  runtime.overlay.hidden = false;
  runtime.confirmOverlay.hidden = true;
  runtime.returnButton.hidden = true;
  renderMainMenu(runtime);
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
  setMatchOrientationActive(true);
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
  if (runtime.busy) {
    return;
  }
  runtime.busy = true;
  try {
    await runtime.onReturnToMenu();
    await releaseAfterMatch();
    showMainMenu(runtime);
  } finally {
    runtime.busy = false;
    renderMainMenu(runtime);
    if (runtime.visible) {
      runtime.overlay
        .querySelector<HTMLButtonElement>("[data-game-mode]")
        ?.focus();
    }
  }
}

/**
 * 메인 메뉴·인게임 메뉴 버튼·비차단 포기 확인 화면을 함께 만든다.
 */
export function createMainMenu(
  container: HTMLElement,
  metaRuntime: MetaRuntime,
  onStartMode: (mode: GameMode) => Promise<void>,
  onReturnToMenu: () => Promise<void>,
  onConfirmAbandon: () => Promise<void>,
): MainMenuRuntime {
  const overlay = document.createElement("section");
  overlay.className = "main-menu-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "main-menu-title");
  overlay.innerHTML = `
    <div class="main-menu-panel">
      <p class="main-menu-kicker">물리 체스 알까기</p>
      <h1 id="main-menu-title">체스알까기</h1>
      <div class="main-menu-points">보유 포인트 <strong data-menu-points></strong></div>
      <div class="main-menu-modes" role="group" aria-label="대전 모드">
        <button type="button" data-game-mode="hotseat">2인 대전</button>
        <button type="button" data-game-mode="stage">스테이지 대전</button>
        <button type="button" data-game-mode="online">온라인 대전</button>
      </div>
      <p class="main-menu-status" data-menu-status aria-live="polite"></p>
      <section class="permanent-upgrade-panel" aria-labelledby="upgrade-title">
        <h2 id="upgrade-title">영구 강화</h2>
        <div class="permanent-upgrade-heading" aria-hidden="true">
          <span>말 · 강화</span>
          <span>레벨</span>
          <span>효과</span>
          <span>비용</span>
          <span>구매</span>
        </div>
        <div data-upgrade-rows></div>
        <button type="button" class="permanent-upgrade-reset" data-upgrade-reset>
          전체 초기화 · 사용 포인트 100% 반환
        </button>
      </section>
    </div>
  `;

  const returnButton = document.createElement("button");
  returnButton.type = "button";
  returnButton.className = "return-menu-button";
  returnButton.textContent = "메뉴로";
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
    <div class="match-result-panel">
      <p>대국 포기</p>
      <h1 id="menu-confirm-title">진행 중인 대국을 포기하고 메뉴로 돌아갑니다</h1>
      <div class="match-result-actions">
        <button type="button" data-menu-cancel>계속하기</button>
        <button type="button" data-menu-confirm>메뉴로</button>
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

  const runtime: MainMenuRuntime = {
    overlay,
    returnButton,
    confirmOverlay,
    metaRuntime,
    ready: false,
    busy: false,
    visible: true,
    confirming: false,
    onStartMode,
    onReturnToMenu,
    onConfirmAbandon,
  };
  const resetButton =
    overlay.querySelector<HTMLButtonElement>(
      "[data-upgrade-reset]",
    );
  if (resetButton === null) {
    throw new Error("영구 강화 전체 초기화 버튼을 만들지 못했습니다.");
  }
  resetButton.addEventListener("click", () => {
    if (runtime.busy) {
      return;
    }
    const refunded = resetPermanentUpgrades(runtime.metaRuntime);
    renderMainMenu(runtime);
    const status =
      runtime.overlay.querySelector<HTMLElement>(
        "[data-menu-status]",
      );
    if (status !== null) {
      status.textContent =
        `영구 강화를 전체 초기화하고 ${refunded} P를 반환했습니다.`;
    }
  });

  for (const button of overlay.querySelectorAll<HTMLButtonElement>(
    "[data-game-mode]",
  )) {
    button.addEventListener("click", () => {
      const mode = button.dataset.gameMode;
      if (
        runtime.busy ||
        !runtime.ready ||
        (mode !== "hotseat" &&
          mode !== "stage" &&
          mode !== "online")
      ) {
        return;
      }
      // 전체화면 API는 모드 버튼의 실제 사용자 제스처가 살아 있을 때 먼저 호출한다.
      void requestLandscapeForMatch();
      runtime.busy = true;
      renderMainMenu(runtime);
      void runtime.onStartMode(mode).then(
        () => {
          hideMainMenuAfterModeStart(runtime);
        },
        (error: unknown) => {
          // 시작 실패로 메뉴에 남을 때 선행 전체화면 요청도 함께 되돌린다.
          void releaseAfterMatch();
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
      heading.textContent =
        "진행 중인 대국을 포기하고 메뉴로 돌아갑니다";
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
  ensureOrientationOverlay(container);
  renderMainMenu(runtime);
  return runtime;
}
