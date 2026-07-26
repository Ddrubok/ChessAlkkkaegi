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
  showMatchResult,
} from "./match";
import {
  createMainMenu,
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
  app.replaceChildren();
  const metaRuntime = createMetaRuntime();
  let startModeAction:
    | ((mode: "hotseat" | "stage") => Promise<void>)
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
  const loadingPanel = document.createElement("section");
  loadingPanel.className = "loading-panel";
  loadingPanel.setAttribute("role", "status");
  loadingPanel.setAttribute("aria-live", "polite");
  loadingPanel.innerHTML =
    "<p>ChessAlkkagi 에셋을 불러오는 중입니다…</p>";
  app.append(loadingPanel);

  const assets = await loadChessAssets();
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

  loadingPanel.textContent = "물리 월드를 준비하는 중입니다…";
  const physicsRuntime = await createPhysicsRuntime(
    assets.meta,
    PIECE_INSTANCES,
    boardHalfExtent,
  );
  assertBoardTops(sceneRuntime.boardTop, physicsRuntime.boardTop);
  loadingPanel.textContent = "말의 시작 자세를 안정시키는 중입니다…";
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
  let gameModeRuntime: GameModeRuntime | null = null;
  let readsAiTelegraphActive = (): boolean => false;
  const inputRuntime = createInputRuntime(
    sceneRuntime,
    physicsRuntime,
    aimRuntime,
    aimParametersRuntime,
    {
      isInputBlocked: () =>
        turnRuntime.phase === "match-over" ||
        gameModeRuntime?.switching === true ||
        isMenuBlocking(menuRuntime),
      isExternalAimActive: () =>
        readsAiTelegraphActive(),
      canSelectPiece: (pieceId) =>
        (gameModeRuntime?.mode !== "stage" ||
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
        return queueTurnLaunch(turnRuntime, {
          ...request,
          speedMultiplier: computePlayerLaunchSpeedMultiplier(
            gameMode,
            runCardState,
            permanentForceBonus,
          ),
        });
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
  setMatchOverHandler(turnRuntime, (winner) => {
    lockInputForMatchOver(inputRuntime);
    const gameMode = gameModeRuntime?.mode ?? "hotseat";
    const completedStage = gameModeRuntime?.stageNumber ?? 1;
    const restartAfterResult = async (): Promise<void> => {
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
        : null,
    );
  });
  let gameLoopStarted = false;
  startModeAction = async (mode): Promise<void> => {
    if (gameModeRuntime === null) {
      throw new Error("대전 모드 상태가 준비되지 않았습니다.");
    }
    await switchGameMode(gameModeRuntime, mode, true);
    if (!gameLoopStarted) {
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
      );
      gameLoopStarted = true;
    }
  };
  returnToMenuAction = async (): Promise<void> => {
    if (gameModeRuntime === null) {
      throw new Error("대전 모드 상태가 준비되지 않았습니다.");
    }
    await switchGameMode(gameModeRuntime, "hotseat", true);
    hideMatchResult(matchRuntime);
  };
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
