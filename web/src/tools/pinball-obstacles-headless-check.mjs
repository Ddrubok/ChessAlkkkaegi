import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
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
 * 실제 스테이지 반폭·버프·카드·고정 장애물을 모두 적용한 월드를 만든다.
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
 * 말 하나를 결정적인 자세와 속도로 옮겨 원기둥 접촉 실험을 준비한다.
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
 * 두 콜라이더 사이에 실제 solver contact가 있는지 결정적으로 조회한다.
 */
function hasSolverContact(world, left, right) {
  let touching = false;
  world.contactPair(left, right, (manifold) => {
    if (manifold.numSolverContacts() > 0) {
      touching = true;
    }
  });
  return touching;
}

/**
 * 첫 물리 스텝의 장애물 접촉과 정착 뒤 수면·장외·드리프트를 함께 측정한다.
 */
function measureSettledSpawn(modules, runtime) {
  runtime.world.step();
  const initialContacts = [];
  for (const piece of runtime.pieces.values()) {
    for (const obstacle of runtime.pinballObstacles.values()) {
      if (
        hasSolverContact(
          runtime.world,
          piece.collider,
          obstacle.collider,
        )
      ) {
        initialContacts.push(
          `${piece.instance.id}:${obstacle.definition.id}`,
        );
      }
    }
  }
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
    steps: settle.steps + 1,
    initialContacts,
  };
}

