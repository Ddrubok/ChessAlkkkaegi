import { readFile, writeFile } from "node:fs/promises";
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
const resultJsonUrl = new URL(
  "./stage-balance-results-v2.json",
  import.meta.url,
);
const resultMarkdownUrl = new URL(
  "./stage-balance-results-v2.md",
  import.meta.url,
);
const r34ResultJsonUrl = new URL(
  "./stage-balance-results.json",
  import.meta.url,
);

// 개발자 요청 기본 표본 수와 안전 상한이다.
const DEFAULT_RUNS_PER_PROFILE = 12;
const DEFAULT_MAX_STAGE = 30;
const MAX_TURNS_PER_MATCH = 200;
// 게임 턴 로직 자체에는 공중·회전 말이 남은 경우의 추가 상한이 없으므로 하네스 무한 루프만 막는 넉넉한 시뮬레이션 상한이다.
const MAX_SIMULATED_SECONDS_PER_TURN = 120;

// 카드 선택은 기획 우선순위를 그대로 고정한다.
const CARD_PRIORITY = [
  "force",
  "weight",
  "size",
  "giantPawn",
  "proneStart",
];

// 각 프로필 값은 공격 방향에 더하는 결정적 오차 상한이다.
const SKILL_PROFILES = [
  { id: "accurate", label: "정확", jitterDegrees: 2 },
  { id: "normal", label: "보통", jitterDegrees: 8 },
  { id: "unskilled", label: "서툼", jitterDegrees: 15 },
];

/**
 * 명령행 숫자 인자를 유한한 양의 정수로 읽는다.
 */
function readPositiveIntegerArgument(
  argumentsList,
  name,
  fallback,
) {
  const index = argumentsList.indexOf(name);
  if (index < 0) {
    return fallback;
  }
  const value = Number(argumentsList[index + 1]);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(
      `${name} 값 ${argumentsList[index + 1]}가 1 이상의 정수가 아닙니다.`,
    );
  }
  return value;
}

/**
 * 요청한 프로필 id만 원래 순서대로 고른다.
 */
function selectProfiles(argumentsList) {
  const index = argumentsList.indexOf("--profiles");
  if (index < 0) {
    return SKILL_PROFILES;
  }
  const requested = new Set(
    String(argumentsList[index + 1] ?? "")
      .split(",")
      .filter(Boolean),
  );
  const selected = SKILL_PROFILES.filter((profile) =>
    requested.has(profile.id),
  );
  if (
    selected.length === 0 ||
    selected.length !== requested.size
  ) {
    throw new Error(
      `--profiles는 ${SKILL_PROFILES.map((profile) => profile.id).join(",")} 중에서 쉼표로 골라야 합니다.`,
    );
  }
  return selected;
}

/**
 * 실험 seed와 턴 번호를 32비트 정수 하나로 섞는다.
 */
function hashTurn(runSeed, turnIndex) {
  let hash =
    Math.imul(runSeed + 1, 0x9e3779b1) ^
    Math.imul(turnIndex + 1, 0x85ebca6b);
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  return (hash ^ (hash >>> 16)) >>> 0;
}

/**
 * 같은 런과 턴이 항상 같은 대칭 범위 각도 오차를 만들게 한다.
 */
function computePlayerJitterDegrees(
  runSeed,
  turnIndex,
  maximumDegrees,
) {
  const unit = hashTurn(runSeed, turnIndex) / 0xffff_ffff;
  return -maximumDegrees + unit * maximumDegrees * 2;
}

/**
 * 수평 단위 방향을 주어진 각도만큼 회전한다.
 */
