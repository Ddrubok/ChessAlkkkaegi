import { STAGE_BOARD_SCALE } from "../config";
import { COMMON_HOTSEAT_MAP_SPAWNS } from "./g01";
import type { HotseatMapDefinition } from "./hotseat-map-types";

export const G07_MAP: HotseatMapDefinition = {
  id: "gm-breakable-bridge-v1",
  revision: 1,
  boardScale: STAGE_BOARD_SCALE,
  spawns: COMMON_HOTSEAT_MAP_SPAWNS,
  holes: [{ id: "moat", minU: -0.75, maxU: 0.75, minV: -0.12, maxV: 0.12 }],
  surfaces: [],
  objects: [{
    kind: "bridge",
    id: "bridge",
    deck: { minU: -0.14, maxU: 0.14, minV: -0.14, maxV: 0.14 },
    deckSupport: { minU: -0.14, maxU: 0.14, minV: -0.12, maxV: 0.12 },
    deckThicknessCells: 0.1,
    supports: [-0.18, 0.18].map((u, index) => ({
      id: index === 0 ? "support-left" : "support-right",
      u, v: 0, widthH: 0.06, depthH: 0.12, heightCells: 0.35,
    })),
    durability: 2,
    minApproachSpeedCells: 0.5,
  }],
};
