import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../..", import.meta.url));
const giantPawn = {
  sizeGrade: 0, weightGrade: 0, forceGrade: 0,
  giantPawn: true, proneStart: false, picksSoFar: 1,
};

for (const portal of [false, true]) {
  const vite = await createServer({
    root, configFile: false, logLevel: "error", appType: "custom",
    server: { middlewareMode: true },
    define: { __CRAZYGAMES_BUILD__: JSON.stringify(portal), __POKI_BUILD__: "false" },
  });
  try {
    const { PIECE_INSTANCES } = await vite.ssrLoadModule("/src/layout.ts");
    const { computeStageBoardHalfExtent, getCrazyGamesOpeningStageInstances, selectStageSpawnInstances } =
      await vite.ssrLoadModule("/src/stage.ts");
    const physics = portal ? await vite.ssrLoadModule("/src/physics.ts") : null;
    const meta = portal ? JSON.parse(await readFile(new URL("../../public/assets/chess-set.meta.json", import.meta.url), "utf8")) : null;
    for (const [stageNumber, count, types] of [
      [1, 3, { Pawn: 3 }],
      [2, 4, { Pawn: 3, Rook: 1 }],
      [3, 4, { Pawn: 3, Knight: 1 }],
    ]) {
      const options = { gameMode: "stage", stageNumber };
      const opening = getCrazyGamesOpeningStageInstances(stageNumber);
      assert.equal(opening.length, count * 2);
      const selected = selectStageSpawnInstances(PIECE_INSTANCES, options);
      assert.equal(selected.length, portal ? count * 2 : 32);
      if (portal) {
        assert.deepEqual(selected, opening);
        assert.equal(new Set(selected.map((piece) => piece.id)).size, selected.length);
        assert.equal(new Set(selected.map((piece) => `${piece.startingSquare.file}${piece.startingSquare.rank}`)).size, selected.length);
        for (const side of ["white", "black"]) {
          const pieces = selected.filter((piece) => piece.side === side);
          assert.equal(pieces.length, count);
          for (const [type, expected] of Object.entries(types)) {
            assert.equal(pieces.filter((piece) => piece.type === type).length, expected);
          }
        }
        assert.deepEqual(selectStageSpawnInstances(PIECE_INSTANCES, options), selected);
        const withGiant = selectStageSpawnInstances(PIECE_INSTANCES, { ...options, runCards: giantPawn });
        assert.ok(withGiant.filter((piece) => piece.side === "white" && piece.type === "Pawn").length >= 2);
        assert.ok(withGiant.length < selected.length);
        assert.equal(withGiant.filter((piece) => piece.side === "black").length, count);
        for (const runCards of [undefined, giantPawn]) {
          const spawnOptions = { ...options, runCards };
          const runtime = await physics.createPhysicsRuntime(
            meta, PIECE_INSTANCES,
            computeStageBoardHalfExtent(meta.cellSize, "stage", stageNumber),
            spawnOptions,
          );
          assert.equal(runtime.pieces.size, selectStageSpawnInstances(PIECE_INSTANCES, spawnOptions).length);
        }
      }
      // An advanced puzzle can pass stage options with its own list.
      const custom = PIECE_INSTANCES.slice(0, 2);
      assert.deepEqual(selectStageSpawnInstances(custom, options), custom);
      for (const mode of ["weekly", "tutorial", "puzzle", "online", "hotseat"]) {
        assert.deepEqual(selectStageSpawnInstances(PIECE_INSTANCES, { gameMode: mode, stageNumber }), PIECE_INSTANCES);
      }
    }
    assert.equal(getCrazyGamesOpeningStageInstances(4), null);
    assert.equal(selectStageSpawnInstances(PIECE_INSTANCES, { gameMode: "stage", stageNumber: 4 }).length, 32);
  } finally {
    await vite.close();
  }
}
console.log("CrazyGames opening stage selection: PASS");