function rotateHorizontalDirection(direction, degrees) {
  const radians = (degrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return new Vector3(
    direction.x * cosine - direction.z * sine,
    0,
    direction.x * sine + direction.z * cosine,
  ).normalize();
}

/**
 * 실제 GLB의 종류별 메시 지오메트리를 한 번 읽어 모든 경기에 공유한다.
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
      throw new Error(
        `GLB에서 ${type} 지오메트리를 찾지 못했습니다.`,
      );
    }
  }
  return geometries;
}

/**
 * 실제 물리 스폰 배율과 자세를 반영한 최소 헤드리스 렌더 연결표를 만든다.
 */
function createHeadlessSceneRuntime(physicsRuntime, geometries) {
  const scene = new Scene();
  const pieceMeshes = new Map();
  const material = new MeshBasicMaterial();
  const runtime = {
    scene,
    pieceMeshes,
    // turn.ts의 헤드리스 기능 감지 가드가 카메라 회전 대신 준비 상태로 넘긴다.
    controls: { enabled: true },
  };
  rebuildHeadlessMeshes(runtime, physicsRuntime, geometries, material);
  return { runtime, material };
}

/**
 * 다음 스테이지의 실제 물리 말 목록과 같은 메시 목록을 다시 만든다.
 */
function rebuildHeadlessMeshes(
  sceneRuntime,
  physicsRuntime,
  geometries,
  material,
) {
  sceneRuntime.scene.clear();
  sceneRuntime.pieceMeshes.clear();
  for (const binding of physicsRuntime.pieces.values()) {
    const geometry = geometries.get(binding.instance.type);
    if (geometry === undefined) {
      throw new Error(
        `${binding.instance.type} 헤드리스 메시 지오메트리가 없습니다.`,
      );
    }
    const mesh = new Mesh(geometry, material);
    mesh.name = binding.instance.id;
    mesh.scale.setScalar(binding.uniformScale);
    synchronizeOneMesh(binding, mesh);
    sceneRuntime.scene.add(mesh);
    sceneRuntime.pieceMeshes.set(binding.instance.id, mesh);
  }
}

/**
 * 실제 타격점 AABB가 현재 물리 자세를 보도록 선택 메시 하나를 동기화한다.
 */
function synchronizeOneMesh(binding, mesh) {
  const translation = binding.body.translation();
  const rotation = binding.body.rotation();
  mesh.position.set(translation.x, translation.y, translation.z);
  mesh.quaternion.set(
    rotation.x,
    rotation.y,
    rotation.z,
    rotation.w,
  );
  mesh.updateMatrixWorld(true);
}

/**
 * 살아 있는 말 위치를 실제 AI 결정 입력 형식으로 복사한다.
 */
function collectPiecePositions(physicsRuntime) {
  return [...physicsRuntime.pieces.values()].map((binding) => {
    const translation = binding.body.translation();
    return {
      id: binding.instance.id,
      side: binding.instance.side,
      x: translation.x,
      z: translation.z,
    };
  });
}

/**
 * 한 표적에서 가장 가까운 보드 가장자리와 그쪽 단위 방향을 결정한다.
 * 모서리까지 거리가 같으면 -x, +x, -z, +z 순서로 고정해 재현성을 보장한다.
 */
function computeNearestEdge(target, boardHalfExtent) {
  const candidates = [
    {
      distance: Math.abs(target.x + boardHalfExtent),
      direction: { x: -1, z: 0 },
      edge: "xMin",
    },
    {
      distance: Math.abs(boardHalfExtent - target.x),
      direction: { x: 1, z: 0 },
      edge: "xMax",
    },
    {
      distance: Math.abs(target.z + boardHalfExtent),
      direction: { x: 0, z: -1 },
      edge: "zMin",
    },
    {
      distance: Math.abs(boardHalfExtent - target.z),
      direction: { x: 0, z: 1 },
      edge: "zMax",
    },
  ];
  return candidates.reduce((best, candidate) =>
    candidate.distance < best.distance ? candidate : best,
  );
}

/**
 * 가장자리 퇴장을 우선하는 백의 순수 공격 결정을 만든다.
 */
function decideAggressiveWhiteShot(
  pieces,
  boardHalfExtent,
  cellSize,
) {
  if (
    !Number.isFinite(boardHalfExtent) ||
    boardHalfExtent <= 0 ||
    !Number.isFinite(cellSize) ||
    cellSize <= 0
  ) {
    throw new Error(
      `공격 결정 보드 값이 유효하지 않습니다: half=${boardHalfExtent}, cell=${cellSize}`,
    );
  }
  const ownPieces = pieces
    .filter((piece) => piece.side === "white")
    .sort((left, right) => left.id.localeCompare(right.id));
  const enemies = pieces
    .filter((piece) => piece.side === "black")
    .sort((left, right) => left.id.localeCompare(right.id));
  if (ownPieces.length === 0 || enemies.length === 0) {
    return null;
  }

  let target = null;
  let targetEdge = null;
  for (const enemy of enemies) {
    const edge = computeNearestEdge(
      enemy,
      boardHalfExtent,
    );
    if (
      target === null ||
      edge.distance < targetEdge.distance
    ) {
      target = enemy;
      targetEdge = edge;
    }
  }

  let shooter = null;
  let bestAlignment = Number.NEGATIVE_INFINITY;
  for (const own of ownPieces) {
    const deltaX = target.x - own.x;
    const deltaZ = target.z - own.z;
    const distance = Math.hypot(deltaX, deltaZ);
    if (distance <= 1e-9) {
      continue;
    }
    const alignment =
      (deltaX / distance) * targetEdge.direction.x +
      (deltaZ / distance) * targetEdge.direction.z;
    if (alignment > bestAlignment) {
      shooter = own;
      bestAlignment = alignment;
    }
  }

  let usedFallback = false;
  if (shooter === null || bestAlignment <= 0.3) {
    usedFallback = true;
    shooter = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const own of ownPieces) {
      const distance = Math.hypot(
        target.x - own.x,
        target.z - own.z,
      );
      if (
        distance > 1e-9 &&
        distance < nearestDistance
      ) {
        shooter = own;
        nearestDistance = distance;
      }
    }
    if (shooter === null) {
      return null;
    }
  }

  const deltaX = target.x - shooter.x;
  const deltaZ = target.z - shooter.z;
  const distance = Math.hypot(deltaX, deltaZ);
  if (distance <= 1e-9) {
    return null;
  }
  const power = Math.min(
    Math.max(
      0.55 + 0.5 * (distance / (4 * cellSize)),
      0.55,
    ),
    1,
  );
  return {
    pieceId: shooter.id,
    targetPieceId: target.id,
    direction: {
      x: deltaX / distance,
      z: deltaZ / distance,
    },
    distance,
    power,
    nearestEdge: targetEdge.edge,
    targetEdgeDistance: targetEdge.distance,
    alignment: bestAlignment,
    usedFallback,
  };
}

/**
 * 손으로 만든 위치에서 공격 정책의 표적·사수·세기·결정성을 즉시 검증한다.
 */
function validateAggressiveDecisionModel() {
  const board = [
    { id: "white-aligned", side: "white", x: 0, z: 0 },
    { id: "white-other", side: "white", x: 1, z: 1 },
    { id: "black-edge", side: "black", x: 3.8, z: 0 },
    { id: "black-center", side: "black", x: 0, z: 0.5 },
  ];
  const first = decideAggressiveWhiteShot(board, 4, 0.5);
  const second = decideAggressiveWhiteShot(board, 4, 0.5);
  if (
    JSON.stringify(first) !== JSON.stringify(second) ||
    first?.targetPieceId !== "black-edge" ||
    first.pieceId !== "white-aligned" ||
    first.nearestEdge !== "xMax"
  ) {
    throw new Error(
      `공격 결정 자체 검증 실패: ${JSON.stringify(first)}`,
    );
  }
  const nearPower = decideAggressiveWhiteShot(
    [
      { id: "white", side: "white", x: 0, z: 0 },
      { id: "black", side: "black", x: 1e-6, z: 0 },
    ],
    4,
    0.5,
  )?.power;
  const farPower = decideAggressiveWhiteShot(
    [
      { id: "white", side: "white", x: -100, z: 0 },
      { id: "black", side: "black", x: 3.9, z: 0 },
    ],
    4,
    0.5,
  )?.power;
  if (
    Math.abs(nearPower - 0.55000025) > 1e-12 ||
    farPower !== 1
  ) {
    throw new Error(
      `공격 세기 클램프 검증 실패: near=${nearPower}, far=${farPower}`,
    );
  }
  console.log(
    `[정책 통과] target=${first.targetPieceId}, shooter=${first.pieceId}, edge=${first.nearestEdge}, nearPower=${nearPower}, farPower=${farPower}`,
  );
}

/**
 * 공격 결정을 실제 플레이어 발사 큐에 넣고 프로필 오차만 합성한다.
 */
