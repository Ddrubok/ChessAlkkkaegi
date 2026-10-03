import { STAGE_BOARD_SCALE } from "../config";
import { COMMON_HOTSEAT_MAP_SPAWNS } from "./g01";
import type { HotseatMapDefinition } from "./hotseat-map-types";

export const G02_MAP: HotseatMapDefinition = {
  id: "gm-ice-lane-v1",
  revision: 1,
  boardScale: STAGE_BOARD_SCALE,
  spawns: COMMON_HOTSEAT_MAP_SPAWNS,
  holes: [],
  surfaces: [{
    id: "ice-center",
    rectangle: { minU: -1, maxU: 1, minV: -0.20, maxV: 0.20 },
    material: "ice",
  }],
  objects: [],
};
