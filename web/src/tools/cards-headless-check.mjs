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
 * 두 월드 AABB의 여섯 경계 좌표 가운데 가장 큰 오차를 반환한다.
 */
function measureAabbError(actual, expected) {
  return Math.max(
    Math.abs(actual.min.x - expected.min.x),
    Math.abs(actual.min.y - expected.min.y),
    Math.abs(actual.min.z - expected.min.z),
    Math.abs(actual.max.x - expected.max.x),
    Math.abs(actual.max.y - expected.max.y),
    Math.abs(actual.max.z - expected.max.z),
  );
}

/**
 * Rapier 볼록껍질의 로컬 축 길이를 원본 점 집합과 비교해 실제 균일 배율과 축간 오차를 잰다.
 */
function measureColliderUniformScale(binding, colliderPoints) {
  const vertices = binding.collider.vertices();
  const sourceMinimum = [Infinity, Infinity, Infinity];
  const sourceMaximum = [-Infinity, -Infinity, -Infinity];
  const colliderMinimum = [Infinity, Infinity, Infinity];
  const colliderMaximum = [-Infinity, -Infinity, -Infinity];
  for (const point of colliderPoints) {
    for (let axis = 0; axis < 3; axis += 1) {
      sourceMinimum[axis] = Math.min(sourceMinimum[axis], point[axis]);
      sourceMaximum[axis] = Math.max(sourceMaximum[axis], point[axis]);
    }
  }
  for (let index = 0; index < vertices.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = vertices[index + axis];
      colliderMinimum[axis] = Math.min(colliderMinimum[axis], value);
      colliderMaximum[axis] = Math.max(colliderMaximum[axis], value);
    }
  }
  const ratios = sourceMinimum.map((minimum, axis) => {
    const sourceSpan = sourceMaximum[axis] - minimum;
    const colliderSpan =
      colliderMaximum[axis] - colliderMinimum[axis];
    return colliderSpan / sourceSpan;
  });
  const average =
    ratios.reduce((sum, value) => sum + value, 0) / ratios.length;
  return {
    average,
    maximumAxisError: Math.max(
      ...ratios.map((value) => Math.abs(value - average)),
    ),
  };
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
    aimModule,
    aimParametersModule,
    cardTuningModule,
    cardsModule,
    configModule,
    layoutModule,
    physicsModule,
    sceneModule,
    stageModule,
    turnModule,
  ] = await Promise.all([
    vite.ssrLoadModule("/src/aim.ts"),
    vite.ssrLoadModule("/src/aimparams.ts"),
    vite.ssrLoadModule("/src/card-tuning.ts"),
    vite.ssrLoadModule("/src/cards.ts"),
    vite.ssrLoadModule("/src/config.ts"),
    vite.ssrLoadModule("/src/layout.ts"),
    vite.ssrLoadModule("/src/physics.ts"),
    vite.ssrLoadModule("/src/scene.ts"),
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
  const giantPawnSizeMultiplier =
    meta.pieces.King.bounds.y / meta.pieces.Pawn.bounds.y;
  const panelSettings =
    cardTuningModule.createDefaultCardTuningSettings(
      giantPawnSizeMultiplier,
    );
  panelSettings.debugWeightGrade = 4;
  const panelProfile =
    cardTuningModule.createCardEffectTuning(panelSettings);
  const playGradeState = cardsModule.createRunCardState();
  for (let grade = 0; grade < 4; grade += 1) {
    cardsModule.applyCardPick(playGradeState, "weight");
  }
  const playGradeEffect = cardsModule.computeGeneralCardEffect(
    playGradeState,
    "weight",
  );
  const panelGradeEffect =
    cardsModule.computeTunedGeneralCardEffect(
      "hotseat",
      cardsModule.createRunCardState(),
      "weight",
      1,
      panelProfile,
    );
  panelSettings.weightEffectMultiplier = 1.5;
  const multipliedProfile =
    cardTuningModule.createCardEffectTuning(panelSettings);
  const multipliedWeightEffect =
    cardsModule.computeTunedGeneralCardEffect(
      "stage",
      playGradeState,
      "weight",
      1,
      multipliedProfile,
    );
  cardsModule.applyCardPick(playGradeState, "weight");
  const composedGrade = cardsModule.computeEffectiveGeneralCardGrade(
    "stage",
    playGradeState,
    "weight",
    multipliedProfile,
  );
  panelSettings.debugForceGrade = 5;
  panelSettings.debugSizeGrade = 5;
  panelSettings.gradeEffect5 = 0.5;
  panelSettings.forceEffectMultiplier = 5;
  panelSettings.sizeEffectMultiplier = 5;
  panelSettings.giantPawnEnabled = true;
  panelSettings.proneStartEnabled = true;
  const extremeProfile =
    cardTuningModule.createCardEffectTuning(panelSettings);
  const emptyState = cardsModule.createRunCardState();
  const whiteKingInstance = layoutModule.PIECE_INSTANCES.find(
    (instance) => instance.id === "white-king-e1",
  );
  assertCondition(
    whiteKingInstance !== undefined,
    "카드 조절 검증용 백 킹 인스턴스를 찾지 못했습니다.",
  );
  const onlineOptions = {
    gameMode: "online",
    stageNumber: 1,
    cardTuning: extremeProfile,
  };
  const onlineScale = stageModule.computeStagePieceScale(
    whiteKingInstance,
    meta,
    onlineOptions,
  );
  const onlineWeight = stageModule.computeUpgradeWeightFraction(
    whiteKingInstance,
    onlineOptions,
  );
  const onlineForce =
    cardsModule.computePlayerLaunchSpeedMultiplier(
      "online",
      emptyState,
      0,
      1,
      extremeProfile,
    );
  const onlineSpawnCount =
    stageModule.selectStageSpawnInstances(
      layoutModule.PIECE_INSTANCES,
      onlineOptions,
    ).length;
  const blackKingInstance = layoutModule.PIECE_INSTANCES.find(
    (instance) => instance.id === "black-king-e8",
  );
  assertCondition(
    blackKingInstance !== undefined,
    "카드 조절 검증용 흑 킹 인스턴스를 찾지 못했습니다.",
  );
  const hotseatOptions = {
    gameMode: "hotseat",
    stageNumber: 1,
    cardTuning: extremeProfile,
  };
  const hotseatWhiteScale = stageModule.computeStagePieceScale(
    whiteKingInstance,
    meta,
    hotseatOptions,
  );
  const hotseatBlackScale = stageModule.computeStagePieceScale(
    blackKingInstance,
    meta,
    hotseatOptions,
  );
  const hotseatWhiteWeight =
    stageModule.computeUpgradeWeightFraction(
      whiteKingInstance,
      hotseatOptions,
    );
  const hotseatBlackWeight =
    stageModule.computeUpgradeWeightFraction(
      blackKingInstance,
      hotseatOptions,
    );
  const hotseatSpawnCount =
    stageModule.selectStageSpawnInstances(
      layoutModule.PIECE_INSTANCES,
      hotseatOptions,
    ).length;
  const hotseatPronePose = stageModule.computeStageSpawnPose(
    whiteKingInstance,
    meta,
    hotseatOptions,
  );
  const specialSettings =
    cardTuningModule.createDefaultCardTuningSettings(
      giantPawnSizeMultiplier,
    );
  specialSettings.giantPawnEnabled = true;
  specialSettings.giantPawnSizeMultiplier = 1.5;
  const customGiantOptions = {
    gameMode: "hotseat",
    stageNumber: 1,
    cardTuning:
      cardTuningModule.createCardEffectTuning(specialSettings),
  };
  const whitePawnInstance = layoutModule.PIECE_INSTANCES.find(
    (instance) => instance.id === "white-pawn-b2",
  );
  assertCondition(
    whitePawnInstance !== undefined,
    "거대 폰 배수 검증용 백 폰 인스턴스를 찾지 못했습니다.",
  );
  const customGiantScale = stageModule.computeStagePieceScale(
    whitePawnInstance,
    meta,
    customGiantOptions,
  );
  const corruptStorage = {
    getItem: () => "{손상",
    setItem: () => {},
    removeItem: () => {},
  };
  const corruptLoad =
    cardTuningModule.loadCardTuningSettings(
      corruptStorage,
      giantPawnSizeMultiplier,
    );
  const defaultPanelSettings =
    cardTuningModule.createDefaultCardTuningSettings(
      giantPawnSizeMultiplier,
    );
  const storedCardTuningValues = new Map();
  const auditedStorage = {
    getItem: (key) => storedCardTuningValues.get(key) ?? null,
    setItem: (key, value) => {
      storedCardTuningValues.set(key, value);
    },
    removeItem: (key) => {
      storedCardTuningValues.delete(key);
    },
  };
  const defaultSaveWarning =
    cardTuningModule.saveCardTuningSettings(
      auditedStorage,
      defaultPanelSettings,
    );
  const storedDefaults = JSON.parse(
    auditedStorage.getItem(
      cardTuningModule.CARD_TUNING_STORAGE_KEY,
    ),
  );
  const gradeChangedSettings = {
    ...defaultPanelSettings,
    debugForceGrade: 2,
  };
  const gradeSaveWarning =
    cardTuningModule.saveCardTuningSettings(
      auditedStorage,
      gradeChangedSettings,
    );
  const gradeChangedLoad =
    cardTuningModule.loadCardTuningSettings(
      auditedStorage,
      giantPawnSizeMultiplier,
    );
  const storageMultipliersStayedDefault =
    storedDefaults.weightEffectMultiplier === 1 &&
    storedDefaults.forceEffectMultiplier === 1 &&
    storedDefaults.sizeEffectMultiplier === 1 &&
    gradeChangedLoad.settings.debugForceGrade === 2 &&
    gradeChangedLoad.settings.weightEffectMultiplier === 1 &&
    gradeChangedLoad.settings.forceEffectMultiplier === 1 &&
    gradeChangedLoad.settings.sizeEffectMultiplier === 1;

  const relayoutSettings = {
    ...defaultPanelSettings,
    debugWeightGrade: 3,
    debugSizeGrade: 5,
    giantPawnEnabled: true,
    proneStartEnabled: true,
  };
  const relayoutRunCards = cardsModule.createRunCardState();
  cardsModule.applyCardPick(relayoutRunCards, "force");
  const relayoutSnapshot = {
    gameMode: "stage",
    stageNumber: 4,
    runCardsSignature: JSON.stringify(relayoutRunCards),
    permanentUpgradesSignature: JSON.stringify({
      preserved: true,
    }),
    points: 123,
  };
  let relayoutApplied = null;
  await cardTuningModule.relayoutCurrentCardTuningBoard(
    () => ({ ...relayoutSnapshot }),
    async (gameMode, stageNumber) => {
      const cardTuning =
        cardTuningModule.createCardEffectTuning(
          relayoutSettings,
        );
      const options = {
        gameMode,
        stageNumber,
        runCards: relayoutRunCards,
        cardTuning,
      };
      relayoutApplied = {
        gameMode,
        stageNumber,
        weight: cardsModule.computeTunedGeneralCardEffect(
          gameMode,
          relayoutRunCards,
          "weight",
          1,
          cardTuning,
        ),
        size: stageModule.computeStagePieceScale(
          whiteKingInstance,
          meta,
          options,
        ),
        pieces: stageModule.selectStageSpawnInstances(
          layoutModule.PIECE_INSTANCES,
          options,
        ).length,
        proneRotationX: stageModule.computeStageSpawnPose(
          whiteKingInstance,
          meta,
          options,
        ).rotation.x,
      };
    },
  );
  const relayoutPreservedState =
    relayoutApplied !== null &&
    relayoutApplied.gameMode === relayoutSnapshot.gameMode &&
    relayoutApplied.stageNumber === relayoutSnapshot.stageNumber &&
    relayoutSnapshot.runCardsSignature ===
      JSON.stringify(relayoutRunCards) &&
    relayoutSnapshot.permanentUpgradesSignature ===
      JSON.stringify({ preserved: true }) &&
    relayoutSnapshot.points === 123;
  assertCondition(
    Math.abs(playGradeEffect - panelGradeEffect) < 1e-12 &&
      Math.abs(multipliedWeightEffect - playGradeEffect * 1.5) <
        1e-12 &&
      composedGrade === 5 &&
      onlineScale === 1 &&
      onlineWeight === 0 &&
      onlineForce === 1 &&
      onlineSpawnCount === 32 &&
      hotseatWhiteScale === configModule.PLAYER_MAX_SIZE_SCALE &&
      hotseatBlackScale === 1 &&
      Math.abs(hotseatWhiteWeight - 0.105) < 1e-12 &&
      hotseatBlackWeight === 0 &&
      hotseatSpawnCount === 28 &&
      Math.abs(hotseatPronePose.rotation.x - Math.SQRT1_2) <
        1e-12 &&
      customGiantScale === 1.5 &&
      JSON.stringify(corruptLoad.settings) ===
        JSON.stringify(defaultPanelSettings) &&
      corruptLoad.warning !== null &&
      defaultSaveWarning === null &&
      gradeSaveWarning === null &&
      storageMultipliersStayedDefault &&
      relayoutPreservedState &&
      Math.abs(relayoutApplied.weight - 0.05) < 1e-12 &&
      Math.abs(relayoutApplied.size - 1.1) < 1e-12 &&
      relayoutApplied.pieces === 28 &&
      Math.abs(
        relayoutApplied.proneRotationX - Math.SQRT1_2,
      ) < 1e-12,
    `카드 조절판 합성·핫시트 적용·온라인 차단·저장·다시 깔기 실패: play=${playGradeEffect}, panel=${panelGradeEffect}, multiplied=${multipliedWeightEffect}, composedGrade=${composedGrade}, hotseat=${hotseatWhiteScale}/${hotseatBlackScale}/${hotseatWhiteWeight}/${hotseatBlackWeight}/${hotseatSpawnCount}/${hotseatPronePose.rotation.x}, customGiant=${customGiantScale}, online=${onlineScale}/${onlineWeight}/${onlineForce}/${onlineSpawnCount}, corruptWarning=${corruptLoad.warning}, stored=${JSON.stringify(gradeChangedLoad.settings)}, relayout=${JSON.stringify(relayoutApplied)}, snapshot=${JSON.stringify(relayoutSnapshot)}`,
  );
  console.log(
    `[통과 0] panelGrade4=${panelGradeEffect.toFixed(6)}=playGrade4, weight×1.5=${multipliedWeightEffect.toFixed(6)}, stageMaxGrade=${composedGrade}, hotseat(whiteSize/blackSize/whiteWeight/blackWeight/pieces/prone)=${hotseatWhiteScale.toFixed(2)}/${hotseatBlackScale.toFixed(2)}/${hotseatWhiteWeight.toFixed(3)}/${hotseatBlackWeight.toFixed(2)}/${hotseatSpawnCount}/true, customGiant=${customGiantScale.toFixed(2)}, online(size/weight/force/pieces)=${onlineScale.toFixed(2)}/${onlineWeight.toFixed(2)}/${onlineForce.toFixed(2)}/${onlineSpawnCount}, corruptFallback=true, storageMultipliers=1/1/1, relayout(stage/weight/size/pieces/prone/points)=${relayoutApplied.stageNumber}/${relayoutApplied.weight.toFixed(2)}/${relayoutApplied.size.toFixed(2)}/${relayoutApplied.pieces}/true/${relayoutSnapshot.points}`,
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
  sceneModule.synchronizePieceMeshes(giantMeshes, giantRuntime);
  const giantDrift = measureMaximumSpawnDrift(giantRuntime);
  const giantSleeping = [...giantRuntime.pieces.values()].filter(
    (binding) => binding.body.isSleeping(),
  ).length;
  const giantPawnMesh = giantMeshes.pieceMeshes.get(
    giantPawn.instance.id,
  );
  const giantRenderedBounds = new Box3().setFromObject(giantPawnMesh);
  const giantComputedBounds = aimModule.computePieceWorldAabb(
    giantPawn,
    giantPawnMesh,
  );
  const giantAabbError = measureAabbError(
    giantComputedBounds,
    giantRenderedBounds,
  );
  const giantRenderedCenter =
    giantRenderedBounds.getCenter(new Vector3());
  const giantStrikePoint =
    aimParametersModule.computeStrikeApplicationPoint(
      giantPawn,
      giantPawnMesh,
      1,
    );
  const giantStrikeError =
    giantStrikePoint.distanceTo(giantRenderedCenter);
  const giantRenderedSize =
    giantRenderedBounds.getSize(new Vector3());
  const giantExpectedMarkerDiameter = Math.max(
    giantRenderedSize.x,
    giantRenderedSize.z,
    0.35,
  );
  const giantMarkerDiameter =
    aimModule.computePieceMarkerDiameter(giantComputedBounds);

  const sizeCardOptions = {
    gameMode: "stage",
    stageNumber: 1,
    runCards: defaultLegendState,
  };
  const sizeCardRuntime =
    await physicsModule.createPhysicsRuntime(
      meta,
      layoutModule.PIECE_INSTANCES,
      boardHalfExtent,
      sizeCardOptions,
    );
  physicsModule.preSettlePhysics(sizeCardRuntime);
  const sizeCardMeshes = createPieceMeshes(
    sizeCardRuntime,
    geometries,
  );
  const sizeCardKing = sizeCardRuntime.pieces.get(
    "white-king-e1",
  );
  const sizeCardKingMesh = sizeCardMeshes.pieceMeshes.get(
    "white-king-e1",
  );
  assertCondition(
    sizeCardKing !== undefined && sizeCardKingMesh !== undefined,
    "크기 카드 AABB 검증용 백 킹을 찾지 못했습니다.",
  );
  const sizeCardRenderedBounds =
    new Box3().setFromObject(sizeCardKingMesh);
  const sizeCardComputedBounds =
    aimModule.computePieceWorldAabb(
      sizeCardKing,
      sizeCardKingMesh,
    );
  const sizeCardAabbError = measureAabbError(
    sizeCardComputedBounds,
    sizeCardRenderedBounds,
  );
  const sizeCardRenderedCenter =
    sizeCardRenderedBounds.getCenter(new Vector3());
  const sizeCardStrikePoint =
    aimParametersModule.computeStrikeApplicationPoint(
      sizeCardKing,
      sizeCardKingMesh,
      1,
    );
  const sizeCardStrikeError =
    sizeCardStrikePoint.distanceTo(sizeCardRenderedCenter);
  const sizeCardRenderedSize =
    sizeCardRenderedBounds.getSize(new Vector3());
  const sizeCardExpectedMarkerDiameter = Math.max(
    sizeCardRenderedSize.x,
    sizeCardRenderedSize.z,
    0.35,
  );
  const sizeCardMarkerDiameter =
    aimModule.computePieceMarkerDiameter(sizeCardComputedBounds);

  const pulseRuntime = {
    sceneRuntime: giantMeshes,
    pulses: new Map(),
  };
  const readGiantScaleSnapshot = () => {
    const collider = measureColliderUniformScale(
      giantPawn,
      meta.pieces.Pawn.colliderPoints,
    );
    return {
      mesh: giantPawnMesh.scale.x,
      binding: giantPawn.uniformScale,
      collider: collider.average,
      colliderAxisError: collider.maximumAxisError,
      visible: giantPawnMesh.visible,
      sameMesh:
        giantMeshes.pieceMeshes.get(giantPawn.instance.id) ===
          giantPawnMesh &&
        giantMeshes.scene.children.includes(giantPawnMesh),
    };
  };
  const scaleBeforeLaunch = readGiantScaleSnapshot();
  aimModule.startLaunchPulse(pulseRuntime, giantPawn.instance.id);
  const giantTurn = turnModule.createTurnRuntime(
    giantRuntime,
    giantMeshes,
    {
      maxLaunchSpeed: configModule.MAX_LAUNCH_SPEED,
      strikeHeightRatio: configModule.STRIKE_HEIGHT_RATIO,
    },
  );
  const giantQueued = turnModule.queueTurnLaunch(giantTurn, {
    pieceId: giantPawn.instance.id,
    direction: new Vector3(0, 0, 1),
    normalizedPower: 0.08,
    applicationPoint:
      aimParametersModule.computeStrikeApplicationPoint(
        giantPawn,
        giantPawnMesh,
        configModule.STRIKE_HEIGHT_RATIO,
      ),
  });
  assertCondition(
    giantQueued.accepted,
    `거대 폰 발사 큐 거절: ${giantQueued.reason}`,
  );
  turnModule.applyPendingLaunchBeforeStep(giantTurn);
  giantRuntime.world.step();
  turnModule.updateTurnAfterStep(
    giantTurn,
    configModule.FIXED_STEP,
  );
  sceneModule.synchronizePieceMeshes(giantMeshes, giantRuntime);
  const scaleAtLaunchStep = readGiantScaleSnapshot();
  const pulse = pulseRuntime.pulses.get(giantPawn.instance.id);
  assertCondition(pulse !== undefined, "거대 폰 발사 펄스가 시작되지 않았습니다.");
  aimModule.updateLaunchPulses(
    pulseRuntime,
    pulse.startedAt + 60,
  );
  const scaleAtPulsePeak = readGiantScaleSnapshot();
  let giantLaunchSettleSteps = 1;
  while (
    giantTurn.phase === "settling" &&
    giantLaunchSettleSteps < 10_000
  ) {
    giantRuntime.world.step();
    turnModule.updateTurnAfterStep(
      giantTurn,
      configModule.FIXED_STEP,
    );
    giantLaunchSettleSteps += 1;
  }
  assertCondition(
    giantTurn.phase !== "settling",
    `거대 폰 발사가 10000 step 안에 정착하지 않았습니다.`,
  );
  aimModule.updateLaunchPulses(
    pulseRuntime,
    pulse.startedAt + 121,
  );
  sceneModule.synchronizePieceMeshes(giantMeshes, giantRuntime);
  const scaleAfterSettle = readGiantScaleSnapshot();
  assertCondition(
    giantHeightDifference < 1e-3 &&
      giantSleeping === 28 &&
      giantDrift.maximumDrift < 0.05 &&
      giantAabbError < 1e-6 &&
      sizeCardAabbError < 1e-6 &&
      giantStrikeError < 1e-6 &&
      sizeCardStrikeError < 1e-6 &&
      Math.abs(
        giantMarkerDiameter - giantExpectedMarkerDiameter,
      ) < 1e-6 &&
      Math.abs(
        sizeCardMarkerDiameter - sizeCardExpectedMarkerDiameter,
      ) < 1e-6 &&
      Math.abs(
        scaleBeforeLaunch.mesh - giantPawn.uniformScale,
      ) < 1e-9 &&
      Math.abs(
        scaleAtLaunchStep.mesh - giantPawn.uniformScale,
      ) < 1e-9 &&
      Math.abs(
        scaleAtPulsePeak.mesh -
          giantPawn.uniformScale * 1.06,
      ) < 1e-9 &&
      Math.abs(
        scaleAfterSettle.mesh - giantPawn.uniformScale,
      ) < 1e-9 &&
      [
        scaleBeforeLaunch,
        scaleAtLaunchStep,
        scaleAtPulsePeak,
        scaleAfterSettle,
      ].every(
        (snapshot) =>
          Math.abs(
            snapshot.collider - giantPawn.uniformScale,
          ) < 1e-6 &&
          snapshot.colliderAxisError < 1e-6 &&
          snapshot.visible &&
          snapshot.sameMesh,
      ),
    `거대 폰 AABB·발사 배율 검증 실패: heightΔ=${giantHeightDifference}, sleeping=${giantSleeping}/28, maxDrift=${giantDrift.maximumDrift}, giantAabb=${giantAabbError}, sizeAabb=${sizeCardAabbError}, strike=${giantStrikeError}/${sizeCardStrikeError}, marker=${giantMarkerDiameter}/${giantExpectedMarkerDiameter},${sizeCardMarkerDiameter}/${sizeCardExpectedMarkerDiameter}, scales=${JSON.stringify({ before: scaleBeforeLaunch, launch: scaleAtLaunchStep, peak: scaleAtPulsePeak, settled: scaleAfterSettle })}`,
  );
  console.log(
    `[통과 b] pieces=28, pawns=${whitePawnFiles.join(",")}, pawnHeight=${giantPawnHeight.toFixed(6)}, kingHeight=${whiteKingHeight.toFixed(6)}, |Δ|=${giantHeightDifference.toExponential(3)}, AABB giant@${giantPawn.uniformScale.toFixed(6)}=${giantAabbError.toExponential(3)} size@${sizeCardKing.uniformScale.toFixed(6)}=${sizeCardAabbError.toExponential(3)}, strike=${giantStrikeError.toExponential(3)}/${sizeCardStrikeError.toExponential(3)}, marker=${giantMarkerDiameter.toFixed(6)}/${sizeCardMarkerDiameter.toFixed(6)}, scale mesh(before/launch/peak/settled)=${scaleBeforeLaunch.mesh.toFixed(6)}/${scaleAtLaunchStep.mesh.toFixed(6)}/${scaleAtPulsePeak.mesh.toFixed(6)}/${scaleAfterSettle.mesh.toFixed(6)}, collider=${scaleBeforeLaunch.collider.toFixed(6)}/${scaleAtLaunchStep.collider.toFixed(6)}/${scaleAtPulsePeak.collider.toFixed(6)}/${scaleAfterSettle.collider.toFixed(6)}, visible=true, sameMesh=true, launchSettle=${giantLaunchSettleSteps}, preSettle=${giantSettle.steps}, sleeping=${giantSleeping}/28, maxDrift=${giantDrift.maximumDrift.toFixed(6)} (${giantDrift.maximumPieceId})`,
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
