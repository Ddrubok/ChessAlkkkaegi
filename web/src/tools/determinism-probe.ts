import { Mesh, Vector3 } from "three";
import type { ChessSetMeta } from "../assets";
import {
  CAM_INITIAL_AIM_PITCH_DEG,
  CAM_KEY_DEG_PER_SEC,
  MAX_LAUNCH_SPEED,
  PIECE_ANGULAR_DAMPING,
  PIECE_FRICTION,
  PIECE_LINEAR_DAMPING,
  PIECE_RESTITUTION,
  STRIKE_HEIGHT_RATIO,
  TIME_SCALE,
  deriveBoardHalfExtent,
} from "../config";
import { PIECE_INSTANCES } from "../layout";
import { createPhysicsRuntime } from "../physics";
import type { SceneRuntime } from "../scene";
import type { RuntimeTuningSettings } from "../tuning";
import {
  capturePhysicsStateHash,
  type RawPieceState,
} from "../state-hash";
import {
  applyPendingLaunchBeforeStep,
  createTurnRuntime,
  queueTurnLaunch,
} from "../turn";

export interface DeterminismProbeLaunch {
  // 실제 시작 배치의 고유 말 id를 그대로 사용한다.
  pieceId: string;
  // 발사 경로에 넣는 정규화된 월드 방향을 JSON 숫자로 보존한다.
  direction: [number, number, number];
  // 실제 발사 속도에 곱하는 0~1 세기다.
  power: number;
  // 충돌과 전도를 함께 일으키도록 고정한 월드 적용점이다.
  applicationPoint: [number, number, number];
}

export type DeterminismProbePieceCheckpoint = RawPieceState;

export interface DeterminismProbeCheckpoint {
  // 사람이 읽는 발사 번호는 1부터 시작한다.
  launchIndex: number;
  // 말 id 정렬 뒤 위치·회전 비트만 이어 붙인 바이트열의 SHA-256이다.
  sha256: string;
  // 런타임 사이에서 낙하 바디 유실 여부를 함께 확인하는 개수다.
  pieceCount: number;
  // 해시가 다를 때 수치 차이를 복원할 수 있는 전체 말 상태다.
  pieces: DeterminismProbePieceCheckpoint[];
}

export interface DeterminismProbeReport {
  // 이후 형식 변경 시 비교 도구가 조용히 잘못 읽지 않게 하는 버전이다.
  schemaVersion: 1;
  // 첫 발사 전에도 조건 판정 없이 고정해 실제 플레이 시작 자세를 만든다.
  initialFixedSteps: number;
  // 정착 판정 대신 매 발사 뒤 고정하는 순수 물리 스텝 수다.
  fixedStepsPerLaunch: number;
  // 실행에 사용한 입력을 결과에 그대로 남겨 시나리오를 감사할 수 있게 한다.
  launches: DeterminismProbeLaunch[];
  // 열 번의 발사 직후 전체 물리 상태와 해시다.
  checkpoints: DeterminismProbeCheckpoint[];
}

declare global {
  interface Window {
    // probe=1 개발 경로에서만 설치되는 수동 실행 함수다.
    __runDeterminismProbe?: () => Promise<DeterminismProbeReport>;
  }
}

// 7.5초에 해당하는 고정 스텝으로 프레임 시간과 수면 판정을 모두 배제한다.
export const DETERMINISM_PROBE_STEPS_PER_LAUNCH = 900;

// 서로 다른 행과 각도를 가로지르며 정면 충돌과 비껴맞기를 섞은 고정 입력이다.
export const DETERMINISM_PROBE_LAUNCHES: readonly DeterminismProbeLaunch[] = [
  {
    pieceId: "white-pawn-d2",
    direction: [0, 0, 1],
    power: 0.82,
    applicationPoint: [0.2680015, 0.31, -1.3400075],
  },
  {
    pieceId: "black-pawn-e7",
    direction: [0, 0, -1],
    power: 0.78,
    applicationPoint: [-0.2680015, 0.19, 1.3400075],
  },
  {
    pieceId: "white-pawn-b2",
    direction: [-0.31622776601683794, 0, 0.9486832980505138],
    power: 0.86,
    applicationPoint: [1.3400075, 0.27, -1.3400075],
  },
  {
    pieceId: "black-pawn-g7",
    direction: [0.4472135954999579, 0, -0.8944271909999159],
    power: 0.81,
    applicationPoint: [-1.3400075, 0.22, 1.3400075],
  },
  {
    pieceId: "white-knight-b1",
    direction: [-0.4472135954999579, 0, 0.8944271909999159],
    power: 0.76,
    applicationPoint: [1.3400075, 0.43, -1.8760105],
  },
  {
    pieceId: "black-bishop-f8",
    direction: [0.6, 0, -0.8],
    power: 0.74,
    applicationPoint: [-0.8040045, 0.48, 1.8760105],
  },
  {
    pieceId: "white-rook-h1",
    direction: [0.8, 0, 0.6],
    power: 0.79,
    applicationPoint: [-1.8760105, 0.37, -1.8760105],
  },
  {
    pieceId: "black-queen-d8",
    direction: [-0.19611613513818404, 0, -0.9805806756909202],
    power: 0.72,
    applicationPoint: [0.2680015, 0.63, 1.8760105],
  },
  {
    pieceId: "white-bishop-c1",
    direction: [0.24253562503633297, 0, 0.9701425001453319],
    power: 0.77,
    applicationPoint: [0.8040045, 0.51, -1.8760105],
  },
  {
    pieceId: "black-knight-b8",
    direction: [-0.7071067811865476, 0, -0.7071067811865476],
    power: 0.75,
    applicationPoint: [1.3400075, 0.4, 1.8760105],
  },
];

