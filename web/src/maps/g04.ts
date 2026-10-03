import { STAGE_BOARD_SCALE } from "../config";
import { COMMON_HOTSEAT_MAP_SPAWNS } from "./g01";
import type { HotseatMapDefinition } from "./hotseat-map-types";

export const G04_MAP: HotseatMapDefinition = {
  id: "gm-bounce-corridor-v1",
  revision: 1,
  boardScale: STAGE_BOARD_SCALE,
  spawns: COMMON_HOTSEAT_MAP_SPAWNS,
  holes: [],
  surfaces: [],
  objects: [
    { kind: "bumper", id: "bumper-left", u: -0.72, v: 0, widthH: 0.08, depthH: 0.60, heightCells: 0.55, restitution: 0.9 },
    { kind: "bumper", id: "bumper-right", u: 0.72, v: 0, widthH: 0.08, depthH: 0.60, heightCells: 0.55, restitution: 0.9 },
    { kind: "box", id: "center-cover", u: 0, v: 0, widthH: 0.20, depthH: 0.28, heightCells: 0.35 },
  ],
};
