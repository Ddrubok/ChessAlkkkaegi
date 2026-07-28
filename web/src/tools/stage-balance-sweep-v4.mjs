import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import {
  SKILL_PROFILES,
  decideAggressiveWhiteShot,
  loadPieceGeometries,
  simulateAll,
  stripWallTimes,
  validateAggressiveDecisionModel,
} from "./stage-balance-sweep-v3.mjs";

const webRoot = fileURLToPath(new URL("../..", import.meta.url));
const resultJsonUrl = new URL(
  "../../../../stage-balance-results-v4.json",
  import.meta.url,
);
const savedResultJsonUrl = new URL(
  "./stage-balance-results-v4.json",
  import.meta.url,
);
const baselineJsonUrl = new URL(
  "./stage-balance-baseline-v4.json",
  import.meta.url,
);
const resultMarkdownUrl = new URL(
  "./stage-balance-results-v4.md",
  import.meta.url,
);
const temporaryMarkdownUrl = new URL(
  "../../../../stage-balance-results-v4.md",
  import.meta.url,
);
const r35ResultJsonUrl = new URL(
  "./stage-balance-results-v2.json",
  import.meta.url,
);

const DEFAULT_RUNS = 12;
const DEFAULT_MAX_STAGE = 30;
const PLAYER_POWER_MINIMUM = 0.35;
const PLAYER_POWER_MAXIMUM = 0.85;
const TARGET_MEDIAN_MINIMUM = 4.5;
const TARGET_MEDIAN_MAXIMUM = 6;
const TARGET_STAGE_ONE_WIN_RATE = 0.75;
// 12회 표본에서 두 경기까지의 역상승은 후반 소표본 잡음으로 허용한다.
const MONOTONIC_NOISE_TOLERANCE = 2 / 12;
const AI_JITTER_VALUES = [5, 9, 13];
const AI_POWER_MAXIMUMS = [1, 0.8];
const BUFF_STEP_SCALES = [1, 0.5, 0.33];
const CARD_EFFECT_SCALES = [1, 2];
// 기본 격자의 최근접 후반 곡선에서 AI 기본 강도만 한 단계 더 낮춘 6개 보정 조합이다.
const REFINEMENT_DIFFICULTIES = [
  [13, 0.6, 0.33, 1],
  [13, 0.6, 0.33, 2],
  [17, 0.8, 0.33, 1],
  [17, 0.8, 0.33, 2],
  [17, 0.6, 0.33, 1],
  [17, 0.6, 0.33, 2],
].map(
  ([
    aiJitterDegrees,
    aiPowerMaximum,
    buffStepScale,
    cardEffectScale,
  ]) => ({
    id: `ref-j${aiJitterDegrees}-p${aiPowerMaximum}-b${buffStepScale}-c${cardEffectScale}`,
    aiJitterDegrees,
    aiPowerMaximum,
    buffStepScale,
    cardEffectScale,
    playerPowerMinimum: PLAYER_POWER_MINIMUM,
    playerPowerMaximum: PLAYER_POWER_MAXIMUM,
    useRuntimeDefaults: false,
  }),
);

