import RAPIER from "@dimforge/rapier3d-compat";
import { BoxGeometry, Mesh, MeshStandardMaterial } from "three";
import { PIECE_RESTITUTION } from "../config";
import {
  mapPointToWorld,
  type HotseatMapCreationContext,
  type HotseatMapObjectBinding,
  type HotseatStaticBoxDefinition,
} from "./hotseat-map-types";

export function createHotseatStaticBox(
  definition: HotseatStaticBoxDefinition,
  context: HotseatMapCreationContext,
): HotseatMapObjectBinding {
  const position = mapPointToWorld(definition.u, definition.v, context.halfExtent);
  const width = definition.widthH * context.halfExtent;
  const depth = definition.depthH * context.halfExtent;
  const height = definition.heightCells * context.cellSize;
  const bumper = definition.kind === "bumper";
  const body = context.world.createRigidBody(RAPIER.RigidBodyDesc.fixed()
    .setTranslation(position.x, context.boardTop + height / 2, position.z));
  const colliderDescriptor = RAPIER.ColliderDesc.cuboid(width / 2, height / 2, depth / 2)
    .setFriction(context.friction)
    .setRestitution(definition.restitution ?? (bumper ? 0.9 : PIECE_RESTITUTION));
  // Max prevents the piece's normal restitution from diluting the bumper.
  // No impulse or velocity is added while a piece remains in contact.
  if (bumper) colliderDescriptor.setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max);
  const collider = context.world.createCollider(colliderDescriptor, body);
  const frame = new MeshStandardMaterial({ color: bumper ? 0x644b2e : 0x77838a, roughness: 0.8 });
  const face = bumper ? new MeshStandardMaterial({ color: 0xf3bc4d, roughness: 0.5, metalness: 0.1 }) : undefined;
  const mesh = new Mesh(new BoxGeometry(width, height, depth), face ? [face, face, frame, frame, frame, frame] : frame);
  if (bumper) {
    // Both long faces carry a tactile stripe pattern; every collider face bounces.
    for (const side of [-1, 1]) for (const offset of [-0.3, 0, 0.3]) {
      const stripe = new Mesh(
        new BoxGeometry(context.cellSize * 0.004, height * 0.1, depth * 0.19),
        new MeshStandardMaterial({ color: 0x6b4a14, roughness: 0.65 }),
      );
      stripe.position.set(side * (width / 2 + context.cellSize * 0.002), 0, offset * depth);
      stripe.rotation.x = Math.PI / 8;
      mesh.add(stripe);
    }
  }
  mesh.name = `map-${definition.id}`;
  mesh.position.set(position.x, context.boardTop + height / 2, position.z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return { definition, body, collider, mesh };
}
