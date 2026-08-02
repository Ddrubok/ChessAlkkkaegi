import { Box3, MathUtils } from "three";
import {
  updateAiRuntime,
  type AiRuntime,
} from "./ai";
import { updateAimVisuals, type AimRuntime } from "./aim";
import {
  FIXED_STEP,
  MAX_FRAME_DELTA,
  MAX_STEPS_PER_FRAME,
  PIECE_TYPES,
} from "./config";
import {
  isInputCameraTransitioning,
  updateInputRuntime,
  type InputRuntime,
} from "./input";
import type { GameModeRuntime } from "./game-mode";
import type {
  PhysicsRuntime,
  PieceBodyBinding,
} from "./physics";
import {
  synchronizePieceMeshes,
  type SceneRuntime,
} from "./scene";
import { scanLivePieceHitSounds } from "./sound";
import {
  verifyTuningAfterStep,
  type TuningRuntime,
} from "./tuning";
import {
  applyPendingLaunchBeforeStep,
  collectGroundedPieceIds,
  countRemainingPieces,
  updateTurnAfterStep,
  updateTurnCamera,
  wakeAllTurnPieces,
  type TurnRuntime,
} from "./turn";

interface RuntimeMetrics {
  sleepingCount: number;
  maxDisplacement: number;
  maxTiltDegrees: number;
  maxLinearSpeed: number;
  maxAngularSpeed: number;
  minBodyOriginY: number;
  groundedCount: number;
  airborneCount: number;
  outsideBoardCount: number;
  maxRenderSyncError: number;
  numericallyHealthy: boolean;
}

export interface OnlineLoopDebugStatus {
  // 이 브라우저가 조작하는 온라인 진영이다.
  mySide: "white" | "black";
  // 실제 해시 불일치로 스냅샷 복구를 수행하거나 제공한 횟수다.
  desyncCount: number;
  // 연결·동기화의 마지막 가시적 사건이다.
  lastEvent: string;
}

/**
 * 쿼터니언으로 회전한 local up과 world up의 사이각을 구해 흑 말의 yaw를 제외한다.
 */
function measureTiltDegrees(binding: PieceBodyBinding): number {
  const rotation = binding.body.rotation();
  const worldUpDot = MathUtils.clamp(
    1 - 2 * (rotation.x * rotation.x + rotation.z * rotation.z),
    -1,
    1,
  );
  return Math.acos(worldUpDot) * (180 / Math.PI);
}

/**
 * 위치·회전·속도의 모든 성분이 유한한지 확인해 물리 발산을 즉시 드러낸다.
 */
function isBodyNumericallyHealthy(binding: PieceBodyBinding): boolean {
  const translation = binding.body.translation();
  const rotation = binding.body.rotation();
  const linearVelocity = binding.body.linvel();
  const angularVelocity = binding.body.angvel();
  return [
    translation.x,
    translation.y,
    translation.z,
    rotation.x,
    rotation.y,
    rotation.z,
    rotation.w,
    linearVelocity.x,
    linearVelocity.y,
    linearVelocity.z,
    angularVelocity.x,
    angularVelocity.y,
    angularVelocity.z,
  ].every(Number.isFinite);
}

/**
 * 이동·기울기·수면 수치와 보드 이탈 여부를 같은 프레임에서 집계한다.
 */
