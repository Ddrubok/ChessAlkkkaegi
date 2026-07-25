import type { PieceType } from "./config";

export type PieceSide = "white" | "black";
export type ChessFile = "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h";
export type ChessRank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface StartingSquare {
  file: ChessFile;
  rank: ChessRank;
}

export interface PieceInstance {
  // 강화와 교체가 생겨도 같은 말을 추적할 수 있는 개체 식별자다.
  id: string;
  type: PieceType;
  side: PieceSide;
  // 파일 문자와 랭크 숫자를 함께 보존해 좌우 반전된 배치를 만들지 않게 한다.
  startingSquare: StartingSquare;
}

export interface CellCenter {
  x: number;
  z: number;
}

// 백 시점의 화면 왼쪽이 월드 +x이므로 a파일부터 x를 감소시켜 표준 좌우 배치를 보존한다.
const FILES: readonly ChessFile[] = [
  "a",
  "b",
  "c",
  "d",
  "e",
  "f",
  "g",
  "h",
];

// 양쪽 첫 랭크가 퀸 d파일과 킹 e파일을 공유하도록 표준 순서를 명시한다.
const BACK_RANK: readonly PieceType[] = [
  "Rook",
  "Knight",
  "Bishop",
  "Queen",
  "King",
  "Bishop",
  "Knight",
  "Rook",
];

/**
 * 한 진영의 개별 말을 고유 id와 명시적인 시작 칸으로 만든다.
 */
function createSideInstances(side: PieceSide): PieceInstance[] {
  const backRank: ChessRank = side === "white" ? 1 : 8;
  const pawnRank: ChessRank = side === "white" ? 2 : 7;
  const backPieces = FILES.map(
    (file, index): PieceInstance => ({
      id: `${side}-${BACK_RANK[index].toLowerCase()}-${file}${backRank}`,
      type: BACK_RANK[index],
      side,
      startingSquare: { file, rank: backRank },
    }),
  );
  const pawns = FILES.map(
    (file): PieceInstance => ({
      id: `${side}-pawn-${file}${pawnRank}`,
      type: "Pawn",
      side,
      startingSquare: { file, rank: pawnRank },
    }),
  );
  return [...backPieces, ...pawns];
}

// 향후 개체별 강화 상태가 붙을 수 있도록 칸 매핑 대신 32개 말 목록을 공개한다.
export const PIECE_INSTANCES: readonly PieceInstance[] = [
  ...createSideInstances("white"),
  ...createSideInstances("black"),
];

/**
 * 파일과 랭크를 백 진영이 음의 z에 놓이는 월드 셀 중심으로 변환한다.
 */
export function getCellCenter(
  square: StartingSquare,
  cellSize: number,
): CellCenter {
  const fileIndex = FILES.indexOf(square.file);
  const rankIndex = square.rank - 1;
  if (fileIndex < 0) {
    throw new Error(`알 수 없는 체스 파일 ${square.file}입니다.`);
  }
  return {
    x: (3.5 - fileIndex) * cellSize,
    z: (rankIndex - 3.5) * cellSize,
  };
}
