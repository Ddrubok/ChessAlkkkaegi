import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  Box3,
  Mesh,
  MeshBasicMaterial,
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
 * 조건이 거짓이면 검증 이름과 실제 수치를 포함해 즉시 중단한다.
 */
function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * 실제 GLB에서 공유 렌더 지오메트리를 종류별로 읽는다.
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
  return geometries;
}

/**
 * 실제 바디 자세와 균일 배율로 검증용 Three 메시 연결표를 만든다.
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
 * 현재 메시의 월드 AABB 세로 길이를 반환한다.
 */
function measureWorldHeight(mesh) {
  mesh.updateMatrixWorld(true);
  return new Box3()
    .setFromObject(mesh)
    .getSize(new Vector3()).y;
}

/**
 * 의도된 스폰 위치에서 사전 안정화 뒤 최대 수평 이동량을 잰다.
 */
function measureMaximumSpawnDrift(runtime) {
  let maximumDrift = 0;
  let maximumPieceId = "";
  for (const binding of runtime.pieces.values()) {
    const translation = binding.body.translation();
    const drift = Math.hypot(
      translation.x - binding.spawnTranslation.x,
      translation.z - binding.spawnTranslation.z,
    );
    if (drift > maximumDrift) {
      maximumDrift = drift;
      maximumPieceId = binding.instance.id;
    }
  }
  return { maximumDrift, maximumPieceId };
}

/**
 * 바디 회전에서 로컬 위쪽 축을 월드 벡터로 변환한다.
 */
function computeWorldUp(body) {
  const rotation = body.rotation();
  return new Vector3(0, 1, 0).applyQuaternion(rotation);
}

