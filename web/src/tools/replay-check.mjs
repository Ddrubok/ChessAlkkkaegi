import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Mesh, Scene, Vector3 } from "three";
import { createServer } from "vite";

const webRoot = fileURLToPath(new URL("../..", import.meta.url));
const vite = await createServer({
  root: webRoot,
  configFile: false,
  logLevel: "error",
  appType: "custom",
  server: { middlewareMode: true },
});

/**
 * 조건이 거짓이면 검증 이름과 실제 수치를 포함해 즉시 중단한다.
 */
function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * 실제 물리 말마다 turn.ts가 요구하는 최소 비렌더 메시 연결을 만든다.
 */
function createHeadlessSceneRuntime(physicsRuntime) {
  const scene = new Scene();
  const pieceMeshes = new Map();
  for (const binding of physicsRuntime.pieces.values()) {
    const mesh = new Mesh();
    mesh.name = binding.instance.id;
    scene.add(mesh);
    pieceMeshes.set(binding.instance.id, mesh);
  }
  return {
    scene,
    pieceMeshes,
    // OrbitControls가 없으면 기존 턴 경로가 카메라 애니메이션을 생략한다.
    controls: { enabled: true },
  };
}

/**
 * 헤더 원본과 같은 실제 스폰 옵션으로 기록용 보드를 준비한다.
 */
async function createRecordingRuntime(
  modules,
  meta,
  source,
) {
  const stageOptions =
    source.gameMode === "stage"
      ? {
          gameMode: "stage",
          stageNumber: source.stageNumber,
          runCards: source.runCards,
          permanentUpgrades: source.permanentUpgrades,
        }
      : {
          gameMode: "hotseat",
          stageNumber: 1,
        };
  const physicsRuntime =
    await modules.physics.createPhysicsRuntime(
      meta,
      modules.layout.PIECE_INSTANCES,
      modules.config.deriveBoardHalfExtent(meta.cellSize),
      stageOptions,
    );
  modules.physics.preSettlePhysics(physicsRuntime);
  const sceneRuntime =
    createHeadlessSceneRuntime(physicsRuntime);
  const turnRuntime = modules.turn.createTurnRuntime(
    physicsRuntime,
    sceneRuntime,
    modules.tuning.createDefaultRuntimeTuningSettings(),
  );
  turnRuntime.currentSide = source.initialSide;
  modules.turn.setTurnGameMode(
    turnRuntime,
    source.gameMode,
  );
  const recorder = modules.replay.createReplayRecorder(
    turnRuntime,
    source,
  );
  return {
    physicsRuntime,
    sceneRuntime,
    turnRuntime,
    recorder,
    stageOptions,
  };
}

/**
 * 실제 정착·낙하 제거·승자 경로가 끝날 때까지 고정 스텝을 진행한다.
 */
function settleTurn(modules, runtime) {
  const maximumSteps = Math.ceil(
    (modules.config.MAX_SETTLE_SECONDS * 2) /
      modules.config.FIXED_STEP,
  );
  let steps = 0;
  while (
    steps < maximumSteps &&
    runtime.turnRuntime.phase !== "ready" &&
    runtime.turnRuntime.phase !== "match-over"
  ) {
    modules.turn.applyPendingLaunchBeforeStep(
      runtime.turnRuntime,
    );
    runtime.physicsRuntime.world.step();
    modules.turn.updateTurnAfterStep(
      runtime.turnRuntime,
      modules.config.FIXED_STEP,
    );
    steps += 1;
  }
  if (
    runtime.turnRuntime.phase !== "ready" &&
    runtime.turnRuntime.phase !== "match-over"
  ) {
    throw new Error(
      `스크립트 턴이 ${maximumSteps} fixed step 안에 정착하지 못했습니다.`,
    );
  }
  return steps;
}

/**
 * 현재 진영의 살아 있는 말을 id 순으로 골라 보드 중심 쪽으로 약하게 발사한다.
 */
