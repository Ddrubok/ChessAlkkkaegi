import type { ChessFile, PieceSide } from "../layout";
import { STAGE_BOARD_SCALE, type PieceType } from "../config";
import type { HotseatMapDefinition, HotseatMapSpawn } from "./hotseat-map-types";

const whiteSpawns: readonly [string, PieceType, number, number][] = [
  ["rook", "Rook", -0.64, -0.80],
  ["queen", "Queen", -0.32, -0.80],
  ["king", "King", 0, -0.80],
  ["bishop", "Bishop", 0.32, -0.80],
  ["knight", "Knight", 0.64, -0.80],
  ["pawn-left", "Pawn", -0.48, -0.57],
  ["pawn-center", "Pawn", 0, -0.57],
  ["pawn-right", "Pawn", 0.48, -0.57],
];

export const COMMON_HOTSEAT_MAP_SPAWNS: readonly HotseatMapSpawn[] = (["white", "black"] as const).flatMap((side: PieceSide) =>
  whiteSpawns.map(([id, type, u, v], index) => ({
    instance: {
      id: `${side}-${id}`,
      type,
      side,
      startingSquare: {
        file: "abcdefgh"[index] as ChessFile,
        rank: side === "white" ? 2 as const : 7 as const,
      },
    },
    u: side === "white" ? u : -u,
    v: side === "white" ? v : -v,
  })),
);

export const G01_MAP: HotseatMapDefinition = {
  id: "gm-push-blocks-v1",
  revision: 1,
  boardScale: STAGE_BOARD_SCALE,
  spawns: COMMON_HOTSEAT_MAP_SPAWNS,
  holes: [],
  surfaces: [],
  objects: [-0.28, 0.28].map((u, index) => ({
    kind: "block",
    id: index === 0 ? "block-left" : "block-right",
    u,
    v: 0,
    widthH: 0.22,
    depthH: 0.16,
    heightCells: 0.45,
    massPawnMultiple: 2,
  })),
};
