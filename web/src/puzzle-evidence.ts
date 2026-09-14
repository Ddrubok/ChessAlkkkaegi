import type {
  PuzzleContactEvent,
  PuzzleDefinition,
  PuzzleEvaluationInput,
  PuzzleFallOrderEvent,
  PuzzleWallDestructionOrderEvent,
} from "./puzzle";
import type { PuzzlePhysicsEvidence } from "./puzzle-physics";

function puzzleWallId(puzzle: PuzzleDefinition, wallId: string): string {
  const knownWallIds = new Set<string>();
  for (const rule of [
    puzzle.required,
    puzzle.medals.bronze,
    puzzle.medals.silver,
    puzzle.medals.gold,
  ]) {
    for (const id of Object.keys(rule.requiredWallDestroyedCounts ?? {})) {
      knownWallIds.add(id);
    }
    for (const id of rule.contactSequence?.wallIds ?? []) {
      knownWallIds.add(id);
    }
  }
  if (knownWallIds.has(wallId)) return wallId;
  // 실제 스테이지는 벽을 여러 Rapier segment로 나누지만, 퍼즐 규칙은
  // 하나의 논리 벽으로 공개한다. 해당 규칙이 하나뿐일 때만 별칭을 적용한다.
  if (knownWallIds.size === 1) return [...knownWallIds][0];
  return wallId;
}

/**
 * 한 샷의 Rapier 추적 증거를 퍼즐 평가 입력에 누적한다.
 *
 * 접촉 order는 물리 fixed step을 그대로 사용한다. 따라서 같은 step의
 * 벽·말 접촉은 엄격한 선행으로 취급되지 않으며, 서로 다른 샷의 order가
 * 겹쳐도 PuzzleContactEvent의 launch로 시도를 구분할 수 있다.
 */
export function appendPuzzlePhysicsEvidence(
  input: PuzzleEvaluationInput,
  evidence: PuzzlePhysicsEvidence,
  puzzle: PuzzleDefinition,
): void {
  const protectedIds = new Set(
    puzzle.pieces.filter((piece) => piece.protected === true).map((piece) => piece.id),
  );
  const fallenIds = new Set(input.fallenIDs);
  const holeOutIds = new Set(input.holeOutIDs ?? []);
  for (const fall of evidence.fallenPieces) {
    fallenIds.add(fall.pieceId);
    if (fall.reason === "hole") holeOutIds.add(fall.pieceId);
  }

  const protectedContactIds = new Set(input.protectedContactIDs ?? []);
  for (const contact of evidence.protectedPieceContacts) {
    if (protectedIds.has(contact.protectedPieceId)) {
      protectedContactIds.add(contact.protectedPieceId);
    }
  }

  const wallDestroyedCounts: Record<string, number> = {
    ...(input.wallDestroyedCounts ?? {}),
  };
  const fallOrderEvents: PuzzleFallOrderEvent[] = [
    ...(input.fallOrderEvents ?? []),
  ];
  const wallDestructionOrderEvents: PuzzleWallDestructionOrderEvent[] = [
    ...(input.wallDestructionOrderEvents ?? []),
  ];
  const launch = input.launches;
  for (const fall of evidence.fallenPieces) {
    fallOrderEvents.push({ order: fall.step, launch, pieceId: fall.pieceId });
  }
  for (const destruction of evidence.destroyedWalls) {
    const wallId = puzzleWallId(puzzle, destruction.wallId);
    wallDestroyedCounts[wallId] = (wallDestroyedCounts[wallId] ?? 0) + 1;
    wallDestructionOrderEvents.push({ order: destruction.step, launch, wallId });
  }

  const contactEvents: PuzzleContactEvent[] = [...input.contactEvents];
  const wallCountsAtStep = new Map<string, number>();
  for (const destruction of evidence.destroyedWalls) {
    const wallId = puzzleWallId(puzzle, destruction.wallId);
    wallCountsAtStep.set(
      wallId,
      (wallCountsAtStep.get(wallId) ?? 0) + 1,
    );
  }
  for (const contact of evidence.pieceContacts) {
    const shooterId =
      contact.firstPieceId === evidence.shotPieceId
        ? contact.firstPieceId
        : contact.secondPieceId === evidence.shotPieceId
          ? contact.secondPieceId
          : contact.firstPieceId;
    const targetId = shooterId === contact.firstPieceId
      ? contact.secondPieceId
      : contact.firstPieceId;
    contactEvents.push({
      order: contact.step,
      launch,
      shooterId,
      targetId,
      targetKind: "piece",
    });
  }
  for (const contact of evidence.wallContacts) {
    // 보드 바닥 재접촉은 벽 반사 증거가 아니다.
    if (contact.kind === "board-floor") continue;
    const wallId = puzzleWallId(puzzle, contact.wallId);
    contactEvents.push({
      order: contact.step,
      launch,
      shooterId: contact.pieceId,
      targetId: wallId,
      targetKind: "wall",
      ...(wallCountsAtStep.has(wallId)
        ? { wallDestroyedCount: wallCountsAtStep.get(wallId) }
        : {}),
    });
  }

  input.fallenIDs = [...fallenIds];
  input.holeOutIDs = [...holeOutIds];
  input.protectedContactIDs = [...protectedContactIds];
  input.wallDestroyedCounts = wallDestroyedCounts;
  input.contactEvents = contactEvents;
  input.fallOrderEvents = fallOrderEvents;
  input.wallDestructionOrderEvents = wallDestructionOrderEvents;
}
