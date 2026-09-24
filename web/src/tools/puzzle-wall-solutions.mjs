import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// 앱 모듈은 확장자 없는 import를 쓰므로 Node로 직접 불러오지 않고 Vite로 불러온다.
const vite = await createServer({
  root: fileURLToPath(new URL("../..", import.meta.url)),
  configFile: false,
  logLevel: "error",
  server: { middlewareMode: true, hmr: false },
});
const { PUZZLE_CATALOG } = await vite.ssrLoadModule("/src/puzzle.ts");
const { computePuzzleSpawnPose } = await vite.ssrLoadModule("/src/puzzle-spawn.ts");
const {
  applyPendingBreakableWallDestructions,
  createPhysicsRuntime,
  scanBreakableWallContacts,
} = await vite.ssrLoadModule("/src/physics.ts");
const { PuzzlePhysicsTracker } = await vite.ssrLoadModule("/src/puzzle-physics.ts");
const { PIECE_INSTANCES } = await vite.ssrLoadModule("/src/layout.ts");

const meta = JSON.parse(await readFile(
  new URL("../../public/assets/chess-set.meta.json", import.meta.url),
  "utf8",
));
const puzzleById = new Map(PUZZLE_CATALOG.map((puzzle) => [puzzle.puzzleId, puzzle]));

const stageOptions = (puzzle) => ({ gameMode: "stage", stageNumber: puzzle.boardStage });

