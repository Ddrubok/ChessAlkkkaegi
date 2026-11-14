import { Vector3 } from "three";
import { computeKnightEffectivePower, getMaxLaunchSpeed, KNIGHT_LAUNCH_ANGLE, type PieceType } from "./config";
import type { GameMode } from "./game-mode";

export interface LaunchKinematicsOptions {
  gameMode: GameMode;
  pieceType: PieceType;
  normalizedPower: number;
  direction: { x: number; y: number; z: number };
  maxLaunchSpeed: number;
  speedMultiplier?: number;
  controlMultiplier?: number;
}

/** Read-only launch values shared by prediction, guide rendering, and the actual impulse. */
export function computeLaunchKinematics({
  gameMode, pieceType, normalizedPower, direction, maxLaunchSpeed,
  speedMultiplier = 1, controlMultiplier = 1,
}: LaunchKinematicsOptions): { direction: Vector3; targetSpeed: number; effectivePower: number } {
  if (!Number.isFinite(speedMultiplier) || speedMultiplier <= 0) {
    throw new Error(`발사 속도 배수 ${speedMultiplier}가 유한한 양수가 아닙니다.`);
  }
  const effectivePower = pieceType === "Knight"
    ? computeKnightEffectivePower(normalizedPower) : normalizedPower;
  const targetSpeed = effectivePower * getMaxLaunchSpeed(gameMode, pieceType, maxLaunchSpeed)
    * speedMultiplier * controlMultiplier;
  const launchDirection = new Vector3(direction.x, direction.y, direction.z);
  if (pieceType === "Knight" && launchDirection.y < 0.2) {
    const horizontal = new Vector3(launchDirection.x, 0, launchDirection.z);
    if (horizontal.lengthSq() > 1e-12) horizontal.normalize();
    else horizontal.set(0, 0, 1);
    const cosAngle = Math.cos(KNIGHT_LAUNCH_ANGLE);
    launchDirection.set(horizontal.x * cosAngle, Math.sin(KNIGHT_LAUNCH_ANGLE), horizontal.z * cosAngle).normalize();
  } else {
    launchDirection.normalize();
  }
  return { direction: launchDirection, targetSpeed, effectivePower };
}