/**
 * 게임 발사 경로가 읽는 기본 조절값을 실제 config 상수에서 조립한다.
 */
function createProbeTuningSettings(): RuntimeTuningSettings {
  return {
    timeScale: TIME_SCALE,
    maxLaunchSpeed: MAX_LAUNCH_SPEED,
    friction: PIECE_FRICTION,
    restitution: PIECE_RESTITUTION,
    linearDamping: PIECE_LINEAR_DAMPING,
    angularDamping: PIECE_ANGULAR_DAMPING,
    baseWeightMultiplier: 0,
    initialAimPitch: CAM_INITIAL_AIM_PITCH_DEG,
    cameraKeyDegreesPerSecond: CAM_KEY_DEG_PER_SEC,
    strikeHeightRatio: STRIKE_HEIGHT_RATIO,
  };
}

/**
 * 실제 발사 함수가 요구하는 말 메시 존재 계약만 채우는 비렌더 런타임을 만든다.
 */
function createProbeSceneRuntime(pieceIds: readonly string[]): SceneRuntime {
  const pieceMeshes = new Map<string, Mesh>();
  for (const pieceId of pieceIds) {
    pieceMeshes.set(pieceId, new Mesh());
  }
  return {
    pieceMeshes,
    controls: { enabled: true },
  } as unknown as SceneRuntime;
}

/**
 * 현재 32개 바디를 id 순서로 읽어 원시 비트와 동일 바이트열 해시를 만든다.
 */
async function captureCheckpoint(
  launchIndex: number,
  runtime: Awaited<ReturnType<typeof createPhysicsRuntime>>,
): Promise<DeterminismProbeCheckpoint> {
  const state = await capturePhysicsStateHash(runtime);
  return {
    launchIndex,
    sha256: state.sha256,
    pieceCount: state.pieceCount,
    pieces: state.pieces,
  };
}

/**
 * 실제 32말 스폰과 질량 비례 발사 경로를 사용해 고정 10발을 순서대로 실행한다.
 */
export async function runDeterminismProbe(
  meta: ChessSetMeta,
): Promise<DeterminismProbeReport> {
  if (PIECE_INSTANCES.length !== 32) {
    throw new Error(
      `결정성 프로브 시작 말이 32개가 아니라 ${PIECE_INSTANCES.length}개입니다.`,
    );
  }
  const physicsRuntime = await createPhysicsRuntime(
    meta,
    PIECE_INSTANCES,
    deriveBoardHalfExtent(meta.cellSize),
  );
  for (
    let step = 0;
    step < DETERMINISM_PROBE_STEPS_PER_LAUNCH;
    step += 1
  ) {
    physicsRuntime.world.step();
  }
  const sceneRuntime = createProbeSceneRuntime(
    PIECE_INSTANCES.map((instance) => instance.id),
  );
  const turnRuntime = createTurnRuntime(
    physicsRuntime,
    sceneRuntime,
    createProbeTuningSettings(),
  );
  const checkpoints: DeterminismProbeCheckpoint[] = [];

  for (
    let launchOffset = 0;
    launchOffset < DETERMINISM_PROBE_LAUNCHES.length;
    launchOffset += 1
  ) {
    const launch = DETERMINISM_PROBE_LAUNCHES[launchOffset];
    const binding = physicsRuntime.pieces.get(launch.pieceId);
    if (binding === undefined) {
      throw new Error(
        `${launchOffset + 1}번 발사 말 ${launch.pieceId}를 실제 월드에서 찾지 못했습니다.`,
      );
    }
    turnRuntime.currentSide = binding.instance.side;
    turnRuntime.phase = "ready";
    turnRuntime.pendingLaunch = null;
    const queued = queueTurnLaunch(turnRuntime, {
      pieceId: launch.pieceId,
      direction: new Vector3(...launch.direction),
      normalizedPower: launch.power,
      applicationPoint: new Vector3(...launch.applicationPoint),
    });
    if (!queued.accepted) {
      throw new Error(
        `${launchOffset + 1}번 발사 큐가 거절됐습니다: ${queued.reason ?? "원인 없음"}`,
      );
    }
    applyPendingLaunchBeforeStep(turnRuntime);
    for (
      let step = 0;
      step < DETERMINISM_PROBE_STEPS_PER_LAUNCH;
      step += 1
    ) {
      physicsRuntime.world.step();
      turnRuntime.physicsStepNumber += 1;
    }
    checkpoints.push(
      await captureCheckpoint(launchOffset + 1, physicsRuntime),
    );
  }

  return {
    schemaVersion: 1,
    initialFixedSteps: DETERMINISM_PROBE_STEPS_PER_LAUNCH,
    fixedStepsPerLaunch: DETERMINISM_PROBE_STEPS_PER_LAUNCH,
    launches: DETERMINISM_PROBE_LAUNCHES.map((launch) => ({
      pieceId: launch.pieceId,
      direction: [...launch.direction],
      power: launch.power,
      applicationPoint: [...launch.applicationPoint],
    })),
    checkpoints,
  };
}
