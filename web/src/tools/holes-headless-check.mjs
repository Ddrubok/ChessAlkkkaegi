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
 * 조건이 거짓이면 측정 이름을 포함한 한국어 오류로 즉시 중단한다.
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
 * 말 하나를 결정적인 자세와 속도로 옮겨 다음 fixed step 실험을 준비한다.
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
 * 실제 스테이지 반폭·버프·카드·벽·구멍을 모두 적용한 월드를 만든다.
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
 * 스폰 뒤 정착 수·장외 수·의도 스폰점 대비 최대 x/z 이동을 측정한다.
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
 * 두 직사각형 목록이 값과 순서까지 같은지 확인한다.
 */
function sameRectangles(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * 지정 스테이지의 남쪽 벽을 실제 접촉 두 번으로 파괴해 벽 재사용을 증명한다.
 */
function verifyBreakableWall(modules, runtime, stageNumber) {
  const wall = runtime.breakableWalls.get("wall-south-1");
  const pawn = runtime.pieces.get("white-pawn-h2");
  assertCondition(
    runtime.breakableWalls.size === 32 &&
      wall !== undefined &&
      pawn !== undefined,
    `스테이지 ${stageNumber}의 32개 벽 또는 타격 Pawn이 없습니다.`,
  );
  const placeAgainstWall = () => {
    const innerFace =
      wall.definition.center.z + wall.definition.halfExtents.z;
    placePiece(
      pawn,
      {
        x: wall.definition.center.x,
        y: pawn.spawnTranslation.y,
        z: innerFace + 0.153 - 0.004,
      },
      { x: 0, y: 0, z: -0.2 },
    );
  };
  placeAgainstWall();
  runtime.world.step();
  const first = modules.physics.scanBreakableWallContacts(runtime);
  placePiece(
    pawn,
      {
        x: wall.definition.center.x,
        y: pawn.spawnTranslation.y,
        z: -runtime.boardHalfExtent + 0.8,
      },
    { x: 0, y: 0, z: 0 },
  );
  runtime.world.step();
  modules.physics.scanBreakableWallContacts(runtime);
  assertCondition(
    wall.touchingPieceIds.size === 0,
    `스테이지 ${stageNumber} 벽 분리 뒤 접촉 집합이 비지 않았습니다.`,
  );
  let second = [];
  for (
    let attempt = 0;
    attempt < 5 && second.length === 0;
    attempt += 1
  ) {
    placeAgainstWall();
    runtime.world.step();
    second = modules.physics.scanBreakableWallContacts(runtime);
  }
  modules.physics.applyPendingBreakableWallDestructions(runtime);
  assertCondition(
    first.some(
      (hit) =>
        hit.wallId === wall.definition.id && hit.hitCount === 1,
    ) &&
      second.some(
        (hit) =>
          hit.wallId === wall.definition.id && hit.hitCount === 2,
      ) &&
      !runtime.breakableWalls.has(wall.definition.id),
    `스테이지 ${stageNumber} 벽 1→2회 타격·파괴가 다릅니다: first=${JSON.stringify(first)}, second=${JSON.stringify(second)}`,
  );
  return `${stageNumber}:1→2→removed`;
}

try {
  const [
    board,
    cards,
    config,
    holes,
    layout,
    physics,
    stage,
    tuning,
    turn,
  ] = await Promise.all([
    vite.ssrLoadModule("/src/board.ts"),
    vite.ssrLoadModule("/src/cards.ts"),
    vite.ssrLoadModule("/src/config.ts"),
    vite.ssrLoadModule("/src/holes.ts"),
    vite.ssrLoadModule("/src/layout.ts"),
    vite.ssrLoadModule("/src/physics.ts"),
    vite.ssrLoadModule("/src/stage.ts"),
    vite.ssrLoadModule("/src/tuning.ts"),
    vite.ssrLoadModule("/src/turn.ts"),
  ]);
  const modules = {
    board,
    cards,
    config,
    holes,
    layout,
    physics,
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
  const cell = meta.cellSize;
  const expectedStageFive = [
    {
      id: "hole-stage5-center",
      minX: -cell,
      maxX: cell,
      minZ: -cell,
      maxZ: cell,
    },
  ];
  const expectedStageSix = [
    {
      id: "hole-stage6-southwest",
      minX: cell,
      maxX: cell * 3,
      minZ: -cell * 2,
      maxZ: 0,
    },
    {
      id: "hole-stage6-northeast",
      minX: -cell * 3,
      maxX: -cell,
      minZ: 0,
      maxZ: cell * 2,
    },
  ];
  const stageFiveHoles = holes.computeBoardHoleRectangles(
    cell,
    "stage",
    5,
  );
  const stageSixHoles = holes.computeBoardHoleRectangles(
    cell,
    "stage",
    6,
  );
  assertCondition(
    sameRectangles(stageFiveHoles, expectedStageFive) &&
      sameRectangles(stageSixHoles, expectedStageSix),
    `구멍 셀 좌표가 다릅니다: S5=${JSON.stringify(stageFiveHoles)}, S6=${JSON.stringify(stageSixHoles)}`,
  );
  for (let stageNumber = 1; stageNumber <= 12; stageNumber += 1) {
    if (stageNumber === 5 || stageNumber === 6) {
      continue;
    }
    assertCondition(
      holes.computeBoardHoleRectangles(
        cell,
        "stage",
        stageNumber,
      ).length === 0,
      `스테이지 ${stageNumber}에 구멍이 생겼습니다.`,
    );
  }
  assertCondition(
    holes.computeBoardHoleRectangles(cell, "hotseat", 5).length ===
      0 &&
      holes.computeBoardHoleRectangles(cell, "online", 6).length ===
        0,
    "핫시트 또는 온라인에 구멍이 생겼습니다.",
  );
  console.log(
    `[통과 a] 구멍 셀: S5=${JSON.stringify(stageFiveHoles)}, S6=${JSON.stringify(stageSixHoles)}, 그 외=0`,
  );

  const layoutMeasurements = [];
  for (const stageNumber of [5, 6]) {
    const { runtime } = await createStageRuntime(
      modules,
      meta,
      stageNumber,
    );
    const rendered = board.computeBoardRenderFloorRectangles(
      runtime.boardHalfExtent,
      cell,
      "stage",
      stageNumber,
    );
    const floorArea = runtime.boardFloorRectangles.reduce(
      (sum, rectangle) =>
        sum +
        (rectangle.maxX - rectangle.minX) *
          (rectangle.maxZ - rectangle.minZ),
      0,
    );
    const holeArea = runtime.boardHoleRectangles.reduce(
      (sum, rectangle) =>
        sum +
        (rectangle.maxX - rectangle.minX) *
          (rectangle.maxZ - rectangle.minZ),
      0,
    );
    const boardArea = (runtime.boardHalfExtent * 2) ** 2;
    assertCondition(
      sameRectangles(runtime.boardFloorRectangles, rendered) &&
        Math.abs(floorArea + holeArea - boardArea) < 1e-12,
      `스테이지 ${stageNumber} 렌더·물리 분할 또는 면적이 다릅니다: physics=${JSON.stringify(runtime.boardFloorRectangles)}, render=${JSON.stringify(rendered)}, area=${floorArea + holeArea}/${boardArea}`,
    );
    layoutMeasurements.push({
      stageNumber,
      floorCount: runtime.boardFloorRectangles.length,
      colliderCount: runtime.boardColliders.length,
      areaError: Math.abs(floorArea + holeArea - boardArea),
    });
  }
  console.log(
    `[통과 b] 렌더=물리 경계, S5 floor/collider=${layoutMeasurements[0].floorCount}/${layoutMeasurements[0].colliderCount}, S6=${layoutMeasurements[1].floorCount}/${layoutMeasurements[1].colliderCount}, 최대 면적 오차=${Math.max(...layoutMeasurements.map((entry) => entry.areaError))}`,
  );

  const pawnInstance = layout.PIECE_INSTANCES.find(
    (instance) => instance.id === "white-pawn-d2",
  );
  assertCondition(pawnInstance !== undefined, "구멍 검증 Pawn이 없습니다.");
  const falling = await createStageRuntime(
    modules,
    meta,
    5,
    undefined,
    [pawnInstance],
  );
  const fallingPawn = falling.runtime.pieces.get(pawnInstance.id);
  const fallingScene = createHeadlessSceneRuntime(falling.runtime);
  const fallingTurn = turn.createTurnRuntime(
    falling.runtime,
    fallingScene,
    tuning.createDefaultRuntimeTuningSettings(),
  );
  fallingTurn.phase = "settling";
  placePiece(
    fallingPawn,
    {
      x: 0,
      y: fallingPawn.spawnTranslation.y,
      z: 0,
    },
    { x: 0, y: 0, z: 0 },
  );
  let fallSteps = 0;
  while (
    falling.runtime.pieces.has(pawnInstance.id) &&
    fallSteps < 600
  ) {
    turn.applyPendingLaunchBeforeStep(fallingTurn);
    falling.runtime.world.step();
    turn.updateTurnAfterStep(fallingTurn, config.FIXED_STEP);
    fallSteps += 1;
  }
  assertCondition(
    !falling.runtime.pieces.has(pawnInstance.id),
    `중앙 구멍 Pawn이 ${fallSteps} step 뒤에도 제거되지 않았습니다.`,
  );

  const airborne = await createStageRuntime(
    modules,
    meta,
    5,
    undefined,
    [pawnInstance],
  );
  const airbornePawn = airborne.runtime.pieces.get(pawnInstance.id);
  placePiece(
    airbornePawn,
    { x: 0, y: 1.2, z: -0.9 },
    { x: 0, y: 0, z: 3.8 },
  );
  let minimumY = Number.POSITIVE_INFINITY;
  let airborneSteps = 0;
  while (
    airbornePawn.body.translation().z <
      stageFiveHoles[0].maxZ + 0.2 &&
    airborneSteps < 120
  ) {
    airborne.runtime.world.step();
    minimumY = Math.min(
      minimumY,
      airbornePawn.body.translation().y,
    );
    airborneSteps += 1;
  }
  const airbornePosition = airbornePawn.body.translation();
  assertCondition(
    airbornePosition.y > airborne.runtime.boardTop &&
      minimumY > airborne.runtime.boardTop &&
      airbornePosition.z >
        stageFiveHoles[0].maxZ + 0.2,
    `공중 Pawn이 구멍을 건너지 못했습니다: position=${JSON.stringify(airbornePosition)}, minY=${minimumY}`,
  );
  console.log(
    `[통과 c] 실제 낙하 제거=${fallSteps} step, 공중 통과=${airborneSteps} step final=(${airbornePosition.x.toFixed(6)},${airbornePosition.y.toFixed(6)},${airbornePosition.z.toFixed(6)})`,
  );

  const runSlideProbe = async (stageNumber) => {
    const { runtime } = await createStageRuntime(
      modules,
      meta,
      stageNumber,
      undefined,
      [pawnInstance],
    );
    const binding = runtime.pieces.get(pawnInstance.id);
    placePiece(
      binding,
      { x: -1.35, y: binding.spawnTranslation.y, z: -0.8 },
      { x: 0, y: 0, z: 1.2 },
    );
    for (let step = 0; step < 120; step += 1) {
      runtime.world.step();
    }
    return {
      position: { ...binding.body.translation() },
      velocity: { ...binding.body.linvel() },
    };
  };
  const singleSlab = await runSlideProbe(2);
  const splitFloor = await runSlideProbe(5);
  const seamPositionDelta = Math.max(
    Math.abs(singleSlab.position.x - splitFloor.position.x),
    Math.abs(singleSlab.position.y - splitFloor.position.y),
    Math.abs(singleSlab.position.z - splitFloor.position.z),
  );
  const seamVelocityDelta = Math.max(
    Math.abs(singleSlab.velocity.x - splitFloor.velocity.x),
    Math.abs(singleSlab.velocity.y - splitFloor.velocity.y),
    Math.abs(singleSlab.velocity.z - splitFloor.velocity.z),
  );
  assertCondition(
    seamPositionDelta < 1e-4 && seamVelocityDelta < 1e-4,
    `온전한 바닥 경로가 분할 이음새에서 달라졌습니다: position=${seamPositionDelta}, velocity=${seamVelocityDelta}`,
  );
  console.log(
    `[통과 d] 단일 slab 대비 구멍 바닥 이음새: max position Δ=${seamPositionDelta.toExponential(3)}, velocity Δ=${seamVelocityDelta.toExponential(3)}`,
  );

  const giantCards = cards.createRunCardState();
  cards.applyCardPick(giantCards, "giantPawn");
  const proneCards = cards.createRunCardState();
  cards.applyCardPick(proneCards, "proneStart");
  const spawnMeasurements = [];
  for (const stageNumber of [5, 6]) {
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

  const wallMeasurements = [];
  for (const stageNumber of [5, 6]) {
    const { runtime } = await createStageRuntime(
      modules,
      meta,
      stageNumber,
    );
    modules.physics.preSettlePhysics(runtime);
    wallMeasurements.push(
      verifyBreakableWall(modules, runtime, stageNumber),
    );
  }
  console.log(
    `[통과 f] 함정 도면 파란 띠 벽 재사용: ${wallMeasurements.join(", ")}`,
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
