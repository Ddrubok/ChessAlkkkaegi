import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Mesh, Scene } from "three";
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
 * 조건이 거짓이면 실제 측정값을 포함한 한국어 오류로 즉시 중단한다.
 */
function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * 실제 낙하 제거 경로를 렌더러 없이 실행할 최소 씬 연결을 만든다.
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
    breakableWallMeshes: new Map(),
    controls: { enabled: true },
  };
}

/**
 * 말 하나를 결정적인 자세와 속도로 옮겨 벽 접촉 실험을 준비한다.
 */
function placePiece(binding, translation, velocity) {
  binding.body.setTranslation(translation, true);
  binding.body.setRotation(
    { x: 0, y: 0, z: 0, w: 1 },
    true,
  );
  binding.body.setLinvel(velocity, true);
  binding.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  binding.body.wakeUp();
}

/**
 * 실제 스테이지 반폭·버프·카드·포켓 벽을 모두 적용한 월드를 만든다.
 */
async function createStageRuntime(
  modules,
  meta,
  stageNumber,
  runCards,
  instances = modules.layout.PIECE_INSTANCES,
) {
  const options = {
    gameMode: "stage",
    stageNumber,
    ...(runCards === undefined ? {} : { runCards }),
  };
  const runtime = await modules.physics.createPhysicsRuntime(
    meta,
    instances,
    modules.stage.computeStageBoardHalfExtent(
      meta.cellSize,
      "stage",
      stageNumber,
    ),
    options,
  );
  return { runtime, options };
}

/**
 * 스폰 뒤 수면·장외·의도 스폰점 대비 최대 x/z 이동을 측정한다.
 */
function measureSettledSpawn(modules, runtime) {
  const settle = modules.physics.preSettlePhysics(runtime);
  let maxDrift = 0;
  let fallenCount = 0;
  let sleepingCount = 0;
  for (const binding of runtime.pieces.values()) {
    const translation = binding.body.translation();
    maxDrift = Math.max(
      maxDrift,
      Math.hypot(
        translation.x - binding.spawnTranslation.x,
        translation.z - binding.spawnTranslation.z,
      ),
    );
    if (translation.y < modules.config.FALL_OUT_Y) {
      fallenCount += 1;
    }
    if (binding.body.isSleeping()) {
      sleepingCount += 1;
    }
  }
  return {
    pieceCount: runtime.pieces.size,
    sleepingCount,
    fallenCount,
    maxDrift,
    steps: settle.steps,
  };
}

/**
 * turn.ts의 실제 제거 순서를 써 지정 말이 장외 처리될 때까지 진행한다.
 */
function stepUntilRemoved(modules, runtime, pieceId, maximumSteps) {
  const sceneRuntime = createHeadlessSceneRuntime(runtime);
  const turnRuntime = modules.turn.createTurnRuntime(
    runtime,
    sceneRuntime,
    modules.tuning.createDefaultRuntimeTuningSettings(),
  );
  turnRuntime.phase = "settling";
  let steps = 0;
  while (runtime.pieces.has(pieceId) && steps < maximumSteps) {
    modules.turn.applyPendingLaunchBeforeStep(turnRuntime);
    runtime.world.step();
    modules.turn.updateTurnAfterStep(
      turnRuntime,
      modules.config.FIXED_STEP,
    );
    steps += 1;
  }
  return steps;
}

