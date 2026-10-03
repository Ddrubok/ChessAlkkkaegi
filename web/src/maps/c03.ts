import { STAGE_BOARD_SCALE } from "../config";
import { COMMON_HOTSEAT_MAP_SPAWNS } from "./g01";
import type { HotseatMapDefinition } from "./hotseat-map-types";

export const C03_MAP: HotseatMapDefinition = {
  id: "gm-bounce-ramps-v1",
  revision: 1,
  boardScale: STAGE_BOARD_SCALE,
  spawns: COMMON_HOTSEAT_MAP_SPAWNS,
  holes: [],
  surfaces: [],
  objects: [
    { kind: "ramp", id: "ramp-southwest", u: -0.25, v: -0.32, widthH: 0.28, depthH: 0.36, slopeDegrees: 12, directionV: 1, friction: 0.45 },
    { kind: "ramp", id: "ramp-northeast", u: 0.25, v: 0.32, widthH: 0.28, depthH: 0.36, slopeDegrees: 12, directionV: -1, friction: 0.45 },
    { kind: "bumper", id: "bumper-northwest", u: -0.68, v: 0.15, widthH: 0.08, depthH: 0.36, heightCells: 0.55, restitution: 0.9 },
    { kind: "bumper", id: "bumper-southeast", u: 0.68, v: -0.15, widthH: 0.08, depthH: 0.36, heightCells: 0.55, restitution: 0.9 },
  ],
};
