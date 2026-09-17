import { createBannerMatch, settleBannerMatch, finishBannerMatch, type BannerMatch } from "./banner-match";
import { readOpponentBanner } from "./banner-profile";
import { getPlayerBannerTheme } from "./banner-theme";
import { createPlayerBanners } from "./player-banner";
import { uiText } from "./ui-text";
import "./style.css";
import "./lobby.css";
import "./progress.css";
import "./mastery-ui.css";
import "./quest-ui.css";
import { progressStorage } from "./progress-storage";
import { questStorage } from "./quest-storage";
import { createQuestId, makePieceLaunchEvent, makePuzzleClearEvent, makePveWinEvent, makePvpWinEvent } from "./quest-events";
import { isQuestPieceType, isQuestPuzzleId } from "./quest-model";
import { appendQuestResult, captureQuestResultBaseline, openQuestBook, type QuestResultBaseline } from "./quest-ui";
import { getTier } from "./tier";
import { formatTier, formatTierProgress } from "./tier-view";
import { I18nManager } from "./i18n";
import { getRuntimeText } from "./runtime-text";
import { STRATEGY_STAT_STEP } from "./strategy-deck";
import { Vector3 } from "three";
import { AdManager } from "./ad-manager";
import { tutorialManager } from "./tutorial";
import { PuzzlePhysicsTracker } from "./puzzle-physics";
import { applyPuzzleSpawnDefinitions } from "./puzzle-spawn";
import { PuzzleUI } from "./puzzle-ui";
import {
  PUZZLE_CATALOG, getPuzzleDefinition, getPuzzleProgress,
  loadPuzzleProgress, savePuzzleProgress, isPuzzleUnlocked,
  evaluatePuzzleAttempt, applyPuzzleEvaluation,
  type PuzzleDefinition, type PuzzleEvaluationInput,
} from "./puzzle";
import { appendPuzzlePhysicsEvidence } from "./puzzle-evidence";
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
  computeEffectiveGeneralCardGrade,
  computePlayerLaunchSpeedMultiplier,
  computeTunedGeneralCardEffect,
  createRunCardState,
  drawUpgradeCards,
  isGiantPawnCardActive,
  isProneStartCardActive,
  resetRunCardState,
  restoreRunCardState,
  type CardId,
} from "./cards";
import {
  createCardEffectTuning,
  createCardTuningRuntime,
  jumpCardTuningStage,
  relayoutCurrentCardTuningBoard,
  setCardTuningGameMode,
  updateCardTuningAppliedValues,
  updateCardTuningStageNumber,
  type CardTuningAppliedValues,
} from "./card-tuning";
import {
  CARD_EFFECT_SCALE,
  GIANT_PAWN_SIZE_MULTIPLIER,
  PIECE_TYPES,
  PLAYER_MAX_SIZE_SCALE,
  STAGE_RUN_LENGTH,
} from "./config";
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
  selectPiece,
  switchInputMode,
} from "./input";
import {
  type PieceSide,
  PIECE_INSTANCES,
} from "./layout";
import { startGameLoop } from "./loop";
import { createTurnHud } from "./turn-hud";
import {
  createMatchRuntime,
  hideMatchResult,
  showDisconnectedMatchEnd,
  showMatchResult,
  type MatchWinner,
  showStageRunResult,
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
  computePermanentForceBonus,
  createMetaRuntime,
  loadMetaState,
  createStageRunPointState,
  discardStageRunPoints,
  recordStageRunClear,
  saveMaxClearedStage,
  settleStageRunPoints,
  shouldOfferStageClearCards,
} from "./meta";
import {
  applyStrategyDecksToPhysics,
  createPhysicsRuntime,
  preSettlePhysics,
  promotePieceBody,
  rebuildPhysicsBoard,
  resetPhysicsPieces,
} from "./physics";
import {
  createSceneRuntime,
  promotePieceMesh,
  rebuildSceneBoard,
  resetScenePieces,
  synchronizePieceMeshes,
} from "./scene";
import {
  initializeSound,
  playSoundEffect,
  resetPieceHitSoundTracking,
} from "./sound";
import { openPromotionModal } from "./promotion-modal";
import {
  createTuningRuntime,
  createDefaultRuntimeTuningSettings,
  applyPuzzleTuningDefaults,
  restoreLocalTuningSettings,
  setPuzzleTuningLocked,
  reapplyTuningPhysicsSettings,
  setTuningGameMode,
  updateTuningAppliedValues,
} from "./tuning";
import type {
  ReplayDevelopmentRuntime,
  ReplayHeaderSource,
} from "./replay";
import type {
  OnlineRematchStatus,
  OnlineRuntime,
  OnlineTransport,
} from "./online";
import type { OnlineSelfTestRuntime } from "./tools/online-selftest";
import { SupabaseMatchUi } from "./supabase-match-ui";
import { SupabaseMatchmaker } from "./supabase-matchmaker";
import { SocialService } from "./social-service";
import { openChallengeReceivedModal } from "./challenge-modal";
import { getSupabaseClient } from "./supabase-client";
import { getOrCreateUserProfile, waitForAuthChange, type UserProfile } from "./supabase-auth";
import {
  computeEnemyStageStepValues,
  computeEnemyStageSizeMultiplier,
  computeStageBuffs,
  computeStageBoardHalfExtent,
  computeStagePieceScale,
  computeUpgradeWeightFraction,
  selectStageSpawnInstances,
  type StageSpawnOptions,
} from "./stage";
import {
  canSelectTurnPiece,
  createTurnRuntime,
  executeKingDefense,
  executeKingSwap,
  queueTurnLaunch,
  resetTurnRuntime,
  setMatchOverHandler,
  setPieceRemovalHandler,
  setTurnCameraMode,
  setTurnGameMode,
  wakeAllTurnPieces,
} from "./turn";
import {
  STAGE_TEMPLATE_IDS,
  backfillPuzzleMastery,
  recordMasteryDoubleOut,
  recordMasteryLaunch,
  recordMasteryPuzzle,
  recordMasteryPveVictory,
  type MasteryProgressItem,
} from "./mastery";
import { appendMasteryResult, openMasteryBook, trackedMasteryText } from "./mastery-ui";

const appElement = document.querySelector<HTMLElement>("#app");

if (appElement === null) {
  throw new Error("게임 진입점 #app 요소를 찾지 못했습니다.");
}

const app: HTMLElement = appElement;

/**
 * 렌더 보드와 물리 보드의 상면이 같은 y=0 계약을 지키는지 시작 전에 확인한다.
 */