function collectMetrics(
  sceneRuntime: SceneRuntime,
  physicsRuntime: PhysicsRuntime,
  turnRuntime: TurnRuntime,
  boardHalfExtent: number,
  maxRenderSyncError: number,
): RuntimeMetrics {
  let sleepingCount = 0;
  let maxDisplacement = 0;
  let maxTiltDegrees = 0;
  let maxLinearSpeed = 0;
  let maxAngularSpeed = 0;
  let minBodyOriginY = Number.POSITIVE_INFINITY;
  let outsideBoardCount = 0;
  let numericallyHealthy = true;
  const worldBounds = new Box3();
  const groundedPieceIds = collectGroundedPieceIds(turnRuntime);

  for (const binding of physicsRuntime.pieces.values()) {
    const translation = binding.body.translation();
    if (binding.body.isSleeping()) {
      sleepingCount += 1;
    }
    maxDisplacement = Math.max(
      maxDisplacement,
      Math.hypot(
        translation.x - binding.spawnTranslation.x,
        translation.y - binding.spawnTranslation.y,
        translation.z - binding.spawnTranslation.z,
      ),
    );
    maxTiltDegrees = Math.max(
      maxTiltDegrees,
      measureTiltDegrees(binding),
    );
    const linearVelocity = binding.body.linvel();
    const angularVelocity = binding.body.angvel();
    maxLinearSpeed = Math.max(
      maxLinearSpeed,
      Math.hypot(
        linearVelocity.x,
        linearVelocity.y,
        linearVelocity.z,
      ),
    );
    maxAngularSpeed = Math.max(
      maxAngularSpeed,
      Math.hypot(
        angularVelocity.x,
        angularVelocity.y,
        angularVelocity.z,
      ),
    );
    minBodyOriginY = Math.min(minBodyOriginY, translation.y);
    numericallyHealthy =
      numericallyHealthy && isBodyNumericallyHealthy(binding);

    const mesh = sceneRuntime.pieceMeshes.get(binding.instance.id);
    const localBounds = mesh?.geometry.boundingBox;
    if (
      mesh === undefined ||
      localBounds === null ||
      localBounds === undefined
    ) {
      throw new Error(
        `${binding.instance.id}의 월드 판정용 렌더 AABB가 없습니다.`,
      );
    }
    worldBounds.copy(localBounds).applyMatrix4(mesh.matrixWorld);
    if (
      worldBounds.min.x < -boardHalfExtent ||
      worldBounds.max.x > boardHalfExtent ||
      worldBounds.min.z < -boardHalfExtent ||
      worldBounds.max.z > boardHalfExtent
    ) {
      outsideBoardCount += 1;
    }
  }

  return {
    sleepingCount,
    maxDisplacement,
    maxTiltDegrees,
    maxLinearSpeed,
    maxAngularSpeed,
    minBodyOriginY:
      minBodyOriginY === Number.POSITIVE_INFINITY ? 0 : minBodyOriginY,
    groundedCount: groundedPieceIds.size,
    airborneCount: physicsRuntime.pieces.size - groundedPieceIds.size,
    outsideBoardCount,
    maxRenderSyncError,
    numericallyHealthy,
  };
}

/**
 * 종류별 Rapier 질량과 로컬 무게중심을 고정 순서의 디버그 문자열로 만든다.
 */
function formatMassProperties(physicsRuntime: PhysicsRuntime): string {
  return PIECE_TYPES.map((type) => {
    const properties = physicsRuntime.massProperties.get(type);
    if (properties === undefined) {
      return `${type}: 질량 정보 없음`;
    }
    const center = properties.localCom;
    return `${type}: mass ${properties.mass.toFixed(5)}, COM (${center.x.toFixed(5)}, ${center.y.toFixed(5)}, ${center.z.toFixed(5)})`;
  }).join("\n");
}

/**
 * 고정 step 물리, 턴 판정, 렌더 동기화와 디버그 표시를 RAF 루프에서 관리한다.
 */
