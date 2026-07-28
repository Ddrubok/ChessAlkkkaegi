import type { GameMode } from "./game-mode";

export interface BoardHoleRectangle {
  // 검증 로그와 렌더·물리 대응표에서 같은 구멍을 찾는 고정 식별자다.
  id: string;
  // 구멍의 서쪽 경계에 해당하는 월드 x 좌표다.
  minX: number;
  // 구멍의 동쪽 경계에 해당하는 월드 x 좌표다.
  maxX: number;
  // 구멍의 남쪽 경계에 해당하는 월드 z 좌표다.
  minZ: number;
  // 구멍의 북쪽 경계에 해당하는 월드 z 좌표다.
  maxZ: number;
}

export interface BoardFloorRectangle {
  // 분할 바닥의 서쪽 경계에 해당하는 월드 x 좌표다.
  minX: number;
  // 분할 바닥의 동쪽 경계에 해당하는 월드 x 좌표다.
  maxX: number;
  // 분할 바닥의 남쪽 경계에 해당하는 월드 z 좌표다.
  minZ: number;
  // 분할 바닥의 북쪽 경계에 해당하는 월드 z 좌표다.
  maxZ: number;
}

interface HoleCellRectangle {
  // 구멍의 고정 식별자다.
  id: string;
  // a=0을 기준으로 포함하는 첫 파일 인덱스다.
  firstFileIndex: number;
  // a=0을 기준으로 포함하는 마지막 파일 인덱스다.
  lastFileIndex: number;
  // 포함하는 첫 랭크 번호다.
  firstRank: number;
  // 포함하는 마지막 랭크 번호다.
  lastRank: number;
}

// 맵 문서의 함정 1 도면이 지정한 d4·d5·e4·e5 중앙 2×2 구멍이다.
const STAGE_FIVE_HOLE_CELLS: readonly HoleCellRectangle[] = [
  {
    id: "hole-stage5-center",
    firstFileIndex: 3,
    lastFileIndex: 4,
    firstRank: 4,
    lastRank: 5,
  },
];

// 맵 문서의 함정 2 도면이 지정한 b3~c4와 f5~g6 두 2×2 구멍이다.
const STAGE_SIX_HOLE_CELLS: readonly HoleCellRectangle[] = [
  {
    id: "hole-stage6-southwest",
    firstFileIndex: 1,
    lastFileIndex: 2,
    firstRank: 3,
    lastRank: 4,
  },
  {
    id: "hole-stage6-northeast",
    firstFileIndex: 5,
    lastFileIndex: 6,
    firstRank: 5,
    lastRank: 6,
  },
];

/**
 * 파일·랭크 셀 경계를 기존 말 배치와 같은 월드 좌표계의 구멍 직사각형으로 바꾼다.
 */
export function computeBoardHoleRectangles(
  cellSize: number,
  gameMode: GameMode,
  stageNumber: number,
): BoardHoleRectangle[] {
  if (!Number.isFinite(cellSize) || cellSize <= 0) {
    throw new Error(
      `구멍 셀 크기 ${cellSize}가 유한한 양수가 아닙니다.`,
    );
  }
  const specifications =
    gameMode !== "stage"
      ? []
      : stageNumber === 5
        ? STAGE_FIVE_HOLE_CELLS
        : stageNumber === 6
          ? STAGE_SIX_HOLE_CELLS
          : [];
  return specifications.map((specification) => ({
    id: specification.id,
    // getCellCenter와 동일하게 a 파일이 +x, h 파일이 -x 방향이다.
    minX: (3.5 - specification.lastFileIndex - 0.5) * cellSize,
    maxX: (3.5 - specification.firstFileIndex + 0.5) * cellSize,
    minZ: (specification.firstRank - 4.5 - 0.5) * cellSize,
    maxZ: (specification.lastRank - 4.5 + 0.5) * cellSize,
  }));
}

/**
 * 구멍 경계를 그대로 절단선으로 써 판 전체를 겹침 없는 직사각형 바닥들로 분해한다.
 */
export function computeBoardFloorRectangles(
  boardHalfExtent: number,
  holes: readonly BoardHoleRectangle[],
): BoardFloorRectangle[] {
  if (!Number.isFinite(boardHalfExtent) || boardHalfExtent <= 0) {
    throw new Error(
      `구멍 바닥 반폭 ${boardHalfExtent}가 유한한 양수가 아닙니다.`,
    );
  }
  for (const hole of holes) {
    if (
      ![hole.minX, hole.maxX, hole.minZ, hole.maxZ].every(
        Number.isFinite,
      ) ||
      hole.minX >= hole.maxX ||
      hole.minZ >= hole.maxZ ||
      hole.minX < -boardHalfExtent ||
      hole.maxX > boardHalfExtent ||
      hole.minZ < -boardHalfExtent ||
      hole.maxZ > boardHalfExtent
    ) {
      throw new Error(
        `구멍 ${hole.id}이 보드 경계 안의 유효한 직사각형이 아닙니다.`,
      );
    }
  }

  // 구멍 옆의 긴 통로를 한 콜라이더로 유지하도록 x 띠를 먼저 나눈다.
  // 이 방향은 남북으로 미끄러지는 말이 온전한 외곽 통로에서 이음새를 밟지 않게 한다.
  const xBoundaries = [
    -boardHalfExtent,
    ...holes.flatMap((hole) => [hole.minX, hole.maxX]),
    boardHalfExtent,
  ]
    .sort((left, right) => left - right)
    .filter((value, index, values) =>
      index === 0 || value !== values[index - 1],
    );
  const rectangles: BoardFloorRectangle[] = [];
  for (let index = 0; index < xBoundaries.length - 1; index += 1) {
    const minX = xBoundaries[index];
    const maxX = xBoundaries[index + 1];
    const middleX = (minX + maxX) / 2;
    const blocked = holes
      .filter(
        (hole) => middleX > hole.minX && middleX < hole.maxX,
      )
      .sort((left, right) => left.minZ - right.minZ);
    let cursorZ = -boardHalfExtent;
    for (const hole of blocked) {
      if (hole.minZ > cursorZ) {
        rectangles.push({
          minX,
          maxX,
          minZ: cursorZ,
          maxZ: hole.minZ,
        });
      }
      cursorZ = Math.max(cursorZ, hole.maxZ);
    }
    if (cursorZ < boardHalfExtent) {
      rectangles.push({
        minX,
        maxX,
        minZ: cursorZ,
        maxZ: boardHalfExtent,
      });
    }
  }
  return rectangles;
}

/**
 * 반폭과 구멍 목록을 함께 비교할 때 쓰는 값 기반 보드 배치 키를 만든다.
 */
export function createBoardFloorLayoutKey(
  boardHalfExtent: number,
  floorRectangles: readonly BoardFloorRectangle[],
): string {
  return JSON.stringify({
    boardHalfExtent,
    floorRectangles,
  });
}
