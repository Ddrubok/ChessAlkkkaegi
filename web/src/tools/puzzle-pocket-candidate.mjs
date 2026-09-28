import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// 앱 모듈은 확장자 없는 import를 쓰므로 Node로 직접 불러오지 않고 Vite로 불러온다.
const vite = await createServer({
  root: fileURLToPath(new URL("../..", import.meta.url)),
  configFile: false,
  logLevel: "error",
  server: { middlewareMode: true, hmr: false },
});
const { FIXED_STEP, FALL_OUT_Y, MAX_LAUNCH_SPEED } = await vite.ssrLoadModule("/src/config.ts");
const { PUZZLE_CATALOG, evaluatePuzzleAttempt } = await vite.ssrLoadModule("/src/puzzle.ts");
const { appendPuzzlePhysicsEvidence } = await vite.ssrLoadModule("/src/puzzle-evidence.ts");
const { PIECE_INSTANCES } = await vite.ssrLoadModule("/src/layout.ts");
const { applyPuzzleSpawnDefinitions } = await vite.ssrLoadModule("/src/puzzle-spawn.ts");
const {
  createPhysicsRuntime,
  preSettlePhysics,
  rebuildPhysicsBoard,
  resetPhysicsBreakableWalls,
  resetPhysicsPieces,
} = await vite.ssrLoadModule("/src/physics.ts");
const { PuzzlePhysicsTracker } = await vite.ssrLoadModule("/src/puzzle-physics.ts");
const { computeStageBoardHalfExtent } = await vite.ssrLoadModule("/src/stage.ts");

globalThis.localStorage ??= { getItem: () => null, setItem: () => {} };
globalThis.document ??= new Proxy({ documentElement: {}, body: {}, addEventListener: () => {}, removeEventListener: () => {} }, {
  get: (target, key) => target[key] ?? noop,
});
const noop = new Proxy({}, {
  get: (_target, key) => key === "visible" ? true : noop,
  set: () => true,
});
const noopMesh = new Proxy({
  geometry: { dispose: () => {} },
  material: { dispose: () => {} },
  position: { set: () => {} },
  quaternion: { set: () => {} },
  updateMatrixWorld: () => {},
}, {
  get: (target, key) => target[key] ?? noop,
  set: () => true,
});
const meta = JSON.parse(await readFile(
  new URL("../../public/assets/chess-set.meta.json", import.meta.url),
  "utf8",
));
const puzzle = PUZZLE_CATALOG.find((item) => item.puzzleId === "P03");
const shooterId = puzzle.pieces[0].id;
const targetId = puzzle.pieces[1].id;
const boardOptions = { gameMode: "stage", stageNumber: puzzle.boardStage };
const puzzleStageOptions = { gameMode: "puzzle", stageNumber: 1 };
const baseHalfExtent = computeStageBoardHalfExtent(meta.cellSize, "hotseat", 1);
const pocketHalfExtent = computeStageBoardHalfExtent(meta.cellSize, boardOptions.gameMode, boardOptions.stageNumber);
let geometrySnapshot = null;

function instancesFor(definition) {
  return definition.pieces.map((piece, index) => {
    const source = PIECE_INSTANCES.find((instance) => instance.type === piece.type && instance.side === piece.side);
    return { ...source, id: piece.id, startingSquare: { file: String.fromCharCode(97 + index), rank: piece.side === "white" ? 1 : 8 } };
  });
}

function withPositions(positions) {
  return {
    ...puzzle,
    pieces: puzzle.pieces.map((piece) => positions[piece.id] ? { ...piece, position: { ...piece.position, ...positions[piece.id] } } : piece),
  };
}

function sceneRuntimeFor(runtime) {
  const sceneRuntime = new Proxy({ pieceMeshes: new Map(), scene: { remove: () => {} } }, {
    get: (target, key) => {
      if (!(key in target)) target[key] = new Map();
      return target[key];
    },
  });
  for (const id of runtime.pieces.keys()) sceneRuntime.pieceMeshes.set(id, noopMesh);
  for (const [id, wall] of runtime.breakableWalls) sceneRuntime.breakableWallMeshes.set(id, { mesh: noopMesh, definition: wall.definition });
  return sceneRuntime;
}

async function createBaseRuntime() {
  const oldInfo = console.info;
  const oldWarn = console.warn;
  console.info = () => {};
  console.warn = () => {};
  try {
    return await createPhysicsRuntime(meta, PIECE_INSTANCES, baseHalfExtent, { gameMode: "hotseat", stageNumber: 1 });
  } finally {
    console.info = oldInfo;
    console.warn = oldWarn;
  }
}

