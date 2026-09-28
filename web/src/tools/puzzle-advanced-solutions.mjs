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
const { FIXED_STEP, MAX_LAUNCH_SPEED } = await vite.ssrLoadModule("/src/config.ts");
const { PUZZLE_CATALOG } = await vite.ssrLoadModule("/src/puzzle.ts");
const { applyPuzzleSpawnDefinitions } = await vite.ssrLoadModule("/src/puzzle-spawn.ts");
const { createPhysicsRuntime, preSettlePhysics } = await vite.ssrLoadModule("/src/physics.ts");
const { PuzzlePhysicsTracker } = await vite.ssrLoadModule("/src/puzzle-physics.ts");
const { appendPuzzlePhysicsEvidence } = await vite.ssrLoadModule("/src/puzzle-evidence.ts");
const { evaluatePuzzleAttempt } = await vite.ssrLoadModule("/src/puzzle.ts");
const { PIECE_INSTANCES } = await vite.ssrLoadModule("/src/layout.ts");

globalThis.localStorage ??= { getItem: () => null, setItem: () => {} };
globalThis.document ??= new Proxy({ documentElement: {}, body: {}, addEventListener: () => {}, removeEventListener: () => {} }, {
  get: (target, key) => target[key] ?? noop,
});
const {
  applyPendingLaunchBeforeStep,
  createTurnRuntime,
  queueTurnLaunch,
  setTurnGameMode,
  updateTurnAfterStep,
} = await vite.ssrLoadModule("/src/turn.ts");

const noop = new Proxy({}, {
  get: (_target, key) => key === "visible" ? true : noop,
  set: () => true,
});
const noopMesh = new Proxy({ geometry: { dispose: () => {} }, material: { dispose: () => {} }, position: { set: () => {} }, quaternion: { set: () => {} }, updateMatrixWorld: () => {} }, {
  get: (target, key) => target[key] ?? noop,
  set: () => true,
});
const meta = JSON.parse(await readFile(
  new URL("../../public/assets/chess-set.meta.json", import.meta.url),
  "utf8",
));
const advancedIds = ["P10", "P12"];
const requestedIds = process.env.PUZZLE_ID ? advancedIds.filter((id) => id === process.env.PUZZLE_ID) : advancedIds;
const POSITION_OVERRIDES = {
  P12: {
    "p12-player-pawn": { x: -0.5, z: -0.4 },
    "p12-player-pawn-b": { x: -0.55, z: 0.65 },
    "p12-protected-king": { x: -0.8, z: 0.7 },
    "p12-target-pawn-a": { x: 0.3, z: 0.3 },
    "p12-target-pawn-b": { x: 0.5, z: 0.5 },
    "p12-target-pawn-c": { x: 0.7, z: 0.7 },
  },
};
const puzzles = new Map(PUZZLE_CATALOG.map((puzzle) => [puzzle.puzzleId, puzzle]));

