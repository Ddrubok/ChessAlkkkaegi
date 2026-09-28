import assert from "node:assert/strict";
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
const { computePuzzleSpawnPose } = await vite.ssrLoadModule("/src/puzzle-spawn.ts");
const { createPhysicsRuntime, preSettlePhysics } = await vite.ssrLoadModule("/src/physics.ts");
const { PuzzlePhysicsTracker } = await vite.ssrLoadModule("/src/puzzle-physics.ts");
const { appendPuzzlePhysicsEvidence } = await vite.ssrLoadModule("/src/puzzle-evidence.ts");
const { PIECE_INSTANCES } = await vite.ssrLoadModule("/src/layout.ts");

globalThis.localStorage ??= { getItem: () => null, setItem: () => {} };
const noop = new Proxy({}, { get: (_target, key) => key === "visible" ? true : noop, set: () => true });
const noopMesh = new Proxy({ geometry: { dispose: () => {} }, material: { dispose: () => {} } }, { get: (target, key) => target[key] ?? noop, set: () => true });
globalThis.document ??= new Proxy({ documentElement: {}, body: {}, addEventListener: () => {}, removeEventListener: () => {} }, { get: (target, key) => target[key] ?? noop });
const { applyPendingLaunchBeforeStep, createTurnRuntime, queueTurnLaunch, setTurnGameMode, updateTurnAfterStep } = await vite.ssrLoadModule("/src/turn.ts");

const meta = JSON.parse(await readFile(new URL("../../public/assets/chess-set.meta.json", import.meta.url), "utf8"));
const catalog = new Map(PUZZLE_CATALOG.map((puzzle) => [puzzle.puzzleId, puzzle]));

function withPositions(puzzle, positions) {
  return { ...puzzle, pieces: puzzle.pieces.map((piece) => positions[piece.id] ? { ...piece, position: { ...piece.position, ...positions[piece.id] } } : piece) };
}

function instancesFor(puzzle) {
  return puzzle.pieces.map((definition, index) => {
    const source = PIECE_INSTANCES.find((instance) => instance.type === definition.type && instance.side === definition.side);
    return { ...source, id: definition.id, startingSquare: { file: String.fromCharCode(97 + index), rank: definition.side === "white" ? 1 : 8 } };
  });
}