async function prepare(runtime, definition) {
  rebuildPhysicsBoard(runtime, meta, pocketHalfExtent, boardOptions);
  resetPhysicsPieces(runtime, meta, instancesFor(definition), puzzleStageOptions);
  // 후보 도구는 포켓 보드의 실제 외곽 벽을 포함해야 하므로 reset에도 stage 보드 옵션을 사용한다.
  resetPhysicsBreakableWalls(runtime, meta, boardOptions);
  geometrySnapshot ??= {
    boardHalfExtent: runtime.boardHalfExtent,
    boardTop: runtime.boardTop,
    holes: runtime.boardHoleRectangles.map((rectangle) => ({ ...rectangle })),
    pocketWalls: [...runtime.breakableWalls.values()].map((binding) => ({
      ...binding.definition,
      center: { ...binding.definition.center },
      halfExtents: { ...binding.definition.halfExtents },
    })),
  };
  const sceneRuntime = sceneRuntimeFor(runtime);
  applyPuzzleSpawnDefinitions(
    definition.pieces.map((piece) => ({ pieceId: piece.id, normalizedX: piece.position.x, normalizedZ: piece.position.z, prone: piece.pose === "prone" })),
    { physicsRuntime: runtime, pieceMeshes: sceneRuntime.pieceMeshes, boardHalfExtent: pocketHalfExtent },
  );
  preSettlePhysics(runtime);
  const awake = [...runtime.pieces.entries()].filter(([, binding]) => !binding.body.isSleeping()).map(([id]) => id);
  const below = [...runtime.pieces.entries()].filter(([, binding]) => binding.body.translation().y < FALL_OUT_Y).map(([id]) => id);
  assert.deepEqual(awake, [], `${definition.puzzleId}: awake after strict pre-settle ${awake.join(",")}`);
  assert.deepEqual(below, [], `${definition.puzzleId}: below FALL_OUT_Y after strict pre-settle ${below.join(",")}`);
  const turn = (await vite.ssrLoadModule("/src/turn.ts")).createTurnRuntime(runtime, sceneRuntime, { maxLaunchSpeed: MAX_LAUNCH_SPEED }, meta.cellSize);
  const turnModule = await vite.ssrLoadModule("/src/turn.ts");
  turnModule.setTurnGameMode(turn, "puzzle");
  return { sceneRuntime, turn };
}

async function shoot(runtime, definition, angleDeg, power) {
  const { turn } = await prepare(runtime, definition);
  const binding = runtime.pieces.get(shooterId);
  const start = binding.body.translation();
  const com = binding.body.worldCom();
  const tracker = new PuzzlePhysicsTracker(runtime);
  tracker.beginShot(shooterId, turn.physicsStepNumber, []);
  const angle = angleDeg * Math.PI / 180;
  const turnModule = await vite.ssrLoadModule("/src/turn.ts");
  const queued = turnModule.queueTurnLaunch(turn, {
    pieceId: shooterId,
    normalizedPower: power,
    direction: new Vector3(Math.cos(angle), 0, Math.sin(angle)),
    applicationPoint: new Vector3(com.x, com.y, com.z),
    speedMultiplier: 1,
  });
  if (!queued.accepted) throw new Error(queued.reason ?? "queue rejected");
  turn.onPuzzlePhysicsStep = (step) => tracker.sample(step);
  let settled = false;
  turn.onPuzzleSettled = () => { settled = true; };
  for (let step = 0; step < 2400 && !settled; step += 1) {
    turnModule.applyPendingLaunchBeforeStep(turn);
    runtime.world.step();
    turnModule.updateTurnAfterStep(turn, FIXED_STEP);
  }
  const evidence = tracker.evidence;
  const input = { settled, launches: 1, fallenIDs: [], contactEvents: [], protectedContactIDs: [], holeOutIDs: [], wallDestroyedCounts: {}, customHitUsed: false, rookShots: [], usedActions: [], fallOrderEvents: [], wallDestructionOrderEvents: [] };
  appendPuzzlePhysicsEvidence(input, evidence, definition);
  const evaluation = evaluatePuzzleAttempt(definition, input);
  return { angleDeg, power, applicationPointWorld: { x: com.x, y: com.y, z: com.z }, start: { x: start.x, y: start.y, z: start.z }, evidence, evaluation };
}

