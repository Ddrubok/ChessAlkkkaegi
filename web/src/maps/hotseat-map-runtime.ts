import RAPIER from "@dimforge/rapier3d-compat";
import { BoxGeometry, Mesh, MeshStandardMaterial } from "three";
import type { ChessSetMeta } from "../assets";
import { FALL_OUT_Y, PIECE_ANGULAR_DAMPING, PIECE_LINEAR_DAMPING, PIECE_RESTITUTION, REST_ANGULAR_EPS, REST_LINEAR_EPS } from "../config";
import type { PhysicsRuntime } from "../physics";
import type { SceneRuntime } from "../scene";
import { G01_MAP } from "./g01";
import { G02_MAP } from "./g02";
import { G03_MAP } from "./g03";
import { G04_MAP } from "./g04";
import { G05_MAP } from "./g05";
import { G06_MAP } from "./g06";
import { G07_MAP } from "./g07";
import { G08_MAP } from "./g08";
import { C01_MAP } from "./c01";
import { C02_MAP_ID, createC02MapDefinition } from "./c02";
import { C03_MAP } from "./c03";
import { C04_MAP } from "./c04";
import { C05_MAP } from "./c05";
import { installControlZone } from "./control-zone";
import { createHotseatBridge } from "./breakable-bridge";
import { installCollapsingFloor } from "./collapsing-floor";
import { createHotseatGate } from "./rotating-gate";
import { createHotseatStaticBox } from "./static-box";
import { createHotseatRamp } from "./ramp";
import { installHotseatMapSurfaces } from "./surface-materials";
import { mapPointToWorld, type HotseatBlockDefinition, type HotseatMapCreationContext, type HotseatMapDefinition, type HotseatMapObjectBinding } from "./hotseat-map-types";

export function getHotseatMapDefinition(id: string, meta?: ChessSetMeta): HotseatMapDefinition | undefined {
  if (id === C02_MAP_ID) return meta ? createC02MapDefinition(meta) : undefined;
  return [G01_MAP, G02_MAP, G03_MAP, G04_MAP, G05_MAP, G06_MAP, G07_MAP, G08_MAP, C01_MAP, C03_MAP, C04_MAP, C05_MAP].find(map => map.id === id);
}

export function createHotseatBlock(definition: HotseatBlockDefinition, context: HotseatMapCreationContext): HotseatMapObjectBinding {
  const center = mapPointToWorld(definition.u, definition.v, context.halfExtent);
  const width = definition.widthH * context.halfExtent;
  const depth = definition.depthH * context.halfExtent;
  const height = definition.heightCells * context.cellSize;
  const body = context.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(center.x, context.boardTop + height / 2, center.z)
    .enabledRotations(false, true, false)
    .setLinearDamping(PIECE_LINEAR_DAMPING)
    .setAngularDamping(PIECE_ANGULAR_DAMPING)
    .setCcdEnabled(true));
  const collider = context.world.createCollider(RAPIER.ColliderDesc.cuboid(width / 2, height / 2, depth / 2)
    .setMass(context.pawnMass * definition.massPawnMultiple)
    .setFriction(context.friction)
    .setRestitution(PIECE_RESTITUTION), body);
  const mesh = new Mesh(new BoxGeometry(width, height, depth), new MeshStandardMaterial({ color: 0xb78747, roughness: 0.85 }));
  mesh.name = `map-${definition.id}`;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return { definition, body, collider, mesh };
}

/** Install only after the legacy board and piece reset, so other modes stay isolated. */
export function installHotseatMap(runtime: PhysicsRuntime, scene: SceneRuntime, definition: HotseatMapDefinition, meta: ChessSetMeta): void {
  if (runtime.gameMode !== "hotseat") throw new Error("Hotseat maps require hotseat mode.");
  for (const spawn of definition.spawns) {
    const binding = runtime.pieces.get(spawn.instance.id);
    if (!binding) throw new Error(`Missing map piece ${spawn.instance.id}`);
    const position = { ...binding.spawnTranslation, ...mapPointToWorld(spawn.u, spawn.v, runtime.boardHalfExtent) };
    binding.spawnTranslation = position;
    binding.body.setTranslation(position, true);
  }
  const pawn = [...runtime.pieces.values()].find(binding => binding.instance.type === "Pawn");
  if (!pawn) throw new Error("Hotseat map needs a pawn mass reference.");
  const context: HotseatMapCreationContext = {
    world: runtime.world,
    boardTop: runtime.boardTop,
    cellSize: meta.cellSize,
    halfExtent: runtime.boardHalfExtent,
    pawnMass: pawn.body.mass(),
    friction: pawn.collider.friction(),
  };
  runtime.hotseatMap = { definition, dynamicObjects: new Map(), fallenObjectIds: new Set() };
  if (definition.holes.length > 0 || definition.surfaces.length > 0) {
    runtime.hotseatMap.disposeSurfaces = installHotseatMapSurfaces(runtime, scene, meta, definition);
  }
  if (definition.surfaces.some(surface => surface.collapseAfterShots !== undefined)) {
    const disposeSurfaces = runtime.hotseatMap.disposeSurfaces;
    const disposeCollapse = installCollapsingFloor(runtime, scene);
    runtime.hotseatMap.disposeSurfaces = () => { disposeCollapse(); disposeSurfaces?.(); };
  }
  for (const object of definition.objects) {
    let binding: HotseatMapObjectBinding;
    switch (object.kind) {
      case "block": binding = createHotseatBlock(object, context); break;
      case "gate": binding = createHotseatGate(object, context); break;
      case "box":
      case "bumper": binding = createHotseatStaticBox(object, context); break;
      case "ramp": binding = createHotseatRamp(object, context); break;
      case "bridge": binding = createHotseatBridge(object, context); break;
      default: throw new Error("Unsupported hotseat map object.");
    }
    runtime.hotseatMap.dynamicObjects.set(object.id, binding);
    scene.scene.add(binding.mesh);
  }
  if (definition.controlZone) runtime.hotseatMap.disposeControlZone = installControlZone(runtime, scene);
  synchronizeHotseatMapMeshes(runtime);
}