try {
  const [
    cardsModule,
    configModule,
    layoutModule,
    physicsModule,
    stageModule,
    turnModule,
  ] = await Promise.all([
    vite.ssrLoadModule("/src/cards.ts"),
    vite.ssrLoadModule("/src/config.ts"),
    vite.ssrLoadModule("/src/layout.ts"),
    vite.ssrLoadModule("/src/physics.ts"),
    vite.ssrLoadModule("/src/stage.ts"),
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
  const geometries = await loadPieceGeometries(
    configModule.PIECE_TYPES,
  );

  const drawState = cardsModule.createRunCardState();
  const firstDraw = cardsModule.drawUpgradeCards(1, drawState);
  const repeatedDraw = cardsModule.drawUpgradeCards(1, drawState);
  const gradeEffects = [1, 2, 3, 4, 5].map((grade) =>
    cardsModule.computeCardGradeEffect(grade),
  );
  const replacementState = cardsModule.createRunCardState();
  const replacementEffects = [];
  for (let grade = 1; grade <= 5; grade += 1) {
    cardsModule.applyCardPick(replacementState, "weight");
    replacementEffects.push(
      cardsModule.computeGeneralCardEffect(
        replacementState,
        "weight",
      ),
    );
  }
  let legendBlocked = false;
  try {
    cardsModule.applyCardPick(replacementState, "weight");
  } catch {
    legendBlocked = true;
  }
  assertCondition(
    JSON.stringify(firstDraw.map((card) => card.id)) ===
      JSON.stringify(repeatedDraw.map((card) => card.id)) &&
      new Set(firstDraw.map((card) => card.id)).size ===
        firstDraw.length &&
      firstDraw.length === 3 &&
      firstDraw[0].category === "general" &&
      firstDraw[1].category === "general" &&
      JSON.stringify(gradeEffects) ===
        JSON.stringify([0.01, 0.03, 0.05, 0.07, 0.1]) &&
      JSON.stringify(replacementEffects) ===
        JSON.stringify(gradeEffects) &&
      replacementState.weightGrade === 5 &&
      legendBlocked,
    `등급 교체·레전드 상한·추첨 결정성 실패: draw=${firstDraw.map((card) => `${card.id}:${card.category}`).join(",")}, grades=${gradeEffects.join(",")}, replacements=${replacementEffects.join(",")}, blocked=${legendBlocked}`,
  );

  let thirdGeneral = 0;
  let thirdSpecial = 0;
  let distributionDeterministic = true;
  const distributionDraws = 1000;
  for (let stage = 1; stage <= distributionDraws; stage += 1) {
    const state = cardsModule.createRunCardState();
    const first = cardsModule.drawUpgradeCards(stage, state);
    const second = cardsModule.drawUpgradeCards(stage, state);
    distributionDeterministic &&=
      JSON.stringify(first.map((card) => card.id)) ===
      JSON.stringify(second.map((card) => card.id));
    assertCondition(
      first.length === 3 &&
        first[0].category === "general" &&
        first[1].category === "general",
      `${stage} 스테이지가 일반 카드 두 장을 보장하지 못했습니다: ${first.map((card) => `${card.id}:${card.category}`).join(",")}`,
    );
    if (first[2].category === "general") {
      thirdGeneral += 1;
    } else {
      thirdSpecial += 1;
    }
  }
  const observedGeneralRatio =
    thirdGeneral / distributionDraws;
  assertCondition(
    distributionDeterministic &&
      Math.abs(observedGeneralRatio - 0.7) <= 0.04,
    `세 번째 슬롯 70/30 결정 분포 실패: general=${thirdGeneral}, special=${thirdSpecial}, deterministic=${distributionDeterministic}`,
  );

  cardsModule.applyCardPick(drawState, "size");
  cardsModule.applyCardPick(drawState, "size");
  cardsModule.applyCardPick(drawState, "weight");
  cardsModule.applyCardPick(drawState, "force");
  cardsModule.applyCardPick(drawState, "force");
  cardsModule.applyCardPick(drawState, "giantPawn");
  cardsModule.applyCardPick(drawState, "proneStart");
  const remainingPool = cardsModule.getRemainingCardPool(drawState);
  assertCondition(
    drawState.sizeGrade === 2 &&
      drawState.weightGrade === 1 &&
      drawState.forceGrade === 2 &&
      drawState.picksSoFar === 7 &&
      remainingPool.length === 3 &&
      remainingPool.every((card) => !card.oneShot),
    `카드 등급·특수 풀 축소 실패: state=${JSON.stringify(drawState)}, pool=${remainingPool.map((card) => card.id).join(",")}`,
  );

  const shortPoolState = cardsModule.createRunCardState();
  for (const cardId of ["size", "weight"]) {
    for (let grade = 0; grade < 5; grade += 1) {
      cardsModule.applyCardPick(shortPoolState, cardId);
    }
  }
  for (let grade = 0; grade < 4; grade += 1) {
    cardsModule.applyCardPick(shortPoolState, "force");
  }
  cardsModule.applyCardPick(shortPoolState, "giantPawn");
  cardsModule.applyCardPick(shortPoolState, "proneStart");
  const shortDraw = cardsModule.drawUpgradeCards(
    20,
    shortPoolState,
  );
  assertCondition(
    shortDraw.length === 1 &&
      shortDraw[0].id === "force",
    `짧은 풀이 남은 카드만 표시하지 않았습니다: ${shortDraw.map((card) => card.id).join(",")}`,
  );

  const whiteKingInstance = layoutModule.PIECE_INSTANCES.find(
    (instance) => instance.id === "white-king-e1",
  );
  assertCondition(
    whiteKingInstance !== undefined,
    "크기 상한 검사용 백 킹 인스턴스를 찾지 못했습니다.",
  );
  const defaultLegendState = cardsModule.createRunCardState();
  for (let grade = 0; grade < 5; grade += 1) {
    cardsModule.applyCardPick(defaultLegendState, "size");
  }
  const defaultLegendScale =
    stageModule.computeStagePieceScale(
      whiteKingInstance,
      meta,
      {
        gameMode: "stage",
        stageNumber: 1,
        runCards: defaultLegendState,
      },
    );
  const cappedPoolState = cardsModule.createRunCardState();
  cardsModule.applyCardPick(cappedPoolState, "giantPawn");
  cardsModule.applyCardPick(cappedPoolState, "proneStart");
  const capTestEffectScale = 3;
  for (let grade = 0; grade < 4; grade += 1) {
    cardsModule.applyCardPick(
      cappedPoolState,
      "size",
      capTestEffectScale,
    );
  }
  const cappedPool = cardsModule.getRemainingCardPool(
    cappedPoolState,
    capTestEffectScale,
  );
  const cappedDraw = cardsModule.drawUpgradeCards(
    20,
    cappedPoolState,
    capTestEffectScale,
  );
  const cappedScale = stageModule.computeStagePieceScale(
    whiteKingInstance,
    meta,
    {
      gameMode: "stage",
      stageNumber: 1,
      runCards: cappedPoolState,
      cardEffectScale: capTestEffectScale,
    },
  );
  assertCondition(
    defaultLegendScale === 1.1 &&
      cappedScale === configModule.PLAYER_MAX_SIZE_SCALE &&
    JSON.stringify(cappedPool.map((card) => card.id)) ===
      JSON.stringify(["weight", "force"]) &&
      cappedDraw.length === 2,
    `크기 상한 풀 제거 실패: defaultLegend=${defaultLegendScale}, tunedCap=${cappedScale}, pool=${cappedPool.map((card) => card.id).join(",")}, draw=${cappedDraw.map((card) => card.id).join(",")}`,
  );
  console.log(
    `[통과 a] grades=${gradeEffects.map((effect) => `${Math.round(effect * 100)}%`).join("/")}, replacement=true, legendBlocked=${legendBlocked}; draw=${firstDraw.map((card) => card.id).join(",")}, firstTwo=general/general; third(${distributionDraws})=general:${thirdGeneral}/special:${thirdSpecial}; shortPool=${shortDraw.map((card) => card.id).join(",")}; defaultLegendScale=${defaultLegendScale.toFixed(2)}, tunedCapScale=${cappedScale.toFixed(2)}, cappedPool=${cappedPool.map((card) => card.id).join(",")}`,
  );

  const giantState = cardsModule.createRunCardState();
  cardsModule.applyCardPick(giantState, "giantPawn");
  const giantOptions = {
    gameMode: "stage",
    stageNumber: 1,
    runCards: giantState,
  };
  const giantRuntime = await physicsModule.createPhysicsRuntime(
    meta,
    layoutModule.PIECE_INSTANCES,
    boardHalfExtent,
    giantOptions,
  );
  const giantMeshes = createPieceMeshes(giantRuntime, geometries);
  const whitePawnBindings = [...giantRuntime.pieces.values()].filter(
    (binding) =>
      binding.instance.side === "white" &&
      binding.instance.type === "Pawn",
  );
  const whitePawnFiles = whitePawnBindings.map(
    (binding) => binding.instance.startingSquare.file,
  );
  const giantPawn = giantRuntime.pieces.get("white-pawn-b2");
  const whiteKing = giantRuntime.pieces.get("white-king-e1");
  assertCondition(
    giantRuntime.pieces.size === 28 &&
      JSON.stringify(whitePawnFiles) ===
        JSON.stringify(["b", "d", "f", "h"]) &&
      giantPawn !== undefined &&
      whiteKing !== undefined,
    `거대 폰 스폰 목록 실패: pieces=${giantRuntime.pieces.size}, pawns=${whitePawnFiles.join(",")}`,
  );
  for (const binding of whitePawnBindings) {
    const inlineCenter = layoutModule.getCellCenter(
      binding.instance.startingSquare,
      meta.cellSize,
    );
    assertCondition(
      Math.abs(binding.spawnTranslation.z - inlineCenter.z) < 1e-9,
      `${binding.instance.id} 거대 폰에 불필요한 지그재그가 적용됐습니다.`,
    );
  }
  const giantPawnHeight = measureWorldHeight(
    giantMeshes.pieceMeshes.get(giantPawn.instance.id),
  );
  const whiteKingHeight = measureWorldHeight(
    giantMeshes.pieceMeshes.get(whiteKing.instance.id),
  );
  const giantHeightDifference = Math.abs(
    giantPawnHeight - whiteKingHeight,
  );
  const giantSettle = physicsModule.preSettlePhysics(giantRuntime);
  const giantDrift = measureMaximumSpawnDrift(giantRuntime);
  const giantSleeping = [...giantRuntime.pieces.values()].filter(
    (binding) => binding.body.isSleeping(),
  ).length;
  assertCondition(
    giantHeightDifference < 1e-3 &&
      giantSleeping === 28 &&
      giantDrift.maximumDrift < 0.05,
    `거대 폰 검증 실패: heightΔ=${giantHeightDifference}, sleeping=${giantSleeping}/28, maxDrift=${giantDrift.maximumDrift}`,
  );
  console.log(
    `[통과 b] pieces=28, pawns=${whitePawnFiles.join(",")}, pawnHeight=${giantPawnHeight.toFixed(6)}, kingHeight=${whiteKingHeight.toFixed(6)}, |Δ|=${giantHeightDifference.toExponential(3)}, preSettle=${giantSettle.steps}, sleeping=${giantSleeping}/28, maxDrift=${giantDrift.maximumDrift.toFixed(6)} (${giantDrift.maximumPieceId})`,
  );

  const stackedGiantState = cardsModule.createRunCardState();
  cardsModule.applyCardPick(stackedGiantState, "giantPawn");
  for (let grade = 0; grade < 4; grade += 1) {
    cardsModule.applyCardPick(
      stackedGiantState,
      "size",
      capTestEffectScale,
    );
  }
  const stackedGiantRuntime =
    await physicsModule.createPhysicsRuntime(
      meta,
      layoutModule.PIECE_INSTANCES,
      boardHalfExtent,
      {
        gameMode: "stage",
        stageNumber: 1,
        runCards: stackedGiantState,
        cardEffectScale: capTestEffectScale,
      },
    );
  let stackedGiantSettle = null;
  try {
    stackedGiantSettle =
      physicsModule.preSettlePhysics(stackedGiantRuntime);
  } catch (error) {
    const bindings = [...stackedGiantRuntime.pieces.values()];
    const sleeping = bindings.filter(
      (binding) => binding.body.isSleeping(),
    ).length;
    const drift = measureMaximumSpawnDrift(stackedGiantRuntime);
    const awakeIds = bindings
      .filter((binding) => !binding.body.isSleeping())
      .map((binding) => binding.instance.id);
    const worstDrifts = bindings
      .map((binding) => {
        const translation = binding.body.translation();
        return {
          id: binding.instance.id,
          drift: Math.hypot(
            translation.x - binding.spawnTranslation.x,
            translation.z - binding.spawnTranslation.z,
          ),
          x: translation.x,
          y: translation.y,
          z: translation.z,
        };
      })
      .sort((left, right) => right.drift - left.drift)
      .slice(0, 5);
    const fallenIds = bindings
      .filter(
        (binding) =>
          binding.body.translation().y < configModule.FALL_OUT_Y,
      )
      .map((binding) => binding.instance.id);
    console.error(
      `[실패 b-상한] giantPawn+sizeGrade4×3: sleeping=${sleeping}/28, awake=${awakeIds.join(",")}, fallen=${fallenIds.join(",") || "none"}, maxDrift=${drift.maximumDrift.toFixed(6)} (${drift.maximumPieceId}), worst=${JSON.stringify(worstDrifts)}`,
    );
    throw error;
  }
  const stackedGiantDrift = measureMaximumSpawnDrift(
    stackedGiantRuntime,
  );
  const stackedGiantSleeping = [
    ...stackedGiantRuntime.pieces.values(),
  ].filter((binding) => binding.body.isSleeping()).length;
  const stackedGiantScale = stackedGiantRuntime.pieces.get(
    "white-pawn-b2",
  ).uniformScale;
  const stackedWhiteKingScale = stackedGiantRuntime.pieces.get(
    "white-king-e1",
  ).uniformScale;
  const stackedGiantFlare =
    stageModule.computeScaledPawnSupportFlareDiameter(
      meta,
      stackedGiantScale,
    );
  const stackedGiantFallen = [
    ...stackedGiantRuntime.pieces.values(),
  ].filter(
    (binding) =>
      binding.body.translation().y < configModule.FALL_OUT_Y,
  );
  assertCondition(
    stackedGiantScale === configModule.STAGE_MAX_PIECE_SCALE &&
      stackedWhiteKingScale ===
        configModule.PLAYER_MAX_SIZE_SCALE &&
      stackedGiantFlare + 0.02 < meta.cellSize * 2 &&
      stackedGiantSleeping === 28 &&
      stackedGiantDrift.maximumDrift < 0.1 &&
      stackedGiantFallen.length === 0,
    `거대 폰+크기 상한 보드 안전 실패: pawnScale=${stackedGiantScale}, regularScale=${stackedWhiteKingScale}, flare=${stackedGiantFlare}, sleeping=${stackedGiantSleeping}/28, maxDrift=${stackedGiantDrift.maximumDrift}, fallen=${stackedGiantFallen.length}`,
  );
  console.log(
    `[통과 b-상한] giantPawn+sizeGrade4×3: pawnScale=${stackedGiantScale.toFixed(6)}, regularScale=${stackedWhiteKingScale.toFixed(6)}, flare+margin=${(stackedGiantFlare + 0.02).toFixed(6)}<twoCells=${(meta.cellSize * 2).toFixed(6)}, preSettle=${stackedGiantSettle.steps}, sleeping=${stackedGiantSleeping}/28, fallen=0, maxDrift=${stackedGiantDrift.maximumDrift.toFixed(6)} (${stackedGiantDrift.maximumPieceId})`,
  );

  const proneState = cardsModule.createRunCardState();
  cardsModule.applyCardPick(proneState, "proneStart");
  const proneRuntime = await physicsModule.createPhysicsRuntime(
    meta,
    layoutModule.PIECE_INSTANCES,
    boardHalfExtent,
    {
      gameMode: "stage",
      stageNumber: 1,
      runCards: proneState,
    },
  );
  let proneSettle = null;
  try {
    proneSettle = physicsModule.preSettlePhysics(proneRuntime);
  } catch (error) {
    const awake = [...proneRuntime.pieces.values()]
      .filter((binding) => !binding.body.isSleeping())
      .map((binding) => {
        const linear = binding.body.linvel();
        const angular = binding.body.angvel();
        return `${binding.instance.id}(v=${Math.hypot(linear.x, linear.y, linear.z).toFixed(5)},w=${Math.hypot(angular.x, angular.y, angular.z).toFixed(5)})`;
      });
    console.error(
      `[실패 c] proneStart sleeping=${32 - awake.length}/32, awake=${awake.join(",")}`,
    );
    throw error;
  }
  let maximumUpAngle = 0;
  let maximumUpAnglePieceId = "";
  const fallenWhiteIds = [];
  for (const binding of proneRuntime.pieces.values()) {
    if (binding.instance.side !== "white") {
      continue;
    }
    const up = computeWorldUp(binding.body);
    const horizontalAngle =
      Math.asin(Math.min(1, Math.abs(up.y))) * (180 / Math.PI);
    if (horizontalAngle > maximumUpAngle) {
      maximumUpAngle = horizontalAngle;
      maximumUpAnglePieceId = binding.instance.id;
    }
    if (binding.body.translation().y < configModule.FALL_OUT_Y) {
      fallenWhiteIds.push(binding.instance.id);
    }
  }
  const proneSleeping = [...proneRuntime.pieces.values()].filter(
    (binding) => binding.body.isSleeping(),
  ).length;
  assertCondition(
    proneSleeping === 32 &&
      maximumUpAngle <= 25 &&
      fallenWhiteIds.length === 0,
    `포복 개시 검증 실패: sleeping=${proneSleeping}/32, maxUpAngle=${maximumUpAngle}, fallen=${fallenWhiteIds.join(",")}`,
  );
  console.log(
    `[통과 c] preSettle=${proneSettle.steps}, sleeping=${proneSleeping}/32, maxLocalUpHorizontalAngle=${maximumUpAngle.toFixed(6)}° (${maximumUpAnglePieceId}), fallen=0`,
  );

  const forceState = cardsModule.createRunCardState();
  cardsModule.applyCardPick(forceState, "force");
  cardsModule.applyCardPick(forceState, "force");
  cardsModule.applyCardPick(forceState, "force");
  const forceOptions = {
    gameMode: "stage",
    stageNumber: 1,
    runCards: forceState,
  };
  const forceRuntime = await physicsModule.createPhysicsRuntime(
    meta,
    layoutModule.PIECE_INSTANCES,
    boardHalfExtent,
    forceOptions,
  );
  physicsModule.preSettlePhysics(forceRuntime);
  const forceScene = createPieceMeshes(forceRuntime, geometries);
  const forceTurn = turnModule.createTurnRuntime(
    forceRuntime,
    forceScene,
    {
      maxLaunchSpeed: configModule.MAX_LAUNCH_SPEED,
      strikeHeightRatio: configModule.STRIKE_HEIGHT_RATIO,
    },
  );
  const launchedBinding = forceRuntime.pieces.get("white-pawn-e2");
  assertCondition(
    launchedBinding !== undefined,
    "힘 카드 검사용 백 폰을 찾지 못했습니다.",
  );
  const power = 0.4;
  const speedMultiplier =
    cardsModule.computePlayerLaunchSpeedMultiplier(
      "stage",
      forceState,
    );
  const velocityBefore = launchedBinding.body.linvel();
  const queued = turnModule.queueTurnLaunch(forceTurn, {
    pieceId: launchedBinding.instance.id,
    direction: new Vector3(0, 0, 1),
    normalizedPower: power,
    applicationPoint: launchedBinding.body.worldCom(),
    speedMultiplier,
  });
  assertCondition(queued.accepted, `힘 카드 발사 큐 거절: ${queued.reason}`);
  turnModule.applyPendingLaunchBeforeStep(forceTurn);
  const velocityAfter = launchedBinding.body.linvel();
  const measuredDeltaVelocity = Math.hypot(
    velocityAfter.x - velocityBefore.x,
    velocityAfter.y - velocityBefore.y,
    velocityAfter.z - velocityBefore.z,
  );
  const expectedDeltaVelocity =
    power * configModule.MAX_LAUNCH_SPEED * speedMultiplier;
  const forceError =
    Math.abs(measuredDeltaVelocity - expectedDeltaVelocity) /
    expectedDeltaVelocity;
  assertCondition(
    forceError < 0.01,
    `힘 카드 Δv 실패: expected=${expectedDeltaVelocity}, actual=${measuredDeltaVelocity}`,
  );
  console.log(
    `[통과 d] picks=3, multiplier=${speedMultiplier.toFixed(6)}, expectedΔv=${expectedDeltaVelocity.toFixed(6)}, actualΔv=${measuredDeltaVelocity.toFixed(6)}, error=${(forceError * 100).toFixed(6)}%`,
  );
} finally {
  await vite.close();
}
