import { STAGE_BOARD_SCALE } from "../config";
import { COMMON_HOTSEAT_MAP_SPAWNS } from "./g01";
import type { HotseatMapDefinition } from "./hotseat-map-types";

export const G05_MAP: HotseatMapDefinition = {
  id: "gm-launch-ramps-v1",
  revision: 1,
  boardScale: STAGE_BOARD_SCALE,
  spawns: COMMON_HOTSEAT_MAP_SPAWNS.map(spawn => spawn.instance.id.endsWith("pawn-center")
    ? { ...spawn, v: spawn.instance.side === "white" ? -0.64 : 0.64 }
    : spawn),
  holes: [],
  surfaces: [],
  objects: [
    { kind: "ramp", id: "ramp-south", u: 0, v: -0.38, widthH: 0.28, depthH: 0.36, slopeDegrees: 12, directionV: 1, friction: 0.45 },
    { kind: "ramp", id: "ramp-north", u: 0, v: 0.38, widthH: 0.28, depthH: 0.36, slopeDegrees: 12, directionV: -1, friction: 0.45 },
    { kind: "box", id: "low-center-wall", u: 0, v: 0, widthH: 0.42, depthH: 0.035, heightCells: 0.18 },
  ],
};