function instancesFor(puzzle) {
  return puzzle.pieces.map((definition, index) => {
    const source = PIECE_INSTANCES.find((instance) =>
      instance.type === definition.type && instance.side === definition.side,
    );
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
  // createPhysicsRuntime의 기믹 보드 생성 경로를 유지한다. 퍼즐 모드도 실제 보드에는 해당 stage 기믹을 사용한다.
  return { gameMode: "stage", stageNumber: puzzle.boardTemplate === "basic" ? 1 : puzzle.boardStage };
}

function settlePhysics(runtime, maxSteps = 900) {
  let quiet = 0;
  for (let step = 0; step < maxSteps; step += 1) {
    runtime.world.step();
    const moving = [...runtime.pieces.values()].some((binding) => {
      const velocity = binding.body.linvel();
      const angular = binding.body.angvel();
      return Math.hypot(velocity.x, velocity.y, velocity.z, angular.x, angular.y, angular.z) > 0.002;
    });
    quiet = moving ? 0 : quiet + 1;
    if (quiet >= 20) return step + 1;
  }
  return maxSteps;
}

async function makeRuntime(puzzle, positionOverrides = {}) {
  const oldInfo = console.info;
  const oldWarn = console.warn;
  console.info = () => {};
  console.warn = () => {};
  let physicsRuntime;
  try {
    physicsRuntime = await createPhysicsRuntime(
      meta,
      instancesFor(puzzle),
      meta.cellSize * 4,
      stageOptions(puzzle),
    );
  } finally {
    console.info = oldInfo;
    console.warn = oldWarn;
  }
  preSettlePhysics(physicsRuntime);
  physicsRuntime.__defaultY = new Map(
    [...physicsRuntime.pieces].map(([id, binding]) => [id, binding.body.translation().y]),
  );
  const sceneRuntime = new Proxy({ pieceMeshes: new Map(), scene: { remove: () => {} } }, {
    get: (target, key) => {
      if (!(key in target)) target[key] = new Map();
      return target[key];
    },
  });
  for (const id of physicsRuntime.pieces.keys()) sceneRuntime.pieceMeshes.set(id, noopMesh);
  for (const [id, wall] of physicsRuntime.breakableWalls) {
    sceneRuntime.breakableWallMeshes.set(id, { mesh: noopMesh, definition: wall.definition });
  }
  applyPuzzleSpawnDefinitions(
    puzzle.pieces.map((definition) => {
      const override = positionOverrides[definition.id] ?? definition.position;
      return {
        pieceId: definition.id,
        normalizedX: override.x,
        normalizedZ: override.z,
        prone: definition.pose === "prone",
      };
    }),
    { physicsRuntime, pieceMeshes: sceneRuntime.pieceMeshes, boardHalfExtent: physicsRuntime.boardHalfExtent },
  );
  preSettlePhysics(physicsRuntime);
  for (const definition of puzzle.pieces) {
    const binding = physicsRuntime.pieces.get(definition.id);
    binding.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    binding.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
  settlePhysics(physicsRuntime);
  const turnRuntime = createTurnRuntime(
    physicsRuntime,
    sceneRuntime,
    { maxLaunchSpeed: MAX_LAUNCH_SPEED },
    meta.cellSize,
  );
  setTurnGameMode(turnRuntime, "puzzle");
  if (process.env.DEBUG_HOLES && !globalThis.__puzzleAdvancedDebugged) {
    globalThis.__puzzleAdvancedDebugged = true;
    console.log(JSON.stringify({ puzzleId: puzzle.puzzleId, boardHalfExtent: physicsRuntime.boardHalfExtent, boardTop: physicsRuntime.boardTop, holes: physicsRuntime.boardHoleRectangles }));
    if (process.env.DEBUG_ONLY) process.exit(0);
  }
  return { physicsRuntime, turnRuntime };
}

function position(runtime, pieceId) {
  const binding = runtime.pieces.get(pieceId);
  if (!binding) return null;
  const translation = binding.body.translation();
  return { x: translation.x, y: translation.y, z: translation.z };
}

function angleTo(runtime, fromId, toId) {
  const from = position(runtime, fromId);
  const to = position(runtime, toId);
  if (!from || !to) return null;
  return Math.atan2(to.z - from.z, to.x - from.x) * 180 / Math.PI;
}

function runShot(state, puzzle, shot) {
  const physics = state.physicsRuntime;
  const turn = state.turnRuntime;
  const start = position(physics, shot.pieceId);
  const tracker = new PuzzlePhysicsTracker(physics);
  tracker.beginShot(
    shot.pieceId,
    turn.physicsStepNumber,
    puzzle.pieces.filter((piece) => piece.protected).map((piece) => piece.id),
  );
  const radians = shot.angleDeg * Math.PI / 180;
  const direction = new Vector3(Math.cos(radians), 0, Math.sin(radians));
  const centerOfMass = physics.pieces.get(shot.pieceId).body.worldCom();
  const applicationPoint = new Vector3(
    centerOfMass.x + (shot.offsetX ?? 0),
    centerOfMass.y + (shot.offsetY ?? 0),
    centerOfMass.z + (shot.offsetZ ?? 0),
  );
  const queued = queueTurnLaunch(turn, {
    pieceId: shot.pieceId,
    normalizedPower: shot.power,
    direction,
    applicationPoint,
    speedMultiplier: 1,
  });
  if (!queued.accepted) throw new Error(`queue rejected: ${queued.reason}`);
  turn.onPuzzlePhysicsStep = (step) => tracker.sample(step);
  let settled = false;
  turn.onPuzzleSettled = () => { settled = true; };
  for (let step = 0; step < 2400 && !settled; step += 1) {
    applyPendingLaunchBeforeStep(turn);
    physics.world.step();
    updateTurnAfterStep(turn, FIXED_STEP);
  }
  return {
    shot,
    settled,
    evidence: tracker.evidence,
    start,
    applicationPoint,
    end: position(physics, shot.pieceId),
    phase: turn.phase,
    launchInitialSpeed: turn.lastLaunchInitialSpeed,
  };
}

function fallenIds(result) {
  return new Set(result.evidence.fallenPieces.map((piece) => piece.pieceId));
}

function targetsFor(puzzle) {
  return puzzle.pieces.filter((piece) => piece.side === "black" && !piece.protected).map((piece) => piece.id);
}

function scoreState(puzzle, state, results) {
  const fallen = new Set(results.flatMap((result) => result.evidence.fallenPieces.map((piece) => piece.pieceId)));
  const targets = targetsFor(puzzle);
  const targetCount = targets.filter((id) => fallen.has(id)).length;
  const protectedContacts = results.reduce((sum, result) => sum + result.evidence.protectedPieceContacts.length, 0);
  const shooterAlive = !fallen.has(puzzle.pieces[0].id);
  const targetDistance = targets.reduce((sum, id) => {
    const target = position(state.physicsRuntime, id);
    return sum + (target ? Math.hypot(target.x, target.z) : 100);
  }, 0);
  return targetCount * 100000 + (shooterAlive ? 10000 : 0) - protectedContacts * 10000 - targetDistance;
}

function isGold(puzzle, results) {
  const fallen = new Set(results.flatMap((result) => result.evidence.fallenPieces.map((piece) => piece.pieceId)));
  const targets = targetsFor(puzzle);
  const playerId = puzzle.pieces[0].id;
  if (targets.some((id) => !fallen.has(id))) return false;
  if (puzzle.puzzleId !== "P12" && fallen.has(playerId)) return false;
  if (puzzle.puzzleId === "P05") return results.length === 1 && fallen.has(targets[0]) && results[0].evidence.fallenPieces.some((piece) => piece.pieceId === targets[0] && piece.reason === "hole");
  if (puzzle.puzzleId === "P07") return results.length <= 2;
  if (puzzle.puzzleId === "P08") return results.length === 1 && results[0].shot.power <= 0.6 && Math.hypot(results[0].shot.offsetX ?? 0, results[0].shot.offsetZ ?? 0) < 0.04;
  if (puzzle.puzzleId === "P09") return results.length === 1;
  if (puzzle.puzzleId === "P10") return results.length <= 2 && results.every((result) => result.evidence.protectedPieceContacts.length === 0) && results.some((result) => Math.hypot(result.shot.offsetX ?? 0, result.shot.offsetZ ?? 0) > 0.04);
  if (puzzle.puzzleId === "P12") return results.length <= 2 && !fallen.has("p12-protected-king");
  return false;
}

function candidateShots(puzzle, state, limit = 160) {
  const shooters = puzzle.pieces.filter((piece) => piece.side === "white" && !piece.protected).map((piece) => piece.id);
  const targets = targetsFor(puzzle);
  const angleSet = new Set();
  const deltas = [0, -5, 5, -10, 10, -15, 15, -20, 20, -25, 25, -30, 30, -35, 35, -40, 40, -45, 45, -50, 50, -55, 55];
  for (const shooterId of shooters) {
    for (const targetId of targets) {
      const base = angleTo(state.physicsRuntime, shooterId, targetId);
      if (base === null) continue;
      for (const delta of deltas) angleSet.add({ shooterId, angleDeg: Math.round(base + delta) });
    }
  }
  const powers = [0.25, 0.35, 0.45, 0.55, 0.6, 0.7, 0.8, 0.9];
  const offsets = puzzle.puzzleId === "P10" ? [-0.06, -0.05, 0.05, 0.06] : [0];
  const shots = [];
  for (const candidate of angleSet) {
    for (const power of powers) {
      for (const offsetX of offsets) {
        for (const offsetZ of offsets) {
          shots.push({ pieceId: candidate.shooterId, angleDeg: candidate.angleDeg, power, offsetX, offsetZ });
          if (shots.length >= limit) return shots;
        }
      }
    }
  }
  return shots;
}

async function solvePuzzle(puzzle) {
  let best = null;
  const firstCandidates = [];
  const positionOverrides = POSITION_OVERRIDES[puzzle.puzzleId] ?? {};
  const baseState = await makeRuntime(puzzle, positionOverrides);
  const firstLimit = process.env.FAST ? (puzzle.puzzleId === "P10" ? 64 : 24) : (puzzle.puzzleId === "P10" ? 180 : 140);
  for (const shot of candidateShots(puzzle, baseState, firstLimit)) {
    const state = await makeRuntime(puzzle, positionOverrides);
    const result = runShot(state, puzzle, shot);
    const score = scoreState(puzzle, state, [result]);
    firstCandidates.push({ score, state, results: [result] });
    if (isGold(puzzle, [result])) return makeSolution(puzzle, state, [result], "gold");
  }
  firstCandidates.sort((left, right) => right.score - left.score);
  for (const candidate of firstCandidates.slice(0, process.env.FAST ? 4 : 24)) {
    const { state, results } = candidate;
    if (state.turnRuntime.phase !== "ready") continue;
    if (!best || candidate.score > best.score) best = { score: candidate.score, state, results };
    const shooters = puzzle.pieces.filter((piece) => piece.side === "white" && !piece.protected).map((piece) => piece.id);
    const targetIds = targetsFor(puzzle).filter((id) => !fallenIds(results[0]).has(id));
    const secondCandidates = [];
    for (const shooterId of shooters) {
      if (!position(state.physicsRuntime, shooterId)) continue;
      for (const targetId of targetIds) {
        const base = angleTo(state.physicsRuntime, shooterId, targetId);
        if (base === null) continue;
        for (let delta = -35; delta <= 35; delta += 5) {
          for (const power of [0.28, 0.4, 0.52, 0.6, 0.72, 0.84]) {
            secondCandidates.push({ pieceId: shooterId, angleDeg: base + delta, power, offsetX: puzzle.puzzleId === "P10" ? 0.05 : 0, offsetZ: puzzle.puzzleId === "P10" ? 0.05 : 0 });
          }
        }
      }
    }
    for (const shot of secondCandidates) {
      // 한 상태에서 두 번째 후보를 연속 실행하면 첫 후보가 몸체를 제거하므로 매번 첫 발부터 재생한다.
      const trialState = await makeRuntime(puzzle, positionOverrides);
      const firstAgain = runShot(trialState, puzzle, results[0].shot);
      if (trialState.turnRuntime.phase !== "ready" || !position(trialState.physicsRuntime, shot.pieceId)) continue;
      const result = runShot(trialState, puzzle, shot);
      const trialResults = [firstAgain, result];
      const score = scoreState(puzzle, trialState, trialResults);
      if (!best || score > best.score) best = { score, state: trialState, results: trialResults };
      if (isGold(puzzle, trialResults)) return makeSolution(puzzle, trialState, trialResults, "gold");
    }
  }
  if (!best) return { puzzleId: puzzle.puzzleId, solved: false, reason: "no settled candidate" };
  return makeSolution(puzzle, best.state, best.results, "best-effort");
}

function makeSolution(puzzle, state, results, verdict) {
  return {
    puzzleId: puzzle.puzzleId,
    verdict,
    solved: verdict === "gold",
    normalizedPositions: Object.fromEntries(puzzle.pieces.map((piece) => [piece.id, POSITION_OVERRIDES[puzzle.puzzleId]?.[piece.id] ?? piece.position])),
    shots: results.map((result) => ({
      ...result.shot,
      applicationPointWorld: result.applicationPoint,
      launchInitialSpeed: result.launchInitialSpeed,
      settled: result.settled,
      evidence: result.evidence,
    })),
  };
}

const output = { launchNote: "실제 queueTurnLaunch → applyPendingLaunchBeforeStep → world.step → updateTurnAfterStep 경로. 물리 상수·카탈로그 규칙 고정.", solutions: {} };
for (const id of requestedIds) {
  const oldInfo = console.info;
  const oldWarn = console.warn;
  const oldError = console.error;
  console.info = () => {};
  console.warn = () => {};
  console.error = () => {};
  try {
    output.solutions[id] = await solvePuzzle(puzzles.get(id));
  } finally {
    console.info = oldInfo;
    console.warn = oldWarn;
    console.error = oldError;
  }
}
for (const [id, solution] of Object.entries(output.solutions)) {
  if (!solution || !solution.shots) continue;
  const puzzle = puzzles.get(id);
  const input = { settled: true, launches: 0, fallenIDs: [], contactEvents: [], protectedContactIDs: [], holeOutIDs: [], wallDestroyedCounts: {}, customHitUsed: false, rookShots: [], usedActions: [], fallOrderEvents: [], wallDestructionOrderEvents: [] };
  for (const shot of solution.shots) {
    input.launches += 1;
    appendPuzzlePhysicsEvidence(input, shot.evidence, puzzle);
    if (id === "P10" && Math.hypot(shot.offsetX ?? 0, shot.offsetZ ?? 0) > 0.04) input.customHitUsed = true;
  }
  const evaluation = evaluatePuzzleAttempt(puzzle, input);
  solution.evaluation = { medal: evaluation.medal, status: evaluation.status, failureReasons: evaluation.failureReasons };
  if (id === "P10") assert.equal(evaluation.medal, 3, JSON.stringify({ id, solution, evaluation }));
}
await writeFile(new URL("./puzzle-advanced-solutions-results.json", import.meta.url), JSON.stringify(output, null, 2), "utf8");
await writeFile(new URL("./puzzle-advanced-repro.json", import.meta.url), JSON.stringify(output, null, 2), "utf8");
console.log(JSON.stringify(output, null, 2));
await vite.close();
