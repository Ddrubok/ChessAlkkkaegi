import assert from "node:assert/strict";
import {
  PUZZLE_CATALOG,
  getPuzzleDefinition,
  isPuzzleUnlocked,
  loadPuzzleProgress,
  savePuzzleProgress,
  mergePuzzleProgress,
  evaluatePuzzleAttempt,
  applyPuzzleEvaluation,
} from "../puzzle.ts";

const puzzle = (id) => {
  const value = getPuzzleDefinition(id);
  assert.ok(value, `missing puzzle ${id}`);
  return value;
};

const attempt = (launches, fallenIDs, overrides = {}) => ({
  settled: true,
  launches,
  fallenIDs,
  contactEvents: [],
  ...overrides,
});

const success = (definition, input, options = {}) => {
  const evaluation = evaluatePuzzleAttempt(definition, input);
  assert.equal(evaluation.status, "success");
  return { evaluation, options };
};

assert.equal(PUZZLE_CATALOG.length, 12);
assert.deepEqual(PUZZLE_CATALOG.map((item) => item.puzzleId), [
  "P01", "P02", "P03", "P04", "P05", "P06",
  "P07", "P08", "P09", "P10", "P11", "P12",
]);
for (const item of PUZZLE_CATALOG) {
  assert.equal(item.abilityPolicy.research, false);
  assert.equal(item.abilityPolicy.deck, false);
  assert.equal(item.abilityPolicy.pawnPromotion, false);
  assert.equal(item.abilityPolicy.kingSpecial, false);
  for (const piece of item.pieces) assert.equal(piece.position.positionValidated, false);
}

// 필수 보호 낙하는 금메달 미달이 아니라 전체 실패보다 우선한다.
const p06 = puzzle("P06");
const p06Result = evaluatePuzzleAttempt(
  p06,
  attempt(1, ["p06-target-rook", "p06-protected-king"], {
    protectedContactIDs: ["p06-protected-king"],
  }),
);
assert.equal(p06Result.status, "failed");
assert.ok(p06Result.failureReasons.some((reason) => reason.code === "forbidden-fall"));
for (const id of ["P02", "P06", "P10", "P12"]) {
  assert.deepEqual(puzzle(id).forbidden.contactIds, []);
}

// 물리/데이터 오류는 재시도 가능한 실패로 기록하고 pending에 고착하지 않는다.
const dataErrorResult = evaluatePuzzleAttempt(
  puzzle("P01"),
  attempt(1, ["p01-target-pawn"], { dataError: "invalid physics evidence" }),
);
assert.equal(dataErrorResult.status, "failed");
assert.equal(dataErrorResult.medal, 0);
assert.ok(dataErrorResult.failureReasons.some((reason) => reason.code === "data-error"));

// 목표를 제거한 동시 전멸은 브론즈로 기록할 수 있다.
const p01DoubleKo = evaluatePuzzleAttempt(
  puzzle("P01"),
  attempt(2, ["p01-target-pawn", "p01-player-pawn"]),
);
assert.equal(p01DoubleKo.status, "success");
assert.equal(p01DoubleKo.medal, 1);

// 목표가 남고 백 말이 모두 장외면 발사 예산이 남아도 진행을 계속하지 않는다.
const p01Deadlock = evaluatePuzzleAttempt(
  puzzle("P01"),
  attempt(1, ["p01-player-pawn"]),
);
assert.equal(p01Deadlock.status, "failed");
assert.ok(p01Deadlock.failureReasons.some((reason) => reason.code === "no-player-pieces"));

// 보호 말 접촉은 생존 시 성공을 막지 않고, 금메달 조건만 미달시킨다.
const p02 = puzzle("P02");
// 보호 접촉 없음은 각 문제의 금메달 규칙에만 있고, 즉시 실패 접촉은 별도 forbidden 필드다.
const immediateContactPuzzle = {
  ...p02,
  forbidden: { ...p02.forbidden, contactIds: ["p02-target-bishop"] },
};
const immediateContactResult = evaluatePuzzleAttempt(
  immediateContactPuzzle,
  attempt(1, ["p02-target-bishop"], { protectedContactIDs: ["p02-target-bishop"] }),
);
assert.equal(immediateContactResult.status, "failed");
assert.ok(immediateContactResult.failureReasons.some((reason) => reason.code === "forbidden-contact"));

const p02Result = evaluatePuzzleAttempt(
  p02,
  attempt(1, ["p02-target-bishop"], { protectedContactIDs: ["p02-protected-pawn"] }),
);
assert.equal(p02Result.status, "success");
assert.equal(p02Result.medal, 2);

// 반사 판정은 같은 발사 말의 벽 접촉이 목표 접촉보다 앞선 경우만 인정한다.
const p03 = puzzle("P03");
const p03Good = evaluatePuzzleAttempt(
  p03,
  attempt(1, ["p03-target-pawn"], {
    contactEvents: [
      { order: 1, launch: 1, shooterId: "p03-player-rook", targetId: "p03-pocket-wall", targetKind: "wall" },
      { order: 2, launch: 1, shooterId: "p03-player-rook", targetId: "p03-target-pawn", targetKind: "piece" },
    ],
  }),
);
assert.equal(p03Good.medal, 3);
const p03Bad = evaluatePuzzleAttempt(
  p03,
  attempt(1, ["p03-target-pawn"], {
    contactEvents: [
      { order: 1, launch: 1, shooterId: "p03-player-rook", targetId: "p03-target-pawn", targetKind: "piece" },
      { order: 2, launch: 1, shooterId: "p03-player-rook", targetId: "p03-pocket-wall", targetKind: "wall" },
    ],
  }),
);
assert.equal(p03Bad.medal, 1);

