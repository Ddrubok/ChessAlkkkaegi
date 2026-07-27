import "./style.css";
import {
  createAiRuntime,
  isAiTelegraphActive,
  resetAiMatch,
} from "./ai";
import { createAimRuntime } from "./aim";
import { createAimParametersRuntime } from "./aimparams";
import { loadChessAssets } from "./assets";
import {
  applyCardPick,
  cloneRunCardState,
  computePlayerLaunchSpeedMultiplier,
  createRunCardState,
  drawUpgradeCards,
  resetRunCardState,
  restoreRunCardState,
  type CardId,
} from "./cards";
import { deriveBoardHalfExtent } from "./config";
import {
  createGameModeRuntime,
  setStageNumber,
  switchGameMode,
  type GameMode,
  type GameModeRuntime,
} from "./game-mode";
import {
  cancelInputInteraction,
  createInputRuntime,
  handleInputPieceRemoved,
  lockInputForMatchOver,
  resetInputAfterMatch,
} from "./input";
import { PIECE_INSTANCES } from "./layout";
import { startGameLoop } from "./loop";
import {
  createMatchRuntime,
  hideMatchResult,
  showDisconnectedMatchEnd,
  showMatchResult,
} from "./match";
import {
  createMainMenu,
  hideMainMenuAfterModeStart,
  isMenuBlocking,
  renderMainMenu,
  returnToMainMenu,
  setMainMenuReady,
} from "./menu";
import {
  awardStageClearPoints,
  computePermanentForceBonus,
  createMetaRuntime,
} from "./meta";
import {
  createPhysicsRuntime,
  preSettlePhysics,
  resetPhysicsPieces,
} from "./physics";
import {
  createSceneRuntime,
  resetScenePieces,
  synchronizePieceMeshes,
} from "./scene";
import {
  createTuningRuntime,
  reapplyTuningPhysicsSettings,
} from "./tuning";
import type {
  ReplayDevelopmentRuntime,
  ReplayHeaderSource,
} from "./replay";
import type {
  OnlineRematchStatus,
  OnlineRuntime,
} from "./online";
import type { OnlineSelfTestRuntime } from "./tools/online-selftest";
import {
  selectStageSpawnInstances,
  type StageSpawnOptions,
} from "./stage";
import {
  canSelectTurnPiece,
  createTurnRuntime,
  queueTurnLaunch,
  resetTurnRuntime,
  setMatchOverHandler,
  setPieceRemovalHandler,
  setTurnCameraMode,
  setTurnGameMode,
  wakeAllTurnPieces,
} from "./turn";

const appElement = document.querySelector<HTMLElement>("#app");

if (appElement === null) {
  throw new Error("게임 진입점 #app 요소를 찾지 못했습니다.");
}

const app: HTMLElement = appElement;

/**
 * 렌더 보드와 물리 보드의 상면이 같은 y=0 계약을 지키는지 시작 전에 확인한다.
 */
function assertBoardTops(renderTop: number, physicsTop: number): void {
  const tolerance = 1e-6;
  if (
    Math.abs(renderTop) > tolerance ||
    Math.abs(physicsTop) > tolerance ||
    Math.abs(renderTop - physicsTop) > tolerance
  ) {
    throw new Error(
      `보드 상면 불일치: 렌더 y=${renderTop}, 물리 y=${physicsTop}`,
    );
  }
}

/**
 * 최종 에셋을 읽고 씬과 물리를 구성한 뒤 고정 스텝 루프를 시작한다.
 */
