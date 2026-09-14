import { readFile, writeFile } from "node:fs/promises";
import { Vector3 } from "three";
import { FIXED_STEP, MAX_LAUNCH_SPEED } from "../config.ts";
import { PUZZLE_CATALOG, evaluatePuzzleAttempt } from "../puzzle.ts";
import { applyPuzzleSpawnDefinitions } from "../puzzle-spawn.ts";
import {
  createPhysicsRuntime,
  preSettlePhysics,
} from "../physics.ts";
import { PuzzlePhysicsTracker } from "../puzzle-physics.ts";
import { appendPuzzlePhysicsEvidence } from "../puzzle-evidence.ts";
import { PIECE_INSTANCES } from "../layout.ts";
import { computeStageBoardHalfExtent } from "../stage.ts";

const uiNoop = new Proxy(() => {}, {
  get: (_target, key) => key === "visible" ? true : uiNoop,
  set: () => true,
});
globalThis.localStorage ??= { getItem: () => null, setItem: () => {} };
globalThis.document ??= new Proxy({ documentElement: {}, body: {} }, {
  get: (target, key) => target[key] ?? uiNoop,
});
const {
  applyPendingLaunchBeforeStep,
  createTurnRuntime,
  queueTurnLaunch,
  resetTurnRuntime,
  setTurnGameMode,
  updateTurnAfterStep,
} = await import("../turn.ts");

const meta = JSON.parse(await readFile(
  new URL("../../public/assets/chess-set.meta.json", import.meta.url),
  "utf8",
));

const stageOptionsFor = (puzzle) => puzzle.boardTemplate === "basic"
  ? { gameMode: "puzzle", stageNumber: puzzle.boardStage }
  : { gameMode: "stage", stageNumber: puzzle.boardStage };

function makeInstances(puzzle) {
  return puzzle.pieces.map((definition, index) => {
    const template = PIECE_INSTANCES.find(
      (instance) => instance.type === definition.type && instance.side === definition.side,
    );
    if (!template) throw new Error(`no template for ${definition.type}/${definition.side}`);
    return {
      ...template,
      id: definition.id,
      startingSquare: {
        file: String.fromCharCode(97 + index),
        rank: definition.side === "white" ? 1 : 8,
      },
    };
  });
}

