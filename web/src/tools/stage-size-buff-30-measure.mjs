import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const webRoot = fileURLToPath(new URL("../..", import.meta.url));
const vite = await createServer({
  root: webRoot,
  logLevel: "error",
  appType: "custom",
  server: { middlewareMode: true },
});

/**
 * 한 접촉 쌍의 실제 음수 접촉 거리를 최대 관통량으로 바꾼다.
 */
function measurePairPenetration(world, left, right) {
  let maximumPenetration = 0;
  world.contactPair(left, right, (manifold) => {
    for (let index = 0; index < manifold.numContacts(); index += 1) {
      maximumPenetration = Math.max(
        maximumPenetration,
        -manifold.contactDist(index),
      );
    }
  });
  return maximumPenetration;
}

/**
 * 첫 fixed step의 실제 narrow-phase에서 말-말과 말-맵 관통 쌍을 센다.
 */
function measureInitialOverlaps(runtime) {
  runtime.world.step();
  const pieces = [...runtime.pieces.values()];
  let piecePairCount = 0;
  let mapPairCount = 0;
  let maximumPiecePenetration = 0;
  let maximumMapPenetration = 0;
  const piecePairIds = [];
  const mapPairIds = [];
  const mapBindings = [
    ...runtime.breakableWalls.values(),
    ...runtime.pinballObstacles.values(),
  ];
  for (let left = 0; left < pieces.length; left += 1) {
    for (let right = left + 1; right < pieces.length; right += 1) {
      const penetration = measurePairPenetration(
        runtime.world,
        pieces[left].collider,
        pieces[right].collider,
      );
      if (penetration > 0) {
        piecePairCount += 1;
        piecePairIds.push(
          `${pieces[left].instance.id}:${pieces[right].instance.id}`,
        );
        maximumPiecePenetration = Math.max(
          maximumPiecePenetration,
          penetration,
        );
      }
    }
    for (const mapBinding of mapBindings) {
      const penetration = measurePairPenetration(
        runtime.world,
        pieces[left].collider,
        mapBinding.collider,
      );
      if (penetration > 0) {
        mapPairCount += 1;
        mapPairIds.push(
          `${pieces[left].instance.id}:${mapBinding.definition.id}`,
        );
        maximumMapPenetration = Math.max(
          maximumMapPenetration,
          penetration,
        );
      }
    }
  }
  return {
    piecePairCount,
    mapPairCount,
    maximumPiecePenetration,
    maximumMapPenetration,
    piecePairIds,
    mapPairIds,
  };
}

/**
 * 정착 도중 말과 벽 사이에 solver contact가 생겼는지 부작용 없이 조회한다.
 */
function collectWallContactPairs(runtime, output) {
  for (const piece of runtime.pieces.values()) {
    for (const wall of runtime.breakableWalls.values()) {
      let touching = false;
      runtime.world.contactPair(
        piece.collider,
        wall.collider,
        (manifold) => {
          if (manifold.numSolverContacts() > 0) {
            touching = true;
          }
        },
      );
      if (touching) {
        output.add(
          `${piece.instance.id}:${wall.definition.id}`,
        );
      }
    }
  }
}

/**
 * 실제 사전 정착 상한까지 진행하되 실패도 수치로 남기기 위해 예외를 던지지 않는다.
 */
function settleWithoutThrow(config, runtime) {
  let steps = 0;
  const wallContactPairs = new Set();
  while (
    steps < config.PRE_SETTLE_MAX_STEPS &&
    ![...runtime.pieces.values()].every((binding) =>
      binding.body.isSleeping(),
    )
  ) {
    runtime.world.step();
    collectWallContactPairs(runtime, wallContactPairs);
    steps += 1;
  }
  return {
    steps,
    sleepingCount: [...runtime.pieces.values()].filter(
      (binding) => binding.body.isSleeping(),
    ).length,
    wallContactPairs: [...wallContactPairs],
  };
}

/**
 * 최종 위치가 구멍·포켓 출구·일반 외곽 중 어디로 이탈했는지 분류한다.
 */
