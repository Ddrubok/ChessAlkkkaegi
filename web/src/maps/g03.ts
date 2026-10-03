import { STAGE_BOARD_SCALE } from "../config";
import { COMMON_HOTSEAT_MAP_SPAWNS } from "./g01";
import type { HotseatMapDefinition } from "./hotseat-map-types";

export const G03_MAP: HotseatMapDefinition = {
  id: "gm-rotating-gate-v1",
  revision: 1,
  boardScale: STAGE_BOARD_SCALE,
  spawns: COMMON_HOTSEAT_MAP_SPAWNS,
  holes: [],
  surfaces: [],
  objects: [{
    kind: "gate",
    id: "gate-main",
    u: 0,
    v: 0,
    lengthH: 0.56,
    thicknessH: 0.05,
    heightCells: 0.45,
    massPawnMultiple: 3,
    limitDegrees: 75,
  }],
};
