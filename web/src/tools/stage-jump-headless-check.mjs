import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const webRoot = fileURLToPath(new URL("../..", import.meta.url));
const vite = await createServer({
  root: webRoot,
  configFile: false,
  logLevel: "error",
  appType: "custom",
  server: { middlewareMode: true },
});

/**
 * 조건이 거짓이면 스테이지 이동의 실제 측정값을 포함해 즉시 중단한다.
 */
function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * 런 상태 객체를 카드 조절판의 전후 비교 서명으로 변환한다.
 */
function readJumpSnapshot(state) {
  return {
    gameMode: state.gameMode,
    stageNumber: state.stageNumber,
    runCardsSignature: JSON.stringify(state.runCards),
    permanentUpgradesSignature: JSON.stringify(
      state.permanentUpgrades,
    ),
    points: state.points,
    stageRunPointsSignature: JSON.stringify(state.stageRunPoints),
  };
}

try {
  const [cardTuning, cards, layout, physics, stage] =
    await Promise.all([
      vite.ssrLoadModule("/src/card-tuning.ts"),
      vite.ssrLoadModule("/src/cards.ts"),
      vite.ssrLoadModule("/src/layout.ts"),
      vite.ssrLoadModule("/src/physics.ts"),
      vite.ssrLoadModule("/src/stage.ts"),
    ]);
  const meta = JSON.parse(
    await readFile(
      new URL(
        "../../public/assets/chess-set.meta.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const runCards = cards.createRunCardState();
  cards.applyCardPick(runCards, "force");
  cards.applyCardPick(runCards, "weight");
  const state = {
    gameMode: "stage",
    stageNumber: 2,
    runCards,
    permanentUpgrades: {
      marker: "영구 강화 보존 검사용",
      Pawn: { force: 2, weight: 1 },
    },
    points: 4321,
    stageRunPoints: { lastClearedStage: 2 },
  };
  const initialPreservedState = {
    runCards: JSON.stringify(state.runCards),
    permanentUpgrades: JSON.stringify(state.permanentUpgrades),
    points: state.points,
    stageRunPoints: JSON.stringify(state.stageRunPoints),
  };
  const expectedMaps = new Map([
    [
      3,
      {
        walls: 32,
        wallVariant: "breakable",
        holes: 0,
        cylinders: 0,
      },
    ],
    [
      5,
      {
        walls: 32,
        wallVariant: "breakable",
        holes: 1,
        cylinders: 0,
      },
    ],
    [
      7,
      {
        walls: 4,
        wallVariant: "indestructible",
        holes: 0,
        cylinders: 0,
      },
    ],
    [
      9,
      {
        walls: 0,
        wallVariant: null,
        holes: 0,
        cylinders: 6,
      },
    ],
  ]);
  const measurements = [];
  for (const [targetStage, expectedMap] of expectedMaps) {
    await cardTuning.jumpCardTuningStage(
      targetStage,
      () => readJumpSnapshot(state),
      (stageNumber) => {
        state.stageNumber = stageNumber;
      },
      async (gameMode, stageNumber) => {
        const options = {
          gameMode,
          stageNumber,
          runCards: state.runCards,
        };
        const runtime = await physics.createPhysicsRuntime(
          meta,
          layout.PIECE_INSTANCES,
          stage.computeStageBoardHalfExtent(
            meta.cellSize,
            gameMode,
            stageNumber,
          ),
          options,
        );
        const wallVariants = [
          ...new Set(
            [...runtime.breakableWalls.values()].map(
              (binding) => binding.definition.variant,
            ),
          ),
        ];
        const buffs = stage.computeStageBuffs(stageNumber);
        const enemySteps = stage.computeEnemyStageStepValues();
        const blackRook =
          runtime.pieces.get("black-rook-a8");
        const blackPawn =
          runtime.pieces.get("black-pawn-a7");
        assertCondition(
          blackRook !== undefined && blackPawn !== undefined,
          `스테이지 ${stageNumber}의 흑 룩 또는 폰이 없습니다.`,
        );
        const expectedWeightFraction =
          enemySteps.weightStep * buffs.weightSteps;
        const actualWeightFraction =
          blackRook.upgradeAdditionalMass /
          blackRook.originalHullMass;
        const expectedRookScale = stage.computeStagePieceScale(
          blackRook.instance,
          meta,
          options,
        );
        const expectedPawnScale = stage.computeStagePieceScale(
          blackPawn.instance,
          meta,
          options,
        );
        assertCondition(
          runtime.breakableWalls.size === expectedMap.walls &&
            runtime.boardHoleRectangles.length ===
              expectedMap.holes &&
            runtime.pinballObstacles.size ===
              expectedMap.cylinders &&
            (expectedMap.wallVariant === null
              ? wallVariants.length === 0
              : wallVariants.length === 1 &&
                wallVariants[0] ===
                  expectedMap.wallVariant),
          `스테이지 ${stageNumber} 맵이 다릅니다: walls=${runtime.breakableWalls.size}/${wallVariants.join(",")}, holes=${runtime.boardHoleRectangles.length}, cylinders=${runtime.pinballObstacles.size}`,
        );
        assertCondition(
          Math.abs(
            actualWeightFraction - expectedWeightFraction,
          ) < 1e-9 &&
            Math.abs(
              blackRook.uniformScale - expectedRookScale,
            ) < 1e-12 &&
            Math.abs(
              blackPawn.uniformScale - expectedPawnScale,
            ) < 1e-12,
          `스테이지 ${stageNumber} 흑 버프가 다릅니다: weight=${actualWeightFraction}/${expectedWeightFraction}, rookScale=${blackRook.uniformScale}/${expectedRookScale}, pawnScale=${blackPawn.uniformScale}/${expectedPawnScale}`,
        );
        measurements.push({
          stageNumber,
          walls: runtime.breakableWalls.size,
          wallVariant: wallVariants[0] ?? "none",
          holes: runtime.boardHoleRectangles.length,
          cylinders: runtime.pinballObstacles.size,
          weightSteps: buffs.weightSteps,
          forceSteps: buffs.forceSteps,
          sizeSteps: buffs.sizeSteps,
          pawnTier: buffs.pawnTier,
          weightFraction: actualWeightFraction,
          rookScale: blackRook.uniformScale,
          pawnScale: blackPawn.uniformScale,
        });
      },
    );
    assertCondition(
      state.stageNumber === targetStage &&
        JSON.stringify(state.runCards) ===
          initialPreservedState.runCards &&
        JSON.stringify(state.permanentUpgrades) ===
          initialPreservedState.permanentUpgrades &&
        state.points === initialPreservedState.points &&
        JSON.stringify(state.stageRunPoints) ===
          initialPreservedState.stageRunPoints,
      `스테이지 ${targetStage} 이동 뒤 단계 이외 상태가 바뀌었습니다: ${JSON.stringify(state)}`,
    );
  }
  console.log(
    `[통과 a] 실제 맵·흑 버프 이동: ${measurements.map((entry) => `S${entry.stageNumber}=wall${entry.walls}/${entry.wallVariant},hole${entry.holes},pin${entry.cylinders},steps${entry.weightSteps}/${entry.forceSteps}/${entry.sizeSteps},tier=${entry.pawnTier},weight=${entry.weightFraction.toFixed(3)},scale=${entry.rookScale.toFixed(3)}/${entry.pawnScale.toFixed(3)}`).join(" | ")}`,
  );
  console.log(
    `[통과 b] 이동 전후 런 카드·영구 강화·포인트·임시 정산 보존: cards=${initialPreservedState.runCards}, points=${state.points}, provisional=${initialPreservedState.stageRunPoints}`,
  );

  let rejectedCount = 0;
  let resetCount = 0;
  for (const gameMode of ["hotseat", "online"]) {
    state.gameMode = gameMode;
    try {
      await cardTuning.jumpCardTuningStage(
        3,
        () => readJumpSnapshot(state),
        (stageNumber) => {
          state.stageNumber = stageNumber;
        },
        async () => {
          resetCount += 1;
        },
      );
    } catch (error) {
      assertCondition(
        error instanceof Error &&
          error.message ===
            "스테이지 이동은 스테이지 모드 전용입니다.",
        `${gameMode} 거부 사유가 다릅니다: ${String(error)}`,
      );
      rejectedCount += 1;
    }
  }
  assertCondition(
    rejectedCount === 2 && resetCount === 0,
    `스테이지 외 모드 차단이 다릅니다: rejected=${rejectedCount}, reset=${resetCount}`,
  );
  console.log(
    `[통과 c] 스테이지 외 모드 거부: hotseat/online=${rejectedCount}/2, reset=${resetCount}`,
  );
} catch (error) {
  const fullError =
    error instanceof Error
      ? (error.stack ?? error.message)
      : String(error);
  console.error(fullError);
  process.exitCode = 1;
} finally {
  await vite.close();
}