function queueWhiteShot(
  modules,
  runtime,
  runCards,
  profile,
  runSeed,
  turnIndex,
) {
  const decision = decideAggressiveWhiteShot(
    collectPiecePositions(runtime.physicsRuntime),
    runtime.boardHalfExtent,
    runtime.meta.cellSize,
  );
  if (decision === null) {
    throw new Error(
      `백 ${turnIndex + 1}턴에 공격형 발사 결정을 만들지 못했습니다.`,
    );
  }
  const binding = runtime.physicsRuntime.pieces.get(
    decision.pieceId,
  );
  const mesh = runtime.sceneRuntime.pieceMeshes.get(
    decision.pieceId,
  );
  if (
    binding === undefined ||
    mesh === undefined ||
    binding.instance.side !== "white"
  ) {
    throw new Error(
      `백 결정 말 ${decision.pieceId}의 물리·렌더 연결이 올바르지 않습니다.`,
    );
  }
  synchronizeOneMesh(binding, mesh);
  const extraJitterDegrees = computePlayerJitterDegrees(
    runSeed,
    turnIndex,
    profile.jitterDegrees,
  );
  const direction = rotateHorizontalDirection(
    decision.direction,
    extraJitterDegrees,
  );
  const applicationPoint =
    modules.aimparams.computeStrikeApplicationPoint(
      binding,
      mesh,
      runtime.turnRuntime.tuningSettings.strikeHeightRatio,
    );
  const speedMultiplier =
    modules.cards.computePlayerLaunchSpeedMultiplier(
      "stage",
      runCards,
      0,
    );
  const outcome = modules.turn.queueTurnLaunch(
    runtime.turnRuntime,
    {
      pieceId: decision.pieceId,
      direction,
      normalizedPower: decision.power,
      applicationPoint,
      speedMultiplier,
    },
  );
  if (!outcome.accepted) {
    throw new Error(
      `백 발사 큐가 거절됐습니다: ${outcome.reason ?? "원인 없음"}`,
    );
  }
  return {
    pieceId: decision.pieceId,
    targetPieceId: decision.targetPieceId,
    extraJitterDegrees,
    power: decision.power,
    alignment: decision.alignment,
    nearestEdge: decision.nearestEdge,
    usedFallback: decision.usedFallback,
  };
}

/**
 * 예약 시간을 논리 시각으로만 진행해 실제 흑 AI가 같은 발사 큐를 사용하게 한다.
 */
function queueBlackShot(modules, runtime) {
  modules.ai.updateAiRuntime(
    runtime.aiRuntime,
    runtime.aiLogicalTime,
  );
  runtime.aiLogicalTime += 800;
  modules.ai.updateAiRuntime(
    runtime.aiRuntime,
    runtime.aiLogicalTime,
  );
  const request = runtime.turnRuntime.pendingLaunch;
  if (request === null) {
    throw new Error(
      `흑 ${runtime.aiRuntime.shotCounter + 1}번째 AI 발사가 큐에 들어가지 않았습니다.`,
    );
  }
  return {
    pieceId: request.pieceId,
    power: request.normalizedPower,
  };
}

/**
 * 한 발 뒤 실제 턴 정착과 낙하 제거가 끝날 때까지 고정 스텝을 진행한다.
 */
function settleLaunchedTurn(modules, runtime) {
  const maximumSteps = Math.ceil(
    MAX_SIMULATED_SECONDS_PER_TURN /
      modules.config.FIXED_STEP,
  );
  let steps = 0;
  while (
    steps < maximumSteps &&
    runtime.turnRuntime.phase !== "ready" &&
    runtime.turnRuntime.phase !== "match-over"
  ) {
    modules.turn.applyPendingLaunchBeforeStep(
      runtime.turnRuntime,
    );
    runtime.physicsRuntime.world.step();
    modules.turn.updateTurnAfterStep(
      runtime.turnRuntime,
      modules.config.FIXED_STEP,
    );
    steps += 1;
  }
  if (
    runtime.turnRuntime.phase !== "ready" &&
    runtime.turnRuntime.phase !== "match-over"
  ) {
    const groundedIds =
      modules.turn.collectGroundedPieceIds(
        runtime.turnRuntime,
      );
    const worstBodies = [
      ...runtime.physicsRuntime.pieces.values(),
    ]
      .map((binding) => {
        const position = binding.body.translation();
        const linear = binding.body.linvel();
        const angular = binding.body.angvel();
        return {
          id: binding.instance.id,
          position: {
            x: position.x,
            y: position.y,
            z: position.z,
          },
          linearSpeed: Math.hypot(
            linear.x,
            linear.y,
            linear.z,
          ),
          angularSpeed: Math.hypot(
            angular.x,
            angular.y,
            angular.z,
          ),
          sleeping: binding.body.isSleeping(),
          grounded: groundedIds.has(binding.instance.id),
        };
      })
      .sort(
        (left, right) =>
          right.linearSpeed +
          right.angularSpeed -
          (left.linearSpeed + left.angularSpeed),
      )
      .slice(0, 5);
    throw new Error(
      `${runtime.currentStage}스테이지 턴이 ${maximumSteps} fixed step(${MAX_SIMULATED_SECONDS_PER_TURN}초) 안에 정착하지 못했습니다: ${JSON.stringify(worstBodies)}`,
    );
  }
  for (const binding of runtime.physicsRuntime.pieces.values()) {
    const translation = binding.body.translation();
    const rotation = binding.body.rotation();
    const velocities = [
      ...Object.values(translation),
      ...Object.values(rotation),
      ...Object.values(binding.body.linvel()),
      ...Object.values(binding.body.angvel()),
    ];
    if (!velocities.every(Number.isFinite)) {
      throw new Error(
        `${binding.instance.id} 물리 상태에 NaN 또는 Infinity가 생겼습니다.`,
      );
    }
  }
  return steps;
}

/**
 * 현재 스테이지의 실제 스폰·카드·AI 버프를 반영해 보드를 준비한다.
 */