function classifyLostPiece(runtime, binding, stageNumber) {
  const translation = binding.body.translation();
  if (
    runtime.boardHoleRectangles.some(
      (hole) =>
        binding.spawnTranslation.x >= hole.minX &&
        binding.spawnTranslation.x <= hole.maxX &&
        binding.spawnTranslation.z >= hole.minZ &&
        binding.spawnTranslation.z <= hole.maxZ,
    )
  ) {
    return "hole-spawn";
  }
  if (
    runtime.boardHoleRectangles.some(
      (hole) =>
        translation.x >= hole.minX &&
        translation.x <= hole.maxX &&
        translation.z >= hole.minZ &&
        translation.z <= hole.maxZ,
    )
  ) {
    return "hole";
  }
  if (
    (stageNumber === 7 || stageNumber === 8) &&
    Math.abs(translation.x) > runtime.boardHalfExtent &&
    Math.abs(translation.z) > runtime.boardHalfExtent
  ) {
    return "pocket";
  }
  return "edge";
}

/**
 * 한 스테이지·카드 배치의 실제 맵 스폰을 처음부터 끝까지 측정한다.
 */
async function measureSpawn(
  modules,
  meta,
  stageNumber,
  runCards,
  label,
) {
  const options = {
    gameMode: "stage",
    stageNumber,
    ...(runCards === undefined ? {} : { runCards }),
  };
  const halfExtent = modules.stage.computeStageBoardHalfExtent(
    meta.cellSize,
    "stage",
    stageNumber,
  );
  const createRuntime = () =>
    modules.physics.createPhysicsRuntime(
      meta,
      modules.layout.PIECE_INSTANCES,
      halfExtent,
      options,
    );
  const overlapRuntime = await createRuntime();
  const overlaps = measureInitialOverlaps(overlapRuntime);
  const runtime = await createRuntime();
  const settle = settleWithoutThrow(modules.config, runtime);
  const lost = [];
  let maximumDrift = 0;
  let maximumDriftPieceId = "";
  for (const binding of runtime.pieces.values()) {
    const translation = binding.body.translation();
    const drift = Math.hypot(
      translation.x - binding.spawnTranslation.x,
      translation.z - binding.spawnTranslation.z,
    );
    if (drift > maximumDrift) {
      maximumDrift = drift;
      maximumDriftPieceId = binding.instance.id;
    }
    if (translation.y < modules.config.FALL_OUT_Y) {
      lost.push({
        id: binding.instance.id,
        route: classifyLostPiece(runtime, binding, stageNumber),
      });
    }
  }
  const spawnWallHits =
    modules.physics.scanBreakableWallContacts(runtime);
  const wallHitCount = [
    ...runtime.breakableWalls.values(),
  ].reduce((sum, wall) => sum + wall.hitCount, 0);
  const crackedWallCount = [
    ...runtime.breakableWalls.values(),
  ].filter((wall) => wall.hitCount > 0).length;
  const pendingWallDestructionCount = [
    ...runtime.breakableWalls.values(),
  ].filter((wall) => wall.pendingDestruction).length;
  const blackRegular = [...runtime.pieces.values()].find(
    (binding) =>
      binding.instance.side === "black" &&
      binding.instance.type !== "Pawn",
  );
  const blackPawn = [...runtime.pieces.values()].find(
    (binding) =>
      binding.instance.side === "black" &&
      binding.instance.type === "Pawn",
  );
  const buffs = modules.stage.computeStageBuffs(stageNumber);
  const generalScale = blackRegular?.uniformScale ?? 1;
  const tierRatio =
    buffs.pawnTier === "none"
      ? 1
      : modules.config.GIANT_PAWN_SIZE_MULTIPLIER;
  const rawPawnScale = generalScale * tierRatio;
  const appliedPawnScale = blackPawn?.uniformScale ?? 1;
  return {
    label,
    stageNumber,
    generalScale,
    pawnTier: buffs.pawnTier,
    tierRatio,
    rawPawnScale,
    appliedPawnScale,
    clampEngaged:
      rawPawnScale > modules.config.STAGE_MAX_PIECE_SCALE,
    overlapPiecePairs: overlaps.piecePairCount,
    maximumPiecePenetration: overlaps.maximumPiecePenetration,
    overlapMapPairs: overlaps.mapPairCount,
    maximumMapPenetration: overlaps.maximumMapPenetration,
    overlapPiecePairIds: overlaps.piecePairIds,
    overlapMapPairIds: overlaps.mapPairIds,
    settleSteps: settle.steps,
    sleepingCount: settle.sleepingCount,
    pieceCount: runtime.pieces.size,
    lost,
    maximumDrift,
    maximumDriftPieceId,
    wallCount: runtime.breakableWalls.size,
    settleWallContactPairs: settle.wallContactPairs,
    wallContained:
      settle.wallContactPairs.length > 0 && lost.length === 0,
    spawnWallHits: spawnWallHits.length,
    wallHitCount,
    crackedWallCount,
    pendingWallDestructionCount,
  };
}