// 첫 스윕이 34번째 조합의 스폰 실패로 멈추기 전 출력한 33개 결정적 run 결과다.
const RECOVERED_SWEEP_RUNS = [
  ["j5-p1-b1-c1", "L1,L4,L1,L1,L1,D1,L3,L2", 5.714],
  ["j5-p1-b1-c2", "L1,L3,L1,L1,L1,D1,L2,L3", 5.923],
  ["j5-p1-b0.5-c1", "L1,L4,L1,L1,L1,D1,L2,L3", 6.429],
  ["j5-p1-b0.5-c2", "L1,L2,L1,L1,L1,D1,L3,L4", 5.929],
  ["j5-p1-b0.33-c1", "L1,L3,L1,L1,L1,D1,D3,L2", 5.769],
  ["j5-p1-b0.33-c2", "L1,L5,L1,L1,L1,D1,L5,L2", 6.353],
  ["j5-p0.8-b1-c1", "L1,L5,L1,L1,L1,D1,L3,L2", 5.933],
  ["j5-p0.8-b1-c2", "L1,L3,L1,L1,L1,D1,L2,L3", 5.923],
  ["j5-p0.8-b0.5-c1", "L1,L4,L1,L1,L1,D1,L2,L3", 6.429],
  ["j5-p0.8-b0.5-c2", "L1,L2,L1,L1,L1,D1,L3,L4", 5.571],
  ["j5-p0.8-b0.33-c1", "L1,L3,L1,L1,L1,D1,D3,L2", 5.769],
  ["j5-p0.8-b0.33-c2", "L1,L2,L1,L1,L1,D1,L5,L2", 6.214],
  ["j9-p1-b1-c1", "L3,L1,L1,L1,L5,L2,L1,L2", 5.438],
  ["j9-p1-b1-c2", "L3,L1,L1,L1,L4,L2,L1,L2", 5.8],
  ["j9-p1-b0.5-c1", "L2,L1,L1,L1,L3,L2,L1,L2", 5.308],
  ["j9-p1-b0.5-c2", "L2,L1,L1,L1,L5,L3,L1,L2", 5.5],
  ["j9-p1-b0.33-c1", "L2,L1,L1,L1,L4,L3,L1,L2", 5.467],
  ["j9-p1-b0.33-c2", "L4,L1,L1,L1,L3,L3,L1,L4", 5.5],
  ["j9-p0.8-b1-c1", "L3,L2,L1,L1,L5,L2,L1,L3", 5.222],
  ["j9-p0.8-b1-c2", "L3,L2,L1,L1,L4,L2,L1,L3", 6.176],
  ["j9-p0.8-b0.5-c1", "L2,L3,L1,L1,L3,L2,L1,L5", 5.667],
  ["j9-p0.8-b0.5-c2", "L2,L3,L1,L1,L5,L2,L1,L2", 6],
  ["j9-p0.8-b0.33-c1", "L2,L2,L1,L1,L4,L2,L1,L3", 4.625],
  ["j9-p0.8-b0.33-c2", "L3,L3,L1,L1,L3,L2,L1,L3", 4.882],
  ["j13-p1-b1-c1", "L6,L2,L2,L2,L2,D1,L1,L1", 5],
  ["j13-p1-b1-c2", "L2,L2,L2,L2,L2,D1,L1,L1", 5.385],
  ["j13-p1-b0.5-c1", "L2,L2,L2,L2,L3,D1,L1,L1", 5],
  ["j13-p1-b0.5-c2", "L2,L4,L3,L5,L3,D1,L1,L1", 5],
  ["j13-p1-b0.33-c1", "L7,L3,L5,L4,L5,D1,L1,L1", 5.222],
  ["j13-p1-b0.33-c2", "L4,L4,L4,L3,L2,D1,L1,L1", 5.85],
  ["j13-p0.8-b1-c1", "L6,L2,L2,L2,L2,D1,L1,L1", 5.059],
  ["j13-p0.8-b1-c2", "L2,L2,L2,L2,L2,D1,L1,L1", 5.462],
  ["j13-p0.8-b0.5-c1", "L2,L2,L2,L2,L6,D1,L1,L1", 4.588],
];

/** R37 백 모델의 표적과 0.35–0.85 세기 클램프를 순수 값으로 검증한다. */
function validateV3PlayerModel() {
  const board = [
    { id: "white-aligned", side: "white", x: 0, z: 0 },
    { id: "white-other", side: "white", x: 1, z: 1 },
    { id: "black-edge", side: "black", x: 3.8, z: 0 },
    { id: "black-center", side: "black", x: 0, z: 0.5 },
  ];
  const first = decideAggressiveWhiteShot(
    board,
    4,
    0.5,
    PLAYER_POWER_MINIMUM,
    PLAYER_POWER_MAXIMUM,
  );
  const second = decideAggressiveWhiteShot(
    board,
    4,
    0.5,
    PLAYER_POWER_MINIMUM,
    PLAYER_POWER_MAXIMUM,
  );
  const nearPower = decideAggressiveWhiteShot(
    [
      { id: "white", side: "white", x: 0, z: 0 },
      { id: "black", side: "black", x: 1e-6, z: 0 },
    ],
    4,
    0.5,
    PLAYER_POWER_MINIMUM,
    PLAYER_POWER_MAXIMUM,
  )?.power;
  const farPower = decideAggressiveWhiteShot(
    [
      { id: "white", side: "white", x: -100, z: 0 },
      { id: "black", side: "black", x: 3.9, z: 0 },
    ],
    4,
    0.5,
    PLAYER_POWER_MINIMUM,
    PLAYER_POWER_MAXIMUM,
  )?.power;
  if (
    JSON.stringify(first) !== JSON.stringify(second) ||
    first?.targetPieceId !== "black-edge" ||
    first.pieceId !== "white-aligned" ||
    first.nearestEdge !== "xMax" ||
    Math.abs(nearPower - 0.35000025) > 1e-12 ||
    farPower !== 0.85
  ) {
    throw new Error(
      `v3 백 모델 자체 검증 실패: first=${JSON.stringify(first)}, near=${nearPower}, far=${farPower}`,
    );
  }
  console.log(
    `[v3 백 모델 통과] target=${first.targetPieceId}, shooter=${first.pieceId}, nearPower=${nearPower}, farPower=${farPower}`,
  );
}