function prepareStage(
  modules,
  runtime,
  geometries,
  stageNumber,
  runCards,
) {
  const stageOptions = {
    gameMode: "stage",
    stageNumber,
    runCards,
  };
  if (runtime.physicsRuntime === null) {
    throw new Error("초기 물리 런타임은 비동기 생성 경로에서 준비해야 합니다.");
  }
  modules.physics.resetPhysicsPieces(
    runtime.physicsRuntime,
    runtime.meta,
    modules.layout.PIECE_INSTANCES,
    stageOptions,
  );
  rebuildHeadlessMeshes(
    runtime.sceneRuntime,
    runtime.physicsRuntime,
    geometries,
    runtime.material,
  );
  modules.physics.preSettlePhysics(runtime.physicsRuntime);
  modules.turn.resetTurnRuntime(runtime.turnRuntime);
  modules.ai.resetAiMatch(runtime.aiRuntime);
  runtime.currentStage = stageNumber;
  runtime.aiLogicalTime = 0;
}

/**
 * 현재 보드의 실제 스폰 수를 진영별로 센다.
 */
function countSpawnedPieces(physicsRuntime) {
  const counts = { white: 0, black: 0 };
  for (const binding of physicsRuntime.pieces.values()) {
    counts[binding.instance.side] += 1;
  }
  return counts;
}

/**
 * 실제 물리·제거·승자 규칙으로 한 스테이지 대국 전체를 진행한다.
 */
function simulateMatch(
  modules,
  runtime,
  runCards,
  profile,
  runSeed,
) {
  const startedAt = performance.now();
  const initialCounts = countSpawnedPieces(
    runtime.physicsRuntime,
  );
  const selfOuts = { white: 0, black: 0 };
  let removedThisTurn = [];
  let winner = null;
  let turnCount = 0;
  let physicsSteps = 0;

  modules.turn.setPieceRemovalHandler(
    runtime.turnRuntime,
    (pieceId) => {
      removedThisTurn.push(pieceId);
    },
  );
  modules.turn.setMatchOverHandler(
    runtime.turnRuntime,
    (matchWinner) => {
      winner = matchWinner;
    },
  );

  while (
    winner === null &&
    turnCount < MAX_TURNS_PER_MATCH
  ) {
    if (runtime.turnRuntime.phase !== "ready") {
      throw new Error(
        `${runtime.currentStage} 스테이지 ${turnCount + 1}턴 시작 단계가 ready가 아닙니다: ${runtime.turnRuntime.phase}`,
      );
    }
    removedThisTurn = [];
    const launchingSide = runtime.turnRuntime.currentSide;
    const launch =
      launchingSide === "white"
        ? queueWhiteShot(
            modules,
            runtime,
            runCards,
            profile,
            runSeed,
            turnCount,
          )
        : queueBlackShot(modules, runtime);
    physicsSteps += settleLaunchedTurn(modules, runtime);
    if (removedThisTurn.includes(launch.pieceId)) {
      selfOuts[launchingSide] += 1;
    }
    turnCount += 1;
  }

  const finalCounts = modules.turn.countRemainingPieces(
    runtime.turnRuntime,
  );
  const outcome =
    winner ?? "draw-timeout";
  return {
    stage: runtime.currentStage,
    winner: outcome,
    turns: turnCount,
    physicsSteps,
    whitePiecesLost:
      initialCounts.white - finalCounts.white,
    blackPiecesLost:
      initialCounts.black - finalCounts.black,
    selfOuts,
    initialPieces: initialCounts,
    remainingPieces: finalCounts,
    forcedSettleCount:
      runtime.turnRuntime.forcedSettleCount,
    wallTimeMs:
      Math.round((performance.now() - startedAt) * 100) / 100,
  };
}

/**
 * 우선순위가 가장 높은 실제 제시 카드 하나를 고른다.
 */
function chooseCard(cards) {
  for (const cardId of CARD_PRIORITY) {
    const card = cards.find((candidate) =>
      candidate.id === cardId,
    );
    if (card !== undefined) {
      return card;
    }
  }
  throw new Error("제시 카드 중 고를 수 있는 카드가 없습니다.");
}

/**
 * 새 카드 상태로 1스테이지부터 패배·무승부·30단계까지 한 런을 진행한다.
 */
async function simulateRun(
  modules,
  meta,
  geometries,
  profile,
  runIndex,
  runSeed,
  maximumStage,
) {
  const runStartedAt = performance.now();
  const runCards = modules.cards.createRunCardState();
  let currentStage = 1;
  const stageOptions = {
    gameMode: "stage",
    stageNumber: currentStage,
    runCards,
  };
  const boardHalfExtent =
    modules.config.deriveBoardHalfExtent(meta.cellSize);
  const physicsRuntime =
    await modules.physics.createPhysicsRuntime(
      meta,
      modules.layout.PIECE_INSTANCES,
      boardHalfExtent,
      stageOptions,
    );
  modules.physics.preSettlePhysics(physicsRuntime);
  const { runtime: sceneRuntime, material } =
    createHeadlessSceneRuntime(
      physicsRuntime,
      geometries,
    );
  const tuningSettings = {
    maxLaunchSpeed: modules.config.MAX_LAUNCH_SPEED,
    strikeHeightRatio: modules.config.STRIKE_HEIGHT_RATIO,
  };
  const turnRuntime = modules.turn.createTurnRuntime(
    physicsRuntime,
    sceneRuntime,
    tuningSettings,
  );
  modules.turn.setTurnGameMode(turnRuntime, "stage");
  const runtime = {
    meta,
    physicsRuntime,
    sceneRuntime,
    material,
    turnRuntime,
    boardHalfExtent,
    currentStage,
    aiLogicalTime: 0,
    aiRuntime: null,
  };
  runtime.aiRuntime = modules.ai.createAiRuntime(
    physicsRuntime,
    sceneRuntime,
    turnRuntime,
    meta.cellSize,
    () => "stage",
    () => runtime.currentStage,
  );

  const matches = [];
  const cardPicks = [];
  let runOutcome = "stage-cap";
  while (currentStage <= maximumStage) {
    if (currentStage > 1) {
      prepareStage(
        modules,
        runtime,
        geometries,
        currentStage,
        runCards,
      );
    }
    const match = simulateMatch(
      modules,
      runtime,
      runCards,
      profile,
      runSeed,
    );
    matches.push(match);
    if (match.winner === "black") {
      runOutcome = "loss";
      break;
    }
    if (match.winner === "draw-timeout") {
      runOutcome = "draw-timeout";
      break;
    }
    if (currentStage === maximumStage) {
      runOutcome = "stage-cap";
      break;
    }
    const offered = modules.cards.drawUpgradeCards(
      currentStage,
      runCards,
    );
    const selected = chooseCard(offered);
    modules.cards.applyCardPick(runCards, selected.id);
    cardPicks.push({
      clearedStage: currentStage,
      offered: offered.map((card) => card.id),
      selected: selected.id,
    });
    currentStage += 1;
    runtime.currentStage = currentStage;
  }

  return {
    profile: profile.id,
    profileLabel: profile.label,
    runIndex,
    seed: runSeed,
    outcome: runOutcome,
    finalStage: currentStage,
    clearedStages: matches.filter(
      (match) => match.winner === "white",
    ).length,
    finalCards: { ...runCards },
    cardPicks,
    matches,
    wallTimeMs:
      Math.round((performance.now() - runStartedAt) * 100) / 100,
  };
}

