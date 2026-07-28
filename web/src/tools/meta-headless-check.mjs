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
    matchModule,
    metaModule,
    physicsModule,
    stageModule,
    tuningModule,
    turnModule,
  ] = await Promise.all([
    vite.ssrLoadModule("/src/cards.ts"),
    vite.ssrLoadModule("/src/config.ts"),
    vite.ssrLoadModule("/src/layout.ts"),
    vite.ssrLoadModule("/src/match.ts"),
    vite.ssrLoadModule("/src/meta.ts"),
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
  const geometries = await loadPieceGeometries(
    configModule.PIECE_TYPES,
  );

  const storage = new MemoryStorage();
  const savedRuntime = metaModule.createMetaRuntime(storage);
  savedRuntime.state.points = 2345;
  savedRuntime.state.upgrades.pieces.Pawn.basic.force = 2;
  savedRuntime.state.upgrades.pieces.Rook.basic.weight = 3;
  metaModule.saveMetaState(savedRuntime);
  const loadedRuntime = metaModule.createMetaRuntime(storage);
  assertCondition(
    loadedRuntime.state.points === 2345 &&
      loadedRuntime.state.upgrades.schemaVersion === 2 &&
      loadedRuntime.state.upgrades.pieces.Pawn.basic.force === 2 &&
      loadedRuntime.state.upgrades.pieces.Rook.basic.weight === 3,
    `메타 왕복 실패: ${JSON.stringify(loadedRuntime.state)}`,
  );

  let warningCount = 0;
  const originalWarn = console.warn;
  console.warn = () => {
    warningCount += 1;
  };
  const oldStorage = new MemoryStorage();
  oldStorage.setItem(metaModule.META_POINTS_STORAGE_KEY, "987");
  oldStorage.setItem(
    metaModule.META_UPGRADES_STORAGE_KEY,
    JSON.stringify(
      Object.fromEntries(
        configModule.PIECE_TYPES.map((type) => [
          type,
          { force: 1, weight: 1 },
        ]),
      ),
    ),
  );
  const oldFormatRuntime = metaModule.createMetaRuntime(oldStorage);
  const corruptStorage = new MemoryStorage();
  corruptStorage.setItem(
    metaModule.META_POINTS_STORAGE_KEY,
    "{broken",
  );
  corruptStorage.setItem(
    metaModule.META_UPGRADES_STORAGE_KEY,
    "[broken",
  );
  const corruptedRuntime =
    metaModule.createMetaRuntime(corruptStorage);
  console.warn = originalWarn;
  const isFreshTree = (upgrades) =>
    upgrades.schemaVersion === 2 &&
    upgrades.playerSizeLevel === 0 &&
    configModule.PIECE_TYPES.every(
      (type) =>
        ["basic", "advanced"].every(
          (tier) =>
            upgrades.pieces[type][tier].force === 0 &&
            upgrades.pieces[type][tier].weight === 0,
        ),
    );
  assertCondition(
    oldFormatRuntime.state.points === 0 &&
      isFreshTree(oldFormatRuntime.state.upgrades) &&
      corruptedRuntime.state.points === 0 &&
      isFreshTree(corruptedRuntime.state.upgrades) &&
      warningCount === 1,
    `구형·손상 저장 기본값 실패: old=${JSON.stringify(oldFormatRuntime.state)}, corrupt=${JSON.stringify(corruptedRuntime.state)}, warnings=${warningCount}`,
  );
  console.log(
    `[통과 a] schema2 roundTrip points=${loadedRuntime.state.points}, Pawn.basic.force=${loadedRuntime.state.upgrades.pieces.Pawn.basic.force}, Rook.basic.weight=${loadedRuntime.state.upgrades.pieces.Rook.basic.weight}; old/corrupt→fresh, warnings=${warningCount}`,
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

  const expectedDefeatPayouts = [
    0, 1, 3, 6, 10, 15, 21, 28, 36, 45,
  ];
  const measuredDefeatPayouts = [];
  for (
    let lostStage = 1;
    lostStage <= configModule.STAGE_RUN_LENGTH;
    lostStage += 1
  ) {
    const defeatStorage = new MemoryStorage();
    const defeatRuntime =
      metaModule.createMetaRuntime(defeatStorage);
    const defeatProgress =
      metaModule.createStageRunPointState();
    for (
      let clearedStage = 1;
      clearedStage < lostStage;
      clearedStage += 1
    ) {
      metaModule.recordStageRunClear(
        defeatProgress,
        clearedStage,
      );
      assertCondition(
        defeatStorage.values.size === 0 &&
          defeatRuntime.state.points === 0,
        `${clearedStage} 스테이지 중간 클리어 전에 포인트가 저장됐습니다.`,
      );
    }
    const payout = metaModule.settleStageRunPoints(
      defeatRuntime,
      defeatProgress,
    );
    measuredDefeatPayouts.push(payout);
    const storedPoints = defeatStorage.getItem(
      metaModule.META_POINTS_STORAGE_KEY,
    );
    assertCondition(
      payout === expectedDefeatPayouts[lostStage - 1] &&
        defeatRuntime.state.points === payout &&
        (payout === 0
          ? storedPoints === null
          : JSON.parse(storedPoints) === payout),
      `${lostStage} 스테이지 패배 정산 실패: payout=${payout}, stored=${storedPoints}`,
    );
  }

  const completionStorage = new MemoryStorage();
  const completionRuntime =
    metaModule.createMetaRuntime(completionStorage);
  const completionProgress =
    metaModule.createStageRunPointState();
  for (
    let clearedStage = 1;
    clearedStage <= configModule.STAGE_RUN_LENGTH;
    clearedStage += 1
  ) {
    metaModule.recordStageRunClear(
      completionProgress,
      clearedStage,
    );
    assertCondition(
      completionStorage.values.size === 0 &&
        completionRuntime.state.points === 0,
      `${clearedStage} 스테이지 완주 정산 전에 포인트가 저장됐습니다.`,
    );
  }
  const completionPayout = metaModule.settleStageRunPoints(
    completionRuntime,
    completionProgress,
  );
  assertCondition(
    completionPayout === 55 &&
      completionRuntime.state.points === 55 &&
      JSON.parse(
        completionStorage.getItem(
          metaModule.META_POINTS_STORAGE_KEY,
        ),
      ) === 55,
    `10스테이지 완주 정산 실패: payout=${completionPayout}`,
  );

  const abandonStorage = new MemoryStorage();
  const abandonRuntime =
    metaModule.createMetaRuntime(abandonStorage);
  const abandonProgress =
    metaModule.createStageRunPointState();
  for (let clearedStage = 1; clearedStage <= 4; clearedStage += 1) {
    metaModule.recordStageRunClear(
      abandonProgress,
      clearedStage,
    );
  }
  const discardedPayout =
    metaModule.discardStageRunPoints(abandonProgress);
  assertCondition(
    discardedPayout === 10 &&
      abandonProgress.lastClearedStage === 0 &&
      abandonRuntime.state.points === 0 &&
      abandonStorage.values.size === 0 &&
      metaModule.settleStageRunPoints(
        abandonRuntime,
        abandonProgress,
      ) === 0,
    `런 이탈 미지급 실패: discarded=${discardedPayout}, state=${JSON.stringify(abandonProgress)}`,
  );

  const cardOfferStages = Array.from(
    { length: configModule.STAGE_RUN_LENGTH },
    (_, index) =>
      metaModule.shouldOfferStageClearCards(index + 1),
  );
  const defeatCopy = matchModule.createStageRunResultCopy(
    7,
    21,
    false,
  );
  const completionCopy = matchModule.createStageRunResultCopy(
    10,
    55,
    true,
  );
  assertCondition(
    configModule.STAGE_POINT_CONTRIBUTION_UNIT === 1 &&
      JSON.stringify(cardOfferStages) ===
        JSON.stringify([
          true,
          true,
          true,
          true,
          true,
          true,
          true,
          true,
          true,
          false,
        ]) &&
      JSON.stringify(defeatCopy) ===
        JSON.stringify({
          kicker: "대국 종료",
          heading: "스테이지 7 종료",
          detailLines: ["획득 포인트 : 21점"],
          buttonLabel: "메인으로 이동",
        }) &&
      JSON.stringify(completionCopy) ===
        JSON.stringify({
          kicker: null,
          heading: "축하합니다.",
          detailLines: [
            "데모 버전 스테이지를 전부 클리어하셨습니다.",
            "플레이해 주셔서 감사합니다.",
          ],
          buttonLabel: "메인으로 이동",
        }),
    `카드 제공·결과 문구 실패: cards=${JSON.stringify(cardOfferStages)}, defeat=${JSON.stringify(defeatCopy)}, completion=${JSON.stringify(completionCopy)}`,
  );
  console.log(
    `[통과 run] defeat=${measuredDefeatPayouts.join("/")}, complete=${completionPayout}, abandon=0(discarded ${discardedPayout}), cards=${cardOfferStages.map((offered) => (offered ? 1 : 0)).join("/")}`,
  );

  const costs = {
    basicRegular: [0, 1, 2].map((level) =>
      metaModule.computePermanentUpgradeCost(
        "basic",
        "Pawn",
        level,
      ),
    ),
    basicRoyal: [0, 1, 2].map((level) =>
      metaModule.computePermanentUpgradeCost(
        "basic",
        "King",
        level,
      ),
    ),
    size: configModule.PERMANENT_PLAYER_SIZE_COST,
    advancedRegular: [0, 1, 2].map((level) =>
      metaModule.computePermanentUpgradeCost(
        "advanced",
        "Pawn",
        level,
      ),
    ),
    advancedRoyal: [0, 1, 2].map((level) =>
      metaModule.computePermanentUpgradeCost(
        "advanced",
        "King",
        level,
      ),
    ),
  };
  assertCondition(
    JSON.stringify(costs) ===
      JSON.stringify({
        basicRegular: [1, 3, 5],
        basicRoyal: [2, 4, 6],
        size: 10,
        advancedRegular: [3, 5, 7],
        advancedRoyal: [4, 6, 8],
      }) &&
      metaModule.computePermanentUpgradeTreeTotalCost() === 322 &&
      configModule.PERMANENT_UPGRADE_NODE_COUNT === 25,
    `비용표·총합 실패: costs=${JSON.stringify(costs)}, total=${metaModule.computePermanentUpgradeTreeTotalCost()}, nodes=${configModule.PERMANENT_UPGRADE_NODE_COUNT}`,
  );

  const purchaseStorage = new MemoryStorage();
  const purchaseRuntime =
    metaModule.createMetaRuntime(purchaseStorage);
  purchaseRuntime.state.points = 322;
  const blockedBasicKing =
    metaModule.purchasePermanentUpgrade(
      purchaseRuntime,
      "basic",
      "King",
      "force",
    );
  const blockedSize =
    metaModule.purchasePermanentSizeUpgrade(purchaseRuntime);
  const blockedAdvanced =
    metaModule.purchasePermanentUpgrade(
      purchaseRuntime,
      "advanced",
      "Pawn",
      "force",
    );

  const insufficientRuntime =
    metaModule.createMetaRuntime(new MemoryStorage());
  const insufficient = metaModule.purchasePermanentUpgrade(
    insufficientRuntime,
    "basic",
    "Rook",
    "weight",
  );

  const purchaseTrackToMaximum = (
    tier,
    type,
    track,
  ) => {
    for (
      let level = 0;
      level < configModule.PERMANENT_UPGRADE_TIER_MAX_LEVEL;
      level += 1
    ) {
      const result = metaModule.purchasePermanentUpgrade(
        purchaseRuntime,
        tier,
        type,
        track,
      );
      assertCondition(
        result.purchased,
        `${tier}.${type}.${track} ${level}→${level + 1} 구매 실패: ${JSON.stringify(result)}`,
      );
    }
  };
  const purchasePieceToMaximum = (tier, type) => {
    purchaseTrackToMaximum(tier, type, "force");
    purchaseTrackToMaximum(tier, type, "weight");
  };

  purchasePieceToMaximum("basic", "Pawn");
  const kingStillBlockedAfterPawn =
    metaModule.isPermanentUpgradeUnlocked(
      purchaseRuntime.state.upgrades,
      "basic",
      "King",
    );
  purchasePieceToMaximum("basic", "Knight");
  const kingUnlocked =
    metaModule.isPermanentUpgradeUnlocked(
      purchaseRuntime.state.upgrades,
      "basic",
      "King",
    );
  purchasePieceToMaximum("basic", "King");
  purchasePieceToMaximum("basic", "Rook");
  const queenStillBlockedAfterRook =
    metaModule.isPermanentUpgradeUnlocked(
      purchaseRuntime.state.upgrades,
      "basic",
      "Queen",
    );
  purchasePieceToMaximum("basic", "Bishop");
  purchasePieceToMaximum("basic", "Queen");
  const sizeUnlocked =
    metaModule.isPermanentSizeUpgradeUnlocked(
      purchaseRuntime.state.upgrades,
    );
  const purchasedSize =
    metaModule.purchasePermanentSizeUpgrade(purchaseRuntime);
  const repeatedSize =
    metaModule.purchasePermanentSizeUpgrade(purchaseRuntime);

  purchasePieceToMaximum("advanced", "Pawn");
  const advancedKingStillBlocked =
    metaModule.isPermanentUpgradeUnlocked(
      purchaseRuntime.state.upgrades,
      "advanced",
      "King",
    );
  purchasePieceToMaximum("advanced", "Knight");
  purchasePieceToMaximum("advanced", "King");
  purchasePieceToMaximum("advanced", "Rook");
  const advancedQueenStillBlocked =
    metaModule.isPermanentUpgradeUnlocked(
      purchaseRuntime.state.upgrades,
      "advanced",
      "Queen",
    );
  purchasePieceToMaximum("advanced", "Bishop");
  purchasePieceToMaximum("advanced", "Queen");

  const maximum = metaModule.purchasePermanentUpgrade(
    purchaseRuntime,
    "advanced",
    "Queen",
    "weight",
  );
  const completedUpgrades =
    metaModule.clonePermanentUpgrades(
      purchaseRuntime.state.upgrades,
    );
  const capsAreSixPercent = configModule.PIECE_TYPES.every(
    (type) =>
      metaModule.computePermanentForceBonus(
        completedUpgrades,
        type,
      ) === 0.06 &&
      metaModule.computePermanentWeightFraction(
        completedUpgrades,
        type,
      ) === 0.06,
  );
  assertCondition(
    !blockedBasicKing.purchased &&
      !blockedSize.purchased &&
      !blockedAdvanced.purchased &&
      insufficient.purchased === false &&
      kingStillBlockedAfterPawn === false &&
      kingUnlocked &&
      queenStillBlockedAfterRook === false &&
      sizeUnlocked &&
      purchasedSize.purchased &&
      !repeatedSize.purchased &&
      advancedKingStillBlocked === false &&
      advancedQueenStillBlocked === false &&
      maximum.purchased === false &&
      purchaseRuntime.state.points === 0 &&
      metaModule.computePermanentUpgradeSpentPoints(
        purchaseRuntime.state.upgrades,
      ) === 322 &&
      capsAreSixPercent &&
      metaModule.computePermanentSizeFraction(
        completedUpgrades,
      ) === 0.03,
    `트리 구매·선행·상한 실패: state=${JSON.stringify(purchaseRuntime.state)}, blocked=${JSON.stringify({ blockedBasicKing, blockedSize, blockedAdvanced })}, size=${JSON.stringify({ purchasedSize, repeatedSize })}, max=${JSON.stringify(maximum)}`,
  );
  const persistedAfterPurchase = JSON.parse(
    purchaseStorage.getItem(metaModule.META_UPGRADES_STORAGE_KEY),
  );
  assertCondition(
    persistedAfterPurchase.schemaVersion === 2 &&
      persistedAfterPurchase.playerSizeLevel === 1 &&
      persistedAfterPurchase.pieces.Queen.advanced.weight === 3,
    "구매 직후 강화 저장이 반영되지 않았습니다.",
  );
  const refunded =
    metaModule.resetPermanentUpgrades(purchaseRuntime);
  const persistedAfterReset = JSON.parse(
    purchaseStorage.getItem(metaModule.META_UPGRADES_STORAGE_KEY),
  );
  assertCondition(
    refunded === 322 &&
      purchaseRuntime.state.points === 322 &&
      metaModule.computePermanentUpgradeSpentPoints(
        purchaseRuntime.state.upgrades,
      ) === 0 &&
      isFreshTree(purchaseRuntime.state.upgrades) &&
      persistedAfterReset.playerSizeLevel === 0,
    `전체 초기화 실패: refund=${refunded}, state=${JSON.stringify(purchaseRuntime.state)}, persisted=${JSON.stringify(persistedAfterReset)}`,
  );
  console.log(
    `[통과 b] nodes=25, costs=${JSON.stringify(costs)}, total=322; prerequisites=blocked→unlocked; size=0/1(+3%, repeat blocked); caps=force/weight +6%; reset=free/refund ${refunded}/322`,
  );

  const permanentUpgrades =
    metaModule.createDefaultPermanentUpgrades();
  for (const type of configModule.PIECE_TYPES) {
    permanentUpgrades.pieces[type].basic.force = 3;
    permanentUpgrades.pieces[type].basic.weight = 3;
  }
  permanentUpgrades.playerSizeLevel = 1;
  permanentUpgrades.pieces.Pawn.advanced.force = 2;
  const emptyCards = cardsModule.createRunCardState();
  const whiteRookInstance = layoutModule.PIECE_INSTANCES.find(
    (instance) => instance.id === "white-rook-a1",
  );
  const blackRookInstance = layoutModule.PIECE_INSTANCES.find(
    (instance) => instance.id === "black-rook-a8",
  );
  assertCondition(
    whiteRookInstance !== undefined &&
      blackRookInstance !== undefined,
    "전체 크기 진영 검사용 백·흑 룩을 찾지 못했습니다.",
  );
  const sizeOptions = {
    gameMode: "stage",
    stageNumber: 1,
    runCards: emptyCards,
    permanentUpgrades: completedUpgrades,
  };
  const whitePermanentScale =
    stageModule.computeStagePieceScale(
      whiteRookInstance,
      meta,
      sizeOptions,
    );
  const blackPermanentScale =
    stageModule.computeStagePieceScale(
      blackRookInstance,
      meta,
      sizeOptions,
    );
  assertCondition(
    whitePermanentScale === 1.03 &&
      blackPermanentScale === 1,
    `전체 크기 적용 진영 실패: white=${whitePermanentScale}, black=${blackPermanentScale}`,
  );
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
    power * configModule.MAX_LAUNCH_SPEED * 1.03;
  const pawnError =
    Math.abs(pawnDeltaVelocity - pawnExpected) / pawnExpected;
  const rookError =
    Math.abs(rookDeltaVelocity - rookExpected) / rookExpected;
  assertCondition(
    pawnMultiplier === 1.05 &&
      rookMultiplier === 1.03 &&
      pawnError < 0.01 &&
      rookError < 0.01,
    `종류별 힘 실패: pawn=${pawnDeltaVelocity}/${pawnExpected}, rook=${rookDeltaVelocity}/${rookExpected}`,
  );
  console.log(
    `[통과 c] size white/black=${whitePermanentScale.toFixed(2)}/${blackPermanentScale.toFixed(2)}; Pawn level=5 multiplier=${pawnMultiplier.toFixed(6)}, Δv=${pawnDeltaVelocity.toFixed(6)}/${pawnExpected.toFixed(6)}, error=${(pawnError * 100).toFixed(6)}%; Rook level=3 multiplier=${rookMultiplier.toFixed(6)}, Δv=${rookDeltaVelocity.toFixed(6)}/${rookExpected.toFixed(6)}, error=${(rookError * 100).toFixed(6)}%`,
  );

  const weightUpgrades =
    metaModule.createDefaultPermanentUpgrades();
  for (const type of configModule.PIECE_TYPES) {
    weightUpgrades.pieces[type].basic.force = 3;
    weightUpgrades.pieces[type].basic.weight = 3;
  }
  weightUpgrades.playerSizeLevel = 1;
  weightUpgrades.pieces.Pawn.advanced.weight = 1;
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
