import RAPIER from "@dimforge/rapier3d-compat";
import type {
  ChessSetMeta,
  ColliderPoint,
  PieceMeta,
} from "./assets";
import {
  FIXED_STEP,
  GRAVITY_Y,
  PIECE_ANGULAR_DAMPING,
  PIECE_DENSITY,
  PIECE_FRICTION,
  PIECE_LINEAR_DAMPING,
  PIECE_RESTITUTION,
  PRE_SETTLE_MAX_STEPS,
  WORLD_LENGTH_UNIT,
  type PieceType,
} from "./config";
import type { PieceInstance } from "./layout";
import {
  computeBoardFloorRectangles,
  computeBoardHoleRectangles,
  createBoardFloorLayoutKey,
  type BoardFloorRectangle,
  type BoardHoleRectangle,
} from "./holes";
import {
  computeStageBoardHalfExtent,
  computeStagePieceScale,
  computeStageSpawnPose,
  computeUpgradeWeightFraction,
  selectStageSpawnInstances,
  type StageSpawnOptions,
} from "./stage";
import {
  computeBreakableWallSegments,
  computePocketKingBaseRadius,
  computePocketWallSegments,
  hasBreakableWalls,
  hasPocketWalls,
  type BreakableWallSegmentDefinition,
} from "./walls";

export interface PieceMassProperties {
  mass: number;
  localCom: {
    x: number;
    y: number;
    z: number;
  };
  principalInertia: {
    x: number;
    y: number;
    z: number;
  };
}

export interface SpawnTranslation {
  x: number;
  y: number;
  z: number;
}

