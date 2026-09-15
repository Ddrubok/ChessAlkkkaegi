import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const vite = await createServer({
  root: projectRoot,
  configFile: false,
  logLevel: "error",
  server: { middlewareMode: true },
});

try {
  const { isBasicTutorialCompleted, pickLobbyRecommendation } =
    await vite.ssrLoadModule("/src/lobby-recommendation.ts");

  for (const value of [null, "started", "skipped"]) {
    assert.equal(isBasicTutorialCompleted(value), false);
  }
  assert.equal(isBasicTutorialCompleted("true"), true);

  assert.deepEqual(
    pickLobbyRecommendation({ basicTutorialCompleted: false, maxClearedStage: 0, maxStage: 10 }),
    { kind: "tutorial" },
  );

  for (let maxClearedStage = 0; maxClearedStage <= 9; maxClearedStage++) {
    assert.deepEqual(
      pickLobbyRecommendation({ basicTutorialCompleted: true, maxClearedStage, maxStage: 10 }),
      { kind: "stage", stage: maxClearedStage + 1, maxClearedStage },
    );
  }

  assert.deepEqual(
    pickLobbyRecommendation({ basicTutorialCompleted: true, maxClearedStage: 10, maxStage: 10 }),
    { kind: "online" },
  );
} finally {
  await vite.close();
}

console.log("PASS lobby recommendation contract: tutorial, stages 1-10, and online cases");
