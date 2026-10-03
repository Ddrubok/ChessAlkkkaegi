import RAPIER from "@dimforge/rapier3d-compat";
import { REST_ANGULAR_EPS, REST_LINEAR_EPS } from "../config";
import type { PhysicsRuntime } from "../physics";
import type { SceneRuntime } from "../scene";
import type { TurnRuntime } from "../turn";
import { getBoardSurfaceId } from "./surface-materials";
import { createCollapsingFloorDisplay } from "./collapsing-floor-display";
import type { HotseatMapRuntime } from "./hotseat-map-types";

interface CollapseState {
  shots: number;
  lastCommittedLaunchId: number;
  collapsedSurfaceIds: Set<string>;
  updateDisplay: (shots: number, collapsed: ReadonlySet<string>) => void;
}
const states = new WeakMap<HotseatMapRuntime, CollapseState>();
const launches = new WeakMap<TurnRuntime, { nextId: number; activeId: number }>();

export function getCollapsingFloorState(runtime: PhysicsRuntime): Readonly<CollapseState> | undefined {
  return runtime.hotseatMap ? states.get(runtime.hotseatMap) : undefined;
}

export function installCollapsingFloor(runtime: PhysicsRuntime, scene: SceneRuntime): () => void {
  const map = runtime.hotseatMap;
  if (!map || !map.definition.surfaces.some(surface => surface.collapseAfterShots !== undefined)) return () => {};
  const display = createCollapsingFloorDisplay(runtime, scene);
  const state: CollapseState = { shots: 0, lastCommittedLaunchId: 0, collapsedSurfaceIds: new Set(), updateDisplay: display.update };
  states.set(map, state);
  display.update(0, state.collapsedSurfaceIds);
  return () => { display.dispose(); states.delete(map); };
}

/** Record only a launch that reached the actual impulse application. */
export function noteAppliedHotseatLaunch(turn: TurnRuntime): void {
  if (turn.gameMode !== "hotseat" || !turn.physicsRuntime.hotseatMap) return;
  const state = launches.get(turn) ?? { nextId: 0, activeId: 0 };
  state.activeId = ++state.nextId;
  launches.set(turn, state);
}

export function hasAppliedHotseatLaunch(turn: TurnRuntime): boolean {
  return turn.gameMode === "hotseat" && turn.phase === "settling" && turn.pendingTurnChange
    && (launches.get(turn)?.activeId ?? 0) > 0;
}

export function clearAppliedHotseatLaunch(turn: TurnRuntime): void {
  const state = launches.get(turn);
  if (state) state.activeId = 0;
}

export function resetCollapsingFloorTurn(turn: TurnRuntime): void {
  launches.delete(turn);
}

/** Used after removing a real supporting collider, by collapse and bridge destruction. */
export function wakeHotseatBodiesAfterSupportRemoval(turn: TurnRuntime): void {
  const runtime = turn.physicsRuntime;
  const pieces = [...runtime.pieces.values()];
  const objects = [...runtime.hotseatMap?.dynamicObjects.values() ?? []];
  const bodies = [...pieces.map(piece => ({ id: piece.instance.id, body: piece.body, collider: piece.collider })),
    ...objects.map(object => ({ id: `object:${object.definition.id}`, body: object.body, collider: object.collider }))];
  const grounded = new Set<number>(runtime.boardColliders.map(collider => collider.handle));
  for (const object of objects) if (object.body.isFixed()) {
    grounded.add(object.collider.handle);
    for (const collider of object.additionalColliders ?? []) grounded.add(collider.handle);
  }
  // Actual downward shape queries also work for a Fixed king, whose Fixed/Fixed
  // floor pair does not produce a solver manifold. Never root it merely for being Fixed.
  let changed = true;
  while (changed) {
    changed = false;
    for (const binding of bodies) {
      if (grounded.has(binding.collider.handle)) continue;
      const linear = binding.body.linvel(), angular = binding.body.angvel();
      if (!binding.body.isFixed() && (Math.hypot(linear.x, linear.y, linear.z) >= REST_LINEAR_EPS
        || Math.hypot(angular.x, angular.y, angular.z) >= REST_ANGULAR_EPS)) continue;
      const p = binding.collider.translation();
      const gap = turn.cellSize * .025;
      const hit = runtime.world.castShape({ x: p.x, y: p.y + gap, z: p.z }, binding.collider.rotation(),
        { x: 0, y: -1, z: 0 }, binding.collider.shape, 0, gap * 2, true, undefined, undefined,
        binding.collider, binding.body, collider => collider.isValid() && grounded.has(collider.handle));
      if (hit && hit.normal1.y > .5) {
        grounded.add(binding.collider.handle);
        changed = true;
      }
    }
  }
  for (const binding of pieces) {
    const side = binding.instance.side;
    if (binding.instance.type === "King" && turn.kingDefenseActive[side] && !grounded.has(binding.collider.handle)) {
      turn.kingDefenseActive[side] = false;
      turn.kingDefenseTurnsRemaining[side] = 0;
      binding.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    }
    if (!binding.body.isFixed()) binding.body.wakeUp();
  }
  for (const binding of objects) if (!binding.body.isFixed()) binding.body.wakeUp();
}