try {
  const [
    cards,
    config,
    layout,
    physics,
    stage,
    tuning,
    turn,
    walls,
  ] = await Promise.all([
    vite.ssrLoadModule("/src/cards.ts"),
    vite.ssrLoadModule("/src/config.ts"),
    vite.ssrLoadModule("/src/layout.ts"),
    vite.ssrLoadModule("/src/physics.ts"),
    vite.ssrLoadModule("/src/stage.ts"),
    vite.ssrLoadModule("/src/tuning.ts"),
    vite.ssrLoadModule("/src/turn.ts"),
    vite.ssrLoadModule("/src/walls.ts"),
  ]);
  const modules = {
    cards,
    config,
    layout,
    physics,
    stage,
    tuning,
    turn,
    walls,
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

  const stageCounts = [];
  for (let stageNumber = 1; stageNumber <= 10; stageNumber += 1) {
    const { runtime } = await createStageRuntime(
      modules,
      meta,
      stageNumber,
      undefined,
      [],
    );
    const variants = [
      ...new Set(
        [...runtime.breakableWalls.values()].map(
          (binding) => binding.definition.variant,
        ),
      ),
    ];
    stageCounts.push({
      stageNumber,
      count: runtime.breakableWalls.size,
      variants,
    });
  }
  const expectedCounts = [
    0,
    0,
    32,
    32,
    32,
    32,
    4,
    4,
    0,
    0,
  ];
  assertCondition(
    stageCounts.every(
      (entry, index) =>
        entry.count === expectedCounts[index] &&
        (entry.stageNumber >= 3 && entry.stageNumber <= 6
          ? entry.variants.join(",") === "breakable"
          : entry.stageNumber === 7 || entry.stageNumber === 8
            ? entry.variants.join(",") === "indestructible"
            : entry.variants.length === 0),
    ),
    `스테이지별 벽 범위·변형이 다릅니다: ${JSON.stringify(stageCounts)}`,
  );
  console.log(
    `[통과 a] 벽 범위: ${stageCounts.map((entry) => `S${entry.stageNumber}=${entry.count}${entry.variants.length > 0 ? `(${entry.variants.join(",")})` : ""}`).join(",")}`,
  );

  const halfExtent = stage.computeStageBoardHalfExtent(
    meta.cellSize,
    "stage",
    7,
  );
  const pocketGeometry = walls.computePocketWallGeometry(
    halfExtent,
    walls.computePocketKingBaseRadius(
      meta.pieces.King.colliderPoints,
      meta.pieces.King.bounds.y,
    ),
  );
  const widthRatio =
    pocketGeometry.exitWidth /
    pocketGeometry.kingBaseDiameter;
  const removedFraction =
    (pocketGeometry.sideSetback * 2) /
    (halfExtent * 2);
  // 맵 수정안 도면 실측으로 확정한 두 배 출구를 독립 기대값으로 고정한다.
  const expectedExitMultiplier = 2.4;
  assertCondition(
    Math.abs(
      widthRatio -
        config.POCKET_WALL_EXIT_WIDTH_KING_DIAMETER_MULTIPLIER,
    ) < 1e-12 &&
      Math.abs(
        config.POCKET_WALL_EXIT_WIDTH_KING_DIAMETER_MULTIPLIER -
          expectedExitMultiplier,
      ) < 1e-12 &&
      pocketGeometry.diagonalClearance >=
        pocketGeometry.kingBaseDiameter &&
      pocketGeometry.wallLength > 0 &&
      removedFraction < 0.35,
    `포켓 출구가 킹을 받지 못하거나 벽을 과도하게 줄였습니다: ${JSON.stringify(pocketGeometry)}, removedFraction=${removedFraction}`,
  );
  console.log(
    `[통과 b] 출구 기하: kingDiameter=${pocketGeometry.kingBaseDiameter.toFixed(6)}, configuredWidth=${pocketGeometry.exitWidth.toFixed(6)}(${widthRatio.toFixed(3)}×), sideSetback=${pocketGeometry.sideSetback.toFixed(6)}, diagonalClearance=${pocketGeometry.diagonalClearance.toFixed(6)}, wallLength=${pocketGeometry.wallLength.toFixed(6)}, cornerShare=${(removedFraction * 100).toFixed(3)}%`,
  );

  const kingInstance = layout.PIECE_INSTANCES.find(
    (instance) => instance.id === "white-king-e1",
  );
  assertCondition(kingInstance !== undefined, "포켓 검증 킹이 없습니다.");
  const reflection = await createStageRuntime(
    modules,
    meta,
    7,
    undefined,
    [kingInstance],
  );
  const reflectionKing =
    reflection.runtime.pieces.get(kingInstance.id);
  const northWall =
    reflection.runtime.breakableWalls.get("pocket-wall-north");
  assertCondition(
    reflectionKing !== undefined && northWall !== undefined,
    "중앙 반사 검증 킹 또는 북쪽 포켓 벽이 없습니다.",
  );
  const incomingSpeed = 1.6;
  placePiece(
    reflectionKing,
    {
      x: 0,
      y: reflectionKing.spawnTranslation.y,
      z: reflection.runtime.boardHalfExtent - 0.25,
    },
    { x: 0, y: 0, z: incomingSpeed },
  );
  let reflectionSteps = 0;
  let maximumZ = reflectionKing.body.translation().z;
  let contactHits = [];
  while (
    reflectionKing.body.linvel().z >= 0 &&
    reflectionSteps < 180
  ) {
    reflection.runtime.world.step();
    maximumZ = Math.max(
      maximumZ,
      reflectionKing.body.translation().z,
    );
    contactHits.push(
      ...physics.scanBreakableWallContacts(reflection.runtime),
    );
    reflectionSteps += 1;
  }
  const outgoingSpeed = reflectionKing.body.linvel().z;
  northWall.hitCount = 99;
  northWall.pendingDestruction = true;
  physics.scanBreakableWallContacts(reflection.runtime);
  const forcedDestroy =
    physics.applyPendingBreakableWallDestructions(
      reflection.runtime,
    );
  assertCondition(
    outgoingSpeed < 0 &&
      contactHits.length === 0 &&
      northWall.hitCount === 0 &&
      !northWall.pendingDestruction &&
      forcedDestroy.length === 0 &&
      reflection.runtime.breakableWalls.has(
        northWall.definition.id,
      ) &&
      reflection.runtime.destroyedBreakableWallIds.size === 0,
    `불파괴 중앙 벽 반사·내구 상태가 다릅니다: outgoing=${outgoingSpeed}, position=${JSON.stringify(reflectionKing.body.translation())}, maxZ=${maximumZ}, hits=${JSON.stringify(contactHits)}, wall=${JSON.stringify({ hitCount: northWall.hitCount, pending: northWall.pendingDestruction })}, destroyed=${JSON.stringify(forcedDestroy)}`,
  );

  const corner = await createStageRuntime(
    modules,
    meta,
    7,
    undefined,
    [kingInstance],
  );
  const cornerKing = corner.runtime.pieces.get(kingInstance.id);
  const diagonalComponent = incomingSpeed / Math.SQRT2;
  placePiece(
    cornerKing,
    {
      x: corner.runtime.boardHalfExtent - 0.25,
      y: cornerKing.spawnTranslation.y,
      z: corner.runtime.boardHalfExtent - 0.25,
    },
    {
      x: diagonalComponent,
      y: 0,
      z: diagonalComponent,
    },
  );
  const cornerSteps = stepUntilRemoved(
    modules,
    corner.runtime,
    kingInstance.id,
    600,
  );
  assertCondition(
    !corner.runtime.pieces.has(kingInstance.id),
    `킹이 ${cornerSteps} step 뒤에도 모서리 출구로 제거되지 않았습니다.`,
  );
  console.log(
    `[통과 c] 같은 속도 반사/출구: mid-wall ${reflectionSteps} step, maxZ=${maximumZ.toFixed(6)}, vz=${incomingSpeed.toFixed(6)}→${outgoingSpeed.toFixed(6)}, hit/crack/destroy=0/0/0; corner King removed=${cornerSteps} step`,
  );

  const pawnInstance = layout.PIECE_INSTANCES.find(
    (instance) => instance.id === "white-pawn-d2",
  );
  assertCondition(pawnInstance !== undefined, "도약 검증 Pawn이 없습니다.");
  const hopped = await createStageRuntime(
    modules,
    meta,
    7,
    undefined,
    [pawnInstance],
  );
  const hoppedPawn = hopped.runtime.pieces.get(pawnInstance.id);
  placePiece(
    hoppedPawn,
    {
      x: 0,
      y:
        config.BREAKABLE_WALL_HEIGHT +
        hoppedPawn.localPieceHeight / 2 +
        0.08,
      z: hopped.runtime.boardHalfExtent - 0.16,
    },
    { x: 0, y: 0.1, z: 2.2 },
  );
  const hopSteps = stepUntilRemoved(
    modules,
    hopped.runtime,
    pawnInstance.id,
    600,
  );
  assertCondition(
    !hopped.runtime.pieces.has(pawnInstance.id),
    `포켓 벽 위 Pawn이 ${hopSteps} step 뒤에도 제거되지 않았습니다.`,
  );
  console.log(
    `[통과 d] 불파괴 벽 위 도약 후 FALL_OUT_Y=${config.FALL_OUT_Y} 제거: ${hopSteps} step`,
  );

  const giantCards = cards.createRunCardState();
  cards.applyCardPick(giantCards, "giantPawn");
  const proneCards = cards.createRunCardState();
  cards.applyCardPick(proneCards, "proneStart");
  const spawnMeasurements = [];
  for (const stageNumber of [7, 8]) {
    for (const [label, runCards, expectedCount] of [
      ["normal", undefined, 32],
      ["giantPawn", giantCards, 28],
      ["proneStart", proneCards, 32],
    ]) {
      const { runtime } = await createStageRuntime(
        modules,
        meta,
        stageNumber,
        runCards,
      );
      const measurement = measureSettledSpawn(modules, runtime);
      assertCondition(
        measurement.pieceCount === expectedCount &&
          measurement.sleepingCount === expectedCount &&
          measurement.fallenCount === 0,
        `스테이지 ${stageNumber} ${label} 스폰이 안전하지 않습니다: ${JSON.stringify(measurement)}`,
      );
      spawnMeasurements.push({
        stageNumber,
        label,
        ...measurement,
      });
    }
  }
  console.log(
    `[통과 e] 스폰 안전: ${spawnMeasurements.map((entry) => `S${entry.stageNumber}-${entry.label}=${entry.sleepingCount}/${entry.pieceCount},fall=${entry.fallenCount},drift=${entry.maxDrift.toFixed(6)},steps=${entry.steps}`).join(" | ")}`,
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
