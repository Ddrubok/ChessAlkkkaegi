import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  Box3,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Scene,
  Vector3,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createServer } from "vite";

const webRoot = fileURLToPath(new URL("../..", import.meta.url));
const vite = await createServer({
  root: webRoot,
  logLevel: "error",
  appType: "custom",
  server: { middlewareMode: true },
});

/**
 * 조건이 거짓이면 검증 이름과 함께 즉시 중단한다.
 */
function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * 실제 GLB의 말 지오메트리를 종류별로 읽어 렌더 높이 검사에 제공한다.
 */
async function loadPieceGeometries(pieceTypes) {
  const bytes = await readFile(
    new URL("../../public/assets/chess-pieces.glb", import.meta.url),
  );
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
  const gltf = await new Promise((resolve, reject) => {
    new GLTFLoader().parse(arrayBuffer, "", resolve, reject);
  });
  const geometries = new Map();
  gltf.scene.traverse((object) => {
    if (object.isMesh && pieceTypes.includes(object.name)) {
      object.geometry.computeBoundingBox();
      geometries.set(object.name, object.geometry);
    }
  });
  for (const type of pieceTypes) {
    if (!geometries.has(type)) {
      throw new Error(`GLB에서 ${type} 지오메트리를 찾지 못했습니다.`);
    }
  }
  return geometries;
}

/**
 * 실제 바디 자세와 저장된 균일 배율을 반영한 검사용 메시를 만든다.
 */
function createPieceMeshes(physicsRuntime, geometries) {
  const scene = new Scene();
  const pieceMeshes = new Map();
  const material = new MeshBasicMaterial();
  for (const binding of physicsRuntime.pieces.values()) {
    const mesh = new Mesh(
      geometries.get(binding.instance.type),
      material,
    );
    const translation = binding.body.translation();
    const rotation = binding.body.rotation();
    mesh.name = binding.instance.id;
    mesh.position.set(translation.x, translation.y, translation.z);
    mesh.quaternion.set(
      rotation.x,
      rotation.y,
      rotation.z,
      rotation.w,
    );
    mesh.scale.setScalar(binding.uniformScale);
    mesh.updateMatrixWorld(true);
    scene.add(mesh);
    pieceMeshes.set(binding.instance.id, mesh);
  }
  return { scene, pieceMeshes, controls: { enabled: true } };
}

/**
 * 메시의 현재 world AABB 세로 길이를 반환한다.
 */
function measureWorldHeight(mesh) {
  mesh.updateMatrixWorld(true);
  return new Box3()
    .setFromObject(mesh)
    .getSize(new Vector3()).y;
}

/**
 * 선택 전후 전체 메시 transform 불변과 실제 배율 AABB 안의 공전 중심을 함께 검증한다.
 */
function verifySelectionPreservesMeshes(
  inputModule,
  physicsRuntime,
  sceneRuntime,
  pieceId,
) {
  const before = new Map(
    [...sceneRuntime.pieceMeshes].map(([id, mesh]) => [
      id,
      {
        position: mesh.position.toArray(),
        quaternion: mesh.quaternion.toArray(),
        scale: mesh.scale.toArray(),
        matrixWorld: mesh.matrixWorld.elements.slice(),
      },
    ]),
  );
  const runtime = {
    aimRuntime: { selectedPieceId: pieceId },
    physicsRuntime,
    sceneRuntime,
  };
  const center = inputModule.getSelectedTarget(runtime);
  const binding = physicsRuntime.pieces.get(pieceId);
  const mesh = sceneRuntime.pieceMeshes.get(pieceId);
  assertCondition(
    binding !== undefined && mesh !== undefined,
    `${pieceId} 선택 검사용 바디 또는 메시가 없습니다.`,
  );
  const translation = binding.body.translation();
  const rotation = binding.body.rotation();
  const matrix = new Matrix4().compose(
    new Vector3(translation.x, translation.y, translation.z),
    new Quaternion(rotation.x, rotation.y, rotation.z, rotation.w),
    mesh.scale,
  );
  const bounds = mesh.geometry.boundingBox
    .clone()
    .applyMatrix4(matrix);
  assertCondition(
    [center.x, center.y, center.z].every(Number.isFinite) &&
      bounds.containsPoint(center),
    `${pieceId} 공전 중심이 유한한 실제 world AABB 내부가 아닙니다: center=${center.toArray()}, bounds=${bounds.min.toArray()}..${bounds.max.toArray()}`,
  );
  for (const [id, candidate] of sceneRuntime.pieceMeshes) {
    const snapshot = before.get(id);
    const current = {
      position: candidate.position.toArray(),
      quaternion: candidate.quaternion.toArray(),
      scale: candidate.scale.toArray(),
      matrixWorld: candidate.matrixWorld.elements.slice(),
    };
    assertCondition(
      JSON.stringify(current) === JSON.stringify(snapshot),
      `${pieceId} 선택이 ${id} 메시 transform을 변경했습니다: before=${JSON.stringify(snapshot)}, after=${JSON.stringify(current)}`,
    );
  }
  return {
    scaleBefore: before.get(pieceId).scale[0],
    scaleAfter: mesh.scale.x,
    center,
  };
}