async function bootstrap(): Promise<void> {
  const inlineLoadingPanel =
    document.querySelector<HTMLElement>("#boot-loading");
  const loadingPanel =
    inlineLoadingPanel ?? document.createElement("section");
  loadingPanel.className = "loading-panel";
  loadingPanel.setAttribute("role", "status");
  loadingPanel.setAttribute("aria-live", "polite");
  let loadingPhase =
    loadingPanel.querySelector<HTMLParagraphElement>(
      "#boot-loading-phase",
    );
  if (loadingPhase === null) {
    loadingPhase = document.createElement("p");
    loadingPhase.id = "boot-loading-phase";
    loadingPanel.replaceChildren(loadingPhase);
  }
  loadingPhase.textContent =
    "ChessAlkkagi 에셋을 불러오는 중입니다";
  // app을 비울 때 인라인 부트 노드를 함께 넘겨 같은 요소를 유지한다.
  app.replaceChildren(loadingPanel);
  const metaRuntime = createMetaRuntime();
  let startModeAction:
    | ((mode: GameMode) => Promise<void>)
    | null = null;
  let returnToMenuAction: (() => Promise<void>) | null = null;
  const menuRuntime = createMainMenu(
    app,
    metaRuntime,
    async (mode) => {
      if (startModeAction === null) {
        throw new Error("게임 월드가 아직 준비되지 않았습니다.");
      }
      await startModeAction(mode);
    },
    async () => {
      if (returnToMenuAction === null) {
        throw new Error("메뉴 복귀 경로가 아직 준비되지 않았습니다.");
      }
      await returnToMenuAction();
    },
  );
  const assets = await loadChessAssets((event) => {
    const loadedBytes =
      Number.isFinite(event.loaded) && event.loaded > 0
        ? event.loaded
        : 0;
    if (
      event.lengthComputable &&
      Number.isFinite(event.total) &&
      event.total > 0
    ) {
      const ratio = loadedBytes / event.total;
      const percent = Number.isFinite(ratio)
        ? Math.round(Math.min(1, Math.max(0, ratio)) * 100)
        : 0;
      loadingPhase.textContent =
        `말 모델을 불러오는 중입니다 ${percent}%`;
      return;
    }
    const downloadedMegabytes = loadedBytes / (1024 * 1024);
    loadingPhase.textContent =
      `말 모델을 불러오는 중입니다 ${downloadedMegabytes.toFixed(1)}MB`;
  });
  if (
    new URLSearchParams(window.location.search).get("probe") === "1"
  ) {
    const { runDeterminismProbe } = await import(
      "./tools/determinism-probe"
    );
    window.__runDeterminismProbe = () =>
      runDeterminismProbe(assets.meta);
    console.info(
      "[결정성 프로브] window.__runDeterminismProbe() 호출 준비가 끝났습니다.",
    );
  }
  if (PIECE_INSTANCES.length !== 32) {
    throw new Error(`시작 말 개수가 32개가 아니라 ${PIECE_INSTANCES.length}개입니다.`);
  }
  const boardHalfExtent = deriveBoardHalfExtent(assets.meta.cellSize);
  const sceneRuntime = createSceneRuntime(
    app,
    assets,
    PIECE_INSTANCES,
    boardHalfExtent,
  );

  loadingPhase.textContent = "물리 월드를 준비하는 중입니다";
  const physicsRuntime = await createPhysicsRuntime(
    assets.meta,
    PIECE_INSTANCES,
    boardHalfExtent,
  );
  assertBoardTops(sceneRuntime.boardTop, physicsRuntime.boardTop);
  loadingPhase.textContent =
    "말의 시작 자세를 안정시키는 중입니다";
  preSettlePhysics(physicsRuntime);
  synchronizePieceMeshes(sceneRuntime, physicsRuntime);
  loadingPanel.remove();
  const tuningRuntime = createTuningRuntime(app, physicsRuntime);
  const aimRuntime = createAimRuntime(sceneRuntime);
  const aimParametersRuntime = createAimParametersRuntime(
    app,
    tuningRuntime,
    sceneRuntime,
  );
  const turnRuntime = createTurnRuntime(
    physicsRuntime,
    sceneRuntime,
    tuningRuntime.settings,
  );
  const runCardState = createRunCardState();
  let replayDevelopmentRuntime: ReplayDevelopmentRuntime | null =
    null;
  let gameModeRuntime: GameModeRuntime | null = null;
  let onlineRuntime: OnlineRuntime | null = null;
  let onlineSelfTestRuntime: OnlineSelfTestRuntime | null =
    null;
  let onlineConnectionBlocked = false;
  const disconnectOverlay = document.createElement("section");
  disconnectOverlay.className = "match-result-overlay";
  disconnectOverlay.hidden = true;
  disconnectOverlay.setAttribute("role", "dialog");
  disconnectOverlay.setAttribute("aria-modal", "true");
  disconnectOverlay.innerHTML = `
    <div class="match-result-panel">
      <p>온라인 대전</p>
      <h1>상대와 연결이 끊겼습니다</h1>
      <p data-online-reconnect-status>재연결하거나 대국을 종료하세요.</p>
      <div class="match-result-actions">
        <button type="button" data-online-reconnect>재연결 코드 만들기</button>
        <button type="button" data-online-abandon>대국 종료</button>
      </div>
    </div>
  `;
  app.append(disconnectOverlay);
  const reconnectStatus =
    disconnectOverlay.querySelector<HTMLElement>(
      "[data-online-reconnect-status]",
    );
  const reconnectButton =
    disconnectOverlay.querySelector<HTMLButtonElement>(
      "[data-online-reconnect]",
    );
  const abandonButton =
    disconnectOverlay.querySelector<HTMLButtonElement>(
      "[data-online-abandon]",
    );
  if (
    reconnectStatus === null ||
    reconnectButton === null ||
    abandonButton === null
  ) {
    throw new Error("온라인 재연결 화면 요소를 만들지 못했습니다.");
  }
  const showDisconnectOverlay = (): void => {
    onlineConnectionBlocked = true;
    disconnectOverlay.hidden = false;
    reconnectButton.focus();
  };
  const hideDisconnectOverlay = (): void => {
    onlineConnectionBlocked = false;
    disconnectOverlay.hidden = true;
  };
  const onlineResignButton = document.createElement("button");
  onlineResignButton.type = "button";
  onlineResignButton.className =
    "return-menu-button online-resign-button";
  onlineResignButton.textContent = "기권";
  onlineResignButton.hidden = true;
  const resignOverlay = document.createElement("section");
  resignOverlay.className = "match-result-overlay";
  resignOverlay.hidden = true;
  resignOverlay.innerHTML = `
    <div class="match-result-panel">
      <p>온라인 대전</p>
      <h1>대국을 기권하시겠습니까?</h1>
      <div class="match-result-actions">
        <button type="button" data-resign-cancel>계속하기</button>
        <button type="button" data-resign-confirm>기권</button>
      </div>
    </div>
  `;
  app.append(onlineResignButton, resignOverlay);
  const resignCancel =
    resignOverlay.querySelector<HTMLButtonElement>(
      "[data-resign-cancel]",
    );
  const resignConfirm =
    resignOverlay.querySelector<HTMLButtonElement>(
      "[data-resign-confirm]",
    );
  if (resignCancel === null || resignConfirm === null) {
    throw new Error("온라인 기권 확인 화면 요소를 만들지 못했습니다.");
  }
  onlineResignButton.addEventListener("click", () => {
    onlineConnectionBlocked = true;
    resignOverlay.hidden = false;
    resignCancel.focus();
  });
  resignCancel.addEventListener("click", () => {
    onlineConnectionBlocked = false;
    resignOverlay.hidden = true;
  });
  resignConfirm.addEventListener("click", () => {
    resignOverlay.hidden = true;
    onlineRuntime?.resign();
  });
  let readsAiTelegraphActive = (): boolean => false;
  const inputRuntime = createInputRuntime(
    sceneRuntime,
    physicsRuntime,
    aimRuntime,
    aimParametersRuntime,
    {
      isInputBlocked: () =>
        turnRuntime.phase === "match-over" ||
        onlineConnectionBlocked ||
        gameModeRuntime?.switching === true ||
        isMenuBlocking(menuRuntime),
      isExternalAimActive: () =>
        readsAiTelegraphActive() ||
        onlineRuntime?.isRemoteTelegraphActive() === true,
      canSelectPiece: (pieceId) =>
        gameModeRuntime?.mode === "online"
          ? onlineRuntime?.canSelectLocalPiece(pieceId) === true
          : (gameModeRuntime?.mode !== "stage" ||
              turnRuntime.currentSide === "white") &&
            canSelectTurnPiece(turnRuntime, pieceId),
      isCameraRotating: () =>
        turnRuntime.phase === "camera-rotating",
      queueLaunch: (request) => {
        const binding = physicsRuntime.pieces.get(request.pieceId);
        const gameMode = gameModeRuntime?.mode ?? "hotseat";
        const permanentForceBonus =
          gameMode === "stage" &&
          binding?.instance.side === "white"
            ? computePermanentForceBonus(
                metaRuntime.state.upgrades,
                binding.instance.type,
              )
            : 0;
        const launchRequest = {
          ...request,
          speedMultiplier: computePlayerLaunchSpeedMultiplier(
            gameMode,
            runCardState,
            permanentForceBonus,
          ),
        };
        return gameMode === "online" &&
          onlineRuntime !== null
          ? onlineRuntime.queueLocalLaunch(launchRequest)
          : queueTurnLaunch(turnRuntime, launchRequest);
      },
      onModeChanged: (mode) =>
        setTurnCameraMode(turnRuntime, mode),
    },
  );
  tuningRuntime.wakeAllHandler = () => {
    cancelInputInteraction(inputRuntime, true);
    wakeAllTurnPieces(turnRuntime);
  };
  setPieceRemovalHandler(turnRuntime, (pieceId) =>
    handleInputPieceRemoved(inputRuntime, pieceId),
  );
  const aiRuntime = createAiRuntime(
    physicsRuntime,
    sceneRuntime,
    turnRuntime,
    assets.meta.cellSize,
    () => gameModeRuntime?.mode ?? "hotseat",
    () => gameModeRuntime?.stageNumber ?? 1,
    aimRuntime,
  );
  readsAiTelegraphActive = () =>
    isAiTelegraphActive(aiRuntime);
  const resetBoard = async (
    requestedOptions?: StageSpawnOptions,
  ): Promise<void> => {
    const baseOptions = requestedOptions ?? {
      gameMode: gameModeRuntime?.mode ?? "hotseat",
      stageNumber: gameModeRuntime?.stageNumber ?? 1,
    };
    const stageOptions: StageSpawnOptions = {
      ...baseOptions,
      runCards:
        baseOptions.gameMode === "stage"
          ? runCardState
          : undefined,
      permanentUpgrades:
        baseOptions.gameMode === "stage"
          ? metaRuntime.state.upgrades
          : undefined,
    };
    const spawnInstances = selectStageSpawnInstances(
      PIECE_INSTANCES,
      stageOptions,
    );
    const expectedPieceCount = spawnInstances.length;
    resetAiMatch(aiRuntime);
    lockInputForMatchOver(inputRuntime);
    resetPhysicsPieces(
      physicsRuntime,
      assets.meta,
      PIECE_INSTANCES,
      stageOptions,
    );
    resetScenePieces(
      sceneRuntime,
      assets,
      PIECE_INSTANCES,
      stageOptions,
    );
    reapplyTuningPhysicsSettings(tuningRuntime);
    preSettlePhysics(physicsRuntime);
    synchronizePieceMeshes(sceneRuntime, physicsRuntime);
    resetTurnRuntime(turnRuntime);
    resetInputAfterMatch(inputRuntime, physicsRuntime.pieces.keys());
    const replayHeaderSource: ReplayHeaderSource = {
      gameMode: stageOptions.gameMode,
      initialSide: "white",
      ...(stageOptions.gameMode === "stage"
        ? {
            stageNumber: stageOptions.stageNumber,
            runCards: runCardState,
            permanentUpgrades: metaRuntime.state.upgrades,
          }
        : {}),
    };
    replayDevelopmentRuntime?.startRecording(
      replayHeaderSource,
    );
    const sleepingCount = [...physicsRuntime.pieces.values()].filter(
      (binding) => binding.body.isSleeping(),
    ).length;
    if (
      physicsRuntime.pieces.size !== expectedPieceCount ||
      sceneRuntime.pieceMeshes.size !== expectedPieceCount ||
      sleepingCount !== expectedPieceCount
    ) {
      throw new Error(
        `재시작 보드 검증 실패: 물리 ${physicsRuntime.pieces.size}/${expectedPieceCount}, 렌더 ${sceneRuntime.pieceMeshes.size}/${expectedPieceCount}, 수면 ${sleepingCount}/${expectedPieceCount}`,
      );
    }
    console.info(
      `[대국] 다시 시작 완료: 백 선공, 물리 ${physicsRuntime.pieces.size}/${expectedPieceCount}, 렌더 ${sceneRuntime.pieceMeshes.size}/${expectedPieceCount}, 수면 ${sleepingCount}/${expectedPieceCount}`,
    );
  };
  gameModeRuntime = createGameModeRuntime(async (mode) => {
    const previousMode = gameModeRuntime?.mode ?? "hotseat";
    const previousCards = cloneRunCardState(runCardState);
    resetRunCardState(runCardState);
    setTurnGameMode(turnRuntime, mode);
    try {
      await resetBoard({ gameMode: mode, stageNumber: 1 });
    } catch (error: unknown) {
      restoreRunCardState(runCardState, previousCards);
      setTurnGameMode(turnRuntime, previousMode);
      throw error;
    }
  });
  const matchRuntime = createMatchRuntime(app, resetBoard);
  const matchResultPanel =
    matchRuntime.overlay.querySelector<HTMLElement>(
      ".match-result-panel",
    );
  const matchResultActions =
    matchRuntime.overlay.querySelector<HTMLElement>(
      ".match-result-actions",
    );
  if (matchResultPanel === null || matchResultActions === null) {
    throw new Error("온라인 재대결 버튼을 넣을 결과 화면이 없습니다.");
  }
  const rematchStatusText = document.createElement("p");
  rematchStatusText.hidden = true;
  rematchStatusText.setAttribute("aria-live", "polite");
  const rematchButton = document.createElement("button");
  rematchButton.type = "button";
  rematchButton.textContent = "재대결";
  rematchButton.hidden = true;
  const rematchCancelButton = document.createElement("button");
  rematchCancelButton.type = "button";
  rematchCancelButton.textContent = "요청 취소";
  rematchCancelButton.hidden = true;
  const rematchAcceptButton = document.createElement("button");
  rematchAcceptButton.type = "button";
  rematchAcceptButton.textContent = "수락";
  rematchAcceptButton.hidden = true;
  const rematchDeclineButton = document.createElement("button");
  rematchDeclineButton.type = "button";
  rematchDeclineButton.textContent = "거절";
  rematchDeclineButton.hidden = true;
  matchResultPanel.insertBefore(
    rematchStatusText,
    matchResultActions,
  );
  matchResultActions.prepend(
    rematchButton,
    rematchCancelButton,
    rematchAcceptButton,
    rematchDeclineButton,
  );

  // 온라인 결과와 연결 상태를 함께 보고 필요한 재대결 조작만 노출한다.
  const renderRematchControls = (
    status: OnlineRematchStatus | null,
  ): void => {
    const showsOnlineResult =
      gameModeRuntime?.mode === "online" &&
      matchRuntime.winner !== null &&
      status?.connected === true;
    rematchButton.hidden = true;
    rematchCancelButton.hidden = true;
    rematchAcceptButton.hidden = true;
    rematchDeclineButton.hidden = true;
    rematchButton.disabled = false;
    rematchButton.textContent = "재대결";
    rematchStatusText.hidden = true;
    rematchStatusText.textContent = "";
    if (!showsOnlineResult || status === null) {
      return;
    }
    if (status.phase === "idle") {
      rematchButton.hidden = false;
      return;
    }
    rematchStatusText.hidden = false;
    rematchStatusText.textContent = status.message;
    if (status.phase === "outgoing") {
      rematchButton.hidden = false;
      rematchButton.disabled = true;
      rematchButton.textContent = "상대 응답을 기다리는 중";
      rematchCancelButton.hidden = false;
    } else if (status.phase === "incoming") {
      rematchAcceptButton.hidden = false;
      rematchDeclineButton.hidden = false;
    } else if (status.phase === "declined") {
      rematchButton.hidden = false;
    }
  };

  // 재대결 UI 오류는 전체 스택을 남기고 결과 화면에서 이유를 바로 보여 준다.
  const showRematchActionError = (error: unknown): void => {
    const fullError =
      error instanceof Error
        ? (error.stack ?? error.message)
        : String(error);
    console.error(fullError);
    rematchStatusText.hidden = false;
    rematchStatusText.textContent =
      error instanceof Error ? error.message : String(error);
  };
  rematchButton.addEventListener("click", () => {
    try {
      onlineRuntime?.offerRematch();
    } catch (error: unknown) {
      showRematchActionError(error);
    }
  });
  rematchCancelButton.addEventListener("click", () => {
    try {
      onlineRuntime?.cancelRematch();
    } catch (error: unknown) {
      showRematchActionError(error);
    }
  });
  rematchAcceptButton.addEventListener("click", () => {
    try {
      onlineRuntime?.respondRematch(true);
    } catch (error: unknown) {
      showRematchActionError(error);
    }
  });
  rematchDeclineButton.addEventListener("click", () => {
    try {
      onlineRuntime?.respondRematch(false);
    } catch (error: unknown) {
      showRematchActionError(error);
    }
  });

  setMatchOverHandler(turnRuntime, (winner) => {
    lockInputForMatchOver(inputRuntime);
    const gameMode = gameModeRuntime?.mode ?? "hotseat";
    const completedStage = gameModeRuntime?.stageNumber ?? 1;
    const restartAfterResult = async (): Promise<void> => {
      if (gameMode === "online") {
        return;
      }
      if (gameMode !== "stage") {
        await resetBoard();
        return;
      }
      const previousStage = gameModeRuntime?.stageNumber ?? 1;
      const previousCards = cloneRunCardState(runCardState);
      resetRunCardState(runCardState);
      const nextStage = 1;
      if (gameModeRuntime !== null) {
        setStageNumber(gameModeRuntime, nextStage);
      }
      try {
        await resetBoard({
          gameMode: "stage",
          stageNumber: nextStage,
        });
      } catch (error: unknown) {
        restoreRunCardState(runCardState, previousCards);
        if (gameModeRuntime !== null) {
          setStageNumber(gameModeRuntime, previousStage);
        }
        throw error;
      }
    };
    const upgradeCards =
      gameMode === "stage" && winner === "white"
        ? drawUpgradeCards(completedStage, runCardState)
        : [];
    if (gameMode === "stage" && winner === "white") {
      awardStageClearPoints(metaRuntime);
      renderMainMenu(menuRuntime);
    }
    const selectUpgradeCard =
      gameMode === "stage" && winner === "white"
        ? async (cardId: CardId): Promise<void> => {
            const previousStage =
              gameModeRuntime?.stageNumber ?? completedStage;
            const previousCards = cloneRunCardState(runCardState);
            applyCardPick(runCardState, cardId);
            const nextStage = completedStage + 1;
            if (gameModeRuntime !== null) {
              setStageNumber(gameModeRuntime, nextStage);
            }
            try {
              await resetBoard({
                gameMode: "stage",
                stageNumber: nextStage,
              });
            } catch (error: unknown) {
              restoreRunCardState(runCardState, previousCards);
              if (gameModeRuntime !== null) {
                setStageNumber(gameModeRuntime, previousStage);
              }
              throw error;
            }
          }
        : null;
    // 온라인 결과 화면에서는 메뉴 이외의 대국 조작을 다시 열 수 없게 한다.
    if (gameMode === "online") {
      onlineResignButton.hidden = true;
    }
    showMatchResult(
      matchRuntime,
      winner,
      gameMode,
      completedStage,
      restartAfterResult,
      upgradeCards,
      selectUpgradeCard,
      gameMode === "stage" && winner === "black"
        ? () => returnToMainMenu(menuRuntime)
        : gameMode === "online"
          ? () => returnToMainMenu(menuRuntime)
          : null,
      gameMode === "online"
        ? onlineRuntime?.mySide ?? null
        : null,
    );
    if (gameMode === "online") {
      renderRematchControls(
        onlineRuntime?.getRematchStatus() ?? null,
      );
    }
  });
  let gameLoopStarted = false;
  const ensureGameLoopStarted = (): void => {
    if (gameLoopStarted || gameModeRuntime === null) {
      return;
    }
    startGameLoop(
      sceneRuntime,
      physicsRuntime,
      aimRuntime,
      inputRuntime,
      turnRuntime,
      aiRuntime,
      gameModeRuntime,
      tuningRuntime,
      boardHalfExtent,
      (now) => {
        onlineRuntime?.update(now);
        onlineSelfTestRuntime?.updateGuest(now);
      },
      () => onlineRuntime?.getDebugStatus() ?? null,
      () => onlineSelfTestRuntime?.stepGuest(),
    );
    gameLoopStarted = true;
  };
  startModeAction = async (mode): Promise<void> => {
    if (gameModeRuntime === null) {
      throw new Error("대전 모드 상태가 준비되지 않았습니다.");
    }
    if (mode === "online") {
      onlineSelfTestRuntime?.destroy();
      const {
        createOnlineRuntime,
        openOnlineLobby,
      } = await import("./online");
      const session = await openOnlineLobby(menuRuntime.overlay);
      onlineRuntime?.close();
      onlineRuntime = createOnlineRuntime(
        session.link,
        turnRuntime,
        aimRuntime,
        session.mySide,
        {
          onDisconnected: showDisconnectOverlay,
          prepareRematch: async () => {
            await resetBoard({
              gameMode: "online",
              stageNumber: 1,
            });
          },
          onRematchStateChange: renderRematchControls,
          onRematchStarted: () => {
            hideDisconnectOverlay();
            hideMatchResult(matchRuntime);
            renderRematchControls(null);
            onlineResignButton.hidden = false;
          },
          onResigned: (resignedSide) => {
            hideDisconnectOverlay();
            onlineResignButton.hidden = true;
            turnRuntime.phase = "match-over";
            lockInputForMatchOver(inputRuntime);
            const winner =
              resignedSide === "white" ? "black" : "white";
            showMatchResult(
              matchRuntime,
              winner,
              "online",
              1,
              async () => {},
              [],
              null,
              () => returnToMainMenu(menuRuntime),
              onlineRuntime?.mySide ?? null,
            );
            renderRematchControls(
              onlineRuntime?.getRematchStatus() ?? null,
            );
          },
        },
        { matchId: session.matchId },
      );
      onlineResignButton.hidden = false;
      try {
        await switchGameMode(gameModeRuntime, "online", true);
        onlineRuntime.startMatch({
          rejoining: session.rejoining,
        });
        ensureGameLoopStarted();
        await onlineRuntime.waitUntilReady();
        session.finishLobby();
      } catch (error: unknown) {
        session.finishLobby();
        onlineRuntime.close();
        onlineRuntime = null;
        throw error;
      }
      return;
    }
    onlineSelfTestRuntime?.destroy();
    onlineRuntime?.close();
    onlineRuntime = null;
    onlineResignButton.hidden = true;
    renderRematchControls(null);
    hideDisconnectOverlay();
    await switchGameMode(gameModeRuntime, mode, true);
    ensureGameLoopStarted();
  };
  reconnectButton.addEventListener("click", () => {
    if (onlineRuntime === null) {
      return;
    }
    reconnectButton.disabled = true;
    reconnectStatus.textContent = "새 P2P 연결 코드를 교환하는 중입니다.";
    const reconnectRuntime = onlineRuntime;
    const side = reconnectRuntime.mySide;
    void import("./online")
      .then(async ({ openOnlineLobby }) => {
        const session = await openOnlineLobby(app, {
          matchId: reconnectRuntime.matchId,
          rejoining: true,
        });
        try {
          if (session.mySide !== side) {
            session.link.close();
            throw new Error("재연결 진영은 기존 대국과 같아야 합니다.");
          }
          reconnectStatus.textContent = "방장 상태와 대국 기록을 맞추는 중입니다.";
          await reconnectRuntime.replaceTransport(session.link);
          hideDisconnectOverlay();
        } finally {
          session.finishLobby();
        }
      })
      .catch((error: unknown) => {
        const fullError =
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error);
        console.error(fullError);
        reconnectStatus.textContent =
          error instanceof Error ? error.message : String(error);
      })
      .finally(() => {
        reconnectButton.disabled = false;
      });
  });
  abandonButton.addEventListener("click", () => {
    if (onlineRuntime === null) {
      return;
    }
    hideDisconnectOverlay();
    onlineRuntime.terminate();
    onlineResignButton.hidden = true;
    lockInputForMatchOver(inputRuntime);
    showDisconnectedMatchEnd(
      matchRuntime,
      () => returnToMainMenu(menuRuntime),
    );
  });
  returnToMenuAction = async (): Promise<void> => {
    if (gameModeRuntime === null) {
      throw new Error("대전 모드 상태가 준비되지 않았습니다.");
    }
    onlineSelfTestRuntime?.destroy();
    onlineRuntime?.close();
    onlineRuntime = null;
    onlineResignButton.hidden = true;
    renderRematchControls(null);
    hideDisconnectOverlay();
    await switchGameMode(gameModeRuntime, "hotseat", true);
    hideMatchResult(matchRuntime);
  };
  if (
    new URLSearchParams(window.location.search).get("replay") === "1"
  ) {
    const { createReplayDevelopmentRuntime } = await import(
      "./replay"
    );
    replayDevelopmentRuntime = createReplayDevelopmentRuntime(
      app,
      assets.meta,
      turnRuntime,
      {
        gameMode: gameModeRuntime.mode,
        initialSide: "white",
      },
    );
  }
  if (
    new URLSearchParams(window.location.search).get("net") === "1"
  ) {
    const { createNetDevelopmentRuntime } = await import("./net");
    createNetDevelopmentRuntime(app);
  }
  if (
    new URLSearchParams(window.location.search).get("online") ===
    "selftest"
  ) {
    const { createOnlineSelfTestRuntime } = await import(
      "./tools/online-selftest"
    );
    onlineSelfTestRuntime = createOnlineSelfTestRuntime({
      assets,
      hostTurnRuntime: turnRuntime,
      hostAimRuntime: aimRuntime,
      tuningSettings: tuningRuntime.settings,
      async prepareHostBoard(
        preserveOnlineRuntime: boolean,
      ): Promise<void> {
        if (gameModeRuntime === null) {
          throw new Error(
            "온라인 셀프테스트 대전 모드가 준비되지 않았습니다.",
          );
        }
        // 최초 시작만 이전 런타임을 닫고, 재대결 준비는 현재 P2P 링크를 그대로 사용한다.
        if (!preserveOnlineRuntime) {
          onlineRuntime?.close();
          onlineRuntime = null;
        }
        await switchGameMode(
          gameModeRuntime,
          "online",
          true,
        );
      },
      setHostOnlineRuntime(runtime): void {
        onlineRuntime = runtime;
      },
      ensureGameLoopStarted,
      finishMenuStart(): void {
        hideMainMenuAfterModeStart(menuRuntime);
      },
    });
    window.__onlineSelfTest = onlineSelfTestRuntime.api;
    console.info(
      "[온라인 셀프테스트] window.__onlineSelfTest.start() 호출 준비가 끝났습니다.",
    );
  }
  setMainMenuReady(menuRuntime, true);
}

void bootstrap().catch((error: unknown) => {
  const fullError =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(fullError);
  app.innerHTML = `
    <section class="error-panel" role="alert">
      <h1>게임을 시작하지 못했습니다.</h1>
      <pre></pre>
    </section>
  `;
  const errorText = app.querySelector<HTMLPreElement>(".error-panel pre");
  if (errorText !== null) {
    errorText.textContent = fullError;
  }
});
