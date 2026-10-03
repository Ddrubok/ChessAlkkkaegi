import { STAGE_BOARD_SCALE } from "../config";
import { COMMON_HOTSEAT_MAP_SPAWNS } from "./g01";
import type { HotseatMapDefinition } from "./hotseat-map-types";

export const C05_MAP: HotseatMapDefinition = {
  id: "gm-collapsing-crown-v1",
  revision: 1,
  boardScale: STAGE_BOARD_SCALE,
  spawns: COMMON_HOTSEAT_MAP_SPAWNS.map(spawn => spawn.instance.id.endsWith("pawn-center")
    ? { ...spawn, v: spawn.instance.side === "white" ? -0.64 : 0.64 }
    : spawn),
  holes: [],
  // The central plaza and its diagonal approaches remain ordinary supporting floor.
  surfaces: [
    { id: "collapse-south", rectangle: { minU: -.08, maxU: .08, minV: -.50, maxV: -.28 }, material: "normal", collapseAfterShots: 6 },
    { id: "collapse-north", rectangle: { minU: -.08, maxU: .08, minV: .28, maxV: .50 }, material: "normal", collapseAfterShots: 6 },
    { id: "collapse-west", rectangle: { minU: -.50, maxU: -.28, minV: -.08, maxV: .08 }, material: "normal", collapseAfterShots: 10 },
    { id: "collapse-east", rectangle: { minU: .28, maxU: .50, minV: -.08, maxV: .08 }, material: "normal", collapseAfterShots: 10 },
  ],
  objects: [],
  controlZone: { id: "control-center", rectangle: { minU: -.20, maxU: .20, minV: -.20, maxV: .20 }, speedMultiplier: 1.15 },
};
