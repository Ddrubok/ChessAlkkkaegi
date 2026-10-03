import { G03_MAP } from "./g03";
import type { HotseatMapDefinition } from "./hotseat-map-types";

export const C04_MAP: HotseatMapDefinition = {
  ...G03_MAP,
  id: "gm-ice-gate-v1",
  revision: 1,
  surfaces: [
    {
      id: "ice-left",
      rectangle: { minU: -0.72, maxU: -0.22, minV: -0.22, maxV: 0.22 },
      material: "ice",
    },
    {
      id: "ice-right",
      rectangle: { minU: 0.22, maxU: 0.72, minV: -0.22, maxV: 0.22 },
      material: "ice",
    },
  ],
};
