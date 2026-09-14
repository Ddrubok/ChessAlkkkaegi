import type { Mesh } from "three";
import type {
  PhysicsRuntime,
  PieceBodyBinding,
} from "./physics";
import type { PieceInstance } from "./layout";

/** 퍼즐 보드에서 사용할 정규화된 말 배치다. x/z는 보드 반폭을 1로 둔 좌표다. */
export interface PuzzleSpawnDefinition {
  pieceId: string;
  normalizedX: number;
  normalizedZ: number;
  /** true이면 스테이지 포복 카드와 같은 물리·렌더 공용 시작 포즈를 쓴다. */
  prone?: boolean;
  /** 생략하면 현재 표준 생성 바디의 높이를 유지한다. */
  y?: number;
  /** 정의가 포즈를 직접 지정할 때만 사용한다. */
  rotation?: PuzzleQuaternion;
}

export interface PuzzleQuaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface PuzzleSpawnPose {
  translation: {
    x: number;
    y: number;
    z: number;
  };
  rotation: PuzzleQuaternion;
}

export interface PuzzleSpawnApplyOptions {
  physicsRuntime: Pick<PhysicsRuntime, "pieces">;
  pieceMeshes: Map<string, Mesh>;
  boardHalfExtent: number;
}

const HALF_SQRT = Math.SQRT1_2;

/** 퍼즐 정의가 포복을 요청할 때 쓰는 회전이다. 폰은 받침 축이 달라 Z축으로 눕힌다. */
export const PUZZLE_PRONE_ROTATIONS: Readonly<{
  pawn: PuzzleQuaternion;
  other: PuzzleQuaternion;
}> = {
  pawn: { x: 0, y: 0, z: HALF_SQRT, w: HALF_SQRT },
  other: { x: HALF_SQRT, y: 0, z: 0, w: HALF_SQRT },
};

function validateNormalizedCoordinate(
  value: number,
  label: string,
): void {
  if (!Number.isFinite(value) || value < -1 || value > 1) {
    throw new Error(
      `퍼즐 ${label} ${value}가 -1~1 정규화 범위를 벗어났습니다.`,
    );
  }
}

function normalizeQuaternion(
  rotation: PuzzleQuaternion,
): PuzzleQuaternion {
  const length = Math.hypot(
    rotation.x,
    rotation.y,
    rotation.z,
    rotation.w,
  );
  if (!Number.isFinite(length) || length < 1e-9) {
    throw new Error("퍼즐 시작 회전이 0 또는 유한하지 않은 쿼터니언입니다.");
  }
  return {
    x: rotation.x / length,
    y: rotation.y / length,
    z: rotation.z / length,
    w: rotation.w / length,
  };
}

function getUprightRotation(instance: PieceInstance): PuzzleQuaternion {
  if (instance.type === "Knight") {
    return instance.side === "black"
      ? { x: 0, y: -HALF_SQRT, z: 0, w: HALF_SQRT }
      : { x: 0, y: HALF_SQRT, z: 0, w: HALF_SQRT };
  }
  return instance.side === "black"
    ? { x: 0, y: 1, z: 0, w: 0 }
    : { x: 0, y: 0, z: 0, w: 1 };
}

/** 정규화된 x/z와 말 종류별 포복 포즈를 월드 위치·회전으로 변환한다. */
export function computePuzzleSpawnPose(
  instance: PieceInstance,
  definition: PuzzleSpawnDefinition,
  boardHalfExtent: number,
  defaultY: number,
): PuzzleSpawnPose {
  validateNormalizedCoordinate(
    definition.normalizedX,
    `${definition.pieceId} normalizedX`,
  );
  validateNormalizedCoordinate(
    definition.normalizedZ,
    `${definition.pieceId} normalizedZ`,
  );
  if (!Number.isFinite(boardHalfExtent) || boardHalfExtent <= 0) {
    throw new Error(
      `퍼즐 보드 반폭 ${boardHalfExtent}가 유한한 양수가 아닙니다.`,
    );
  }
  const y = definition.y ?? defaultY;
  if (!Number.isFinite(y)) {
    throw new Error(`퍼즐 ${definition.pieceId} 높이 ${y}가 유한하지 않습니다.`);
  }
  const rotation =
    definition.rotation ??
    (definition.prone
      ? instance.type === "Pawn"
        ? PUZZLE_PRONE_ROTATIONS.pawn
        : PUZZLE_PRONE_ROTATIONS.other
      : getUprightRotation(instance));
  return {
    translation: {
      x: definition.normalizedX * boardHalfExtent,
      y,
      z: definition.normalizedZ * boardHalfExtent,
    },
    rotation: normalizeQuaternion(rotation),
  };
}

/**
 * 표준 PieceInstance로 만든 물리 바디와 씬 메시를 퍼즐 정의에 맞춰 동시에 배치한다.
 * 호출 뒤 pre-settle을 실행할 수 있도록 바디를 깨운 상태로 둔다.
 */
export function applyPuzzleSpawnDefinitions(
  definitions: readonly PuzzleSpawnDefinition[],
  options: PuzzleSpawnApplyOptions,
): void {
  const pending: Array<{
    binding: PieceBodyBinding;
    mesh: Mesh;
    pose: PuzzleSpawnPose;
  }> = [];
  const seen = new Set<string>();
  for (const definition of definitions) {
    if (seen.has(definition.pieceId)) {
      throw new Error(`퍼즐 스폰 정의에 중복된 말 id ${definition.pieceId}가 있습니다.`);
    }
    seen.add(definition.pieceId);
    const binding = options.physicsRuntime.pieces.get(definition.pieceId);
    if (binding === undefined) {
      throw new Error(`퍼즐 스폰 물리 바디 ${definition.pieceId}를 찾지 못했습니다.`);
    }
    const mesh = options.pieceMeshes.get(definition.pieceId);
    if (mesh === undefined) {
      throw new Error(`퍼즐 스폰 렌더 메시 ${definition.pieceId}를 찾지 못했습니다.`);
    }
    const current = binding.body.translation();
    pending.push({
      binding,
      mesh,
      pose: computePuzzleSpawnPose(
        binding.instance,
        definition,
        options.boardHalfExtent,
        current.y,
      ),
    });
  }
  for (const { binding, mesh, pose } of pending) {
    binding.body.setTranslation(pose.translation, true);
    binding.body.setRotation(pose.rotation, true);
    mesh.position.set(
      pose.translation.x,
      pose.translation.y,
      pose.translation.z,
    );
    mesh.quaternion.set(
      pose.rotation.x,
      pose.rotation.y,
      pose.rotation.z,
      pose.rotation.w,
    );
    mesh.updateMatrixWorld(true);
  }
}