function instancesFor(puzzle) {
  return puzzle.pieces.map((definition, index) => {
    const source = PIECE_INSTANCES.find(
      (instance) => instance.type === definition.type && instance.side === definition.side,
    );
    if (!source) throw new Error(`missing instance ${definition.type}/${definition.side}`);
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

function withPositions(puzzle, positions) {
  return {
    ...puzzle,
    pieces: puzzle.pieces.map((piece) => ({
      ...piece,
      position: {
        ...piece.position,
        ...(positions[piece.id] ?? {}),
      },
    })),
  };
}

async function createTrial(puzzle) {
  const originalInfo = console.info;
  console.info = () => {};
  let runtime;
  try {
    runtime = await createPhysicsRuntime(
      meta,
      instancesFor(puzzle),
      meta.cellSize * 4,
      stageOptions(puzzle),
    );
  } finally {
    console.info = originalInfo;
  }
  runtime.__defaultY = new Map(
    [...runtime.pieces].map(([id, binding]) => [id, binding.body.translation().y]),
  );
  place(runtime, puzzle);
  settle(runtime);
  return runtime;
}

function place(runtime, puzzle) {
  for (const definition of puzzle.pieces) {
    const binding = runtime.pieces.get(definition.id);
    const defaultY = runtime.__defaultY.get(definition.id);
    const pose = computePuzzleSpawnPose(
      binding.instance,
      {
        pieceId: definition.id,
        normalizedX: definition.position.x,
        normalizedZ: definition.position.z,
        prone: definition.pose === "prone",
      },
      runtime.boardHalfExtent,
      defaultY,
    );
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

function runShot(runtime, puzzle, speed, angle, launch, maxSteps = 600) {
  const shooterId = puzzle.pieces[0].id;
  const shooter = runtime.pieces.get(shooterId);
  const tracker = new PuzzlePhysicsTracker(runtime);
  tracker.beginShot(
    shooterId,
    launch * 10000,
    puzzle.pieces.filter((piece) => piece.protected).map((piece) => piece.id),
  );
  shooter.body.setLinvel({ x: Math.cos(angle) * speed, y: 0, z: Math.sin(angle) * speed }, true);
  for (let step = 1; step <= maxSteps; step += 1) {
    runtime.world.step();
    scanBreakableWallContacts(runtime);
    applyPendingBreakableWallDestructions(runtime);
    tracker.sample(launch * 10000 + step);
  }
  return tracker.evidence;
}

function fallenIds(evidence) {
  return new Set(evidence.fallenPieces.map((piece) => piece.pieceId));
}

function position(runtime, id) {
  const t = runtime.pieces.get(id).body.translation();
  return { x: t.x, y: t.y, z: t.z };
}

function compactEvidence(evidence) {
  return {
    fallenPieces: evidence.fallenPieces,
    pieceContacts: evidence.pieceContacts,
    wallContacts: evidence.wallContacts.filter((contact) => contact.kind !== "board-floor"),
    destroyedWalls: evidence.destroyedWalls,
    wallContactBeforeShotTargetContact: evidence.wallContactBeforeShotTargetContact,
  };
}

async function solveP03() {
  const original = puzzleById.get("P03");
  let best = null;
  for (const playerX of [-0.8]) {
    for (const playerZ of [0.55]) {
      for (const targetX of [0.98]) {
        for (const targetZ of [0.3, 0.5]) {
          const puzzle = withPositions(original, {
            [original.pieces[0].id]: { x: playerX, z: playerZ },
            [original.pieces[1].id]: { x: targetX, z: targetZ },
          });
          for (const angleDeg of [50, 55, 60, 65, 70, 75]) {
            for (const speed of [3, 4, 5, 6]) {
              const runtime = await createTrial(puzzle);
              const evidence = runShot(runtime, puzzle, speed, angleDeg * Math.PI / 180, 1, 500);
              const fallen = fallenIds(evidence);
              const targetFell = fallen.has(original.pieces[1].id);
              const playerAlive = !fallen.has(original.pieces[0].id);
              const score = (targetFell ? 10000 : 0) +
                (playerAlive ? 1000 : 0) +
                (evidence.wallContactBeforeShotTargetContact ? 100 : 0) +
                evidence.pieceContacts.length;
              if (!best || score > best.score) {
                best = {
                  score,
                  puzzle,
                  speed,
                  angleDeg,
                  evidence,
                  playerPosition: position(runtime, original.pieces[0].id),
                  targetPosition: position(runtime, original.pieces[1].id),
                };
              }
            }
          }
        }
      }
    }
  }
  return {
    puzzleId: "P03",
    solved: best.score >= 11100,
    normalizedPositions: Object.fromEntries(best.puzzle.pieces.map((piece) => [piece.id, piece.position])),
    speed: best.speed,
    angleDeg: best.angleDeg,
    point: "center",
    normalizedPower: best.speed / 11,
    playerPositionAfter: best.playerPosition,
    targetPositionAfter: best.targetPosition,
    evidence: compactEvidence(best.evidence),
  };
}

async function solveP11() {
  const puzzle = puzzleById.get("P11");
  const firstAngles = Array.from({ length: 18 }, (_, index) => index * 20);
  let best = null;
  for (const angleDeg of firstAngles) {
    for (const speed of [1, 2, 3, 4, 5]) {
      const runtime = await createTrial(puzzle);
      const first = runShot(runtime, puzzle, speed, angleDeg * Math.PI / 180, 1, 360);
      const firstFallen = fallenIds(first);
      if (first.destroyedWalls.length === 0 || firstFallen.has(puzzle.pieces[0].id)) continue;
      settle(runtime, 300);
      const shooter = position(runtime, puzzle.pieces[0].id);
      const target = position(runtime, puzzle.pieces[1].id);
      const baseAngle = Math.atan2(target.z - shooter.z, target.x - shooter.x);
      for (const deltaDeg of [-20, -10, 0, 10, 20]) {
        for (const secondSpeed of [1, 2, 3, 4, 5, 6]) {
          const second = runShot(runtime, puzzle, secondSpeed, baseAngle + deltaDeg * Math.PI / 180, 2, 500);
          const secondFallen = fallenIds(second);
          const targetOut = secondFallen.has(puzzle.pieces[1].id);
          const playerAlive = !secondFallen.has(puzzle.pieces[0].id);
          const score = (targetOut ? 10000 : 0) + (playerAlive ? 1000 : 0) + second.pieceContacts.length;
          if (!best || score > best.score) {
            best = {
              score,
              speed,
              angleDeg,
              first,
              secondSpeed,
              secondAngleDeg: (baseAngle + deltaDeg * Math.PI / 180) * 180 / Math.PI,
              second,
              firstPositionAfter: shooter,
              finalPlayerPosition: position(runtime, puzzle.pieces[0].id),
              finalTargetPosition: position(runtime, puzzle.pieces[1].id),
            };
          }
        }
      }
    }
  }
  return {
    puzzleId: "P11",
    solved: best?.score >= 11000,
    firstSpeed: best?.speed,
    firstAngleDeg: best?.angleDeg,
    firstPoint: "center",
    secondSpeed: best?.secondSpeed,
    secondAngleDeg: best?.secondAngleDeg,
    secondPoint: "center",
    normalizedPowers: best
      ? { first: best.speed / 11, second: best.secondSpeed / 11 }
      : null,
    firstPositionAfter: best?.firstPositionAfter,
    finalPlayerPosition: best?.finalPlayerPosition,
    finalTargetPosition: best?.finalTargetPosition,
    firstEvidence: best ? compactEvidence(best.first) : null,
    secondEvidence: best ? compactEvidence(best.second) : null,
  };
}

const result = {
  ...(process.env.ONLY !== "P11" ? { p03: await solveP03() } : {}),
  ...(process.env.ONLY !== "P03" ? { p11: await solveP11() } : {}),
  launchNote: "probe는 MAX_LAUNCH_SPEED=11 범위의 기본 setLinvel만 사용했으며, stage force bonus·카드·커스텀 타점·룩 maxPower 보정은 적용하지 않았다.",
};
await writeFile(
  new URL("./puzzle-wall-solutions-results.json", import.meta.url),
  JSON.stringify(result, null, 2),
  "utf8",
);
console.log(JSON.stringify(result, null, 2));
await vite.close();
