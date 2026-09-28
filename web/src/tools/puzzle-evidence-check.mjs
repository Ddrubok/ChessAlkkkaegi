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
const { getPuzzleDefinition, evaluatePuzzleAttempt } = await vite.ssrLoadModule("/src/puzzle.ts");
const { appendPuzzlePhysicsEvidence } = await vite.ssrLoadModule("/src/puzzle-evidence.ts");

const puzzle = getPuzzleDefinition("P03");
const shooterId = puzzle.pieces.find((piece) => piece.side === "white").id;
const targetId = puzzle.required.requiredFallIds[0];
const fresh = () => ({ launches: 1, settled: true, fallenIDs: [], contactEvents: [] });
const evidence = (events = {}) => ({
  shotPieceId: shooterId, shotStartStep: 0,
  pieceContacts: [], protectedPieceContacts: [], wallContacts: [],
  destroyedWalls: [], fallenPieces: [], wallContactBeforeShotTargetContact: false,
  ...events,
});
const wall = (step) => ({ step, pieceId: shooterId, wallId: "pocket-wall-north", kind: "pocket-wall" });
const contact = (step) => ({ step, firstPieceId: shooterId, secondPieceId: targetId });
const fall = (step) => ({ step, pieceId: targetId, reason: "outside", classificationBasis: "board-top-crossing" });

const sequential = fresh();
appendPuzzlePhysicsEvidence(sequential, evidence({ wallContacts: [wall(10)] }), puzzle);
appendPuzzlePhysicsEvidence(sequential, evidence(), puzzle);
appendPuzzlePhysicsEvidence(sequential, evidence({ pieceContacts: [contact(11)] }), puzzle);
appendPuzzlePhysicsEvidence(sequential, evidence({ fallenPieces: [fall(12)] }), puzzle);
appendPuzzlePhysicsEvidence(sequential, evidence(), puzzle);
assert.equal(evaluatePuzzleAttempt(puzzle, sequential).medal, 3, "Empty idle steps must preserve earlier evidence.");

const simultaneous = fresh();
appendPuzzlePhysicsEvidence(simultaneous, evidence({ wallContacts: [wall(10)], pieceContacts: [contact(10)] }), puzzle);
appendPuzzlePhysicsEvidence(simultaneous, evidence({ fallenPieces: [fall(12)] }), puzzle);
assert.equal(evaluatePuzzleAttempt(puzzle, simultaneous).medal, 1, "Same-step contacts must not establish wall-before-target order.");
const wallPuzzle = getPuzzleDefinition("P11");
const wallTarget = wallPuzzle.required.requiredFallIds[0];
const wallShooter = wallPuzzle.pieces.find((piece) => piece.side === "white").id;
const betweenShots = fresh();
appendPuzzlePhysicsEvidence(betweenShots, evidence({
  shotPieceId: wallShooter,
  destroyedWalls: [{ step: 20, wallId: "wall-west-2" }],
}), wallPuzzle);
for (let step = 21; step < 80; step += 1) {
  appendPuzzlePhysicsEvidence(betweenShots, evidence({ shotPieceId: wallShooter }), wallPuzzle);
}
betweenShots.launches = 2;
appendPuzzlePhysicsEvidence(betweenShots, evidence({
  shotPieceId: wallShooter,
  fallenPieces: [{ ...fall(90), pieceId: wallTarget }],
}), wallPuzzle);
appendPuzzlePhysicsEvidence(betweenShots, evidence({ shotPieceId: wallShooter }), wallPuzzle);
assert.equal(evaluatePuzzleAttempt(wallPuzzle, betweenShots).medal, 3, "Wall destruction must survive idle frames between shots, without an extra ricochet condition.");
console.log("puzzle-evidence-check: PASS");
await vite.close();