const runtime = await createBaseRuntime();
preSettlePhysics(runtime);
const candidates = [];
const successes = [];
const failureCounts = new Map();
let strictSettleFailures = 0;
let wallContactCandidates = 0;
let targetOutCandidates = 0;
const originalConsole = { info: console.info, warn: console.warn, error: console.error };
console.info = () => {};
console.warn = () => {};
console.error = () => {};
try {
  const cornerValues = [-0.88, -0.84, -0.8, -0.76, -0.72];
  const southeastValues = [0.8, 0.85, 0.9];
  const southeastDepthValues = [-0.9, -0.85, -0.8, -0.75, -0.7];
  const playerXValues = process.env.OWNER
    ? [-0.4]
    : process.env.SOUTHEAST
    ? (process.env.LOW ? [-0.6] : [-0.65, -0.6, -0.55])
    : process.env.OLD ? [-0.6]
    : process.env.CORNER ? [-0.6, -0.55, -0.5, -0.45] : [-0.8];
  const playerZValues = process.env.OWNER
    ? [0.9]
    : process.env.FULL ? [0.45, 0.55, 0.65] : [0.55];
  const targetXValues = process.env.OWNER
    ? [0.96]
    : process.env.SOUTHEAST
    ? southeastValues
    : process.env.OLD ? [0.96]
    : process.env.CORNER
    ? cornerValues
    : process.env.FULL ? [0.8, 0.85, 0.9] : [0.85];
  const targetZValues = process.env.OWNER
    ? [0.8]
    : process.env.SOUTHEAST
    ? southeastDepthValues
    : process.env.OLD ? [0.3]
    : process.env.CORNER
    ? cornerValues
    : process.env.FULL ? [0.2, 0.3, 0.4] : [0.3];
  const angleValues = process.env.OWNER
    ? [20]
    : process.env.SOUTHEAST
    ? (process.env.LOW
      ? Array.from({ length: 16 }, (_, index) => 40 + index * 1)
      : Array.from({ length: 31 }, (_, index) => 55 + index * 1))
    : process.env.OLD ? [65]
    : process.env.DIAG
    ? Array.from({ length: 7 }, (_, index) => 90 + index * 5)
    : process.env.CORNER
    ? Array.from({ length: 31 }, (_, index) => 90 + index * 1)
    : Array.from({ length: 72 }, (_, index) => index * 5);
  const speedValues = process.env.OWNER
    ? [5]
    : process.env.DIAG
    ? [9, 11, 13, 15, 16.5]
    : process.env.SOUTHEAST
    ? (process.env.LOW ? [3, 4, 5, 6, 7, 8, 9] : [9, 11, 13, 15, 16.5])
    : process.env.OLD ? [11]
    : [3, 4, 5, 6, 7, 8, 9];
  for (const playerX of playerXValues) {
    for (const playerZ of playerZValues) {
      for (const targetX of targetXValues) {
        for (const targetZ of targetZValues) {
        const definition = withPositions({ [shooterId]: { x: playerX, z: playerZ }, [targetId]: { x: targetX, z: targetZ } });
        for (const angleDeg of angleValues) {
          for (const speed of speedValues) {
            try {
              const result = await shoot(runtime, definition, angleDeg, speed / MAX_LAUNCH_SPEED);
              candidates.push({ definition, result });
              if (result.evidence.wallContacts.length > 0) wallContactCandidates += 1;
              if (result.evidence.fallenPieces.some((piece) => piece.pieceId === targetId)) targetOutCandidates += 1;
              for (const reason of result.evaluation.failureReasons ?? []) {
                failureCounts.set(reason.code, (failureCounts.get(reason.code) ?? 0) + 1);
              }
              if (result.evaluation.medal === 3) successes.push({ definition, result });
            } catch (error) {
              if (String(error?.message ?? error).includes("awake after strict pre-settle")) strictSettleFailures += 1;
              candidates.push({ definition, error: error instanceof Error ? error.message : String(error) });
            }
          }
        }
        }
      }
    }
  }
} finally {
  console.info = originalConsole.info;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
}

const output = {
  puzzleId: "P03",
  boardHalfExtent: pocketHalfExtent,
  candidateCount: candidates.length,
  successCount: successes.length,
  geometry: geometrySnapshot,
  diagnostics: {
    strictSettleFailures,
    wallContactCandidates,
    targetOutCandidates,
    failureReasons: Object.fromEntries([...failureCounts.entries()].sort(([, left], [, right]) => right - left)),
    bestAttempts: candidates
      .filter((candidate) => candidate.result !== undefined)
      .map((candidate) => ({
        candidate,
        score:
          candidate.result.evidence.wallContacts.length * 1000 +
          candidate.result.evidence.pieceContacts.length * 100 +
          candidate.result.evidence.fallenPieces.length,
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, 20)
      .map(({ candidate }) => ({
        normalizedPositions: Object.fromEntries(candidate.definition.pieces.map((piece) => [piece.id, piece.position])),
        shot: { angleDeg: candidate.result.angleDeg, normalizedPower: candidate.result.power },
        evaluation: candidate.result.evaluation,
        evidence: candidate.result.evidence,
      })),
  },
  successes: successes.map(({ definition, result }) => ({
    normalizedPositions: Object.fromEntries(definition.pieces.map((piece) => [piece.id, piece.position])),
    shot: { angleDeg: result.angleDeg, normalizedPower: result.power, applicationPointWorld: result.applicationPointWorld },
    evaluation: result.evaluation,
    evidence: result.evidence,
  })),
  failures: candidates.filter((candidate) => candidate.error).slice(0, 20),
  note: "strict applyPuzzleSpawnDefinitions → preSettlePhysics, actual queueTurnLaunch → applyPendingLaunchBeforeStep → world.step → updateTurnAfterStep, COM application point",
};
await writeFile(new URL("./puzzle-pocket-candidate-results.json", import.meta.url), JSON.stringify(output, null, 2), "utf8");
console.log(JSON.stringify(output, null, 2));
if (successes.length === 0) process.exitCode = 1;
await vite.close();
