import RAPIER from "@dimforge/rapier3d-compat";
import { BufferGeometry, Float32BufferAttribute, Mesh, MeshStandardMaterial } from "three";
import { PIECE_RESTITUTION } from "../config";
import { mapPointToWorld, type HotseatMapCreationContext, type HotseatMapObjectBinding, type HotseatRampDefinition } from "./hotseat-map-types";

/** The low edge is exactly at local y=0; the closed high end rises in directionV. */
export function computeHotseatRampShape(definition: HotseatRampDefinition, halfExtent: number) {
  const width = definition.widthH * halfExtent;
  const depth = definition.depthH * halfExtent;
  const height = depth * Math.tan(definition.slopeDegrees * Math.PI / 180);
  const lowZ = -depth / 2 * definition.directionV;
  const highZ = depth / 2 * definition.directionV;
  const vertices = new Float32Array([
    -width / 2, 0, lowZ, width / 2, 0, lowZ,
    -width / 2, 0, highZ, width / 2, 0, highZ,
    -width / 2, height, highZ, width / 2, height, highZ,
  ]);
  const indices = [0, 1, 3, 0, 3, 2, 0, 4, 5, 0, 5, 1, 2, 3, 5, 2, 5, 4, 0, 2, 4, 1, 5, 3];
  if (definition.directionV === -1) {
    for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
  }
  return { width, depth, height, vertices, indices };
}

export function createHotseatRamp(definition: HotseatRampDefinition, context: HotseatMapCreationContext): HotseatMapObjectBinding {
  const center = mapPointToWorld(definition.u, definition.v, context.halfExtent);
  const { width, depth, height, vertices, indices } = computeHotseatRampShape(definition, context.halfExtent);
  const descriptor = RAPIER.ColliderDesc.convexHull(vertices);
  if (!descriptor) throw new Error(`Ramp ${definition.id} convex hull could not be created.`);
  const body = context.world.createRigidBody(RAPIER.RigidBodyDesc.fixed()
    .setTranslation(center.x, context.boardTop, center.z));
  const collider = context.world.createCollider(descriptor
    .setFriction(definition.friction ?? context.friction)
    .setRestitution(PIECE_RESTITUTION), body);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new Mesh(geometry, new MeshStandardMaterial({ color: 0x718797, roughness: 0.85, flatShading: true }));
  mesh.name = `map-${definition.id}`;
  mesh.position.set(center.x, context.boardTop, center.z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  // Two chevrons on the actual inclined face make the ascent legible without a color key.
  const marks = new BufferGeometry();
  const markVertices: number[] = [];
  for (const fraction of [0.38, 0.66]) {
    for (const [x, step] of [[-width * 0.28, -0.055], [width * 0.28, -0.055], [0, 0.065]] as const) {
      const progress = fraction + step;
      markVertices.push(x, height * progress + 0.002, (progress - 0.5) * depth * definition.directionV);
    }
  }
  marks.setAttribute("position", new Float32BufferAttribute(markVertices, 3));
  marks.setIndex(definition.directionV === 1 ? [0, 2, 1, 3, 5, 4] : [0, 1, 2, 3, 4, 5]);
  marks.computeVertexNormals();
  const chevrons = new Mesh(marks, new MeshStandardMaterial({ color: 0xf3df91, roughness: 0.9 }));
  mesh.add(chevrons);
  return { definition, body, collider, mesh };
}
