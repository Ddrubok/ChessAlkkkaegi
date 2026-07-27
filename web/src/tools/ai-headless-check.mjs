import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  Mesh,
  MeshBasicMaterial,
  Scene,
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
 * 두 JSON 호환 결정 결과가 값과 필드 순서까지 같은지 확인한다.
 */
function assertSame(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${label} 실패: expected=${JSON.stringify(expected)}, actual=${JSON.stringify(actual)}`,
    );
  }
}

/**
 * 실제 GLB의 여섯 말 지오메트리를 Node에서 읽어 종류별로 반환한다.
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
      throw new Error(`헤드리스 GLB에서 ${type} 지오메트리를 찾지 못했습니다.`);
    }
  }
  return geometries;
}

/**
 * 현재 살아 있는 모든 Rapier 바디의 위치·회전·속도와 크기 범위를 검사한다.
 */
function assertBodiesHealthy(physicsRuntime, label) {
  for (const binding of physicsRuntime.pieces.values()) {
    const translation = binding.body.translation();
    const rotation = binding.body.rotation();
    const linearVelocity = binding.body.linvel();
    const angularVelocity = binding.body.angvel();
    const values = [
      translation.x,
      translation.y,
      translation.z,
      rotation.x,
      rotation.y,
      rotation.z,
      rotation.w,
      linearVelocity.x,
      linearVelocity.y,
      linearVelocity.z,
      angularVelocity.x,
      angularVelocity.y,
      angularVelocity.z,
    ];
    if (!values.every(Number.isFinite)) {
      throw new Error(`${label}: ${binding.instance.id}에서 NaN/Infinity를 감지했습니다.`);
    }
    if (
      Math.max(
        Math.abs(translation.x),
        Math.abs(translation.y),
        Math.abs(translation.z),
      ) > 100
    ) {
      throw new Error(
        `${label}: ${binding.instance.id} 위치가 폭발 범위 100을 넘었습니다.`,
      );
    }
  }
}

try {
  const [
    aiModule,
    configModule,
    layoutModule,
    physicsModule,
    turnModule,
  ] = await Promise.all([
    vite.ssrLoadModule("/src/ai.ts"),
    vite.ssrLoadModule("/src/config.ts"),
    vite.ssrLoadModule("/src/layout.ts"),
    vite.ssrLoadModule("/src/physics.ts"),
    vite.ssrLoadModule("/src/turn.ts"),
  ]);
  const {
    computeAiPower,
    createAiRuntime,
    decideAiShot,
    updateAiRuntime,
  } = aiModule;
  const deterministicBoard = [
    { id: "black-a", side: "black", x: 2, z: 2 },
    { id: "black-b", side: "black", x: -3, z: 1 },
    { id: "white-a", side: "white", x: 0, z: 0 },
    { id: "white-b", side: "white", x: 4, z: -1 },
  ];
  const firstDecision = decideAiShot(
    deterministicBoard,
    0.6,
    7,
  );
  const secondDecision = decideAiShot(
    deterministicBoard,
    0.6,
    7,
  );
  assertSame(secondDecision, firstDecision, "AI 결정성");
  console.log(
    `[통과] 결정성: ${JSON.stringify(firstDecision)}`,
  );

  const nearestDecision = decideAiShot(
    [
      { id: "white-near", side: "white", x: 0, z: 0 },
      { id: "white-far", side: "white", x: 10, z: 0 },
      { id: "black-near", side: "black", x: 1, z: 0 },
      { id: "black-far", side: "black", x: 7, z: 0 },
    ],
    0.6,
    0,
  );
  if (
    nearestDecision?.pieceId !== "black-near" ||
    nearestDecision.targetPieceId !== "white-near"
  ) {
    throw new Error(
      `최근접 선택 실패: ${JSON.stringify(nearestDecision)}`,
    );
  }
  console.log(
    `[통과] 최근접 선택: ${nearestDecision.pieceId} → ${nearestDecision.targetPieceId}`,
  );

  const minimumPower = computeAiPower(0, 0.6);
  const maximumPower = computeAiPower(1_000_000, 0.6);
  if (minimumPower !== 0.35 || maximumPower !== 1) {
    throw new Error(
      `세기 클램프 실패: min=${minimumPower}, max=${maximumPower}`,
    );
  }
  console.log(
    `[통과] 세기 클램프: near-zero=${minimumPower}, huge=${maximumPower}`,
  );

  const meta = JSON.parse(
    await readFile(
      new URL("../../public/assets/chess-set.meta.json", import.meta.url),
      "utf8",
    ),
  );
  const boardHalfExtent = configModule.deriveBoardHalfExtent(
    meta.cellSize,
  );
  const physicsRuntime = await physicsModule.createPhysicsRuntime(
    meta,
    layoutModule.PIECE_INSTANCES,
    boardHalfExtent,
  );
  const preSettle = physicsModule.preSettlePhysics(physicsRuntime);
  const geometries = await loadPieceGeometries(
    configModule.PIECE_TYPES,
  );
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
    mesh.updateMatrixWorld(true);
    scene.add(mesh);
    pieceMeshes.set(binding.instance.id, mesh);
  }
  const sceneRuntime = {
    scene,
    pieceMeshes,
    controls: { enabled: true },
  };
  const tuningSettings = {
    maxLaunchSpeed: configModule.MAX_LAUNCH_SPEED,
    strikeHeightRatio: configModule.STRIKE_HEIGHT_RATIO,
  };
  const turnRuntime = turnModule.createTurnRuntime(
    physicsRuntime,
    sceneRuntime,
    tuningSettings,
  );
  turnModule.setTurnGameMode(turnRuntime, "stage");
  const aiRuntime = createAiRuntime(
    physicsRuntime,
    sceneRuntime,
    turnRuntime,
    meta.cellSize,
    () => "stage",
  );
  let realTime = 0;
  const shotSummaries = [];
  for (let shot = 0; shot < 3; shot += 1) {
    turnRuntime.currentSide = "black";
    turnRuntime.phase = "ready";
    updateAiRuntime(aiRuntime, realTime);
    realTime += 800;
    updateAiRuntime(aiRuntime, realTime);
    if (turnRuntime.pendingLaunch === null) {
      throw new Error(`${shot + 1}번째 AI 발사가 큐에 들어가지 않았습니다.`);
    }
    let steps = 0;
    const maximumSteps = Math.ceil(
      (configModule.MAX_SETTLE_SECONDS + 15) /
        configModule.FIXED_STEP,
    );
    while (
      steps < maximumSteps &&
      turnRuntime.phase !== "ready" &&
      turnRuntime.phase !== "match-over"
    ) {
      turnModule.applyPendingLaunchBeforeStep(turnRuntime);
      physicsRuntime.world.step();
      turnModule.updateTurnAfterStep(
        turnRuntime,
        configModule.FIXED_STEP,
      );
      assertBodiesHealthy(physicsRuntime, `${shot + 1}번째 발사`);
      steps += 1;
    }
    if (turnRuntime.phase === "match-over") {
      throw new Error(`${shot + 1}번째 스모크 발사에서 대국이 조기 종료됐습니다.`);
    }
    if (turnRuntime.phase !== "ready") {
      throw new Error(
        `${shot + 1}번째 발사가 ${steps} step 안에 정착하지 못했습니다.`,
      );
    }
    let sleepSteps = 0;
    while (
      sleepSteps < configModule.PRE_SETTLE_MAX_STEPS &&
      ![...physicsRuntime.pieces.values()].every((binding) =>
        binding.body.isSleeping(),
      )
    ) {
      physicsRuntime.world.step();
      turnModule.updateTurnAfterStep(
        turnRuntime,
        configModule.FIXED_STEP,
      );
      assertBodiesHealthy(
        physicsRuntime,
        `${shot + 1}번째 후속 수면`,
      );
      sleepSteps += 1;
    }
    const sleepingCount = [...physicsRuntime.pieces.values()].filter(
      (binding) => binding.body.isSleeping(),
    ).length;
    if (sleepingCount !== physicsRuntime.pieces.size) {
      throw new Error(
        `${shot + 1}번째 발사 후 수면 실패: ${sleepingCount}/${physicsRuntime.pieces.size}`,
      );
    }
    shotSummaries.push({
      shot: shot + 1,
      settleSteps: steps,
      sleepSteps,
      pieces: physicsRuntime.pieces.size,
    });
    realTime += 1_000;
  }
  const counts = turnModule.countRemainingPieces(turnRuntime);
  assertBodiesHealthy(physicsRuntime, "3발 종료");
  console.log(
    `[통과] 실제 32말 AI 3발 스모크: preSettle=${preSettle.steps} step, shots=${JSON.stringify(shotSummaries)}, remaining=${JSON.stringify(counts)}, sleeping=${physicsRuntime.pieces.size}/${physicsRuntime.pieces.size}`,
  );
} finally {
  await vite.close();
}
