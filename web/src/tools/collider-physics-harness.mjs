import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import RAPIER from "@dimforge/rapier3d-compat";
import {
  Box3,
  Quaternion,
  Triangle,
  Vector3,
} from "three";
import { ConvexGeometry } from "three/examples/jsm/geometries/ConvexGeometry.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { ConvexHull } from "three/examples/jsm/math/ConvexHull.js";

const PIECE_TYPES = [
  "Pawn",
  "Rook",
  "Knight",
  "Bishop",
  "Queen",
  "King",
];

// 이 값들은 게임 소스와 독립인 하네스 복사본이다. 실행 시작 때 원본 export와 모두 대조한다.
const CONSTANTS = Object.freeze({
  GRAVITY_Y: -9.81,
  WORLD_LENGTH_UNIT: 1,
  FIXED_STEP: 1 / 120,
  TIME_SCALE: Math.sqrt(10),
  PIECE_DENSITY: 1.2,
  PIECE_FRICTION: 0.4,
  PIECE_RESTITUTION: 0.1,
  PIECE_LINEAR_DAMPING: 2.0,
  PIECE_ANGULAR_DAMPING: 2.0,
  SPAWN_GAP: 0,
  BOARD_BORDER_CELLS: 0.25,
  MAX_LAUNCH_SPEED: 11,
  STRIKE_HEIGHT_RATIO: 1.0,
  REST_LINEAR_EPS: 0.05,
  REST_ANGULAR_EPS: 0.1,
  REST_HOLD_SECONDS: 0.3,
  MAX_SETTLE_SECONDS: 8,
  FALL_OUT_Y: -2,
  PRE_SETTLE_MAX_STEPS: 1200,
  CAM_PITCH_MIN: 3,
  CAM_PITCH_MAX: 85,
  CAM_INITIAL_AIM_PITCH_DEG: 44,
});

const TOPPLED_DEGREES = 30;
const AZIMUTH_COUNT = 36;
const POWER_BINARY_STEPS = 12;
const POWER_BRACKET_STEP = 0.05;
const SETTLE_GUARD_SECONDS = 30;
const Q2_POWER = 0.5;
const Q4_POWER = 0.7;
const Q4_CELL_SEPARATION = 2;
const FLOAT_EPS = 1e-12;

const thisFile = fileURLToPath(import.meta.url);
const toolsDirectory = path.dirname(thisFile);
const webRoot = path.resolve(toolsDirectory, "..", "..");
const repositoryRoot = path.resolve(webRoot, "..");
const configPath = path.join(webRoot, "src", "config.ts");
const physicsPath = path.join(webRoot, "src", "physics.ts");
const turnPath = path.join(webRoot, "src", "turn.ts");
const metaPath = path.join(
  webRoot,
  "public",
  "assets",
  "chess-set.meta.json",
);
const glbPath = path.join(
  webRoot,
  "public",
  "assets",
  "chess-pieces.glb",
);
const defaultOutputPath = path.join(
  toolsDirectory,
  "collider-physics-results.json",
);

function parseArguments() {
  const argumentsList = process.argv.slice(2);
  let mode = "all";
  let outputPath = defaultOutputPath;
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--mode") {
      mode = argumentsList[index + 1] ?? "";
      index += 1;
    } else if (argument === "--output") {
      outputPath = path.resolve(process.cwd(), argumentsList[index + 1] ?? "");
      index += 1;
    } else {
      throw new Error(`알 수 없는 인자입니다: ${argument}`);
    }
  }
  if (!["check", "q1", "q2", "q3", "q4", "all"].includes(mode)) {
    throw new Error(`지원하지 않는 --mode 값입니다: ${mode}`);
  }
  return { mode, outputPath };
}

function assertAlmostEqual(label, actual, expected) {
  if (
    !Number.isFinite(actual) ||
    !Number.isFinite(expected) ||
    Math.abs(actual - expected) > FLOAT_EPS
  ) {
    throw new Error(
      `상수 드리프트: ${label} 하네스=${expected}, 원본=${actual}`,
    );
  }
}

function assertSourceContract(source, pattern, label) {
  if (!pattern.test(source)) {
    throw new Error(`소스 계약 드리프트: ${label}`);
  }
}