/** 명령행의 양의 정수 옵션을 읽는다. */
function readPositiveIntegerArgument(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) {
    return fallback;
  }
  const value = Number(process.argv[index + 1]);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} 값이 1 이상의 정수가 아닙니다.`);
  }
  return value;
}

/** R37의 36개 기본 조합을 고정 순서로 만든다. */
function createSweepDifficulties() {
  return AI_JITTER_VALUES.flatMap((aiJitterDegrees) =>
    AI_POWER_MAXIMUMS.flatMap((aiPowerMaximum) =>
      BUFF_STEP_SCALES.flatMap((buffStepScale) =>
        CARD_EFFECT_SCALES.map((cardEffectScale) => ({
          id: `j${aiJitterDegrees}-p${aiPowerMaximum}-b${buffStepScale}-c${cardEffectScale}`,
          aiJitterDegrees,
          aiPowerMaximum,
          buffStepScale,
          cardEffectScale,
          playerPowerMinimum: PLAYER_POWER_MINIMUM,
          playerPowerMaximum: PLAYER_POWER_MAXIMUM,
          useRuntimeDefaults: false,
        })),
      ),
    ),
  );
}

/** 숫자 배열의 중앙값을 반환한다. */
function computeMedian(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

/** 숫자 배열의 모든 최빈값을 반환한다. */
function computeModes(values) {
  const counts = new Map();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const maximum = Math.max(...counts.values());
  return [...counts]
    .filter(([, count]) => count === maximum)
    .map(([value]) => value)
    .sort((left, right) => left - right);
}

/** 중단 전 콘솔에 확정 출력된 run들을 일반 스윕 요약 구조로 복구한다. */
function createRecoveredSweepRows(runsPerCombo) {
  const difficulties = new Map(
    createSweepDifficulties().map((difficulty) => [
      difficulty.id,
      difficulty,
    ]),
  );
  return RECOVERED_SWEEP_RUNS.map(
    ([id, encodedRuns, averageWhiteSelfOutsPerMatch]) => {
      const outcomes = encodedRuns.split(",").map((token) => ({
        winner: token[0] === "L" ? "black" : "draw-timeout",
        finalStage: Number(token.slice(1)),
      }));
      const lossStages = outcomes
        .filter((outcome) => outcome.winner === "black")
        .map((outcome) => outcome.finalStage);
      const maximumStage = Math.max(
        ...outcomes.map((outcome) => outcome.finalStage),
      );
      const byStage = [];
      for (let stage = 1; stage <= maximumStage; stage += 1) {
        const attempts = outcomes.filter(
          (outcome) => outcome.finalStage >= stage,
        ).length;
        const wins = outcomes.filter(
          (outcome) => outcome.finalStage > stage,
        ).length;
        const losses = outcomes.filter(
          (outcome) =>
            outcome.finalStage === stage &&
            outcome.winner === "black",
        ).length;
        const draws = attempts - wins - losses;
        byStage.push({
          stage,
          attempts,
          wins,
          losses,
          draws,
          winRate: wins / attempts,
        });
      }
      let maximumPositiveBump = 0;
      for (let index = 1; index < byStage.length; index += 1) {
        maximumPositiveBump = Math.max(
          maximumPositiveBump,
          byStage[index].winRate -
            byStage[index - 1].winRate,
        );
      }
      const medianDeathStage = computeMedian(lossStages);
      const stageOneWinRate = byStage[0].winRate;
      const tolerance = 2 / runsPerCombo;
      const medianInTarget =
        medianDeathStage >= TARGET_MEDIAN_MINIMUM &&
        medianDeathStage <= TARGET_MEDIAN_MAXIMUM;
      const stageOnePass =
        stageOneWinRate >= TARGET_STAGE_ONE_WIN_RATE;
      const monotonicWithinNoise =
        maximumPositiveBump <= tolerance + Number.EPSILON;
      return {
        id,
        difficulty: difficulties.get(id),
        medianDeathStage,
        deathStageDistribution: {
          values: lossStages,
          median: medianDeathStage,
          modes: computeModes(lossStages),
          minimum: Math.min(...lossStages),
          maximum: Math.max(...lossStages),
        },
        stageOneWinRate,
        maximumPositiveBump,
        medianInTarget,
        stageOnePass,
        monotonicWithinNoise,
        qualifies:
          medianInTarget &&
          stageOnePass &&
          monotonicWithinNoise,
        drawTimeoutRuns: outcomes.filter(
          (outcome) => outcome.winner === "draw-timeout",
        ).length,
        stageCapRuns: 0,
        byStage,
        instrument: {
          profile: "normal",
          runCount: runsPerCombo,
          matchCount: outcomes.reduce(
            (sum, outcome) => sum + outcome.finalStage,
            0,
          ),
          averageWhiteSelfOutsPerMatch,
          recoveredFromConsole: true,
        },
        wallTimeMs: null,
      };
    },
  );
}

/** 한 프로필의 경기당 자멸과 평균 턴을 계산한다. */
function summarizeProfileInstrument(profile, runs) {
  const profileRuns = runs.filter(
    (run) => run.profile === profile,
  );
  const matches = profileRuns.flatMap((run) => run.matches);
  const sum = (selector) =>
    matches.reduce(
      (total, match) => total + selector(match),
      0,
    );
  return {
    profile,
    runCount: profileRuns.length,
    matchCount: matches.length,
    averageWhiteSelfOutsPerMatch:
      matches.length === 0
        ? null
        : sum((match) => match.selfOuts.white) /
          matches.length,
    averageBlackSelfOutsPerMatch:
      matches.length === 0
        ? null
        : sum((match) => match.selfOuts.black) /
          matches.length,
    averageTurnsPerMatch:
      matches.length === 0
        ? null
        : sum((match) => match.turns) / matches.length,
  };
}

/** R35 원시 결과의 비교 계측값을 보존한다. */
function summarizeR35(result) {
  return {
    profiles: SKILL_PROFILES.map((profile) => ({
      ...summarizeProfileInstrument(
        profile.id,
        result.runs,
      ),
      deathStageDistribution:
        result.aggregate.profiles.find(
          (candidate) =>
            candidate.profile === profile.id,
        ).deathStageDistribution,
    })),
  };
}

/** 한 스윕 조합의 선정 지표를 원시 실행에서 추린다. */
function summarizeSweep(difficulty, simulation, runsPerCombo) {
  const normal = simulation.aggregate.profiles[0];
  let maximumPositiveBump = 0;
  for (let index = 1; index < normal.byStage.length; index += 1) {
    maximumPositiveBump = Math.max(
      maximumPositiveBump,
      normal.byStage[index].winRate -
        normal.byStage[index - 1].winRate,
    );
  }
  const medianDeathStage =
    normal.deathStageDistribution.median;
  const stageOneWinRate =
    normal.byStage.find((row) => row.stage === 1)
      ?.winRate ?? 0;
  const tolerance =
    runsPerCombo === 12
      ? MONOTONIC_NOISE_TOLERANCE
      : 2 / runsPerCombo;
  const medianInTarget =
    medianDeathStage !== null &&
    medianDeathStage >= TARGET_MEDIAN_MINIMUM &&
    medianDeathStage <= TARGET_MEDIAN_MAXIMUM;
  const stageOnePass =
    stageOneWinRate >= TARGET_STAGE_ONE_WIN_RATE;
  const monotonicWithinNoise =
    maximumPositiveBump <= tolerance + Number.EPSILON;
  return {
    id: difficulty.id,
    difficulty,
    medianDeathStage,
    deathStageDistribution:
      normal.deathStageDistribution,
    stageOneWinRate,
    maximumPositiveBump,
    medianInTarget,
    stageOnePass,
    monotonicWithinNoise,
    qualifies:
      medianInTarget &&
      stageOnePass &&
      monotonicWithinNoise,
    drawTimeoutRuns: normal.drawTimeoutRuns,
    stageCapRuns: normal.stageCapRuns,
    byStage: normal.byStage,
    instrument: summarizeProfileInstrument(
      "normal",
      simulation.runs,
    ),
    wallTimeMs: simulation.totalWallTimeMs,
  };
}

/** 목표에서 벗어난 정도를 최근접 정렬 점수로 바꾼다. */
function computePenalty(row, runsPerCombo) {
  const median = row.medianDeathStage ?? 0;
  const medianDistance =
    median < TARGET_MEDIAN_MINIMUM
      ? TARGET_MEDIAN_MINIMUM - median
      : median > TARGET_MEDIAN_MAXIMUM
        ? median - TARGET_MEDIAN_MAXIMUM
        : 0;
  const tolerance = 2 / runsPerCombo;
  return (
    medianDistance * 10 +
    Math.max(
      0,
      TARGET_STAGE_ONE_WIN_RATE - row.stageOneWinRate,
    ) *
      10 +
    Math.max(
      0,
      row.maximumPositiveBump - tolerance,
    ) *
      5
  );
}

/** 합격 조합 중 목표 중앙에 가장 가까운 것을 고른다. */
function selectWinner(rows) {
  const center =
    (TARGET_MEDIAN_MINIMUM + TARGET_MEDIAN_MAXIMUM) / 2;
  return (
    rows
      .filter((row) => row.qualifies)
      .sort(
        (left, right) =>
          Math.abs(left.medianDeathStage - center) -
            Math.abs(right.medianDeathStage - center) ||
          left.maximumPositiveBump -
            right.maximumPositiveBump ||
          right.stageOneWinRate - left.stageOneWinRate ||
          left.id.localeCompare(right.id),
      )[0] ?? null
  );
}

/** Vite를 통해 실제 게임 모듈과 GLB 기반 기하를 준비한다. */
async function loadRuntime() {
  const vite = await createServer({
    root: webRoot,
    // 헤드리스 모듈 로드는 Pages base·빌드 입력 설정이 필요 없어 임시 설정 파일 생성을 피한다.
    configFile: false,
    logLevel: "error",
    appType: "custom",
    server: { middlewareMode: true },
  });
  const [
    ai,
    aimparams,
    cards,
    config,
    layout,
    physics,
    stage,
    turn,
  ] = await Promise.all([
    vite.ssrLoadModule("/src/ai.ts"),
    vite.ssrLoadModule("/src/aimparams.ts"),
    vite.ssrLoadModule("/src/cards.ts"),
    vite.ssrLoadModule("/src/config.ts"),
    vite.ssrLoadModule("/src/layout.ts"),
    vite.ssrLoadModule("/src/physics.ts"),
    vite.ssrLoadModule("/src/stage.ts"),
    vite.ssrLoadModule("/src/turn.ts"),
  ]);
  const modules = {
    ai,
    aimparams,
    cards,
    config,
    layout,
    physics,
    stage,
    turn,
  };
  const meta = JSON.parse(
    await readFile(
      new URL(
        "../../public/assets/chess-set.meta.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const geometries = await loadPieceGeometries(
    config.PIECE_TYPES,
  );
  return { vite, modules, meta, geometries };
}

/** 현재 게임 상수와 v3 백 모델로 3프로필 기준선을 측정한다. */
async function runBaseline(
  modules,
  meta,
  geometries,
  runsPerProfile,
  maximumStage,
) {
  return simulateAll(
    modules,
    meta,
    geometries,
    SKILL_PROFILES,
    runsPerProfile,
    maximumStage,
    {
      id: "r37-v3-player-current-runtime",
      aiJitterDegrees:
        modules.config.AI_STAGE_DECISION_BANDS[0]
          .maximumAimErrorDegrees,
      aiPowerMaximum: modules.config.AI_BASE_POWER_MAX,
      buffStepScale:
        modules.config.ENEMY_STAGE_BUFF_SCALE,
      cardEffectScale:
        modules.config.CARD_EFFECT_SCALE,
      playerPowerMinimum: PLAYER_POWER_MINIMUM,
      playerPowerMaximum: PLAYER_POWER_MAXIMUM,
      useRuntimeDefaults: true,
    },
  );
}

/** 저장된 결과에서 wall time만 제외한 결정적 값을 비교한다. */
function assertDeterministic(expectedValue, actualValue, label) {
  const expected = JSON.stringify(
    stripWallTimes(expectedValue),
  );
  const actual = JSON.stringify(
    stripWallTimes(actualValue),
  );
  if (expected !== actual) {
    let index = 0;
    const limit = Math.min(expected.length, actual.length);
    while (
      index < limit &&
      expected[index] === actual[index]
    ) {
      index += 1;
    }
    throw new Error(
      `${label} 결정성 불일치 ${index}: expected=${expected.slice(index, index + 120)}, actual=${actual.slice(index, index + 120)}`,
    );
  }
  console.log(
    `[결정성 통과] ${label}: wallTimeMs 제외 ${actual.length}자 일치`,
  );
}

/** wall time과 복구 로그의 부가 계측을 제외한 선정 핵심값만 반환한다. */
function createSelectionSignature(row) {
  return {
    id: row.id,
    medianDeathStage: row.medianDeathStage,
    deathStageDistribution: row.deathStageDistribution,
    stageOneWinRate: row.stageOneWinRate,
    maximumPositiveBump: row.maximumPositiveBump,
    byStage: row.byStage.map((stage) => ({
      stage: stage.stage,
      attempts: stage.attempts,
      wins: stage.wins,
      losses: stage.losses,
      draws: stage.draws,
      winRate: stage.winRate,
    })),
  };
}

/** 42개 측정과 정지 근거를 한국어 최종 보고서로 만든다. */
function createMarkdownReport(result) {
  const baselineRows = result.baseline.aggregate.profiles.map(
    (profile) => {
      const instrument = result.baselineInstrument.find(
        (candidate) =>
          candidate.profile === profile.profile,
      );
      const previous = result.r35.profiles.find(
        (candidate) =>
          candidate.profile === profile.profile,
      );
      const stageOne = profile.byStage.find(
        (stage) => stage.stage === 1,
      );
      return `| ${profile.profileLabel} (±${profile.jitterDegrees}°) | ${profile.deathStageDistribution.median ?? "—"} | ${profile.deathStageDistribution.values.join(", ") || "—"} | ${stageOne.wins}/${stageOne.attempts} (${(stageOne.winRate * 100).toFixed(1)}%) | ${instrument.averageWhiteSelfOutsPerMatch.toFixed(3)} | ${previous.averageWhiteSelfOutsPerMatch.toFixed(3)} | ${instrument.averageTurnsPerMatch.toFixed(2)} |`;
    },
  );
  const sweepRows = result.sweep.map((row) => {
    if (row.invalid) {
      return `| ${row.id} | ${row.difficulty.aiJitterDegrees}° | ${row.difficulty.aiPowerMaximum.toFixed(2)} | ${row.difficulty.buffStepScale.toFixed(2)} | ${row.difficulty.cardEffectScale.toFixed(1)} | 무효 | — | — | 스폰 실패: ${row.error} |`;
    }
    const curve = row.byStage
      .map(
        (stage) =>
          `${stage.stage}:${stage.wins}/${stage.attempts}`,
      )
      .join(", ");
    return `| ${row.id} | ${row.difficulty.aiJitterDegrees}° | ${row.difficulty.aiPowerMaximum.toFixed(2)} | ${row.difficulty.buffStepScale.toFixed(2)} | ${row.difficulty.cardEffectScale.toFixed(1)} | ${row.medianDeathStage} | ${(row.stageOneWinRate * 100).toFixed(1)}% | ${row.instrument.averageWhiteSelfOutsPerMatch.toFixed(3)} | ${curve} |`;
  });
  const closestRows = result.closestThree.map(
    (row, index) =>
      `| ${index + 1} | ${row.id} | ${row.medianDeathStage} | ${(row.stageOneWinRate * 100).toFixed(1)}% | ${(row.maximumPositiveBump * 100).toFixed(1)}%p | ${row.instrument.averageWhiteSelfOutsPerMatch.toFixed(3)} | ${row.byStage.map((stage) => `${stage.stage}:${stage.wins}/${stage.attempts}`).join(", ")} |`,
  );
  const normalBaseline = result.baselineInstrument.find(
    (profile) => profile.profile === "normal",
  );
  const normalR35 = result.r35.profiles.find(
    (profile) => profile.profile === "normal",
  );
  const reduction =
    1 -
    normalBaseline.averageWhiteSelfOutsPerMatch /
      normalR35.averageWhiteSelfOutsPerMatch;
  return `# 스테이지 밸런스 자동 측정 v4 — 비자멸 백 모델과 카드 성장 배율

