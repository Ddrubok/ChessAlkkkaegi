import RAPIER from "@dimforge/rapier3d-compat";
import { CanvasTexture, Mesh, MeshStandardMaterial, NearestFilter, SRGBColorSpace } from "three";
import type { ChessSetMeta } from "../assets";
import { computeBoardSurfaceLayout, createBoardFloorGeometry } from "../board";
import type { BoardFloorRectangle, BoardHoleRectangle } from "../holes";
import type { PhysicsRuntime } from "../physics";
import type { SceneRuntime } from "../scene";
import type { HotseatMapDefinition, HotseatMapSurface, MapRectangle } from "./hotseat-map-types";

export const ICE_FRICTION = 0.005;
export interface MapFloorRectangle extends BoardFloorRectangle {
  surfaceId: string;
  material: HotseatMapSurface["material"];
}
export interface HotseatMapFloorLayout {
  rectangles: MapFloorRectangle[];
  holes: BoardHoleRectangle[];
  key: string;
}
const colliderMaterials = new WeakMap<RAPIER.Collider, HotseatMapSurface["material"]>();
const colliderSurfaceIds = new WeakMap<RAPIER.Collider, string>();

export function getBoardSurfaceId(collider: RAPIER.Collider): string | undefined {
  return colliderSurfaceIds.get(collider);
}

function worldRectangle(rectangle: MapRectangle, halfExtent: number): BoardFloorRectangle {
  return { minX: -rectangle.maxU * halfExtent, maxX: -rectangle.minU * halfExtent,
    minZ: rectangle.minV * halfExtent, maxZ: rectangle.maxV * halfExtent };
}

/** One partition serves both the visible floor and its colliders. */
export function computeHotseatMapFloorLayout(definition: HotseatMapDefinition, halfExtent: number): HotseatMapFloorLayout {
  const holes = definition.holes.map(hole => ({ id: hole.id, ...worldRectangle(hole, halfExtent) }));
  const surfaces = definition.surfaces.map(surface => ({ ...surface, world: worldRectangle(surface.rectangle, halfExtent) }));
  const regions = [...holes, ...surfaces.map(surface => surface.world)];
  for (const region of regions) {
    if (![region.minX, region.maxX, region.minZ, region.maxZ].every(Number.isFinite)
      || region.minX >= region.maxX || region.minZ >= region.maxZ
      || region.minX < -halfExtent || region.maxX > halfExtent || region.minZ < -halfExtent || region.maxZ > halfExtent) {
      throw new Error(`${definition.id}: invalid floor region`);
    }
  }
  const boundaries = (axis: "X" | "Z") => [...new Set([-halfExtent, halfExtent,
    ...regions.flatMap(region => axis === "X" ? [region.minX, region.maxX] : [region.minZ, region.maxZ])])].sort((a, b) => a - b);
  const xs = boundaries("X"), zs = boundaries("Z");
  const contains = (rectangle: BoardFloorRectangle, x: number, z: number) => x > rectangle.minX && x < rectangle.maxX && z > rectangle.minZ && z < rectangle.maxZ;
  const rectangles: MapFloorRectangle[] = [];
  for (let xi = 0; xi < xs.length - 1; xi++) {
    for (let zi = 0; zi < zs.length - 1; zi++) {
      const x = (xs[xi] + xs[xi + 1]) / 2, z = (zs[zi] + zs[zi + 1]) / 2;
      const matching = surfaces.filter(surface => contains(surface.world, x, z));
      const hole = holes.some(region => contains(region, x, z));
      if (matching.length > 1 || (hole && matching.length > 0)) throw new Error(`${definition.id}: overlapping floor regions`);
      if (hole) continue;
      rectangles.push({ minX: xs[xi], maxX: xs[xi + 1], minZ: zs[zi], maxZ: zs[zi + 1],
        surfaceId: matching[0]?.id ?? "normal", material: matching[0]?.material ?? "normal" });
    }
  }
  if (rectangles.length === 0) throw new Error(`${definition.id}: floor is empty`);
  return { rectangles, holes, key: JSON.stringify({ id: definition.id, revision: definition.revision, halfExtent, rectangles, holes }) };
}