function place(runtime, puzzle) {
  for (const definition of puzzle.pieces) {
    const binding = runtime.pieces.get(definition.id);
    const pose = computePuzzleSpawnPose(binding.instance, { pieceId: definition.id, normalizedX: definition.position.x, normalizedZ: definition.position.z, prone: definition.pose === "prone" }, runtime.boardHalfExtent, runtime.__defaultY.get(definition.id));
    binding.body.setTranslation(pose.translation, true);
    binding.body.setRotation(pose.rotation, true);
    binding.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    binding.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
}

function settle(runtime, maxSteps = 900) {
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

async function makeState(puzzle) {
  const originalInfo = console.info;
  console.info = () => {};
  let physicsRuntime;
  try {
    physicsRuntime = await createPhysicsRuntime(meta, instancesFor(puzzle), meta.cellSize * 4, { gameMode: "stage", stageNumber: puzzle.boardStage });
  } finally {
    console.info = originalInfo;
  }
  preSettlePhysics(physicsRuntime);
  physicsRuntime.__defaultY = new Map([...physicsRuntime.pieces].map(([id, binding]) => [id, binding.body.translation().y]));
  place(physicsRuntime, puzzle);
  preSettlePhysics(physicsRuntime);
  const sceneRuntime = new Proxy({ pieceMeshes: new Map(), scene: { remove: () => {} } }, { get: (target, key) => target[key] ??= new Map() });
  for (const id of physicsRuntime.pieces.keys()) sceneRuntime.pieceMeshes.set(id, noopMesh);
  for (const [id, binding] of physicsRuntime.breakableWalls) sceneRuntime.breakableWallMeshes.set(id, { mesh: noopMesh, definition: binding.definition });
  const turnRuntime = createTurnRuntime(physicsRuntime, sceneRuntime, { maxLaunchSpeed: MAX_LAUNCH_SPEED }, meta.cellSize);
  setTurnGameMode(turnRuntime, "puzzle");
  return { physicsRuntime, turnRuntime };
}

function position(runtime, id) {
  const binding = runtime.pieces.get(id);
  if (!binding) return null;
  const t = binding.body.translation();
  return { x: t.x, y: t.y, z: t.z };
}

function runShot(state, puzzle, speed, angleDeg) {
  const physics = state.physicsRuntime;
  const turn = state.turnRuntime;
  const shooterId = puzzle.pieces[0].id;
  const binding = physics.pieces.get(shooterId);
  if (!binding) throw new Error(`missing shooter ${shooterId}`);
  const start = position(physics, shooterId);
  const com = binding.body.worldCom();
  const tracker = new PuzzlePhysicsTracker(physics);
  tracker.beginShot(shooterId, turn.physicsStepNumber, puzzle.pieces.filter((piece) => piece.protected).map((piece) => piece.id));
  const direction = new Vector3(Math.cos(angleDeg * Math.PI / 180), 0, Math.sin(angleDeg * Math.PI / 180));
  const queued = queueTurnLaunch(turn, { pieceId: shooterId, normalizedPower: speed / MAX_LAUNCH_SPEED, direction, applicationPoint: new Vector3(com.x, com.y, com.z), speedMultiplier: 1 });
  if (!queued.accepted) throw new Error(queued.reason ?? "launch rejected");
  turn.onPuzzlePhysicsStep = (step) => tracker.sample(step);
  let settled = false;
  turn.onPuzzleSettled = () => { settled = true; };
  for (let step = 0; step < 1800 && !settled; step += 1) {
    applyPendingLaunchBeforeStep(turn);
    physics.world.step();
    updateTurnAfterStep(turn, FIXED_STEP);
  }
  return { evidence: tracker.evidence, settled, start, applicationPoint: { x: com.x, y: com.y, z: com.z }, end: position(physics, shooterId), initialSpeed: turn.lastLaunchInitialSpeed, phase: turn.phase };
}

function evaluation(puzzle, shot) {
  const input = { settled: true, launches: 1, fallenIDs: [], contactEvents: [], protectedContactIDs: [] };
  appendPuzzlePhysicsEvidence(input, shot.evidence, puzzle);
  return evaluatePuzzleAttempt(puzzle, input);
}

async function solveP05() {
  const original = catalog.get("P05");
  let best = null;
  const originalInfo = console.info;
  console.info = () => {};
  try {
    for (const player of [{ x: 0.55, z: 0.6 }, { x: 0.7, z: 0.7 }, { x: 0.85, z: 0.8 }]) {
      for (const target of [{ x: 0.15, z: 0.2 }, { x: 0.2, z: 0.2 }, { x: 0.25, z: 0.2 }]) {
        const puzzle = withPositions(original, { [original.pieces[0].id]: player, [original.pieces[1].id]: target });
        const state = await makeState(puzzle);
        const shooter = position(state.physicsRuntime, puzzle.pieces[0].id);
        const targetPosition = position(state.physicsRuntime, puzzle.pieces[1].id);
        const angle = Math.atan2(targetPosition.z - shooter.z, targetPosition.x - shooter.x) * 180 / Math.PI;
        for (const speed of [2, 3, 4, 5, 6, 7, 8, 9, 10]) {
          const candidateState = speed === 2 ? state : await makeState(puzzle);
          const shot = runShot(candidateState, puzzle, speed, angle);
          const fall = shot.evidence.fallenPieces.find((piece) => piece.pieceId === puzzle.pieces[1].id);
          const shooterFall = shot.evidence.fallenPieces.some((piece) => piece.pieceId === puzzle.pieces[0].id);
          const score = (fall?.reason === "hole" ? 10000 : fall ? 100 : 0) + (shooterFall ? 0 : 1000);
          if (!best || score > best.score) best = { score, puzzle, speed, angle, shot };
        }
      }
    }
  } finally {
    console.info = originalInfo;
  }
  assert.ok(best && best.speed >= 0 && best.speed <= MAX_LAUNCH_SPEED, "P05 launch speed must be within the game max");
  const medal = evaluation(best.puzzle, best.shot);
  assert.equal(medal.medal, 3);
  return { puzzleId: "P05", normalizedPositions: Object.fromEntries(best.puzzle.pieces.map((piece) => [piece.id, piece.position])), normalizedPower: best.speed / MAX_LAUNCH_SPEED, angleDeg: best.angle, point: "center", shot: best.shot, evaluation: medal };
}

async function solveP09() {
  const original = catalog.get("P09");
  let best = null;
  const originalInfo = console.info;
  console.info = () => {};
  try {
    for (const target of [
      ...[0.62, 0.72, 0.82, 0.92].flatMap((x) => [-0.65, -0.78, -0.9].map((z) => ({ x, z }))),
      ...[-0.62, -0.72, -0.82, -0.92].flatMap((x) => [0.65, 0.78, 0.9].map((z) => ({ x, z }))),
    ]) {
      const player = { x: target.x > 0 ? target.x - 0.6 : target.x + 0.6, z: target.z };
        const puzzle = withPositions(original, { [original.pieces[0].id]: player, [original.pieces[1].id]: target });
        for (const speed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
          let state;
          try {
            state = await makeState(puzzle);
          } catch {
            continue;
          }
          if (!globalThis.__p09HolesLogged) {
            globalThis.__p09HolesLogged = true;
            console.error(JSON.stringify(state.physicsRuntime.boardHoleRectangles));
          }
          const shooter = position(state.physicsRuntime, puzzle.pieces[0].id);
          const targetPosition = position(state.physicsRuntime, puzzle.pieces[1].id);
          if (!targetPosition || targetPosition.y < -1) continue;
          const directAngle = Math.atan2(targetPosition.z - shooter.z, targetPosition.x - shooter.x) * 180 / Math.PI;
          for (const delta of [-25, -15, -10, -5, 0, 5, 10, 15, 25]) {
            const angle = directAngle + delta;
            const shot = runShot(await makeState(puzzle), puzzle, speed, angle);
            const fall = shot.evidence.fallenPieces.find((piece) => piece.pieceId === puzzle.pieces[1].id);
            const shooterFall = shot.evidence.fallenPieces.some((piece) => piece.pieceId === puzzle.pieces[0].id);
            const score = (fall?.reason === "hole" ? 10000 : fall ? 100 : 0) + (shooterFall ? 0 : 1000);
            if (!best || score > best.score) best = { score, puzzle, speed, angle, shot };
            if (fall?.reason === "hole" && !shooterFall) break;
          }
          if (best?.score >= 11000) break;
        }
      }
  } finally {
    console.info = originalInfo;
  }
  assert.ok(best && best.speed >= 0 && best.speed <= MAX_LAUNCH_SPEED, "P09 launch speed must be within the game max");
  const medal = evaluation(best.puzzle, best.shot);
  if (medal.medal !== 3) {
    throw new Error(JSON.stringify({ bestScore: best.score, normalizedPositions: best.puzzle.pieces.map((piece) => piece.position), speed: best.speed, angle: best.angle, fall: best.shot.evidence.fallenPieces, contacts: best.shot.evidence.pieceContacts, evaluation: medal }));
  }
  return { puzzleId: "P09", normalizedPositions: Object.fromEntries(best.puzzle.pieces.map((piece) => [piece.id, piece.position])), normalizedPower: best.speed / MAX_LAUNCH_SPEED, angleDeg: best.angle, point: "center", knightLaunchInitialSpeed: best.shot.initialSpeed, shot: best.shot, evaluation: medal };
}

const result = { p05: await solveP05(), p09: await solveP09(), launchNote: "실제 queueTurnLaunch → applyPendingLaunchBeforeStep → world.step → updateTurnAfterStep. 중앙 타점은 worldCom(), Knight는 direction.y<0.2에서 게임의 자동 고도를 적용." };
await writeFile(new URL("./puzzle-hole-solutions-results.json", import.meta.url), JSON.stringify(result, null, 2), "utf8");
console.log(JSON.stringify(result, null, 2));
await vite.close();