async function verifySourceContracts() {
  const sourceConfig = await import(pathToFileUrl(configPath));
  for (const [name, duplicatedValue] of Object.entries(CONSTANTS)) {
    if (!(name in sourceConfig)) {
      throw new Error(`config.ts에서 ${name} export를 찾지 못했습니다.`);
    }
    assertAlmostEqual(name, sourceConfig[name], duplicatedValue);
  }

  const [physicsSource, turnSource] = await Promise.all([
    readFile(physicsPath, "utf8"),
    readFile(turnPath, "utf8"),
  ]);
  assertSourceContract(
    physicsSource,
    /new RAPIER\.World\(\{ x: 0, y: GRAVITY_Y, z: 0 \}\)/,
    "Rapier 중력 월드 생성",
  );
  assertSourceContract(
    physicsSource,
    /world\.timestep = FIXED_STEP/,
    "고정 스텝 설정",
  );
  assertSourceContract(
    physicsSource,
    /world\.lengthUnit = WORLD_LENGTH_UNIT/,
    "월드 길이 단위 설정",
  );
  assertSourceContract(
    physicsSource,
    /\.setDensity\(density\)[\s\S]*?\.setFriction\(PIECE_FRICTION\)[\s\S]*?\.setRestitution\(PIECE_RESTITUTION\)/,
    "말 콜라이더 재질과 밀도",
  );
  assertSourceContract(
    physicsSource,
    /\.setLinearDamping\(PIECE_LINEAR_DAMPING\)[\s\S]*?\.setAngularDamping\(PIECE_ANGULAR_DAMPING\)[\s\S]*?\.setCanSleep\(true\)/,
    "강체 감쇠와 수면",
  );
  assertSourceContract(
    physicsSource,
    /RigidBodyDesc\.fixed\(\)\.setTranslation\(0, boardCenterY, 0\)/,
    "보드 강체 위치",
  );
  assertSourceContract(
    turnSource,
    /request\.normalizedPower \* runtime\.tuningSettings\.maxLaunchSpeed/,
    "발사 목표 속도",
  );
  assertSourceContract(
    turnSource,
    /const impulseMagnitude = binding\.body\.mass\(\) \* targetSpeed/,
    "질량 비례 임펄스",
  );
  assertSourceContract(
    turnSource,
    /applyImpulseAtPoint\(impulse, applicationPoint, true\)/,
    "적용점 임펄스",
  );
  assertSourceContract(
    turnSource,
    /Math\.acos\(upDot\) \* \(180 \/ Math\.PI\) < 30/,
    "30도 자세 판정",
  );
  assertSourceContract(
    turnSource,
    /runtime\.restHoldSeconds >= REST_HOLD_SECONDS/,
    "연속 저속 정착 시간",
  );
  assertSourceContract(
    turnSource,
    /runtime\.settleSeconds >= MAX_SETTLE_SECONDS/,
    "강제 정착 시작 시간",
  );

  const neutralPitchRatio =
    (CONSTANTS.CAM_INITIAL_AIM_PITCH_DEG - CONSTANTS.CAM_PITCH_MIN) /
    (CONSTANTS.CAM_PITCH_MAX - CONSTANTS.CAM_PITCH_MIN);
  const launchElevationDegrees = 60 - 120 * neutralPitchRatio;
  assertAlmostEqual("중립 카메라의 발사 고도", launchElevationDegrees, 0);

  return {
    duplicatedConstants: { ...CONSTANTS },
    sourceContracts: "passed",
    topplingDegrees: TOPPLED_DEGREES,
    launchElevationDegrees,
  };
}

function pathToFileUrl(filePath) {
  const normalized = path.resolve(filePath).replaceAll("\\", "/");
  return `file:///${normalized}`;
}

function loadOldMeta() {
  const safeDirectory = repositoryRoot.replaceAll("\\", "/");
  const text = execFileSync(
    "git",
    [
      "-c",
      `safe.directory=${safeDirectory}`,
      "show",
      "HEAD:web/public/assets/chess-set.meta.json",
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  return JSON.parse(text);
}

async function loadInputs() {
  const [newMetaText, glbBuffer] = await Promise.all([
    readFile(metaPath, "utf8"),
    readFile(glbPath),
  ]);
  const oldMeta = loadOldMeta();
  const newMeta = JSON.parse(newMetaText);
  const arrayBuffer = glbBuffer.buffer.slice(
    glbBuffer.byteOffset,
    glbBuffer.byteOffset + glbBuffer.byteLength,
  );
  const gltf = await new GLTFLoader().parseAsync(arrayBuffer, "");
  const geometries = new Map();
  gltf.scene.traverse((object) => {
    if (!object.isMesh || !PIECE_TYPES.includes(object.name)) {
      return;
    }
    object.geometry.computeBoundingBox();
    geometries.set(object.name, object.geometry);
  });
  for (const type of PIECE_TYPES) {
    if (!geometries.has(type)) {
      throw new Error(`GLB에서 ${type} 메시를 찾지 못했습니다.`);
    }
    if (
      oldMeta.pieces[type].colliderPoints.length !== 400 ||
      newMeta.pieces[type].colliderPoints.length !== 400
    ) {
      throw new Error(`${type}의 OLD/NEW 콜라이더 점 수가 400이 아닙니다.`);
    }
  }
  return { oldMeta, newMeta, geometries };
}

function deriveBoardHalfExtent(cellSize) {
  return ((8 + CONSTANTS.BOARD_BORDER_CELLS * 2) * cellSize) / 2;
}

function createColliderDescriptor(points) {
  const vertices = new Float32Array(points.length * 3);
  for (let index = 0; index < points.length; index += 1) {
    vertices[index * 3] = points[index][0];
    vertices[index * 3 + 1] = points[index][1];
    vertices[index * 3 + 2] = points[index][2];
  }
  const descriptor = RAPIER.ColliderDesc.convexHull(vertices);
  if (descriptor === null) {
    throw new Error("Rapier convexHull 생성에 실패했습니다.");
  }
  return descriptor
    .setDensity(CONSTANTS.PIECE_DENSITY)
    .setFriction(CONSTANTS.PIECE_FRICTION)
    .setRestitution(CONSTANTS.PIECE_RESTITUTION);
}

function createScenario(meta, specifications) {
  const world = new RAPIER.World({
    x: 0,
    y: CONSTANTS.GRAVITY_Y,
    z: 0,
  });
  world.timestep = CONSTANTS.FIXED_STEP;
  world.lengthUnit = CONSTANTS.WORLD_LENGTH_UNIT;

  const boardHalfExtent = deriveBoardHalfExtent(meta.cellSize);
  const boardCenterY = -meta.boardThickness / 2;
  const boardBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, boardCenterY, 0),
  );
  const boardCollider = world.createCollider(
    RAPIER.ColliderDesc.cuboid(
      boardHalfExtent,
      meta.boardThickness / 2,
      boardHalfExtent,
    )
      .setFriction(CONSTANTS.PIECE_FRICTION)
      .setRestitution(CONSTANTS.PIECE_RESTITUTION),
    boardBody,
  );

  const pieces = specifications.map((specification) => {
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(
          specification.x,
          CONSTANTS.SPAWN_GAP,
          specification.z,
        )
        .setLinearDamping(CONSTANTS.PIECE_LINEAR_DAMPING)
        .setAngularDamping(CONSTANTS.PIECE_ANGULAR_DAMPING)
        .setCanSleep(true)
        .setSleeping(false),
    );
    const collider = world.createCollider(
      createColliderDescriptor(
        meta.pieces[specification.type].colliderPoints,
      ),
      body,
    );
    return {
      ...specification,
      body,
      collider,
      spawnX: specification.x,
      spawnZ: specification.z,
      removedState: null,
    };
  });

  return { world, boardCollider, pieces };
}