/**
 * 사전 안정화 뒤 각 말이 의도된 스폰 중심에서 움직인 최대 수평 거리를 측정한다.
 */
function settleAndMeasureSpawn(physicsModule, runtime) {
  const settle = physicsModule.preSettlePhysics(runtime);
  let maximumSpawnDrift = 0;
  let maximumDriftPieceId = "";
  let maximumDriftX = 0;
  let maximumDriftZ = 0;
  for (const binding of runtime.pieces.values()) {
    const translation = binding.body.translation();
    const driftX = translation.x - binding.spawnTranslation.x;
    const driftZ = translation.z - binding.spawnTranslation.z;
    const spawnDrift = Math.hypot(driftX, driftZ);
    if (spawnDrift > maximumSpawnDrift) {
      maximumSpawnDrift = spawnDrift;
      maximumDriftPieceId = binding.instance.id;
      maximumDriftX = driftX;
      maximumDriftZ = driftZ;
    }
  }
  const sleepingCount = [...runtime.pieces.values()].filter(
    (binding) => binding.body.isSleeping(),
  ).length;
  return {
    settle,
    sleepingCount,
    maximumSpawnDrift,
    maximumDriftPieceId,
    maximumDriftX,
    maximumDriftZ,
  };
}

try {
  const [
    aiModule,
    boardModule,
    configModule,
    inputModule,
    layoutModule,
    physicsModule,
    stageModule,
    tuningModule,
    turnModule,
  ] = await Promise.all([
    vite.ssrLoadModule("/src/ai.ts"),
    vite.ssrLoadModule("/src/board.ts"),
    vite.ssrLoadModule("/src/config.ts"),
    vite.ssrLoadModule("/src/input.ts"),
    vite.ssrLoadModule("/src/layout.ts"),
    vite.ssrLoadModule("/src/physics.ts"),
    vite.ssrLoadModule("/src/stage.ts"),
    vite.ssrLoadModule("/src/tuning.ts"),
    vite.ssrLoadModule("/src/turn.ts"),
  ]);
  const meta = JSON.parse(
    await readFile(
      new URL("../../public/assets/chess-set.meta.json", import.meta.url),
      "utf8",
    ),
  );
  const boardHalfExtent = configModule.deriveBoardHalfExtent(
    meta.cellSize,
  );
  const stageBoardHalfExtent = (gameMode, stageNumber) =>
    stageModule.computeStageBoardHalfExtent(
      meta.cellSize,
      gameMode,
      stageNumber,
    );
  const geometries = await loadPieceGeometries(
    configModule.PIECE_TYPES,
  );

  const boardMeasurements = [
    ["stage1", "stage", 1],
    ["stage2", "stage", 2],
    ["stage10", "stage", 10],
    ["hotseat", "hotseat", 10],
    ["online", "online", 10],
  ].map(([label, gameMode, stageNumber]) => ({
    label,
    halfExtent: stageBoardHalfExtent(gameMode, stageNumber),
  }));
  const measurementMap = new Map(
    boardMeasurements.map(({ label, halfExtent }) => [
      label,
      halfExtent,
    ]),
  );
  assertCondition(
    measurementMap.get("stage1") === boardHalfExtent &&
      measurementMap.get("stage2") ===
        boardHalfExtent * configModule.STAGE_BOARD_SCALE &&
      measurementMap.get("stage10") ===
        boardHalfExtent * configModule.STAGE_BOARD_SCALE &&
      measurementMap.get("hotseat") === boardHalfExtent &&
      measurementMap.get("online") === boardHalfExtent,
    `모드·스테이지 판 반폭이 확정 배율과 다릅니다: ${JSON.stringify(boardMeasurements)}`,
  );
  const stage2Layout = boardModule.computeBoardSurfaceLayout(
    meta.cellSize,
    measurementMap.get("stage2"),
  );
  const baseCheckerHalfExtent =
    boardHalfExtent -
    configModule.BOARD_BORDER_CELLS * meta.cellSize;
  const marginSurfaceKind = boardModule.classifyBoardSurface(
    baseCheckerHalfExtent + meta.cellSize * 0.5,
    meta.cellSize * 0.25,
    stage2Layout,
  );
  const newRimSurfaceKind = boardModule.classifyBoardSurface(
    stage2Layout.outerHalfExtent - stage2Layout.rimWidth * 0.5,
    0,
    stage2Layout,
  );
  const stage2Geometry = boardModule.createBoardGeometry(
    stage2Layout.outerHalfExtent,
    meta.boardThickness,
  );
  stage2Geometry.computeBoundingBox();
  const stage2GeometryBounds = stage2Geometry.boundingBox;
  assertCondition(
    stage2GeometryBounds !== null &&
      Math.abs(
        stage2GeometryBounds.min.x +
          stage2Layout.outerHalfExtent,
      ) < 1e-6 &&
      Math.abs(
        stage2GeometryBounds.max.x -
          stage2Layout.outerHalfExtent,
      ) < 1e-6 &&
      Math.abs(
        stage2GeometryBounds.min.z +
          stage2Layout.outerHalfExtent,
      ) < 1e-6 &&
      Math.abs(
        stage2GeometryBounds.max.z -
          stage2Layout.outerHalfExtent,
      ) < 1e-6 &&
      marginSurfaceKind !== "wood" &&
      newRimSurfaceKind === "wood",
    `확대 보드 렌더 표면 구성 실패: bounds=${JSON.stringify(stage2GeometryBounds)}, margin=${marginSurfaceKind}, rim=${newRimSurfaceKind}`,
  );
  stage2Geometry.dispose();
  console.log(
    `[통과 board] half=${boardMeasurements.map(({ label, halfExtent }) => `${label}:${halfExtent.toFixed(6)}`).join(",")}, margin=${marginSurfaceKind}, newRim=${newRimSurfaceKind}, checkerHalf=${stage2Layout.checkerHalfExtent.toFixed(6)}`,
  );

  let verifiedSpawnCount = 0;
  for (let stageNumber = 1; stageNumber <= 10; stageNumber += 1) {
    const options = { gameMode: "stage", stageNumber };
    for (const instance of stageModule.selectStageSpawnInstances(
      layoutModule.PIECE_INSTANCES,
      options,
    )) {
      const expected = layoutModule.getCellCenter(
        instance.startingSquare,
        meta.cellSize,
      );
      const fileIndex =
        instance.startingSquare.file.charCodeAt(0) -
        "a".charCodeAt(0);
      if (
        fileIndex % 2 === 1 &&
        stageModule.shouldUsePawnZigzag(
          instance,
          meta,
          meta.cellSize,
          options,
        )
      ) {
        expected.z +=
          instance.side === "black"
            ? -meta.cellSize
            : meta.cellSize;
      }
      const actual = stageModule.computeStageSpawnCenter(
        instance,
        meta,
        options,
      );
      assertCondition(
        Object.is(actual.x, expected.x) &&
          Object.is(actual.z, expected.z),
        `${instance.id} 스테이지 ${stageNumber} 여백식 스폰 좌표가 기존 값과 달라졌습니다: expected=${JSON.stringify(expected)}, actual=${JSON.stringify(actual)}`,
      );
      verifiedSpawnCount += 1;
    }
  }
  const whitePawnA = layoutModule.PIECE_INSTANCES.find(
    (instance) => instance.id === "white-pawn-a2",
  );
  const whitePawnB = layoutModule.PIECE_INSTANCES.find(
    (instance) => instance.id === "white-pawn-b2",
  );
  assertCondition(
    whitePawnA !== undefined && whitePawnB !== undefined,
    "셀 확대 역전 검사용 백 폰을 찾지 못했습니다.",
  );
  const scaledCenterA = stageModule.computeStageSpawnCenter(
    whitePawnA,
    meta,
    { gameMode: "stage", stageNumber: 2 },
    true,
  );
  const scaledCenterB = stageModule.computeStageSpawnCenter(
    whitePawnB,
    meta,
    { gameMode: "stage", stageNumber: 2 },
    true,
  );
  const scaledSpacing = Math.hypot(
    scaledCenterA.x - scaledCenterB.x,
    scaledCenterA.z - scaledCenterB.z,
  );
  assertCondition(
    configModule.STAGE_BOARD_EXPANSION_SCALES_CELLS === false &&
      Math.abs(
        scaledSpacing -
          meta.cellSize * configModule.STAGE_BOARD_SCALE,
      ) < 1e-12,
    `셀 확대 역전 경로 간격 실패: ${scaledSpacing}`,
  );
  console.log(
    `[통과 spawn-margin] baselineBitExact=${verifiedSpawnCount}, reversalSpacing=${scaledSpacing.toFixed(6)}, defaultSwitch=${configModule.STAGE_BOARD_EXPANSION_SCALES_CELLS}`,
  );

  const aiEdgeProbeBoard = [
    { id: "black-a-chain", side: "black", x: -1, z: 0 },
    { id: "black-z-edge", side: "black", x: 2, z: 2 },
    { id: "white-a-central", side: "white", x: 0, z: 0 },
    { id: "white-b-central-back", side: "white", x: 1, z: 0 },
    { id: "white-y-edge-inner", side: "white", x: 3, z: 2 },
    { id: "white-z-edge-outer", side: "white", x: 4, z: 2 },
  ];
  const aiEdgeDecision = aiModule.decideAiShot(
    aiEdgeProbeBoard,
    1,
    0,
    4,
  );
  const oldAiEdgeDistance =
    configModule.deriveBoardHalfExtent(1) - 4;
  const enlargedAiEdgeDistance =
    stageModule.computeStageBoardHalfExtent(1, "stage", 4) - 4;
  assertCondition(
    aiEdgeDecision?.pieceId === "black-z-edge" &&
      aiEdgeDecision.targetPieceId === "white-z-edge-outer" &&
      enlargedAiEdgeDistance > oldAiEdgeDistance,
    `확대 외곽 AI 거리 기준 실패: decision=${JSON.stringify(aiEdgeDecision)}, old=${oldAiEdgeDistance}, enlarged=${enlargedAiEdgeDistance}`,
  );
  console.log(
    `[통과 ai-edge] preChoice=black-z-edge→white-z-edge-outer, postChoice=${aiEdgeDecision.pieceId}→${aiEdgeDecision.targetPieceId}, targetEdgeDistance=${oldAiEdgeDistance.toFixed(6)}→${enlargedAiEdgeDistance.toFixed(6)} (현재 상대순위는 동일)`,
  );

  const buffTable = [];
  for (let stageNumber = 1; stageNumber <= 12; stageNumber += 1) {
    const actual = stageModule.computeStageBuffs(stageNumber);
    const expected = {
      weightSteps: Math.floor(stageNumber / 2),
      forceSteps:
        stageNumber < 3 ? 0 : Math.floor((stageNumber - 1) / 2),
      sizeSteps: Math.floor(stageNumber / 3),
      pawnTier:
        stageNumber >= 10
          ? "king"
          : stageNumber >= 5
            ? "rook"
            : "none",
    };
    assertCondition(
      JSON.stringify(actual) === JSON.stringify(expected),
      `스테이지 ${stageNumber} 버프 표 불일치: expected=${JSON.stringify(expected)}, actual=${JSON.stringify(actual)}`,
    );
    buffTable.push({ stage: stageNumber, ...actual });
  }
  console.log(`[통과 a] N=1..12 버프 표: ${JSON.stringify(buffTable)}`);

  const stageSettleMeasurements = [];
  for (let stageNumber = 1; stageNumber <= 10; stageNumber += 1) {
    const options = { gameMode: "stage", stageNumber };
    const runtime = await physicsModule.createPhysicsRuntime(
      meta,
      layoutModule.PIECE_INSTANCES,
      stageBoardHalfExtent("stage", stageNumber),
      options,
    );
    const settle = physicsModule.preSettlePhysics(runtime);
    const expectedPieceCount =
      stageModule.selectStageSpawnInstances(
        layoutModule.PIECE_INSTANCES,
        options,
      ).length;
    const sleepingCount = [...runtime.pieces.values()].filter(
      (binding) => binding.body.isSleeping(),
    ).length;
    assertCondition(
      sleepingCount === expectedPieceCount,
      `스테이지 ${stageNumber} 확대 보드 정착 실패: ${sleepingCount}/${expectedPieceCount}`,
    );
    stageSettleMeasurements.push({
      stageNumber,
      halfExtent: runtime.boardHalfExtent,
      sleepingCount,
      steps: settle.steps,
    });
  }
  console.log(
    `[통과 board-settle] ${stageSettleMeasurements.map((entry) => `S${entry.stageNumber}:${entry.sleepingCount}@${entry.steps}`).join(",")}`,
  );

  const rebuildProbeRuntime =
    await physicsModule.createPhysicsRuntime(
      meta,
      [whitePawnA],
      boardHalfExtent,
      { gameMode: "hotseat", stageNumber: 1 },
    );
  const rebuildProbeBinding =
    rebuildProbeRuntime.pieces.get(whitePawnA.id);
  const rebuildPoseBefore = {
    translation: { ...rebuildProbeBinding.body.translation() },
    rotation: { ...rebuildProbeBinding.body.rotation() },
  };
  physicsModule.rebuildPhysicsBoard(
    rebuildProbeRuntime,
    meta,
    stageBoardHalfExtent("stage", 2),
  );
  const rebuildPoseAfter = {
    translation: { ...rebuildProbeBinding.body.translation() },
    rotation: { ...rebuildProbeBinding.body.rotation() },
  };
  const rebuiltHalfExtents =
    rebuildProbeRuntime.boardCollider.halfExtents();
  assertCondition(
    JSON.stringify(rebuildPoseAfter) ===
      JSON.stringify(rebuildPoseBefore) &&
      rebuildProbeRuntime.boardHalfExtent ===
        stage2Layout.outerHalfExtent &&
      Math.abs(
        rebuiltHalfExtents.x - stage2Layout.outerHalfExtent,
      ) < 1e-6 &&
      Math.abs(
        rebuiltHalfExtents.z - stage2Layout.outerHalfExtent,
      ) < 1e-6,
    `고정 바닥 재구축이 말 자세 또는 물리 반폭을 바꿨습니다: before=${JSON.stringify(rebuildPoseBefore)}, after=${JSON.stringify(rebuildPoseAfter)}, collider=${JSON.stringify(rebuiltHalfExtents)}`,
  );

  const runEdgeProbe = async (centerX) => {
    const runtime = await physicsModule.createPhysicsRuntime(
      meta,
      [whitePawnA],
      stage2Layout.outerHalfExtent,
      { gameMode: "stage", stageNumber: 2 },
    );
    const binding = runtime.pieces.get(whitePawnA.id);
    const start = binding.body.translation();
    binding.body.setTranslation(
      { x: centerX, y: start.y, z: 0 },
      true,
    );
    binding.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    binding.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    let steps = 0;
    while (
      steps < configModule.PRE_SETTLE_MAX_STEPS &&
      binding.body.translation().y >= configModule.FALL_OUT_Y
    ) {
      runtime.world.step();
      steps += 1;
    }
    return {
      y: binding.body.translation().y,
      steps,
      sleeping: binding.body.isSleeping(),
    };
  };
  const pawnHorizontalRadius = Math.max(
    ...meta.pieces.Pawn.colliderPoints.map(([x, , z]) =>
      Math.hypot(x, z),
    ),
  );
  const oldEdgeProbe = await runEdgeProbe(
    boardHalfExtent + meta.cellSize * 0.1,
  );
  const newEdgeProbe = await runEdgeProbe(
    stage2Layout.outerHalfExtent +
      pawnHorizontalRadius +
      meta.cellSize * 0.02,
  );
  assertCondition(
    oldEdgeProbe.y >= configModule.FALL_OUT_Y &&
      oldEdgeProbe.sleeping &&
      newEdgeProbe.y < configModule.FALL_OUT_Y,
    `확대 여백 장외 프로브 실패: old=${JSON.stringify(oldEdgeProbe)}, new=${JSON.stringify(newEdgeProbe)}`,
  );
  console.log(
    `[통과 edge] oldEdge+0.1cell y=${oldEdgeProbe.y.toFixed(6)} sleeping=${oldEdgeProbe.sleeping}, newEdge+radius y=${newEdgeProbe.y.toFixed(6)} fallStep=${newEdgeProbe.steps}, renderHalf=physicsHalf=${stage2Layout.outerHalfExtent.toFixed(6)}`,
  );

  const baselineRuntime = await physicsModule.createPhysicsRuntime(
    meta,
    layoutModule.PIECE_INSTANCES,
    boardHalfExtent,
  );
  const baselineMassByType = new Map();
  for (const binding of baselineRuntime.pieces.values()) {
    if (!baselineMassByType.has(binding.instance.type)) {
      baselineMassByType.set(
        binding.instance.type,
        binding.originalHullMass,
      );
    }
  }

  const stage10Options = {
    gameMode: "stage",
    stageNumber: 10,
  };
  const stage10Runtime = await physicsModule.createPhysicsRuntime(
    meta,
    layoutModule.PIECE_INSTANCES,
    stageBoardHalfExtent("stage", 10),
    stage10Options,
  );
  const stage10Scene = createPieceMeshes(
    stage10Runtime,
    geometries,
  );
  const blackPawn = stage10Runtime.pieces.get("black-pawn-a7");
  const blackKing = stage10Runtime.pieces.get("black-king-e8");
  assertCondition(
    blackPawn !== undefined && blackKing !== undefined,
    "스테이지 10 높이 검사용 흑 폰 또는 킹을 찾지 못했습니다.",
  );
  const pawnHeight = measureWorldHeight(
    stage10Scene.pieceMeshes.get(blackPawn.instance.id),
  );
  const kingHeight = measureWorldHeight(
    stage10Scene.pieceMeshes.get(blackKing.instance.id),
  );
  const heightDifference = Math.abs(pawnHeight - kingHeight);
  assertCondition(
    heightDifference < 1e-3,
    `스테이지 10 흑 폰·킹 높이 차이가 큽니다: ${heightDifference}`,
  );
  // Rapier는 추가 질량 속성을 다음 물리 스텝에서 최종 질량에 반영한다.
  stage10Runtime.world.step();
  const stage10Buffs = stageModule.computeStageBuffs(10);
  const stageWeightFraction =
    configModule.STAGE_WEIGHT_STEP * stage10Buffs.weightSteps;
  let maximumMassRelativeError = 0;
  for (const binding of stage10Runtime.pieces.values()) {
    const baselineMass = baselineMassByType.get(binding.instance.type);
    const expectedHullMass =
      baselineMass * binding.uniformScale ** 3;
    const expectedStageFraction =
      binding.instance.side === "black"
        ? stageWeightFraction
        : 0;
    const expectedMass =
      expectedHullMass * (1 + expectedStageFraction);
    const relativeError =
      Math.abs(binding.body.mass() - expectedMass) / expectedMass;
    maximumMassRelativeError = Math.max(
      maximumMassRelativeError,
      relativeError,
    );
    assertCondition(
      relativeError < 0.01,
      `${binding.instance.id} 스테이지 질량 오차 ${(relativeError * 100).toFixed(4)}%`,
    );
    if (binding.instance.side === "white") {
      assertCondition(
        binding.uniformScale === 1 &&
          binding.upgradeAdditionalMass === 0,
        `${binding.instance.id} 백 말에 스테이지 버프가 적용됐습니다.`,
      );
    }
  }
  const tuningRuntime = {
    physicsRuntime: stage10Runtime,
    settings: {
      timeScale: configModule.TIME_SCALE,
      maxLaunchSpeed: configModule.MAX_LAUNCH_SPEED,
      friction: configModule.PIECE_FRICTION,
      restitution: configModule.PIECE_RESTITUTION,
      linearDamping: configModule.PIECE_LINEAR_DAMPING,
      angularDamping: configModule.PIECE_ANGULAR_DAMPING,
      baseWeightMultiplier: 0.25,
      initialAimPitch: configModule.CAM_INITIAL_AIM_PITCH_DEG,
      cameraKeyDegreesPerSecond: configModule.CAM_KEY_DEG_PER_SEC,
      strikeHeightRatio: configModule.STRIKE_HEIGHT_RATIO,
    },
    controls: new Map(),
    pendingPhysicsVerification: false,
    panel: {},
    wakeAllHandler: null,
  };
  tuningModule.reapplyTuningPhysicsSettings(tuningRuntime);
  stage10Runtime.world.step();
  tuningModule.verifyTuningAfterStep(tuningRuntime);
  const composedExpectedMass =
    blackPawn.originalHullMass *
    (1 +
      0.25 +
      blackPawn.upgradeAdditionalMass /
        blackPawn.originalHullMass);
  const composedRelativeError =
    Math.abs(blackPawn.body.mass() - composedExpectedMass) /
    composedExpectedMass;
  assertCondition(
    composedRelativeError < 0.01,
    `스테이지+조절판 질량 합성 오차 ${(composedRelativeError * 100).toFixed(4)}%`,
  );
  console.log(
    `[통과 b] stage10: pawnHeight=${pawnHeight.toFixed(6)}, kingHeight=${kingHeight.toFixed(6)}, |Δ|=${heightDifference.toExponential(3)}, maxMassError=${(maximumMassRelativeError * 100).toFixed(6)}%, tuningComposeError=${(composedRelativeError * 100).toFixed(6)}%`,
  );

  const stage6Runtime = await physicsModule.createPhysicsRuntime(
    meta,
    layoutModule.PIECE_INSTANCES,
    stageBoardHalfExtent("stage", 6),
    { gameMode: "stage", stageNumber: 6 },
  );
  const stage6Scene = createPieceMeshes(stage6Runtime, geometries);
  const nonPawnSelection = verifySelectionPreservesMeshes(
    inputModule,
    stage6Runtime,
    stage6Scene,
    "black-rook-a8",
  );
  const pawnSelection = verifySelectionPreservesMeshes(
    inputModule,
    stage10Runtime,
    stage10Scene,
    "black-pawn-a7",
  );
  console.log(
    `[통과 selection-scale] stage6 black-rook-a8 scale=${nonPawnSelection.scaleBefore.toFixed(6)}→${nonPawnSelection.scaleAfter.toFixed(6)}, center=(${nonPawnSelection.center.toArray().map((value) => value.toFixed(6)).join(",")}); stage10 black-pawn-a7 scale=${pawnSelection.scaleBefore.toFixed(6)}→${pawnSelection.scaleAfter.toFixed(6)}, center=(${pawnSelection.center.toArray().map((value) => value.toFixed(6)).join(",")}); 모든 메시 transform 유지, 공전 중심 actual-scale AABB 내부`,
  );

  const stage5Options = {
    gameMode: "stage",
    stageNumber: 5,
  };
  const stage5Runtime = await physicsModule.createPhysicsRuntime(
    meta,
    layoutModule.PIECE_INSTANCES,
    stageBoardHalfExtent("stage", 5),
    stage5Options,
  );
  const stage5BlackPawns = [...stage5Runtime.pieces.values()].filter(
    (binding) =>
      binding.instance.side === "black" &&
      binding.instance.type === "Pawn",
  );
  let stage5MaximumRankOffset = 0;
  for (const binding of stage5BlackPawns) {
    const inlineCenter = layoutModule.getCellCenter(
      binding.instance.startingSquare,
      meta.cellSize,
    );
    stage5MaximumRankOffset = Math.max(
      stage5MaximumRankOffset,
      Math.abs(binding.spawnTranslation.z - inlineCenter.z),
    );
  }
  assertCondition(
    stage5MaximumRankOffset < 1e-9 &&
      stage5BlackPawns.every(
        (binding) =>
          !stageModule.shouldUsePawnZigzag(
            binding.instance,
            meta,
            meta.cellSize,
            stage5Options,
          ),
      ),
    `스테이지 5 룩 티어 폰에 지그재그가 적용됐습니다: maxOffset=${stage5MaximumRankOffset}`,
  );
  physicsModule.preSettlePhysics(stage5Runtime);
  const stage5Scene = createPieceMeshes(stage5Runtime, geometries);
  const stage5Turn = turnModule.createTurnRuntime(
    stage5Runtime,
    stage5Scene,
    {
      maxLaunchSpeed: configModule.MAX_LAUNCH_SPEED,
      strikeHeightRatio: configModule.STRIKE_HEIGHT_RATIO,
    },
  );
  turnModule.setTurnGameMode(stage5Turn, "stage");
  stage5Turn.currentSide = "black";
  const stage5Ai = aiModule.createAiRuntime(
    stage5Runtime,
    stage5Scene,
    stage5Turn,
    meta.cellSize,
    () => "stage",
    () => 5,
  );
  aiModule.updateAiRuntime(stage5Ai, 0);
  aiModule.updateAiRuntime(stage5Ai, 800);
  const queuedLaunch = stage5Turn.pendingLaunch;
  assertCondition(
    queuedLaunch !== null,
    "스테이지 5 AI 발사가 큐에 들어가지 않았습니다.",
  );
  const launchedBinding = stage5Runtime.pieces.get(
    queuedLaunch.pieceId,
  );
  const beforeVelocity = launchedBinding.body.linvel();
  turnModule.applyPendingLaunchBeforeStep(stage5Turn);
  const afterVelocity = launchedBinding.body.linvel();
  const measuredDeltaVelocity = Math.hypot(
    afterVelocity.x - beforeVelocity.x,
    afterVelocity.y - beforeVelocity.y,
    afterVelocity.z - beforeVelocity.z,
  );
  const expectedSpeedMultiplier =
    stageModule.computeStageAiSpeedMultiplier(stage5Options);
  const expectedDeltaVelocity =
    queuedLaunch.normalizedPower *
    configModule.MAX_LAUNCH_SPEED *
    expectedSpeedMultiplier;
  const speedRelativeError =
    Math.abs(measuredDeltaVelocity - expectedDeltaVelocity) /
    expectedDeltaVelocity;
  assertCondition(
    Math.abs(expectedSpeedMultiplier - 1.1) < 1e-12 &&
      speedRelativeError < 0.01,
    `스테이지 5 AI Δv 실패: multiplier=${expectedSpeedMultiplier}, expected=${expectedDeltaVelocity}, actual=${measuredDeltaVelocity}`,
  );
  console.log(
    `[통과 c] stage5 AI: power=${queuedLaunch.normalizedPower.toFixed(6)}, multiplier=${expectedSpeedMultiplier.toFixed(6)}, expectedΔv=${expectedDeltaVelocity.toFixed(6)}, actualΔv=${measuredDeltaVelocity.toFixed(6)}, error=${(speedRelativeError * 100).toFixed(6)}%`,
  );
  console.log(
    `[통과 d3] stage5 inline pawns: maxRankOffset=${stage5MaximumRankOffset.toFixed(6)}`,
  );

  const stage12Options = {
    gameMode: "stage",
    stageNumber: 12,
  };
  const stage12Runtime = await physicsModule.createPhysicsRuntime(
    meta,
    layoutModule.PIECE_INSTANCES,
    stageBoardHalfExtent("stage", 12),
    stage12Options,
  );
  const stage12PawnScale = stage12Runtime.pieces.get(
    "black-pawn-a7",
  ).uniformScale;
  const expectedStage12MovedPawnIds = [
    "black-pawn-b7",
    "black-pawn-d7",
    "black-pawn-f7",
    "black-pawn-h7",
  ];
  const stage12BlackPawns = [
    ...stage12Runtime.pieces.values(),
  ].filter(
    (binding) =>
      binding.instance.side === "black" &&
      binding.instance.type === "Pawn",
  );
  const stage12MovedPawnIds = stage12BlackPawns
    .filter((binding) => {
      const inlineCenter = layoutModule.getCellCenter(
        binding.instance.startingSquare,
        meta.cellSize,
      );
      return (
        Math.abs(
          binding.spawnTranslation.z -
            (inlineCenter.z - meta.cellSize),
        ) < 1e-9
      );
    })
    .map((binding) => binding.instance.id);
  const stage12InlinePawnIds = stage12BlackPawns
    .filter((binding) => {
      const inlineCenter = layoutModule.getCellCenter(
        binding.instance.startingSquare,
        meta.cellSize,
      );
      return (
        Math.abs(binding.spawnTranslation.z - inlineCenter.z) < 1e-9
      );
    })
    .map((binding) => binding.instance.id);
  assertCondition(
    JSON.stringify(stage12MovedPawnIds) ===
      JSON.stringify(expectedStage12MovedPawnIds) &&
      stage12InlinePawnIds.length === 4,
    `스테이지 12 지그재그 배치가 b,d,f,h와 다릅니다: moved=${stage12MovedPawnIds.join(",")}, inline=${stage12InlinePawnIds.join(",")}`,
  );
  const stage12MovedPawnCount = stage12MovedPawnIds.length;
  const stage12Spawn = settleAndMeasureSpawn(
    physicsModule,
    stage12Runtime,
  );
  assertCondition(
    stage12Spawn.sleepingCount === 32 &&
      stage12Spawn.maximumSpawnDrift < 0.05,
    `스테이지 12 스폰 안전 실패: sleeping=${stage12Spawn.sleepingCount}/32, maxDrift=${stage12Spawn.maximumSpawnDrift}`,
  );
  console.log(
    `[통과 d1] stage12 spawn: scale=${stage12PawnScale.toFixed(6)}, zigzag=${stage12MovedPawnCount}/8, preSettle=${stage12Spawn.settle.steps} step, sleeping=${stage12Spawn.sleepingCount}/32, maxXZDrift=${stage12Spawn.maximumSpawnDrift.toFixed(6)} (${stage12Spawn.maximumDriftPieceId})`,
  );

  const stage30Options = {
    gameMode: "stage",
    stageNumber: 30,
  };
  const stage30Runtime = await physicsModule.createPhysicsRuntime(
    meta,
    layoutModule.PIECE_INSTANCES,
    stageBoardHalfExtent("stage", 30),
    stage30Options,
  );
  const stage30PawnScale = stage30Runtime.pieces.get(
    "black-pawn-a7",
  ).uniformScale;
  assertCondition(
    Math.abs(
      stage30PawnScale - configModule.STAGE_MAX_PIECE_SCALE,
    ) < 1e-9,
    `스테이지 30 폰 배율 상한 실패: ${stage30PawnScale}`,
  );
  const stage30Spawn = settleAndMeasureSpawn(
    physicsModule,
    stage30Runtime,
  );
  const stage30ExitedPieceIds = [
    ...stage30Runtime.pieces.values(),
  ]
    .filter(
      (binding) =>
        binding.body.translation().y < configModule.FALL_OUT_Y,
    )
    .map((binding) => binding.instance.id);
  const basePawnFlare = stageModule
    .computeScaledPawnSupportFlareDiameter(meta, 1);
  const stage5PawnScale = stage5BlackPawns[0].uniformScale;
  const stage5PawnFlare = stageModule
    .computeScaledPawnSupportFlareDiameter(meta, stage5PawnScale);
  const stage12PawnFlare = stageModule
    .computeScaledPawnSupportFlareDiameter(meta, stage12PawnScale);
  const stage30PawnFlare = stageModule
    .computeScaledPawnSupportFlareDiameter(meta, stage30PawnScale);
  console.log(
    `[기하] cell=${meta.cellSize.toFixed(6)}, diagonal=${Math.hypot(meta.cellSize, meta.cellSize).toFixed(6)}, baseFlare=${basePawnFlare.toFixed(6)}, stage5=${stage5PawnFlare.toFixed(6)}(+0.02=${(stage5PawnFlare + 0.02).toFixed(6)}), stage12=${stage12PawnFlare.toFixed(6)}(+0.02=${(stage12PawnFlare + 0.02).toFixed(6)}), stage30=${stage30PawnFlare.toFixed(6)}(+0.02=${(stage30PawnFlare + 0.02).toFixed(6)})`,
  );
  if (stage30Spawn.maximumSpawnDrift >= 0.1) {
    console.error(
      `[실패 d2] stage30 spawn: clampedScale=${stage30PawnScale.toFixed(6)}, preSettle=${stage30Spawn.settle.steps} step, sleeping=${stage30Spawn.sleepingCount}/32, maxXZDrift=${stage30Spawn.maximumSpawnDrift.toFixed(6)} (${stage30Spawn.maximumDriftPieceId}), vector=(${stage30Spawn.maximumDriftX.toFixed(6)}, ${stage30Spawn.maximumDriftZ.toFixed(6)})`,
    );
  }
  // 상한 배율 스테이지에서는 인접 말의 미세 겹침이 사전 정착으로 풀리며 약간의 재배치가 생긴다. 판정 기준은 수면 32/32와 비이탈이고, 0.10은 칸의 19%로 육안 배치가 유지되는 수준이다.
  assertCondition(
    stage30Spawn.sleepingCount === 32 &&
      stage30ExitedPieceIds.length === 0 &&
      stage30Spawn.maximumSpawnDrift < 0.1,
    `스테이지 30 스폰 안전 실패: sleeping=${stage30Spawn.sleepingCount}/32, exited=${stage30ExitedPieceIds.join(",") || "none"}, maxDrift=${stage30Spawn.maximumSpawnDrift}, piece=${stage30Spawn.maximumDriftPieceId}`,
  );
  console.log(
    `[통과 d2] stage30 spawn: clampedScale=${stage30PawnScale.toFixed(6)}, preSettle=${stage30Spawn.settle.steps} step, sleeping=${stage30Spawn.sleepingCount}/32, exited=0, maxXZDrift=${stage30Spawn.maximumSpawnDrift.toFixed(6)} (${stage30Spawn.maximumDriftPieceId})`,
  );
} finally {
  await vite.close();
}
