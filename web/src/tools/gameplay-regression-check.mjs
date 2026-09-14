import "./headless-browser-env.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Scene, Mesh, PerspectiveCamera } from "three";
import { createServer } from "vite";

const webRoot = fileURLToPath(new URL("../..", import.meta.url));
const vite = await createServer({
  root: webRoot,
  logLevel: "error",
  configFile: false,
  server: { middlewareMode: true },
});

try {
  const physics = await vite.ssrLoadModule("/src/physics.ts");
  const turn = await vite.ssrLoadModule("/src/turn.ts");
  const gameMode = await vite.ssrLoadModule("/src/game-mode.ts");
  const layout = await vite.ssrLoadModule("/src/layout.ts");
  const tuning = await vite.ssrLoadModule("/src/tuning.ts");
  const progression = await vite.ssrLoadModule("/src/meta.ts");
  const cardTuning = await vite.ssrLoadModule("/src/card-tuning.ts");
  let debugStage = 3;
  let debugPoints = { lastClearedStage: 2, startedAtStage: 3 };
  const snapshot = () => ({ gameMode: "stage", stageNumber: debugStage, points: 0,
    runCardsSignature: "{}", permanentUpgradesSignature: "{}", stageRunPointsSignature: JSON.stringify(debugPoints) });
  const jump = (target, reset) => cardTuning.jumpCardTuningStage(target, snapshot,
    value => { debugStage = value; },
    (lastClearedStage, startedAtStage) => { debugPoints = { lastClearedStage, startedAtStage }; }, reset);
  await assert.rejects(jump(2, async (_, stage) => { if (stage === 2) throw new Error("reset failed"); }), /reset failed/);
  assert.equal(debugStage, 3);
  assert.deepEqual(debugPoints, { lastClearedStage: 2, startedAtStage: 3 });
  await jump(2, async () => {});
  assert.deepEqual(debugPoints, { lastClearedStage: 1, startedAtStage: 2 });
  const { MemoryStorage } = await import("./headless-browser-env.mjs");
  const progressionRuntime = progression.createMetaRuntime(new MemoryStorage());
  const stageThree = progression.createStageRunPointState(3);
  assert.equal(progression.settleStageRunPoints(progressionRuntime, stageThree), 0, "No reward for skipped stages on immediate defeat");
  const clearedThree = progression.createStageRunPointState(3);
  const expectedReward = progression.computeStageRunPayout(3) - progression.computeStageRunPayout(2);
  assert.equal(progression.recordStageRunClear(clearedThree, 3), expectedReward);
  assert.equal(progression.settleStageRunPoints(progressionRuntime, clearedThree), expectedReward);
  assert.equal(progression.settleStageRunPoints(progressionRuntime, clearedThree), 0, "Cannot settle twice");

  const metaBytes = await readFile(
    new URL("../../public/assets/chess-set.meta.json", import.meta.url),
    "utf8"
  );
  const meta = JSON.parse(metaBytes);

  console.log("Running gameplay regression checks...");

  // -------------------------------------------------------------------------
  // 1. Real Rapier promotion / reset check
  // -------------------------------------------------------------------------
  {
    const world = await physics.createPhysicsRuntime(
      meta,
      layout.PIECE_INSTANCES,
      meta.cellSize * 4,
    );
    try {
      const pawnBinding = [...world.pieces.values()].find(
        (b) => b.instance.type === "Pawn" && b.instance.side === "white"
      );
      assert.ok(pawnBinding, "White pawn binding must exist");
      const pawnId = pawnBinding.instance.id;

      // Find the corresponding item in the shared PIECE_INSTANCES array
      const initialPawn = layout.PIECE_INSTANCES.find((i) => i.id === pawnId);
      assert.ok(initialPawn, "Initial pawn must exist in PIECE_INSTANCES");
      assert.equal(initialPawn.type, "Pawn");

      // Promote the piece body to Queen
      physics.promotePieceBody(world, pawnId, "Queen", meta);

      // Verify world's piece binding is Queen
      const promotedBinding = world.pieces.get(pawnId);
      assert.ok(promotedBinding, "Promoted piece binding must exist");
      assert.equal(promotedBinding.instance.type, "Queen");

      // Crucial: verify shared PIECE_INSTANCES was NOT mutated
      assert.equal(
        initialPawn.type,
        "Pawn",
        "Promotion must not mutate shared PIECE_INSTANCES object"
      );
      assert.notEqual(
        promotedBinding.instance,
        initialPawn,
        "Promoted piece should have a cloned instance object"
      );

      // Reset world pieces using PIECE_INSTANCES
      physics.resetPhysicsPieces(world, meta, layout.PIECE_INSTANCES);
      const resetBinding = world.pieces.get(pawnId);
      assert.ok(resetBinding, "Reset pawn binding must exist");
      assert.equal(
        resetBinding.instance.type,
        "Pawn",
        "Reset physics pieces must respawn Pawn at original pawn position"
      );

      console.log("✓ PASS: Real Rapier promotion/reset preserves shared layout");
    } finally {
      world.world.free();
    }
  }

  // -------------------------------------------------------------------------
  // 2. Stage selected=3 callback and rollback check
  // -------------------------------------------------------------------------
  {
    // 2a. Validation before mutation
    let callbackExecuted = false;
    const testRuntime = gameMode.createGameModeRuntime(async () => {
      callbackExecuted = true;
    });

    await assert.rejects(
      () => gameMode.switchGameMode(testRuntime, "stage", true, 0),
      /1 이상의 정수/
    );
    await assert.rejects(
      () => gameMode.switchGameMode(testRuntime, "stage", true, -2),
      /1 이상의 정수/
    );
    await assert.rejects(
      () => gameMode.switchGameMode(testRuntime, "stage", true, 1.5),
      /1 이상의 정수/
    );
    assert.equal(callbackExecuted, false, "Callback must not run on invalid stage");
    assert.equal(testRuntime.stageNumber, 1, "stageNumber must not mutate on error");
    assert.equal(testRuntime.switching, false, "switching must remain false");

    // 2b. Normal switch observes requested stage in onModeChanged callback
    let observedStage = null;
    const runtime = gameMode.createGameModeRuntime(async (mode) => {
      assert.equal(mode, "stage");
      observedStage = runtime.stageNumber;
    });

    await gameMode.switchGameMode(runtime, "stage", true, 3);
    assert.equal(observedStage, 3, "onModeChanged must observe stageNumber 3");
    assert.equal(runtime.stageNumber, 3, "Runtime stageNumber must be 3");
    assert.equal(runtime.mode, "stage", "Runtime mode must be stage");
    assert.equal(runtime.switching, false, "Runtime switching flag must reset to false");

    // 2c. Rollback preserves previous state when onModeChanged throws
    let failureObservedStage = null;
    const failingRuntime = gameMode.createGameModeRuntime(async (mode) => {
      failureObservedStage = failingRuntime.stageNumber;
      throw new Error("Simulated board recreation failure");
    });
    // Set initial known state: stage 2 in stage mode
    failingRuntime.mode = "stage";
    failingRuntime.stageNumber = 2;

    await assert.rejects(
      () => gameMode.switchGameMode(failingRuntime, "stage", true, 5),
      /Simulated board recreation failure/
    );
    assert.equal(failureObservedStage, 5, "Callback observed requested stage 5 before failure");
    assert.equal(failingRuntime.stageNumber, 2, "Rollback must restore previous stageNumber");
    assert.equal(failingRuntime.mode, "stage", "Rollback must restore previous mode");
    assert.equal(failingRuntime.switching, false, "Switching must reset after rollback");

    console.log("✓ PASS: switchGameMode stage=3 observation and rollback validated");
  }

  // -------------------------------------------------------------------------
  // 3. Online special/promotion blocked via shared rules
  // -------------------------------------------------------------------------
  {
    const world = await physics.createPhysicsRuntime(
      meta,
      layout.PIECE_INSTANCES,
      meta.cellSize * 4,
      { gameMode: "online", stageNumber: 1 }
    );
    try {
      const sceneRuntime = {
        scene: new Scene(),
        pieceMeshes: new Map(),
        camera: new PerspectiveCamera(),
        controls: { enabled: true },
      };
      for (const binding of world.pieces.values()) {
        const mesh = new Mesh();
        mesh.name = binding.instance.id;
        sceneRuntime.scene.add(mesh);
        sceneRuntime.pieceMeshes.set(binding.instance.id, mesh);
      }

      const turnRuntime = turn.createTurnRuntime(
        world,
        sceneRuntime,
        tuning.createDefaultRuntimeTuningSettings()
      );
      turn.setTurnGameMode(turnRuntime, "online");
      assert.equal(turnRuntime.gameMode, "online");

      // 3a. King swap blocked in online mode
      const swapResult = turn.executeKingSwap(
        turnRuntime,
        "white-king-e1",
        "white-pawn-e2"
      );
      assert.equal(swapResult, false, "executeKingSwap must return false in online mode");
      assert.equal(turnRuntime.kingSpecialUsed.white, false);
      assert.equal(turnRuntime.kingSwapUsed.white, false);

      // 3b. King defense blocked in online mode
      const defenseResult = turn.executeKingDefense(turnRuntime, "white-king-e1");
      assert.equal(defenseResult, false, "executeKingDefense must return false in online mode");
      assert.equal(turnRuntime.kingSpecialUsed.white, false);
      assert.equal(turnRuntime.kingDefenseActive.white, false);
      const kingBinding = world.pieces.get("white-king-e1");
      assert.equal(
        kingBinding.body.isFixed(),
        false,
        "King body must remain dynamic when defense is blocked"
      );

      // 3c. Promotion blocked in online mode & no orphan promotion phase
      turnRuntime.phase = "ready";
      turnRuntime.pendingPromotionPawns.set("white-pawn-e2", {
        reachedTurn: 0,
        side: "white",
      });
      turnRuntime.turnNumber = 4;

      let promotionModalOpened = false;
      turnRuntime.onPromotionReady = () => {
        promotionModalOpened = true;
      };

      turn.checkAndTriggerPromotion(turnRuntime);
      assert.equal(promotionModalOpened, false, "Promotion modal must not open in online mode");
      assert.equal(turnRuntime.phase, "ready", "Turn phase must remain ready in online mode");
      assert.equal(turnRuntime.promotionQueue.length, 0, "Promotion queue must remain empty");
      assert.equal(turnRuntime.pendingPromotionPawns.size, 0, "Pending promotion pawns must be cleared");

      console.log("✓ PASS: Online king swap, defense, and promotion blocked via shared rules");
    } finally {
      world.world.free();
    }
  }

  // -------------------------------------------------------------------------
  // 4. Offline behavior maintained
  // -------------------------------------------------------------------------
  {
    const world = await physics.createPhysicsRuntime(
      meta,
      layout.PIECE_INSTANCES,
      meta.cellSize * 4,
      { gameMode: "hotseat", stageNumber: 1 }
    );
    try {
      const sceneRuntime = {
        scene: new Scene(),
        pieceMeshes: new Map(),
        camera: new PerspectiveCamera(),
        controls: { enabled: true },
      };
      for (const binding of world.pieces.values()) {
        const mesh = new Mesh();
        mesh.name = binding.instance.id;
        sceneRuntime.scene.add(mesh);
        sceneRuntime.pieceMeshes.set(binding.instance.id, mesh);
      }

      const turnRuntime = turn.createTurnRuntime(
        world,
        sceneRuntime,
        tuning.createDefaultRuntimeTuningSettings()
      );
      assert.equal(turnRuntime.gameMode, "hotseat");

      // 4a. Offline King defense works
      const defenseResult = turn.executeKingDefense(turnRuntime, "white-king-e1");
      assert.equal(defenseResult, true, "executeKingDefense must succeed in hotseat mode");
      assert.equal(turnRuntime.kingSpecialUsed.white, true);
      assert.equal(turnRuntime.kingDefenseActive.white, true);
      const kingBinding = world.pieces.get("white-king-e1");
      assert.equal(kingBinding.body.isFixed(), true, "King body must be fixed upon defense");

      // Reset turn runtime for swap test
      turn.resetTurnRuntime(turnRuntime);
      kingBinding.body.setBodyType(0, true); // Dynamic
      assert.equal(turnRuntime.kingSpecialUsed.white, false);

      // 4b. Offline King swap works
      const swapResult = turn.executeKingSwap(
        turnRuntime,
        "white-king-e1",
        "white-pawn-e2"
      );
      assert.equal(swapResult, true, "executeKingSwap must succeed in hotseat mode");
      assert.equal(turnRuntime.kingSpecialUsed.white, true);
      assert.equal(turnRuntime.kingSwapUsed.white, true);

      // 4c. Offline Promotion works
      turn.resetTurnRuntime(turnRuntime);
      turnRuntime.phase = "ready";
      turnRuntime.pendingPromotionPawns.set("white-pawn-e2", {
        reachedTurn: 0,
        side: "white",
      });
      turnRuntime.turnNumber = 4;

      let promotedTo = null;
      turnRuntime.onPromotionReady = (pieceId, side, choices, callback) => {
        assert.equal(turnRuntime.phase, "promotion");
        assert.equal(sceneRuntime.controls.enabled, false);
        callback("Queen");
      };
      turnRuntime.onPiecePromoted = (pieceId, newType) => {
        promotedTo = newType;
      };

      turn.checkAndTriggerPromotion(turnRuntime);
      assert.equal(promotedTo, "Queen", "onPiecePromoted must be called with Queen");
      assert.equal(turnRuntime.phase, "ready", "Turn phase must return to ready after promotion");
      assert.equal(sceneRuntime.controls.enabled, true, "Controls must be re-enabled");

      // 4d. Offline Promotion with null callback recovers safely without orphan promotion phase
      turn.resetTurnRuntime(turnRuntime);
      turnRuntime.phase = "ready";
      turnRuntime.pendingPromotionPawns.set("white-pawn-d2", {
        reachedTurn: 0,
        side: "white",
      });
      turnRuntime.turnNumber = 4;
      turnRuntime.onPromotionReady = null;

      turn.checkAndTriggerPromotion(turnRuntime);
      assert.equal(
        turnRuntime.phase,
        "ready",
        "Orphan promotion phase avoided when onPromotionReady is null"
      );
      assert.equal(sceneRuntime.controls.enabled, true);

      console.log("✓ PASS: Offline gameplay behaviors maintained");
    } finally {
      world.world.free();
    }
  }

  console.log("\nALL GAMEPLAY REGRESSION CHECKS PASSED SUCCESSFULLY!");
} finally {
  await vite.close();
}
