import RAPIER from "@dimforge/rapier3d-compat";
import { BoxGeometry, Mesh, MeshStandardMaterial } from "three";
import { PIECE_RESTITUTION } from "../config";
import type { PhysicsRuntime } from "../physics";
import type { TurnRuntime } from "../turn";
import { hasAppliedHotseatLaunch, wakeHotseatBodiesAfterSupportRemoval } from "./collapsing-floor";
import { mapPointToWorld, type HotseatBridgeDefinition, type HotseatMapCreationContext, type HotseatMapObjectBinding, type MapRectangle } from "./hotseat-map-types";

interface VelocitySnapshot {
  linear: RAPIER.Vector;
  angular: RAPIER.Vector;
  center: RAPIER.Vector;
}
interface BridgeState {
  hitCount: number;
  pendingDestruction: boolean;
  destroyed: boolean;
  minimumSpeed: number;
  touching: Set<string>;
  attackers: Map<number, VelocitySnapshot>;
  markers: Mesh[];
  targets: Mesh<BoxGeometry, MeshStandardMaterial>[];
  cracks: Mesh[];
}
const states = new WeakMap<HotseatMapObjectBinding, BridgeState>();

export function getHotseatBridgeState(binding: HotseatMapObjectBinding): Readonly<{ hitCount: number; remainingHits: number; pendingDestruction: boolean; destroyed: boolean }> | undefined {
  const state = states.get(binding);
  if (!state || binding.definition.kind !== "bridge") return undefined;
  return { hitCount: state.hitCount, remainingHits: Math.max(0, binding.definition.durability - state.hitCount),
    pendingDestruction: state.pendingDestruction, destroyed: state.destroyed };
}

function dimensions(rectangle: MapRectangle, halfExtent: number) {
  return { ...mapPointToWorld((rectangle.minU + rectangle.maxU) / 2, (rectangle.minV + rectangle.maxV) / 2, halfExtent),
    width: (rectangle.maxU - rectangle.minU) * halfExtent, depth: (rectangle.maxV - rectangle.minV) * halfExtent };
}

