import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
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
 * localStorage와 같은 두 메서드로 저장 왕복과 손상 값을 재현한다.
 */
class MemoryStorage {
  // 테스트가 직접 손상 JSON을 넣고 저장 결과를 읽는 메모리 맵이다.
  values = new Map();

  /**
   * 지정한 키의 문자열 또는 미저장 null을 반환한다.
   */
  getItem(key) {
    return this.values.get(key) ?? null;
  }

  /**
   * 지정한 키에 문자열 값을 즉시 덮어쓴다.
   */
  setItem(key, value) {
    this.values.set(key, value);
  }

  /**
   * 초기화가 저장된 전체 설정을 제거하는 동작을 재현한다.
   */
  removeItem(key) {
    this.values.delete(key);
  }
}

/**
 * 실제 GLB에서 여섯 말 지오메트리를 읽는다.
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
 * 실제 발사 자세 계산이 읽을 물리 바디별 Three 메시 연결표를 만든다.
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
 * 한 백 말을 실제 턴 발사 경로로 쏘고 순간 속도 변화량을 반환한다.
 */
function launchAndMeasure(
  turnRuntime,
  turnModule,
  binding,
  speedMultiplier,
  power,
) {
  const before = binding.body.linvel();
  const queued = turnModule.queueTurnLaunch(turnRuntime, {
    pieceId: binding.instance.id,
    direction: new Vector3(0, 0, 1),
    normalizedPower: power,
    applicationPoint: binding.body.worldCom(),
    speedMultiplier,
  });
  assertCondition(
    queued.accepted,
    `${binding.instance.id} 발사 큐가 거절됐습니다: ${queued.reason}`,
  );
  turnModule.applyPendingLaunchBeforeStep(turnRuntime);
  const after = binding.body.linvel();
  return Math.hypot(
    after.x - before.x,
    after.y - before.y,
    after.z - before.z,
  );
}