export interface SpawnRotation {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface PieceBodyBinding {
  // 개체 상태와 렌더 메시를 같은 id로 다시 찾기 위한 원본 인스턴스다.
  instance: PieceInstance;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  // 이동량을 월드 원점이 아니라 실제 스폰 위치에서 재기 위한 기준점이다.
  spawnTranslation: SpawnTranslation;
  // 포복 시작도 다시 검증할 수 있도록 보존하는 의도된 스폰 회전이다.
  spawnRotation: SpawnRotation;
  // 밑동 추를 반복 조절해도 복리로 커지지 않도록 최초 hull 질량을 보존한다.
  originalHullMass: number;
  // 추가 점 질량과 합성된 목표 무게중심을 검증하기 위한 최초 로컬 무게중심이다.
  originalLocalCom: SpawnTranslation;
  // 밑동 추의 로컬 높이를 메시 자세와 무관하게 계산하는 원본 말 높이다.
  localPieceHeight: number;
  // 렌더 메시와 콜라이더에 함께 적용된 현재 균일 크기 배율이다.
  uniformScale: number;
  // 조절판 추가 질량과 별도로 합성해야 하는 스테이지·런 카드 추가 질량 합계다.
  upgradeAdditionalMass: number;
}

export interface BreakableWallPhysicsBinding {
  // 물리·렌더가 같은 내구 변형과 벽 조각 상태를 참조하는 고정 배치 정의다.
  definition: BreakableWallSegmentDefinition;
  // 다음 fixed step 직전까지 반사를 유지하는 고정 강체다.
  body: RAPIER.RigidBody;
  // 말과의 실제 solver contact를 조회하는 박스 콜라이더다.
  collider: RAPIER.Collider;
  // 파괴 변형에서만 서로 다른 말과 재접촉을 합쳐 최대 두 번까지 누적하는 타격 수다.
  hitCount: number;
  // 파괴 변형에서 같은 말의 정지·슬라이딩 접촉을 중복 계수하지 않는 직전 접촉 집합이다.
  touchingPieceIds: Set<string>;
  // 파괴 변형의 두 번째 타격 반사가 끝난 뒤 다음 step 직전에 제거할 예약 상태다.
  pendingDestruction: boolean;
}

export interface BreakableWallHit {
  // 새 접촉을 만든 말의 결정적 식별자다.
  pieceId: string;
  // 새 접촉을 받은 벽 조각의 결정적 식별자다.
  wallId: string;
  // 이번 접촉까지 포함한 조각의 누적 타격 수다.
  hitCount: number;
}

export interface PhysicsRuntime {
  world: RAPIER.World;
  boardBody: RAPIER.RigidBody;
  // 기존 단일 바닥 API와 호환할 대표 바닥 콜라이더다.
  boardCollider: RAPIER.Collider;
  // 구멍 가장자리와 정확히 맞물려 실제 바닥을 이루는 모든 콜라이더다.
  boardColliders: RAPIER.Collider[];
  // 렌더 보드와 대조할 현재 물리 바닥 직사각형 목록이다.
  boardFloorRectangles: BoardFloorRectangle[];
  // 현재 스테이지에서 실제로 비워 둔 구멍 직사각형 목록이다.
  boardHoleRectangles: BoardHoleRectangle[];
  // 반폭이 같아도 스테이지 4→5에서 바닥을 재구축하도록 비교하는 값 기반 키다.
  boardFloorLayoutKey: string;
  boardTop: number;
  // 렌더 판과 매 리셋마다 일치 여부를 검사하는 현재 물리 바닥 반폭이다.
  boardHalfExtent: number;
  pieces: Map<string, PieceBodyBinding>;
  // 스테이지 3~8의 파괴·불파괴 변형을 같은 바디 생성 경로로 관리하는 외곽 벽 조각표다.
  breakableWalls: Map<string, BreakableWallPhysicsBinding>;
  // 다음 step 경계에서 제거된 조각을 렌더와 검증이 확인하는 id 집합이다.
  destroyedBreakableWallIds: Set<string>;
  // 같은 종류가 여러 개여도 디버그 표시와 로그는 한 번만 기록한다.
  massProperties: Map<PieceType, PieceMassProperties>;
}

interface SpawnAabb {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

interface BodyCreationState {
  translation: SpawnTranslation;
  rotation: SpawnRotation;
  linearVelocity: SpawnTranslation;
  angularVelocity: SpawnTranslation;
}

interface PhysicsBoardBinding {
  // 새 판 바닥을 소유하는 고정 강체다.
  body: RAPIER.RigidBody;
  // 고정 강체에 붙어 실제 접촉 범위를 만드는 직육면체 콜라이더다.
  collider: RAPIER.Collider;
  // 하나의 고정 바디에 붙어 구멍을 제외한 바닥 전체를 이루는 콜라이더들이다.
  colliders: RAPIER.Collider[];
  // 물리 콜라이더와 일대일 대응하는 바닥 직사각형 목록이다.
  floorRectangles: BoardFloorRectangle[];
  // 콜라이더를 만들지 않아 실제 낙하가 가능한 구멍 직사각형 목록이다.
  holeRectangles: BoardHoleRectangle[];
  // 같은 반폭의 서로 다른 스테이지 바닥을 구분하는 값 기반 키다.
  layoutKey: string;
  // 렌더 판의 y=0 상면과 비교할 물리 바닥 상면이다.
  top: number;
}

// 첫 로딩과 핫시트 재시작에서는 스테이지 버프를 전혀 적용하지 않는다.
const DEFAULT_STAGE_SPAWN_OPTIONS: StageSpawnOptions = {
  gameMode: "hotseat",
  stageNumber: 1,
};

/**
 * 현재 월드에 지정 반폭의 고정 보드 바디와 콜라이더를 만든다.
 */
function createPhysicsBoard(
  world: RAPIER.World,
  meta: ChessSetMeta,
  boardHalfExtent: number,
  stageOptions: StageSpawnOptions,
): PhysicsBoardBinding {
  if (!Number.isFinite(boardHalfExtent) || boardHalfExtent <= 0) {
    throw new Error(
      `물리 보드 반폭 ${boardHalfExtent}가 유한한 양수가 아닙니다.`,
    );
  }
  const boardCenterY = -meta.boardThickness / 2;
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, boardCenterY, 0),
  );
  const holeRectangles = computeBoardHoleRectangles(
    meta.cellSize,
    stageOptions.gameMode,
    stageOptions.stageNumber,
  );
  const floorRectangles = computeBoardFloorRectangles(
    boardHalfExtent,
    holeRectangles,
  );
  const colliders = floorRectangles.map((rectangle) => {
    const halfWidth = (rectangle.maxX - rectangle.minX) / 2;
    const halfDepth = (rectangle.maxZ - rectangle.minZ) / 2;
    return world.createCollider(
      RAPIER.ColliderDesc.cuboid(
        halfWidth,
        meta.boardThickness / 2,
        halfDepth,
      )
        .setTranslation(
          (rectangle.minX + rectangle.maxX) / 2,
          0,
          (rectangle.minZ + rectangle.maxZ) / 2,
        )
        .setFriction(PIECE_FRICTION)
        .setRestitution(PIECE_RESTITUTION),
      body,
    );
  });
  const collider = colliders[0];
  if (collider === undefined) {
    throw new Error("구멍 분할 뒤 물리 보드 바닥이 하나도 남지 않았습니다.");
  }
  return {
    body,
    collider,
    colliders,
    floorRectangles,
    holeRectangles,
    layoutKey: createBoardFloorLayoutKey(
      boardHalfExtent,
      floorRectangles,
    ),
    top: boardCenterY + meta.boardThickness / 2,
  };
}