try {
  const [
    cards,
    config,
    layout,
    obstacles,
    physics,
    stage,
  ] = await Promise.all([
    vite.ssrLoadModule("/src/cards.ts"),
    vite.ssrLoadModule("/src/config.ts"),
    vite.ssrLoadModule("/src/layout.ts"),
    vite.ssrLoadModule("/src/obstacles.ts"),
    vite.ssrLoadModule("/src/physics.ts"),
    vite.ssrLoadModule("/src/stage.ts"),
  ]);
  const modules = {
    cards,
    config,
    layout,
    obstacles,
    physics,
    stage,
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
    stageCounts.push({
      stageNumber,
      obstacleCount: runtime.pinballObstacles.size,
      wallCount: runtime.breakableWalls.size,
    });
  }
  assertCondition(
    stageCounts.every(
      (entry) =>
        entry.obstacleCount ===
          (entry.stageNumber === 9 ? 6 : 0) &&
        (entry.stageNumber === 9
          ? entry.wallCount === 0
          : true),
    ),
    `핀볼 장애물 스테이지 범위 또는 9단계 벽 부재가 다릅니다: ${JSON.stringify(stageCounts)}`,
  );
  const transition = await createStageRuntime(
    modules,
    meta,
    8,
    undefined,
    [],
  );
  physics.resetPhysicsPieces(
    transition.runtime,
    meta,
    [],
    { gameMode: "stage", stageNumber: 9 },
  );
  const resetStageNineCount =
    transition.runtime.pinballObstacles.size;
  physics.resetPhysicsPieces(
    transition.runtime,
    meta,
    [],
    { gameMode: "stage", stageNumber: 10 },
  );
  const resetStageTenCount =
    transition.runtime.pinballObstacles.size;
  assertCondition(
    resetStageNineCount === 6 && resetStageTenCount === 0,
    `리셋 경로의 핀볼 장애물 복원·제거가 다릅니다: S9=${resetStageNineCount}, S10=${resetStageTenCount}`,
  );
  console.log(
    `[통과 a] 원기둥 범위: ${stageCounts.map((entry) => `S${entry.stageNumber}=${entry.obstacleCount}(walls=${entry.wallCount})`).join(",")}; reset S8→S9=${resetStageNineCount}→S10=${resetStageTenCount}`,
  );

  const definitions =
    obstacles.computePinballObstacleDefinitions(
      meta.cellSize,
      0,
    );
  const expectedSquares = ["c6", "f6", "a4", "h4", "c3", "e3"];
  const expectedDiameter =
    meta.cellSize * config.PINBALL_OBSTACLE_DIAMETER_CELLS;
  const upperPairClearance =
    Math.abs(
      definitions[0].center.x - definitions[1].center.x,
    ) - expectedDiameter;
  const pawnDiameter =
    Math.max(
      ...meta.pieces.Pawn.colliderPoints.map((point) =>
        Math.hypot(point[0], point[2]),
      ),
    ) * 2;
  assertCondition(
    definitions.length === expectedSquares.length &&
      definitions.every(
        (definition, index) =>
          `${definition.file}${definition.rank}` ===
            expectedSquares[index] &&
          Math.abs(definition.radius * 2 - expectedDiameter) <
            1e-12 &&
          Math.abs(
            definition.halfHeight * 2 -
              config.PINBALL_OBSTACLE_HEIGHT,
          ) < 1e-12,
      ) &&
      upperPairClearance > pawnDiameter,
    `핀볼 셀·치수가 설정과 다릅니다: ${JSON.stringify(definitions)}`,
  );
  console.log(
    `[통과 b] 원기둥 기하: diameter=${expectedDiameter.toFixed(6)}(${config.PINBALL_OBSTACLE_DIAMETER_CELLS.toFixed(3)}cell), height=${config.PINBALL_OBSTACLE_HEIGHT.toFixed(6)}, upperPairClearance=${upperPairClearance.toFixed(6)}>PawnDiameter=${pawnDiameter.toFixed(6)}, centers=${definitions.map((definition) => `${definition.file}${definition.rank}=(${definition.center.x.toFixed(6)},${definition.center.z.toFixed(6)})`).join(" | ")}`,
  );

  const pawnInstance = layout.PIECE_INSTANCES.find(
    (instance) => instance.id === "white-pawn-d2",
  );
  assertCondition(pawnInstance !== undefined, "핀볼 검증 Pawn이 없습니다.");

  const reflection = await createStageRuntime(
    modules,
    meta,
    9,
    undefined,
    [pawnInstance],
  );
  const reflectionPawn =
    reflection.runtime.pieces.get(pawnInstance.id);
  const target =
    reflection.runtime.pinballObstacles.get(
      "pinball-obstacle-2",
    );
  assertCondition(
    reflectionPawn !== undefined && target !== undefined,
    "정면 반사 검증 Pawn 또는 a4 원기둥이 없습니다.",
  );
  const incomingSpeed = 1.6;
  placePiece(
    reflectionPawn,
    {
      x: target.definition.center.x - 0.42,
      y: reflectionPawn.spawnTranslation.y,
      z: target.definition.center.z,
    },
    { x: incomingSpeed, y: 0, z: 0 },
  );
  let reflectionSteps = 0;
  let maximumX = reflectionPawn.body.translation().x;
  let touched = false;
  while (
    reflectionPawn.body.linvel().x >= 0 &&
    reflectionSteps < 180
  ) {
    reflection.runtime.world.step();
    maximumX = Math.max(
      maximumX,
      reflectionPawn.body.translation().x,
    );
    touched =
      touched ||
      hasSolverContact(
        reflection.runtime.world,
        reflectionPawn.collider,
        target.collider,
      );
    reflectionSteps += 1;
  }
  const outgoingSpeed = reflectionPawn.body.linvel().x;
  const wallHits =
    physics.scanBreakableWallContacts(reflection.runtime);
  const wallDestroyed =
    physics.applyPendingBreakableWallDestructions(
      reflection.runtime,
    );
  assertCondition(
    touched &&
      outgoingSpeed < 0 &&
      reflection.runtime.pinballObstacles.has(
        target.definition.id,
      ) &&
      reflection.runtime.breakableWalls.size === 0 &&
      wallHits.length === 0 &&
      wallDestroyed.length === 0,
    `원기둥 순수 반사 또는 내구 비개입이 다릅니다: touched=${touched}, vx=${outgoingSpeed}, maxX=${maximumX}, wallHits=${JSON.stringify(wallHits)}, destroyed=${JSON.stringify(wallDestroyed)}`,
  );

  const between = await createStageRuntime(
    modules,
    meta,
    9,
    undefined,
    [pawnInstance],
  );
  const betweenPawn = between.runtime.pieces.get(pawnInstance.id);
  placePiece(
    betweenPawn,
    {
      x: 0,
      y: betweenPawn.spawnTranslation.y,
      z: 0.25,
    },
    { x: 0, y: 0, z: 1.8 },
  );
  let betweenSteps = 0;
  let betweenTouched = false;
  while (
    betweenPawn.body.translation().z < 1.15 &&
    betweenSteps < 240
  ) {
    between.runtime.world.step();
    for (const obstacle of between.runtime.pinballObstacles.values()) {
      betweenTouched =
        betweenTouched ||
        hasSolverContact(
          between.runtime.world,
          betweenPawn.collider,
          obstacle.collider,
        );
    }
    betweenSteps += 1;
  }
  const betweenFinal = betweenPawn.body.translation();
  assertCondition(
    betweenFinal.z >= 1.15 &&
      !betweenTouched &&
      Math.abs(betweenFinal.x) < 0.01,
    `Pawn이 두 원기둥 사이를 곧게 통과하지 못했습니다: steps=${betweenSteps}, position=${JSON.stringify(betweenFinal)}, touched=${betweenTouched}`,
  );

  const airborne = await createStageRuntime(
    modules,
    meta,
    9,
    undefined,
    [pawnInstance],
  );
  const airbornePawn = airborne.runtime.pieces.get(pawnInstance.id);
  placePiece(
    airbornePawn,
    {
      x: target.definition.center.x - 0.42,
      y:
        config.PINBALL_OBSTACLE_HEIGHT +
        airbornePawn.localPieceHeight +
        0.08,
      z: target.definition.center.z,
    },
    { x: 1.8, y: 2, z: 0 },
  );
  let airborneSteps = 0;
  let airborneTouched = false;
  let minimumY = airbornePawn.body.translation().y;
  while (
    airbornePawn.body.translation().x <
      target.definition.center.x + 0.3 &&
    airborneSteps < 180
  ) {
    airborne.runtime.world.step();
    minimumY = Math.min(
      minimumY,
      airbornePawn.body.translation().y,
    );
    airborneTouched =
      airborneTouched ||
      hasSolverContact(
        airborne.runtime.world,
        airbornePawn.collider,
        target.collider,
      );
    airborneSteps += 1;
  }
  const airborneFinal = airbornePawn.body.translation();
  assertCondition(
    airborneFinal.x >= target.definition.center.x + 0.3 &&
      !airborneTouched &&
      airbornePawn.body.linvel().x > 0,
    `공중 Pawn이 원기둥 위를 통과하지 못했습니다: steps=${airborneSteps}, position=${JSON.stringify(airborneFinal)}, minY=${minimumY}, touched=${airborneTouched}, vx=${airbornePawn.body.linvel().x}`,
  );
  console.log(
    `[통과 c] 실제 물리: dead-on ${reflectionSteps} step, xMax=${maximumX.toFixed(6)}, vx=${incomingSpeed.toFixed(6)}→${outgoingSpeed.toFixed(6)}, hit/crack/destroy=0/0/0; between ${betweenSteps} step, final=(${betweenFinal.x.toFixed(6)},${betweenFinal.z.toFixed(6)}); airborne ${airborneSteps} step, minY=${minimumY.toFixed(6)}, finalX=${airborneFinal.x.toFixed(6)}`,
  );

  const giantCards = cards.createRunCardState();
  cards.applyCardPick(giantCards, "giantPawn");
  const proneCards = cards.createRunCardState();
  cards.applyCardPick(proneCards, "proneStart");
  const spawnMeasurements = [];
  for (const [label, runCards, expectedCount] of [
    ["normal", undefined, 32],
    ["giantPawn", giantCards, 28],
    ["proneStart", proneCards, 32],
  ]) {
    const { runtime } = await createStageRuntime(
      modules,
      meta,
      9,
      runCards,
    );
    const measurement = measureSettledSpawn(modules, runtime);
    assertCondition(
      measurement.pieceCount === expectedCount &&
        measurement.sleepingCount === expectedCount &&
        measurement.fallenCount === 0 &&
        measurement.initialContacts.length === 0,
      `스테이지 9 ${label} 스폰이 안전하지 않습니다: ${JSON.stringify(measurement)}`,
    );
    spawnMeasurements.push({
      label,
      ...measurement,
    });
  }
  console.log(
    `[통과 d] 스폰 안전: ${spawnMeasurements.map((entry) => `${entry.label}=${entry.sleepingCount}/${entry.pieceCount},contacts=${entry.initialContacts.length},fall=${entry.fallenCount},drift=${entry.maxDrift.toFixed(6)},steps=${entry.steps}`).join(" | ")}`,
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