/**
 * 숫자 배열의 중앙값을 반환한다.
 */
function computeMedian(values) {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * 최빈값이 여럿이면 모두 오름차순으로 반환한다.
 */
function computeModes(values) {
  if (values.length === 0) {
    return [];
  }
  const counts = new Map();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const maximumCount = Math.max(...counts.values());
  return [...counts.entries()]
    .filter(([, count]) => count === maximumCount)
    .map(([value]) => value)
    .sort((left, right) => left - right);
}

/**
 * 두 숫자 열의 표본 피어슨 상관계수를 계산한다.
 */
function computePearson(leftValues, rightValues) {
  if (
    leftValues.length !== rightValues.length ||
    leftValues.length < 2
  ) {
    return null;
  }
  const leftMean =
    leftValues.reduce((sum, value) => sum + value, 0) /
    leftValues.length;
  const rightMean =
    rightValues.reduce((sum, value) => sum + value, 0) /
    rightValues.length;
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < leftValues.length; index += 1) {
    const leftDelta = leftValues[index] - leftMean;
    const rightDelta = rightValues[index] - rightMean;
    covariance += leftDelta * rightDelta;
    leftVariance += leftDelta * leftDelta;
    rightVariance += rightDelta * rightDelta;
  }
  const denominator = Math.sqrt(
    leftVariance * rightVariance,
  );
  return denominator === 0 ? null : covariance / denominator;
}

/**
 * 한 프로필의 단계별 승률·자멸 평균과 사망 분포를 집계한다.
 */
function aggregateProfile(
  profile,
  runs,
  computeStageBuffs,
) {
  const matches = runs.flatMap((run) => run.matches);
  const stages = [
    ...new Set(matches.map((match) => match.stage)),
  ].sort((left, right) => left - right);
  const byStage = stages.map((stage) => {
    const stageMatches = matches.filter(
      (match) => match.stage === stage,
    );
    const wins = stageMatches.filter(
      (match) => match.winner === "white",
    ).length;
    const losses = stageMatches.filter(
      (match) => match.winner === "black",
    ).length;
    const draws = stageMatches.length - wins - losses;
    const sum = (selector) =>
      stageMatches.reduce(
        (total, match) => total + selector(match),
        0,
      );
    const buffs = computeStageBuffs(stage);
    return {
      stage,
      attempts: stageMatches.length,
      wins,
      losses,
      draws,
      winRate: wins / stageMatches.length,
      averageTurns:
        sum((match) => match.turns) / stageMatches.length,
      averageWhiteSelfOuts:
        sum((match) => match.selfOuts.white) /
        stageMatches.length,
      averageBlackSelfOuts:
        sum((match) => match.selfOuts.black) /
        stageMatches.length,
      aiForceSteps: buffs.forceSteps,
    };
  });
  const deathStages = runs
    .filter((run) => run.outcome === "loss")
    .map((run) => run.finalStage);
  return {
    profile: profile.id,
    profileLabel: profile.label,
    jitterDegrees: profile.jitterDegrees,
    runCount: runs.length,
    lossRuns: deathStages.length,
    drawTimeoutRuns: runs.filter(
      (run) => run.outcome === "draw-timeout",
    ).length,
    stageCapRuns: runs.filter(
      (run) => run.outcome === "stage-cap",
    ).length,
    deathStageDistribution: {
      values: deathStages,
      median: computeMedian(deathStages),
      modes: computeModes(deathStages),
      minimum:
        deathStages.length > 0
          ? Math.min(...deathStages)
          : null,
      maximum:
        deathStages.length > 0
          ? Math.max(...deathStages)
          : null,
    },
    byStage,
    wallTimeMs: runs.reduce(
      (sum, run) => sum + run.wallTimeMs,
      0,
    ),
  };
}

/**
 * 전체 경기 표본에서 AI 힘 단계와 흑 자멸의 관찰 상관을 요약한다.
 */
function aggregateAiSelfOutTrend(
  runs,
  computeStageBuffs,
) {
  const matches = runs.flatMap((run) => run.matches);
  const stageThreePlusMatches = matches.filter(
    (match) => match.stage >= 3,
  );
  const unbuffed = matches.filter(
    (match) =>
      computeStageBuffs(match.stage).forceSteps === 0,
  );
  const buffed = matches.filter(
    (match) =>
      computeStageBuffs(match.stage).forceSteps > 0,
  );
  const average = (sample) =>
    sample.length === 0
      ? null
      : sample.reduce(
          (sum, match) => sum + match.selfOuts.black,
          0,
        ) / sample.length;
  const forceSteps = matches.map(
    (match) => computeStageBuffs(match.stage).forceSteps,
  );
  const selfOuts = matches.map(
    (match) => match.selfOuts.black,
  );
  const forceStepValues = [
    ...new Set(
      matches.map(
        (match) =>
          computeStageBuffs(match.stage).forceSteps,
      ),
    ),
  ].sort((left, right) => left - right);
  const byForceStep = forceStepValues.map((forceStep) => {
    const sample = matches.filter(
      (match) =>
        computeStageBuffs(match.stage).forceSteps ===
        forceStep,
    );
    return {
      forceStep,
      matchCount: sample.length,
      averageBlackSelfOuts: average(sample),
    };
  });
  const unbuffedAverage = average(unbuffed);
  const buffedAverage = average(buffed);
  const difference =
    unbuffedAverage === null || buffedAverage === null
      ? null
      : buffedAverage - unbuffedAverage;
  let conclusion = "판단 불가";
  if (difference !== null) {
    conclusion =
      difference > 0.05
        ? "힘 버프 구간에서 AI 자멸이 증가했다"
        : difference < -0.05
          ? "힘 버프 구간에서 AI 자멸이 감소했다"
          : "힘 버프와 AI 자멸 증가의 뚜렷한 관계가 없었다";
  }
  return {
    matchCount: matches.length,
    unbuffedMatchCount: unbuffed.length,
    buffedMatchCount: buffed.length,
    unbuffedAverageBlackSelfOuts: unbuffedAverage,
    buffedAverageBlackSelfOuts: buffedAverage,
    difference,
    pearsonForceStepsVsBlackSelfOuts:
      computePearson(forceSteps, selfOuts),
    stageThreePlusMatchCount: stageThreePlusMatches.length,
    stageThreePlusPearsonForceStepsVsBlackSelfOuts:
      computePearson(
        stageThreePlusMatches.map(
          (match) =>
            computeStageBuffs(match.stage).forceSteps,
        ),
        stageThreePlusMatches.map(
          (match) => match.selfOuts.black,
        ),
      ),
    byForceStep,
    conclusion,
  };
}