async function recordScriptedTurn(
  modules,
  runtime,
  turnIndex,
) {
  const candidates = [
    ...runtime.physicsRuntime.pieces.values(),
  ]
    .filter(
      (binding) =>
        binding.instance.side ===
        runtime.turnRuntime.currentSide,
    )
    .sort((left, right) =>
      left.instance.id < right.instance.id
        ? -1
        : left.instance.id > right.instance.id
          ? 1
          : 0,
    );
  const binding = candidates[turnIndex % candidates.length];
  if (binding === undefined) {
    throw new Error(
      `${turnIndex}번 턴에 발사할 ${runtime.turnRuntime.currentSide} 말이 없습니다.`,
    );
  }
  const translation = binding.body.translation();
  const direction = new Vector3(
    -translation.x,
    0,
    -translation.z,
  );
  if (direction.lengthSq() < 1e-12) {
    direction.set(
      0,
      0,
      binding.instance.side === "white" ? 1 : -1,
    );
  } else {
    direction.normalize();
  }
  let speedMultiplier = 1;
  if (runtime.stageOptions.gameMode === "stage") {
    if (binding.instance.side === "white") {
      const permanentBonus =
        modules.meta.computePermanentForceBonus(
          runtime.stageOptions.permanentUpgrades,
          binding.instance.type,
        );
      speedMultiplier =
        modules.cards.computePlayerLaunchSpeedMultiplier(
          "stage",
          runtime.stageOptions.runCards,
          permanentBonus,
        );
    } else {
      speedMultiplier =
        modules.stage.computeStageAiSpeedMultiplier(
          runtime.stageOptions,
        );
    }
  }
  const queued = modules.turn.queueTurnLaunch(
    runtime.turnRuntime,
    {
      pieceId: binding.instance.id,
      direction,
      normalizedPower: 0.08,
      applicationPoint: binding.body.worldCom(),
      speedMultiplier,
    },
  );
  assertCondition(
    queued.accepted,
    `${turnIndex}번 기록 발사가 거절됐습니다: ${queued.reason}`,
  );
  const steps = settleTurn(modules, runtime);
  assertCondition(
    runtime.turnRuntime.phase !== "match-over",
    `${turnIndex}번 약한 기록 발사 뒤 대국이 예상보다 일찍 끝났습니다.`,
  );
  await modules.replay.readReplayRecording(
    runtime.recorder,
  );
  return steps;
}

/**
 * 벽 재생 사례가 지정 말·방향·세기를 실제 recorder와 발사 경로로 기록하게 한다.
 */
async function recordDirectedTurn(
  modules,
  runtime,
  pieceId,
  direction,
  normalizedPower,
) {
  const binding =
    runtime.physicsRuntime.pieces.get(pieceId);
  assertCondition(
    binding !== undefined,
    `지정 기록 말 ${pieceId}가 없습니다.`,
  );
  assertCondition(
    binding.instance.side ===
      runtime.turnRuntime.currentSide,
    `${pieceId}의 진영 ${binding.instance.side}이 현재 턴 ${runtime.turnRuntime.currentSide}과 다릅니다.`,
  );
  let speedMultiplier = 1;
  if (runtime.stageOptions.gameMode === "stage") {
    if (binding.instance.side === "white") {
      const permanentBonus =
        modules.meta.computePermanentForceBonus(
          runtime.stageOptions.permanentUpgrades,
          binding.instance.type,
        );
      speedMultiplier =
        modules.cards.computePlayerLaunchSpeedMultiplier(
          "stage",
          runtime.stageOptions.runCards,
          permanentBonus,
        );
    } else {
      speedMultiplier =
        modules.stage.computeStageAiSpeedMultiplier(
          runtime.stageOptions,
        );
    }
  }
  const queued = modules.turn.queueTurnLaunch(
    runtime.turnRuntime,
    {
      pieceId,
      direction,
      normalizedPower,
      applicationPoint: binding.body.worldCom(),
      speedMultiplier,
    },
  );
  assertCondition(
    queued.accepted,
    `${pieceId} 지정 기록 발사가 거절됐습니다: ${queued.reason}`,
  );
  const steps = settleTurn(modules, runtime);
  assertCondition(
    runtime.turnRuntime.phase !== "match-over",
    `${pieceId} 지정 기록 발사 뒤 대국이 예상보다 일찍 끝났습니다.`,
  );
  await modules.replay.readReplayRecording(
    runtime.recorder,
  );
  return steps;
}