/**
 * 내구 변형과 무관하게 하나의 벽 조각을 보드 상면에 고정하고 같은 마찰·반발을 적용한다.
 */
function createBreakableWallBody(
  runtime: PhysicsRuntime,
  definition: BreakableWallSegmentDefinition,
): BreakableWallPhysicsBinding {
  const body = runtime.world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(
      definition.center.x,
      definition.center.y,
      definition.center.z,
    ),
  );
  const collider = runtime.world.createCollider(
    RAPIER.ColliderDesc.cuboid(
      definition.halfExtents.x,
      definition.halfExtents.y,
      definition.halfExtents.z,
    )
      .setFriction(PIECE_FRICTION)
      .setRestitution(PIECE_RESTITUTION),
    body,
  );
  return {
    definition,
    body,
    collider,
    hitCount: 0,
    touchingPieceIds: new Set(),
    pendingDestruction: false,
  };
}

/**
 * 기존 벽 바디와 타격 상태를 전부 버리고 현재 스테이지의 파괴·불파괴 벽을 처음 상태로 만든다.
 */
export function resetPhysicsBreakableWalls(
  runtime: PhysicsRuntime,
  meta: ChessSetMeta,
  stageOptions: StageSpawnOptions = DEFAULT_STAGE_SPAWN_OPTIONS,
): void {
  for (const binding of runtime.breakableWalls.values()) {
    runtime.world.removeRigidBody(binding.body);
  }
  runtime.breakableWalls.clear();
  runtime.destroyedBreakableWallIds.clear();
  const breakable = hasBreakableWalls(
    stageOptions.gameMode,
    stageOptions.stageNumber,
  );
  const pocket = hasPocketWalls(
    stageOptions.gameMode,
    stageOptions.stageNumber,
  );
  if (!breakable && !pocket) {
    return;
  }
  const definitions = breakable
    ? computeBreakableWallSegments(
        runtime.boardHalfExtent,
        runtime.boardTop,
        meta.cellSize,
      )
    : computePocketWallSegments(
        runtime.boardHalfExtent,
        runtime.boardTop,
        computePocketKingBaseRadius(
          meta.pieces.King.colliderPoints,
          meta.pieces.King.bounds.y,
        ),
      );
  for (const definition of definitions) {
    runtime.breakableWalls.set(
      definition.id,
      createBreakableWallBody(runtime, definition),
    );
  }
}

/**
 * 모든 말·벽 쌍의 solver contact를 id 순으로 훑어 거짓→참 전이만 타격으로 계수한다.
 */
export function scanBreakableWallContacts(
  runtime: PhysicsRuntime,
): BreakableWallHit[] {
  const hits: BreakableWallHit[] = [];
  const pieces = [...runtime.pieces.values()].sort((left, right) =>
    left.instance.id < right.instance.id
      ? -1
      : left.instance.id > right.instance.id
        ? 1
        : 0,
  );
  const walls = [...runtime.breakableWalls.values()].sort(
    (left, right) =>
      left.definition.index - right.definition.index,
  );
  for (const wall of walls) {
    if (wall.definition.variant !== "breakable") {
      // 포켓 벽은 같은 접촉 스캔을 지나도 내구도·균열 상태를 절대 만들지 않는다.
      wall.hitCount = 0;
      wall.touchingPieceIds.clear();
      wall.pendingDestruction = false;
      continue;
    }
    if (wall.pendingDestruction) {
      continue;
    }
    const currentTouchingPieceIds = new Set<string>();
    for (const piece of pieces) {
      let touching = false;
      runtime.world.contactPair(
        piece.collider,
        wall.collider,
        (manifold) => {
          if (manifold.numSolverContacts() > 0) {
            touching = true;
          }
        },
      );
      if (!touching) {
        continue;
      }
      const pieceId = piece.instance.id;
      currentTouchingPieceIds.add(pieceId);
      if (!wall.touchingPieceIds.has(pieceId)) {
        wall.hitCount += 1;
        hits.push({
          pieceId,
          wallId: wall.definition.id,
          hitCount: wall.hitCount,
        });
        if (wall.hitCount >= 2) {
          wall.pendingDestruction = true;
          break;
        }
      }
    }
    wall.touchingPieceIds = currentTouchingPieceIds;
  }
  return hits;
}

/**
 * 직전 step에서 두 번째 타격을 받은 벽만 다음 step 직전에 제거해 반사 순서를 보장한다.
 */
