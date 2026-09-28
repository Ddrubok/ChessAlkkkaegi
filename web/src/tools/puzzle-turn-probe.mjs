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
const { PUZZLE_CATALOG, evaluatePuzzleAttempt } = await vite.ssrLoadModule("/src/puzzle.ts");
const { computePuzzleSpawnPose } = await vite.ssrLoadModule("/src/puzzle-spawn.ts");
const {
  createPhysicsRuntime,
  preSettlePhysics,
  scanBreakableWallContacts,
  applyPendingBreakableWallDestructions,
} = await vite.ssrLoadModule("/src/physics.ts");
const { PuzzlePhysicsTracker } = await vite.ssrLoadModule("/src/puzzle-physics.ts");
const { appendPuzzlePhysicsEvidence } = await vite.ssrLoadModule("/src/puzzle-evidence.ts");
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

const meta = JSON.parse(await readFile(
  new URL("../../public/assets/chess-set.meta.json", import.meta.url),
  "utf8",
));
const puzzleById = new Map(PUZZLE_CATALOG.map((puzzle) => [puzzle.puzzleId, puzzle]));
const noop = new Proxy({}, {
  get: (_target, key) => key === "visible" ? true : noop,
  set: () => true,
});
const noopMesh = new Proxy({ geometry: { dispose: () => {} }, material: { dispose: () => {} } }, {
  get: (target, key) => target[key] ?? noop,
  set: () => true,
});

