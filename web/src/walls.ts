import {
  BREAKABLE_WALL_HEIGHT,
  BREAKABLE_WALL_OVERLAP_CELLS,
  BREAKABLE_WALL_SEGMENTS_PER_SIDE,
  BREAKABLE_WALL_THICKNESS,
} from "./config";
import type { GameMode } from "./game-mode";

export type BreakableWallSide =
  | "north"
  | "east"
  | "south"
  | "west";

export interface BreakableWallSegmentDefinition {
  // 물리·렌더·검증이 같은 조각을 찾는 고정 식별자다.
  id: string;
  // 절차 균열 모양과 결정적 순회를 공유하는 전체 조각 순번이다.
  index: number;
  // 조각이 놓인 보드 외곽의 방향이다.
  side: BreakableWallSide;
  // 한 변 안에서 음의 좌표부터 증가하는 0 기반 순번이다.
  sideIndex: number;
  // 고정 바디와 박스 메시가 공유하는 월드 중심이다.
  center: {
    x: number;
    y: number;
    z: number;
  };
  // Rapier cuboid와 Three BoxGeometry가 공유하는 반크기다.
  halfExtents: {
    x: number;
    y: number;
    z: number;
  };
}

/**
 * 벽 부수기 맵이 지정된 스테이지 3·4에만 벽을 만든다.
 */
export function hasBreakableWalls(
  gameMode: GameMode,
  stageNumber: number,
): boolean {
  return (
    gameMode === "stage" &&
    (stageNumber === 3 || stageNumber === 4)
  );
}

/**
 * 확대 보드 외곽을 네 변×고정 조각 수로 나누고 작은 말만 통과하는 겹침 구멍을 만든다.
 */
export function computeBreakableWallSegments(
  boardHalfExtent: number,
  boardTop: number,
  cellSize: number,
): BreakableWallSegmentDefinition[] {
  if (
    !Number.isFinite(boardHalfExtent) ||
    boardHalfExtent <= 0 ||
    !Number.isFinite(boardTop) ||
    !Number.isFinite(cellSize) ||
    cellSize <= 0
  ) {
    throw new Error(
      `벽 배치 입력이 올바르지 않습니다: halfExtent=${boardHalfExtent}, boardTop=${boardTop}, cellSize=${cellSize}`,
    );
  }
  const segmentPitch =
    (boardHalfExtent * 2) /
    BREAKABLE_WALL_SEGMENTS_PER_SIDE;
  const segmentLength =
    segmentPitch +
    cellSize * BREAKABLE_WALL_OVERLAP_CELLS;
  const tangentHalf = segmentLength / 2;
  const normalHalf = BREAKABLE_WALL_THICKNESS / 2;
  const centerHeight =
    boardTop + BREAKABLE_WALL_HEIGHT / 2;
  const rimCenter =
    boardHalfExtent - BREAKABLE_WALL_THICKNESS / 2;
  const definitions: BreakableWallSegmentDefinition[] = [];
  const sides: readonly BreakableWallSide[] = [
    "north",
    "east",
    "south",
    "west",
  ];

  for (let sideOrder = 0; sideOrder < sides.length; sideOrder += 1) {
    const side = sides[sideOrder];
    for (
      let sideIndex = 0;
      sideIndex < BREAKABLE_WALL_SEGMENTS_PER_SIDE;
      sideIndex += 1
    ) {
      const tangent =
        -boardHalfExtent +
        segmentPitch * (sideIndex + 0.5);
      const horizontal =
        side === "north" || side === "south";
      definitions.push({
        id: `wall-${side}-${sideIndex}`,
        index:
          sideOrder *
            BREAKABLE_WALL_SEGMENTS_PER_SIDE +
          sideIndex,
        side,
        sideIndex,
        center: {
          x: horizontal
            ? tangent
            : side === "east"
              ? rimCenter
              : -rimCenter,
          y: centerHeight,
          z: horizontal
            ? side === "north"
              ? rimCenter
              : -rimCenter
            : tangent,
        },
        halfExtents: {
          x: horizontal ? tangentHalf : normalHalf,
          y: BREAKABLE_WALL_HEIGHT / 2,
          z: horizontal ? normalHalf : tangentHalf,
        },
      });
    }
  }
  return definitions;
}

/**
 * 한 조각이 사라진 뒤 이웃 조각 사이에 남는 실제 수평 통과 폭을 계산한다.
 */
export function computeBreakableWallGapWidth(
  boardHalfExtent: number,
  cellSize: number,
): number {
  return (
    (boardHalfExtent * 2) /
      BREAKABLE_WALL_SEGMENTS_PER_SIDE -
    cellSize * BREAKABLE_WALL_OVERLAP_CELLS
  );
}
