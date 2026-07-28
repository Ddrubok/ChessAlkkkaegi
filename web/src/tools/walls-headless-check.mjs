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
 * 벽 렌더 없이도 실제 낙하 제거 경로를 실행할 최소 씬 연결을 만든다.
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
 * 지정한 말만 원하는 자세와 속도로 옮겨 접촉 실험을 반복 가능하게 만든다.
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
 * 한 fixed step 뒤 실제 좁은 단계 접촉을 스캔하고 새 타격 목록을 돌려준다.
 */
function stepAndScan(modules, runtime) {
  runtime.world.step();
  return modules.physics.scanBreakableWallContacts(runtime);
}

/**
 * 확대 보드와 벽을 포함한 실제 스테이지 3 월드를 준비한다.
 */
async function createStageThreeRuntime(modules, meta) {
  const options = {
    gameMode: "stage",
    stageNumber: 3,
  };
  const runtime = await modules.physics.createPhysicsRuntime(
    meta,
    modules.layout.PIECE_INSTANCES,
    modules.stage.computeStageBoardHalfExtent(
      meta.cellSize,
      "stage",
      3,
    ),
    options,
  );
  modules.physics.preSettlePhysics(runtime);
  return { runtime, options };
}

/**
 * 조각 중앙의 안쪽 면에 말을 살짝 겹치게 놓아 정지 접촉을 만든다.
 */
function placeAgainstSouthWall(
  binding,
  wall,
  velocityX = 0,
  velocityZ = 0,
) {
  const halfDepth =
    binding.instance.type === "Pawn" ? 0.153 : 0.18;
  const innerFace =
    wall.definition.center.z +
    wall.definition.halfExtents.z;
  placePiece(
    binding,
    {
      x: wall.definition.center.x,
      y: binding.spawnTranslation.y,
      z: innerFace + halfDepth - 0.004,
    },
    { x: velocityX, y: 0, z: velocityZ },
  );
}

/**
 * 지정 조각을 두 번째 타격 대기 상태로 만들어 다음 step 제거 경로를 연다.
 */
function destroyWall(modules, runtime, wallId) {
  const wall = runtime.breakableWalls.get(wallId);
  assertCondition(wall !== undefined, `${wallId} 벽이 없습니다.`);
  wall.hitCount = 2;
  wall.pendingDestruction = true;
  const destroyed =
    modules.physics.applyPendingBreakableWallDestructions(
      runtime,
    );
  assertCondition(
    destroyed.join(",") === wallId,
    `${wallId} 제거 결과가 다릅니다: ${destroyed.join(",")}`,
  );
  return wall.definition;
}

/**
 * 열린 구멍으로 말을 직선 이동시켜 통과 또는 이웃 벽 반사를 측정한다.
 */
async function measureGapPassage(modules, meta, pieceId) {
  const { runtime } = await createStageThreeRuntime(
    modules,
    meta,
  );
  const definition = destroyWall(
    modules,
    runtime,
    "wall-south-3",
  );
  const binding = runtime.pieces.get(pieceId);
  assertCondition(binding !== undefined, `${pieceId} 말이 없습니다.`);
  placePiece(
    binding,
    {
      x: definition.center.x,
      y: binding.spawnTranslation.y,
      z: -runtime.boardHalfExtent + 0.42,
    },
    { x: 0, y: 0, z: -0.8 },
  );
  let minimumZ = binding.body.translation().z;
  for (let step = 0; step < 360; step += 1) {
    runtime.world.step();
    modules.physics.scanBreakableWallContacts(runtime);
    minimumZ = Math.min(minimumZ, binding.body.translation().z);
  }
  return {
    minimumZ,
    finalY: binding.body.translation().y,
    boardHalfExtent: runtime.boardHalfExtent,
  };
}

