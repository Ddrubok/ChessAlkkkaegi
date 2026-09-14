import { readFile, writeFile } from "node:fs/promises";
import { Vector3 } from "three";
import { FIXED_STEP, MAX_LAUNCH_SPEED } from "../config.ts";
import { PUZZLE_CATALOG, evaluatePuzzleAttempt } from "../puzzle.ts";
import { applyPuzzleSpawnDefinitions } from "../puzzle-spawn.ts";
import { appendPuzzlePhysicsEvidence } from "../puzzle-evidence.ts";
import {
  createPhysicsRuntime,
  preSettlePhysics,
  resetPhysicsPieces,
  resetPhysicsPinballObstacles,
} from "../physics.ts";
import { PuzzlePhysicsTracker } from "../puzzle-physics.ts";
import { PIECE_INSTANCES } from "../layout.ts";

const uiNoop = new Proxy(() => {}, {
  get: (target, key) => key === "visible" ? true : target[key] ?? uiNoop,
  set: () => true,
});
globalThis.localStorage ??= { getItem: () => null, setItem: () => {} };
globalThis.document ??= new Proxy({ documentElement: {}, body: {} }, {
  get: (target, key) => target[key] ?? uiNoop,
});
globalThis.window ??= globalThis;
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
const basePuzzle = PUZZLE_CATALOG.find((puzzle) => puzzle.puzzleId === "P12");
if (!basePuzzle) throw new Error("P12 catalog entry is missing");
const pieceId = {
  pawnA: "p12-player-pawn",
  pawnB: "p12-player-pawn-b",
  king: "p12-protected-king",
  targetA: "p12-target-pawn-a",
  targetB: "p12-target-pawn-b",
  targetC: "p12-target-pawn-c",
};

const speeds = process.env.SPEED
  ? process.env.SPEED.split(",").map(Number)
  : [6, 7, 8, 9, 10, 11];
const angles = process.env.ANGLE_DEG
  ? process.env.ANGLE_DEG.split(",").map(Number)
  : [0, 1, 2, 3, 4, 5, 6];
const maxSteps = Number(process.env.MAX_STEPS ?? 1800);
const layouts = [{ name: "catalog" }];
const firstOnly = process.env.FIRST_ONLY === "1";

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