function removeMapObject(runtime: PhysicsRuntime, scene: SceneRuntime, binding: HotseatMapObjectBinding): void {
  if (binding.joint) runtime.world.removeImpulseJoint(binding.joint, true);
  runtime.world.removeRigidBody(binding.body);
  if (binding.anchorBody) runtime.world.removeRigidBody(binding.anchorBody);
  scene.scene.remove(binding.mesh);
  binding.mesh.traverse(child => {
    if (!(child instanceof Mesh)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) material.dispose();
  });
}

export function disposeHotseatMap(runtime: PhysicsRuntime, scene: SceneRuntime): void {
  runtime.hotseatMap?.disposeControlZone?.();
  for (const binding of runtime.hotseatMap?.dynamicObjects.values() ?? []) removeMapObject(runtime, scene, binding);
  runtime.hotseatMap?.disposeSurfaces?.();
  runtime.hotseatMap = undefined;
}

export function removeFallenHotseatObjects(runtime: PhysicsRuntime, scene: SceneRuntime): void {
  const map = runtime.hotseatMap;
  if (!map) return;
  for (const [id, binding] of map.dynamicObjects) {
    if (binding.definition.kind !== "block" || binding.body.translation().y >= FALL_OUT_Y) continue;
    removeMapObject(runtime, scene, binding);
    map.dynamicObjects.delete(id);
    map.fallenObjectIds.add(id);
  }
}

export function synchronizeHotseatMapMeshes(runtime: PhysicsRuntime): void {
  for (const binding of runtime.hotseatMap?.dynamicObjects.values() ?? []) {
    const p = binding.body.translation();
    const q = binding.body.rotation();
    binding.mesh.position.set(p.x, p.y, p.z);
    binding.mesh.quaternion.set(q.x, q.y, q.z, q.w);
    binding.mesh.updateMatrixWorld(true);
  }
}

export function isMapObjectSlow(binding: HotseatMapObjectBinding): boolean {
  if (binding.body.isFixed() || binding.body.isSleeping()) return true;
  const v = binding.body.linvel();
  const w = binding.body.angvel();
  return Math.hypot(v.x, v.y, v.z) < REST_LINEAR_EPS && Math.hypot(w.x, w.y, w.z) < REST_ANGULAR_EPS && Math.abs(w.y) * (binding.tipRadius ?? 0) < REST_LINEAR_EPS;
}

export function areHotseatObjectsAtRest(runtime: PhysicsRuntime): boolean {
  return [...runtime.hotseatMap?.dynamicObjects.values() ?? []].every(isMapObjectSlow);
}

/** Directed vertical contacts prevent a falling object touching a side wall from counting as support. */
export function collectHotseatGroundedIds(runtime: PhysicsRuntime): Set<string> {
  const objects = runtime.hotseatMap?.dynamicObjects;
  const bodies = [
    ...[...runtime.pieces.values()].map(p => ({ id: p.instance.id, body: p.body, collider: p.collider, supports: true })),
    ...[...objects?.values() ?? []].map(o => ({ id: `object:${o.definition.id}`, body: o.body, collider: o.collider, supports: isMapObjectSlow(o) })),
  ];
  const owners = new Map(bodies.map(body => [body.collider.handle, body]));
  for (const object of objects?.values() ?? []) {
    const owner = owners.get(object.collider.handle)!;
    for (const collider of object.additionalColliders ?? []) owners.set(collider.handle, owner);
  }
  const floorHandles = new Set(runtime.boardColliders.map(collider => collider.handle));
  const grounded = new Set<string>();
  const supportedBy = new Map<string, Set<string>>();
  for (const binding of bodies) {
    if (binding.body.isFixed()) grounded.add(binding.id);
    const object = binding.id.startsWith("object:") ? objects?.get(binding.id.slice("object:".length)) : undefined;
    if (object?.joint?.isValid() && object.anchorBody?.isFixed()) grounded.add(binding.id);
    runtime.world.contactPairsWith(binding.collider, otherCollider => {
      let vertical = false;
      runtime.world.contactPair(binding.collider, otherCollider, manifold => {
        if (manifold.numSolverContacts() > 0 && Math.abs(manifold.normal().y) > 0.5) vertical = true;
      });
      if (!vertical) return;
      if (floorHandles.has(otherCollider.handle)) { grounded.add(binding.id); return; }
      const other = owners.get(otherCollider.handle);
      if (!other || !other.supports || other.body.worldCom().y >= binding.body.worldCom().y) return;
      if (!supportedBy.has(other.id)) supportedBy.set(other.id, new Set());
      supportedBy.get(other.id)!.add(binding.id);
    });
  }
  const queue = [...grounded];
  for (let i = 0; i < queue.length; i++) for (const id of supportedBy.get(queue[i]) ?? []) {
    if (!grounded.has(id)) { grounded.add(id); queue.push(id); }
  }
  return grounded;
}

export function settleHotseatObjects(runtime: PhysicsRuntime, grounded: Set<string>): boolean {
  let eligible = true;
  for (const binding of runtime.hotseatMap?.dynamicObjects.values() ?? []) {
    if (binding.body.isFixed()) continue;
    if (isMapObjectSlow(binding) && grounded.has(`object:${binding.definition.id}`)) {
      binding.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      binding.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      binding.body.sleep();
    } else eligible = false;
  }
  return eligible;
}