## 1. 결론

기본 36개와 보정 6개, 총 ${result.sweep.length}개 조합을 측정했지만 **보통 사망 중앙값 4.5–6.0, 1단계 승률 75% 이상, 하락 곡선**을 동시에 만족한 조합은 없었다. 지시된 정지 조건에 따라 런타임 난이도 상수를 강제로 적용하지 않았다.

기본 격자의 최고 중앙값은 4였으나 1단계 승률이 62.5%였다. 보정 오차 17° 조합은 1단계 승률을 100%로 올렸지만 중앙값이 2.5–3에 머물렀다.

## 2. v3 모델 자멸 수치와 기준선

백은 R35와 같은 가장자리 표적·정렬 사수를 쓰되 세기를 \`clamp(0.35 + 0.5 × 거리/(4×칸), 0.35, 0.85)\`로 낮췄다.

| 프로필 | v3 사망 중앙값 | 사망 단계 분포 | 1단계 승률 | v3 백 자멸/경기 | R35 백 자멸/경기 | v3 평균 턴 |
|---|---:|---|---:|---:|---:|---:|
${baselineRows.join("\n")}

보통의 백 자멸은 R35 ${normalR35.averageWhiteSelfOutsPerMatch.toFixed(3)}회/경기에서 v3 ${normalBaseline.averageWhiteSelfOutsPerMatch.toFixed(3)}회/경기로 ${(reduction * 100).toFixed(1)}% 감소했다. 감소는 확인됐지만 여전히 경기당 5개 이상이라 “잘 아래”까지 내려가지는 않았다.

## 3. 스윕 표

시간 예측이 35분을 넘겨 기준선은 프로필당 12회, 스윕은 조합당 8회로 실행했다. 곡선은 \`단계:승/시도\`다.

| 조합 | AI 오차 | AI 최대 파워 | 흑 버프 배율 | 카드 배율 | 사망 중앙값 | 1단계 승률 | 백 자멸/경기 | 단계별 승률 |
|---|---:|---:|---:|---:|---:|---:|---:|---|
${sweepRows.join("\n")}

\`j13-p0.8-b0.5-c2\`는 후반 카드·스테이지 조합에서 사전 정착 1200 step 후 31/32만 잠들어 무효 처리했다. 같은 seed 재실행에서도 동일하게 실패했다.

## 4. 최종 검증 또는 최근접 3안

합격 조합이 없어 새 상수의 3프로필 최종 검증은 실행하지 않았다. 최근접 3안은 다음과 같다.

| 순위 | 조합 | 중앙값 | 1단계 승률 | 최대 역상승 | 백 자멸/경기 | 단계별 승률 |
|---:|---|---:|---:|---:|---:|---|
${closestRows.join("\n")}

첫 두 안은 중앙값 4로 목표에 가장 가깝지만 1단계 승률 62.5%와 후반 소표본 역상승이 남는다. 세 번째 안은 1단계 100%와 완전 하락 곡선을 만들었지만 중앙값 3으로 목표보다 너무 이르다.

## 5. 코드 변경 요약

- \`src/config.ts\`: 카드 크기·중량·힘의 공통 기본 배율 \`CARD_EFFECT_SCALE=1\`을 추가했다. 합격 조합이 없어 값은 기존 동작과 같은 1이다.
- \`src/cards.ts\`: 카드 추첨 상한, 선택 상한, 플레이어 힘 계산에 선택적 카드 배율을 추가했다.
- \`src/stage.ts\`: 백 크기·중량 효과에 선택적 카드 배율을 합성했다.
- \`src/tools/stage-balance-sweep-v3.mjs\`: 기존 R36 직접 실행은 유지하면서 v4가 실제 스폰·물리·승자 엔진을 재사용할 수 있도록 함수 export와 선택적 백 파워·카드 배율 인자를 추가했다.
- \`src/tools/stage-balance-sweep-v4.mjs\`: v3 기준선, 36+6 조합, 자멸 계측, 오류 격리, 결정성 검증을 구현했다.
- 런타임 호출은 모든 새 인자를 생략하므로 기본 게임 동작은 바뀌지 않았다. 기존 회귀 기대값도 변경하지 않았다.

## 6. 명령·결정성

\`\`\`text
node src/tools/stage-balance-sweep-v4.mjs --baseline
node src/tools/stage-balance-sweep-v4.mjs --verify-baseline
node src/tools/stage-balance-sweep-v4.mjs --sweep --runs-per-combo 8
node src/tools/stage-balance-sweep-v4.mjs --resume --runs-per-combo 8
node src/tools/stage-balance-sweep-v4.mjs --refine --runs-per-combo 8
node src/tools/stage-balance-sweep-v4.mjs --verify-closest --runs-per-combo 8
npx tsc --noEmit
npm run build
\`\`\`

- 기준선 결정성: \`wallTimeMs\` 제외 34,444자 일치
- 최근접 3안 결정성: 핵심 선정 서명 각각 689자, 718자, 484자 일치
- 복구한 두 최근접 조합의 백 자멸 평균도 재실행과 0.0005 이내 일치
- \`Math.random\` 사용 없음

## 7. 한계

- 8회 스윕이라 후반 도달 수가 1–2경기로 줄며 승률 역상승이 크게 보일 수 있다.
- 새 백 모델도 보통 기준 5.5회/경기 자멸해 사람보다 여전히 공격적일 가능성이 높다.
- 한 카드 2배 조합은 특정 후반 상태에서 스폰 수면 실패가 발생했다. 해당 조합을 실제 설정으로 적용하려면 별도의 최대 성장 안전성 검증이 필요하다.
- 합격 조합이 없어 새 상수를 전제로 한 3프로필 결과와 브라우저 체감 검증은 없다.
`;
}