/**
 * 모든 프로필의 원시 런을 재사용 가능한 집계 구조로 바꾼다.
 */
function aggregateResults(
  profiles,
  runs,
  computeStageBuffs,
) {
  const profileAggregates = profiles.map((profile) =>
    aggregateProfile(
      profile,
      runs.filter((run) => run.profile === profile.id),
      computeStageBuffs,
    ),
  );
  return {
    profiles: profileAggregates,
    aiSelfOutTrend: aggregateAiSelfOutTrend(
      runs,
      computeStageBuffs,
    ),
  };
}

/**
 * R34 최근접 모델과 v2 공격 모델의 대국 종결성과 턴 수를 같은 정의로 비교한다.
 */
function compareWithR34(r34Result, v2Result) {
  const summarize = (result) => {
    const matches = result.runs.flatMap((run) => run.matches);
    const drawMatches = matches.filter(
      (match) => match.winner === "draw-timeout",
    );
    const totalTurns = matches.reduce(
      (sum, match) => sum + match.turns,
      0,
    );
    return {
      runCount: result.runs.length,
      matchCount: matches.length,
      drawMatchCount: drawMatches.length,
      drawMatchRate:
        matches.length === 0
          ? null
          : drawMatches.length / matches.length,
      averageTurns:
        matches.length === 0
          ? null
          : totalTurns / matches.length,
    };
  };
  const r34 = summarize(r34Result);
  const v2 = summarize(v2Result);
  return {
    r34,
    v2,
    drawMatchesReducedBy:
      r34.drawMatchCount - v2.drawMatchCount,
    averageTurnsDifference:
      v2.averageTurns === null || r34.averageTurns === null
        ? null
        : v2.averageTurns - r34.averageTurns,
  };
}

/**
 * 표에 넣을 비율을 분모와 함께 읽기 쉽게 표시한다.
 */
function formatWinRate(stageRow) {
  if (stageRow === undefined) {
    return "—";
  }
  return `${stageRow.wins}/${stageRow.attempts} (${(stageRow.winRate * 100).toFixed(1)}%)`;
}

/**
 * 선택 표본의 결과를 개발자 질문 순서에 맞춘 한국어 보고서로 만든다.
 */
