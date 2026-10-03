import type RAPIER from "@dimforge/rapier3d-compat";
import type { Mesh } from "three";
import type { PieceInstance } from "../layout";

export interface MapRectangle {
  minU: number;
  maxU: number;
  minV: number;
  maxV: number;
}

export interface HotseatMapSpawn {
  instance: PieceInstance;
  u: number;
  v: number;
}

export interface HotseatMapSurface {
  id: string;
  rectangle: MapRectangle;
  material: "normal" | "ice";
  collapseAfterShots?: number;
}

export interface HotseatBlockDefinition {
  kind: "block";
  id: string;
  u: number;
  v: number;
  widthH: number;
  depthH: number;
  heightCells: number;
  massPawnMultiple: number;
}

export interface HotseatGateDefinition {
  kind: "gate";
  id: string;
  u: number;
  v: number;
  lengthH: number;
  thicknessH: number;
  heightCells: number;
  massPawnMultiple: number;
  limitDegrees: number;
}

export interface HotseatStaticBoxDefinition {
  kind: "box" | "bumper";
  id: string;
  u: number;
  v: number;
  widthH: number;
  depthH: number;
  heightCells: number;
  restitution?: number;
}

export interface HotseatRampDefinition {
  kind: "ramp";
  id: string;
  u: number;
  v: number;
  widthH: number;
  depthH: number;
  slopeDegrees: number;
  directionV: 1 | -1;
  friction?: number;
}

export interface HotseatBridgeDefinition {
  kind: "bridge";
  id: string;
  deck: MapRectangle;
  // Only the part over the hole needs a collider; the banks already support its ends.
  deckSupport: MapRectangle;
  deckThicknessCells: number;
  supports: readonly { id: string; u: number; v: number; widthH: number; depthH: number; heightCells: number }[];
  durability: number;
  minApproachSpeedCells: number;
}

export type HotseatMapObjectDefinition = HotseatBlockDefinition | HotseatGateDefinition | HotseatStaticBoxDefinition | HotseatRampDefinition | HotseatBridgeDefinition;

export interface HotseatMapDefinition {
  id: string;
  revision: number;
  boardScale: number;
  spawns: readonly HotseatMapSpawn[];
  holes: readonly (MapRectangle & { id: string })[];
  surfaces: readonly HotseatMapSurface[];
  objects: readonly HotseatMapObjectDefinition[];
  controlZone?: { id: string; rectangle: MapRectangle; speedMultiplier: number };
}

export interface HotseatMapCreationContext {
  world: RAPIER.World;
  boardTop: number;
  cellSize: number;
  halfExtent: number;
  pawnMass: number;
  friction: number;
}

export interface HotseatMapObjectBinding {
  definition: HotseatMapObjectDefinition;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  additionalColliders?: readonly RAPIER.Collider[];
  mesh: Mesh;
  // A gate owns its anchor and joint in addition to its moving body.
  anchorBody?: RAPIER.RigidBody;
  joint?: RAPIER.ImpulseJoint;
  tipRadius?: number;
}

export interface HotseatMapRuntime {
  definition: HotseatMapDefinition;
  dynamicObjects: Map<string, HotseatMapObjectBinding>;
  fallenObjectIds: Set<string>;
  disposeSurfaces?: () => void;
  disposeControlZone?: () => void;
}

/** White's screen left corresponds to world +x. */
export function mapPointToWorld(u: number, v: number, halfExtent: number): { x: number; z: number } {
  return { x: -u * halfExtent, z: v * halfExtent };
}