async function makeRuntime(puzzle) {
  const boardOptions = stageOptionsFor(puzzle);
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
  const sceneRuntime = new Proxy({ pieceMeshes: new Map(), breakableWallMeshes: new Map(), scene: { remove: () => {} } }, {
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

function resetTrial(runtime, puzzle) {
  const turn = runtime.turnRuntime;
  resetTurnRuntime(turn);
  setTurnGameMode(turn, "puzzle");
}

function simulate(runtime, puzzle, speed, angle) {
  resetTrial(runtime, puzzle);
  const shooter = puzzle.pieces[0];
  const physics = runtime.physicsRuntime;
  const turn = runtime.turnRuntime;
  const binding = physics.pieces.get(shooter.id);
  if (!binding) throw new Error(`missing shooter ${shooter.id}`);
  const tracker = new PuzzlePhysicsTracker(physics);
  const protectedIds = puzzle.pieces.filter((piece) => piece.protected).map((piece) => piece.id);
  tracker.beginShot(shooter.id, turn.physicsStepNumber, protectedIds);
  const start = binding.body.translation();
  const worldCom = binding.body.worldCom();
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
  for (let step = 0; step < Number(process.env.MAX_STEPS ?? 1800) && !settled; step += 1) {
    applyPendingLaunchBeforeStep(turn);
    physics.world.step();
    updateTurnAfterStep(turn, FIXED_STEP);
  }
  return {
    ...tracker.evidence,
    settled,
    bodyTranslationWorld: { x: start.x, y: start.y, z: start.z },
    applicationPointWorld: { x: worldCom.x, y: worldCom.y, z: worldCom.z },
  };
}

function isGold(puzzle, evidence) {
  const fallen = new Set(evidence.fallenPieces.map((piece) => piece.pieceId));
  const required = puzzle.medals.gold;
  if (!evidence.settled || required.maxLaunches < 1 || required.requiredFallIds.some((id) => !fallen.has(id))) return false;
  if (required.requiredAliveIds?.some((id) => fallen.has(id))) return false;
  if (required.forbiddenContactIds?.some((id) =>
    evidence.protectedPieceContacts.some((contact) => contact.protectedPieceId === id),
  )) return false;
  return true;
}

function evaluateGold(puzzle, evidence) {
  const direct = isGold(puzzle, evidence);
  const input = {
    launches: 1,
    settled: true,
    fallenIDs: [],
    contactEvents: [],
    protectedContactIDs: [],
    holeOutIDs: [],
    wallDestroyedCounts: {},
    customHitUsed: false,
    rookShots: [],
  };
  appendPuzzlePhysicsEvidence(input, evidence, puzzle);
  const evaluation = evaluatePuzzleAttempt(puzzle, input);
  if (direct !== (evaluation.medal === 3)) {
    throw new Error(
      `${puzzle.puzzleId} Gold 판정 불일치: direct=${direct}, medal=${evaluation.medal}`,
    );
  }
  return evaluation;
}

function withPositionOverrides(puzzle) {
  const raw = process.env.POSITION_OVERRIDES;
  if (!raw) return puzzle;
  const overrides = new Map(raw.split(";").map((entry) => {
    const [id, x, z] = entry.split(",");
    return [id, { x: Number(x), z: Number(z), positionValidated: false }];
  }));
  return {
    ...puzzle,
    pieces: puzzle.pieces.map((piece) => ({
      ...piece,
      position: overrides.get(piece.id) ?? piece.position,
    })),
  };
}

function outputEvidence(evidence) {
  return {
    launches: 1,
    settled: evidence.settled,
    fallen: evidence.fallenPieces,
    pieceContacts: evidence.pieceContacts,
    protectedPieceContacts: evidence.protectedPieceContacts,
    wallContacts: evidence.wallContacts,
    destroyedWalls: evidence.destroyedWalls,
  };
}

const ids = process.env.PUZZLE_ID?.split(",") ?? ["P01", "P02", "P04", "P06"];
const speedValues = process.env.SPEED
  ? process.env.SPEED.split(",").map(Number)
  : [3, 4, 4.5, 5, 6, 7, 8, 10];
const angleValues = process.env.ANGLE_DEG
  ? process.env.ANGLE_DEG.split(",").map(Number)
  : [30, 32, 34, 35, 36, 37, 38, 40];

const results = [];
for (const puzzleId of ids) {
  const catalogPuzzle = PUZZLE_CATALOG.find((entry) => entry.puzzleId === puzzleId);
  if (!catalogPuzzle) throw new Error(`unknown puzzle ${puzzleId}`);
  const puzzle = withPositionOverrides(catalogPuzzle);
  const shooter = puzzle.pieces[0];
  const solutions = [];
  let boardHalfExtent = null;
  const originalInfo = console.info;
  console.info = () => {};
  for (const angleDeg of angleValues) {
    for (const speed of speedValues) {
      const runtime = await makeRuntime(puzzle);
      boardHalfExtent ??= runtime.physicsRuntime.boardHalfExtent;
      const evidence = simulate(runtime, puzzle, speed, angleDeg * Math.PI / 180);
      const evaluation = evaluateGold(puzzle, evidence);
      if (evaluation.medal === 3) {
        const fallenIds = evidence.fallenPieces.map((piece) => piece.pieceId);
        const shooterAlive = !fallenIds.includes(shooter.id);
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
          shooterAlive,
          evaluation,
          ...outputEvidence(evidence),
        });
      }
    }
  }
  console.info = originalInfo;
  solutions.sort((a, b) => Number(b.shooterAlive) - Number(a.shooterAlive) || a.speed - b.speed);
  const result = {
    puzzleId,
    boardHalfExtent,
    solutionCount: solutions.length,
    solutions: solutions.slice(0, Number(process.env.LIMIT ?? 5)),
  };
  results.push(result);
  console.log(JSON.stringify(result));
}

await writeFile(
  new URL("./puzzle-basic-solutions-results.json", import.meta.url),
  JSON.stringify(results, null, 2),
  "utf8",
);
if (results.some((result) => result.solutionCount < 1)) {
  throw new Error("네 기본 퍼즐 중 Gold 해법이 없는 퍼즐이 있습니다.");
}
