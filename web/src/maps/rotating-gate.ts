import RAPIER from "@dimforge/rapier3d-compat";
import { BoxGeometry, CylinderGeometry, Mesh, MeshStandardMaterial } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { PIECE_RESTITUTION } from "../config";
import {
  mapPointToWorld,
  type HotseatGateDefinition,
  type HotseatMapCreationContext,
  type HotseatMapObjectBinding,
} from "./hotseat-map-types";

// Passive damping lets a lightly struck door settle before the eight-second limit.
const GATE_ANGULAR_DAMPING = 1.5;

export function createHotseatGate(
  definition: HotseatGateDefinition,
  context: HotseatMapCreationContext,
): HotseatMapObjectBinding {
  const length = definition.lengthH * context.halfExtent;
  const thickness = definition.thicknessH * context.halfExtent;
  const height = definition.heightCells * context.cellSize;
  const anchorRadius = thickness * 0.35;
  const anchorHeight = height * 1.08;
  const position = mapPointToWorld(definition.u, definition.v, context.halfExtent);
  const centerY = context.boardTop + height / 2;
  const anchorBody = context.world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, centerY, position.z),
  );
  context.world.createCollider(
    RAPIER.ColliderDesc.cylinder(anchorHeight / 2, anchorRadius)
      .setFriction(context.friction)
      .setRestitution(PIECE_RESTITUTION),
    anchorBody,
  );
  const body = context.world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, centerY, position.z)
      .setAngularDamping(GATE_ANGULAR_DAMPING)
      .setAdditionalSolverIterations(4)
      .setCcdEnabled(true),
  );
  const collider = context.world.createCollider(
    RAPIER.ColliderDesc.cuboid(length / 2, height / 2, thickness / 2)
      .setMass(definition.massPawnMultiple * context.pawnMass)
      .setFriction(context.friction)
      .setRestitution(PIECE_RESTITUTION),
    body,
  );
  const joint = context.world.createImpulseJoint(
    RAPIER.JointData.revolute(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
    ),
    anchorBody,
    body,
    true,
  ) as RAPIER.RevoluteImpulseJoint;
  const limit = definition.limitDegrees * Math.PI / 180;
  joint.setLimits(-limit, limit);
  // The pin sits inside the door; only their contacts with other bodies are needed.
  joint.setContactsEnabled(false);

  const barGeometry = new BoxGeometry(length, height, thickness);
  const anchorGeometry = new CylinderGeometry(anchorRadius, anchorRadius, anchorHeight, 24);
  const geometry = mergeGeometries([barGeometry, anchorGeometry], true)!;
  barGeometry.dispose();
  anchorGeometry.dispose();
  const mesh = new Mesh(geometry, [
    new MeshStandardMaterial({ color: 0xc69655, roughness: 0.65, metalness: 0.05 }),
    new MeshStandardMaterial({ color: 0x52616a, roughness: 0.4, metalness: 0.55 }),
  ]);
  mesh.name = `map-${definition.id}`;
  mesh.position.set(position.x, centerY, position.z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  return {
    definition,
    body,
    collider,
    mesh,
    anchorBody,
    joint,
    tipRadius: Math.hypot(length / 2, thickness / 2),
  };
}
