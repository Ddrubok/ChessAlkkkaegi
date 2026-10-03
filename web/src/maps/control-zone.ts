import { REST_ANGULAR_EPS, REST_LINEAR_EPS } from "../config";
import type { PieceSide } from "../layout";
import type { PhysicsRuntime } from "../physics";
import type { PieceBodyBinding } from "../physics";
import type { SceneRuntime } from "../scene";
import type { TurnRuntime } from "../turn";
import type { HotseatMapRuntime } from "./hotseat-map-types";
import { createControlZoneDisplay } from "./control-zone-display";

export interface ControlZoneState {
  turnNumber: number;
  side: PieceSide;
  status: "empty" | "contested" | "opponent" | "bonus" | "spent";
  beneficiaryId: string | null;
}
const states = new WeakMap<HotseatMapRuntime, { state: ControlZoneState; beneficiary?: PieceBodyBinding; update: (state: ControlZoneState) => void }>();

export function getControlZoneState(runtime: PhysicsRuntime): Readonly<ControlZoneState> | undefined {
  return runtime.hotseatMap ? states.get(runtime.hotseatMap)?.state : undefined;
}

export function installControlZone(runtime: PhysicsRuntime, scene: SceneRuntime): () => void {
  const map = runtime.hotseatMap!;
  const display = createControlZoneDisplay(runtime, scene);
  const state: ControlZoneState = { turnNumber: -1, side: "white", status: "empty", beneficiaryId: null };
  states.set(map, { state, update: display.update });
  display.update(state);
  return () => { display.dispose(); states.delete(map); };
}

/** Fixed kings need real support too: a Fixed body itself is never a ground root. */
function stableGroundedPieceIds(runtime: PhysicsRuntime): Set<string> {
  const pieces = [...runtime.pieces.values()];
  const objects = [...runtime.hotseatMap?.dynamicObjects.values() ?? []];
  const bodies = [...pieces, ...objects];
  const grounded = new Set(runtime.boardColliders.map(collider => collider.handle));
  for (const object of objects) if (object.body.isFixed()) {
    grounded.add(object.collider.handle);
    for (const collider of object.additionalColliders ?? []) grounded.add(collider.handle);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const binding of bodies) {
      if (grounded.has(binding.collider.handle)) continue;
      const v = binding.body.linvel(), w = binding.body.angvel();
      if (Math.hypot(v.x, v.y, v.z) >= REST_LINEAR_EPS || Math.hypot(w.x, w.y, w.z) >= REST_ANGULAR_EPS) continue;
      const p = binding.collider.translation(), gap = runtime.cellSize * .025;
      const hit = runtime.world.castShape({ x: p.x, y: p.y + gap, z: p.z }, binding.collider.rotation(),
        { x: 0, y: -1, z: 0 }, binding.collider.shape, 0, gap * 2, true, undefined, undefined,
        binding.collider, binding.body, collider => collider.isValid() && grounded.has(collider.handle));
      if (hit && hit.normal1.y > .5) { grounded.add(binding.collider.handle); changed = true; }
    }
  }
  return new Set(pieces.filter(piece => grounded.has(piece.collider.handle)).map(piece => piece.instance.id));
}

/** Called once after final terrain/fall settlement, before the new turn opens. */
export function beginControlZoneTurn(turn: TurnRuntime): void {
  const runtime = turn.physicsRuntime, map = runtime.hotseatMap;
  const entry = map ? states.get(map) : undefined, zone = map?.definition.controlZone;
  if (turn.gameMode !== "hotseat" || runtime.gameMode !== "hotseat" || !entry || !zone) return;
  if (entry.state.turnNumber === turn.turnNumber && entry.state.side === turn.currentSide) return;
  const grounded = stableGroundedPieceIds(runtime);
  const r = zone.rectangle, H = runtime.boardHalfExtent;
  const occupants = [...runtime.pieces.values()].filter(piece => {
    const p = piece.body.translation();
    return grounded.has(piece.instance.id) && !turn.pendingRemovalIds.has(piece.instance.id)
      && p.x >= Math.fround(-r.maxU * H) && p.x <= Math.fround(-r.minU * H)
      && p.z >= Math.fround(r.minV * H) && p.z <= Math.fround(r.maxV * H);
  });
  const own = occupants.filter(piece => piece.instance.side === turn.currentSide);
  const opponents = occupants.length - own.length;
  const centerX = -(r.minU + r.maxU) / 2 * H, centerZ = (r.minV + r.maxV) / 2 * H;
  own.sort((a, b) => {
    const pa = a.body.translation(), pb = b.body.translation();
    const distance = (pa.x - centerX) ** 2 + (pa.z - centerZ) ** 2 - (pb.x - centerX) ** 2 - (pb.z - centerZ) ** 2;
    return distance || (a.instance.id < b.instance.id ? -1 : a.instance.id > b.instance.id ? 1 : 0);
  });
  entry.state = { turnNumber: turn.turnNumber, side: turn.currentSide,
    status: own.length && opponents ? "contested" : opponents ? "opponent" : own.length ? "bonus" : "empty",
    beneficiaryId: own.length && !opponents ? own[0].instance.id : null };
  entry.beneficiary = own.length && !opponents ? own[0] : undefined;
  entry.update(entry.state);
}

/** Any actual launch consumes this turn's grant, including another piece's shot. */
export function consumeControlZoneLaunch(turn: TurnRuntime, pieceId: string): number {
  const map = turn.physicsRuntime.hotseatMap, entry = map ? states.get(map) : undefined;
  if (turn.gameMode !== "hotseat" || turn.physicsRuntime.gameMode !== "hotseat" || !entry || !map?.definition.controlZone) return 1;
  const state = entry.state;
  validateControlZoneBonus(turn);
  const multiplier = state.turnNumber === turn.turnNumber && state.side === turn.currentSide
    && entry.state.status === "bonus" && state.beneficiaryId === pieceId ? map.definition.controlZone.speedMultiplier : 1;
  expireControlZoneBonus(turn);
  return multiplier;
}

/** A removed or replaced/promoted body cannot inherit a stale grant. */
export function validateControlZoneBonus(turn: TurnRuntime): void {
  const entry = turn.physicsRuntime.hotseatMap ? states.get(turn.physicsRuntime.hotseatMap) : undefined;
  if (entry?.state.status === "bonus" && (!entry.state.beneficiaryId
    || turn.physicsRuntime.pieces.get(entry.state.beneficiaryId) !== entry.beneficiary)) expireControlZoneBonus(turn);
}

export function expireControlZoneBonus(turn: TurnRuntime): void {
  const entry = turn.physicsRuntime.hotseatMap ? states.get(turn.physicsRuntime.hotseatMap) : undefined;
  if (!entry || entry.state.status !== "bonus") return;
  entry.state = { ...entry.state, status: "spent", beneficiaryId: null };
  entry.update(entry.state);
}

export function resetControlZoneTurn(turn: TurnRuntime): void {
  const entry = turn.physicsRuntime.hotseatMap ? states.get(turn.physicsRuntime.hotseatMap) : undefined;
  if (entry) entry.state.turnNumber = -1;
  beginControlZoneTurn(turn);
}