/** Return true when another settling phase must run before any result callback. */
export function commitSettledHotseatTerrain(turn: TurnRuntime): boolean {
  const runtime = turn.physicsRuntime;
  const map = runtime.hotseatMap;
  const state = map ? states.get(map) : undefined;
  const launch = launches.get(turn);
  if (turn.gameMode !== "hotseat" || !turn.pendingTurnChange || !map || !state || !launch?.activeId
    || state.lastCommittedLaunchId === launch.activeId) return false;
  state.lastCommittedLaunchId = launch.activeId;
  state.shots += 1;
  const collapsing = map.definition.surfaces.filter(surface => surface.collapseAfterShots !== undefined
    && state.shots >= surface.collapseAfterShots && !state.collapsedSurfaceIds.has(surface.id));
  for (const surface of collapsing) state.collapsedSurfaceIds.add(surface.id);
  state.updateDisplay(state.shots, state.collapsedSurfaceIds);
  if (collapsing.length === 0) return false;
  const ids = new Set(collapsing.map(surface => surface.id));
  const retainedIndices: number[] = [];
  runtime.boardColliders.forEach((collider, index) => {
    if (ids.has(getBoardSurfaceId(collider) ?? "")) runtime.world.removeCollider(collider, false);
    else retainedIndices.push(index);
  });
  runtime.boardColliders = retainedIndices.map(index => runtime.boardColliders[index]);
  runtime.boardCollider = runtime.boardColliders[0];
  runtime.boardFloorRectangles = retainedIndices.map(index => runtime.boardFloorRectangles[index]);
  sceneFloorRemoval(turn.sceneRuntime, ids);
  for (const surface of collapsing) {
    const rectangle = { id: surface.id, minX: -surface.rectangle.maxU * runtime.boardHalfExtent,
      maxX: -surface.rectangle.minU * runtime.boardHalfExtent, minZ: surface.rectangle.minV * runtime.boardHalfExtent,
      maxZ: surface.rectangle.maxV * runtime.boardHalfExtent };
    runtime.boardHoleRectangles.push(rectangle);
  }
  turn.sceneRuntime.boardHoleRectangles = runtime.boardHoleRectangles;
  runtime.boardFloorLayoutKey += `:collapsed:${[...state.collapsedSurfaceIds].sort().join(",")}`;
  turn.sceneRuntime.boardFloorLayoutKey = runtime.boardFloorLayoutKey;
  wakeHotseatBodiesAfterSupportRemoval(turn);
  turn.restHoldSeconds = 0;
  turn.settleSeconds = 0;
  return true;
}

function sceneFloorRemoval(scene: SceneRuntime, ids: Set<string>): void {
  const kept: number[] = [];
  scene.boardMeshes.forEach((mesh, index) => {
    if ([...ids].some(id => mesh.name.startsWith(`MapFloor-${id}-`))) scene.scene.remove(mesh);
    else kept.push(index);
  });
  // Surface disposer still owns geometries/materials, including removed tiles.
  scene.boardMeshes = kept.map(index => scene.boardMeshes[index]);
  scene.boardMesh = scene.boardMeshes[0];
  scene.boardFloorRectangles = kept.map(index => scene.boardFloorRectangles[index]);
}