function createMarkdownReport(result) {
  const profileAggregates = result.aggregate.profiles;
  const allStages = [
    ...new Set(
      profileAggregates.flatMap((profile) =>
        profile.byStage.map((row) => row.stage),
      ),
    ),
  ].sort((left, right) => left - right);
  const deathSummaryRows = profileAggregates.map((profile) => {
    const distribution = profile.deathStageDistribution;
    const modes =
      distribution.modes.length > 0
        ? distribution.modes.join(", ")
        : "—";
    return `| ${profile.profileLabel} (±${profile.jitterDegrees}°) | ${profile.lossRuns}/${profile.runCount} | ${distribution.median ?? "—"} | ${modes} | ${distribution.minimum ?? "—"} | ${distribution.maximum ?? "—"} | ${profile.drawTimeoutRuns} | ${profile.stageCapRuns} |`;
  });
  const winRateRows = allStages.map((stage) => {
    const cells = profileAggregates.map((profile) =>
      formatWinRate(
        profile.byStage.find((row) => row.stage === stage),
      ),
    );
    return `| ${stage} | ${cells.join(" | ")} |`;
  });
  const selfOutRows = allStages.map((stage) => {
    const cells = profileAggregates.map((profile) => {
      const row = profile.byStage.find(
        (candidate) => candidate.stage === stage,
      );
      return row === undefined
        ? "—"
        : `${row.averageBlackSelfOuts.toFixed(3)} / ${row.averageWhiteSelfOuts.toFixed(3)} (${row.attempts})`;
    });
    const forceSteps =
      profileAggregates
        .flatMap((profile) => profile.byStage)
        .find((row) => row.stage === stage)?.aiForceSteps ?? 0;
    return `| ${stage} | ${forceSteps} | ${cells.join(" | ")} |`;
  });
  const normal = profileAggregates.find(
    (profile) => profile.profile === "normal",
  );
  const trend = result.aggregate.aiSelfOutTrend;
  const normalDistribution =
    normal === undefined
      ? "—"
      : [
          ...new Set(
            normal.deathStageDistribution.values,
          ),
        ]
          .sort((left, right) => left - right)
          .map((stage) => {
            const count =
              normal.deathStageDistribution.values.filter(
                (value) => value === stage,
              ).length;
            return `${stage}단계 ${count}런`;
          })
          .join(", ");
  const normalConclusion =
    normal === undefined
      ? "보통 프로필을 실행하지 않았다."
      : normal.deathStageDistribution.median === null
        ? `보통 프로필에서 패배가 없어 전형적 사망 스테이지를 정할 수 없었다. 분포: ${normalDistribution || "패배 없음"}.`
        : `개발자의 원질문에 대한 답은 보통(±8°) 실력의 전형적 사망 스테이지가 중앙값 ${normal.deathStageDistribution.median}단계라는 것이다. 최빈값은 ${normal.deathStageDistribution.modes.join(", ")}단계이며 실제 패배 분포는 ${normalDistribution}이다.`;
  const forceStepRows = trend.byForceStep.map(
    (row) =>
      `| ${row.forceStep} | ${row.matchCount} | ${row.averageBlackSelfOuts?.toFixed(3) ?? "—"} |`,
  );
  const comparison = result.r34Comparison;
  const timingSeconds = result.totalWallTimeMs / 1000;
  return `# 스테이지 밸런스 자동 플레이테스트 v2 — 공격형 백 모델

## 1. 결론 — 보통 실력 전형적 사망 스테이지

${normalConclusion}

| 프로필 | 패배 런 | 중앙값 | 최빈값 | 최소 | 최대 | 200턴 무승부 | 30단계 도달 |
|---|---:|---:|---:|---:|---:|---:|---:|
${deathSummaryRows.join("\n")}

이 결과는 각 프로필 ${result.configuration.runsPerProfile}런, 총 ${result.configuration.totalRuns}런의 결정적 자동 플레이 표본이다. 백은 가장자리에서 가까운 흑 말을 고르고 가장자리 방향 정렬이 가장 좋은 백 말로 공격하며, 프로필별 각도 오차를 더했다. 영구 강화는 0이다.

## 2. 스테이지별 승률

각 칸은 \`승리/시도 (승률)\`이다. 이전 단계에서 탈락한 런은 이후 단계의 분모에 들어가지 않는다.

| 스테이지 | 정확 ±2° | 보통 ±8° | 서툼 ±15° |
|---:|---:|---:|---:|
${winRateRows.join("\n")}

## 3. AI 자멸-힘 버프 상관

전체 표본에서 힘 단계와 경기당 흑 AI 자멸 횟수의 피어슨 상관계수는 ${trend.pearsonForceStepsVsBlackSelfOuts?.toFixed(3) ?? "—"}이다. 3스테이지 이상 ${trend.stageThreePlusMatchCount}경기만 보면 상관계수는 ${trend.stageThreePlusPearsonForceStepsVsBlackSelfOuts?.toFixed(3) ?? "—"}이다.

힘 버프가 없는 경기의 AI 자멸 평균은 ${trend.unbuffedAverageBlackSelfOuts?.toFixed(3) ?? "—"}, 힘 버프가 있는 경기는 ${trend.buffedAverageBlackSelfOuts?.toFixed(3) ?? "—"}로 차이는 ${trend.difference?.toFixed(3) ?? "—"}이다. 관찰 결론은 “${trend.conclusion}”이다.

| AI 힘 단계 | 경기 수 | 경기당 흑 AI 자멸 |
|---:|---:|---:|
${forceStepRows.join("\n")}

단계가 오르면 힘뿐 아니라 흑 크기·중량·폰 등급도 함께 변하므로 이 값은 힘 버프만의 인과 효과가 아니라 전체 스테이지 구성에서 관찰된 상관이다.

각 칸은 \`흑 AI 자멸 평균 / 백 자멸 평균 (경기 수)\`이다.

| 스테이지 | AI 힘 단계 | 정확 | 보통 | 서툼 |
|---:|---:|---:|---:|---:|
${selfOutRows.join("\n")}

## 4. R34 대비 비교

| 모델 | 런 | 경기 | 200턴 무승부 경기 | 무승부율 | 경기당 평균 턴 |
|---|---:|---:|---:|---:|---:|
| R34 최근접 상호 모델 | ${comparison.r34.runCount} | ${comparison.r34.matchCount} | ${comparison.r34.drawMatchCount} | ${(comparison.r34.drawMatchRate * 100).toFixed(1)}% | ${comparison.r34.averageTurns.toFixed(2)} |
| R35 공격형 백 모델 | ${comparison.v2.runCount} | ${comparison.v2.matchCount} | ${comparison.v2.drawMatchCount} | ${(comparison.v2.drawMatchRate * 100).toFixed(1)}% | ${comparison.v2.averageTurns.toFixed(2)} |

공격 모델은 무승부 경기를 ${comparison.drawMatchesReducedBy}개 줄였고 경기당 평균 턴은 ${Math.abs(comparison.averageTurnsDifference).toFixed(2)}턴 ${comparison.averageTurnsDifference <= 0 ? "감소" : "증가"}했다.

## 5. 실행 명령과 결정성

\`\`\`text
node src/tools/stage-balance-sim-v2.mjs
node src/tools/stage-balance-sim-v2.mjs --verify
\`\`\`

- 실행 표본: ${result.configuration.totalRuns}런
- 전체 경기: ${result.runs.reduce((sum, run) => sum + run.matches.length, 0)}경기
- 최초 결과 생성 wall time: ${timingSeconds.toFixed(2)}초
- 결정성 검증: \`wallTimeMs\` 필드만 제외한 전체 JSON 값과 배열 순서 재실행 일치
- 실제 wall time은 운영체제 부하에 따라 달라지므로 결정성 비교 대상에서만 제외했고 원시 JSON에는 경기별·런별 실측값을 보존했다.

## 6. 한계

- 공격형 플레이어는 가장자리와 발사 정렬을 보지만 사람의 말 가치 판단, 연속 수 계획, 약한 샷 선택이나 위험 회피까지 모델링하지는 않는다.
- 프로필당 ${result.configuration.runsPerProfile}런은 초기 측정 표본이며 실제 이용자 사망 분포의 신뢰구간을 확정하기에는 작다.
- 물리는 실제 Rapier 모듈과 게임 상수를 사용했지만 브라우저 카메라 회전 시간 동안의 추가 물리 프레임은 기존 헤드리스 기능 감지 경로에 따라 생략됐다.
- 200턴 무승부가 남아 있다면 그 이후 승패와 사망 단계는 알 수 없고 패배 분포에도 넣지 않았다.
- wall time은 결과 데이터 생성 성능 측정값일 뿐 시뮬레이션 의사결정에는 사용하지 않았다.
`;
}

/**
 * 실제 시간 필드만 재귀적으로 제외해 물리 결과의 결정성을 비교한다.
 */
function stripWallTimes(value) {
  if (Array.isArray(value)) {
    return value.map(stripWallTimes);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) =>
            !key.toLowerCase().endsWith("walltimems"),
        )
        .map(([key, child]) => [key, stripWallTimes(child)]),
    );
  }
  return value;
}

