import { BoxGeometry } from "three";
import { BOARD_BORDER_CELLS } from "./config";
import type { GameMode } from "./game-mode";
import {
  computeBoardFloorRectangles,
  computeBoardHoleRectangles,
  type BoardFloorRectangle,
} from "./holes";

export type BoardSurfaceKind = "wood" | "light" | "dark";

export interface BoardSurfaceLayout {
  // 렌더 메시와 물리 바닥이 공유하는 판 전체 반폭이다.
  outerHalfExtent: number;
  // 새 외곽으로 이동한 목재 테두리의 고정 월드 두께다.
  rimWidth: number;
  // 연속 체크무늬가 차지하는 정사각형 영역의 반폭이다.
  checkerHalfExtent: number;
  // 확대 여백에서도 달라지지 않는 체크무늬 한 셀의 월드 크기다.
  cellSize: number;
}

/**
 * 렌더 보드가 물리 보드와 같은 구멍 경계를 쓰도록 공통 분할 결과를 그대로 돌려준다.
 */
export function computeBoardRenderFloorRectangles(
  boardHalfExtent: number,
  cellSize: number,
  gameMode: GameMode,
  stageNumber: number,
): BoardFloorRectangle[] {
  return computeBoardFloorRectangles(
    boardHalfExtent,
    computeBoardHoleRectangles(cellSize, gameMode, stageNumber),
  );
}

/**
 * 판 외곽과 고정 두께 목재 테두리 사이를 체크무늬 영역으로 나눈다.
 */
export function computeBoardSurfaceLayout(
  cellSize: number,
  boardHalfExtent: number,
): BoardSurfaceLayout {
  if (!Number.isFinite(cellSize) || cellSize <= 0) {
    throw new Error(
      `보드 표면 cellSize ${cellSize}가 유한한 양수가 아닙니다.`,
    );
  }
  if (!Number.isFinite(boardHalfExtent) || boardHalfExtent <= 0) {
    throw new Error(
      `보드 표면 반폭 ${boardHalfExtent}가 유한한 양수가 아닙니다.`,
    );
  }
  const rimWidth = BOARD_BORDER_CELLS * cellSize;
  const checkerHalfExtent = boardHalfExtent - rimWidth;
  if (checkerHalfExtent <= 0) {
    throw new Error(
      `보드 반폭 ${boardHalfExtent}이 목재 테두리 ${rimWidth}보다 넓지 않습니다.`,
    );
  }
  return {
    outerHalfExtent: boardHalfExtent,
    rimWidth,
    checkerHalfExtent,
    cellSize,
  };
}

/**
 * 월드 좌표 한 점이 새 외곽 테두리인지 연속 위상의 밝고 어두운 셀인지 판정한다.
 */
export function classifyBoardSurface(
  x: number,
  z: number,
  layout: Readonly<BoardSurfaceLayout>,
): BoardSurfaceKind {
  if (![x, z].every(Number.isFinite)) {
    throw new Error(
      `보드 표면 좌표 (${x}, ${z})가 유한하지 않습니다.`,
    );
  }
  if (
    Math.abs(x) >= layout.checkerHalfExtent ||
    Math.abs(z) >= layout.checkerHalfExtent
  ) {
    return "wood";
  }
  const fileIndex = Math.floor(x / layout.cellSize);
  const rankIndex = Math.floor(z / layout.cellSize);
  return ((fileIndex + rankIndex) & 1) === 1
    ? "dark"
    : "light";
}

/**
 * 표면 텍스처와 같은 전체 반폭으로 렌더 판 상자 지오메트리를 만든다.
 */
export function createBoardGeometry(
  boardHalfExtent: number,
  boardThickness: number,
): BoxGeometry {
  if (!Number.isFinite(boardThickness) || boardThickness <= 0) {
    throw new Error(
      `보드 두께 ${boardThickness}가 유한한 양수가 아닙니다.`,
    );
  }
  return new BoxGeometry(
    boardHalfExtent * 2,
    boardThickness,
    boardHalfExtent * 2,
  );
}

/**
 * 구멍을 제외하고 남은 한 바닥 직사각형의 렌더 지오메트리를 만든다.
 */
export function createBoardFloorGeometry(
  rectangle: Readonly<BoardFloorRectangle>,
  boardThickness: number,
): BoxGeometry {
  if (!Number.isFinite(boardThickness) || boardThickness <= 0) {
    throw new Error(
      `보드 두께 ${boardThickness}가 유한한 양수가 아닙니다.`,
    );
  }
  const width = rectangle.maxX - rectangle.minX;
  const depth = rectangle.maxZ - rectangle.minZ;
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(depth) ||
    width <= 0 ||
    depth <= 0
  ) {
    throw new Error("렌더 바닥 직사각형의 폭과 깊이가 올바르지 않습니다.");
  }
  return new BoxGeometry(width, boardThickness, depth);
}