/** A single fixed body owns the deck and both independently hittable support colliders. */
export function createHotseatBridge(definition: HotseatBridgeDefinition, context: HotseatMapCreationContext): HotseatMapObjectBinding {
  const visual = dimensions(definition.deck, context.halfExtent);
  const support = dimensions(definition.deckSupport, context.halfExtent);
  const thickness = definition.deckThicknessCells * context.cellSize;
  const body = context.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(visual.x, context.boardTop - thickness / 2, visual.z));
  const collider = context.world.createCollider(RAPIER.ColliderDesc.cuboid(support.width / 2, thickness / 2, support.depth / 2)
    .setTranslation(support.x - visual.x, 0, support.z - visual.z).setFriction(context.friction).setRestitution(PIECE_RESTITUTION), body);
  const mesh = new Mesh(new BoxGeometry(visual.width, thickness, visual.depth), new MeshStandardMaterial({ color: 0xa16e3c, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  mesh.name = `map-${definition.id}`;
  mesh.position.set(visual.x, context.boardTop - thickness / 2, visual.z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const targets: Mesh<BoxGeometry, MeshStandardMaterial>[] = [], cracks: Mesh[] = [];
  const additionalColliders = definition.supports.map(target => {
    const position = mapPointToWorld(target.u, target.v, context.halfExtent);
    const width = target.widthH * context.halfExtent, depth = target.depthH * context.halfExtent;
    const height = target.heightCells * context.cellSize;
    const local = { x: position.x - visual.x, y: (height + thickness) / 2, z: position.z - visual.z };
    const targetCollider = context.world.createCollider(RAPIER.ColliderDesc.cuboid(width / 2, height / 2, depth / 2)
      .setTranslation(local.x, local.y, local.z).setFriction(context.friction).setRestitution(PIECE_RESTITUTION), body);
    const targetMesh = new Mesh(new BoxGeometry(width, height, depth), new MeshStandardMaterial({ color: 0xd79046, roughness: 0.8 }));
    targetMesh.name = target.id;
    targetMesh.position.set(local.x, local.y, local.z);
    targetMesh.castShadow = true;
    targets.push(targetMesh);
    for (const direction of [-1, 1]) {
      const crack = new Mesh(new BoxGeometry(width * .55, height * .06, context.cellSize * .006), new MeshStandardMaterial({ color: 0x41231e }));
      crack.name = `bridge-crack-${target.id}-${direction}`;
      crack.position.set(0, direction * height * .08, -depth / 2 - context.cellSize * .003);
      crack.rotation.z = direction * .4;
      crack.visible = false;
      targetMesh.add(crack);
      cracks.push(crack);
    }
    mesh.add(targetMesh);
    return targetCollider;
  });
  // Two raised bars communicate the shared two-hit durability without using colour alone.
  const markers = Array.from({ length: definition.durability }, (_, index) => {
    const marker = new Mesh(new BoxGeometry(visual.width * 0.08, context.cellSize * 0.008, visual.depth * 0.5), new MeshStandardMaterial({ color: 0xf5dda0 }));
    marker.position.set((index - (definition.durability - 1) / 2) * visual.width * 0.18, thickness / 2 + context.cellSize * 0.004, 0);
    mesh.add(marker);
    return marker;
  });
  const binding = { definition, body, collider, additionalColliders, mesh };
  states.set(binding, { hitCount: 0, pendingDestruction: false, destroyed: false,
    minimumSpeed: definition.minApproachSpeedCells * context.cellSize, touching: new Set(), attackers: new Map(), markers, targets, cracks });
  return binding;
}

function attackers(runtime: PhysicsRuntime) {
  return [...[...runtime.pieces.values()].map(piece => ({ body: piece.body, collider: piece.collider })),
    ...[...runtime.hotseatMap?.dynamicObjects.values() ?? []].filter(object => object.definition.kind === "block")];
}

/** Call after applying the pending launch and immediately before world.step(). */
export function beforeHotseatBridgeStep(turn: TurnRuntime): boolean {
  const runtime = turn.physicsRuntime, map = runtime.hotseatMap;
  if (runtime.gameMode !== "hotseat" || !map) return false;
  let changed = false;
  for (const [id, binding] of map.dynamicObjects) {
    const state = states.get(binding);
    if (!state) continue;
    if (state.pendingDestruction) {
      runtime.world.removeRigidBody(binding.body); // Also removes every attached support collider.
      turn.sceneRuntime.scene.remove(binding.mesh);
      binding.mesh.traverse(child => {
        if (!(child instanceof Mesh)) return;
        child.geometry.dispose();
        for (const material of Array.isArray(child.material) ? child.material : [child.material]) material.dispose();
      });
      map.dynamicObjects.delete(id);
      map.fallenObjectIds.add(id);
      state.pendingDestruction = false;
      state.destroyed = true;
      state.touching.clear();
      state.attackers.clear();
      changed = true;
      continue;
    }
    state.attackers.clear();
    for (const attacker of attackers(runtime)) {
      state.attackers.set(attacker.collider.handle, { linear: attacker.body.linvel(), angular: attacker.body.angvel(), center: attacker.body.worldCom() });
    }
  }
  if (changed) {
    wakeHotseatBodiesAfterSupportRemoval(turn);
    turn.restHoldSeconds = 0;
    turn.settleSeconds = 0;
  }
  return changed;
}

/** Post-solver contacts use pre-solver velocities, so a strong bounced hit still counts. */
export function afterHotseatBridgeStep(turn: TurnRuntime): void {
  const runtime = turn.physicsRuntime;
  if (runtime.gameMode !== "hotseat") return;
  const countHits = turn.phase === "settling" && turn.pendingTurnChange && hasAppliedHotseatLaunch(turn);
  for (const binding of runtime.hotseatMap?.dynamicObjects.values() ?? []) {
    const state = states.get(binding);
    if (!state || state.pendingDestruction || binding.definition.kind !== "bridge") continue;
    const definition = binding.definition;
    const touching = new Set<string>();
    const hitAttackers = new Set<number>();
    for (const support of binding.additionalColliders ?? []) {
      runtime.world.contactPairsWith(support, other => {
        const velocity = state.attackers.get(other.handle);
        if (!velocity) return;
        const pair = `${support.handle}:${other.handle}`;
        let approachSpeed = 0, hasContact = false;
        runtime.world.contactPair(support, other, (manifold, flipped) => {
          if (manifold.numSolverContacts() === 0) return;
          hasContact = true;
          const rawNormal = manifold.normal();
          const sign = flipped ? -1 : 1;
          const normal = { x: rawNormal.x * sign, y: rawNormal.y * sign, z: rawNormal.z * sign };
          for (let i = 0; i < manifold.numSolverContacts(); i++) {
            const point = manifold.solverContactPoint(i);
            const r = { x: point.x - velocity.center.x, y: point.y - velocity.center.y, z: point.z - velocity.center.z };
            const v = { x: velocity.linear.x + velocity.angular.y * r.z - velocity.angular.z * r.y,
              y: velocity.linear.y + velocity.angular.z * r.x - velocity.angular.x * r.z,
              z: velocity.linear.z + velocity.angular.x * r.y - velocity.angular.y * r.x };
            approachSpeed = Math.max(approachSpeed, -(v.x * normal.x + v.y * normal.y + v.z * normal.z));
          }
        });
        if (!hasContact) return;
        touching.add(pair);
        if (countHits && !state.touching.has(pair) && approachSpeed >= state.minimumSpeed && !hitAttackers.has(other.handle)) {
          hitAttackers.add(other.handle);
          state.hitCount = Math.min(definition.durability, state.hitCount + 1);
          state.markers[state.hitCount - 1].visible = false;
          for (const target of state.targets) target.material.color.setHex(0xb45939);
          for (const crack of state.cracks) crack.visible = true;
          if (state.hitCount >= definition.durability) state.pendingDestruction = true;
        }
      });
    }
    state.touching = touching;
  }
}