export function applyPendingBreakableWallDestructions(
  runtime: PhysicsRuntime,
): string[] {
  const destroyedIds: string[] = [];
  const walls = [...runtime.breakableWalls.values()].sort(
    (left, right) =>
      left.definition.index - right.definition.index,
  );
  for (const wall of walls) {
    if (wall.definition.variant !== "breakable") {
      wall.hitCount = 0;
      wall.pendingDestruction = false;
      continue;
    }
    if (!wall.pendingDestruction) {
      continue;
    }
    runtime.world.removeRigidBody(wall.body);
    runtime.breakableWalls.delete(wall.definition.id);
    runtime.destroyedBreakableWallIds.add(wall.definition.id);
    destroyedIds.push(wall.definition.id);
  }
  return destroyedIds;
}

/**
 * Rapier가 계산한 질량·무게중심·주관성 모멘트가 물리 계산에 쓸 수 있는지 검증한다.
 */
function readMassProperties(
  body: RAPIER.RigidBody,
  type: PieceType,
): PieceMassProperties {
  const mass = body.mass();
  const localCom = body.localCom();
  const principalInertia = body.principalInertia();
  const comFinite = [localCom.x, localCom.y, localCom.z].every(Number.isFinite);
  const inertiaPositive = [
    principalInertia.x,
    principalInertia.y,
    principalInertia.z,
  ].every((value) => Number.isFinite(value) && value > 0);
  if (
    !Number.isFinite(mass) ||
    mass <= 0 ||
    !comFinite ||
    localCom.y <= 0 ||
    !inertiaPositive
  ) {
    throw new Error(
      `${type} 질량 특성이 유효하지 않습니다: mass=${mass}, localCom=(${localCom.x}, ${localCom.y}, ${localCom.z}), principalInertia=(${principalInertia.x}, ${principalInertia.y}, ${principalInertia.z})`,
    );
  }
  return {
    mass,
    localCom: { x: localCom.x, y: localCom.y, z: localCom.z },
    principalInertia: {
      x: principalInertia.x,
      y: principalInertia.y,
      z: principalInertia.z,
    },
  };
}

/**
 * 스폰 회전까지 반영한 콜라이더 점 AABB를 만들어 모든 말 쌍의 초기 겹침을 검사한다.
 */
function computeSpawnAabb(
  binding: PieceBodyBinding,
  pieceMeta: PieceMeta,
): SpawnAabb {
  const aabb: SpawnAabb = {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
  };
  const rotation = binding.spawnRotation;
  for (const point of pieceMeta.colliderPoints) {
    const localX = point[0] * binding.uniformScale;
    const localY = point[1] * binding.uniformScale;
    const localZ = point[2] * binding.uniformScale;
    const ix =
      rotation.w * localX +
      rotation.y * localZ -
      rotation.z * localY;
    const iy =
      rotation.w * localY +
      rotation.z * localX -
      rotation.x * localZ;
    const iz =
      rotation.w * localZ +
      rotation.x * localY -
      rotation.y * localX;
    const iw =
      -rotation.x * localX -
      rotation.y * localY -
      rotation.z * localZ;
    const x =
      binding.spawnTranslation.x +
      ix * rotation.w +
      iw * -rotation.x +
      iy * -rotation.z -
      iz * -rotation.y;
    const y =
      binding.spawnTranslation.y +
      iy * rotation.w +
      iw * -rotation.y +
      iz * -rotation.x -
      ix * -rotation.z;
    const z =
      binding.spawnTranslation.z +
      iz * rotation.w +
      iw * -rotation.z +
      ix * -rotation.y -
      iy * -rotation.x;
    aabb.minX = Math.min(aabb.minX, x);
    aabb.maxX = Math.max(aabb.maxX, x);
    aabb.minY = Math.min(aabb.minY, y);
    aabb.maxY = Math.max(aabb.maxY, y);
    aabb.minZ = Math.min(aabb.minZ, z);
    aabb.maxZ = Math.max(aabb.maxZ, z);
  }
  return aabb;
}

/**
 * 두 말의 시작 AABB가 세 축 모두에서 양의 부피로 겹치는지 확인한다.
 */
function spawnAabbsOverlap(left: SpawnAabb, right: SpawnAabb): boolean {
  return (
    left.minX < right.maxX &&
    left.maxX > right.minX &&
    left.minY < right.maxY &&
    left.maxY > right.minY &&
    left.minZ < right.maxZ &&
    left.maxZ > right.minZ
  );
}

/**
 * 시작 상태의 모든 말 쌍을 한 번 검사하고 겹침이 있으면 잘못된 배치를 즉시 중단한다.
 */