// 판별 전용 증거 필드도 문제 조건에 반영한다.
const p08 = puzzle("P08");
const p08Result = evaluatePuzzleAttempt(
  p08,
  attempt(1, ["p08-target-pawn"], {
    rookShots: [{ pieceId: "p08-player-rook", centerHit: true, power: 0.6 }],
  }),
);
assert.equal(p08Result.medal, 3);
const p11 = puzzle("P11");
const p11Result = evaluatePuzzleAttempt(
  p11,
  attempt(2, ["p11-target-pawn"], {
    wallDestroyedCounts: { "p11-breakable-wall": 1 },
    fallOrderEvents: [{ order: 20, launch: 2, pieceId: "p11-target-pawn" }],
    wallDestructionOrderEvents: [{ order: 10, launch: 1, wallId: "p11-breakable-wall" }],
  }),
);
assert.equal(p11Result.medal, 3);
const p11ReverseOrder = evaluatePuzzleAttempt(
  p11,
  attempt(4, ["p11-target-pawn"], {
    wallDestroyedCounts: { "p11-breakable-wall": 1 },
    fallOrderEvents: [{ order: 10, launch: 1, pieceId: "p11-target-pawn" }],
    wallDestructionOrderEvents: [{ order: 20, launch: 2, wallId: "p11-breakable-wall" }],
  }),
);
assert.equal(p11ReverseOrder.status, "failed");
assert.ok(p11ReverseOrder.failureReasons.some((reason) => reason.code === "wall-destruction-order-missing"));

// 앞 장 3개 완료로만 다음 장이 열리고, 튜토리얼 상태는 참조하지 않는다.
let store = loadPuzzleProgress({ getItem: () => null, setItem: () => {} });
assert.equal(isPuzzleUnlocked(store, puzzle("P05")), false);
for (const id of ["P01", "P02", "P03"]) {
  const definition = puzzle(id);
  const targetIds = definition.medals.bronze.requiredFallIds;
  const result = success(definition, attempt(1, targetIds));
  store = applyPuzzleEvaluation(store, definition, result.evaluation, {
    launches: 1,
    finishedAt: "2026-09-13T00:00:00.000Z",
  }).store;
}
assert.equal(isPuzzleUnlocked(store, puzzle("P05")), true);

// 완료 보상은 동일 성공 콜백을 다시 받아도 한 번만 새로 지급한다.
const p01 = puzzle("P01");
const firstP01 = evaluatePuzzleAttempt(p01, attempt(1, ["p01-target-pawn"]));
const freshStore = loadPuzzleProgress({ getItem: () => null, setItem: () => {} });
const firstSave = applyPuzzleEvaluation(freshStore, p01, firstP01, {
  launches: 1,
  hintsUsedThisAttempt: 1,
  finishedAt: "2026-09-13T00:01:00.000Z",
});
const secondSave = applyPuzzleEvaluation(firstSave.store, p01, firstP01, {
  launches: 1,
  finishedAt: "2026-09-13T00:02:00.000Z",
});
assert.ok(firstSave.newlyGrantedRewardIds.includes("puzzle:P01:bronze"));
assert.equal(secondSave.newlyGrantedRewardIds.includes("puzzle:P01:bronze"), false);
assert.equal(secondSave.entry.bestMedal, 3);
assert.equal(secondSave.entry.attempts, firstSave.entry.attempts + 1);
assert.equal(secondSave.entry.hintsUsed, firstSave.entry.hintsUsed);

// 계정 병합은 최고 메달·최대 누적 기록·최신 마지막 샷·보상 합집합을 보존한다.
const merged = mergePuzzleProgress(firstSave.store, {
  version: 1,
  revision: 1,
  records: {
    "P01@1": {
      puzzleId: "P01",
      revision: 1,
      bestMedal: 3,
      attempts: 9,
      hintsUsed: 4,
      bestLaunches: 2,
      lastShot: { finishedAt: "2026-09-13T00:03:00.000Z", launches: 1, medal: 3, hintsUsed: 0, customHitUsed: false },
      completedAt: "2026-09-13T00:03:00.000Z",
    },
  },
  rewardIds: ["badge:remote"],
});
assert.equal(merged.records["P01@1"].bestMedal, 3);
assert.equal(merged.records["P01@1"].attempts, 9);
assert.equal(merged.records["P01@1"].hintsUsed, 4);
assert.equal(merged.records["P01@1"].bestLaunches, 1);
assert.equal(merged.records["P01@1"].lastShot.finishedAt, "2026-09-13T00:03:00.000Z");
assert.ok(merged.rewardIds.includes("badge:remote"));

const memory = new Map();
const storage = { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
assert.equal(savePuzzleProgress(merged, storage), true);
assert.equal(loadPuzzleProgress(storage).records["P01@1"].bestMedal, 3);

console.log("puzzle-headless-check: PASS");