export function getBoardSurfaceFriction(collider: RAPIER.Collider, normalFriction: number): number {
  return colliderMaterials.get(collider) === "ice" ? ICE_FRICTION : normalFriction;
}

export function applyBoardSurfaceFriction(colliders: readonly RAPIER.Collider[], normalFriction: number): void {
  for (const collider of colliders) collider.setFriction(getBoardSurfaceFriction(collider, normalFriction));
}

function createFloorCollider(runtime: PhysicsRuntime, rectangle: BoardFloorRectangle, thickness: number,
  friction: number, restitution: number, frictionRule = RAPIER.CoefficientCombineRule.Average,
  restitutionRule = RAPIER.CoefficientCombineRule.Average): RAPIER.Collider {
  return runtime.world.createCollider(RAPIER.ColliderDesc.cuboid((rectangle.maxX - rectangle.minX) / 2, thickness / 2,
    (rectangle.maxZ - rectangle.minZ) / 2).setTranslation((rectangle.minX + rectangle.maxX) / 2, 0, (rectangle.minZ + rectangle.maxZ) / 2)
    .setFriction(friction).setRestitution(restitution).setFrictionCombineRule(frictionRule).setRestitutionCombineRule(restitutionRule), runtime.boardBody);
}

/** Replaces only the board colliders; its body, pieces and legacy rules stay intact. */
export function installHotseatMapPhysicsFloor(runtime: PhysicsRuntime, meta: ChessSetMeta, layout: HotseatMapFloorLayout): () => void {
  const previous = { rectangles: runtime.boardFloorRectangles, holes: runtime.boardHoleRectangles, key: runtime.boardFloorLayoutKey,
    materials: runtime.boardColliders.map(collider => ({ friction: collider.friction(), restitution: collider.restitution(),
      frictionRule: collider.frictionCombineRule(), restitutionRule: collider.restitutionCombineRule() })) };
  const normal = previous.materials[0];
  for (const collider of runtime.boardColliders) runtime.world.removeCollider(collider, false);
  runtime.boardColliders = layout.rectangles.map(rectangle => {
    const collider = createFloorCollider(runtime, rectangle, meta.boardThickness, rectangle.material === "ice" ? ICE_FRICTION : normal.friction,
      normal.restitution, rectangle.material === "ice" ? RAPIER.CoefficientCombineRule.Min : normal.frictionRule, normal.restitutionRule);
    colliderMaterials.set(collider, rectangle.material);
    colliderSurfaceIds.set(collider, rectangle.surfaceId);
    return collider;
  });
  runtime.boardCollider = runtime.boardColliders[0];
  runtime.boardFloorRectangles = layout.rectangles;
  runtime.boardHoleRectangles = layout.holes;
  runtime.boardFloorLayoutKey = layout.key;
  return () => {
    for (const collider of runtime.boardColliders) runtime.world.removeCollider(collider, false);
    runtime.boardColliders = previous.rectangles.map((rectangle, index) => {
      const material = previous.materials[index];
      return createFloorCollider(runtime, rectangle, meta.boardThickness, material.friction, material.restitution, material.frictionRule, material.restitutionRule);
    });
    runtime.boardCollider = runtime.boardColliders[0];
    runtime.boardFloorRectangles = previous.rectangles;
    runtime.boardHoleRectangles = previous.holes;
    runtime.boardFloorLayoutKey = previous.key;
  };
}