/**
 * 백 Rook이 남쪽 조각에 반사된 뒤 다시 접촉해 파괴하는 스테이지 3 기록을 만든다.
 */
async function recordStageThreeWallDestruction(
  modules,
  meta,
  source,
) {
  const runtime = await createRecordingRuntime(
    modules,
    meta,
    source,
  );
  const wallId = "wall-south-1";
  const settleSteps = [];
  settleSteps.push(
    await recordDirectedTurn(
      modules,
      runtime,
      "white-rook-h1",
      new Vector3(0.3, 0, -1).normalize(),
      0.18,
    ),
  );
  assertCondition(
    !runtime.physicsRuntime.breakableWalls.has(wallId) &&
      runtime.physicsRuntime.destroyedBreakableWallIds.has(
        wallId,
      ),
    `${wallId}가 Rook의 분리 후 재접촉 두 번째 타격 뒤 파괴되지 않았습니다.`,
  );
  const recording =
    await modules.replay.readReplayRecording(
      runtime.recorder,
    );
  assertCondition(
    recording.turns.length === 1,
    `벽 파괴 기록이 1턴이 아니라 ${recording.turns.length}턴입니다.`,
  );
  return { recording, settleSteps, wallId };
}

/**
 * 지정한 헤더 원본으로 10턴을 실제 recorder에 기록한다.
 */
async function recordTenTurns(modules, meta, source) {
  const runtime = await createRecordingRuntime(
    modules,
    meta,
    source,
  );
  const settleSteps = [];
  for (let turnIndex = 0; turnIndex < 10; turnIndex += 1) {
    settleSteps.push(
      await recordScriptedTurn(
        modules,
        runtime,
        turnIndex,
      ),
    );
  }
  const recording =
    await modules.replay.readReplayRecording(
      runtime.recorder,
    );
  assertCondition(
    recording.turns.length === 10,
    `기록된 턴이 10개가 아니라 ${recording.turns.length}개입니다.`,
  );
  return { recording, settleSteps };
}

