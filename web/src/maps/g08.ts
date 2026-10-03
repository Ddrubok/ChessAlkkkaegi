import { STAGE_BOARD_SCALE } from "../config";
import { COMMON_HOTSEAT_MAP_SPAWNS } from "./g01";
import type { HotseatMapDefinition } from "./hotseat-map-types";

export const G08_MAP: HotseatMapDefinition = {
  id: "gm-control-square-v1",
  revision: 1,
  boardScale: STAGE_BOARD_SCALE,
  spawns: COMMON_HOTSEAT_MAP_SPAWNS,
  holes: [],
  surfaces: [],
  objects: [],
  controlZone: { id: "control-center", rectangle: { minU: -.20, maxU: .20, minV: -.20, maxV: .20 }, speedMultiplier: 1.15 },
};
