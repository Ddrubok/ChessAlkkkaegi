import { Box3, MathUtils, Vector3 } from "three";
import { GRAVITY_Y, KNIGHT_LAUNCH_ANGLE, KNIGHT_MIN_LAUNCH_POWER } from "./config";
import type { GameMode } from "./game-mode";
import type { BoardHoleRectangle } from "./holes";
import type { PieceSide } from "./layout";
import { computeLaunchKinematics } from "./launch";

export interface KnightAiBody {
  id: string;
  side: PieceSide;
  bounds: Box3;
}

export interface KnightAiShot {
  targetPieceId: string;
  direction: { x: number; z: number };
  power: number;
  predictedContact: boolean;
  nominalLandingSafe: boolean;
}

/** Read-only, bounded flight estimate. Contact and landing are estimates, never a win claim. */
export function planKnightShot(options: {
  source: KnightAiBody;
  targets: readonly KnightAiBody[];
  bodies: readonly KnightAiBody[];
  obstacles: readonly Box3[];
  holes: readonly BoardHoleRectangle[];
  boardHalfExtent: number;
  boardTop: number;
  gameMode: GameMode;
  maxLaunchSpeed: number;
  speedMultiplier: number;
  variationDegrees: number;
  maximumPower: number;
}): KnightAiShot | null {
  const { source } = options;
  const start = source.bounds.getCenter(new Vector3());
  const halfSize = source.bounds.getSize(new Vector3()).multiplyScalar(.5);
  const gravity = Math.abs(GRAVITY_Y);
  const speedAtFull = computeLaunchKinematics({ ...options, pieceType: "Knight", normalizedPower: 1,
    direction: { x: 0, y: 0, z: 1 } }).targetSpeed;
  const expandedBodies = options.bodies.filter(body => body.id !== source.id).map(body => ({
    ...body, bounds: body.bounds.clone().expandByVector(halfSize),
  }));
  const expandedObstacles = options.obstacles.map(box => box.clone().expandByVector(halfSize));
  let best: (KnightAiShot & { score: number }) | null = null;

  function consider(target: KnightAiBody, baseX: number, baseZ: number, centerPower: number) {
    for (const offsetPower of [0, -.08, .08]) for (const offsetDegrees of [0, -4, 4]) {
      const power = MathUtils.clamp(centerPower + offsetPower, Math.min(.01, options.maximumPower), options.maximumPower);
      const angle = MathUtils.degToRad(options.variationDegrees + offsetDegrees);
      const direction = { x: baseX * Math.cos(angle) - baseZ * Math.sin(angle),
        z: baseX * Math.sin(angle) + baseZ * Math.cos(angle) };
      const launch = computeLaunchKinematics({ ...options, pieceType: "Knight", normalizedPower: power,
        direction: { ...direction, y: 0 } });
      const velocity = launch.direction.multiplyScalar(launch.targetSpeed);
      const floorHeight = options.boardTop + halfSize.y;
      const flightTime = (velocity.y + Math.sqrt(velocity.y ** 2 + 2 * gravity * Math.max(0, start.y - floorHeight))) / gravity;
      const landing = start.clone().addScaledVector(velocity, flightTime);
      const margin = Math.max(halfSize.x, halfSize.z);
      const safe = Math.max(Math.abs(landing.x), Math.abs(landing.z)) + margin < options.boardHalfExtent
        && !options.holes.some(hole => landing.x >= hole.minX - margin && landing.x <= hole.maxX + margin
          && landing.z >= hole.minZ - margin && landing.z <= hole.maxZ + margin);
      let contact: KnightAiBody | undefined;
      let blocked = false;
      // ponytail: fixed-pose AABBs approximate flight only; use shadow physics if measured collisions require it.
      const previous = start.clone();
      const point = start.clone();
      for (let i = 1; i <= 24; i++) {
        const time = flightTime * i / 24;
        point.copy(start).addScaledVector(velocity, time);
        point.y += .5 * GRAVITY_Y * time * time;
        let first = 2;
        for (const body of expandedBodies) {
          const entry = segmentBoxEntry(previous, point, body.bounds);
          if (entry < first) { first = entry; contact = body; blocked = false; }
        }
        for (const box of expandedObstacles) {
          const entry = segmentBoxEntry(previous, point, box);
          if (entry < first) { first = entry; contact = undefined; blocked = true; }
        }
        if (first <= 1) break;
        previous.copy(point);
      }
      const enemyContact = contact !== undefined && contact.side !== source.side;
      const friendlyContact = contact?.side === source.side;
      const score = (safe ? 200 : -300) + (enemyContact ? 400 : 0)
        - (friendlyContact ? 600 : 0) - (blocked ? 100 : 0)
        - (contact?.id === target.id ? 0 : 5) - power;
      if (best === null || score > best.score) best = { targetPieceId: enemyContact ? contact!.id : target.id, direction, power,
        predictedContact: enemyContact, nominalLandingSafe: safe, score };
    }
  }

  // Preserve the stage-selected target first; only one alternative target is examined.
  for (const target of options.targets.slice(0, 2)) {
    const end = target.bounds.getCenter(new Vector3());
    const dx = end.x - start.x, dz = end.z - start.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 1e-6) continue;
    const denominator = 2 * Math.cos(KNIGHT_LAUNCH_ANGLE) ** 2
      * (start.y + distance * Math.tan(KNIGHT_LAUNCH_ANGLE) - end.y);
    const speed = denominator > 0 ? Math.sqrt(gravity * distance * distance / denominator) : speedAtFull;
    const input = (speed / speedAtFull - KNIGHT_MIN_LAUNCH_POWER) / (1 - KNIGHT_MIN_LAUNCH_POWER);
    consider(target, dx / distance, dz / distance, input);
  }
  // Unreachable short targets must not force a full-power suicide. Reposition toward the board center.
  const inwardDistance = Math.hypot(start.x, start.z);
  if (options.targets[0] && inwardDistance > 1e-6) {
    consider(options.targets[0], -start.x / inwardDistance, -start.z / inwardDistance, .01);
  }
  return best;
}

/** First parametric intersection along a segment, or Infinity. Stable ordering resolves exact ties. */
function segmentBoxEntry(start: Vector3, end: Vector3, box: Box3): number {
  let enter = 0, leave = 1;
  for (const axis of ["x", "y", "z"] as const) {
    const delta = end[axis] - start[axis];
    if (Math.abs(delta) < 1e-12) {
      if (start[axis] < box.min[axis] || start[axis] > box.max[axis]) return Infinity;
    } else {
      const a = (box.min[axis] - start[axis]) / delta;
      const b = (box.max[axis] - start[axis]) / delta;
      enter = Math.max(enter, Math.min(a, b));
      leave = Math.min(leave, Math.max(a, b));
      if (enter > leave) return Infinity;
    }
  }
  return enter;
}