const mode = process.argv.find((argument) =>
  [
    "--baseline",
    "--sweep",
    "--resume",
    "--refine",
    "--verify-baseline",
    "--verify-sweep",
    "--verify-closest",
    "--report",
  ].includes(argument),
);
if (mode === undefined) {
  throw new Error(
    "--baseline, --sweep, --resume, --refine, --verify-baseline, --verify-sweep, --verify-closest, --report 중 하나를 지정해야 합니다.",
  );
}
const runsPerProfile = readPositiveIntegerArgument(
  "--runs-per-profile",
  DEFAULT_RUNS,
);
const runsPerCombo = readPositiveIntegerArgument(
  "--runs-per-combo",
  DEFAULT_RUNS,
);
const maximumStage = readPositiveIntegerArgument(
  "--max-stage",
  DEFAULT_MAX_STAGE,
);
if (mode === "--report") {
  const result = JSON.parse(
    await readFile(savedResultJsonUrl, "utf8"),
  );
  const markdown = createMarkdownReport(result);
  await writeFile(temporaryMarkdownUrl, markdown, "utf8");
  console.log(`[저장] ${fileURLToPath(temporaryMarkdownUrl)}`);
  process.exit(0);
}
const r35 = JSON.parse(
  await readFile(r35ResultJsonUrl, "utf8"),
);
const { vite, modules, meta, geometries } =
  await loadRuntime();
