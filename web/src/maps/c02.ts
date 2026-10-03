import type { ChessSetMeta } from "../assets";
import { STAGE_BOARD_SCALE, type PieceType } from "../config";
import type { ChessFile } from "../layout";
import { computeStageBoardHalfExtent } from "../stage";
import { computePocketKingBaseRadius, computePocketWallSegments } from "../walls";
import type { HotseatMapDefinition, HotseatMapSpawn } from "./hotseat-map-types";

export const C02_MAP_ID = "gm-ice-pockets-v1";

const whiteSpawns: readonly [string, PieceType, number, number][] = [
  ["rook", "Rook", -0.32, -0.80],
  ["king", "King", 0, -0.80],
  ["knight", "Knight", 0.32, -0.80],
  ["queen", "Queen", -0.16, -0.60],
  ["bishop", "Bishop", 0.16, -0.60],
  ["pawn-left", "Pawn", -0.32, -0.40],
  ["pawn-center", "Pawn", 0, -0.40],
  ["pawn-right", "Pawn", 0.32, -0.40],
];

export const C02_SPAWNS: readonly HotseatMapSpawn[] = (["white", "black"] as const).flatMap(side =>
  whiteSpawns.map(([id, type, u, v], index) => ({
    instance: {
      id: `${side}-${id}`,
      type,
      side,
      startingSquare: { file: "abcdefgh"[index] as ChessFile, rank: side === "white" ? 2 as const : 7 as const },
    },
    u: side === "white" ? u : -u,
    v: side === "white" ? v : -v,
  })),
);

/** Resolve the legacy stage-7 pocket geometry from the loaded set, without stage buffs. */
export function createC02MapDefinition(meta: ChessSetMeta): HotseatMapDefinition {
  const halfExtent = computeStageBoardHalfExtent(meta.cellSize, "stage", 2);
  const king = meta.pieces.King;
  const walls = computePocketWallSegments(halfExtent, 0, computePocketKingBaseRadius(king.colliderPoints, king.bounds.y));
  return {
    id: C02_MAP_ID,
    revision: 1,
    boardScale: STAGE_BOARD_SCALE,
    spawns: C02_SPAWNS,
    holes: [],
    surfaces: [
      { id: "ice-southwest", rectangle: { minU: -1, maxU: -0.45, minV: -1, maxV: -0.45 }, material: "ice" },
      { id: "ice-southeast", rectangle: { minU: 0.45, maxU: 1, minV: -1, maxV: -0.45 }, material: "ice" },
      { id: "ice-northwest", rectangle: { minU: -1, maxU: -0.45, minV: 0.45, maxV: 1 }, material: "ice" },
      { id: "ice-northeast", rectangle: { minU: 0.45, maxU: 1, minV: 0.45, maxV: 1 }, material: "ice" },
    ],
    objects: walls.map(wall => ({
      kind: "box",
      id: wall.id,
      u: -wall.center.x / halfExtent,
      v: wall.center.z / halfExtent,
      widthH: wall.halfExtents.x * 2 / halfExtent,
      depthH: wall.halfExtents.z * 2 / halfExtent,
      heightCells: wall.halfExtents.y * 2 / meta.cellSize,
    })),
  };
}
