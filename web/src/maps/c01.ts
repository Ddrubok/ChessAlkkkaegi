import { STAGE_BOARD_SCALE } from "../config";
import { COMMON_HOTSEAT_MAP_SPAWNS } from "./g01";
import type { HotseatMapDefinition } from "./hotseat-map-types";

/** C01 combines neutral pushable blocks with a real hole, without stage 5 walls. */
export const C01_MAP: HotseatMapDefinition = {
  id: "gm-blocks-and-hole-v1",
  revision: 1,
  boardScale: STAGE_BOARD_SCALE,
  spawns: COMMON_HOTSEAT_MAP_SPAWNS,
  holes: [{ id: "center-hole", minU: -0.18, maxU: 0.18, minV: -0.18, maxV: 0.18 }],
  surfaces: [],
  objects: [-0.36, 0.36].map((u, index) => ({
    kind: "block",
    id: index === 0 ? "block-left" : "block-right",
    u,
    v: 0,
    widthH: 0.20,
    depthH: 0.16,
    heightCells: 0.45,
    massPawnMultiple: 2,
  })),
};
