import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
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
const { PIECE_INSTANCES } = await vite.ssrLoadModule("/src/layout.ts");
const { computeStageBoardHalfExtent } = await vite.ssrLoadModule("/src/stage.ts");
const { applyPuzzleSpawnDefinitions } = await vite.ssrLoadModule("/src/puzzle-spawn.ts");
const {
  createPhysicsRuntime,
  preSettlePhysics,
  rebuildPhysicsBoard,
  resetPhysicsPieces,
} = await vite.ssrLoadModule("/src/physics.ts");

globalThis.localStorage ??= { getItem: () => null, setItem: () => {} };
globalThis.document ??= new Proxy({ documentElement: {}, body: {} }, {
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

function puzzleInstances(puzzle) {
  return puzzle.pieces.map((piece, index) => {
    const source = PIECE_INSTANCES.find((instance) =>
      instance.type === piece.type && instance.side === piece.side,
    );
    if (!source) throw new Error(`${piece.type}/${piece.side} 표준 기물을 찾지 못했습니다.`);
    return {
      ...source,
      id: piece.id,
      startingSquare: {
        file: String.fromCharCode(97 + index),
        rank: piece.side === "white" ? 1 : 8,
      },
    };
  });
}

function boardOptions(puzzle) {
  return puzzle.boardTemplate === "basic"
    ? { gameMode: "puzzle", stageNumber: 1 }
    : { gameMode: "stage", stageNumber: puzzle.boardStage };
}

function assertStartupState(runtime, puzzle) {
  const expected = puzzle.pieces.length;
  assert.equal(runtime.pieces.size, expected, `${puzzle.puzzleId}: 말 수 ${runtime.pieces.size}/${expected}`);
  const fallen = [...runtime.pieces.entries()]
    .filter(([, binding]) => binding.body.translation().y < -2)
    .map(([id]) => id);
  assert.deepEqual(fallen, [], `${puzzle.puzzleId}: 낙하한 시작 말 ${fallen.join(",")}`);
  const awake = [...runtime.pieces.entries()]
    .filter(([, binding]) => !binding.body.isSleeping())
    .map(([id]) => id);
  assert.deepEqual(awake, [], `${puzzle.puzzleId}: 수면하지 않은 시작 말 ${awake.join(",")}`);
}

const initialHalfExtent = computeStageBoardHalfExtent(meta.cellSize, "hotseat", 1);
const runtime = await createPhysicsRuntime(
  meta,
  PIECE_INSTANCES,
  initialHalfExtent,
  { gameMode: "hotseat", stageNumber: 1 },
);
preSettlePhysics(runtime);

const failures = [];
const checks = [];
for (const puzzle of PUZZLE_CATALOG) {
  try {
    const options = boardOptions(puzzle);
    const halfExtent = computeStageBoardHalfExtent(meta.cellSize, options.gameMode, options.stageNumber);
    rebuildPhysicsBoard(runtime, meta, halfExtent, options);
    const instances = puzzleInstances(puzzle);
    resetPhysicsPieces(runtime, meta, instances, { gameMode: "puzzle", stageNumber: 1 });
    const pieceMeshes = new Map([...runtime.pieces.keys()].map((id) => [id, noopMesh]));
    applyPuzzleSpawnDefinitions(
      puzzle.pieces.map((piece) => ({
        pieceId: piece.id,
        normalizedX: piece.position.x,
        normalizedZ: piece.position.z,
        prone: piece.pose === "prone",
      })),
      { physicsRuntime: runtime, pieceMeshes, boardHalfExtent: halfExtent },
    );
    preSettlePhysics(runtime);
    assertStartupState(runtime, puzzle);
    checks.push({ puzzleId: puzzle.puzzleId, pieces: runtime.pieces.size, boardHalfExtent: halfExtent, sleeping: true });
    console.log(`[통과] ${puzzle.puzzleId}: pieces=${runtime.pieces.size}, H=${halfExtent.toFixed(9)}, all sleeping`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push({ puzzleId: puzzle.puzzleId, message });
    console.error(`[실패] ${puzzle.puzzleId}: ${message}`);
  }
}

const report = { checked: PUZZLE_CATALOG.map((puzzle) => puzzle.puzzleId), checks, failures };
await writeFile(new URL("./puzzle-startup-check-results.json", import.meta.url), JSON.stringify(report, null, 2), "utf8");

if (failures.length > 0) {
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify(report, null, 2));
}
await vite.close();