try {
  const [config, layout, physics, stage, tuning, turn, walls] =
    await Promise.all([
      vite.ssrLoadModule("/src/config.ts"),
      vite.ssrLoadModule("/src/layout.ts"),
      vite.ssrLoadModule("/src/physics.ts"),
      vite.ssrLoadModule("/src/stage.ts"),
      vite.ssrLoadModule("/src/tuning.ts"),
      vite.ssrLoadModule("/src/turn.ts"),
      vite.ssrLoadModule("/src/walls.ts"),
    ]);
  const modules = {
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

  const { runtime, options } =
    await createStageThreeRuntime(modules, meta);
  const wallId = "wall-south-1";
  const wall = runtime.breakableWalls.get(wallId);
  const firstPawn = runtime.pieces.get("white-pawn-h2");
  assertCondition(
    wall !== undefined && firstPawn !== undefined,
    "첫 접촉 검증용 벽 또는 Pawn이 없습니다.",
  );
  placeAgainstSouthWall(firstPawn, wall);
  const firstHits = stepAndScan(modules, runtime);
  assertCondition(
    firstHits.length === 1 &&
      firstHits[0].wallId === wallId &&
      firstHits[0].hitCount === 1 &&
      wall.hitCount === 1 &&
      !wall.pendingDestruction,
    `첫 접촉 계수가 다릅니다: ${JSON.stringify(firstHits)}`,
  );
  for (let repeat = 0; repeat < 30; repeat += 1) {
    placeAgainstSouthWall(firstPawn, wall, 0.01);
    stepAndScan(modules, runtime);
  }
  assertCondition(
    wall.hitCount === 1,
    `정지·슬라이딩 접촉이 ${wall.hitCount}회로 중복 계수됐습니다.`,
  );
  placePiece(
    firstPawn,
    {
      x: wall.definition.center.x,
      y: firstPawn.spawnTranslation.y,
      z: -runtime.boardHalfExtent + 0.8,
    },
    { x: 0, y: 0, z: 0 },
  );
  stepAndScan(modules, runtime);
  assertCondition(
    wall.touchingPieceIds.size === 0,
    `분리 step 뒤 접촉 집합이 비지 않았습니다: ${[...wall.touchingPieceIds].join(",")}`,
  );
  let rehit = [];
  for (let attempt = 0; attempt < 5 && rehit.length === 0; attempt += 1) {
    placeAgainstSouthWall(firstPawn, wall, 0, -0.2);
    rehit = stepAndScan(modules, runtime);
  }
  assertCondition(
    rehit.length === 1 &&
      rehit[0].hitCount === 2 &&
      wall.pendingDestruction,
    `분리 후 재접촉이 두 번째 타격이 아닙니다: ${JSON.stringify(rehit)}`,
  );
  const colliderCountBeforeDestroy = runtime.world.colliders.len();
  modules.physics.applyPendingBreakableWallDestructions(runtime);
  assertCondition(
    !runtime.breakableWalls.has(wallId) &&
      runtime.destroyedBreakableWallIds.has(wallId) &&
      runtime.world.colliders.len() ===
        colliderCountBeforeDestroy - 1,
    `${wallId} 두 번째 타격 뒤 콜라이더가 제거되지 않았습니다.`,
  );
  console.log(
    `[통과 a] 새 접촉 시퀀스: 0→1, 정지·슬라이딩 30 step=1, 분리→재접촉=2, 다음 step 콜라이더 ${colliderCountBeforeDestroy}→${runtime.world.colliders.len()}`,
  );
  console.log(
    `[통과 b] 첫 타격 균열 상태: hitCount=1, pendingDestruction=false; 두 번째 타격 뒤 destroyed=true`,
  );

  modules.physics.resetPhysicsPieces(
    runtime,
    meta,
    modules.layout.PIECE_INSTANCES,
    options,
  );
  const independentWall = runtime.breakableWalls.get(wallId);
  const pawn = runtime.pieces.get("white-pawn-h2");
  const secondPawn = runtime.pieces.get("white-pawn-g2");
  assertCondition(
    independentWall !== undefined &&
      pawn !== undefined &&
      secondPawn !== undefined,
    "서로 다른 말 접촉 검증 대상을 찾지 못했습니다.",
  );
  placeAgainstSouthWall(pawn, independentWall);
  stepAndScan(modules, runtime);
  placePiece(
    pawn,
    {
      x: independentWall.definition.center.x,
      y: pawn.spawnTranslation.y,
      z: -runtime.boardHalfExtent + 0.8,
    },
    { x: 0, y: 0, z: 0 },
  );
  stepAndScan(modules, runtime);
  let secondPieceHit = [];
  for (
    let attempt = 0;
    attempt < 5 && secondPieceHit.length === 0;
    attempt += 1
  ) {
    placeAgainstSouthWall(
      secondPawn,
      independentWall,
      0,
      -0.2,
    );
    secondPieceHit = stepAndScan(modules, runtime);
  }
  assertCondition(
    secondPieceHit.length === 1 &&
      secondPieceHit[0].pieceId === "white-pawn-g2" &&
      secondPieceHit[0].hitCount === 2,
    `두 번째 말의 독립 타격이 다릅니다: ${JSON.stringify(secondPieceHit)}`,
  );
  console.log(
    `[통과 c] 서로 다른 말: white-pawn-h2=1회, white-pawn-g2=2회 예약`,
  );

  const stageCounts = [];
  for (const stageNumber of [1, 2, 3, 4, 5, 6, 10]) {
    modules.physics.resetPhysicsBreakableWalls(
      runtime,
      meta,
      { gameMode: "stage", stageNumber },
    );
    stageCounts.push([
      stageNumber,
      runtime.breakableWalls.size,
    ]);
  }
  modules.physics.resetPhysicsBreakableWalls(
    runtime,
    meta,
    { gameMode: "hotseat", stageNumber: 3 },
  );
  const hotseatCount = runtime.breakableWalls.size;
  assertCondition(
    JSON.stringify(stageCounts) ===
      JSON.stringify([
        [1, 0],
        [2, 0],
        [3, 32],
        [4, 32],
        [5, 32],
        [6, 32],
        [10, 0],
      ]) &&
      hotseatCount === 0,
    `스테이지별 벽 수가 다릅니다: ${JSON.stringify(stageCounts)}, hotseat=${hotseatCount}`,
  );
  modules.physics.resetPhysicsBreakableWalls(
    runtime,
    meta,
    { gameMode: "stage", stageNumber: 3 },
  );
  const restoreWall = runtime.breakableWalls.get(wallId);
  assertCondition(restoreWall !== undefined, "복원 검증 벽이 없습니다.");
  restoreWall.hitCount = 2;
  restoreWall.pendingDestruction = true;
  modules.physics.applyPendingBreakableWallDestructions(runtime);
  modules.physics.resetPhysicsBreakableWalls(
    runtime,
    meta,
    { gameMode: "stage", stageNumber: 4 },
  );
  assertCondition(
    runtime.breakableWalls.size === 32 &&
      runtime.destroyedBreakableWallIds.size === 0 &&
      [...runtime.breakableWalls.values()].every(
        (binding) =>
          binding.hitCount === 0 &&
          !binding.pendingDestruction &&
          binding.touchingPieceIds.size === 0,
      ),
    "스테이지 전환에서 벽 상태가 완전히 복원되지 않았습니다.",
  );
  console.log(
    `[통과 d] 벽 범위·복원: stage=${stageCounts.map(([stageNumber, count]) => `${stageNumber}:${count}`).join(",")}, hotseat=${hotseatCount}, stage4 reset=32/32`,
  );

  const gapWidth = walls.computeBreakableWallGapWidth(
    runtime.boardHalfExtent,
    meta.cellSize,
  );
  const pawnPass = await measureGapPassage(
    modules,
    meta,
    "white-pawn-d2",
  );
  const kingBlock = await measureGapPassage(
    modules,
    meta,
    "white-king-e1",
  );
  assertCondition(
    pawnPass.minimumZ < -pawnPass.boardHalfExtent &&
      kingBlock.minimumZ >
        -kingBlock.boardHalfExtent - 0.05,
    `구멍 통과 판정이 다릅니다: Pawn=${JSON.stringify(pawnPass)}, King=${JSON.stringify(kingBlock)}`,
  );
  console.log(
    `[통과 e] 파괴 구멍=${gapWidth.toFixed(6)}, Pawn minZ=${pawnPass.minimumZ.toFixed(6)} 통과, King minZ=${kingBlock.minimumZ.toFixed(6)} 차단`,
  );

  const hopped = await createStageThreeRuntime(modules, meta);
  const hoppedPawn =
    hopped.runtime.pieces.get("white-pawn-d2");
  assertCondition(hoppedPawn !== undefined, "도약 검증 Pawn이 없습니다.");
  const sceneRuntime =
    createHeadlessSceneRuntime(hopped.runtime);
  const turnRuntime = turn.createTurnRuntime(
    hopped.runtime,
    sceneRuntime,
    tuning.createDefaultRuntimeTuningSettings(),
  );
  turnRuntime.phase = "settling";
  placePiece(
    hoppedPawn,
    {
      x:
        hopped.runtime.breakableWalls.get("wall-south-3")
          .definition.center.x,
      y:
        config.BREAKABLE_WALL_HEIGHT +
        hoppedPawn.localPieceHeight / 2 +
        0.08,
      z: -hopped.runtime.boardHalfExtent + 0.16,
    },
    { x: 0, y: 0.1, z: -2.2 },
  );
  let hopSteps = 0;
  while (
    hopped.runtime.pieces.has("white-pawn-d2") &&
    hopSteps < 900
  ) {
    turn.applyPendingLaunchBeforeStep(turnRuntime);
    hopped.runtime.world.step();
    turn.updateTurnAfterStep(
      turnRuntime,
      config.FIXED_STEP,
    );
    hopSteps += 1;
  }
  assertCondition(
    !hopped.runtime.pieces.has("white-pawn-d2"),
    `벽 위를 넘은 Pawn이 ${hopSteps} step 뒤에도 장외 제거되지 않았습니다.`,
  );
  console.log(
    `[통과 f] 벽 상단 도약 후 FALL_OUT_Y=${config.FALL_OUT_Y} 제거: ${hopSteps} step`,
  );

  const performanceRuntime =
    await createStageThreeRuntime(modules, meta);
  const scanCount = 1_000;
  const startedAt = performance.now();
  for (let scan = 0; scan < scanCount; scan += 1) {
    physics.scanBreakableWallContacts(
      performanceRuntime.runtime,
    );
  }
  const elapsed = performance.now() - startedAt;
  const perScan = elapsed / scanCount;
  assertCondition(
    perScan < config.FIXED_STEP * 1000,
    `벽 접촉 스캔 ${perScan.toFixed(3)}ms가 fixed-step 예산 ${(config.FIXED_STEP * 1000).toFixed(3)}ms를 넘습니다.`,
  );
  console.log(
    `[통과 g] 32말×32벽 narrow-phase 스캔: ${scanCount}회 ${elapsed.toFixed(3)}ms, 평균 ${perScan.toFixed(4)}ms/fixed-step`,
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