try {
  const [
    cards,
    config,
    layout,
    metaModule,
    physics,
    replay,
    stage,
    tuning,
    turn,
  ] = await Promise.all([
    vite.ssrLoadModule("/src/cards.ts"),
    vite.ssrLoadModule("/src/config.ts"),
    vite.ssrLoadModule("/src/layout.ts"),
    vite.ssrLoadModule("/src/meta.ts"),
    vite.ssrLoadModule("/src/physics.ts"),
    vite.ssrLoadModule("/src/replay.ts"),
    vite.ssrLoadModule("/src/stage.ts"),
    vite.ssrLoadModule("/src/tuning.ts"),
    vite.ssrLoadModule("/src/turn.ts"),
  ]);
  const modules = {
    cards,
    config,
    layout,
    meta: metaModule,
    physics,
    replay,
    stage,
    tuning,
    turn,
  };
  const meta = JSON.parse(
    await readFile(
      new URL(
        "../../public/assets/chess-set.meta.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );

  const hotseatSource = {
    gameMode: "hotseat",
    initialSide: "white",
  };
  const hotseat = await recordTenTurns(
    modules,
    meta,
    hotseatSource,
  );
  const hotseatReplay = await replay.replayRecording(
    meta,
    hotseat.recording,
  );
  assertCondition(
    hotseatReplay.matched &&
      hotseatReplay.turns.length === 10,
    `핫시트 재생 불일치: ${JSON.stringify(hotseatReplay)}`,
  );
  console.log(
    `[통과 a] hotseat 10턴 기록→재생: hashes=10/10, settleSteps=${hotseat.settleSteps.join(",")}`,
  );

  const runCards = cards.createRunCardState();
  cards.applyCardPick(runCards, "force");
  const permanentUpgrades =
    metaModule.createDefaultPermanentUpgrades();
  permanentUpgrades.pieces.Pawn.basic.force = 2;
  permanentUpgrades.pieces.Pawn.basic.weight = 1;
  const stageSource = {
    gameMode: "stage",
    initialSide: "white",
    stageNumber: 3,
    runCards,
    permanentUpgrades,
  };
  const stageRecording = await recordTenTurns(
    modules,
    meta,
    stageSource,
  );
  assertCondition(
    stageRecording.recording.header.stage?.activeCardIds.join(
      ",",
    ) === "force" &&
      stageRecording.recording.header.stage
        .permanentUpgrades.pieces.Pawn.basic.force === 2 &&
      stageRecording.recording.header.stage
        .permanentUpgrades.pieces.Pawn.basic.weight === 1,
    `스테이지 헤더 강화 복원이 올바르지 않습니다: ${JSON.stringify(stageRecording.recording.header)}`,
  );
  const stageReplay = await replay.replayRecording(
    meta,
    stageRecording.recording,
  );
  assertCondition(
    stageReplay.matched &&
      stageReplay.turns.length === 10,
    `스테이지 재생 불일치: ${JSON.stringify(stageReplay)}`,
  );
  console.log(
    `[통과 b] stage3 force 카드+Pawn 영구 강화 10턴: hashes=10/10, activeCards=${stageRecording.recording.header.stage.activeCardIds.join(",")}, Pawn=${JSON.stringify(stageRecording.recording.header.stage.permanentUpgrades.pieces.Pawn)}`,
  );

  const wallRecording =
    await recordStageThreeWallDestruction(
      modules,
      meta,
      stageSource,
    );
  const wallReplay = await replay.replayRecording(
    meta,
    wallRecording.recording,
  );
  assertCondition(
    wallReplay.matched &&
      wallReplay.turns.length === 1,
    `스테이지 3 벽 파괴 재생 불일치: ${JSON.stringify(wallReplay)}`,
  );
  console.log(
    `[통과 c] stage3 벽 2회 접촉·파괴 1턴 기록→재생: wall=${wallRecording.wallId}, hashes=1/1, settleSteps=${wallRecording.settleSteps.join(",")}`,
  );

  const tampered = replay.deserializeRecording(
    replay.serializeRecording(hotseat.recording),
  );
  const tamperedTurnIndex = 3;
  tampered.turns[tamperedTurnIndex].normalizedPower += 0.1;
  const tamperedReplay = await replay.replayRecording(
    meta,
    tampered,
  );
  assertCondition(
    !tamperedReplay.matched &&
      tamperedReplay.firstMismatchTurn ===
        tamperedTurnIndex,
    `세기 변조가 ${tamperedTurnIndex}번 턴에서 잡히지 않았습니다: ${JSON.stringify(tamperedReplay)}`,
  );
  console.log(
    `[통과 d] power 변조 감지: expectedTurn=${tamperedTurnIndex}, firstMismatch=${tamperedReplay.firstMismatchTurn}`,
  );

  const compactTurn = replay.toCompactTurn(
    hotseat.recording.turns[0],
  );
  const compactJson = JSON.stringify(compactTurn);
  const compactBytes =
    new TextEncoder().encode(compactJson).byteLength;
  assertCondition(
    compactBytes > 0,
    "compact turn JSON 크기가 0바이트입니다.",
  );
  console.log(
    `[통과 e] compact turn payload=${compactBytes} bytes, json=${compactJson}`,
  );
} catch (error) {
  const fullError =
    error instanceof Error
      ? (error.stack ?? error.message)
      : String(error);
  console.error(fullError);
  process.exitCode = 1;
} finally {
  await vite.close();
}
