import { readFile, writeFile } from "node:fs/promises";
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
const { FIXED_STEP, MAX_LAUNCH_SPEED } = await vite.ssrLoadModule("/src/config.ts");
const { PUZZLE_CATALOG, evaluatePuzzleAttempt } = await vite.ssrLoadModule("/src/puzzle.ts");
const { applyPuzzleSpawnDefinitions } = await vite.ssrLoadModule("/src/puzzle-spawn.ts");
const { appendPuzzlePhysicsEvidence } = await vite.ssrLoadModule("/src/puzzle-evidence.ts");
const { createPhysicsRuntime, preSettlePhysics } = await vite.ssrLoadModule("/src/physics.ts");
const { PuzzlePhysicsTracker } = await vite.ssrLoadModule("/src/puzzle-physics.ts");
const { PIECE_INSTANCES } = await vite.ssrLoadModule("/src/layout.ts");
const { computeStageBoardHalfExtent } = await vite.ssrLoadModule("/src/stage.ts");

const uiNoop = new Proxy(() => {}, {
  get: (target, key) => key === "visible" ? true : target[key] ?? uiNoop,
  set: () => true,
});
globalThis.localStorage ??= { getItem: () => null, setItem: () => {} };
globalThis.document ??= new Proxy({ documentElement: {}, body: {}, addEventListener: () => {}, removeEventListener: () => {} }, {
  get: (target, key) => target[key] ?? uiNoop,
});
globalThis.window ??= globalThis;
globalThis.addEventListener ??= () => {};
globalThis.removeEventListener ??= () => {};
const {
  applyPendingLaunchBeforeStep,
  createTurnRuntime,
  queueTurnLaunch,
  resetTurnRuntime,
  setTurnGameMode,
  updateTurnAfterStep,
} = await vite.ssrLoadModule("/src/turn.ts");

const meta = JSON.parse(await readFile(
  new URL("../../public/assets/chess-set.meta.json", import.meta.url),
  "utf8",
));
const puzzleIds = process.env.PUZZLE_ID?.split(",") ?? ["P07", "P08"];
const speedValues = process.env.SPEED
  ? process.env.SPEED.split(",").map(Number)
  : [2, 3, 4, 5, 6, 7, 8, 9, 10];
const angleValues = process.env.ANGLE_DEG
  ? process.env.ANGLE_DEG.split(",").map(Number)
  : Array.from({ length: 41 }, (_, index) => 20 + index);
const maxSteps = Number(process.env.MAX_STEPS ?? 1800);

function makeInstances(puzzle) {
  return puzzle.pieces.map((definition, index) => {
    const source = PIECE_INSTANCES.find(
      (instance) => instance.type === definition.type && instance.side === definition.side,
    );
    if (!source) throw new Error(`missing template ${definition.type}/${definition.side}`);
    return {
      ...source,
      id: definition.id,
      startingSquare: {
        file: String.fromCharCode(97 + index),
        rank: definition.side === "white" ? 1 : 8,
      },
    };
  });
}

function stageOptions(puzzle) {
  return { gameMode: "puzzle", stageNumber: puzzle.boardStage };
}

async function makeState(puzzle) {
  const boardOptions = stageOptions(puzzle);
  const physicsRuntime = await createPhysicsRuntime(
    meta,
    makeInstances(puzzle),
    computeStageBoardHalfExtent(
      meta.cellSize,
      boardOptions.gameMode,
      boardOptions.stageNumber,
    ),
    boardOptions,
  );
  physicsRuntime.__defaultY = new Map(
    [...physicsRuntime.pieces].map(([id, binding]) => [id, binding.body.translation().y]),
  );
  const sceneRuntime = new Proxy({
    pieceMeshes: new Map(),
    breakableWallMeshes: new Map(),
    scene: { remove: () => {} },
  }, {
    get: (target, key) => {
      if (!(key in target)) target[key] = new Map();
      return target[key];
    },
  });
  for (const id of physicsRuntime.pieces.keys()) sceneRuntime.pieceMeshes.set(id, uiNoop);
  for (const id of physicsRuntime.breakableWalls.keys()) sceneRuntime.breakableWallMeshes.set(id, uiNoop);
  applyPuzzleSpawnDefinitions(puzzle.pieces.map((piece) => ({
    pieceId: piece.id,
    normalizedX: piece.position.x,
    normalizedZ: piece.position.z,
    prone: piece.pose === "prone",
  })), {
    physicsRuntime,
    pieceMeshes: sceneRuntime.pieceMeshes,
    boardHalfExtent: physicsRuntime.boardHalfExtent,
  });
  preSettlePhysics(physicsRuntime);
  const turnRuntime = createTurnRuntime(
    physicsRuntime,
    sceneRuntime,
    { maxLaunchSpeed: MAX_LAUNCH_SPEED },
    meta.cellSize,
  );
  setTurnGameMode(turnRuntime, "puzzle");
  return { physicsRuntime, turnRuntime };
}