async function makeState(puzzle) {
  const physicsRuntime = await createPhysicsRuntime(
    meta,
    makeInstances(puzzle),
    meta.cellSize * 4,
    { gameMode: "stage", stageNumber: puzzle.boardStage },
  );
  resetPhysicsPieces(
    physicsRuntime,
    meta,
    makeInstances(puzzle),
    { gameMode: "puzzle", stageNumber: 1 },
  );
  resetPhysicsPinballObstacles(
    physicsRuntime,
    meta,
    { gameMode: "stage", stageNumber: puzzle.boardStage },
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

async function runShot(state, puzzle, shooterId, speed, angleDeg, input) {
  const physics = state.physicsRuntime;
  const turn = state.turnRuntime;
  resetTurnRuntime(turn);
  setTurnGameMode(turn, "puzzle");
  const binding = physics.pieces.get(shooterId);
  if (!binding) {
    if (process.env.DEBUG) console.error(`missing shooter ${shooterId}`);
    return null;
  }
  const tracker = new PuzzlePhysicsTracker(physics);
  tracker.beginShot(shooterId, turn.physicsStepNumber, puzzle.pieces.filter((piece) => piece.protected).map((piece) => piece.id));
  const bodyStart = binding.body.translation();
  const worldCom = binding.body.worldCom();
  const angle = angleDeg * Math.PI / 180;
  const normalizedPower = speed / MAX_LAUNCH_SPEED;
  if (!Number.isFinite(normalizedPower) || normalizedPower < 0 || normalizedPower > 1) {
    throw new Error(`illegal normalizedPower=${normalizedPower} for speed=${speed}`);
  }
  const queued = queueTurnLaunch(turn, {
    pieceId: shooterId,
    normalizedPower,
    direction: new Vector3(Math.cos(angle), 0, Math.sin(angle)),
    applicationPoint: new Vector3(worldCom.x, worldCom.y, worldCom.z),
    speedMultiplier: 1,
  });
  if (!queued.accepted) {
    if (process.env.DEBUG) console.error(`queue rejected ${shooterId}: ${queued.reason}`);
    return null;
  }
  turn.onPuzzlePhysicsStep = (step) => tracker.sample(step);
  let settled = false;
  turn.onPuzzleSettled = () => { settled = true; };
  for (let step = 0; step < maxSteps && !settled; step += 1) {
    applyPendingLaunchBeforeStep(turn);
    physics.world.step();
    updateTurnAfterStep(turn, FIXED_STEP);
  }
  if (!settled) {
    if (process.env.DEBUG) console.error(`not settled ${shooterId} speed=${speed} angle=${angleDeg}`);
    return {
      ...tracker.evidence,
      settled: false,
      bodyTranslationWorld: { x: bodyStart.x, y: bodyStart.y, z: bodyStart.z },
      applicationPointWorld: { x: worldCom.x, y: worldCom.y, z: worldCom.z },
    };
  }
  input.launches += 1;
  const evidence = {
    ...tracker.evidence,
    settled: true,
    bodyTranslationWorld: { x: bodyStart.x, y: bodyStart.y, z: bodyStart.z },
    applicationPointWorld: { x: worldCom.x, y: worldCom.y, z: worldCom.z },
  };
  appendPuzzlePhysicsEvidence(input, evidence, puzzle);
  return evidence;
}

function evaluateGold(puzzle, input) {
  return evaluatePuzzleAttempt(puzzle, input);
}

const results = [];
for (const layout of layouts) {
  const puzzle = basePuzzle;
  const solutions = [];
  const firstCandidates = [];
  const originalInfo = console.info;
  console.info = () => {};
  for (const speed1 of speeds) {
    for (const angle1 of angles) {
      const state = await makeState(puzzle);
      const input = {
        launches: 0,
        settled: true,
        fallenIDs: [],
        contactEvents: [],
        protectedContactIDs: [],
        holeOutIDs: [],
        wallDestroyedCounts: {},
        customHitUsed: false,
        rookShots: [],
      };
      const first = await runShot(state, puzzle, pieceId.pawnA, speed1, angle1, input);
      if (!first) continue;
      if (!first.settled) {
        if (firstOnly) firstCandidates.push({ speed: speed1, angleDeg: angle1, settled: false, fallen: first.fallenPieces });
        continue;
      }
      const firstFallen = new Set(first.fallenPieces.map((piece) => piece.pieceId));
      const targetIds = [pieceId.targetA, pieceId.targetB, pieceId.targetC];
      const firstTargetFalls = targetIds.filter((id) => firstFallen.has(id));
      if (firstOnly && process.env.DEBUG) {
        console.error(JSON.stringify({ speed: speed1, angleDeg: angle1, falls: firstTargetFalls, contacts: first.pieceContacts }));
      }
      if (firstTargetFalls.length > 0) {
        firstCandidates.push({ speed: speed1, angleDeg: angle1, targetFalls: firstTargetFalls });
      }
      if (firstOnly) continue;
      if (firstTargetFalls.length !== 2 || firstFallen.has(pieceId.pawnB)) continue;
      const remainingTarget = targetIds.find((id) => !firstFallen.has(id));
      if (!remainingTarget) continue;
      const secondPawn = pieceId.pawnB;
      const pawnBinding = state.physicsRuntime.pieces.get(secondPawn);
      const targetBinding = state.physicsRuntime.pieces.get(remainingTarget);
      if (!pawnBinding || !targetBinding) continue;
      const pawnPosition = pawnBinding.body.translation();
      const targetPosition = targetBinding.body.translation();
      const directAngle = Math.atan2(
        targetPosition.z - pawnPosition.z,
        targetPosition.x - pawnPosition.x,
      ) * 180 / Math.PI;
      for (const speed2 of speeds) {
        const second = await runShot(state, puzzle, secondPawn, speed2, directAngle, input);
        if (!second) {
          if (process.env.DEBUG) console.error(`second shot unavailable speed=${speed2} angle=${directAngle}`);
          continue;
        }
        const evaluation = evaluateGold(puzzle, input);
        if (process.env.DEBUG) console.error(JSON.stringify({ speed1, angle1, speed2, directAngle, fallen: input.fallenIDs, medal: evaluation.medal }));
        if (evaluation.medal !== 3) continue;
        solutions.push({
          layout: layout.name,
          first: {
            shooterId: pieceId.pawnA,
            speed: speed1,
            normalizedPower: speed1 / MAX_LAUNCH_SPEED,
            angleDeg: angle1,
            applicationPointWorld: first.applicationPointWorld,
            pointOffset: {
              x: first.applicationPointWorld.x - first.bodyTranslationWorld.x,
              y: first.applicationPointWorld.y - first.bodyTranslationWorld.y,
              z: first.applicationPointWorld.z - first.bodyTranslationWorld.z,
            },
            fallen: first.fallenPieces,
            pieceContacts: first.pieceContacts,
          },
          second: {
            shooterId: secondPawn,
            speed: speed2,
            normalizedPower: speed2 / MAX_LAUNCH_SPEED,
            angleDeg: directAngle,
            applicationPointWorld: second.applicationPointWorld,
            pointOffset: {
              x: second.applicationPointWorld.x - second.bodyTranslationWorld.x,
              y: second.applicationPointWorld.y - second.bodyTranslationWorld.y,
              z: second.applicationPointWorld.z - second.bodyTranslationWorld.z,
            },
            fallen: second.fallenPieces,
            pieceContacts: second.pieceContacts,
          },
          evaluation,
        });
        break;
      }
    }
  }
  console.info = originalInfo;
  const result = {
    layout: layout.name,
    solutionCount: firstOnly ? firstCandidates.length : solutions.length,
    firstCandidates: firstOnly ? firstCandidates.slice(0, 20) : undefined,
    solutions: solutions.slice(0, Number(process.env.LIMIT ?? 3)),
  };
  results.push(result);
  console.log(JSON.stringify(result));
}
await writeFile(
  new URL("./puzzle-final-chain-probe-results.json", import.meta.url),
  JSON.stringify(results, null, 2),
  "utf8",
);
if (!firstOnly && results.every((result) => result.solutionCount < 1)) {
  throw new Error("P12 Gold 2-shot 해법을 찾지 못했습니다.");
}