try {
  const [
    cardsModule,
    configModule,
    layoutModule,
    metaModule,
    physicsModule,
    tuningModule,
    turnModule,
  ] = await Promise.all([
    vite.ssrLoadModule("/src/cards.ts"),
    vite.ssrLoadModule("/src/config.ts"),
    vite.ssrLoadModule("/src/layout.ts"),
    vite.ssrLoadModule("/src/meta.ts"),
    vite.ssrLoadModule("/src/physics.ts"),
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
  const geometries = await loadPieceGeometries(
    configModule.PIECE_TYPES,
  );

  const storage = new MemoryStorage();
  const savedRuntime = metaModule.createMetaRuntime(storage);
  savedRuntime.state.points = 2345;
  savedRuntime.state.upgrades.Pawn.force = 3;
  savedRuntime.state.upgrades.King.weight = 7;
  metaModule.saveMetaState(savedRuntime);
  const loadedRuntime = metaModule.createMetaRuntime(storage);
  assertCondition(
    loadedRuntime.state.points === 2345 &&
      loadedRuntime.state.upgrades.Pawn.force === 3 &&
      loadedRuntime.state.upgrades.King.weight === 7,
    `메타 왕복 실패: ${JSON.stringify(loadedRuntime.state)}`,
  );

  let warningCount = 0;
  const originalWarn = console.warn;
  console.warn = () => {
    warningCount += 1;
  };
  storage.setItem(metaModule.META_POINTS_STORAGE_KEY, "{broken");
  storage.setItem(metaModule.META_UPGRADES_STORAGE_KEY, "[broken");
  const corruptedRuntime = metaModule.createMetaRuntime(storage);
  console.warn = originalWarn;
  assertCondition(
    corruptedRuntime.state.points === 0 &&
      configModule.PIECE_TYPES.every(
        (type) =>
          corruptedRuntime.state.upgrades[type].force === 0 &&
          corruptedRuntime.state.upgrades[type].weight === 0,
      ) &&
      warningCount === 1,
    `손상 JSON 기본값 실패: state=${JSON.stringify(corruptedRuntime.state)}, warnings=${warningCount}`,
  );
  console.log(
    `[통과 a] roundTrip points=${loadedRuntime.state.points}, Pawn.force=${loadedRuntime.state.upgrades.Pawn.force}, King.weight=${loadedRuntime.state.upgrades.King.weight}; corrupted→points=0/allLevels=0, warnings=${warningCount}`,
  );

  const tuningStorage = new MemoryStorage();
  const tuningDefaults =
    tuningModule.createDefaultRuntimeTuningSettings();
  const modifiedTuning = {
    ...tuningDefaults,
    timeScale: 2.25,
    maxLaunchSpeed: 13.5,
    friction: 0.65,
    enemyStageBuffScale: 1.4,
    cardEffectScale: 0.85,
  };
  const saveWarning = tuningModule.saveTuningSettings(
    tuningStorage,
    modifiedTuning,
  );
  const loadedTuning =
    tuningModule.loadTuningSettings(tuningStorage);
  assertCondition(
    saveWarning === null &&
      JSON.stringify(loadedTuning.settings) ===
        JSON.stringify(modifiedTuning) &&
      loadedTuning.warning === null,
    `조절값 왕복 실패: warning=${saveWarning ?? loadedTuning.warning}, settings=${JSON.stringify(loadedTuning.settings)}`,
  );

  tuningStorage.setItem(
    tuningModule.TUNING_SETTINGS_STORAGE_KEY,
    JSON.stringify({
      ...modifiedTuning,
      timeScale: "broken",
      friction: 99,
      restitution: null,
    }),
  );
  const partiallyCorrupted =
    tuningModule.loadTuningSettings(tuningStorage);
  assertCondition(
    partiallyCorrupted.settings.timeScale ===
      tuningDefaults.timeScale &&
      partiallyCorrupted.settings.friction ===
        tuningDefaults.friction &&
      partiallyCorrupted.settings.restitution ===
        tuningDefaults.restitution &&
      partiallyCorrupted.settings.maxLaunchSpeed ===
        modifiedTuning.maxLaunchSpeed &&
      partiallyCorrupted.invalidKeys.join(",") ===
        "timeScale,friction,restitution" &&
      partiallyCorrupted.warning !== null,
    `조절값 필드별 복구 실패: ${JSON.stringify(partiallyCorrupted)}`,
  );

  tuningStorage.setItem(
    tuningModule.TUNING_SETTINGS_STORAGE_KEY,
    "{broken",
  );
  const fullyCorrupted =
    tuningModule.loadTuningSettings(tuningStorage);
  assertCondition(
    JSON.stringify(fullyCorrupted.settings) ===
      JSON.stringify(tuningDefaults) &&
      fullyCorrupted.invalidKeys.length ===
        Object.keys(tuningDefaults).length &&
      fullyCorrupted.warning !== null,
    `조절값 손상 JSON 기본값 실패: ${JSON.stringify(fullyCorrupted)}`,
  );

  const boardCollider = {
    setFriction() {},
    setRestitution() {},
  };
  const tuningModeRuntime = {
    physicsRuntime: {
      boardCollider,
      pieces: new Map(),
    },
    settings: { ...modifiedTuning },
    localSettings: { ...modifiedTuning },
    controls: new Map(),
    panel: { querySelector: () => null },
    onlineNotice: { hidden: true },
    onlineDefaultsActive: false,
    pendingPhysicsVerification: false,
  };
  tuningModule.setTuningGameMode(tuningModeRuntime, "online");
  const onlineUsesDefaults =
    JSON.stringify(tuningModeRuntime.settings) ===
    JSON.stringify(tuningDefaults);
  tuningModule.setTuningGameMode(tuningModeRuntime, "stage");
  const localValuesRestored =
    JSON.stringify(tuningModeRuntime.settings) ===
    JSON.stringify(modifiedTuning);
  assertCondition(
    onlineUsesDefaults && localValuesRestored,
    `온라인 기본값 예외 실패: online=${onlineUsesDefaults}, restored=${localValuesRestored}`,
  );

  const clearWarning =
    tuningModule.clearTuningSettings(tuningStorage);
  assertCondition(
    clearWarning === null &&
      tuningStorage.getItem(
        tuningModule.TUNING_SETTINGS_STORAGE_KEY,
      ) === null,
    `조절값 저장 삭제 실패: ${clearWarning}`,
  );
  console.log(
    `[통과 tuning-storage] roundTrip speed=${loadedTuning.settings.maxLaunchSpeed.toFixed(2)}, friction=${loadedTuning.settings.friction.toFixed(2)}, enemyScale=${loadedTuning.settings.enemyStageBuffScale.toFixed(2)}, cardScale=${loadedTuning.settings.cardEffectScale.toFixed(2)}; partialFallback=${partiallyCorrupted.invalidKeys.join(",")}; corruptFallback=${fullyCorrupted.invalidKeys.length}/${Object.keys(tuningDefaults).length}, warning=${fullyCorrupted.warning !== null}; onlineDefaults=${onlineUsesDefaults}, localRestored=${localValuesRestored}, cleared=${clearWarning === null}`,
  );

  const costs = Array.from({ length: 10 }, (_, level) =>
    metaModule.computePermanentUpgradeCost(level),
  );
  const rewardStorage = new MemoryStorage();
  const rewardRuntime = metaModule.createMetaRuntime(rewardStorage);
  metaModule.awardStageClearPoints(rewardRuntime);
  assertCondition(
    rewardRuntime.state.points === 100 &&
      JSON.parse(
        rewardStorage.getItem(
          metaModule.META_POINTS_STORAGE_KEY,
        ),
      ) === 100,
    "스테이지 클리어 100포인트가 즉시 저장되지 않았습니다.",
  );
  const purchaseStorage = new MemoryStorage();
  const purchaseRuntime =
    metaModule.createMetaRuntime(purchaseStorage);
  purchaseRuntime.state.points = 2000;
  const purchased = metaModule.purchasePermanentUpgrade(
    purchaseRuntime,
    "Pawn",
    "force",
  );
  purchaseRuntime.state.points = 0;
  const insufficient = metaModule.purchasePermanentUpgrade(
    purchaseRuntime,
    "Rook",
    "weight",
  );
  purchaseRuntime.state.upgrades.King.weight =
    configModule.PERMANENT_UPGRADE_MAX_LEVEL;
  const maximum = metaModule.purchasePermanentUpgrade(
    purchaseRuntime,
    "King",
    "weight",
  );
  assertCondition(
    JSON.stringify(costs) ===
      JSON.stringify([
        100, 200, 300, 400, 500,
        600, 700, 800, 900, 1000,
      ]) &&
      purchased.purchased &&
      purchaseRuntime.state.upgrades.Pawn.force === 1 &&
      insufficient.purchased === false &&
      purchaseRuntime.state.upgrades.Rook.weight === 0 &&
      maximum.purchased === false &&
      purchaseRuntime.state.upgrades.King.weight === 10,
    `비용·구매 경계 실패: costs=${costs.join(",")}, state=${JSON.stringify(purchaseRuntime.state)}, purchased=${JSON.stringify(purchased)}, insufficient=${JSON.stringify(insufficient)}, maximum=${JSON.stringify(maximum)}`,
  );
  const persistedAfterPurchase = JSON.parse(
    purchaseStorage.getItem(metaModule.META_UPGRADES_STORAGE_KEY),
  );
  assertCondition(
    persistedAfterPurchase.Pawn.force === 1,
    "구매 직후 강화 저장이 반영되지 않았습니다.",
  );
  console.log(
    `[통과 b] stageClear=+100(saved); costs=${costs.join(",")}; purchase 2000→1900, Pawn.force 0→1; insufficient=blocked; maxLevel10=blocked`,
  );

  const permanentUpgrades =
    metaModule.createDefaultPermanentUpgrades();
  permanentUpgrades.Pawn.force = 5;
  const emptyCards = cardsModule.createRunCardState();
  const forceRuntime = await physicsModule.createPhysicsRuntime(
    meta,
    layoutModule.PIECE_INSTANCES,
    boardHalfExtent,
    {
      gameMode: "stage",
      stageNumber: 1,
      runCards: emptyCards,
      permanentUpgrades,
    },
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
  const pawn = forceRuntime.pieces.get("white-pawn-e2");
  const rook = forceRuntime.pieces.get("white-rook-a1");
  assertCondition(
    pawn !== undefined && rook !== undefined,
    "종류별 힘 검사용 백 폰과 백 룩을 찾지 못했습니다.",
  );
  const power = 0.4;
  const pawnMultiplier =
    cardsModule.computePlayerLaunchSpeedMultiplier(
      "stage",
      emptyCards,
      metaModule.computePermanentForceBonus(
        permanentUpgrades,
        "Pawn",
      ),
    );
  const pawnDeltaVelocity = launchAndMeasure(
    forceTurn,
    turnModule,
    pawn,
    pawnMultiplier,
    power,
  );
  turnModule.resetTurnRuntime(forceTurn);
  const rookMultiplier =
    cardsModule.computePlayerLaunchSpeedMultiplier(
      "stage",
      emptyCards,
      metaModule.computePermanentForceBonus(
        permanentUpgrades,
        "Rook",
      ),
    );
  const rookDeltaVelocity = launchAndMeasure(
    forceTurn,
    turnModule,
    rook,
    rookMultiplier,
    power,
  );
  const pawnExpected =
    power * configModule.MAX_LAUNCH_SPEED * 1.05;
  const rookExpected =
    power * configModule.MAX_LAUNCH_SPEED;
  const pawnError =
    Math.abs(pawnDeltaVelocity - pawnExpected) / pawnExpected;
  const rookError =
    Math.abs(rookDeltaVelocity - rookExpected) / rookExpected;
  assertCondition(
    pawnMultiplier === 1.05 &&
      rookMultiplier === 1 &&
      pawnError < 0.01 &&
      rookError < 0.01,
    `종류별 힘 실패: pawn=${pawnDeltaVelocity}/${pawnExpected}, rook=${rookDeltaVelocity}/${rookExpected}`,
  );
  console.log(
    `[통과 c] Pawn level=5 multiplier=${pawnMultiplier.toFixed(6)}, Δv=${pawnDeltaVelocity.toFixed(6)}/${pawnExpected.toFixed(6)}, error=${(pawnError * 100).toFixed(6)}%; Rook multiplier=${rookMultiplier.toFixed(6)}, Δv=${rookDeltaVelocity.toFixed(6)}/${rookExpected.toFixed(6)}, error=${(rookError * 100).toFixed(6)}%`,
  );

  const weightUpgrades =
    metaModule.createDefaultPermanentUpgrades();
  weightUpgrades.Pawn.weight = 4;
  const weightCards = cardsModule.createRunCardState();
  cardsModule.applyCardPick(weightCards, "weight");
  cardsModule.applyCardPick(weightCards, "weight");
  const weightRuntime = await physicsModule.createPhysicsRuntime(
    meta,
    layoutModule.PIECE_INSTANCES,
    boardHalfExtent,
    {
      gameMode: "stage",
      stageNumber: 1,
      runCards: weightCards,
      permanentUpgrades: weightUpgrades,
    },
  );
  const weightedPawn =
    weightRuntime.pieces.get("white-pawn-e2");
  assertCondition(
    weightedPawn !== undefined,
    "종류별 중량 검사용 백 폰을 찾지 못했습니다.",
  );
  const baseWeightMultiplier = 0.35;
  tuningModule.applyComposedWeightToBinding(
    weightedPawn,
    baseWeightMultiplier,
  );
  weightRuntime.world.step();
  const expectedUpgradeFraction = 0.03 + 0.04;
  const expectedMass =
    weightedPawn.originalHullMass *
    (1 + baseWeightMultiplier + expectedUpgradeFraction);
  const actualMass = weightedPawn.body.mass();
  const massError =
    Math.abs(actualMass - expectedMass) / expectedMass;
  const measuredUpgradeFraction =
    weightedPawn.upgradeAdditionalMass /
    weightedPawn.originalHullMass;
  assertCondition(
    Math.abs(
      measuredUpgradeFraction - expectedUpgradeFraction,
    ) < 1e-6 && massError < 0.01,
    `합성 중량 실패: upgrade=${measuredUpgradeFraction}, mass=${actualMass}/${expectedMass}`,
  );
  console.log(
    `[통과 d] tuning=${baseWeightMultiplier.toFixed(2)} + cardGrade2=0.03 + permanent(Pawn level4)=0.04, upgradeFraction=${measuredUpgradeFraction.toFixed(6)}, mass=${actualMass.toFixed(6)}/${expectedMass.toFixed(6)}, error=${(massError * 100).toFixed(6)}%`,
  );
} finally {
  await vite.close();
}