async function runShot(puzzle, speed, angleDeg) {
  const state = await makeState(puzzle);
  const physics = state.physicsRuntime;
  const turn = state.turnRuntime;
  resetTurnRuntime(turn);
  setTurnGameMode(turn, "puzzle");
  const shooter = puzzle.pieces[0];
  const binding = physics.pieces.get(shooter.id);
  if (!binding) throw new Error(`missing shooter ${shooter.id}`);
  const protectedIds = puzzle.pieces.filter((piece) => piece.protected).map((piece) => piece.id);
  const tracker = new PuzzlePhysicsTracker(physics);
  tracker.beginShot(shooter.id, turn.physicsStepNumber, protectedIds);
  const bodyStart = binding.body.translation();
  const worldCom = binding.body.worldCom();
  const angle = angleDeg * Math.PI / 180;
  const queued = queueTurnLaunch(turn, {
    pieceId: shooter.id,
    normalizedPower: speed / MAX_LAUNCH_SPEED,
    direction: new Vector3(Math.cos(angle), 0, Math.sin(angle)),
    applicationPoint: new Vector3(worldCom.x, worldCom.y, worldCom.z),
    speedMultiplier: 1,
  });
  if (!queued.accepted) throw new Error(`queue rejected: ${queued.reason}`);
  turn.onPuzzlePhysicsStep = (step) => tracker.sample(step);
  let settled = false;
  turn.onPuzzleSettled = () => { settled = true; };
  for (let step = 0; step < maxSteps && !settled; step += 1) {
    applyPendingLaunchBeforeStep(turn);
    physics.world.step();
    updateTurnAfterStep(turn, FIXED_STEP);
  }
  return {
    ...tracker.evidence,
    settled,
    launchPower: speed / MAX_LAUNCH_SPEED,
    bodyTranslationWorld: { x: bodyStart.x, y: bodyStart.y, z: bodyStart.z },
    applicationPointWorld: { x: worldCom.x, y: worldCom.y, z: worldCom.z },
  };
}

function evaluate(puzzle, evidence) {
  const input = {
    launches: 1,
    settled: evidence.settled,
    fallenIDs: [],
    contactEvents: [],
    protectedContactIDs: [],
    holeOutIDs: [],
    wallDestroyedCounts: {},
    customHitUsed: false,
    rookShots: puzzle.pieces[0].type === "Rook"
      ? [{ pieceId: puzzle.pieces[0].id, centerHit: true, power: evidence.launchPower ?? 0 }]
      : [],
  };
  appendPuzzlePhysicsEvidence(input, evidence, puzzle);
  return evaluatePuzzleAttempt(puzzle, input);
}

const results = [];
for (const puzzleId of puzzleIds) {
  const puzzle = PUZZLE_CATALOG.find((entry) => entry.puzzleId === puzzleId);
  if (!puzzle) throw new Error(`unknown puzzle ${puzzleId}`);
  const solutions = [];
  const originalInfo = console.info;
  console.info = () => {};
  for (const angleDeg of angleValues) {
    for (const speed of speedValues) {
      const evidence = await runShot(puzzle, speed, angleDeg);
      const evaluation = evaluate(puzzle, evidence);
      if (evaluation.medal === 3) {
        const fallenIds = evidence.fallenPieces.map((piece) => piece.pieceId);
        solutions.push({
          speed,
          normalizedPower: speed / MAX_LAUNCH_SPEED,
          angleDeg,
          direction: {
            x: Number(Math.cos(angleDeg * Math.PI / 180).toFixed(8)),
            y: 0,
            z: Number(Math.sin(angleDeg * Math.PI / 180).toFixed(8)),
          },
          pointOffset: {
            x: evidence.applicationPointWorld.x - evidence.bodyTranslationWorld.x,
            y: evidence.applicationPointWorld.y - evidence.bodyTranslationWorld.y,
            z: evidence.applicationPointWorld.z - evidence.bodyTranslationWorld.z,
          },
          bodyTranslationWorld: evidence.bodyTranslationWorld,
          applicationPointWorld: evidence.applicationPointWorld,
          shooterAlive: !fallenIds.includes(puzzle.pieces[0].id),
          launches: 1,
          settled: evidence.settled,
          evaluation,
          fallen: evidence.fallenPieces,
          pieceContacts: evidence.pieceContacts,
          protectedPieceContacts: evidence.protectedPieceContacts,
        });
      }
    }
  }
  console.info = originalInfo;
  solutions.sort((left, right) => left.speed - right.speed || left.angleDeg - right.angleDeg);
  const result = {
    puzzleId,
    solutionCount: solutions.length,
    solutions: solutions.slice(0, Number(process.env.LIMIT ?? 5)),
  };
  results.push(result);
  console.log(JSON.stringify(result));
}
await writeFile(
  new URL("./puzzle-prone-rook-solutions-results.json", import.meta.url),
  JSON.stringify(results, null, 2),
  "utf8",
);
if (results.some((result) => result.solutionCount < 1)) {
  throw new Error("P07/P08 중 Gold 해법이 없는 문제가 있습니다.");
}
await vite.close();
