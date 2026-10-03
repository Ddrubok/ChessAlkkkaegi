/** Only maps with an implemented hotseat board belong in this catalog. */
export interface HotseatMapCatalogEntry {
  id: string;
  revision: number;
  nameKey: string;
  descriptionKey: string;
}

export const DEFAULT_HOTSEAT_MAP_ID = "classic";

export const HOTSEAT_MAP_CATALOG: readonly HotseatMapCatalogEntry[] = [
  {
    id: DEFAULT_HOTSEAT_MAP_ID,
    revision: 1,
    nameKey: "hotseat_map.classic_name",
    descriptionKey: "hotseat_map.classic_description",
  },
  {
    id: "gm-push-blocks-v1",
    revision: 1,
    nameKey: "hotseat_map.g01_name",
    descriptionKey: "hotseat_map.g01_description",
  },
  {
    id: "gm-ice-lane-v1",
    revision: 1,
    nameKey: "hotseat_map.g02_name",
    descriptionKey: "hotseat_map.g02_description",
  },
  {
    id: "gm-rotating-gate-v1",
    revision: 1,
    nameKey: "hotseat_map.g03_name",
    descriptionKey: "hotseat_map.g03_description",
  },
  {
    id: "gm-bounce-corridor-v1",
    revision: 1,
    nameKey: "hotseat_map.g04_name",
    descriptionKey: "hotseat_map.g04_description",
  },
  {
    id: "gm-launch-ramps-v1",
    revision: 1,
    nameKey: "hotseat_map.g05_name",
    descriptionKey: "hotseat_map.g05_description",
  },
  {
    id: "gm-collapsing-center-v1",
    revision: 1,
    nameKey: "hotseat_map.g06_name",
    descriptionKey: "hotseat_map.g06_description",
  },
  {
    id: "gm-breakable-bridge-v1",
    revision: 1,
    nameKey: "hotseat_map.g07_name",
    descriptionKey: "hotseat_map.g07_description",
  },
  { id: "gm-control-square-v1", revision: 1, nameKey: "hotseat_map.g08_name", descriptionKey: "hotseat_map.g08_description" },
  { id: "gm-blocks-and-hole-v1", revision: 1, nameKey: "hotseat_map.c01_name", descriptionKey: "hotseat_map.c01_description" },
  { id: "gm-ice-pockets-v1", revision: 1, nameKey: "hotseat_map.c02_name", descriptionKey: "hotseat_map.c02_description" },
  { id: "gm-bounce-ramps-v1", revision: 1, nameKey: "hotseat_map.c03_name", descriptionKey: "hotseat_map.c03_description" },
  { id: "gm-ice-gate-v1", revision: 1, nameKey: "hotseat_map.c04_name", descriptionKey: "hotseat_map.c04_description" },
  { id: "gm-collapsing-crown-v1", revision: 1, nameKey: "hotseat_map.c05_name", descriptionKey: "hotseat_map.c05_description" },
];

export function getHotseatMap(id: string): HotseatMapCatalogEntry | undefined {
  return HOTSEAT_MAP_CATALOG.find(map => map.id === id);
}
