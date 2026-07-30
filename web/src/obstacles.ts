import {
  PINBALL_OBSTACLE_CELLS,
  PINBALL_OBSTACLE_DIAMETER_CELLS,
  PINBALL_OBSTACLE_HEIGHT,
} from "./config";
import type { GameMode } from "./game-mode";
import {
  getCellCenter,
  type ChessFile,
  type ChessRank,
} from "./layout";

export interface PinballObstacleDefinition {
  // 물리·렌더·검증이 같은 원기둥을 찾는 결정적 식별자다.
  id: string;
  // 설정 표 순서를 보존해 반복 생성 순서가 런타임마다 같게 하는 번호다.
  index: number;
  // 도면 해석을 월드 좌표와 함께 추적하는 체스 파일이다.
  file: ChessFile;
  // 도면 해석을 월드 좌표와 함께 추적하는 체스 랭크다.
  rank: ChessRank;
  // Rapier 원기둥과 Three 메시가 공유하는 월드 중심이다.
  center: {
    // 백 시점에서 파일에 대응하는 월드 가로 좌표다.
    x: number;
    // 보드 상면 위에 원기둥을 세우는 월드 높이다.
    y: number;
    // 백 시점에서 랭크에 대응하는 월드 세로 좌표다.
    z: number;
  };
  // 셀 비율 지름을 실제 월드 길이로 바꾼 원기둥 반지름이다.
  radius: number;
  // 물리와 렌더의 전체 높이를 함께 만드는 원기둥 반높이다.
  halfHeight: number;
}

/**
 * 공식 핀볼 맵이 적용되는 스테이지 9에서만 여섯 고정 장애물을 활성화한다.
 */
export function hasPinballObstacles(
  gameMode: GameMode,
  stageNumber: number,
): boolean {
  return gameMode === "stage" && stageNumber === 9;
}

/**
 * 설정의 셀 표를 물리·렌더가 함께 소비하는 결정적 원기둥 정의로 변환한다.
 */
export function computePinballObstacleDefinitions(
  cellSize: number,
  boardTop: number,
): PinballObstacleDefinition[] {
  if (
    !Number.isFinite(cellSize) ||
    cellSize <= 0 ||
    !Number.isFinite(boardTop)
  ) {
    throw new Error(
      `핀볼 장애물 배치 입력이 올바르지 않습니다: cellSize=${cellSize}, boardTop=${boardTop}`,
    );
  }
  const radius =
    (cellSize * PINBALL_OBSTACLE_DIAMETER_CELLS) / 2;
  const halfHeight = PINBALL_OBSTACLE_HEIGHT / 2;
  return PINBALL_OBSTACLE_CELLS.map((square, index) => {
    const center = getCellCenter(square, cellSize);
    return {
      id: `pinball-obstacle-${index}`,
      index,
      file: square.file,
      rank: square.rank,
      center: {
        x: center.x,
        y: boardTop + halfHeight,
        z: center.z,
      },
      radius,
      halfHeight,
    };
  });
}