function assertBoardAgreement(
  renderTop: number,
  physicsTop: number,
  renderHalfExtent: number,
  physicsHalfExtent: number,
): void {
  const tolerance = 1e-6;
  if (
    Math.abs(renderTop) > tolerance ||
    Math.abs(physicsTop) > tolerance ||
    Math.abs(renderTop - physicsTop) > tolerance ||
    Math.abs(renderHalfExtent - physicsHalfExtent) > tolerance
  ) {
    throw new Error(
      `보드 렌더·물리 불일치: 렌더 y=${renderTop}, 물리 y=${physicsTop}, 렌더 반폭=${renderHalfExtent}, 물리 반폭=${physicsHalfExtent}`,
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
    getRuntimeText("startup.loading_assets");
  // app을 비울 때 인라인 부트 노드를 함께 넘겨 같은 요소를 유지한다.
  app.replaceChildren(loadingPanel);
  initializeSound();
  const progressClient = getSupabaseClient();
  const progressSession = progressClient ? await progressClient.auth.getSession() : null;
  if (progressSession?.error) throw new Error("로그인 상태를 확인하지 못했습니다. 연결을 확인한 뒤 새로고침해 주세요.");
  const sessionUser = progressSession?.data.session?.user;
  const progressOwner = sessionUser && !sessionUser.is_anonymous ? sessionUser.id : null;
  await progressStorage.activate(progressClient, progressOwner);
  await questStorage.activate(progressClient, progressOwner);
  if (progressOwner && progressClient) {
    localStorage.setItem("ca_logged_in_user", "true");
    localStorage.setItem("ca_guest_user_uuid", progressOwner);
    await getOrCreateUserProfile(progressClient);
  }
  let changingAccount = false;
  progressClient?.auth.onAuthStateChange((_event, session) => {
    const nextOwner = session?.user && !session.user.is_anonymous ? session.user.id : null;
    if (changingAccount || nextOwner === progressStorage.owner) return;
    changingAccount = true;
    progressStorage.suspend();
    questStorage.suspend();
    app.inert = true;
    if (!nextOwner) localStorage.removeItem("ca_logged_in_user");
    // Recreate the board and all in-memory progress on identity changes.
    // Do not make awaited Supabase calls inside its auth callback.
    window.setTimeout(() => { void waitForAuthChange().then(() => window.location.reload()); }, 0);
  });
  window.addEventListener("online", () => { void progressStorage.retry(); void questStorage.retry(); });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { void progressStorage.flush(); void questStorage.flush(); }
    else void questStorage.retry();
  });
  const metaRuntime = createMetaRuntime();
  let activeOnlineMatchMode: "classic" | "strategy" = "classic";
  let startModeAction:
    | ((mode: GameMode, selectedStage?: number, tutorialType?: "basic" | "advanced") => Promise<void>)
    | null = null;
  let returnToMenuAction: (() => Promise<void>) | null = null;
  let confirmAbandonAction: (() => Promise<void>) | null = null;
  const menuRuntime = createMainMenu(
    app,
    metaRuntime,
    async (mode, selectedStage, tutorialType) => {
      if (!progressStorage.ready) throw new Error("계정 진행도를 먼저 불러와 주세요.");
      if (startModeAction === null) {
        throw new Error("게임 월드가 아직 준비되지 않았습니다.");
      }
      await startModeAction(mode, selectedStage, tutorialType);
    },
    async () => {
      if (returnToMenuAction === null) {
        throw new Error("메뉴 복귀 경로가 아직 준비되지 않았습니다.");
      }
      await returnToMenuAction();
    },
    async () => {
      if (confirmAbandonAction === null) {
        throw new Error("대국 포기 경로가 아직 준비되지 않았습니다.");
      }
      await confirmAbandonAction();
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
        getRuntimeText("startup.loading_models_percent", { percent });
      return;
    }
    const downloadedMegabytes = loadedBytes / (1024 * 1024);
    loadingPhase.textContent =
      getRuntimeText("startup.loading_models_bytes", { size: downloadedMegabytes.toFixed(1) });
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
  const boardHalfExtent = computeStageBoardHalfExtent(
    assets.meta.cellSize,
    "hotseat",
    1,
  );
  const sceneRuntime = createSceneRuntime(
    app,
    assets,
    PIECE_INSTANCES,
    boardHalfExtent,
  );

  loadingPhase.textContent = getRuntimeText("startup.preparing_physics");
  menuRuntime.piecePreviewServices = { renderer: sceneRuntime.renderer, assets };
  const physicsRuntime = await createPhysicsRuntime(
    assets.meta,
    PIECE_INSTANCES,
    boardHalfExtent,
  );
  assertBoardAgreement(
    sceneRuntime.boardTop,
    physicsRuntime.boardTop,
    sceneRuntime.boardHalfExtent,
    physicsRuntime.boardHalfExtent,
  );
  loadingPhase.textContent =
    getRuntimeText("startup.stabilizing_pieces");
  preSettlePhysics(physicsRuntime);
  resetPieceHitSoundTracking();
  synchronizePieceMeshes(sceneRuntime, physicsRuntime);
  loadingPanel.remove();
  const tuningRuntime = createTuningRuntime(app, physicsRuntime);
  const cardTuningRuntime = createCardTuningRuntime(
    app,
    GIANT_PAWN_SIZE_MULTIPLIER,
  );
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
    assets.meta.cellSize,
  );
  const runCardState = createRunCardState();
  const stageRunPoints = createStageRunPointState();
  let replayDevelopmentRuntime: ReplayDevelopmentRuntime | null =
    null;
  let gameModeRuntime: GameModeRuntime | null = null;
  let puzzleInputBlocked = false;
  let puzzleUI: PuzzleUI | null = null;
  let activePuzzle: PuzzleDefinition | null = null;
  let puzzleAttempt: PuzzleEvaluationInput | null = null;
  let puzzleQuestAttemptId: string | null = null;
  let puzzleTracker: PuzzlePhysicsTracker | null = null;
  let puzzleProgress = loadPuzzleProgress();
  backfillPuzzleMastery(progressStorage, puzzleProgress);
  let masteryRun: {
    eventId: string;
    mode: GameMode;
    stageNumber: number;
    eligible: boolean;
    enemyFalls: Set<string>;
    ownFalls: Set<string>;
    playerEnemyFalls: Set<string>;
    activePlayerLaunchId: string | null;
    automaticLaunchActive: boolean;
    banner: BannerMatch;
  } | null = null;
  let questRun: { runId: string; mode: GameMode; launchOrdinal: number; eligible: boolean } | null = null;
  let questResultBaseline: QuestResultBaseline = captureQuestResultBaseline(questStorage);
  let masteryNextBoardDebug = false;
  let recentMasteryItems: MasteryProgressItem[] = [];
  const addMasteryItems = (items: readonly MasteryProgressItem[]): void => {
    for (const item of items) {
      const prior = recentMasteryItems.find(existing => existing.medalId === item.medalId);
      if (prior) { prior.after = item.after; prior.achieved = item.achieved; }
      else recentMasteryItems.push({ ...item });
    }
  };
  const tuningIsDefault = (): boolean => {
    const defaults = createDefaultRuntimeTuningSettings();
    return Object.keys(defaults).every(key => tuningRuntime.settings[key as keyof typeof defaults] === defaults[key as keyof typeof defaults])
      && Object.keys(cardTuningRuntime.defaultSettings).every(key => cardTuningRuntime.settings[key as keyof typeof cardTuningRuntime.settings] === cardTuningRuntime.defaultSettings[key as keyof typeof cardTuningRuntime.defaultSettings]);
  };
  const markMasteryDebugMutation = (): void => { if (masteryRun) masteryRun.eligible = false; if (questRun) questRun.eligible = false; };
  tuningRuntime.panel.addEventListener("input", markMasteryDebugMutation);
  tuningRuntime.panel.addEventListener("click", markMasteryDebugMutation);
  cardTuningRuntime.panel.addEventListener("input", markMasteryDebugMutation);
  cardTuningRuntime.panel.addEventListener("click", markMasteryDebugMutation);
  progressStorage.subscribe((reset) => {
    if (reset) {
      metaRuntime.storage = progressStorage;
      metaRuntime.state = loadMetaState(metaRuntime.storage);
      puzzleProgress = loadPuzzleProgress();
      backfillPuzzleMastery(progressStorage, puzzleProgress);
      masteryRun = null;
      recentMasteryItems = [];
    }
    if (!progressStorage.ready || (reset && menuRuntime.visible)) {
      if (!progressStorage.ready) {
        menuRuntime.visible = true;
        menuRuntime.overlay.hidden = false;
        menuRuntime.closePveLobby?.();
      }
      renderMainMenu(menuRuntime);
    } else {
      const status = menuRuntime.overlay.querySelector<HTMLElement>("[data-progress-status]");
      if (status) status.textContent = progressStorage.status;
      const controls = menuRuntime.overlay.querySelector<HTMLElement>("[data-progress-controls]");
      if (controls) controls.hidden = !progressStorage.saveFailed && !progressStorage.masteryPending && !progressStorage.bannersPending;
    }
  });
  questStorage.subscribe(() => {
    if (menuRuntime.visible) renderMainMenu(menuRuntime);
  });
  let puzzleHintLevel: 0 | 1 | 2 = 0;
  let puzzleFinished = false;
  let onPuzzleLaunch: ((request: Parameters<typeof queueTurnLaunch>[1]) => void) | null = null;
  let onlineRuntime: OnlineRuntime | null = null;
  let onlineSelfTestRuntime: OnlineSelfTestRuntime | null =
    null;
  let activeMatchOpponent: { id: string; nickname: string; mmr: number } | null =
    null;
  let activeMyProfile: UserProfile | null = null;

  const recordOnlineMatchSettlement = async (matchWinner: MatchWinner): Promise<void> => {
    const sb = getSupabaseClient();
    const matchId = onlineRuntime?.matchId;
    const me = activeMyProfile;
    const opponent = activeMatchOpponent;
    const mySide = onlineRuntime?.mySide;
    const mode = activeOnlineMatchMode;
    if (!sb || !matchId || !me || !opponent || !mySide) return;
    const whiteId = mySide === "white" ? me.id : opponent.id;
    const blackId = mySide === "black" ? me.id : opponent.id;
    const winnerId = matchWinner === "draw" ? null : matchWinner === "white" ? whiteId : blackId;
    const wonByCurrentUser = winnerId === me.id;
    if (wonByCurrentUser && questStorage.owner === me.id) {
      try {
        const context = questStorage.captureContext();
        if (context) questStorage.capturePendingPvp(makePvpWinEvent(matchId, context.periods, context.occurredAt));
      }
      catch (error) { console.warn("Unable to capture pending quest PVP result", error); }
    } else {
      questStorage.discardPendingPvp(matchId);
    }
    const isCurrentResult = () => onlineRuntime?.matchId === matchId &&
      turnRuntime.phase === "match-over" && menuRuntime.userProfile?.id === me.id;
    const showStatus = (message: string, retry = false): void => {
      if (!isCurrentResult()) return;
      matchRuntime.resultDetails.hidden = false;
      let status = matchRuntime.resultDetails.querySelector<HTMLElement>("[data-online-settlement-status]");
      if (!status) { status = document.createElement("div"); status.dataset.onlineSettlementStatus = ""; matchRuntime.resultDetails.prepend(status); }
      status.replaceChildren(document.createTextNode(message));
      if (retry) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = getRuntimeText("online.settle_retry_btn");
        button.onclick = () => { button.disabled = true; void recordOnlineMatchSettlement(matchWinner); };
        status.appendChild(button);
      }
    };
    showStatus(getRuntimeText("online.settle_checking_opponent"));
    try {
      const { data: currentAuth } = await sb.auth.getSession();
      if (currentAuth.session?.user.id !== me.id) return;
      const result = await SupabaseMatchmaker.recordMatchResult(sb, {
        matchId, mode, winnerId, whitePlayerId: whiteId, blackPlayerId: blackId,
      });
      if (result.status === "pending") {
        showStatus(getRuntimeText("online.settle_waiting_opponent"), true);
        return;
      }
      if (wonByCurrentUser && questStorage.owner === me.id) questStorage.confirmPendingPvp(matchId);
      // 서버가 정산한 값을 읽는다. 로컬 Elo 계산이나 프로필 전적 쓰기는 하지 않는다.
      const { data } = await sb.auth.getSession();
      if (data.session?.user.id !== me.id || menuRuntime.userProfile?.id !== me.id) return;
      const profile = await getOrCreateUserProfile(sb);
      if (profile.id !== me.id || menuRuntime.userProfile?.id !== me.id) return;
      menuRuntime.userProfile = profile;
      if (activeMyProfile?.id === profile.id) activeMyProfile = profile;
      renderMainMenu(menuRuntime);
      const delta = mySide === "white" ? result.whiteDelta : result.blackDelta;
      const rating = mode === "strategy" ? profile.strategyMmr : profile.classicMmr;
      const previousRating = rating - delta;
      const levelChange = getTier(rating).level - getTier(previousRating).level;
      const promotion = levelChange === 0 ? "" : I18nManager.t(levelChange > 0 ? "tier.promoted" : "tier.demoted") + ": " + formatTier(previousRating) + " → ";
      showStatus(getRuntimeText("online.settle_opponent_info", {
        name: opponent.nickname,
        tier: promotion + formatTier(rating),
        delta: (delta > 0 ? "+" : "") + delta,
        progress: formatTierProgress(rating),
      }));
      if (isCurrentResult()) appendQuestResult(matchRuntime.resultDetails, questResultBaseline, questStorage, () => openQuestBook(app, questStorage));
    } catch (error) {
      console.warn("대전 정산 실패:", error);
      showStatus(getRuntimeText("online.settle_failed"), true);
    }
  };

  const handleTurnTimeout = (): void => {
    if (gameModeRuntime?.mode === "puzzle") return;
    if (turnRuntime.phase !== "ready") return;

    // 현재 턴인 진영의 살아있는 말 중 하나 찾기
    const myPieces = [...physicsRuntime.pieces.values()].filter(
      (p) => p.instance.side === turnRuntime.currentSide && !turnRuntime.pendingRemovalIds.has(p.instance.id),
    );
    if (myPieces.length === 0) return;

    const chosenPiece = myPieces[0];
    const trans = chosenPiece.body.translation();
    const forwardZ = turnRuntime.currentSide === "white" ? -1 : 1;

    const timeoutLaunchRequest = {
      pieceId: chosenPiece.instance.id,
      direction: new Vector3(0, 0, forwardZ),
      normalizedPower: 0.02,
      applicationPoint: new Vector3(trans.x, trans.y + 0.1, trans.z),
      speedMultiplier: 1,
    };

    if (masteryRun) { masteryRun.activePlayerLaunchId = null; masteryRun.automaticLaunchActive = true; masteryRun.banner.eligible = false; }
    if (gameModeRuntime?.mode === "online" && onlineRuntime) {
      onlineRuntime.queueLocalLaunch(timeoutLaunchRequest, "timeout");
    } else {
      queueTurnLaunch(turnRuntime, timeoutLaunchRequest);
    }
  };

  const playerBanners = createPlayerBanners(app, {
    getState: () => ({
      visible: !isMenuBlocking(menuRuntime) && gameModeRuntime !== null && !gameModeRuntime.switching && turnRuntime.phase !== "match-over",
      mode: gameModeRuntime?.mode ?? "hotseat", stage: gameModeRuntime?.stageNumber ?? 1,
      currentSide: turnRuntime.currentSide, mySide: onlineRuntime?.mySide ?? null,
      profile: menuRuntime.userProfile, opponent: activeMatchOpponent,
      rankedMode: activeOnlineMatchMode,
      opponentBannerTheme: onlineRuntime?.opponentBannerTheme,
      loggedIn: progressStorage.owner !== null && progressStorage.owner === menuRuntime.userProfile?.id,
    }),
    requestFriend: async (profileId, opponent) => {
      const client = getSupabaseClient();
      if (!client) return { success: false, error: "login_required" };
      const { data, error } = await client.auth.getSession();
      if (error || data.session?.user.id !== profileId || data.session.user.is_anonymous) {
        return { success: false, error: "login_required" };
      }
      return SocialService.sendFriendRequest(profileId, opponent.nickname, opponent.id);
    },
  });
  const turnHud = createTurnHud(app, turnRuntime, {
    getGameMode: () => gameModeRuntime?.mode ?? "hotseat",
    getMySide: () => onlineRuntime?.mySide ?? null,
    isMenuVisible: () => !menuRuntime.overlay.hidden,
    onTimeoutLaunch: handleTurnTimeout,
    getTrackedObjective: () => trackedMasteryText(progressStorage),
  });
  let appliedEnemyBuffStepScale =
    tuningRuntime.settings.enemyStageBuffScale;
  let appliedCardEffectScale =
    tuningRuntime.settings.cardEffectScale;
  let appliedCardTuningValues: CardTuningAppliedValues = {
    gameMode: "hotseat",
    weightGrade: 0,
    forceGrade: 0,
    sizeGrade: 0,
    boardWeightFraction: 0,
    liveForceFraction: 0,
    boardRegularSizeScale: 1,
    boardGiantPawnScale: null,
    spawnedPieceCount: physicsRuntime.pieces.size,
    proneStartActive: false,
  };
  let pendingCardTuningValues: CardTuningAppliedValues = {
    ...appliedCardTuningValues,
  };
  updateCardTuningAppliedValues(
    cardTuningRuntime,
    appliedCardTuningValues,
    pendingCardTuningValues,
  );
  const playerReadoutInstances = PIECE_TYPES.map((type) => {
    const instance = PIECE_INSTANCES.find(
      (candidate) =>
        candidate.side === "white" &&
        candidate.type === type,
    );
    if (instance === undefined) {
      throw new Error(`백 ${type} 적용값 기준 말을 찾지 못했습니다.`);
    }
    return instance;
  });
  const regularCardReadoutInstance =
    playerReadoutInstances.find(
      (instance) => instance.type !== "Pawn",
    );
  const pawnCardReadoutInstance =
    playerReadoutInstances.find(
      (instance) => instance.type === "Pawn",
    );
  if (
    regularCardReadoutInstance === undefined ||
    pawnCardReadoutInstance === undefined
  ) {
    throw new Error("카드 적용값 기준 백 일반 말과 폰을 찾지 못했습니다.");
  }
  let onlineConnectionBlocked = false;
  const disconnectOverlay = document.createElement("section");
  disconnectOverlay.className = "match-result-overlay";
  disconnectOverlay.hidden = true;
  disconnectOverlay.setAttribute("role", "dialog");
  disconnectOverlay.setAttribute("aria-modal", "true");
  disconnectOverlay.innerHTML = `
    <div class="match-result-panel">
      <p>${getRuntimeText("online.reconnect_overlay_title")}</p>
      <h1>${getRuntimeText("online.reconnect_overlay_disconnected")}</h1>
      <p data-online-reconnect-status>${getRuntimeText("online.reconnect_overlay_prompt")}</p>
      <div class="match-result-actions">
        <button type="button" data-online-reconnect>${getRuntimeText("online.reconnect_overlay_create_code")}</button>
        <button type="button" data-online-abandon>${getRuntimeText("online.reconnect_overlay_abandon")}</button>
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
    disconnectOverlay.querySelector(".match-result-panel > p")!.textContent = getRuntimeText("online.reconnect_overlay_title");
    disconnectOverlay.querySelector("h1")!.textContent = getRuntimeText("online.reconnect_overlay_disconnected");
    reconnectStatus.textContent = getRuntimeText("online.reconnect_overlay_prompt");
    reconnectButton.textContent = getRuntimeText("online.reconnect_overlay_create_code");
    abandonButton.textContent = getRuntimeText("online.reconnect_overlay_abandon");
    onlineConnectionBlocked = true;
    disconnectOverlay.hidden = false;
    reconnectButton.focus();
  };
  const hideDisconnectOverlay = (): void => {
    onlineConnectionBlocked = false;
    disconnectOverlay.hidden = true;
  };
  const onlineResignButton = { hidden: true };
  let readsAiTelegraphActive = (): boolean => false;
  const inputRuntime = createInputRuntime(
    sceneRuntime,
    physicsRuntime,
    aimRuntime,
    aimParametersRuntime,
    {
      isInputBlocked: () =>
        turnRuntime.phase === "match-over" ||
        puzzleInputBlocked ||
        puzzleUI?.blocking === true ||
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
      canKingSwap: (pieceId) => {
        if (gameModeRuntime?.mode === "puzzle") return false;
        if (turnRuntime.phase !== "ready") {
          return false;
        }
        const side = turnRuntime.currentSide;
        if (
          turnRuntime.kingSpecialUsed[side] ||
          turnRuntime.kingSwapUsed[side] ||
          turnRuntime.kingDefenseActive[side]
        ) {
          return false;
        }
        const binding = physicsRuntime.pieces.get(pieceId);
        if (binding?.instance.type !== "King" || binding.instance.side !== side) {
          return false;
        }
        if (gameModeRuntime?.mode === "stage" && side === "black") {
          return false;
        }
        if (gameModeRuntime?.mode === "online") {
          // ponytail: 온라인 특수기는 행동·복구 상태 동기화가 지원될 때 활성화한다.
          return false;
        }
        return true;
      },
      onKingSwap: (kingPieceId, targetPieceId) => {
        const swapped = executeKingSwap(turnRuntime, kingPieceId, targetPieceId);
        if (swapped) {
          playSoundEffect("power90");
          cancelInputInteraction(inputRuntime, true);
          selectPiece(inputRuntime, kingPieceId);
        }
      },
      onKingDefense: (kingPieceId) => {
        const defended = executeKingDefense(turnRuntime, kingPieceId);
        if (defended) {
          playSoundEffect("button");
          cancelInputInteraction(inputRuntime, true);
          selectPiece(inputRuntime, kingPieceId);
        }
      },
      queueLaunch: (request) => {
        const binding = physicsRuntime.pieces.get(request.pieceId);
        const gameMode = gameModeRuntime?.mode ?? "hotseat";
        let speedMultiplier = 1;
        if (gameMode === "stage") {
          const permanentForceBonus =
            binding?.instance.side === "white"
              ? computePermanentForceBonus(
                  metaRuntime.state.upgrades,
                  binding.instance.type,
                )
              : 0;
          speedMultiplier = computePlayerLaunchSpeedMultiplier(
            binding?.instance.side === "white" ? "stage" : "online",
            runCardState,
            permanentForceBonus,
            appliedCardEffectScale,
            createCardEffectTuning(cardTuningRuntime.settings),
          );
        } else if (gameMode === "online" && onlineRuntime && binding) {
          const deck =
            binding.instance.side === "white"
              ? onlineRuntime.whiteStrategyDeck
              : onlineRuntime.blackStrategyDeck;
          const forceStat = deck ? deck[binding.instance.type]?.force ?? 0 : 0;
          speedMultiplier = 1 + forceStat * STRATEGY_STAT_STEP;
        }
        const launchRequest = {
          ...request,
          speedMultiplier,
        };
        const accepted = gameMode === "online" &&
          onlineRuntime !== null
          ? onlineRuntime.queueLocalLaunch(launchRequest)
          : queueTurnLaunch(turnRuntime, launchRequest);
        if (accepted.accepted && binding?.instance.side === "white" && questRun &&
          ["stage", "tutorial", "puzzle"].includes(gameMode) && questRun.mode === gameMode) {
          if (!tuningIsDefault()) questRun.eligible = false;
          if (questRun.eligible && isQuestPieceType(binding.instance.type)) {
            questRun.launchOrdinal += 1;
            const context = questStorage.captureContext();
            if (context) questStorage.enqueue(makePieceLaunchEvent({ source: gameMode as "stage" | "tutorial" | "puzzle", runId: questRun.runId, launchOrdinal: questRun.launchOrdinal, pieceType: binding.instance.type }, context.periods, context.occurredAt));
          }
        }
        if (accepted.accepted && binding?.instance.side === "white" && masteryRun &&
          ["stage", "tutorial", "puzzle"].includes(gameMode) && masteryRun.mode === gameMode) {
          if (!tuningIsDefault()) masteryRun.eligible = false;
          masteryRun.automaticLaunchActive = false;
          const launchEventId = `${masteryRun.eventId}:L${turnRuntime.turnNumber}:${request.pieceId}`.slice(0, 96);
          masteryRun.activePlayerLaunchId = launchEventId;
          masteryRun.banner.launchType = binding.instance.type;
          if (masteryRun.eligible) addMasteryItems(recordMasteryLaunch(progressStorage, {
            eventId: launchEventId, pieceType: binding.instance.type,
          }).items);
        }
        if (accepted.accepted && gameMode === "puzzle") onPuzzleLaunch?.(launchRequest);
        return accepted;
      },
      onModeChanged: (mode) =>
        setTurnCameraMode(turnRuntime, mode),
    },
  );
  tuningRuntime.wakeAllHandler = () => {
    markMasteryDebugMutation();
    cancelInputInteraction(inputRuntime, true);
    wakeAllTurnPieces(turnRuntime);
  };
  setPieceRemovalHandler(turnRuntime, (pieceId) =>
    handleInputPieceRemoved(inputRuntime, pieceId),
  );
  turnRuntime.onPromotionReady = (pieceId, side, _choices, onSelect) => {
    playSoundEffect("power90");
    openPromotionModal(pieceId, side, onSelect, app);
  };
  turnRuntime.onPiecePromoted = (pieceId, newType) => {
    promotePieceBody(physicsRuntime, pieceId, newType, assets.meta);
    const stageOptions = {
      gameMode: gameModeRuntime?.mode ?? "hotseat",
      stageNumber: gameModeRuntime?.stageNumber ?? 1,
    };
    promotePieceMesh(sceneRuntime, assets, pieceId, newType, stageOptions);
    playSoundEffect("power90");
  };
  const aiRuntime = createAiRuntime(
    physicsRuntime,
    sceneRuntime,
    turnRuntime,
    assets.meta.cellSize,
    () => gameModeRuntime?.mode ?? "hotseat",
    () => gameModeRuntime?.stageNumber ?? 1,
    aimRuntime,
    () => undefined,
    () => appliedEnemyBuffStepScale,
  );
  readsAiTelegraphActive = () =>
    isAiTelegraphActive(aiRuntime);
  const computePendingCardTuningValues = (
    gameMode: GameMode,
    stageNumber: number,
  ): CardTuningAppliedValues => {
    const cardTuning = createCardEffectTuning(
      cardTuningRuntime.settings,
    );
    const cardEffectScale =
      gameMode === "stage"
        ? tuningRuntime.settings.cardEffectScale
        : CARD_EFFECT_SCALE;
    const stageOptions: StageSpawnOptions = {
      gameMode,
      stageNumber,
      runCards:
        gameMode === "stage" ? runCardState : undefined,
      permanentUpgrades:
        gameMode === "stage"
          ? metaRuntime.state.upgrades
          : undefined,
      enemyBuffStepScale:
        gameMode === "stage"
          ? tuningRuntime.settings.enemyStageBuffScale
          : undefined,
      cardEffectScale:
        gameMode === "stage" ? cardEffectScale : undefined,
      cardTuning,
    };
    const giantPawnActive = isGiantPawnCardActive(
      gameMode,
      runCardState,
      cardTuning,
    );
    return {
      gameMode,
      weightGrade: computeEffectiveGeneralCardGrade(
        gameMode,
        runCardState,
        "weight",
        cardTuning,
      ),
      forceGrade: computeEffectiveGeneralCardGrade(
        gameMode,
        runCardState,
        "force",
        cardTuning,
      ),
      sizeGrade: computeEffectiveGeneralCardGrade(
        gameMode,
        runCardState,
        "size",
        cardTuning,
      ),
      boardWeightFraction: computeTunedGeneralCardEffect(
        gameMode,
        runCardState,
        "weight",
        cardEffectScale,
        cardTuning,
      ),
      liveForceFraction: computeTunedGeneralCardEffect(
        gameMode,
        runCardState,
        "force",
        cardEffectScale,
        cardTuning,
      ),
      boardRegularSizeScale: computeStagePieceScale(
        regularCardReadoutInstance,
        assets.meta,
        stageOptions,
      ),
      boardGiantPawnScale: giantPawnActive
        ? computeStagePieceScale(
            pawnCardReadoutInstance,
            assets.meta,
            stageOptions,
          )
        : null,
      spawnedPieceCount: selectStageSpawnInstances(
        PIECE_INSTANCES,
        stageOptions,
      ).length,
      proneStartActive: isProneStartCardActive(
        gameMode,
        runCardState,
        cardTuning,
      ),
    };
  };
  const refreshCardTuningLiveValues = (): void => {
    const gameMode = appliedCardTuningValues.gameMode;
    const stageNumber =
      gameModeRuntime?.stageNumber ?? 1;
    const cardTuning = createCardEffectTuning(
      cardTuningRuntime.settings,
    );
    appliedCardTuningValues = {
      ...appliedCardTuningValues,
      gameMode,
      forceGrade: computeEffectiveGeneralCardGrade(
        gameMode,
        runCardState,
        "force",
        cardTuning,
      ),
      liveForceFraction: computeTunedGeneralCardEffect(
        gameMode,
        runCardState,
        "force",
        appliedCardEffectScale,
        cardTuning,
      ),
    };
    pendingCardTuningValues =
      computePendingCardTuningValues(gameMode, stageNumber);
    updateCardTuningAppliedValues(
      cardTuningRuntime,
      appliedCardTuningValues,
      pendingCardTuningValues,
    );
  };
  cardTuningRuntime.settingsChangedHandler =
    refreshCardTuningLiveValues;
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
      enemyBuffStepScale:
        baseOptions.gameMode === "stage"
          ? tuningRuntime.settings.enemyStageBuffScale
          : undefined,
      cardEffectScale:
        baseOptions.gameMode === "stage"
          ? tuningRuntime.settings.cardEffectScale
          : undefined,
      cardTuning: createCardEffectTuning(
        cardTuningRuntime.settings,
      ),
    };
    const boardPuzzle = stageOptions.gameMode === "puzzle" ? activePuzzle : null;
    const boardOptions: StageSpawnOptions = boardPuzzle
      ? boardPuzzle.boardTemplate === "basic"
        ? { gameMode: "puzzle", stageNumber: 1 }
        : { gameMode: "stage", stageNumber: boardPuzzle.boardStage }
      : stageOptions;
    const targetInstances = boardPuzzle
      ? boardPuzzle.pieces.map((piece, index) => ({
          id: piece.id, type: piece.type, side: piece.side,
          startingSquare: {
            file: (["a", "b", "c", "d", "e", "f", "g", "h"] as const)[index],
            rank: piece.side === "white" ? 2 as const : 7 as const,
          },
        }))
      : stageOptions.gameMode === "tutorial"
      ? tutorialManager.getStepPieces(stageOptions.stageNumber)
      : PIECE_INSTANCES;
    const spawnInstances = selectStageSpawnInstances(
      targetInstances,
      stageOptions,
    );
    const expectedPieceCount = spawnInstances.length;
    resetAiMatch(aiRuntime);
    lockInputForMatchOver(inputRuntime);
    const nextBoardHalfExtent = computeStageBoardHalfExtent(
      assets.meta.cellSize,
      boardOptions.gameMode,
      boardOptions.stageNumber,
    );
    rebuildPhysicsBoard(
      physicsRuntime,
      assets.meta,
      nextBoardHalfExtent,
      boardOptions,
    );
    rebuildSceneBoard(
      sceneRuntime,
      assets,
      nextBoardHalfExtent,
      boardOptions,
    );
    assertBoardAgreement(
      sceneRuntime.boardTop,
      physicsRuntime.boardTop,
      sceneRuntime.boardHalfExtent,
      physicsRuntime.boardHalfExtent,
    );
    resetPhysicsPieces(
      physicsRuntime,
      assets.meta,
      targetInstances,
      stageOptions,
    );
    resetScenePieces(
      sceneRuntime,
      assets,
      targetInstances,
      stageOptions,
    );
    reapplyTuningPhysicsSettings(tuningRuntime);
    if (boardPuzzle) {
      applyPuzzleSpawnDefinitions(boardPuzzle.pieces.map((piece) => ({
        pieceId: piece.id,
        normalizedX: piece.position.x,
        normalizedZ: piece.position.z,
        prone: piece.pose === "prone",
      })), { physicsRuntime, pieceMeshes: sceneRuntime.pieceMeshes, boardHalfExtent: nextBoardHalfExtent });
    }
    preSettlePhysics(physicsRuntime);
    resetPieceHitSoundTracking();
    synchronizePieceMeshes(sceneRuntime, physicsRuntime);
    resetTurnRuntime(turnRuntime);
    turnHud.reset();
    const runId = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? `match-${crypto.randomUUID()}` : `match-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    masteryRun = {
      eventId: runId,
      mode: stageOptions.gameMode,
      stageNumber: stageOptions.stageNumber,
      eligible: !masteryNextBoardDebug && tuningIsDefault(),
      enemyFalls: new Set(), ownFalls: new Set(), playerEnemyFalls: new Set(),
      activePlayerLaunchId: null, automaticLaunchActive: false,
      banner: createBannerMatch(progressStorage.owner, stageOptions.stageNumber,
        stageOptions.gameMode === "stage" && !masteryNextBoardDebug && tuningIsDefault(),
        [...physicsRuntime.pieces.values()].filter(p => p.instance.side === "white").length,
        [...physicsRuntime.pieces.values()].filter(p => p.instance.side === "black").length),
    };
    questRun = { runId: createQuestId(), mode: stageOptions.gameMode, launchOrdinal: 0, eligible: !masteryNextBoardDebug && tuningIsDefault() };
    questResultBaseline = captureQuestResultBaseline(questStorage);
    masteryNextBoardDebug = false;
    recentMasteryItems = [];
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
    appliedEnemyBuffStepScale =
      stageOptions.enemyBuffStepScale ??
      tuningRuntime.settings.enemyStageBuffScale;
    appliedCardEffectScale =
      stageOptions.gameMode === "stage"
        ? (stageOptions.cardEffectScale ??
          tuningRuntime.settings.cardEffectScale)
        : CARD_EFFECT_SCALE;
    const appliedCardTuning = stageOptions.cardTuning;
    if (appliedCardTuning === undefined) {
      throw new Error("보드에 적용할 카드 조절값이 없습니다.");
    }
    const giantPawnActive = isGiantPawnCardActive(
      stageOptions.gameMode,
      runCardState,
      appliedCardTuning,
    );
    const giantPawnBinding = giantPawnActive
      ? [...physicsRuntime.pieces.values()].find(
          (binding) =>
            binding.instance.side === "white" &&
            binding.instance.type === "Pawn",
        )
      : undefined;
    appliedCardTuningValues = {
      gameMode: stageOptions.gameMode,
      weightGrade: computeEffectiveGeneralCardGrade(
        stageOptions.gameMode,
        runCardState,
        "weight",
        appliedCardTuning,
      ),
      forceGrade: computeEffectiveGeneralCardGrade(
        stageOptions.gameMode,
        runCardState,
        "force",
        appliedCardTuning,
      ),
      sizeGrade: computeEffectiveGeneralCardGrade(
        stageOptions.gameMode,
        runCardState,
        "size",
        appliedCardTuning,
      ),
      boardWeightFraction: computeTunedGeneralCardEffect(
        stageOptions.gameMode,
        runCardState,
        "weight",
        appliedCardEffectScale,
        appliedCardTuning,
      ),
      liveForceFraction: computeTunedGeneralCardEffect(
        stageOptions.gameMode,
        runCardState,
        "force",
        appliedCardEffectScale,
        appliedCardTuning,
      ),
      boardRegularSizeScale: computeStagePieceScale(
        regularCardReadoutInstance,
        assets.meta,
        stageOptions,
      ),
      boardGiantPawnScale:
        giantPawnBinding?.uniformScale ?? null,
      spawnedPieceCount: physicsRuntime.pieces.size,
      proneStartActive: isProneStartCardActive(
        stageOptions.gameMode,
        runCardState,
        appliedCardTuning,
      ),
    };
    pendingCardTuningValues =
      computePendingCardTuningValues(
        stageOptions.gameMode,
        stageOptions.stageNumber,
      );
    updateCardTuningAppliedValues(
      cardTuningRuntime,
      appliedCardTuningValues,
      pendingCardTuningValues,
    );
    updateCardTuningStageNumber(
      cardTuningRuntime,
      stageOptions.stageNumber,
    );
    if (stageOptions.gameMode !== "stage") {
      updateTuningAppliedValues(tuningRuntime, {
        gameMode: stageOptions.gameMode,
        stageNumber: stageOptions.stageNumber,
        enemyWeightFraction: 0,
        enemyWeightSteps: 0,
        enemyForceFraction: 0,
        enemyForceSteps: 0,
        enemySizeFraction: 0,
        enemySizeSteps: 0,
        enemyPawnTier: "none",
        playerWeightFractions: [],
        playerForceFractions: [],
        playerSizeFraction: 0,
        playerSizeAtCap: false,
      });
    } else {
      const stageBuffs = computeStageBuffs(
        stageOptions.stageNumber,
      );
      const enemyStepValues = computeEnemyStageStepValues(
        stageOptions.enemyBuffStepScale,
      );
      const playerSizeInstance =
        playerReadoutInstances.find(
          (instance) => instance.type !== "Pawn",
        );
      if (playerSizeInstance === undefined) {
        throw new Error("백 일반 크기 적용값 기준 말을 찾지 못했습니다.");
      }
      const playerSizeScale = computeStagePieceScale(
        playerSizeInstance,
        assets.meta,
        stageOptions,
      );
      updateTuningAppliedValues(tuningRuntime, {
        gameMode: "stage",
        stageNumber: stageOptions.stageNumber,
        enemyWeightFraction:
          enemyStepValues.weightStep * stageBuffs.weightSteps,
        enemyWeightSteps: stageBuffs.weightSteps,
        enemyForceFraction:
          enemyStepValues.forceStep * stageBuffs.forceSteps,
        enemyForceSteps: stageBuffs.forceSteps,
        enemySizeFraction:
          computeEnemyStageSizeMultiplier(
            stageOptions.stageNumber,
            tuningRuntime.settings.enemyStageBuffScale,
          ) - 1,
        enemySizeSteps: stageBuffs.sizeSteps,
        enemyPawnTier: stageBuffs.pawnTier,
        playerWeightFractions: playerReadoutInstances.map(
          (instance) =>
            computeUpgradeWeightFraction(
              instance,
              stageOptions,
            ),
        ),
        playerForceFractions: playerReadoutInstances.map(
          (instance) =>
            computePlayerLaunchSpeedMultiplier(
              "stage",
              runCardState,
              computePermanentForceBonus(
                metaRuntime.state.upgrades,
                instance.type,
              ),
              stageOptions.cardEffectScale,
            ) - 1,
        ),
        playerSizeFraction: playerSizeScale - 1,
        playerSizeAtCap:
          Math.abs(
            playerSizeScale - PLAYER_MAX_SIZE_SCALE,
          ) < 1e-9,
      });
    }
    console.info(
      `[대국] 다시 시작 완료: 백 선공, 물리 ${physicsRuntime.pieces.size}/${expectedPieceCount}, 렌더 ${sceneRuntime.pieceMeshes.size}/${expectedPieceCount}, 수면 ${sleepingCount}/${expectedPieceCount}`,
    );
  };
  cardTuningRuntime.relayoutHandler = async (): Promise<void> => {
    masteryNextBoardDebug = true;
    markMasteryDebugMutation();
    if (gameModeRuntime === null) {
      throw new Error("현재 대전 모드가 준비되지 않았습니다.");
    }
    if (gameModeRuntime.switching) {
      throw new Error(
        "대전 모드 전환 중에는 현재 판을 다시 깔 수 없습니다.",
      );
    }
    await relayoutCurrentCardTuningBoard(
      () => ({
        gameMode: gameModeRuntime?.mode ?? "hotseat",
        stageNumber: gameModeRuntime?.stageNumber ?? 1,
        runCardsSignature: JSON.stringify(runCardState),
        permanentUpgradesSignature: JSON.stringify(
          metaRuntime.state.upgrades,
        ),
        points: metaRuntime.state.points,
        stageRunPointsSignature: JSON.stringify(stageRunPoints),
      }),
      async (gameMode, stageNumber) => {
        await resetBoard({ gameMode, stageNumber });
      },
    );
  };
  cardTuningRuntime.stageJumpHandler = async (
    targetStageNumber: number,
  ): Promise<void> => {
    masteryNextBoardDebug = true;
    markMasteryDebugMutation();
    if (gameModeRuntime === null) {
      throw new Error("현재 대전 모드가 준비되지 않았습니다.");
    }
    if (gameModeRuntime.switching) {
      throw new Error(
        "대전 모드 전환 중에는 스테이지를 이동할 수 없습니다.",
      );
    }
    await jumpCardTuningStage(
      targetStageNumber,
      () => ({
        gameMode: gameModeRuntime?.mode ?? "hotseat",
        stageNumber: gameModeRuntime?.stageNumber ?? 1,
        runCardsSignature: JSON.stringify(runCardState),
        permanentUpgradesSignature: JSON.stringify(
          metaRuntime.state.upgrades,
        ),
        points: metaRuntime.state.points,
        stageRunPointsSignature: JSON.stringify(stageRunPoints),
      }),
      (stageNumber) => {
        if (gameModeRuntime === null) {
          throw new Error("현재 대전 모드가 준비되지 않았습니다.");
        }
        setStageNumber(gameModeRuntime, stageNumber);
      },
      (lastClearedStage, startedAtStage) => {
        // Y 패널 점프만 정상 승리 정산의 직전 단계 기준을 맞추며 일반 진행은 기존 기록 함수를 유지한다.
        stageRunPoints.lastClearedStage = lastClearedStage;
        delete stageRunPoints.startedAtStage;
        if (startedAtStage !== undefined) stageRunPoints.startedAtStage = startedAtStage;
      },
      async (gameMode, stageNumber) => {
        await resetBoard({ gameMode, stageNumber });
      },
    );
  };
  gameModeRuntime = createGameModeRuntime(async (mode) => {
    const previousMode = gameModeRuntime?.mode ?? "hotseat";
    const previousCards = cloneRunCardState(runCardState);
    const previousRunPoints = { ...stageRunPoints };
    const nextRunPoints = createStageRunPointState(mode === "stage" ? gameModeRuntime?.stageNumber ?? 1 : 1);
    resetRunCardState(runCardState);
    delete stageRunPoints.startedAtStage;
    Object.assign(stageRunPoints, nextRunPoints);
    setTurnGameMode(turnRuntime, mode);
    setTuningGameMode(tuningRuntime, mode);
    setCardTuningGameMode(cardTuningRuntime, mode);
    if (mode === "puzzle") {
      applyPuzzleTuningDefaults(tuningRuntime);
      setPuzzleTuningLocked(tuningRuntime, true);
    }
    try {
      const stageNumber = gameModeRuntime?.stageNumber ?? 1;
      await resetBoard({ gameMode: mode, stageNumber });
    } catch (error: unknown) {
      restoreRunCardState(runCardState, previousCards);
      delete stageRunPoints.startedAtStage;
      Object.assign(stageRunPoints, previousRunPoints);
      setTurnGameMode(turnRuntime, previousMode);
      setTuningGameMode(tuningRuntime, previousMode);
      setCardTuningGameMode(cardTuningRuntime, previousMode);
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
  rematchButton.textContent = getRuntimeText("online.rematch_btn");
  rematchButton.hidden = true;
  const rematchCancelButton = document.createElement("button");
  rematchCancelButton.type = "button";
  rematchCancelButton.textContent = getRuntimeText("online.rematch_cancel_btn");
  rematchCancelButton.hidden = true;
  const rematchAcceptButton = document.createElement("button");
  rematchAcceptButton.type = "button";
  rematchAcceptButton.textContent = getRuntimeText("online.rematch_accept_btn");
  rematchAcceptButton.hidden = true;
  const rematchDeclineButton = document.createElement("button");
  rematchDeclineButton.type = "button";
  rematchDeclineButton.textContent = getRuntimeText("online.rematch_decline_btn");
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
    rematchCancelButton.textContent = getRuntimeText("online.rematch_cancel_btn");
    rematchAcceptButton.textContent = getRuntimeText("online.rematch_accept_btn");
    rematchDeclineButton.textContent = getRuntimeText("online.rematch_decline_btn");
    const showsOnlineResult =
      gameModeRuntime?.mode === "online" &&
      matchRuntime.winner !== null &&
      status?.connected === true;
    rematchButton.hidden = true;
    rematchCancelButton.hidden = true;
    rematchAcceptButton.hidden = true;
    rematchDeclineButton.hidden = true;
    rematchButton.disabled = false;
    rematchButton.textContent = getRuntimeText("online.rematch_btn");
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
      rematchButton.textContent = getRuntimeText("online.rematch_waiting_response");
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
    rematchStatusText.textContent = uiText("connectionHelp");
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

  turnRuntime.onMasterySettlement = (evidence) => {
    const run = masteryRun;
    if (!run || run.mode !== (gameModeRuntime?.mode ?? "hotseat")) return;
    if (!tuningIsDefault()) run.eligible = false;
    for (const piece of evidence.removedPieces) {
      if (piece.side === "white") run.ownFalls.add(piece.id);
      else if (!run.automaticLaunchActive) {
        run.enemyFalls.add(piece.id);
        if (evidence.launchingSide === "white") run.playerEnemyFalls.add(piece.id);
      }
    }
    if (run.eligible && !run.automaticLaunchActive && evidence.launchingSide === "white" &&
      run.activePlayerLaunchId && (run.mode === "stage" || run.mode === "puzzle")) {
      const fallenEnemies = evidence.removedPieces.filter(piece => piece.side === "black").map(piece => piece.id);
      if (fallenEnemies.length >= 2) addMasteryItems(recordMasteryDoubleOut(progressStorage, {
        eventId: run.activePlayerLaunchId, enemyPieceIds: fallenEnemies, fallCount: fallenEnemies.length,
      }).items);
    }
    settleBannerMatch(progressStorage, run.banner, {
      eventId: run.activePlayerLaunchId,
      enemyPieceIds: evidence.removedPieces.filter(piece => piece.side === "black").map(piece => `${run.eventId}:${piece.id}`),
      ownRemaining: [...physicsRuntime.pieces.values()].filter(p => p.instance.side === "white").length,
      enemyRemaining: [...physicsRuntime.pieces.values()].filter(p => p.instance.side === "black").length,
      playerLaunch: evidence.launchingSide === "white",
      eligible: run.eligible && run.mode === "stage" && !run.automaticLaunchActive,
    });
    run.activePlayerLaunchId = null;
    run.automaticLaunchActive = false;
  };

  turnRuntime.onTurnSettled = () => {
    if (gameModeRuntime?.mode === "tutorial") {
      const remainingBlack = [...physicsRuntime.pieces.values()].filter(
        (p) => p.instance.side === "black",
      );
      const hasCustomStrikePoint =
        turnRuntime.lastLaunchHasCustomStrike ||
        inputRuntime.aimParametersRuntime.strikePointOverride !== null;
      const checkResult = tutorialManager.checkStepClear(
        remainingBlack.length,
        remainingBlack.map((p) => ({ type: p.instance.type })),
        turnRuntime.lastLaunchHitOpponent,
        hasCustomStrikePoint,
      );

      if (checkResult.cleared) {
        void tutorialManager.handleStepSuccess();
      } else {
        if (checkResult.hint) {
          tutorialManager.showFailureHint(checkResult.hint);
        }
        setTimeout(() => {
          if (gameModeRuntime?.mode === "tutorial" && tutorialManager.isActive) {
            void resetBoard({
              gameMode: "tutorial",
              stageNumber: tutorialManager.currentStep,
            });
          }
        }, 1200);
      }
    }
  };

  setMatchOverHandler(turnRuntime, (winner) => {
    lockInputForMatchOver(inputRuntime);
    const gameMode = gameModeRuntime?.mode ?? "hotseat";
    if (gameMode === "tutorial") {
      return;
    }
    const completedStage = gameModeRuntime?.stageNumber ?? 1;
    if (gameMode === "stage" && winner === "white" && questRun) {
      if (!tuningIsDefault()) questRun.eligible = false;
      if (questRun.eligible) {
        const context = questStorage.captureContext();
        if (context) questStorage.enqueue(makePveWinEvent(questRun.runId, completedStage, context.periods, context.occurredAt));
      }
    }
    if (gameMode === "stage" && winner === "white" && masteryRun) {
      if (!tuningIsDefault()) masteryRun.eligible = false;
      if (masteryRun.eligible && masteryRun.enemyFalls.size > 0) addMasteryItems(recordMasteryPveVictory(progressStorage, {
        eventId: masteryRun.eventId,
        templateId: STAGE_TEMPLATE_IDS[completedStage] ?? `stage-${completedStage}:v1`,
        enemyPieceIds: [...masteryRun.enemyFalls],
        playerEnemyPieceIds: [...masteryRun.playerEnemyFalls],
        ownFallCount: masteryRun.ownFalls.size,
      }).items);
    }
    if (masteryRun) {
      masteryRun.banner.eligible &&= masteryRun.eligible && tuningIsDefault();
      finishBannerMatch(progressStorage, masteryRun.banner, masteryRun.eventId, gameMode === "stage" && winner === "white");
    }
    const openAllMastery = () => openMasteryBook(app, progressStorage, () => { void returnToMainMenu(menuRuntime); });
    if (gameMode === "stage") {
      if (winner === "white") {
        recordStageRunClear(stageRunPoints, completedStage);
        saveMaxClearedStage(metaRuntime.storage, completedStage);
      }
      const completedRun =
        winner === "white" &&
        completedStage === STAGE_RUN_LENGTH;
      if (winner === "black" || completedRun) {
        const payout = settleStageRunPoints(
          metaRuntime,
          stageRunPoints,
        );
        renderMainMenu(menuRuntime);
        menuRuntime.returnButton.hidden = true;
        showStageRunResult(
          matchRuntime,
          completedStage,
          payout,
          completedRun,
          () => returnToMainMenu(menuRuntime),
        );
        appendMasteryResult(matchRuntime.resultDetails, recentMasteryItems, openAllMastery);
        appendQuestResult(matchRuntime.resultDetails, questResultBaseline, questStorage, () => openQuestBook(app, questStorage));
        return;
      }
    }
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
      gameMode === "stage" &&
      winner === "white" &&
      shouldOfferStageClearCards(completedStage)
        ? drawUpgradeCards(
            completedStage,
            runCardState,
            tuningRuntime.settings.cardEffectScale,
          )
        : [];
    const selectUpgradeCard =
      gameMode === "stage" &&
      winner === "white" &&
      shouldOfferStageClearCards(completedStage)
        ? async (cardId: CardId): Promise<void> => {
            const previousStage =
              gameModeRuntime?.stageNumber ?? completedStage;
            const previousCards = cloneRunCardState(runCardState);
            applyCardPick(
              runCardState,
              cardId,
              tuningRuntime.settings.cardEffectScale,
            );
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
        : gameMode === "online"
          ? () => returnToMainMenu(menuRuntime)
          : null,
      gameMode === "online"
        ? onlineRuntime?.mySide ?? null
        : null,
    );
    if (gameMode === "stage") appendMasteryResult(matchRuntime.resultDetails, recentMasteryItems, openAllMastery);
    if (gameMode === "stage") appendQuestResult(matchRuntime.resultDetails, questResultBaseline, questStorage, () => openQuestBook(app, questStorage));
    if (gameMode === "online") {
      appendQuestResult(matchRuntime.resultDetails, questResultBaseline, questStorage, () => openQuestBook(app, questStorage));
      onlineResignButton.hidden = true;
      void recordOnlineMatchSettlement(winner);
      renderRematchControls(
        onlineRuntime?.getRematchStatus() ?? null,
      );
    }
    void AdManager.showBanner();
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
      (now, frameDelta) => {
        turnHud.update(now, frameDelta);
        playerBanners.update();
        if (activePuzzle && gameModeRuntime?.mode === "puzzle") {
          puzzleUI?.updateMarkers(activePuzzle.pieces.flatMap((piece) => {
            const binding = physicsRuntime.pieces.get(piece.id);
            if (!binding || (!piece.protected && !activePuzzle!.required.requiredFallIds.includes(piece.id))) return [];
            const position = binding.body.translation();
            const projected = new Vector3(position.x, position.y + 0.2, position.z).project(sceneRuntime.camera);
            if (projected.z < -1 || projected.z > 1) return [];
            return [{ id: piece.id, x: (projected.x + 1) / 2, y: (1 - projected.y) / 2,
              role: piece.protected ? "protect" as const : "target" as const, label: "" }];
          }));
        }
        onlineRuntime?.update(now);
        onlineSelfTestRuntime?.updatePeers(now);
      },
      () => onlineRuntime?.getDebugStatus() ?? null,
      () => onlineRuntime?.shouldStepPhysics() ?? true,
      () => onlineSelfTestRuntime?.stepPeers(),
    );
    gameLoopStarted = true;
  };
  startModeAction = async (
    mode,
    selectedStage,
    tutorialType = "basic",
  ): Promise<void> => {
    if (gameModeRuntime === null) {
      throw new Error("대전 모드 상태가 준비되지 않았습니다.");
    }
    void AdManager.hideBanner();
    if (mode === "online") {
      onlineSelfTestRuntime?.destroy();
      const { createOnlineRuntime, openOnlineLobby } = await import("./online");

      const session = await new Promise<{
        transport: OnlineTransport;
        mySide: PieceSide;
        matchId: string;
        rejoining: boolean;
        opponent: { id: string; nickname: string; mmr: number } | null;
        myProfile: UserProfile | null;
        finishLobby: () => void;
        strategyDeck?: import("./strategy-deck").StrategyDeck | null;
      }>((resolve, reject) => {
        const matchUiContainer = document.createElement("div");
        menuRuntime.overlay.appendChild(matchUiContainer);

        const matchUi = new SupabaseMatchUi(
          matchUiContainer,
          {
            onMatchStarted: async (
              transport,
              mySide,
              matchId,
              opponent,
              myProfile,
              strategyDeck,
              matchMode,
            ) => {
              activeOnlineMatchMode = matchMode ?? "classic";
              resolve({
                transport,
                mySide,
                matchId,
                rejoining: false,
                opponent,
                myProfile,
                strategyDeck,
                finishLobby: () => {
                  matchUi.destroy();
                  matchUiContainer.remove();
                },
              });
            },
            onOpenManualP2P: async () => {
              matchUiContainer.remove();
              try {
                const manualSession = await openOnlineLobby(menuRuntime.overlay);
                resolve({
                  transport: manualSession.link,
                  mySide: manualSession.mySide,
                  matchId: manualSession.matchId,
                  rejoining: manualSession.rejoining,
                  opponent: null,
                  myProfile: null,
                  strategyDeck: null,
                  finishLobby: manualSession.finishLobby,
                });
              } catch (err) {
                reject(err);
              }
            },
            onClose: () => {
              matchUiContainer.remove();
              reject(new Error("대국 로비를 닫았습니다."));
            },
          },
          menuRuntime.userProfile,
          menuRuntime.piecePreviewServices,
        );

        void matchUi.renderLobby();
      });

      activeMatchOpponent = session.opponent;
      activeMyProfile = session.myProfile;

      onlineRuntime?.close();
      onlineRuntime = createOnlineRuntime(
        session.transport,
        turnRuntime,
        aimRuntime,
        session.mySide,
        {
          onDisconnected: showDisconnectOverlay,
          onStrategyDecksReady: (whiteDeck, blackDeck) => {
            applyStrategyDecksToPhysics(physicsRuntime, whiteDeck, blackDeck);
          },
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
          onResigned: async (resignedSide) => {
            hideDisconnectOverlay();
            onlineResignButton.hidden = true;
            turnRuntime.phase = "match-over";
            lockInputForMatchOver(inputRuntime);
            const winner = resignedSide === "white" ? "black" : "white";

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
            appendQuestResult(matchRuntime.resultDetails, questResultBaseline, questStorage, () => openQuestBook(app, questStorage));
            renderRematchControls(
              onlineRuntime?.getRematchStatus() ?? null,
            );

            await recordOnlineMatchSettlement(winner);
            void AdManager.showBanner();
          },
        },
        {
          matchId: session.matchId,
          localStrategyDeck: session.strategyDeck,
          getLocalBannerTheme: () => getPlayerBannerTheme(progressStorage.owner !== null && progressStorage.owner === menuRuntime.userProfile?.id),
          resolveOpponentBanner: () => readOpponentBanner(activeMatchOpponent?.id, progressStorage.owner !== null),
          onLocalLaunchAccepted: (event) => {
            const type = physicsRuntime.pieces.get(event.pieceId)?.instance.type;
            if (event.side === session.mySide && isQuestPieceType(type) && tuningIsDefault()) {
              const context = questStorage.captureContext();
              if (context) questStorage.enqueue(makePieceLaunchEvent({ source: "online", matchId: event.matchId, turnIndex: event.turnIndex, pieceType: type }, context.periods, context.occurredAt));
            }
          },
        },
      );
      onlineResignButton.hidden = false;
      try {
        await switchGameMode(gameModeRuntime, "online", true);
        onlineRuntime.startMatch({ rejoining: session.rejoining });
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
    if (mode === "tutorial") {
      const step = selectedStage ?? 1;
      tutorialManager.start(step, tutorialType);
      if (step === 3) {
        switchInputMode(inputRuntime, "billiards");
      }
    } else {
      tutorialManager.stop();
    }
    await switchGameMode(gameModeRuntime, mode, true, mode === "stage" || mode === "tutorial" ? selectedStage ?? 1 : 1);
    ensureGameLoopStarted();
  };

  const startDirectFriendlyMatch = async (
    roomId: string,
    isHost: boolean,
    opponent: { id: string; nickname: string; mmr: number },
  ): Promise<void> => {
    const sb = getSupabaseClient();
    if (!sb || !menuRuntime.userProfile || !gameModeRuntime) return;

    onlineSelfTestRuntime?.destroy();
    void AdManager.hideBanner();
    void SocialService.updateMyStatus("in_game");

    const { createOnlineRuntime } = await import("./online");

    const session = await new Promise<{
      transport: OnlineTransport;
      mySide: PieceSide;
      matchId: string;
      opponent: { id: string; nickname: string; mmr: number };
    }>((resolve, reject) => {
      const matchmaker = new SupabaseMatchmaker(
        sb,
        menuRuntime.userProfile!,
        "classic",
      );

      void matchmaker.startDirectFriendlyMatch(
        roomId,
        isHost,
        opponent,
        (transport, mySide, matchId, opp) => {
          resolve({ transport, mySide, matchId, opponent: opp });
        },
        (err) => reject(err),
      );
    });

    activeMatchOpponent = session.opponent;
    activeMyProfile = menuRuntime.userProfile;
    activeOnlineMatchMode = "classic";

    onlineRuntime?.close();
    onlineRuntime = createOnlineRuntime(
      session.transport,
      turnRuntime,
      aimRuntime,
      session.mySide,
      {
        onDisconnected: showDisconnectOverlay,
        onStrategyDecksReady: (whiteDeck, blackDeck) => {
          applyStrategyDecksToPhysics(physicsRuntime, whiteDeck, blackDeck);
        },
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
        onResigned: async (resignedSide) => {
          hideDisconnectOverlay();
          onlineResignButton.hidden = true;
          turnRuntime.phase = "match-over";
          lockInputForMatchOver(inputRuntime);
          const winner = resignedSide === "white" ? "black" : "white";

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
          appendQuestResult(matchRuntime.resultDetails, questResultBaseline, questStorage, () => openQuestBook(app, questStorage));
          renderRematchControls(onlineRuntime?.getRematchStatus() ?? null);
          await recordOnlineMatchSettlement(winner);
          void SocialService.updateMyStatus("online");
          void AdManager.showBanner();
        },
      },
      {
        matchId: session.matchId,
        localStrategyDeck: null,
        getLocalBannerTheme: () => getPlayerBannerTheme(progressStorage.owner !== null && progressStorage.owner === menuRuntime.userProfile?.id),
        resolveOpponentBanner: () => readOpponentBanner(activeMatchOpponent?.id, progressStorage.owner !== null),
        onLocalLaunchAccepted: (event) => {
          const type = physicsRuntime.pieces.get(event.pieceId)?.instance.type;
          if (event.side === session.mySide && isQuestPieceType(type) && tuningIsDefault()) {
            const context = questStorage.captureContext();
            if (context) questStorage.enqueue(makePieceLaunchEvent({ source: "online", matchId: event.matchId, turnIndex: event.turnIndex, pieceType: type }, context.periods, context.occurredAt));
          }
        },
      },
    );

    onlineResignButton.hidden = false;
    await switchGameMode(gameModeRuntime, "online", true);
    onlineRuntime.startMatch({ rejoining: false });
    ensureGameLoopStarted();
    await onlineRuntime.waitUntilReady();
    hideMainMenuAfterModeStart(menuRuntime);
  };

  menuRuntime.onStartFriendlyMatch = async (friend, roomId, isHost) => {
    await startDirectFriendlyMatch(roomId, isHost, {
      id: friend.id,
      nickname: friend.nickname,
      mmr: friend.classicMmr ?? 1000,
    });
  };

  reconnectButton.addEventListener("click", () => {
    if (onlineRuntime === null) {
      return;
    }
    reconnectButton.disabled = true;
    reconnectStatus.textContent = getRuntimeText("online.reconnect_exchanging_codes");
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
          reconnectStatus.textContent = getRuntimeText("online.reconnect_syncing_state");
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
        reconnectStatus.textContent = uiText("connectionHelp");
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
    void SocialService.updateMyStatus("online");
    onlineSelfTestRuntime?.destroy();
    onlineRuntime?.close();
    onlineRuntime = null;
    onlineResignButton.hidden = true;
    renderRematchControls(null);
    hideDisconnectOverlay();
    tutorialManager.stop();
    puzzleUI?.hide();
    puzzleTracker = null;
    puzzleAttempt = null;
    activePuzzle = null;
    puzzleInputBlocked = false;
    menuRuntime.returnButton.style.display = "";
    setPuzzleTuningLocked(tuningRuntime, false);
    restoreLocalTuningSettings(tuningRuntime);
    await switchGameMode(gameModeRuntime, "hotseat", true);
    hideMatchResult(matchRuntime);
    void AdManager.showBanner();
  };
  confirmAbandonAction = async (): Promise<void> => {
    if (gameModeRuntime === null) {
      throw new Error("대전 모드 상태가 준비되지 않았습니다.");
    }
    tutorialManager.stop();
    if (gameModeRuntime.mode === "online" && onlineRuntime) {
      onlineRuntime.resign();
    }
    if (gameModeRuntime.mode !== "stage") {
      await returnToMainMenu(menuRuntime);
      return;
    }
    const abandonedStage = gameModeRuntime.stageNumber;
    discardStageRunPoints(stageRunPoints);
    turnRuntime.phase = "match-over";
    lockInputForMatchOver(inputRuntime);
    menuRuntime.returnButton.hidden = true;
    void AdManager.showBanner();
    showStageRunResult(
      matchRuntime,
      abandonedStage,
      0,
      false,
      () => returnToMainMenu(menuRuntime),
    );
    appendMasteryResult(matchRuntime.resultDetails, recentMasteryItems, () => {
      openMasteryBook(app, progressStorage, () => { void returnToMainMenu(menuRuntime); });
    });
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
      boardHalfExtent,
      async preparePageForSelfTest(): Promise<void> {
        if (gameModeRuntime === null) {
          throw new Error(
            "온라인 셀프테스트 대전 모드가 준비되지 않았습니다.",
          );
        }
        // 화면 보드는 fixed-step 시계만 제공하며 실제 셀프테스트 물리에는 참여하지 않는다.
        onlineRuntime?.close();
        onlineRuntime = null;
        await switchGameMode(
          gameModeRuntime,
          "online",
          true,
        );
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
  const updatePuzzleHud = (): void => {
    if (!activePuzzle || !puzzleAttempt) return;
    puzzleUI?.update({
      shotsRemaining: Math.max(0, activePuzzle.launchBudget - puzzleAttempt.launches),
      hintLevel: puzzleHintLevel,
    });
  };
  const startPuzzle = async (id: string): Promise<void> => {
    if (!progressStorage.ready) return;
    const puzzle = getPuzzleDefinition(id);
    if (!puzzle || !isPuzzleUnlocked(puzzleProgress, puzzle)) return;
    puzzleInputBlocked = true;
    puzzleTracker = null;
    activePuzzle = puzzle;
    puzzleHintLevel = 0;
    puzzleFinished = false;
    puzzleQuestAttemptId = createQuestId();
    puzzleAttempt = {
      launches: 0, fallenIDs: [], contactEvents: [], protectedContactIDs: [],
      holeOutIDs: [], wallDestroyedCounts: {}, customHitUsed: false, rookShots: [],
    };
    applyPuzzleTuningDefaults(tuningRuntime);
    setPuzzleTuningLocked(tuningRuntime, true);
    try {
      await startModeAction!("puzzle");
      hideMainMenuAfterModeStart(menuRuntime);
      menuRuntime.returnButton.hidden = true;
      menuRuntime.returnButton.style.display = "none";
      hideMatchResult(matchRuntime);
      switchInputMode(inputRuntime, "billiards");
      const firstPlayer = puzzle.pieces.find((piece) => piece.side === "white");
      if (firstPlayer) selectPiece(inputRuntime, firstPlayer.id);
      puzzleTracker = new PuzzlePhysicsTracker(physicsRuntime);
      puzzleUI?.showPlaying(id, { shotsRemaining: puzzle.launchBudget, hintLevel: 0 });
    } catch (error) {
      console.error("퍼즐 시작 실패", error);
      await returnToMainMenu(menuRuntime);
      puzzleUI?.showResult(id, {
        success: false, objectiveMet: false, goldMet: false, medal: 0,
        failureCode: "data-error",
      });
    } finally {
      puzzleInputBlocked = false;
    }
  };
  const showPuzzleLibrary = async (): Promise<void> => {
    if (!progressStorage.ready) return;
    if (gameModeRuntime?.mode === "puzzle") await returnToMainMenu(menuRuntime);
    await AdManager.hideBanner();
    puzzleUI?.showLibrary();
  };
  puzzleUI = new PuzzleUI(app, {
    puzzles: PUZZLE_CATALOG.map((puzzle, index) => ({
      id: puzzle.puzzleId, index: index + 1, chapter: puzzle.chapter,
      board: puzzle.pieces.map((piece) => ({
        id: piece.id, type: piece.type, color: piece.side,
        x: (piece.position.x + 1) / 2, y: (piece.position.z + 1) / 2,
        rotation: piece.pose === "prone" ? 90 : 0,
      })),
    })),
    progress: () => ({
      clearedIds: PUZZLE_CATALOG.filter((puzzle) => (getPuzzleProgress(puzzleProgress, puzzle.puzzleId, puzzle.revision)?.bestMedal ?? 0) > 0).map((puzzle) => puzzle.puzzleId),
      medals: Object.fromEntries(PUZZLE_CATALOG.map((puzzle) => [puzzle.puzzleId, getPuzzleProgress(puzzleProgress, puzzle.puzzleId, puzzle.revision)?.bestMedal ?? 0])),
    }),
    onStart: startPuzzle,
    onRetry: startPuzzle,
    onHint: (_id, level) => { puzzleHintLevel = Math.max(puzzleHintLevel, level) as 1 | 2; updatePuzzleHud(); },
    onLibrary: () => { void showPuzzleLibrary().catch((error) => console.error("퍼즐 목록 복귀 실패", error)); },
    onExit: () => {
      if (gameModeRuntime?.mode === "puzzle") void returnToMainMenu(menuRuntime).catch((error) => console.error("퍼즐 종료 실패", error));
      else {
        puzzleUI?.hide();
        void AdManager.showBanner();
      }
    },
  });
  menuRuntime.onOpenPuzzles = () => { void showPuzzleLibrary().catch((error) => console.error("퍼즐 목록 열기 실패", error)); };
  onPuzzleLaunch = (request) => {
    if (!activePuzzle || !puzzleAttempt || !puzzleTracker || puzzleFinished) return;
    puzzleAttempt.launches += 1;
    const binding = physicsRuntime.pieces.get(request.pieceId);
    const position = binding?.body.worldCom();
    const customHit = !!position && Math.hypot(request.applicationPoint.x - position.x, request.applicationPoint.z - position.z) > 0.04;
    puzzleAttempt.customHitUsed ||= customHit;
    if (binding?.instance.type === "Rook") {
      puzzleAttempt.rookShots = [...(puzzleAttempt.rookShots ?? []), { pieceId: request.pieceId, centerHit: !customHit, power: request.normalizedPower }];
    }
    puzzleTracker.beginShot(request.pieceId, turnRuntime.physicsStepNumber, activePuzzle.pieces.filter((piece) => piece.protected).map((piece) => piece.id));
    updatePuzzleHud();
  };
  turnRuntime.onPuzzlePhysicsStep = (step) => {
    if (!activePuzzle || !puzzleAttempt || !puzzleTracker || puzzleAttempt.launches === 0 || puzzleFinished) return;
    const evidence = puzzleTracker.sample(step);
    appendPuzzlePhysicsEvidence(puzzleAttempt, {
      ...evidence,
      pieceContacts: evidence.pieceContacts.filter((event) => event.step === step),
      protectedPieceContacts: evidence.protectedPieceContacts.filter((event) => event.step === step),
      wallContacts: evidence.wallContacts.filter((event) => event.step === step),
      destroyedWalls: evidence.destroyedWalls.filter((event) => event.step === step),
      fallenPieces: evidence.fallenPieces.filter((event) => event.step === step),
    }, activePuzzle);
  };
  turnRuntime.onPuzzleSettled = () => {
    if (!activePuzzle || !puzzleAttempt || !puzzleTracker || puzzleFinished) return;
    puzzleAttempt.settled = true;
    const evaluation = evaluatePuzzleAttempt(activePuzzle, puzzleAttempt);
    if (evaluation.status === "success" || evaluation.status === "failed") {
      puzzleFinished = true;
      turnRuntime.phase = "match-over";
      lockInputForMatchOver(inputRuntime);
      puzzleProgress = applyPuzzleEvaluation(puzzleProgress, activePuzzle, evaluation, {
        launches: puzzleAttempt.launches, hintsUsedThisAttempt: puzzleHintLevel,
        customHitUsed: puzzleAttempt.customHitUsed,
      }).store;
      savePuzzleProgress(puzzleProgress);
      if (evaluation.status === "success" && masteryRun) {
        if (!tuningIsDefault()) masteryRun.eligible = false;
        if (masteryRun.eligible) addMasteryItems(recordMasteryPuzzle(progressStorage, {
          eventId: `${masteryRun.eventId}:puzzle`.slice(0, 96), puzzleId: activePuzzle.puzzleId,
          revision: activePuzzle.revision, gold: evaluation.medal === 3,
        }).items);
      }
      if (evaluation.status === "success" && questRun && puzzleQuestAttemptId && isQuestPuzzleId(activePuzzle.puzzleId)) {
        if (!tuningIsDefault()) questRun.eligible = false;
        if (questRun.eligible && (evaluation.medal === 1 || evaluation.medal === 2 || evaluation.medal === 3)) {
          const context = questStorage.captureContext();
          if (context) questStorage.enqueue(makePuzzleClearEvent(puzzleQuestAttemptId, activePuzzle.puzzleId, activePuzzle.revision, evaluation.medal, context.periods, context.occurredAt));
        }
      }
      puzzleUI?.showResult(activePuzzle.puzzleId, {
        success: evaluation.status === "success", objectiveMet: evaluation.requiredComplete,
        goldMet: evaluation.medal === 3, medal: evaluation.medal,
        failureCode: evaluation.failureReasons[0]?.code,
      });
      const puzzleResultCard = app.querySelector<HTMLElement>(".puzzle-ui-result-card");
      if (puzzleResultCard) appendMasteryResult(puzzleResultCard, recentMasteryItems, () => {
        openMasteryBook(app, progressStorage, () => { void showPuzzleLibrary(); });
      });
      if (puzzleResultCard) appendQuestResult(puzzleResultCard, questResultBaseline, questStorage, () => {
        openQuestBook(app, questStorage);
      });
    } else {
      const nextPlayer = activePuzzle.pieces.find((piece) => piece.side === "white" && physicsRuntime.pieces.has(piece.id));
      if (nextPlayer) selectPiece(inputRuntime, nextPlayer.id);
      updatePuzzleHud();
    }
  };
  setMainMenuReady(menuRuntime, true);
  tutorialManager.init(
    metaRuntime,
    async (nextStep) => {
      if (gameModeRuntime !== null) {
        setStageNumber(gameModeRuntime, nextStep);
        await resetBoard({
          gameMode: "tutorial",
          stageNumber: nextStep,
        });
        if (nextStep === 3) {
          switchInputMode(inputRuntime, "billiards");
        }
      }
    },
    async () => {
      await returnToMainMenu(menuRuntime);
    },
  );
  await AdManager.init();
  await AdManager.showBanner();

  if (menuRuntime.userProfile) {
    SocialService.init(menuRuntime.userProfile, (challenge) => {
      openChallengeReceivedModal(challenge, {
        onAccept: (req) => {
          void startDirectFriendlyMatch(req.roomId, false, {
            id: req.challengerId,
            nickname: req.challengerNickname,
            mmr: req.challengerMmr,
          });
        },
        onReject: () => {},
      });
    });
  }
}

void bootstrap().catch((error: unknown) => {
  const fullError =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(fullError);
  app.innerHTML = `
    <section class="error-panel" role="alert">
      <h1>${getRuntimeText("startup.init_failed")}</h1>
      <pre></pre>
    </section>
  `;
  const errorText = app.querySelector<HTMLPreElement>(".error-panel pre");
  if (errorText !== null) {
    errorText.textContent = uiText("connectionHelp");
  }
});
