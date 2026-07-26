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
  computeStagePieceScale,
  computeStageSpawnPose,
  computeUpgradeWeightFraction,
  selectStageSpawnInstances,
  type StageSpawnOptions,
} from "./stage";

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

export interface PhysicsRuntime {
  world: RAPIER.World;
  boardBody: RAPIER.RigidBody;
  boardCollider: RAPIER.Collider;
  boardTop: number;
  pieces: Map<string, PieceBodyBinding>;
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

// 첫 로딩과 핫시트 재시작에서는 스테이지 버프를 전혀 적용하지 않는다.
const DEFAULT_STAGE_SPAWN_OPTIONS: StageSpawnOptions = {
  gameMode: "hotseat",
  stageNumber: 1,
};

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
  boardHalfExtent: number,
  stageOptions: StageSpawnOptions = DEFAULT_STAGE_SPAWN_OPTIONS,
): Promise<PhysicsRuntime> {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: GRAVITY_Y, z: 0 });
  world.timestep = FIXED_STEP;
  world.lengthUnit = WORLD_LENGTH_UNIT;

  const boardCenterY = -meta.boardThickness / 2;
  const boardBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, boardCenterY, 0),
  );
  const boardCollider = world.createCollider(
    RAPIER.ColliderDesc.cuboid(
      boardHalfExtent,
      meta.boardThickness / 2,
      boardHalfExtent,
    )
      .setFriction(PIECE_FRICTION)
      .setRestitution(PIECE_RESTITUTION),
    boardBody,
  );
  const runtime: PhysicsRuntime = {
    world,
    boardBody,
    boardCollider,
    boardTop: boardCenterY + meta.boardThickness / 2,
    pieces: new Map(),
    massProperties: new Map(),
  };

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
  const spawnInstances = selectStageSpawnInstances(
    instances,
    stageOptions,
  );
  for (const instance of spawnInstances) {
    createPieceBody(runtime, instance, meta, stageOptions);
  }
  validateSpawnOverlaps(runtime, meta, stageOptions.gameMode === "stage");
  const expectedWorldCount = spawnInstances.length + 1;
  if (
    runtime.pieces.size !== spawnInstances.length ||
    runtime.world.bodies.len() !== expectedWorldCount ||
    runtime.world.colliders.len() !== expectedWorldCount
  ) {
    throw new Error(
      `재시작 물리 연결 누수 검사 실패: 말 ${runtime.pieces.size}/${spawnInstances.length}, 바디 ${runtime.world.bodies.len()}/${expectedWorldCount}, 콜라이더 ${runtime.world.colliders.len()}/${expectedWorldCount}`,
    );
  }
}