function createSurfaceTexture(rectangle: MapFloorRectangle, halfExtent: number, cellSize: number): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil((rectangle.maxX - rectangle.minX) / cellSize * 128);
  canvas.height = Math.ceil((rectangle.maxZ - rectangle.minZ) / cellSize * 128);
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("Cannot draw map floor texture");
  const scaleX = canvas.width / (rectangle.maxX - rectangle.minX), scaleZ = canvas.height / (rectangle.maxZ - rectangle.minZ);
  const checkerHalf = computeBoardSurfaceLayout(cellSize, halfExtent).checkerHalfExtent;
  context.fillStyle = rectangle.material === "ice" ? "#8bb5c6" : "#4b3023";
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (let x = Math.floor(rectangle.minX / cellSize); x < Math.ceil(rectangle.maxX / cellSize); x++) {
    for (let z = Math.floor(rectangle.minZ / cellSize); z < Math.ceil(rectangle.maxZ / cellSize); z++) {
      const minX = Math.max(x * cellSize, rectangle.minX, -checkerHalf), maxX = Math.min((x + 1) * cellSize, rectangle.maxX, checkerHalf);
      const minZ = Math.max(z * cellSize, rectangle.minZ, -checkerHalf), maxZ = Math.min((z + 1) * cellSize, rectangle.maxZ, checkerHalf);
      if (maxX <= minX || maxZ <= minZ) continue;
      context.fillStyle = rectangle.material === "ice" ? ((x + z) & 1 ? "#8bb9ce" : "#cee9ef") : ((x + z) & 1 ? "#7b4d35" : "#e3d2b2");
      context.fillRect((minX - rectangle.minX) * scaleX, (minZ - rectangle.minZ) * scaleZ, (maxX - minX) * scaleX, (maxZ - minZ) * scaleZ);
    }
  }
  if (rectangle.material === "ice") {
    context.strokeStyle = "rgba(248,255,255,0.65)";
    context.lineWidth = 2;
    for (let x = 30; x < canvas.width; x += 95) {
      context.beginPath(); context.moveTo(x, canvas.height * .28); context.lineTo(x + 17, canvas.height * .45);
      context.lineTo(x + 8, canvas.height * .67); context.stroke();
    }
    context.strokeStyle = "#43839c"; context.lineWidth = 4; context.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace; texture.magFilter = NearestFilter;
  return texture;
}

export function installHotseatMapSceneFloor(runtime: SceneRuntime, meta: ChessSetMeta, layout: HotseatMapFloorLayout): () => void {
  const previous = { meshes: runtime.boardMeshes, rectangles: runtime.boardFloorRectangles, holes: runtime.boardHoleRectangles,
    key: runtime.boardFloorLayoutKey, visibility: runtime.boardMeshes.map(mesh => mesh.visible) };
  const meshes = layout.rectangles.map((rectangle, index) => {
    const side = new MeshStandardMaterial({ color: 0x36251f, roughness: .84 });
    const top = new MeshStandardMaterial({ map: createSurfaceTexture(rectangle, runtime.boardHalfExtent, meta.cellSize), roughness: rectangle.material === "ice" ? .4 : .72 });
    const mesh = new Mesh(createBoardFloorGeometry(rectangle, meta.boardThickness), [side, side, top, side, side, side]);
    mesh.name = `MapFloor-${rectangle.surfaceId}-${index}`;
    mesh.position.set((rectangle.minX + rectangle.maxX) / 2, runtime.boardTop - meta.boardThickness / 2, (rectangle.minZ + rectangle.maxZ) / 2);
    mesh.receiveShadow = true; return mesh;
  });
  for (const mesh of previous.meshes) mesh.visible = false;
  runtime.scene.add(...meshes); runtime.boardMeshes = meshes; runtime.boardMesh = meshes[0];
  runtime.boardFloorRectangles = layout.rectangles; runtime.boardHoleRectangles = layout.holes; runtime.boardFloorLayoutKey = layout.key;
  return () => {
    for (const mesh of meshes) {
      runtime.scene.remove(mesh); mesh.geometry.dispose();
      for (const material of new Set(mesh.material as MeshStandardMaterial[])) { material.map?.dispose(); material.dispose(); }
    }
    previous.meshes.forEach((mesh, index) => { mesh.visible = previous.visibility[index]; });
    runtime.boardMeshes = previous.meshes; runtime.boardMesh = previous.meshes[0];
    runtime.boardFloorRectangles = previous.rectangles; runtime.boardHoleRectangles = previous.holes; runtime.boardFloorLayoutKey = previous.key;
  };
}

export function installHotseatMapSurfaces(physicsRuntime: PhysicsRuntime, sceneRuntime: SceneRuntime,
  meta: ChessSetMeta, definition: HotseatMapDefinition): () => void {
  const layout = computeHotseatMapFloorLayout(definition, physicsRuntime.boardHalfExtent);
  const disposePhysics = installHotseatMapPhysicsFloor(physicsRuntime, meta, layout);
  const disposeScene = installHotseatMapSceneFloor(sceneRuntime, meta, layout);
  return () => { disposeScene(); disposePhysics(); };
}