function instancesFor(puzzle) {
  return puzzle.pieces.map((definition, index) => {
    const source = PIECE_INSTANCES.find(
      (instance) => instance.type === definition.type && instance.side === definition.side,
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
  return { gameMode: "stage", stageNumber: puzzle.boardStage };
}

function withTargetPosition(puzzle, x, z) {
  return {
    ...puzzle,
    pieces: puzzle.pieces.map((piece, index) => index === 1
      ? { ...piece, position: { ...piece.position, x, z } }
      : piece),
  };
}

function withPositions(puzzle, positions) {
  return {
    ...puzzle,
    pieces: puzzle.pieces.map((piece) => positions[piece.id]
      ? { ...piece, position: { ...piece.position, ...positions[piece.id] } }
      : piece),
  };
}

function place(runtime, puzzle) {
  for (const definition of puzzle.pieces) {
    const binding = runtime.pieces.get(definition.id);
    const pose = computePuzzleSpawnPose(
      binding.instance,
      {
        pieceId: definition.id,
        normalizedX: definition.position.x,
        normalizedZ: definition.position.z,
        prone: definition.pose === "prone",
      },
      runtime.boardHalfExtent,
      runtime.__defaultY.get(definition.id),
    );
    binding.body.setTranslation(pose.translation, true);
    binding.body.setRotation(pose.rotation, true);
    binding.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    binding.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
}

function settlePhysics(runtime, maxSteps = 900) {
  let quiet = 0;
  for (let step = 0; step < maxSteps; step += 1) {
    runtime.world.step();
    const moving = [...runtime.pieces.values()].some((binding) => {
      const v = binding.body.linvel();
      const w = binding.body.angvel();
      return Math.hypot(v.x, v.y, v.z, w.x, w.y, w.z) > 0.002;
    });
    quiet = moving ? 0 : quiet + 1;
    if (quiet >= 20) return step + 1;
  }
  return maxSteps;
}

async function makeRuntime(puzzle) {
  const originalInfo = console.info;
  console.info = () => {};
  let physicsRuntime;
  try {
    physicsRuntime = await createPhysicsRuntime(
      meta,
      instancesFor(puzzle),
      meta.cellSize * 4,
      stageOptions(puzzle),
    );
  } finally {
    console.info = originalInfo;
  }
  preSettlePhysics(physicsRuntime);
  physicsRuntime.__defaultY = new Map(
    [...physicsRuntime.pieces].map(([id, binding]) => [id, binding.body.translation().y]),
  );
  place(physicsRuntime, puzzle);
  preSettlePhysics(physicsRuntime);
  const sceneRuntime = new Proxy({ pieceMeshes: new Map(), scene: { remove: () => {} } }, {
    get: (target, key) => {
      if (!(key in target)) target[key] = new Map();
      return target[key];
    },
  });
  for (const id of physicsRuntime.pieces.keys()) sceneRuntime.pieceMeshes.set(id, noopMesh);
  for (const [id, binding] of physicsRuntime.breakableWalls) {
    sceneRuntime.breakableWallMeshes.set(id, {
      mesh: noopMesh,
      definition: binding.definition,
    });
  }
  const turnRuntime = createTurnRuntime(
    physicsRuntime,
    sceneRuntime,
    { maxLaunchSpeed: MAX_LAUNCH_SPEED },
    meta.cellSize,
  );
  setTurnGameMode(turnRuntime, "puzzle");
  return { physicsRuntime, turnRuntime };
}

function position(runtime, pieceId) {
  const binding = runtime.pieces.get(pieceId);
  if (!binding) return null;
  const t = binding.body.translation();
  return { x: t.x, y: t.y, z: t.z };
}

function runTurnShot(state, puzzle, power, angleDeg, tracker) {
  const shooterId = puzzle.pieces[0].id;
  const physics = state.physicsRuntime;
  const turn = state.turnRuntime;
  const start = position(physics, shooterId);
  const com = physics.pieces.get(shooterId).body.worldCom();
  tracker.beginShot(shooterId, turn.physicsStepNumber, puzzle.pieces.filter((piece) => piece.protected).map((piece) => piece.id));
  const direction = new Vector3(Math.cos(angleDeg * Math.PI / 180), 0, Math.sin(angleDeg * Math.PI / 180));
  const request = {
    pieceId: shooterId,
    normalizedPower: power,
    direction,
    applicationPoint: new Vector3(com.x, com.y, com.z),
    speedMultiplier: 1,
  };
  const queued = queueTurnLaunch(turn, request);
  if (!queued.accepted) throw new Error(`queue rejected: ${queued.reason}`);
  turn.onPuzzlePhysicsStep = (step) => tracker.sample(step);
  let settled = false;
  turn.onPuzzleSettled = () => { settled = true; };
  for (let step = 0; step < 1800 && !settled; step += 1) {
    applyPendingLaunchBeforeStep(turn);
    physics.world.step();
    updateTurnAfterStep(turn, FIXED_STEP);
  }
  return {
    evidence: tracker.evidence,
    settled,
    phase: turn.phase,
    currentSide: turn.currentSide,
    start,
    applicationPoint: { x: com.x, y: com.y, z: com.z },
    end: position(physics, shooterId),
    launchPower: turn.lastLaunchPower,
    launchInitialSpeed: turn.lastLaunchInitialSpeed,
  };
}

async function verifyP03() {
  const original = puzzleById.get("P03");
  let best = null;
  const originalInfo = console.info;
  console.info = () => {};
  try {
    for (const playerZ of [0.9]) {
      for (const playerX of [-0.4]) {
      for (const targetX of [0.96]) {
      for (const targetZ of [0.8]) {
        const puzzle = withPositions(original, {
          [original.pieces[0].id]: { x: playerX, z: playerZ },
          [original.pieces[1].id]: { x: targetX, z: targetZ },
        });
        for (const angleDeg of [20]) {
          for (const speed of [5]) {
            let state;
            try {
              state = await makeRuntime(puzzle);
            } catch {
              continue;
            }
            const tracker = new PuzzlePhysicsTracker(state.physicsRuntime);
            const result = runTurnShot(state, puzzle, speed / MAX_LAUNCH_SPEED, angleDeg, tracker);
            const fallen = new Set(result.evidence.fallenPieces.map((piece) => piece.pieceId));
            const score = (fallen.has(puzzle.pieces[1].id) ? 10000 : 0) +
              (!fallen.has(puzzle.pieces[0].id) ? 1000 : 0) +
              (result.evidence.wallContactBeforeShotTargetContact ? 100 : 0) +
              result.evidence.pieceContacts.length;
            if (!best || score > best.score) best = { score, puzzle, speed, angleDeg, result };
            if (score >= 11100) break;
          }
        }
      }
      }
      }
    }
  } finally {
    console.info = originalInfo;
  }
  const { speed, angleDeg, result, puzzle } = best;
  return {
    puzzleId: "P03",
    solved: best.score >= 11100,
    normalizedPositions: Object.fromEntries(puzzle.pieces.map((piece) => [piece.id, piece.position])),
    normalizedPower: speed / MAX_LAUNCH_SPEED,
    angleDeg,
    point: "center",
    applicationPointWorld: result.applicationPoint,
    result,
  };
}

async function verifyP11() {
  const original = puzzleById.get("P11");
  let best = null;
  const originalInfo = console.info;
  console.info = () => {};
  try {
    for (const targetX of [-0.6]) {
      for (const targetZ of [0.2]) {
        const puzzle = withTargetPosition(original, targetX, targetZ);
        for (const angleDeg of [180]) {
          for (const speed of [2]) {
        const state = await makeRuntime(puzzle);
        const firstTracker = new PuzzlePhysicsTracker(state.physicsRuntime);
        const first = runTurnShot(state, puzzle, speed / MAX_LAUNCH_SPEED, angleDeg, firstTracker);
        const pendingDestroyed = applyPendingBreakableWallDestructions(state.physicsRuntime);
        for (let idleStep = 0; idleStep < 60; idleStep += 1) {
          state.physicsRuntime.world.step();
          updateTurnAfterStep(state.turnRuntime, FIXED_STEP);
        }
        const firstWallHit = first.evidence.wallContacts.some((contact) =>
          contact.pieceId === puzzle.pieces[0].id && contact.kind === "breakable-wall",
        );
        if (!firstWallHit || first.evidence.fallenPieces.some((piece) => piece.pieceId === puzzle.pieces[0].id)) continue;
        const target = position(state.physicsRuntime, puzzle.pieces[1].id);
        const shooter = position(state.physicsRuntime, puzzle.pieces[0].id);
        if (!state.physicsRuntime.pieces.has(puzzle.pieces[0].id)) continue;
        if (!target || !shooter || state.turnRuntime.phase !== "ready") continue;
        const baseAngle = Math.atan2(target.z - shooter.z, target.x - shooter.x) * 180 / Math.PI;
        for (const deltaDeg of [0]) {
          const secondTracker = new PuzzlePhysicsTracker(state.physicsRuntime);
          const second = runTurnShot(state, puzzle, 9 / MAX_LAUNCH_SPEED, baseAngle + deltaDeg, secondTracker);
          const secondPendingDestroyed = applyPendingBreakableWallDestructions(state.physicsRuntime);
          const targetOut = second.evidence.fallenPieces.some((piece) => piece.pieceId === puzzle.pieces[1].id);
          const playerAlive = !second.evidence.fallenPieces.some((piece) => piece.pieceId === puzzle.pieces[0].id);
          const destroyed = [
            ...pendingDestroyed,
            ...secondPendingDestroyed,
            ...second.evidence.destroyedWalls,
          ];
          const score = (targetOut ? 10000 : 0) + (playerAlive ? 1000 : 0) + (destroyed.length > 0 ? 100 : 0);
          if (!best || score > best.score) best = { score, puzzle, state, first, second, speed, angleDeg, baseAngle: baseAngle + deltaDeg, pendingDestroyed: destroyed, firstStart: first.applicationPoint, secondStart: second.applicationPoint };
          }
        }
      }
    }
    }
  } finally {
    console.info = originalInfo;
  }
  if (!best) return { puzzleId: "P11", solved: false, reason: "turn-path sweep found no first-shot wall destruction with shooter alive" };
  return {
    puzzleId: "P11",
    solved: best.score >= 11100,
    normalizedPositions: Object.fromEntries(best.puzzle.pieces.map((piece) => [piece.id, piece.position])),
    first: {
      normalizedPower: best.speed / MAX_LAUNCH_SPEED,
      angleDeg: best.angleDeg,
      point: "center",
      applicationPointWorld: best.firstStart,
      pendingDestroyedWalls: best.pendingDestroyed,
      result: best.first,
    },
    second: {
      normalizedPower: 9 / MAX_LAUNCH_SPEED,
      angleDeg: best.baseAngle,
      point: "center",
      applicationPointWorld: best.secondStart,
      result: best.second,
    },
  };
}

async function verifyP05Hole() {
  const original = puzzleById.get("P05");
  let best = null;
  const originalInfo = console.info;
  console.info = () => {};
  try {
    for (const playerX of [0.55]) {
      for (const playerZ of [0.6]) {
        for (const targetX of [0.15]) {
          for (const targetZ of [0.2]) {
            const puzzle = withPositions(original, {
              [original.pieces[0].id]: { x: playerX, z: playerZ },
              [original.pieces[1].id]: { x: targetX, z: targetZ },
            });
            const state = await makeRuntime(puzzle);
            const shooter = position(state.physicsRuntime, puzzle.pieces[0].id);
            const target = position(state.physicsRuntime, puzzle.pieces[1].id);
            const angle = Math.atan2(target.z - shooter.z, target.x - shooter.x) * 180 / Math.PI;
            for (const speed of [3, 5, 7, 9, 11]) {
              const candidateState = speed === 3 ? state : await makeRuntime(puzzle);
              const tracker = new PuzzlePhysicsTracker(candidateState.physicsRuntime);
              const result = runTurnShot(candidateState, puzzle, speed / MAX_LAUNCH_SPEED, angle, tracker);
              const fall = result.evidence.fallenPieces.find((piece) => piece.pieceId === puzzle.pieces[1].id);
              const score = fall?.reason === "hole" ? 10000 : fall ? 100 : 0;
              if (!best || score > best.score) best = { score, puzzle, speed, angle, result, runtime: candidateState };
            }
          }
        }
      }
    }
  } finally {
    console.info = originalInfo;
  }
  const bestFall = best?.result.evidence.fallenPieces.find((piece) => piece.pieceId === best.puzzle.pieces[1].id);
  assert.equal(bestFall?.reason, "hole");
  return {
    puzzleId: "P05",
    normalizedPositions: Object.fromEntries(best.puzzle.pieces.map((piece) => [piece.id, piece.position])),
    normalizedPower: best.speed / MAX_LAUNCH_SPEED,
    angleDeg: best.angle,
    fall: best.result.evidence.fallenPieces,
  };
}

function evaluateEvidence(puzzle, shots) {
  const input = {
    settled: true,
    launches: 0,
    fallenIDs: [],
    contactEvents: [],
    protectedContactIDs: [],
  };
  for (let index = 0; index < shots.length; index += 1) {
    input.launches = index + 1;
    appendPuzzlePhysicsEvidence(input, shots[index], puzzle);
  }
  return evaluatePuzzleAttempt(puzzle, input);
}

const p03 = await verifyP03();
const p11 = await verifyP11();
const p05Hole = await verifyP05Hole();
const p03Candidate = withPositions(puzzleById.get("P03"), p03.normalizedPositions);
const p03Medal = evaluateEvidence(p03Candidate, [p03.result.evidence]);
const p11Medal = evaluateEvidence(puzzleById.get("P11"), [p11.first.result.evidence, p11.second.result.evidence]);
  if (p03Medal.medal !== 3) throw new Error(JSON.stringify({ p03, p03Medal }));
if (p11Medal.medal !== 3) throw new Error(JSON.stringify({ p11, p11Medal }));
const result = {
  p03,
  p11,
  p05Hole,
  evaluationAssertions: { p03Medal: p03Medal.medal, p11Medal: p11Medal.medal },
  launchNote: "실제 queueTurnLaunch → applyPendingLaunchBeforeStep → world.step → updateTurnAfterStep 경로. power×maxLaunchSpeed(11), speedMultiplier=1, 중앙 world point, 카드·boost·커스텀 타점 없음.",
};
await writeFile(new URL("./puzzle-turn-solutions-results.json", import.meta.url), JSON.stringify(result, null, 2), "utf8");
console.log(JSON.stringify(result, null, 2));
await vite.close();