/**
 * 프로필별 런을 순서대로 실행해 Rapier 전역 상태와 로그 순서를 결정적으로 유지한다.
 */
async function simulateAll(
  modules,
  meta,
  geometries,
  profiles,
  runsPerProfile,
  maximumStage,
) {
  const startedAt = performance.now();
  const runs = [];
  const totalRuns = profiles.length * runsPerProfile;
  let completedRuns = 0;
  for (
    let profileIndex = 0;
    profileIndex < profiles.length;
    profileIndex += 1
  ) {
    const profile = profiles[profileIndex];
    for (
      let runIndex = 0;
      runIndex < runsPerProfile;
      runIndex += 1
    ) {
      // 전체 36개 런에서 겹치지 않는 seed를 사용한다.
      const runSeed =
        profileIndex * DEFAULT_RUNS_PER_PROFILE + runIndex;
      const run = await simulateRun(
        modules,
        meta,
        geometries,
        profile,
        runIndex,
        runSeed,
        maximumStage,
      );
      runs.push(run);
      completedRuns += 1;
      console.log(
        `[진행 ${completedRuns}/${totalRuns}] ${profile.label} #${runIndex + 1}: ${run.outcome}, 최종 ${run.finalStage}단계, ${run.matches.length}경기, ${(run.wallTimeMs / 1000).toFixed(2)}초`,
      );
    }
  }
  const aggregate = aggregateResults(
    profiles,
    runs,
    modules.stage.computeStageBuffs,
  );
  return {
    schemaVersion: 2,
    configuration: {
      runsPerProfile,
      totalRuns,
      maximumStage,
      maximumTurnsPerMatch: MAX_TURNS_PER_MATCH,
      maximumSimulatedSecondsPerTurn:
        MAX_SIMULATED_SECONDS_PER_TURN,
      cardPriority: [...CARD_PRIORITY],
      permanentUpgrades: "none",
      whitePlayerPolicy: {
        target: "nearest-board-edge",
        shooter: "maximum-edge-alignment-above-0.3",
        fallback: "nearest-own-to-target",
        minimumPower: 0.55,
      },
      profiles: profiles.map((profile) => ({ ...profile })),
    },
    runs,
    aggregate,
    totalWallTimeMs:
      Math.round((performance.now() - startedAt) * 100) / 100,
  };
}

const argumentsList = process.argv.slice(2);
const runsPerProfile = readPositiveIntegerArgument(
  argumentsList,
  "--runs-per-profile",
  DEFAULT_RUNS_PER_PROFILE,
);
const maximumStage = readPositiveIntegerArgument(
  argumentsList,
  "--max-stage",
  DEFAULT_MAX_STAGE,
);
const profiles = selectProfiles(argumentsList);
const verifiesExisting = argumentsList.includes("--verify");
const writesResults =
  !argumentsList.includes("--no-write") && !verifiesExisting;

const vite = await createServer({
  root: webRoot,
  logLevel: "error",
  appType: "custom",
  server: { middlewareMode: true },
});

try {
  const [
    ai,
    aimparams,
    cards,
    config,
    layout,
    physics,
    stage,
    turn,
  ] = await Promise.all([
    vite.ssrLoadModule("/src/ai.ts"),
    vite.ssrLoadModule("/src/aimparams.ts"),
    vite.ssrLoadModule("/src/cards.ts"),
    vite.ssrLoadModule("/src/config.ts"),
    vite.ssrLoadModule("/src/layout.ts"),
    vite.ssrLoadModule("/src/physics.ts"),
    vite.ssrLoadModule("/src/stage.ts"),
    vite.ssrLoadModule("/src/turn.ts"),
  ]);
  const modules = {
    ai,
    aimparams,
    cards,
    config,
    layout,
    physics,
    stage,
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
  const r34Result = JSON.parse(
    await readFile(r34ResultJsonUrl, "utf8"),
  );
  const geometries = await loadPieceGeometries(
    config.PIECE_TYPES,
  );
  validateAggressiveDecisionModel();

  // 수천 발의 게임 런타임 정보 로그만 숨기고 진행·경고·오류는 그대로 보존한다.
  const originalConsoleInfo = console.info;
  console.info = () => {};
  let result;
  try {
    result = await simulateAll(
      modules,
      meta,
      geometries,
      profiles,
      runsPerProfile,
      maximumStage,
    );
  } finally {
    console.info = originalConsoleInfo;
  }
  result.r34Comparison = compareWithR34(
    r34Result,
    result,
  );

  if (verifiesExisting) {
    const existing = JSON.parse(
      await readFile(resultJsonUrl, "utf8"),
    );
    const expected = JSON.stringify(stripWallTimes(existing));
    const actual = JSON.stringify(stripWallTimes(result));
    if (actual !== expected) {
      let firstDifference = 0;
      const limit = Math.min(actual.length, expected.length);
      while (
        firstDifference < limit &&
        actual[firstDifference] === expected[firstDifference]
      ) {
        firstDifference += 1;
      }
      throw new Error(
        `결정성 재실행 불일치: 첫 문자열 차이 ${firstDifference}, expected=${expected.slice(firstDifference, firstDifference + 160)}, actual=${actual.slice(firstDifference, firstDifference + 160)}`,
      );
    }
    console.log(
      `[결정성 통과] wallTimeMs 제외 전체 JSON ${actual.length}자 값·순서 일치`,
    );
  } else if (writesResults) {
    const json = `${JSON.stringify(result, null, 2)}\n`;
    const markdown = createMarkdownReport(result);
    await writeFile(resultJsonUrl, json, "utf8");
    await writeFile(resultMarkdownUrl, markdown, "utf8");
    console.log(
      `[저장] ${fileURLToPath(resultJsonUrl)} (${json.length}자)`,
    );
    console.log(
      `[저장] ${fileURLToPath(resultMarkdownUrl)} (${markdown.length}자)`,
    );
  } else {
    console.log(
      `[시험 완료] ${result.configuration.totalRuns}런, ${result.runs.reduce((sum, run) => sum + run.matches.length, 0)}경기, ${(result.totalWallTimeMs / 1000).toFixed(2)}초`,
    );
  }
} finally {
  await vite.close();
}