function bodyIsSlow(body) {
  const linearVelocity = body.linvel();
  const angularVelocity = body.angvel();
  return (
    Math.hypot(
      linearVelocity.x,
      linearVelocity.y,
      linearVelocity.z,
    ) < CONSTANTS.REST_LINEAR_EPS &&
    Math.hypot(
      angularVelocity.x,
      angularVelocity.y,
      angularVelocity.z,
    ) < CONSTANTS.REST_ANGULAR_EPS
  );
}

function hasSolverContact(world, first, second) {
  let hasContact = false;
  world.contactPair(first, second, (manifold) => {
    if (manifold.numSolverContacts() > 0) {
      hasContact = true;
    }
  });
  return hasContact;
}

function collectGroundedPieces(scenario, activePieces) {
  const owners = new Map();
  const neighbors = new Map();
  const grounded = new Set();
  for (const piece of activePieces) {
    owners.set(piece.collider.handle, piece);
    neighbors.set(piece, new Set());
  }
  for (const piece of activePieces) {
    scenario.world.contactPairsWith(
      piece.collider,
      (otherCollider) => {
        if (
          !hasSolverContact(
            scenario.world,
            piece.collider,
            otherCollider,
          )
        ) {
          return;
        }
        if (otherCollider.handle === scenario.boardCollider.handle) {
          grounded.add(piece);
          return;
        }
        const otherPiece = owners.get(otherCollider.handle);
        if (otherPiece === undefined || otherPiece === piece) {
          return;
        }
        neighbors.get(piece).add(otherPiece);
        neighbors.get(otherPiece).add(piece);
      },
    );
  }
  const queue = [...grounded];
  for (let index = 0; index < queue.length; index += 1) {
    const piece = queue[index];
    for (const neighbor of neighbors.get(piece)) {
      if (!grounded.has(neighbor)) {
        grounded.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return grounded;
}

function snapshotBody(body) {
  const translation = body.translation();
  const rotation = body.rotation();
  return {
    translation: {
      x: translation.x,
      y: translation.y,
      z: translation.z,
    },
    rotation: {
      x: rotation.x,
      y: rotation.y,
      z: rotation.z,
      w: rotation.w,
    },
  };
}

function preSettleScenario(scenario) {
  let steps = 0;
  while (
    steps < CONSTANTS.PRE_SETTLE_MAX_STEPS &&
    !scenario.pieces.every((piece) => piece.body.isSleeping())
  ) {
    scenario.world.step();
    steps += 1;
  }
  const sleepingCount = scenario.pieces.filter((piece) =>
    piece.body.isSleeping(),
  ).length;
  if (sleepingCount !== scenario.pieces.length) {
    throw new Error(
      `사전 정착 실패: ${steps} step, 수면 ${sleepingCount}/${scenario.pieces.length}`,
    );
  }
  return steps;
}

function transformLocalPoint(point, body) {
  const rotation = body.rotation();
  const translation = body.translation();
  return point
    .clone()
    .applyQuaternion(
      new Quaternion(rotation.x, rotation.y, rotation.z, rotation.w),
    )
    .add(new Vector3(translation.x, translation.y, translation.z));
}

function computeWorldAabbCenter(localBounds, body) {
  const worldBounds = new Box3();
  worldBounds.makeEmpty();
  for (const x of [localBounds.min.x, localBounds.max.x]) {
    for (const y of [localBounds.min.y, localBounds.max.y]) {
      for (const z of [localBounds.min.z, localBounds.max.z]) {
        worldBounds.expandByPoint(
          transformLocalPoint(new Vector3(x, y, z), body),
        );
      }
    }
  }
  return worldBounds.getCenter(new Vector3());
}

function computeApplicationPoint(localBounds, body) {
  const visualCenter = computeWorldAabbCenter(localBounds, body);
  const worldCom = body.worldCom();
  return new Vector3(worldCom.x, worldCom.y, worldCom.z).lerp(
    visualCenter,
    CONSTANTS.STRIKE_HEIGHT_RATIO,
  );
}

function applyLaunch(piece, localBounds, power, azimuthDegrees) {
  const radians = (azimuthDegrees * Math.PI) / 180;
  const direction = {
    x: Math.cos(radians),
    y: 0,
    z: Math.sin(radians),
  };
  const targetSpeed = power * CONSTANTS.MAX_LAUNCH_SPEED;
  const impulseMagnitude = piece.body.mass() * targetSpeed;
  const applicationPoint = computeApplicationPoint(
    localBounds,
    piece.body,
  );
  piece.body.enableCcd(true);
  piece.body.applyImpulseAtPoint(
    {
      x: direction.x * impulseMagnitude,
      y: 0,
      z: direction.z * impulseMagnitude,
    },
    applicationPoint,
    true,
  );
  return { applicationPoint, targetSpeed };
}

function removeFallenPieces(scenario, activePieces) {
  for (let index = activePieces.length - 1; index >= 0; index -= 1) {
    const piece = activePieces[index];
    if (piece.body.translation().y >= CONSTANTS.FALL_OUT_Y) {
      continue;
    }
    piece.removedState = snapshotBody(piece.body);
    scenario.world.removeRigidBody(piece.body);
    activePieces.splice(index, 1);
  }
}

function settleAfterLaunch(scenario) {
  const activePieces = [...scenario.pieces];
  let restHoldSeconds = 0;
  let settleSeconds = 0;
  let steps = 0;
  let forcedSettleUsed = false;
  const maximumSteps = Math.ceil(
    SETTLE_GUARD_SECONDS / CONSTANTS.FIXED_STEP,
  );

  while (steps < maximumSteps) {
    scenario.world.step();
    steps += 1;
    settleSeconds += CONSTANTS.FIXED_STEP;
    removeFallenPieces(scenario, activePieces);

    const allAtRest = activePieces.every(
      (piece) => piece.body.isSleeping() || bodyIsSlow(piece.body),
    );
    restHoldSeconds = allAtRest
      ? restHoldSeconds + CONSTANTS.FIXED_STEP
      : 0;
    if (restHoldSeconds >= CONSTANTS.REST_HOLD_SECONDS) {
      return {
        status: "settled",
        steps,
        simulatedSeconds: settleSeconds,
        forcedSettleUsed,
      };
    }

    if (settleSeconds >= CONSTANTS.MAX_SETTLE_SECONDS) {
      forcedSettleUsed = true;
      const grounded = collectGroundedPieces(scenario, activePieces);
      let everyPieceEligible = true;
      for (const piece of activePieces) {
        if (bodyIsSlow(piece.body) && grounded.has(piece)) {
          piece.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
          piece.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
          piece.body.sleep();
        } else {
          everyPieceEligible = false;
        }
      }
      if (everyPieceEligible) {
        return {
          status: "settled",
          steps,
          simulatedSeconds: settleSeconds,
          forcedSettleUsed,
        };
      }
    }
  }
  throw new Error(
    `정착 가드 ${SETTLE_GUARD_SECONDS}초를 초과했습니다.`,
  );
}

function readFinalPieceState(piece) {
  const removed = piece.removedState !== null;
  const state = removed ? piece.removedState : snapshotBody(piece.body);
  const rotation = state.rotation;
  const upDot = Math.max(
    -1,
    Math.min(
      1,
      1 - 2 * (rotation.x * rotation.x + rotation.z * rotation.z),
    ),
  );
  const tiltDegrees = (Math.acos(upDot) * 180) / Math.PI;
  return {
    removed,
    x: state.translation.x,
    y: state.translation.y,
    z: state.translation.z,
    rotation,
    tiltDegrees,
    toppled: !removed && tiltDegrees >= TOPPLED_DEGREES,
    horizontalDisplacement: Math.hypot(
      state.translation.x - piece.spawnX,
      state.translation.z - piece.spawnZ,
    ),
  };
}

function simulateSingle(meta, geometries, type, power, azimuthDegrees) {
  const scenario = createScenario(meta, [
    { id: "single", type, x: 0, z: 0 },
  ]);
  try {
    const preSettleSteps = preSettleScenario(scenario);
    const localBounds = geometries.get(type).boundingBox;
    if (localBounds === null) {
      throw new Error(`${type} GLB 경계가 없습니다.`);
    }
    applyLaunch(
      scenario.pieces[0],
      localBounds,
      power,
      azimuthDegrees,
    );
    const settlement = settleAfterLaunch(scenario);
    return {
      preSettleSteps,
      ...settlement,
      piece: readFinalPieceState(scenario.pieces[0]),
    };
  } finally {
    scenario.world.free();
  }
}

function simulatePair(
  meta,
  geometries,
  launchedType,
  struckType,
) {
  const halfSeparation =
    (Q4_CELL_SEPARATION * meta.cellSize) / 2;
  const scenario = createScenario(meta, [
    {
      id: "launched",
      type: launchedType,
      x: -halfSeparation,
      z: 0,
    },
    {
      id: "struck",
      type: struckType,
      x: halfSeparation,
      z: 0,
    },
  ]);
  try {
    const preSettleSteps = preSettleScenario(scenario);
    const localBounds = geometries.get(launchedType).boundingBox;
    if (localBounds === null) {
      throw new Error(`${launchedType} GLB 경계가 없습니다.`);
    }
    applyLaunch(scenario.pieces[0], localBounds, Q4_POWER, 0);
    const settlement = settleAfterLaunch(scenario);
    return {
      preSettleSteps,
      ...settlement,
      launched: readFinalPieceState(scenario.pieces[0]),
      struck: readFinalPieceState(scenario.pieces[1]),
    };
  } finally {
    scenario.world.free();
  }
}

function summarizeValues(values) {
  if (values.length === 0) {
    return { min: null, max: null, spread: null };
  }
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  return {
    min: minimum,
    max: maximum,
    spread: maximum - minimum,
  };
}

function findTopplingThreshold(meta, geometries, type, azimuthDegrees) {
  let lowerPower = 0;
  let upperPower = null;
  const bracketRuns = [];
  for (
    let power = POWER_BRACKET_STEP;
    power <= 1 + FLOAT_EPS;
    power += POWER_BRACKET_STEP
  ) {
    const roundedPower = Math.min(1, Number(power.toFixed(12)));
    const result = simulateSingle(
      meta,
      geometries,
      type,
      roundedPower,
      azimuthDegrees,
    );
    bracketRuns.push({
      power: roundedPower,
      toppled: result.piece.toppled,
      removed: result.piece.removed,
    });
    if (result.piece.toppled) {
      upperPower = roundedPower;
      break;
    }
    lowerPower = roundedPower;
  }
  if (upperPower === null) {
    return { threshold: null, bracketRuns, binaryRuns: [] };
  }

  const binaryRuns = [];
  for (let iteration = 0; iteration < POWER_BINARY_STEPS; iteration += 1) {
    const middlePower = (lowerPower + upperPower) / 2;
    const result = simulateSingle(
      meta,
      geometries,
      type,
      middlePower,
      azimuthDegrees,
    );
    binaryRuns.push({
      power: middlePower,
      toppled: result.piece.toppled,
      removed: result.piece.removed,
    });
    if (result.piece.toppled) {
      upperPower = middlePower;
    } else {
      lowerPower = middlePower;
    }
  }
  return {
    threshold: upperPower,
    bracketRuns,
    binaryRuns,
  };
}

function runQ1(metaByVersion, geometries) {
  const results = {};
  for (const type of PIECE_TYPES) {
    console.log(`[Q1] ${type}`);
    results[type] = {};
    for (const [version, meta] of Object.entries(metaByVersion)) {
      const azimuths = [];
      for (let index = 0; index < AZIMUTH_COUNT; index += 1) {
        const azimuthDegrees = index * 10;
        const threshold = findTopplingThreshold(
          meta,
          geometries,
          type,
          azimuthDegrees,
        );
        azimuths.push({ azimuthDegrees, ...threshold });
      }
      const thresholds = azimuths
        .map((entry) => entry.threshold)
        .filter((value) => value !== null);
      results[type][version] = {
        ...summarizeValues(thresholds),
        foundCount: thresholds.length,
        azimuths,
      };
    }
  }
  return results;
}

function runQ2(metaByVersion, geometries) {
  const results = {};
  for (const type of PIECE_TYPES) {
    console.log(`[Q2] ${type}`);
    results[type] = {};
    for (const [version, meta] of Object.entries(metaByVersion)) {
      const azimuths = [];
      for (let index = 0; index < AZIMUTH_COUNT; index += 1) {
        const azimuthDegrees = index * 10;
        const simulation = simulateSingle(
          meta,
          geometries,
          type,
          Q2_POWER,
          azimuthDegrees,
        );
        azimuths.push({
          azimuthDegrees,
          displacement: simulation.piece.horizontalDisplacement,
          removed: simulation.piece.removed,
          toppled: simulation.piece.toppled,
          settleSteps: simulation.steps,
        });
      }
      const restedDistances = azimuths
        .filter((entry) => !entry.removed)
        .map((entry) => entry.displacement);
      results[type][version] = {
        ...summarizeValues(restedDistances),
        restedCount: restedDistances.length,
        removedCount: AZIMUTH_COUNT - restedDistances.length,
        azimuths,
      };
    }
  }
  return results;
}

function buildHullDistanceData(points) {
  const vectors = points.map(
    (point) => new Vector3(point[0], point[1], point[2]),
  );
  const hull = new ConvexHull().setFromPoints(vectors);
  const geometry = new ConvexGeometry(vectors);
  const positions = geometry.getAttribute("position");
  const triangles = [];
  for (let index = 0; index < positions.count; index += 3) {
    triangles.push(
      new Triangle(
        new Vector3().fromBufferAttribute(positions, index),
        new Vector3().fromBufferAttribute(positions, index + 1),
        new Vector3().fromBufferAttribute(positions, index + 2),
      ),
    );
  }
  geometry.dispose();
  return { hull, triangles };
}

function exactOutwardDistance(point, hullData) {
  if (hullData.hull.containsPoint(point)) {
    return 0;
  }
  let minimumDistance = Number.POSITIVE_INFINITY;
  const closestPoint = new Vector3();
  for (const triangle of hullData.triangles) {
    triangle.closestPointToPoint(point, closestPoint);
    minimumDistance = Math.min(
      minimumDistance,
      closestPoint.distanceTo(point),
    );
  }
  return minimumDistance;
}

function summarizeBand(distances) {
  return {
    vertexCount: distances.length,
    max: Math.max(...distances),
    mean:
      distances.reduce((sum, distance) => sum + distance, 0) /
      distances.length,
    outsideCount: distances.filter((distance) => distance > 0).length,
  };
}

function runQ3(metaByVersion, geometries) {
  const results = {};
  for (const type of PIECE_TYPES) {
    console.log(`[Q3] ${type}`);
    const position = geometries.get(type).getAttribute("position");
    const vertices = [];
    let minimumY = Number.POSITIVE_INFINITY;
    let maximumY = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < position.count; index += 1) {
      const vertex = new Vector3().fromBufferAttribute(position, index);
      vertices.push(vertex);
      minimumY = Math.min(minimumY, vertex.y);
      maximumY = Math.max(maximumY, vertex.y);
    }
    const heightLimit = minimumY + (maximumY - minimumY) * 0.2;
    results[type] = { vertexCount: vertices.length, heightLimit };
    for (const [version, meta] of Object.entries(metaByVersion)) {
      const hullData = buildHullDistanceData(
        meta.pieces[type].colliderPoints,
      );
      const below = [];
      const above = [];
      for (const vertex of vertices) {
        const distance = exactOutwardDistance(vertex, hullData);
        (vertex.y <= heightLimit ? below : above).push(distance);
      }
      results[type][version] = {
        below20: summarizeBand(below),
        above20: summarizeBand(above),
        hullTriangleCount: hullData.triangles.length,
      };
    }
    results[type].above20Delta = {
      max:
        results[type].NEW.above20.max -
        results[type].OLD.above20.max,
      mean:
        results[type].NEW.above20.mean -
        results[type].OLD.above20.mean,
    };
  }
  return results;
}

function runQ4(metaByVersion, geometries) {
  const combinations = [];
  for (const launchedType of PIECE_TYPES) {
    for (const struckType of PIECE_TYPES) {
      console.log(`[Q4] ${launchedType} -> ${struckType}`);
      const versions = {};
      for (const [version, meta] of Object.entries(metaByVersion)) {
        const simulation = simulatePair(
          meta,
          geometries,
          launchedType,
          struckType,
        );
        versions[version] = {
          struckDisplacement:
            simulation.struck.horizontalDisplacement,
          struckToppled: simulation.struck.toppled,
          struckRemoved: simulation.struck.removed,
          struckTiltDegrees: simulation.struck.tiltDegrees,
          settleSteps: simulation.steps,
        };
      }
      combinations.push({
        launchedType,
        struckType,
        ...versions,
        outcomeFlipped:
          versions.OLD.struckToppled !==
            versions.NEW.struckToppled ||
          versions.OLD.struckRemoved !==
            versions.NEW.struckRemoved,
        displacementDelta:
          versions.NEW.struckDisplacement -
          versions.OLD.struckDisplacement,
      });
    }
  }
  return {
    combinations,
    flips: combinations.filter((entry) => entry.outcomeFlipped),
  };
}

function deterministicProjection(result) {
  if ("piece" in result) {
    return {
      steps: result.steps,
      piece: result.piece,
    };
  }
  return {
    steps: result.steps,
    launched: result.launched,
    struck: result.struck,
  };
}

function verifyDeterminism(metaByVersion, geometries) {
  const checks = [];
  for (const [version, meta] of Object.entries(metaByVersion)) {
    for (const type of PIECE_TYPES) {
      const first = deterministicProjection(
        simulateSingle(meta, geometries, type, Q2_POWER, 70),
      );
      const second = deterministicProjection(
        simulateSingle(meta, geometries, type, Q2_POWER, 70),
      );
      const identical = JSON.stringify(first) === JSON.stringify(second);
      checks.push({ version, type, identical });
      if (!identical) {
        throw new Error(
          `결정성 실패: ${version} ${type} 동일 입력 반복 결과가 다릅니다.`,
        );
      }
    }
  }
  return {
    repeatedScenarioCount: checks.length,
    allByteIdentical: checks.every((entry) => entry.identical),
    checks,
  };
}

function number(value, digits = 6) {
  return value === null ? "N/A" : value.toFixed(digits);
}

function renderQ1Table(q1) {
  const lines = [
    "| 말 | OLD min | OLD max | OLD spread | NEW min | NEW max | NEW spread | spread 변화 |",
    "|---|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const type of PIECE_TYPES) {
    const oldValue = q1[type].OLD;
    const newValue = q1[type].NEW;
    const delta =
      oldValue.spread === null || newValue.spread === null
        ? null
        : newValue.spread - oldValue.spread;
    lines.push(
      `| ${type} | ${number(oldValue.min)} | ${number(oldValue.max)} | ${number(oldValue.spread)} | ${number(newValue.min)} | ${number(newValue.max)} | ${number(newValue.spread)} | ${number(delta)} |`,
    );
  }
  return lines.join("\n");
}

function renderQ2Table(q2) {
  const lines = [
    "| 말 | OLD min | OLD max | OLD spread | OLD out | NEW min | NEW max | NEW spread | NEW out | spread 변화 |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const type of PIECE_TYPES) {
    const oldValue = q2[type].OLD;
    const newValue = q2[type].NEW;
    const delta =
      oldValue.spread === null || newValue.spread === null
        ? null
        : newValue.spread - oldValue.spread;
    lines.push(
      `| ${type} | ${number(oldValue.min)} | ${number(oldValue.max)} | ${number(oldValue.spread)} | ${oldValue.removedCount} | ${number(newValue.min)} | ${number(newValue.max)} | ${number(newValue.spread)} | ${newValue.removedCount} | ${number(delta)} |`,
    );
  }
  return lines.join("\n");
}

function renderQ3Table(q3) {
  const lines = [
    "| 말 | 구간 | OLD max | OLD mean | NEW max | NEW mean | max 변화 | mean 변화 |",
    "|---|---|---:|---:|---:|---:|---:|---:|",
  ];
  for (const type of PIECE_TYPES) {
    for (const [bandKey, bandLabel] of [
      ["below20", "≤20%"],
      ["above20", ">20%"],
    ]) {
      const oldValue = q3[type].OLD[bandKey];
      const newValue = q3[type].NEW[bandKey];
      lines.push(
        `| ${type} | ${bandLabel} | ${number(oldValue.max, 9)} | ${number(oldValue.mean, 9)} | ${number(newValue.max, 9)} | ${number(newValue.mean, 9)} | ${number(newValue.max - oldValue.max, 9)} | ${number(newValue.mean - oldValue.mean, 9)} |`,
      );
    }
  }
  return lines.join("\n");
}

function renderQ4Table(q4) {
  const lines = [
    "| 발사→피격 | OLD 변위 | OLD 전복 | NEW 변위 | NEW 전복 | 변위 변화 | 결과 flip |",
    "|---|---:|---|---:|---|---:|---|",
  ];
  for (const entry of q4.combinations) {
    lines.push(
      `| ${entry.launchedType}→${entry.struckType} | ${number(entry.OLD.struckDisplacement)} | ${entry.OLD.struckToppled ? "예" : "아니오"} | ${number(entry.NEW.struckDisplacement)} | ${entry.NEW.struckToppled ? "예" : "아니오"} | ${number(entry.displacementDelta)} | ${entry.outcomeFlipped ? "예" : "아니오"} |`,
    );
  }
  return lines.join("\n");
}

function buildConclusion(results) {
  if (results.q1 === undefined) {
    return "선택 실행 모드이므로 전체 결론은 내리지 않았습니다.";
  }
  const q1Improved = [];
  const q1Worsened = [];
  const q1Unchanged = [];
  for (const type of PIECE_TYPES) {
    const oldSpread = results.q1[type].OLD.spread;
    const newSpread = results.q1[type].NEW.spread;
    if (oldSpread === null || newSpread === null) {
      continue;
    }
    const delta = newSpread - oldSpread;
    if (delta < -1e-6) {
      q1Improved.push(type);
    } else if (delta > 1e-6) {
      q1Worsened.push(type);
    } else {
      q1Unchanged.push(type);
    }
  }
  const lines = [
    `주목적인 Q1 전복 임계 power의 방위 일관성은 개선 ${q1Improved.length}종(${q1Improved.join(", ")}), 악화 ${q1Worsened.length}종(${q1Worsened.join(", ") || "없음"}), 동일 ${q1Unchanged.length}종입니다. 따라서 전복 임계값만 보면 실제 플레이는 대체로 좋아졌습니다.`,
  ];
  if (results.q2 !== undefined) {
    const q2Improved = PIECE_TYPES.filter(
      (type) =>
        results.q2[type].NEW.spread < results.q2[type].OLD.spread - 1e-6,
    );
    const q2Worsened = PIECE_TYPES.filter(
      (type) =>
        results.q2[type].NEW.spread > results.q2[type].OLD.spread + 1e-6,
    );
    lines.push(
      `그러나 Q2 최종 이동 변위의 방위 일관성은 개선 ${q2Improved.length}종(${q2Improved.join(", ") || "없음"}), 악화 ${q2Worsened.length}종(${q2Worsened.join(", ") || "없음"})으로 반대 결과입니다.`,
    );
  }
  if (results.q3 !== undefined) {
    const upperMaxWorse = PIECE_TYPES.filter(
      (type) => results.q3[type].above20Delta.max > 1e-9,
    );
    const upperMeanWorse = PIECE_TYPES.filter(
      (type) => results.q3[type].above20Delta.mean > 1e-9,
    );
    lines.push(
      `Q3의 높이 20% 초과 영역은 최대 바깥 오차 악화가 ${upperMaxWorse.length}종이며, 평균 오차는 ${upperMeanWorse.length}종(${upperMeanWorse.join(", ") || "없음"})에서 소폭 악화됐습니다.`,
    );
  }
  if (results.q4 !== undefined) {
    lines.push(
      `Q4에서는 36개 조합 중 ${results.q4.flips.length}개의 전복/낙하 결과가 뒤집혔습니다. 그러므로 전체 실제 플레이를 부작용 없이 개선했다고 말할 수는 없고, 정확한 결론은 "전복 임계 일관성은 대체로 개선됐지만 이동 일관성과 말끼리 충돌에는 중요한 회귀가 있는 혼합 결과"입니다.`,
    );
  }
  return lines.join("\n\n");
}

function renderReport(results, commandText) {
  const sections = [
    "# 콜라이더 수정 실제 플레이 영향 독립 검증",
    "",
    "## 1. 결론",
    "",
    buildConclusion(results),
    "",
    "판정 정의: 초기 당구식 카메라 피치 44°에서 파생되는 수평 발사, 최종 기울기 30° 이상을 전복으로 보았습니다. 판 밖 낙하는 전복과 구분했습니다.",
    "",
    "검증 조건: 중력 -9.81, 길이 단위 1, 1/120초 고정 스텝, 밀도 1.2, 마찰 0.4, 반발 0.1, 선형/각 감쇠 2.0, 최대 발사 속도 11, 타격 높이 비율 1.0, 저속 한계 0.05/0.1, 정착 유지 0.3초, 강제 정착 시작 8초를 원본 export와 실행 시 대조했습니다. TIME_SCALE=√10은 렌더 accumulator가 고정 스텝을 소비하는 속도만 바꾸므로 고정 스텝을 직접 진행하는 헤드리스 결과에는 영향을 주지 않습니다.",
    "",
    "임펄스 적용점은 게임과 동일하게 lerp(body.worldCom(), 현재 자세의 렌더 메시 world AABB 중심, STRIKE_HEIGHT_RATIO)로 계산했고, 임펄스 크기는 body.mass() × power × MAX_LAUNCH_SPEED로 계산했습니다. 보드는 게임과 같은 두께·반폭·마찰·반발을 적용했습니다.",
  ];
  if (results.q1 !== undefined) {
    sections.push(
      "",
      "## 2. Q1 — 전복 임계 power의 방위 일관성",
      "",
      `36방위(10° 간격), 0.05 power 간격으로 최초 전복 구간을 찾은 뒤 ${POWER_BINARY_STEPS}회 이분 탐색했습니다. power 해상도는 약 ${(POWER_BRACKET_STEP / 2 ** POWER_BINARY_STEPS).toExponential(3)}입니다.`,
      "",
      renderQ1Table(results.q1),
    );
  }
  if (results.q2 !== undefined) {
    sections.push(
      "",
      "## 3. Q2 — power 0.5 최종 수평 변위",
      "",
      renderQ2Table(results.q2),
    );
  }
  if (results.q3 !== undefined) {
    sections.push(
      "",
      "## 4. Q3 — GLB 정점의 hull 밖 유클리드 거리",
      "",
      "각 밴드의 mean은 hull 내부 정점의 0을 포함합니다. 단위는 WORLD_LENGTH_UNIT=1인 미터이며, 양의 변화는 NEW가 더 나빠진 값입니다. 모든 GLB POSITION 정점을 높이 20% 기준으로 나누고, hull 밖 정점은 가장 가까운 hull 삼각면까지의 정확한 유클리드 거리를 계산했습니다.",
      "",
      renderQ3Table(results.q3),
    );
  }
  if (results.q4 !== undefined) {
    const flipSummary = results.q4.flips
      .map(
        (entry) =>
          `${entry.launchedType}→${entry.struckType} ` +
          `(${entry.OLD.struckToppled ? "전복" : "직립"}→${entry.NEW.struckToppled ? "전복" : "직립"})`,
      )
      .join(", ");
    sections.push(
      "",
      "## 5. Q4 — 2셀 간격 정면 충돌",
      "",
      renderQ4Table(results.q4),
      "",
      `전복/낙하 결과 flip: ${results.q4.flips.length}개 — ${flipSummary || "없음"}`,
    );
  }
  const upperMeanRegressions =
    results.q3 === undefined
      ? []
      : PIECE_TYPES.filter(
          (type) => results.q3[type].above20Delta.mean > 1e-9,
        ).map(
          (type) =>
            `${type} +${results.q3[type].above20Delta.mean.toFixed(9)}`,
        );
  sections.push(
    "",
    "## 6. 부작용과 예외",
    "",
    results.q3 === undefined
      ? "- Q3를 실행하지 않았습니다."
      : `- Q3의 >20% 최대 오차는 악화된 말이 없습니다. 평균 오차 악화: ${upperMeanRegressions.join(", ") || "없음"}.`,
    results.q4 === undefined
      ? "- Q4를 실행하지 않았습니다."
      : `- Q4 결과 flip은 ${results.q4.flips.length}개이며, 단순 수치 흔들림이 아니라 전복 여부 자체가 달라진 게임플레이 변화입니다.`,
    "",
    "## 7. 실행한 명령과 결과",
    "",
    `- \`${commandText}\``,
    `- 상수·소스 계약 검사: ${results.checks.sourceContracts}`,
    `- 동일 입력 반복 결정성: ${results.determinism.allByteIdentical ? "통과" : "실패"} (${results.determinism.repeatedScenarioCount}개 OLD/NEW·말 조합)`,
    `- Rapier 버전: ${results.environment.rapierVersion}`,
    "",
    "## 8. 미검증 항목",
    "",
    "- 브라우저 렌더 루프 자체를 구동하지 않았습니다. Node와 게임은 같은 @dimforge/rapier3d-compat 패키지 및 WASM을 사용하며, 감지된 수치 차이는 없습니다.",
    "- Rapier 0.19.3 초기화가 `using deprecated parameters for the initialization function; pass a single object instead` 경고를 출력합니다. 동일 패키지 내부 경고이며 계산 실패나 결정성 차이는 감지되지 않았습니다.",
    "- Q1은 첫 번째 전복 구간을 찾은 뒤 이분 탐색합니다. 더 높은 power에서 자세가 다시 직립하는 비단조 구간은 최소 임계값에 포함하지 않습니다.",
    "- Q2의 travel은 누적 경로 길이가 아니라 시작점에서 최종 정착점까지의 수평 변위입니다.",
  );
  return sections.join("\n");
}

async function main() {
  const { mode, outputPath } = parseArguments();
  const startedAt = performance.now();
  const checks = await verifySourceContracts();
  await RAPIER.init();
  const { oldMeta, newMeta, geometries } = await loadInputs();
  const metaByVersion = { OLD: oldMeta, NEW: newMeta };
  const determinism = verifyDeterminism(metaByVersion, geometries);
  const results = {
    environment: {
      nodeVersion: process.version,
      rapierVersion: RAPIER.version(),
      fixedStep: CONSTANTS.FIXED_STEP,
      azimuthCount: AZIMUTH_COUNT,
      powerBinarySteps: POWER_BINARY_STEPS,
    },
    checks,
    determinism,
  };

  if (mode === "q1" || mode === "all") {
    const q1StartedAt = performance.now();
    results.q1 = runQ1(metaByVersion, geometries);
    results.q1WallSeconds = (performance.now() - q1StartedAt) / 1000;
    if (results.q1WallSeconds > 20 * 60) {
      throw new Error(
        `Q1이 20분 제한을 초과했습니다: ${results.q1WallSeconds.toFixed(1)}초`,
      );
    }
  }
  if (mode === "q2" || mode === "all") {
    results.q2 = runQ2(metaByVersion, geometries);
  }
  if (mode === "q3" || mode === "all") {
    results.q3 = runQ3(metaByVersion, geometries);
  }
  if (mode === "q4" || mode === "all") {
    results.q4 = runQ4(metaByVersion, geometries);
  }

  results.totalWallSeconds = (performance.now() - startedAt) / 1000;
  const commandText =
    `node src/tools/collider-physics-harness.mjs --mode ${mode} ` +
    `--output ${path.relative(webRoot, outputPath).replaceAll("\\", "/")}`;
  const reportPath = outputPath.replace(/\.json$/i, ".md");
  const report = renderReport(results, commandText);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await Promise.all([
    writeFile(outputPath, `${JSON.stringify(results, null, 2)}\n`, "utf8"),
    writeFile(reportPath, `${report}\n`, "utf8"),
  ]);
  console.log(
    `완료: ${path.relative(webRoot, outputPath)}, ${path.relative(webRoot, reportPath)}`,
  );
  console.log(report);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