export function startGameLoop(
  sceneRuntime: SceneRuntime,
  physicsRuntime: PhysicsRuntime,
  aimRuntime: AimRuntime,
  inputRuntime: InputRuntime,
  turnRuntime: TurnRuntime,
  aiRuntime: AiRuntime,
  gameModeRuntime: GameModeRuntime,
  tuningRuntime: TuningRuntime,
  updateOnlineRuntime: (now: number) => void = () => {},
  readOnlineDebugStatus: () =>
    | OnlineLoopDebugStatus
    | null = () => null,
  shouldStepPhysics: () => boolean = () => true,
  stepSecondaryOnlineRuntime: () => void = () => {},
): void {
  const overlay = document.createElement("pre");
  overlay.className = "debug-overlay";
  overlay.setAttribute("aria-live", "polite");
  overlay.setAttribute("role", "button");
  overlay.setAttribute("aria-expanded", "false");
  overlay.tabIndex = 0;
  // 계측 표시는 ?tune=1 개발 세션에서만 화면에 붙인다. 일반 플레이 화면에는 나타나지 않는다.
  if (new URLSearchParams(window.location.search).get("tune") === "1") {
    sceneRuntime.renderer.domElement.parentElement?.append(overlay);
  }

  let lastFrameTime: number | null = null;
  let accumulator = 0;
  let elapsedSimulatedSeconds = 0;
  let droppedSimulatedSeconds = 0;
  let accumulatorOverflowCount = 0;
  let fpsWindowStart = performance.now();
  let fpsFrameCount = 0;
  let fps = 0;
  let lastOverlayUpdate = 0;
  let initialSettleDuration: number | null = 0;
  let latestResettleDuration: number | null = null;
  let settleAttemptStartedAt = 0;
  let waitingForSettle = false;
  let numericalFailureLogged = false;
  let overlayExpanded = false;
  let overlaySummaryText = "계측 준비 중 · 눌러서 상세 보기";
  let overlayFullText = overlaySummaryText;
  const massText = formatMassProperties(physicsRuntime);

  /**
   * 접힌 한 줄과 전체 계측을 같은 요소에서 전환해 모바일 판 영역을 보존한다.
   */
  const renderOverlay = (): void => {
    overlay.classList.toggle("is-expanded", overlayExpanded);
    overlay.setAttribute("aria-expanded", String(overlayExpanded));
    overlay.setAttribute(
      "aria-label",
      overlayExpanded
        ? "디버그 계측 접기"
        : "디버그 계측 펼치기",
    );
    overlay.textContent =
      overlayExpanded ? overlayFullText : overlaySummaryText;
  };
  const toggleOverlay = (): void => {
    overlayExpanded = !overlayExpanded;
    renderOverlay();
  };
  overlay.addEventListener("click", toggleOverlay);
  overlay.addEventListener("keydown", (event) => {
    if (event.code === "Enter" || event.code === "Space") {
      event.preventDefault();
      toggleOverlay();
    }
  });
  renderOverlay();

  /**
   * WASD 시점과 충돌하지 않도록 개발 중 R 키로 전원을 깨워 재수면 시간을 측정한다.
   */
  const handleForceWake = (event: KeyboardEvent): void => {
    if (
      event.code !== "KeyR" ||
      event.repeat ||
      turnRuntime.phase !== "ready"
    ) {
      return;
    }
    if (!shouldStepPhysics()) {
      console.info(
        "[물리] 온라인 발사 대기 중에는 solver 이력을 보존하므로 R 기상 계측을 실행하지 않습니다.",
      );
      return;
    }
    wakeAllTurnPieces(turnRuntime);
    settleAttemptStartedAt = elapsedSimulatedSeconds;
    latestResettleDuration = null;
    waitingForSettle = true;
    console.info(
      "[물리] R 키로 살아 있는 말을 깨우고 재수면 측정을 시작했습니다.",
    );
  };
  if (import.meta.env.DEV) {
    window.addEventListener("keydown", handleForceWake);
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      // 백그라운드 체류 시간은 플레이 시간이 아니므로 복귀 뒤 첫 프레임을 새 워밍업 기준으로 삼는다.
      lastFrameTime = null;
      accumulator = 0;
      fpsFrameCount = 0;
    }
  });

  /**
   * 실제 렌더 프레임마다 필요한 fixed step만 진행하고 최신 물리 자세를 화면에 반영한다.
   */
  const frame = (now: number): void => {
    if (lastFrameTime === null) {
      const maxRenderSyncError = synchronizePieceMeshes(
        sceneRuntime,
        physicsRuntime,
      );
      updateTurnCamera(turnRuntime, now);
      updateAiRuntime(aiRuntime, now);
      updateOnlineRuntime(now);
      updateInputRuntime(inputRuntime, now);
      if (
        turnRuntime.phase !== "camera-rotating" &&
        !isInputCameraTransitioning(inputRuntime)
      ) {
        sceneRuntime.controls.update();
      }
      updateAimVisuals(aimRuntime, physicsRuntime.pieces, now);
      collectMetrics(
        sceneRuntime,
        physicsRuntime,
        turnRuntime,
        sceneRuntime.boardHalfExtent,
        maxRenderSyncError,
      );
      sceneRuntime.renderer.render(
        sceneRuntime.scene,
        sceneRuntime.camera,
      );
      // 초기화부터 첫 RAF까지의 지연은 시뮬레이션하지 않고 이 렌더가 끝난 시각부터 측정을 시작한다.
      const timingStart = performance.now();
      lastFrameTime = timingStart;
      fpsWindowStart = timingStart;
      requestAnimationFrame(frame);
      return;
    }
    const rawFrameDelta = Math.max((now - lastFrameTime) / 1000, 0);
    const frameDelta = Math.min(rawFrameDelta, MAX_FRAME_DELTA);
    lastFrameTime = now;
    if (rawFrameDelta > MAX_FRAME_DELTA) {
      droppedSimulatedSeconds +=
        (rawFrameDelta - MAX_FRAME_DELTA) *
        tuningRuntime.settings.timeScale;
    }
    accumulator += frameDelta * tuningRuntime.settings.timeScale;

    let stepCount = 0;
    while (
      accumulator >= FIXED_STEP &&
      stepCount < MAX_STEPS_PER_FRAME
    ) {
      const stepsPrimaryPhysics = shouldStepPhysics();
      if (stepsPrimaryPhysics) {
        applyPendingLaunchBeforeStep(turnRuntime);
        physicsRuntime.world.step();
        // 사전 정착과 분리된 live 루프에서만 접촉을 읽어 물리 결과를 바꾸지 않고 충돌음을 낸다.
        scanLivePieceHitSounds(physicsRuntime, now);
        verifyTuningAfterStep(tuningRuntime);
      }
      accumulator -= FIXED_STEP;
      elapsedSimulatedSeconds += FIXED_STEP;
      stepCount += 1;

      if (stepsPrimaryPhysics) {
        // 낙하 제거가 정지 판정보다 먼저 일어나도록 턴 갱신을 실제 물리 step 직후에만 호출한다.
        updateTurnAfterStep(turnRuntime, FIXED_STEP);
      }
      // 단일 페이지 온라인 셀프테스트에서만 씬 없는 두 피어의 개별 step 허용 여부를 갱신한다.
      stepSecondaryOnlineRuntime();
      if (
        stepsPrimaryPhysics &&
        waitingForSettle &&
        [...physicsRuntime.pieces.values()].every((binding) =>
          binding.body.isSleeping(),
        )
      ) {
        const settleDuration =
          elapsedSimulatedSeconds - settleAttemptStartedAt;
        waitingForSettle = false;
        if (initialSettleDuration === null) {
          initialSettleDuration = settleDuration;
          console.info(
            `[물리] 최초 전원 수면 시간: ${settleDuration.toFixed(3)} 시뮬레이션 초`,
          );
        } else {
          latestResettleDuration = settleDuration;
          console.info(
            `[물리] R 기상 뒤 전원 재수면 시간: ${settleDuration.toFixed(3)} 시뮬레이션 초`,
          );
        }
      }
    }
    if (
      stepCount === MAX_STEPS_PER_FRAME &&
      accumulator >= FIXED_STEP
    ) {
      // 멈춤 뒤 시간 빚을 이월하면 연쇄 과부하로 물리가 폭주하므로 남은 시간은 의도적으로 버린다.
      droppedSimulatedSeconds += accumulator;
      accumulatorOverflowCount += 1;
      accumulator = 0;
    }

    const maxRenderSyncError = synchronizePieceMeshes(
      sceneRuntime,
      physicsRuntime,
    );
    updateTurnCamera(turnRuntime, now);
    updateAiRuntime(aiRuntime, now);
    updateOnlineRuntime(now);
    updateInputRuntime(inputRuntime, now);
    if (
      turnRuntime.phase !== "camera-rotating" &&
      !isInputCameraTransitioning(inputRuntime)
    ) {
      sceneRuntime.controls.update();
    }
    updateAimVisuals(aimRuntime, physicsRuntime.pieces, now);
    const metrics = collectMetrics(
      sceneRuntime,
      physicsRuntime,
      turnRuntime,
      sceneRuntime.boardHalfExtent,
      maxRenderSyncError,
    );
    sceneRuntime.renderer.render(
      sceneRuntime.scene,
      sceneRuntime.camera,
    );

    fpsFrameCount += 1;
    const fpsWindowDuration = now - fpsWindowStart;
    if (fpsWindowDuration >= 500) {
      fps = (fpsFrameCount * 1000) / fpsWindowDuration;
      fpsFrameCount = 0;
      fpsWindowStart = now;
    }

    if (!metrics.numericallyHealthy && !numericalFailureLogged) {
      numericalFailureLogged = true;
      console.error(
        "물리 바디에서 유한하지 않은 위치·회전·속도를 감지했습니다.",
      );
    }

    if (now - lastOverlayUpdate >= 100) {
      const remaining = countRemainingPieces(turnRuntime);
      const selectedId = aimRuntime.selectedPieceId ?? "없음";
      const turnLabel =
        turnRuntime.currentSide === "white" ? "백" : "흑";
      const modeLabel =
        inputRuntime.mode === "classic" ? "클래식" : "당구";
      const onlineDebug = readOnlineDebugStatus();
      const matchLabel =
        gameModeRuntime.mode === "stage"
          ? `스테이지${gameModeRuntime.stageNumber}`
          : gameModeRuntime.mode === "online"
            ? `온라인·${onlineDebug?.mySide === "black" ? "흑" : "백"}`
            : "2인";
      overlaySummaryText =
        `${matchLabel}·${turnLabel}·${modeLabel}·수면${metrics.sleepingCount}/${physicsRuntime.pieces.size}` +
        `·OF${accumulatorOverflowCount}` +
        (onlineDebug === null
          ? ""
          : `·DSN${onlineDebug.desyncCount}`) +
        "·상세";
      overlayFullText = [
        `FPS: ${fps.toFixed(1)}`,
        `대전 모드: ${gameModeRuntime.mode} / ${matchLabel}`,
        `현재 턴: ${turnRuntime.currentSide} / ${turnRuntime.phase}`,
        `입력 모드·상태: ${inputRuntime.mode} / ${inputRuntime.state} / ${selectedId}`,
        `시간 배속: ${tuningRuntime.settings.timeScale.toFixed(3)}×`,
        `마지막 발사: power ${(turnRuntime.lastLaunchPower * 100).toFixed(1)}%, initial speed ${turnRuntime.lastLaunchInitialSpeed.toFixed(4)}`,
        `남은 말: white ${remaining.white}, black ${remaining.black}`,
        `동적 바디: ${physicsRuntime.pieces.size}`,
        `수면 바디: ${metrics.sleepingCount}`,
        `최대 이동량: ${metrics.maxDisplacement.toFixed(6)}`,
        `최대 기울기: ${metrics.maxTiltDegrees.toFixed(3)}°`,
        `최대 선속도: ${metrics.maxLinearSpeed.toFixed(6)}`,
        `최대 각속도: ${metrics.maxAngularSpeed.toFixed(6)}`,
        `접지/공중: ${metrics.groundedCount}/${metrics.airborneCount}`,
        `강제 정착 발동: ${turnRuntime.forcedSettleCount}회`,
        `최소 바디 원점 y: ${metrics.minBodyOriginY.toFixed(6)}`,
        `시뮬레이션 경과: ${elapsedSimulatedSeconds.toFixed(3)}초`,
        `버린 시뮬레이션 시간: ${droppedSimulatedSeconds.toFixed(6)}초`,
        `accumulator overflow: ${accumulatorOverflowCount}`,
        `최초 전원 수면: ${initialSettleDuration === null ? "측정 중" : `${initialSettleDuration.toFixed(3)}초`}`,
        `최근 W 재수면: ${waitingForSettle && initialSettleDuration !== null ? "측정 중" : latestResettleDuration === null ? "기록 없음" : `${latestResettleDuration.toFixed(3)}초`}`,
        `판 밖 AABB: ${metrics.outsideBoardCount}`,
        `렌더 동기화 오차: ${metrics.maxRenderSyncError.toExponential(2)}`,
        `수치 건전성: ${metrics.numericallyHealthy ? "정상" : "오류"}`,
        ...(onlineDebug === null
          ? []
          : [
              `온라인 내 진영: ${onlineDebug.mySide}`,
              `온라인 어긋남 복구: ${onlineDebug.desyncCount}회`,
              `온라인 마지막 사건: ${onlineDebug.lastEvent}`,
            ]),
        "",
        massText,
      ].join("\n");
      renderOverlay();
      lastOverlayUpdate = now;
    }
    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}