function validateSpawnOverlaps(
  runtime: PhysicsRuntime,
  meta: ChessSetMeta,
  allowStagePreSettle: boolean,
): void {
  const bindings = [...runtime.pieces.values()];
  const aabbs = bindings.map((binding) =>
    computeSpawnAabb(binding, meta.pieces[binding.instance.type]),
  );
  let overlapCount = 0;
  let pairCount = 0;
  for (let left = 0; left < bindings.length; left += 1) {
    for (let right = left + 1; right < bindings.length; right += 1) {
      pairCount += 1;
      if (spawnAabbsOverlap(aabbs[left], aabbs[right])) {
        overlapCount += 1;
      }
    }
  }
  console.info(
    `[물리] 시작 시 말 쌍 AABB 겹침: ${overlapCount}/${pairCount}쌍`,
  );
  const expectedPairCount =
    (bindings.length * (bindings.length - 1)) / 2;
  if (pairCount !== expectedPairCount) {
    throw new Error(
      `초기 말 쌍이 ${expectedPairCount}개가 아니라 ${pairCount}개입니다.`,
    );
  }
  if (overlapCount !== 0) {
    // 스테이지 크기 버프의 AABB는 실제 볼록 콜라이더보다 보수적이므로 사전 안정화가 최종 안전성을 판정한다.
    if (allowStagePreSettle) {
      console.info(
        `[물리] 스테이지 버프 AABB 겹침 ${overlapCount}쌍은 사전 안정화에서 실제 콜라이더로 검증합니다.`,
      );
      return;
    }
    throw new Error(`스폰 시 ${overlapCount}개 말 쌍이 겹칩니다.`);
  }
}

/**
 * 공급받은 점 집합과 밀도로 유효한 Rapier 볼록껍질 설명자를 만든다.
 */
function createPieceColliderDescriptor(
  type: PieceType,
  colliderPoints: readonly ColliderPoint[],
  density: number,
  uniformScale: number,
): RAPIER.ColliderDesc {
  if (!Number.isFinite(density) || density <= 0) {
    throw new Error(`${type} 콜라이더 밀도 ${density}가 유한한 양수가 아닙니다.`);
  }
  if (colliderPoints.length < 4) {
    throw new Error(`${type} 콜라이더 점은 최소 4개가 필요합니다.`);
  }
  if (!Number.isFinite(uniformScale) || uniformScale <= 0) {
    throw new Error(
      `${type} 콜라이더 배율 ${uniformScale}가 유한한 양수가 아닙니다.`,
    );
  }
  const colliderVertices = new Float32Array(colliderPoints.length * 3);
  for (let index = 0; index < colliderPoints.length; index += 1) {
    const point = colliderPoints[index];
    if (!point.every(Number.isFinite)) {
      throw new Error(`${type} ${index}번 콜라이더 점에 유한하지 않은 좌표가 있습니다.`);
    }
    colliderVertices[index * 3] = point[0] * uniformScale;
    colliderVertices[index * 3 + 1] = point[1] * uniformScale;
    colliderVertices[index * 3 + 2] = point[2] * uniformScale;
  }
  const descriptor = RAPIER.ColliderDesc.convexHull(colliderVertices);
  if (descriptor === null) {
    throw new Error(`${type} convexHull 콜라이더 생성에 실패했습니다.`);
  }
  return descriptor
    .setDensity(density)
    .setFriction(PIECE_FRICTION)
    .setRestitution(PIECE_RESTITUTION);
}

/**
 * 초기 생성과 강화 교체가 같은 감쇠·수면·질량 검증 경로를 사용하도록 바디를 조립한다.
 */
