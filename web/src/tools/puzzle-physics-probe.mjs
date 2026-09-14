import { readFile } from "node:fs/promises";
import {
  PUZZLE_CATALOG,
} from "../puzzle.ts";
import {
  computePuzzleSpawnPose,
} from "../puzzle-spawn.ts";
import {
  applyPendingBreakableWallDestructions,
  createPhysicsRuntime,
  resetPhysicsBreakableWalls,
  resetPhysicsPinballObstacles,
  scanBreakableWallContacts,
} from "../physics.ts";
import { PuzzlePhysicsTracker } from "../puzzle-physics.ts";
import { PIECE_INSTANCES } from "../layout.ts";

const meta = JSON.parse(
  await readFile(new URL("../../public/assets/chess-set.meta.json", import.meta.url), "utf8"),
);

const stageOptionsFor = (puzzle) => puzzle.boardTemplate === "basic"
  ? { gameMode: "hotseat", stageNumber: 1 }
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
  const runtime = await createPhysicsRuntime(
    meta,
    makeInstances(puzzle),
    meta.cellSize * 4,
    stageOptionsFor(puzzle),
  );
  runtime.__puzzleDefaultY = new Map(
    [...runtime.pieces].map(([id, binding]) => [id, binding.body.translation().y]),
  );
  placePuzzle(runtime, puzzle);
  return runtime;
}

function placePuzzle(runtime, puzzle) {
  for (const definition of puzzle.pieces) {
    const binding = runtime.pieces.get(definition.id);
    if (!binding) throw new Error(`missing physics piece ${definition.id}`);
    const defaultY = runtime.__puzzleDefaultY.get(definition.id);
    if (defaultY === undefined) throw new Error(`missing default y ${definition.id}`);
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

function settle(runtime, maxSteps = 1600) {
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

function resetTrial(runtime, puzzle) {
  for (const binding of runtime.pieces.values()) {
    binding.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    binding.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
  resetPhysicsBreakableWalls(runtime, meta, stageOptionsFor(puzzle));
  resetPhysicsPinballObstacles(runtime, meta, stageOptionsFor(puzzle));
  placePuzzle(runtime, puzzle);
  settle(runtime);
}

function simulate(runtime, puzzle, speed, angle) {
  resetTrial(runtime, puzzle);
  const shooter = puzzle.pieces[0];
  const binding = runtime.pieces.get(shooter.id);
  if (!binding) throw new Error(`missing shooter ${shooter.id}`);
  const tracker = new PuzzlePhysicsTracker(runtime);
  const protectedIds = puzzle.pieces.filter((piece) => piece.protected).map((piece) => piece.id);
  tracker.beginShot(shooter.id, 0, protectedIds);
  binding.body.setLinvel({ x: Math.cos(angle) * speed, y: 0, z: Math.sin(angle) * speed }, true);
  for (let step = 1; step <= Number(process.env.MAX_STEPS ?? 900); step += 1) {
    runtime.world.step();
    scanBreakableWallContacts(runtime);
    applyPendingBreakableWallDestructions(runtime);
    tracker.sample(step);
  }
  const finalPositions = [...runtime.pieces].map(([id, item]) => {
    const t = item.body.translation();
    return [id, Number(t.x.toFixed(3)), Number(t.y.toFixed(3)), Number(t.z.toFixed(3))];
  });
  return { ...tracker.evidence, finalPositions };
}

function score(puzzle, evidence) {
  const required = new Set(puzzle.required.requiredFallIds);
  const fallen = new Set(evidence.fallenPieces.map((piece) => piece.pieceId));
  const hitCount = [...required].filter((id) => fallen.has(id)).length;
  const wall = evidence.destroyedWalls.length;
  const reflection = evidence.wallContactBeforeShotTargetContact ? 1 : 0;
  const targetKinds = evidence.pieceContacts.filter((contact) =>
    contact.firstPieceId === puzzle.pieces[0].id || contact.secondPieceId === puzzle.pieces[0].id,
  ).length;
  return hitCount * 100 + wall * 20 + reflection * 10 + targetKinds
    - evidence.protectedPieceContacts.length * 1000;
}

const selectedPuzzles = process.env.PUZZLE_ID
  ? PUZZLE_CATALOG.filter((puzzle) => puzzle.puzzleId === process.env.PUZZLE_ID)
  : PUZZLE_CATALOG;
for (const puzzle of selectedPuzzles) {
  const runtime = await makeRuntime(puzzle);
  let best = null;
  const shooter = puzzle.pieces[0];
  const target = puzzle.pieces.find((piece) => piece.side !== shooter.side) ?? puzzle.pieces[1];
  const dx = target.position.x - shooter.position.x;
  const dz = target.position.z - shooter.position.z;
  const baseAngle = Math.atan2(dz, dx);
  const angles = process.env.ANGLE_DEG
    ? process.env.ANGLE_DEG.split(",").map((value) => Number(value) * Math.PI / 180)
    : puzzle.boardTemplate === "basic"
    ? Array.from({ length: process.env.FAST ? 5 : 25 }, (_, index) => baseAngle + (index - (process.env.FAST ? 2 : 12)) * Math.PI / 36)
    : Array.from({ length: process.env.FAST ? 12 : 72 }, (_, index) => index * Math.PI / (process.env.FAST ? 6 : 36));
  for (const angle of angles) {
    for (const speed of process.env.SPEED
      ? process.env.SPEED.split(",").map(Number)
      : process.env.FAST
      ? [2, 4, 6, 8, 10, 11]
      : [0.6, 0.9, 1.2, 1.6, 2.1, 2.8, 3.6, 4.5, 6, 8, 10, 14]) {
      const evidence = simulate(runtime, puzzle, speed, angle);
      const candidate = { score: score(puzzle, evidence), speed, angle, evidence };
      if (!best || candidate.score > best.score) best = candidate;
    }
  }
  const fallen = best.evidence.fallenPieces.map((piece) => `${piece.pieceId}:${piece.reason}`);
  const contacts = best.evidence.wallContacts
    .filter((contact) => contact.kind !== "board-floor")
    .map((contact) => `${contact.pieceId}>${contact.wallId}@${contact.step}`);
  console.log(JSON.stringify({
    puzzleId: puzzle.puzzleId,
    boardHalfExtent: runtime.boardHalfExtent,
    bestScore: best.score,
    speed: best.speed,
    angleDeg: best.angle * 180 / Math.PI,
    fallen,
    destroyedWalls: best.evidence.destroyedWalls,
    wallContacts: contacts,
    wallBeforeTarget: best.evidence.wallContactBeforeShotTargetContact,
    pieceContacts: best.evidence.pieceContacts,
    protectedPieceContacts: best.evidence.protectedPieceContacts,
    finalPositions: best.evidence.finalPositions,
  }));
}