validateAggressiveDecisionModel();
validateV3PlayerModel();
const originalConsoleInfo = console.info;
console.info = () => {};
try {
  if (mode === "--baseline" || mode === "--verify-baseline") {
    const baseline = await runBaseline(
      modules,
      meta,
      geometries,
      runsPerProfile,
      maximumStage,
    );
    if (mode === "--verify-baseline") {
      const existing = JSON.parse(
        await readFile(baselineJsonUrl, "utf8"),
      );
      assertDeterministic(
        existing.baseline,
        baseline,
        "3프로필 기준선",
      );
    } else {
      const result = {
        schemaVersion: 4,
        status: "baseline-complete",
        configuration: {
          baselineRunsPerProfile: runsPerProfile,
          maximumStage,
          playerModel: {
            targeting: "r35-edge-aligned",
            minimumPower: PLAYER_POWER_MINIMUM,
            maximumPower: PLAYER_POWER_MAXIMUM,
            profileJitterDegrees: {
              accurate: 2,
              normal: 8,
              unskilled: 15,
            },
          },
        },
        r35: summarizeR35(r35),
        baseline,
        baselineInstrument: SKILL_PROFILES.map(
          (profile) =>
            summarizeProfileInstrument(
              profile.id,
              baseline.runs,
            ),
        ),
      };
      await writeFile(
        baselineJsonUrl,
        `${JSON.stringify(result, null, 2)}\n`,
        "utf8",
      );
      console.log(`[저장] ${fileURLToPath(baselineJsonUrl)}`);
    }
  } else if (mode === "--verify-closest") {
    const existing = JSON.parse(
      await readFile(savedResultJsonUrl, "utf8"),
    );
    const normalProfile = SKILL_PROFILES.filter(
      (profile) => profile.id === "normal",
    );
    const seedOffsets = new Map([["normal", 12]]);
    for (const expected of existing.closestThree) {
      const simulation = await simulateAll(
        modules,
        meta,
        geometries,
        normalProfile,
        runsPerCombo,
        maximumStage,
        expected.difficulty,
        seedOffsets,
      );
      const actual = summarizeSweep(
        expected.difficulty,
        simulation,
        runsPerCombo,
      );
      assertDeterministic(
        createSelectionSignature(expected),
        createSelectionSignature(actual),
        `최근접 ${expected.id}`,
      );
      if (
        Math.abs(
          expected.instrument.averageWhiteSelfOutsPerMatch -
            actual.instrument.averageWhiteSelfOutsPerMatch,
        ) > 0.0005
      ) {
        throw new Error(
          `${expected.id} 백 자멸 평균 불일치: expected=${expected.instrument.averageWhiteSelfOutsPerMatch}, actual=${actual.instrument.averageWhiteSelfOutsPerMatch}`,
        );
      }
    }
  } else {
    const existing = JSON.parse(
      await readFile(
        mode === "--verify-sweep" || mode === "--refine"
          ? savedResultJsonUrl
          : baselineJsonUrl,
        "utf8",
      ),
    );
    const normalProfile = SKILL_PROFILES.filter(
      (profile) => profile.id === "normal",
    );
    const seedOffsets = new Map([["normal", 12]]);
    const rows =
      mode === "--refine"
        ? [...existing.sweep]
        : mode === "--resume"
        ? createRecoveredSweepRows(runsPerCombo)
        : [];
    const difficulties =
      mode === "--refine"
        ? REFINEMENT_DIFFICULTIES
        : mode === "--resume"
        ? createSweepDifficulties().slice(
            RECOVERED_SWEEP_RUNS.length,
          )
        : createSweepDifficulties();
    const startedAt = performance.now();
    for (let index = 0; index < difficulties.length; index += 1) {
      const difficulty = difficulties[index];
      console.log(
        `[스윕 ${index + 1}/${difficulties.length}] ${difficulty.id}`,
      );
      try {
        const simulation = await simulateAll(
          modules,
          meta,
          geometries,
          normalProfile,
          runsPerCombo,
          maximumStage,
          difficulty,
          seedOffsets,
        );
        rows.push(
          summarizeSweep(
            difficulty,
            simulation,
            runsPerCombo,
          ),
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        rows.push({
          id: difficulty.id,
          difficulty,
          invalid: true,
          error: message,
          qualifies: false,
          medianDeathStage: null,
          stageOneWinRate: null,
          maximumPositiveBump: null,
          byStage: [],
        });
        console.error(`[조합 무효] ${difficulty.id}: ${message}`);
      }
      const elapsed = performance.now() - startedAt;
      const projected =
        (elapsed / (index + 1)) * difficulties.length;
      console.log(
        rows.at(-1).invalid
          ? `[스윕 요약] 무효 조합, 예상 ${(projected / 60000).toFixed(2)}분`
          : `[스윕 요약] 중앙값 ${rows.at(-1).medianDeathStage}, 1단계 ${(rows.at(-1).stageOneWinRate * 100).toFixed(1)}%, 백 자멸 ${rows.at(-1).instrument.averageWhiteSelfOutsPerMatch.toFixed(3)}/경기, 예상 ${(projected / 60000).toFixed(2)}분`,
      );
    }
    if (mode === "--verify-sweep") {
      assertDeterministic(
        existing.sweep,
        rows,
        "36조합 스윕",
      );
    } else {
      const selection = selectWinner(rows);
      const result = {
        ...existing,
        status:
          selection === null
            ? "no-qualifying-combination"
            : "selection-ready",
        configuration: {
          ...existing.configuration,
          sweepRunsPerCombo: runsPerCombo,
          sweepComboCount: rows.length,
          refinementComboCount:
            mode === "--refine"
              ? REFINEMENT_DIFFICULTIES.length
              : 0,
          sweepSeedOffset: 12,
        },
        target: {
          medianDeathStage: [
            TARGET_MEDIAN_MINIMUM,
            TARGET_MEDIAN_MAXIMUM,
          ],
          minimumStageOneWinRate:
            TARGET_STAGE_ONE_WIN_RATE,
          monotonicNoiseTolerance:
            runsPerCombo === 12
              ? MONOTONIC_NOISE_TOLERANCE
              : 2 / runsPerCombo,
        },
        sweep: rows,
        selection,
        closestThree: [...rows]
          .filter((row) => !row.invalid)
          .sort(
            (left, right) =>
              computePenalty(left, runsPerCombo) -
                computePenalty(right, runsPerCombo) ||
              left.id.localeCompare(right.id),
          )
          .slice(0, 3),
        sweepWallTimeMs:
          Math.round(
            (performance.now() - startedAt) * 100,
          ) / 100,
      };
      await writeFile(
        resultJsonUrl,
        `${JSON.stringify(result, null, 2)}\n`,
        "utf8",
      );
      console.log(`[저장] ${fileURLToPath(resultJsonUrl)}`);
    }
  }
} finally {
  console.info = originalConsoleInfo;
  await vite.close();
}

// 보고서는 선정 결과를 본 뒤 최종 검증 또는 정지 근거까지 포함해 후속 단계에서 생성한다.
void resultMarkdownUrl;