function createPieceBodyFromState(
  runtime: PhysicsRuntime,
  instance: PieceInstance,
  colliderDescriptor: RAPIER.ColliderDesc,
  state: BodyCreationState,
  spawnTranslation: SpawnTranslation,
  spawnRotation: SpawnRotation,
  localPieceHeight: number,
  uniformScale: number,
  upgradeWeightFraction: number,
  forceMassLog: boolean,
): PieceBodyBinding {
  const bodyDescriptor = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(
      state.translation.x,
      state.translation.y,
      state.translation.z,
    )
    .setRotation(state.rotation)
    .setLinvel(
      state.linearVelocity.x,
      state.linearVelocity.y,
      state.linearVelocity.z,
    )
    .setAngvel(state.angularVelocity)
    .setLinearDamping(PIECE_LINEAR_DAMPING)
    .setAngularDamping(PIECE_ANGULAR_DAMPING)
    .setCanSleep(true)
    .setSleeping(false);
  const body = runtime.world.createRigidBody(bodyDescriptor);
  const collider = runtime.world.createCollider(colliderDescriptor, body);

  const hadMassProperties = runtime.massProperties.has(instance.type);
  const properties = readMassProperties(body, instance.type);
  const upgradeAdditionalMass =
    properties.mass * upgradeWeightFraction;
  if (upgradeAdditionalMass > 0) {
    body.setAdditionalMassProperties(
      upgradeAdditionalMass,
      { x: 0, y: localPieceHeight * 0.06, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0, w: 1 },
      false,
    );
  }
  const binding: PieceBodyBinding = {
    instance,
    body,
    collider,
    spawnTranslation,
    spawnRotation,
    originalHullMass: properties.mass,
    originalLocalCom: { ...properties.localCom },
    localPieceHeight,
    uniformScale,
    upgradeAdditionalMass,
  };
  runtime.pieces.set(instance.id, binding);
  runtime.massProperties.set(instance.type, properties);
  if (!hadMassProperties || forceMassLog) {
    console.info(
      `[물리] ${instance.type}: mass=${properties.mass.toFixed(6)}, localCom=(${properties.localCom.x.toFixed(6)}, ${properties.localCom.y.toFixed(6)}, ${properties.localCom.z.toFixed(6)}), principalInertia=(${properties.principalInertia.x.toFixed(6)}, ${properties.principalInertia.y.toFixed(6)}, ${properties.principalInertia.z.toFixed(6)})`,
    );
  }
  return binding;
}

/**
 * 한 개체의 최초 동적 바디를 만들되 교체와 동일한 생성 경로를 공유한다.
 */
export function createPieceBody(
  runtime: PhysicsRuntime,
  instance: PieceInstance,
  meta: ChessSetMeta,
  stageOptions: StageSpawnOptions = DEFAULT_STAGE_SPAWN_OPTIONS,
): PieceBodyBinding {
  if (runtime.pieces.has(instance.id)) {
    throw new Error(`물리 개체 id ${instance.id}가 이미 존재합니다.`);
  }
  const pieceMeta = meta.pieces[instance.type];
  if (pieceMeta === undefined) {
    throw new Error(`${instance.type} 콜라이더 메타데이터가 없습니다.`);
  }
  const pose = computeStageSpawnPose(instance, meta, stageOptions);
  const uniformScale = computeStagePieceScale(
    instance,
    meta,
    stageOptions,
  );
  const upgradeWeightFraction = computeUpgradeWeightFraction(
    instance,
    stageOptions,
  );
  const spawnTranslation = { ...pose.translation };
  const spawnRotation = { ...pose.rotation };
  const state: BodyCreationState = {
    translation: { ...spawnTranslation },
    rotation: { ...spawnRotation },
    linearVelocity: { x: 0, y: 0, z: 0 },
    angularVelocity: { x: 0, y: 0, z: 0 },
  };
  const colliderDescriptor = createPieceColliderDescriptor(
    instance.type,
    pieceMeta.colliderPoints,
    PIECE_DENSITY,
    uniformScale,
  );
  return createPieceBodyFromState(
    runtime,
    instance,
    colliderDescriptor,
    state,
    spawnTranslation,
    spawnRotation,
    pieceMeta.bounds.y * uniformScale,
    uniformScale,
    upgradeWeightFraction,
    false,
  );
}

/**
 * 미래 강화가 말의 형상과 질량을 경기 중 교체할 수 있도록 현재 운동 상태를 보존해 바디를 다시 만든다.
 */
export function replacePieceBody(
  runtime: PhysicsRuntime,
  instanceId: string,
  colliderPoints: readonly ColliderPoint[],
  density: number,
): PieceBodyBinding {
  const existing = runtime.pieces.get(instanceId);
  if (existing === undefined) {
    throw new Error(`교체할 물리 개체 id ${instanceId}를 찾지 못했습니다.`);
  }
  const colliderDescriptor = createPieceColliderDescriptor(
    existing.instance.type,
    colliderPoints,
    density,
    existing.uniformScale,
  );
  const translation = existing.body.translation();
  const rotation = existing.body.rotation();
  const linearVelocity = existing.body.linvel();
  const angularVelocity = existing.body.angvel();
  const state: BodyCreationState = {
    translation: {
      x: translation.x,
      y: translation.y,
      z: translation.z,
    },
    rotation: {
      x: rotation.x,
      y: rotation.y,
      z: rotation.z,
      w: rotation.w,
    },
    linearVelocity: {
      x: linearVelocity.x,
      y: linearVelocity.y,
      z: linearVelocity.z,
    },
    angularVelocity: {
      x: angularVelocity.x,
      y: angularVelocity.y,
      z: angularVelocity.z,
    },
  };
  const spawnTranslation = { ...existing.spawnTranslation };
  const spawnRotation = { ...existing.spawnRotation };

  runtime.world.removeCollider(existing.collider, true);
  runtime.world.removeRigidBody(existing.body);
  runtime.pieces.delete(instanceId);

  return createPieceBodyFromState(
    runtime,
    existing.instance,
    colliderDescriptor,
    state,
    spawnTranslation,
    spawnRotation,
    existing.localPieceHeight,
    existing.uniformScale,
    existing.upgradeAdditionalMass / existing.originalHullMass,
    true,
  );
}