try {
  const [cards, config, layout, physics, stage] =
    await Promise.all([
      vite.ssrLoadModule("/src/cards.ts"),
      vite.ssrLoadModule("/src/config.ts"),
      vite.ssrLoadModule("/src/layout.ts"),
      vite.ssrLoadModule("/src/physics.ts"),
      vite.ssrLoadModule("/src/stage.ts"),
    ]);
  const modules = { cards, config, layout, physics, stage };
  const meta = JSON.parse(
    await readFile(
      new URL(
        "../../public/assets/chess-set.meta.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const measurements = [];
  for (let stageNumber = 1; stageNumber <= 10; stageNumber += 1) {
    measurements.push(
      await measureSpawn(
        modules,
        meta,
        stageNumber,
        undefined,
        `S${stageNumber}-normal`,
      ),
    );
  }
  const giantCards = cards.createRunCardState();
  cards.applyCardPick(giantCards, "giantPawn");
  const proneCards = cards.createRunCardState();
  cards.applyCardPick(proneCards, "proneStart");
  for (const stageNumber of [6, 9]) {
    measurements.push(
      await measureSpawn(
        modules,
        meta,
        stageNumber,
        giantCards,
        `S${stageNumber}-giantPawn`,
      ),
      await measureSpawn(
        modules,
        meta,
        stageNumber,
        proneCards,
        `S${stageNumber}-proneStart`,
      ),
    );
  }
  const normalMeasurements = measurements.slice(0, 10);
  for (const [index, entry] of normalMeasurements.entries()) {
    const expectedGeneralScale =
      config.STAGE_SIZE_MULTIPLIERS[index];
    if (
      Math.abs(entry.generalScale - expectedGeneralScale) > 1e-12 ||
      entry.lost.length > 0 ||
      entry.sleepingCount !== entry.pieceCount ||
      entry.overlapMapPairs > 0
    ) {
      throw new Error(
        `${entry.label} 최종 크기표 스폰 검증 실패: general=${entry.generalScale}/${expectedGeneralScale}, lost=${entry.lost.length}, sleeping=${entry.sleepingCount}/${entry.pieceCount}, mapOverlap=${entry.overlapMapPairs}`,
      );
    }
  }
  for (const entry of measurements) {
    if (
      entry.lost.length > 0 ||
      entry.sleepingCount !== entry.pieceCount ||
      entry.overlapMapPairs > 0
    ) {
      throw new Error(
        `${entry.label} 맵 스폰 안전 실패: lost=${entry.lost.length}, sleeping=${entry.sleepingCount}/${entry.pieceCount}, mapOverlap=${entry.overlapMapPairs}`,
      );
    }
  }
  console.log(
    `[측정 size-table] ${measurements.map((entry) => `${entry.label}:general=${entry.generalScale.toFixed(3)},tier=${entry.pawnTier},pawn=${entry.appliedPawnScale.toFixed(3)}${entry.clampEngaged ? "(clamp)" : ""},overlap=${entry.overlapPiecePairs}/${entry.maximumPiecePenetration.toFixed(6)},mapOverlap=${entry.overlapMapPairs}/${entry.maximumMapPenetration.toFixed(6)}[${entry.overlapMapPairIds.join(",")}],settle=${entry.sleepingCount}/${entry.pieceCount}@${entry.settleSteps},lost=${entry.lost.map((lost) => `${lost.id}:${lost.route}`).join(",") || "0"},drift=${entry.maximumDrift.toFixed(6)}(${entry.maximumDriftPieceId}),walls=${entry.wallCount},wallContacts=${entry.settleWallContactPairs.length},contained=${entry.wallContained},wallHits=${entry.wallHitCount},cracks=${entry.crackedWallCount},pending=${entry.pendingWallDestructionCount}`).join("\n")}`,
  );
  console.log(
    `[측정 size-table-json] ${JSON.stringify(measurements)}`,
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
