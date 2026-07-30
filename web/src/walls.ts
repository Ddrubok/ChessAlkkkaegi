import {
  BREAKABLE_WALL_HEIGHT,
  BREAKABLE_WALL_OVERLAP_CELLS,
  BREAKABLE_WALL_SEGMENTS_PER_SIDE,
  BREAKABLE_WALL_THICKNESS,
  POCKET_WALL_EXIT_WIDTH_KING_DIAMETER_MULTIPLIER,
} from "./config";
import type { GameMode } from "./game-mode";

export type PerimeterWallVariant =
  | "breakable"
  | "indestructible";

export type BreakableWallSide =
  | "north"
  | "east"
  | "south"
  | "west";

export interface BreakableWallSegmentDefinition {
  // 타격 계수·균열·파괴를 적용할지 결정하는 벽 내구 변형이다.
  variant: PerimeterWallVariant;
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

export interface PocketWallGeometry {
  // 메타 킹 밑동의 실제 지름이다.
  kingBaseDiameter: number;
  // 문서의 “약간 넓게”를 적용한 실제 대각 출구 폭이다.
  exitWidth: number;
  // 벽 두께를 포함해 각 변의 벽 끝을 모서리에서 물리는 축 방향 거리다.
  sideSetback: number;
  // 두 직교 벽의 안쪽 끝점 사이에서 측정한 실제 대각 통과 폭이다.
  diagonalClearance: number;
  // 한 변에서 두 모서리 출구를 제외하고 남는 벽의 전체 길이다.
  wallLength: number;
}

/**
 * 낮은 당구장 벽과 실제로 맞닿는 콜라이더 하단 20%에서 킹 밑동 flare 반지름을 잰다.
 */
export function computePocketKingBaseRadius(
  colliderPoints: readonly (readonly [
    number,
    number,
    number,
  ])[],
  pieceHeight: number,
): number {
  if (
    colliderPoints.length === 0 ||
    !Number.isFinite(pieceHeight) ||
    pieceHeight <= 0
  ) {
    throw new Error(
      `포켓 킹 밑동 입력이 올바르지 않습니다: points=${colliderPoints.length}, height=${pieceHeight}`,
    );
  }
  const minimumY = Math.min(
    ...colliderPoints.map((point) => point[1]),
  );
  const maximumBaseY = minimumY + pieceHeight * 0.2;
  const baseRadius = Math.max(
    ...colliderPoints
      .filter((point) => point[1] <= maximumBaseY)
      .map((point) => Math.hypot(point[0], point[2])),
  );
  if (!Number.isFinite(baseRadius) || baseRadius <= 0) {
    throw new Error(
      `포켓 킹 밑동 flare 반지름 ${baseRadius}가 유효하지 않습니다.`,
    );
  }
  return baseRadius;
}

/**
 * 스테이지 3·4의 명시와 함정 1·2 도면의 파란 분절 띠 판독에 따라 3~6에 벽을 만든다.
 * 5·6 범위는 도면 근거 해석이라 기획이 뒤집히면 이 조건 한 줄만 바꾸면 된다.
 */
export function hasBreakableWalls(
  gameMode: GameMode,
  stageNumber: number,
): boolean {
  return (
    gameMode === "stage" &&
    stageNumber >= 3 &&
    stageNumber <= 6
  );
}

/**
 * 포켓볼 도면이 지정한 스테이지 7·8에만 불파괴 외곽 벽을 만든다.
 */
export function hasPocketWalls(
  gameMode: GameMode,
  stageNumber: number,
): boolean {
  return (
    gameMode === "stage" &&
    (stageNumber === 7 || stageNumber === 8)
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
        variant: "breakable",
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
 * 킹 밑동보다 20% 넓은 실제 대각 틈을 만들도록 모서리 출구 투영 길이를 계산한다.
 */
export function computePocketWallGeometry(
  boardHalfExtent: number,
  kingBaseRadius: number,
): PocketWallGeometry {
  if (
    !Number.isFinite(boardHalfExtent) ||
    boardHalfExtent <= 0 ||
    !Number.isFinite(kingBaseRadius) ||
    kingBaseRadius <= 0
  ) {
    throw new Error(
      `포켓 벽 기하 입력이 올바르지 않습니다: halfExtent=${boardHalfExtent}, kingBaseRadius=${kingBaseRadius}`,
    );
  }
  const kingBaseDiameter = kingBaseRadius * 2;
  const exitWidth =
    kingBaseDiameter *
    POCKET_WALL_EXIT_WIDTH_KING_DIAMETER_MULTIPLIER;
  // 서로 직교하는 두 끝점이 대각 폭의 절반씩 담당하므로 축 투영과 벽 두께를 함께 보정한다.
  const sideSetback =
    BREAKABLE_WALL_THICKNESS + exitWidth / Math.SQRT2;
  const diagonalClearance =
    Math.SQRT2 *
    (sideSetback - BREAKABLE_WALL_THICKNESS);
  const wallLength = 2 * (boardHalfExtent - sideSetback);
  if (wallLength <= 0) {
    throw new Error(
      `포켓 출구 폭 ${exitWidth}가 보드 반폭 ${boardHalfExtent}보다 커 벽이 남지 않습니다.`,
    );
  }
  return {
    kingBaseDiameter,
    exitWidth,
    sideSetback,
    diagonalClearance,
    wallLength,
  };
}

/**
 * 네 변 중앙에 같은 길이의 불파괴 벽을 놓고 각 모서리를 L자 출구로 비운다.
 */
export function computePocketWallSegments(
  boardHalfExtent: number,
  boardTop: number,
  kingBaseRadius: number,
): BreakableWallSegmentDefinition[] {
  if (!Number.isFinite(boardTop)) {
    throw new Error(
      `포켓 벽 상면 ${boardTop}이 유한한 수가 아닙니다.`,
    );
  }
  const geometry = computePocketWallGeometry(
    boardHalfExtent,
    kingBaseRadius,
  );
  const tangentHalf = geometry.wallLength / 2;
  const normalHalf = BREAKABLE_WALL_THICKNESS / 2;
  const centerHeight =
    boardTop + BREAKABLE_WALL_HEIGHT / 2;
  const rimCenter =
    boardHalfExtent - BREAKABLE_WALL_THICKNESS / 2;
  const sides: readonly BreakableWallSide[] = [
    "north",
    "east",
    "south",
    "west",
  ];
  return sides.map((side, index) => {
    const horizontal =
      side === "north" || side === "south";
    return {
      variant: "indestructible",
      id: `pocket-wall-${side}`,
      index,
      side,
      sideIndex: 0,
      center: {
        x: horizontal
          ? 0
          : side === "east"
            ? rimCenter
            : -rimCenter,
        y: centerHeight,
        z: horizontal
          ? side === "north"
            ? rimCenter
            : -rimCenter
          : 0,
      },
      halfExtents: {
        x: horizontal ? tangentHalf : normalHalf,
        y: BREAKABLE_WALL_HEIGHT / 2,
        z: horizontal ? normalHalf : tangentHalf,
      },
    };
  });
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