/**
 * Rapier WASM과 월드, 평평한 보드 콜라이더, 32개 말 바디를 순서대로 준비한다.
 */
export async function createPhysicsRuntime(
  meta: ChessSetMeta,
  instances: readonly PieceInstance[],
  requestedBoardHalfExtent: number,
  stageOptions: StageSpawnOptions = DEFAULT_STAGE_SPAWN_OPTIONS,
): Promise<PhysicsRuntime> {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: GRAVITY_Y, z: 0 });
  world.timestep = FIXED_STEP;
  world.lengthUnit = WORLD_LENGTH_UNIT;

  // 스테이지 기록·측정 호출자가 이전 기본 반폭을 넘겨도 헤더의 모드·단계가 실제 물리 외곽의 단일 원본이다.
  const boardHalfExtent =
    stageOptions.gameMode === "stage"
      ? computeStageBoardHalfExtent(
          meta.cellSize,
          stageOptions.gameMode,
          stageOptions.stageNumber,
        )
      : requestedBoardHalfExtent;
  const board = createPhysicsBoard(
    world,
    meta,
    boardHalfExtent,
    stageOptions,
  );
  const runtime: PhysicsRuntime = {
    world,
    boardBody: board.body,
    boardCollider: board.collider,
    boardColliders: board.colliders,
    boardFloorRectangles: board.floorRectangles,
    boardHoleRectangles: board.holeRectangles,
    boardFloorLayoutKey: board.layoutKey,
    boardTop: board.top,
    boardHalfExtent,
    pieces: new Map(),
    breakableWalls: new Map(),
    destroyedBreakableWallIds: new Set(),
    massProperties: new Map(),
  };
  resetPhysicsBreakableWalls(runtime, meta, stageOptions);

  const spawnInstances = selectStageSpawnInstances(
    instances,
    stageOptions,
  );
  for (const instance of spawnInstances) {
    createPieceBody(runtime, instance, meta, stageOptions);
  }
  validateSpawnOverlaps(runtime, meta, stageOptions.gameMode === "stage");
  return runtime;
}

/**
 * 말 바디를 한 step도 진행하지 않고 고정 바닥만 새 반폭으로 교체한다.
 */
export function rebuildPhysicsBoard(
  runtime: PhysicsRuntime,
  meta: ChessSetMeta,
  boardHalfExtent: number,
  stageOptions: StageSpawnOptions = DEFAULT_STAGE_SPAWN_OPTIONS,
): void {
  const nextHoleRectangles = computeBoardHoleRectangles(
    meta.cellSize,
    stageOptions.gameMode,
    stageOptions.stageNumber,
  );
  const nextFloorRectangles = computeBoardFloorRectangles(
    boardHalfExtent,
    nextHoleRectangles,
  );
  const nextLayoutKey = createBoardFloorLayoutKey(
    boardHalfExtent,
    nextFloorRectangles,
  );
  if (runtime.boardFloorLayoutKey === nextLayoutKey) {
    return;
  }
  const piecePoses = new Map(
    [...runtime.pieces].map(([pieceId, binding]) => {
      const translation = binding.body.translation();
      const rotation = binding.body.rotation();
      return [
        pieceId,
        {
          translation: {
            x: translation.x,
            y: translation.y,
            z: translation.z,
          },
          rotation: {
            x: rotation.x,
            y: rotation.y,
            z: rotation.z,
            w: rotation.w,
          },
        },
      ];
    }),
  );
  runtime.world.removeRigidBody(runtime.boardBody);
  const board = createPhysicsBoard(
    runtime.world,
    meta,
    boardHalfExtent,
    stageOptions,
  );
  runtime.boardBody = board.body;
  runtime.boardCollider = board.collider;
  runtime.boardColliders = board.colliders;
  runtime.boardFloorRectangles = board.floorRectangles;
  runtime.boardHoleRectangles = board.holeRectangles;
  runtime.boardFloorLayoutKey = board.layoutKey;
  runtime.boardTop = board.top;
  runtime.boardHalfExtent = boardHalfExtent;
  for (const [pieceId, pose] of piecePoses) {
    const binding = runtime.pieces.get(pieceId);
    if (binding === undefined) {
      throw new Error(
        `물리 보드 재구축 중 ${pieceId} 말 바디가 사라졌습니다.`,
      );
    }
    const translation = binding.body.translation();
    const rotation = binding.body.rotation();
    if (
      translation.x !== pose.translation.x ||
      translation.y !== pose.translation.y ||
      translation.z !== pose.translation.z ||
      rotation.x !== pose.rotation.x ||
      rotation.y !== pose.rotation.y ||
      rotation.z !== pose.rotation.z ||
      rotation.w !== pose.rotation.w
    ) {
      throw new Error(
        `물리 보드 재구축이 ${pieceId} 말 자세를 변경했습니다.`,
      );
    }
  }
  const expectedBodyCount =
    runtime.pieces.size + runtime.breakableWalls.size + 1;
  const expectedColliderCount =
    runtime.pieces.size +
    runtime.breakableWalls.size +
    runtime.boardColliders.length;
  if (
    runtime.world.bodies.len() !== expectedBodyCount ||
    runtime.world.colliders.len() !== expectedColliderCount
  ) {
    throw new Error(
      `물리 보드 재구축 누수 검사 실패: 바디 ${runtime.world.bodies.len()}/${expectedBodyCount}, 콜라이더 ${runtime.world.colliders.len()}/${expectedColliderCount}`,
    );
  }
}

