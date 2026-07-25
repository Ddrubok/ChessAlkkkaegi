import "./style.css";
import { createAimRuntime } from "./aim";
import { createAimParametersRuntime } from "./aimparams";
import { loadChessAssets } from "./assets";
import { deriveBoardHalfExtent } from "./config";
import {
  cancelInputInteraction,
  createInputRuntime,
  handleInputPieceRemoved,
} from "./input";
import { PIECE_INSTANCES } from "./layout";
import { startGameLoop } from "./loop";
import {
  createPhysicsRuntime,
  preSettlePhysics,
} from "./physics";
import {
  createSceneRuntime,
  synchronizePieceMeshes,
} from "./scene";
import { createTuningRuntime } from "./tuning";
import {
  canSelectTurnPiece,
  createTurnRuntime,
  queueTurnLaunch,
  setPieceRemovalHandler,
  setTurnCameraMode,
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
  app.innerHTML = `
    <section class="loading-panel" role="status" aria-live="polite">
      <p>ChessAlkkagi 에셋을 불러오는 중입니다…</p>
    </section>
  `;
  const loadingPanel = app.querySelector<HTMLElement>(".loading-panel");
  if (loadingPanel === null) {
    throw new Error("로딩 상태 요소를 만들지 못했습니다.");
  }

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
  const inputRuntime = createInputRuntime(
    sceneRuntime,
    physicsRuntime,
    aimRuntime,
    aimParametersRuntime,
    {
      canSelectPiece: (pieceId) =>
        canSelectTurnPiece(turnRuntime, pieceId),
      isCameraRotating: () =>
        turnRuntime.phase === "camera-rotating",
      queueLaunch: (request) =>
        queueTurnLaunch(turnRuntime, request),
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
  startGameLoop(
    sceneRuntime,
    physicsRuntime,
    aimRuntime,
    inputRuntime,
    turnRuntime,
    tuningRuntime,
    boardHalfExtent,
  );
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