/**
 * 첫 렌더 전에 실제 월드를 전원 수면까지 진행하고 상한 실패를 명시적으로 중단한다.
 */
export function preSettlePhysics(
  runtime: PhysicsRuntime,
): { steps: number; cpuMilliseconds: number } {
  const startedAt = performance.now();
  let steps = 0;
  while (
    steps < PRE_SETTLE_MAX_STEPS &&
    ![...runtime.pieces.values()].every((binding) =>
      binding.body.isSleeping(),
    )
  ) {
    runtime.world.step();
    steps += 1;
  }
  const cpuMilliseconds = performance.now() - startedAt;
  const sleepingCount = [...runtime.pieces.values()].filter((binding) =>
    binding.body.isSleeping(),
  ).length;
  console.info(
    `[물리] 사전 정착: ${steps} step, CPU ${cpuMilliseconds.toFixed(2)}ms, 수면 ${sleepingCount}/${runtime.pieces.size}`,
  );
  if (sleepingCount !== runtime.pieces.size) {
    throw new Error(
      `사전 정착이 ${PRE_SETTLE_MAX_STEPS} step 상한에서 실패했습니다: 수면 ${sleepingCount}/${runtime.pieces.size}`,
    );
  }
  return { steps, cpuMilliseconds };
}

/**
 * 보드 월드는 유지하면서 기존 말 바디와 연결표를 모두 비우고 표준 배치를 다시 만든다.
 */
export function resetPhysicsPieces(
  runtime: PhysicsRuntime,
  meta: ChessSetMeta,
  instances: readonly PieceInstance[],
  stageOptions: StageSpawnOptions = DEFAULT_STAGE_SPAWN_OPTIONS,
): void {
  for (const binding of [...runtime.pieces.values()]) {
    runtime.world.removeRigidBody(binding.body);
  }
  runtime.pieces.clear();
  runtime.massProperties.clear();
  resetPhysicsBreakableWalls(runtime, meta, stageOptions);
  const spawnInstances = selectStageSpawnInstances(
    instances,
    stageOptions,
  );
  for (const instance of spawnInstances) {
    createPieceBody(runtime, instance, meta, stageOptions);
  }
  validateSpawnOverlaps(runtime, meta, stageOptions.gameMode === "stage");
  const expectedBodyCount =
    spawnInstances.length + runtime.breakableWalls.size + 1;
  const expectedColliderCount =
    spawnInstances.length +
    runtime.breakableWalls.size +
    runtime.boardColliders.length;
  if (
    runtime.pieces.size !== spawnInstances.length ||
    runtime.world.bodies.len() !== expectedBodyCount ||
    runtime.world.colliders.len() !== expectedColliderCount
  ) {
    throw new Error(
      `재시작 물리 연결 누수 검사 실패: 말 ${runtime.pieces.size}/${spawnInstances.length}, 바디 ${runtime.world.bodies.len()}/${expectedBodyCount}, 콜라이더 ${runtime.world.colliders.len()}/${expectedColliderCount}`,
    );
  }
}
