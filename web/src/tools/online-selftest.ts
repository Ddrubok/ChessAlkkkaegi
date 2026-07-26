import { Mesh, Scene, Vector3 } from "three";
import type { AimRuntime } from "../aim";
import { computeStrikeApplicationPoint } from "../aimparams";
import type { ChessAssets } from "../assets";
import {
  FIXED_STEP,
  NET_ICE_GATHER_TIMEOUT_MS,
} from "../config";
import {
  PIECE_INSTANCES,
  type PieceSide,
} from "../layout";
import { createPeerLink, type PeerLink, type PeerLinkState } from "../net";
import {
  applyOnlineStateSnapshot,
  createOnlineStateSnapshot,
  createOnlineRuntime,
  type OnlineTransport,
  type OnlineRuntime,
} from "../online";
import {
  createPhysicsRuntime,
  preSettlePhysics,
  type PhysicsRuntime,
} from "../physics";
import type { SceneRuntime } from "../scene";
import { capturePhysicsStateHash } from "../state-hash";
import {
  createTuningRuntime,
  reapplyTuningPhysicsSettings,
  type RuntimeTuningSettings,
} from "../tuning";
import {
  applyPendingLaunchBeforeStep,
  createTurnRuntime,
  setTurnGameMode,
  updateTurnAfterStep,
  type TurnRuntime,
} from "../turn";

export interface OnlineSelfTestState {
  // 화면 런타임을 소유하는 방장 진영이다.
  hostSide: "white";
  // 씬 없는 상대 런타임을 소유하는 참가자 진영이다.
  guestSide: "black";
  // 아직 시작하지 않았으면 null, 시작 뒤에는 호스트 기준 현재 턴이다.
  currentSide: PieceSide | null;
  // 아직 시작하지 않았으면 null, 시작 뒤에는 참가자 런타임의 현재 턴이다.
  guestCurrentSide: PieceSide | null;
  // 방장이 다음에 수락할 순차 턴 번호다.
  hostTurnIndex: number | null;
  // 참가자가 다음에 수락할 순차 턴 번호다.
  guestTurnIndex: number | null;
  // 시작 전에는 null, 시작 뒤에는 화면 월드의 현재 상태 해시다.
  hostHash: string | null;
  // 시작 전에는 null, 시작 뒤에는 씬 없는 월드의 현재 상태 해시다.
  guestHash: string | null;
  // 양쪽 중 큰 실제 어긋남 복구 누계다.
  desyncCount: number;
  // 시작 전 표식 또는 화면 턴 런타임의 현재 단계다.
  phase: TurnRuntime["phase"] | "not-started";
  // 끊김 화면과 같은 입력 차단 상태를 양쪽에서 직접 검증한다.
  hostActive: boolean;
  guestActive: boolean;
  // 참가자 창을 닫은 상황처럼 게스트 런타임과 월드가 실제로 존재하는지 나타낸다.
  guestExists: boolean;
  // 재접속 전후에 같은 대국임을 확인하는 매치 식별자다.
  matchId: string | null;
  // 마지막 전체 기록 재개 때 방장이 보낸 기록 꼬리와 스냅샷 JSON 바이트 합계다.
  resumeTransferBytes: number;
  // 새 참가자가 스냅샷 없이 전체 입력 재생만으로 권위 해시에 도달했는지 나타낸다.
  resumeReplayMatched: boolean | null;
  // 가장 최근 턴에서 복구 전에 비교한 방장 권위 해시다.
  comparedHostHash: string | null;
  // 가장 최근 턴에서 복구 전에 참가자가 직접 계산한 해시다.
  comparedGuestHash: string | null;
  // 가장 최근 비교가 가리키는 완료 턴 번호다.
  comparedTurnIndex: number | null;
  // 비교 전 두 원시 해시가 실제로 일치했는지 나타낸다.
  comparedHashMatched: boolean | null;
  // 재합류 진단용 방장·참가자 수면 바디 수다.
  hostSleepingCount: number | null;
  guestSleepingCount: number | null;
  // 위치·회전 해시에 포함되지 않는 양쪽 최대 선속도 크기다.
  hostMaxLinearSpeed: number | null;
  guestMaxLinearSpeed: number | null;
  // 위치·회전 해시에 포함되지 않는 양쪽 최대 각속도 크기다.
  hostMaxAngularSpeed: number | null;
  guestMaxAngularSpeed: number | null;
  // 같은 id 바디 사이에서 가장 큰 선속도·각속도 벡터 차이다.
  maxLinearVelocityDelta: number | null;
  maxAngularVelocityDelta: number | null;
  // 위 동적 상태 차이 중 하나가 최대인 말 id다.
  dynamicDifferencePieceId: string | null;
  // 재합류 직후 위치·회전 원시 성분 중 한 비트라도 다른 성분 수다.
  rawPoseDifferingComponentCount: number | null;
  // 같은 id 말의 위치·회전 성분별 최대 절댓값 차이다.
  maxRawPositionDelta: number | null;
  maxRawRotationDelta: number | null;
  // 가장 최근 셀프테스트 발사가 양쪽에서 정착할 때 진행한 fixed step 수다.
  lastHostTurnStepCount: number | null;
  lastGuestTurnStepCount: number | null;
}

export interface OnlineSelfTestApi {
  // 실제 WebRTC 루프백과 두 표준 월드를 만들고 ready까지 기다린다.
  start(): Promise<OnlineSelfTestState>;
  // 마지막 정착 해시와 현재 턴·단계를 즉시 읽어 자동화가 Promise 직렬화에 막히지 않게 한다.
  state(): OnlineSelfTestState;
  // 화면의 백 런타임에서 현재 턴의 결정적 발사를 실행한다.
  localShoot(pieceId?: string, power?: number): Promise<OnlineSelfTestState>;
  // 씬 없는 흑 런타임에서 현재 턴의 결정적 발사를 실행한다.
  remoteShoot(pieceId?: string, power?: number): Promise<OnlineSelfTestState>;
  // 실제 호스트 전송 계층을 닫아 양쪽 끊김 처리를 검증한다.
  dropLink(): Promise<OnlineSelfTestState>;
  // 새 실제 WebRTC 루프백을 만들고 resume 대조로 같은 대국을 이어 간다.
  reconnect(): Promise<OnlineSelfTestState>;
  // 참가자 창 전체 종료를 재현해 게스트 런타임과 물리 월드를 완전히 폐기한다.
  destroyGuest(): Promise<OnlineSelfTestState>;
  // 빈 새 게스트 월드를 만들고 같은 매치의 전체 기록과 스냅샷을 받아 이어 간다.
  rejoinAsNewGuest(): Promise<OnlineSelfTestState>;
  // 방장 턴 메시지만 유실한 뒤 끊어 참가자가 실제 물리 이력을 보존한 채 한 턴 뒤처지게 한다.
  makeGuestOneTurnBehind(): Promise<OnlineSelfTestState>;
  // 지정 진영의 실제 온라인 기권 메시지를 실행한다.
  resign(side: PieceSide): Promise<OnlineSelfTestState>;
}

export interface OnlineSelfTestRuntime {
  // 브라우저 콘솔에 노출할 온라인 셀프테스트 API다.
  api: OnlineSelfTestApi;
  // 화면 루프의 각 fixed step 뒤 씬 없는 상대 물리를 한 번 진행한다.
  stepGuest(): void;
  // 각 렌더 프레임에 씬 없는 상대의 ready 재전송과 수신 발사를 진행한다.
  updateGuest(now: number): void;
  // 모드 전환 때 두 온라인 런타임과 WebRTC 연결 및 게스트 월드를 정리한다.
  destroy(): void;
}

export interface OnlineSelfTestOptions {
  // 실제 메타와 종류별 렌더 geometry를 게스트 스폰·타점 계산에 공유한다.
  assets: ChessAssets;
  // 화면에 보이는 호스트 턴 런타임이다.
  hostTurnRuntime: TurnRuntime;
  // 상대 발사를 기존 R33 조준 연출로 보여 줄 화면 조준 런타임이다.
  hostAimRuntime: AimRuntime;
  // 두 월드가 같은 발사 속도·타점 설정을 쓰게 할 현재 조절값이다.
  tuningSettings: RuntimeTuningSettings;
  // 버프 없는 온라인 표준 보드로 화면 런타임을 초기화한다.
  prepareHostBoard(): Promise<void>;
  // 메인 입력·디버그 루프가 화면 호스트 온라인 런타임을 사용하도록 연결한다.
  setHostOnlineRuntime(runtime: OnlineRuntime | null): void;
  // 최초 호출이면 화면 RAF 루프를 시작한다.
  ensureGameLoopStarted(): void;
  // 실제 연결과 ready가 끝난 뒤 기존 메뉴 성공 경로로 오버레이를 닫는다.
  finishMenuStart(): void;
}

interface GuestMatchRuntime {
  // 실제 표준 스폰 경로로 만든 씬 없는 물리 월드다.
  physicsRuntime: PhysicsRuntime;
  // 말 geometry와 제거 연결만 제공하는 씬 없는 런타임이다.
  sceneRuntime: SceneRuntime;
  // 기존 발사·정착·승자 규칙을 그대로 실행하는 턴 런타임이다.
  turnRuntime: TurnRuntime;
}

interface ActiveSelfTest {
  // 화면 호스트의 실제 온라인 런타임이다.
  hostOnline: OnlineRuntime;
  // 실제 링크를 감싸 방장 턴 한 개만 의도적으로 유실할 수 있는 검증 전송 계층이다.
  hostTransport: ControllableSelfTestTransport;
  // 씬 없는 참가자의 실제 온라인 런타임이다.
  guestOnline: OnlineRuntime | null;
  // 고정 step을 함께 진행할 참가자 대국 상태다.
  guestMatch: GuestMatchRuntime | null;
}

interface ControllableSelfTestTransport extends OnlineTransport {
  // true인 동안 방장의 turn·turnHash만 버려 실제 링크 단절 직전 수신 누락을 재현한다.
  dropTurnMessages: boolean;
}

declare global {
  interface Window {
    // ?online=selftest에서만 존재하는 단일 페이지 실제 WebRTC 온라인 검증 훅이다.
    __onlineSelfTest?: OnlineSelfTestApi;
  }
}

// ICE 수집 제한 뒤 실제 데이터 채널 연결에도 같은 한도를 한 번 더 준다.
const SELF_TEST_CONNECTION_TIMEOUT_MS = NET_ICE_GATHER_TIMEOUT_MS;
// 조준 연출과 최장 정착 구간을 브라우저 실제 시간으로 기다리는 상한이다.
const SELF_TEST_TURN_TIMEOUT_MS = 30_000;
// 셀프테스트 한 실행 안에서 최초 연결과 새 창 재접속이 공유하는 고정 매치 식별자다.
const SELF_TEST_MATCH_ID = "online-selftest-match";

/**
 * 현재 상태를 즉시 알리는 PeerLink 구독으로 실제 connected까지 기다린다.
 */
function waitForConnected(link: PeerLink, label: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let finished = false;
    let removeHandler = (): void => {};
    const timeout = window.setTimeout(() => {
      if (finished) {
        return;
      }
      finished = true;
      removeHandler();
      reject(
        new Error(
          `${label} WebRTC 연결이 ${SELF_TEST_CONNECTION_TIMEOUT_MS}ms 안에 끝나지 않았습니다.`,
        ),
      );
    }, SELF_TEST_CONNECTION_TIMEOUT_MS);
    removeHandler = link.onStateChange((state: PeerLinkState) => {
      if (finished) {
        return;
      }
      if (state === "connected") {
        finished = true;
        window.clearTimeout(timeout);
        removeHandler();
        resolve();
      } else if (state === "failed" || state === "disconnected") {
        finished = true;
        window.clearTimeout(timeout);
        removeHandler();
        reject(new Error(`${label} WebRTC 연결 상태가 ${state}가 됐습니다.`));
      }
    });
  });
}

/**
 * 실제 geometry를 쓰되 카메라·렌더러 없이 턴 제거와 타점 계산만 가능한 게스트 씬을 만든다.
 */
function createGuestSceneRuntime(
  physicsRuntime: PhysicsRuntime,
  assets: ChessAssets,
): SceneRuntime {
  const scene = new Scene();
  const pieceMeshes = new Map<string, Mesh>();
  for (const binding of physicsRuntime.pieces.values()) {
    const geometry = assets.geometries.get(binding.instance.type);
    if (geometry === undefined) {
      throw new Error(
        `${binding.instance.type} 셀프테스트 게스트 geometry가 없습니다.`,
      );
    }
    const mesh = new Mesh(geometry);
    mesh.name = binding.instance.id;
    scene.add(mesh);
    pieceMeshes.set(binding.instance.id, mesh);
  }
  return {
    scene,
    pieceMeshes,
    controls: { enabled: true },
  } as unknown as SceneRuntime;
}

/**
 * 버프·카드·영구 강화가 없는 실제 온라인 표준 게스트 월드를 만든다.
 */
async function createGuestMatch(
  options: OnlineSelfTestOptions,
): Promise<GuestMatchRuntime> {
  const physicsRuntime = await createPhysicsRuntime(
    options.assets.meta,
    PIECE_INSTANCES,
    options.hostTurnRuntime.sceneRuntime.boardHalfExtent,
    { gameMode: "online", stageNumber: 1 },
  );
  // 화면 보드 재시작과 같은 조절판 재적용 경로를 거쳐 질량·관성·감쇠까지 동일하게 만든다.
  const tuningRuntime = createTuningRuntime(
    document.createElement("div"),
    physicsRuntime,
  );
  Object.assign(tuningRuntime.settings, options.tuningSettings);
  reapplyTuningPhysicsSettings(tuningRuntime);
  preSettlePhysics(physicsRuntime);
  const sceneRuntime = createGuestSceneRuntime(
    physicsRuntime,
    options.assets,
  );
  const turnRuntime = createTurnRuntime(
    physicsRuntime,
    sceneRuntime,
    options.tuningSettings,
  );
  setTurnGameMode(turnRuntime, "online");
  return { physicsRuntime, sceneRuntime, turnRuntime };
}

/**
 * 실제 net.ts 초대·응답 코드 교환으로 같은 페이지의 두 PeerLink를 연결한다.
 */
async function connectLoopback(): Promise<{
  hostLink: PeerLink;
  guestLink: PeerLink;
}> {
  const testTiming = {
    heartbeatIntervalMs: 100,
    trafficTimeoutMs: 500,
  };
  const hostLink = createPeerLink(testTiming);
  const guestLink = createPeerLink(testTiming);
  try {
    const inviteCode = await hostLink.createHost();
    const answerCode = await guestLink.joinWithInvite(inviteCode);
    const hostConnected = waitForConnected(hostLink, "방장");
    const guestConnected = waitForConnected(guestLink, "참가자");
    await hostLink.acceptAnswer(answerCode);
    await Promise.all([hostConnected, guestConnected]);
    return { hostLink, guestLink };
  } catch (error: unknown) {
    hostLink.close();
    guestLink.close();
    throw error;
  }
}

/**
 * 실제 PeerLink의 연결·종료 동작은 유지하면서 방장 게임 턴 메시지만 선택적으로 유실시킨다.
 */
function createControllableSelfTestTransport(
  link: PeerLink,
): ControllableSelfTestTransport {
  return {
    get disconnectCause() {
      return link.disconnectCause;
    },
    dropTurnMessages: false,
    send(payload: object): void {
      const kind =
        "kind" in payload && typeof payload.kind === "string"
          ? payload.kind
          : null;
      if (
        this.dropTurnMessages &&
        (kind === "turn" || kind === "turnHash")
      ) {
        return;
      }
      link.send(payload);
    },
    onMessage(handler) {
      return link.onMessage(handler);
    },
    onStateChange(handler) {
      return link.onStateChange(handler);
    },
    close(): void {
      link.close();
    },
  };
}

/**
 * 다음 RAF까지 기다리며 조건을 실제 시간 상한 안에서 반복 검사한다.
 */
function waitForCondition(
  label: string,
  timeoutMilliseconds: number,
  condition: () => boolean,
): Promise<void> {
  const startedAt = performance.now();
  return new Promise<void>((resolve, reject) => {
    const inspect = (): void => {
      if (condition()) {
        resolve();
        return;
      }
      if (performance.now() - startedAt >= timeoutMilliseconds) {
        reject(
          new Error(
            `${label}가 ${timeoutMilliseconds}ms 안에 끝나지 않았습니다.`,
          ),
        );
        return;
      }
      requestAnimationFrame(inspect);
    };
    inspect();
  });
}

/**
 * 지정 진영의 살아 있는 말을 결정적으로 고르고 판 중심 방향의 실제 타점을 만든다.
 */
function createDeterministicLaunch(
  match: {
    physicsRuntime: PhysicsRuntime;
    sceneRuntime: SceneRuntime;
    turnRuntime: TurnRuntime;
  },
  side: PieceSide,
  pieceId: string | undefined,
  power = 0.08,
) {
  if (!Number.isFinite(power) || power < 0 || power > 1) {
    throw new Error(`셀프테스트 발사 세기 ${power}가 0~1 범위가 아닙니다.`);
  }
  if (match.turnRuntime.currentSide !== side) {
    throw new Error(
      `현재 ${match.turnRuntime.currentSide} 턴이라 ${side} 셀프테스트 발사를 할 수 없습니다.`,
    );
  }
  const candidates = [...match.physicsRuntime.pieces.values()]
    .filter((binding) => binding.instance.side === side)
    .sort((left, right) =>
      left.instance.id.localeCompare(right.instance.id),
    );
  const binding =
    pieceId === undefined
      ? candidates[0]
      : candidates.find(
          (candidate) => candidate.instance.id === pieceId,
        );
  if (binding === undefined) {
    throw new Error(
      `${side} 셀프테스트 발사 대상 ${pieceId ?? "(자동)"}을 찾지 못했습니다.`,
    );
  }
  const mesh = match.sceneRuntime.pieceMeshes.get(
    binding.instance.id,
  );
  if (mesh === undefined) {
    throw new Error(`${binding.instance.id} 셀프테스트 렌더 메시가 없습니다.`);
  }
  const translation = binding.body.translation();
  const direction = new Vector3(
    -translation.x,
    0,
    -translation.z,
  );
  if (direction.lengthSq() < 1e-12) {
    direction.set(0, 0, side === "white" ? 1 : -1);
  } else {
    direction.normalize();
  }
  return {
    pieceId: binding.instance.id,
    direction,
    normalizedPower: power,
    applicationPoint: computeStrikeApplicationPoint(
      binding,
      mesh,
      match.turnRuntime.tuningSettings.strikeHeightRatio,
    ),
    speedMultiplier: 1,
  };
}

/**
 * ?online=selftest에서만 두 실제 온라인 런타임을 한 페이지에 구성한다.
 */
export function createOnlineSelfTestRuntime(
  options: OnlineSelfTestOptions,
): OnlineSelfTestRuntime {
  let active: ActiveSelfTest | null = null;
  let latestHostHash: string | null = null;
  let latestGuestHash: string | null = null;
  let lastHostTurnStepCount: number | null = null;
  let lastGuestTurnStepCount: number | null = null;

  const destroy = (): void => {
    if (active === null) {
      return;
    }
    const current = active;
    active = null;
    latestHostHash = null;
    latestGuestHash = null;
    lastHostTurnStepCount = null;
    lastGuestTurnStepCount = null;
    current.hostOnline.close();
    current.guestOnline?.close();
    current.guestMatch?.physicsRuntime.world.free();
    options.setHostOnlineRuntime(null);
  };

  const readDynamicComparison = (): {
    hostSleepingCount: number | null;
    guestSleepingCount: number | null;
    hostMaxLinearSpeed: number | null;
    guestMaxLinearSpeed: number | null;
    hostMaxAngularSpeed: number | null;
    guestMaxAngularSpeed: number | null;
    maxLinearVelocityDelta: number | null;
    maxAngularVelocityDelta: number | null;
    dynamicDifferencePieceId: string | null;
    rawPoseDifferingComponentCount: number | null;
    maxRawPositionDelta: number | null;
    maxRawRotationDelta: number | null;
  } => {
    const guestPhysics = active?.guestMatch?.physicsRuntime;
    if (guestPhysics === undefined) {
      return {
        hostSleepingCount: null,
        guestSleepingCount: null,
        hostMaxLinearSpeed: null,
        guestMaxLinearSpeed: null,
        hostMaxAngularSpeed: null,
        guestMaxAngularSpeed: null,
        maxLinearVelocityDelta: null,
        maxAngularVelocityDelta: null,
        dynamicDifferencePieceId: null,
        rawPoseDifferingComponentCount: null,
        maxRawPositionDelta: null,
        maxRawRotationDelta: null,
      };
    }
    let hostSleepingCount = 0;
    let guestSleepingCount = 0;
    let hostMaxLinearSpeed = 0;
    let guestMaxLinearSpeed = 0;
    let hostMaxAngularSpeed = 0;
    let guestMaxAngularSpeed = 0;
    let maxLinearVelocityDelta = 0;
    let maxAngularVelocityDelta = 0;
    let dynamicDifferencePieceId: string | null = null;
    let rawPoseDifferingComponentCount = 0;
    let maxRawPositionDelta = 0;
    let maxRawRotationDelta = 0;
    for (const [pieceId, hostBinding] of options.hostTurnRuntime
      .physicsRuntime.pieces) {
      const guestBinding = guestPhysics.pieces.get(pieceId);
      if (guestBinding === undefined) {
        continue;
      }
      const hostLinear = hostBinding.body.linvel();
      const guestLinear = guestBinding.body.linvel();
      const hostAngular = hostBinding.body.angvel();
      const guestAngular = guestBinding.body.angvel();
      const hostPosition = hostBinding.body.translation();
      const guestPosition = guestBinding.body.translation();
      const hostRotation = hostBinding.body.rotation();
      const guestRotation = guestBinding.body.rotation();
      const hostLinearSpeed = Math.hypot(
        hostLinear.x,
        hostLinear.y,
        hostLinear.z,
      );
      const guestLinearSpeed = Math.hypot(
        guestLinear.x,
        guestLinear.y,
        guestLinear.z,
      );
      const hostAngularSpeed = Math.hypot(
        hostAngular.x,
        hostAngular.y,
        hostAngular.z,
      );
      const guestAngularSpeed = Math.hypot(
        guestAngular.x,
        guestAngular.y,
        guestAngular.z,
      );
      const linearDelta = Math.hypot(
        hostLinear.x - guestLinear.x,
        hostLinear.y - guestLinear.y,
        hostLinear.z - guestLinear.z,
      );
      const angularDelta = Math.hypot(
        hostAngular.x - guestAngular.x,
        hostAngular.y - guestAngular.y,
        hostAngular.z - guestAngular.z,
      );
      hostSleepingCount += hostBinding.body.isSleeping() ? 1 : 0;
      guestSleepingCount += guestBinding.body.isSleeping() ? 1 : 0;
      hostMaxLinearSpeed = Math.max(
        hostMaxLinearSpeed,
        hostLinearSpeed,
      );
      guestMaxLinearSpeed = Math.max(
        guestMaxLinearSpeed,
        guestLinearSpeed,
      );
      hostMaxAngularSpeed = Math.max(
        hostMaxAngularSpeed,
        hostAngularSpeed,
      );
      guestMaxAngularSpeed = Math.max(
        guestMaxAngularSpeed,
        guestAngularSpeed,
      );
      if (
        linearDelta > maxLinearVelocityDelta ||
        angularDelta > maxAngularVelocityDelta
      ) {
        dynamicDifferencePieceId = pieceId;
      }
      maxLinearVelocityDelta = Math.max(
        maxLinearVelocityDelta,
        linearDelta,
      );
      maxAngularVelocityDelta = Math.max(
        maxAngularVelocityDelta,
        angularDelta,
      );
      const positionPairs = [
        [hostPosition.x, guestPosition.x],
        [hostPosition.y, guestPosition.y],
        [hostPosition.z, guestPosition.z],
      ] as const;
      const rotationPairs = [
        [hostRotation.x, guestRotation.x],
        [hostRotation.y, guestRotation.y],
        [hostRotation.z, guestRotation.z],
        [hostRotation.w, guestRotation.w],
      ] as const;
      rawPoseDifferingComponentCount += [
        ...positionPairs,
        ...rotationPairs,
      ].filter(([hostValue, guestValue]) =>
        !Object.is(hostValue, guestValue)
      ).length;
      maxRawPositionDelta = Math.max(
        maxRawPositionDelta,
        ...positionPairs.map(([hostValue, guestValue]) =>
          Math.abs(hostValue - guestValue)
        ),
      );
      maxRawRotationDelta = Math.max(
        maxRawRotationDelta,
        ...rotationPairs.map(([hostValue, guestValue]) =>
          Math.abs(hostValue - guestValue)
        ),
      );
    }
    return {
      hostSleepingCount,
      guestSleepingCount,
      hostMaxLinearSpeed,
      guestMaxLinearSpeed,
      hostMaxAngularSpeed,
      guestMaxAngularSpeed,
      maxLinearVelocityDelta,
      maxAngularVelocityDelta,
      dynamicDifferencePieceId,
      rawPoseDifferingComponentCount,
      maxRawPositionDelta,
      maxRawRotationDelta,
    };
  };

  const readState = (): OnlineSelfTestState => {
    if (active === null) {
      return {
        hostSide: "white",
        guestSide: "black",
        currentSide: null,
        guestCurrentSide: null,
        hostTurnIndex: null,
        guestTurnIndex: null,
        hostHash: null,
        guestHash: null,
        desyncCount: 0,
        phase: "not-started",
        hostActive: false,
        guestActive: false,
        guestExists: false,
        matchId: null,
        resumeTransferBytes: 0,
        resumeReplayMatched: null,
        comparedHostHash: null,
        comparedGuestHash: null,
        comparedTurnIndex: null,
        comparedHashMatched: null,
        hostSleepingCount: null,
        guestSleepingCount: null,
        hostMaxLinearSpeed: null,
        guestMaxLinearSpeed: null,
        hostMaxAngularSpeed: null,
        guestMaxAngularSpeed: null,
        maxLinearVelocityDelta: null,
        maxAngularVelocityDelta: null,
        dynamicDifferencePieceId: null,
        rawPoseDifferingComponentCount: null,
        maxRawPositionDelta: null,
        maxRawRotationDelta: null,
        lastHostTurnStepCount: null,
        lastGuestTurnStepCount: null,
      };
    }
    const guestOnline = active.guestOnline;
    const guestMatch = active.guestMatch;
    const dynamicComparison = readDynamicComparison();
    return {
      hostSide: "white",
      guestSide: "black",
      currentSide: options.hostTurnRuntime.currentSide,
      guestCurrentSide:
        guestMatch?.turnRuntime.currentSide ?? null,
      hostTurnIndex: active.hostOnline.nextTurnIndex,
      guestTurnIndex: guestOnline?.nextTurnIndex ?? null,
      hostHash: latestHostHash,
      guestHash: latestGuestHash,
      desyncCount: Math.max(
        active.hostOnline.desyncCount,
        guestOnline?.desyncCount ?? 0,
      ),
      phase: options.hostTurnRuntime.phase,
      hostActive: active.hostOnline.active,
      guestActive: guestOnline?.active ?? false,
      guestExists: guestOnline !== null && guestMatch !== null,
      matchId: active.hostOnline.matchId,
      resumeTransferBytes:
        active.hostOnline.lastResumeTransferBytes,
      resumeReplayMatched:
        guestOnline?.lastResumeReplayMatched ?? null,
      comparedHostHash:
        guestOnline?.lastHashComparison?.hostHash ?? null,
      comparedGuestHash:
        guestOnline?.lastHashComparison?.guestHash ?? null,
      comparedTurnIndex:
        guestOnline?.lastHashComparison?.turnIndex ?? null,
      comparedHashMatched:
        guestOnline?.lastHashComparison?.matched ?? null,
      ...dynamicComparison,
      lastHostTurnStepCount,
      lastGuestTurnStepCount,
    };
  };

  const refreshState = async (): Promise<OnlineSelfTestState> => {
    if (active === null) {
      return readState();
    }
    const guestMatch = active.guestMatch;
    const [hostState, guestState] = await Promise.all([
      capturePhysicsStateHash(
        options.hostTurnRuntime.physicsRuntime,
      ),
      guestMatch === null
        ? Promise.resolve(null)
        : capturePhysicsStateHash(guestMatch.physicsRuntime),
    ]);
    latestHostHash = hostState.sha256;
    latestGuestHash = guestState?.sha256 ?? null;
    return readState();
  };

  const shoot = async (
    origin: "host" | "guest",
    pieceId?: string,
    power?: number,
  ): Promise<OnlineSelfTestState> => {
    const current = active;
    if (current === null) {
      throw new Error("먼저 window.__onlineSelfTest.start()를 실행하세요.");
    }
    const guestOnline = current.guestOnline;
    const guestMatch = current.guestMatch;
    if (guestOnline === null || guestMatch === null) {
      throw new Error(
        "참가자 런타임이 파괴되어 있습니다. rejoinAsNewGuest()로 새 참가자를 연결하세요.",
      );
    }
    const local =
      origin === "host"
        ? {
            physicsRuntime:
              options.hostTurnRuntime.physicsRuntime,
            sceneRuntime:
              options.hostTurnRuntime.sceneRuntime,
            turnRuntime: options.hostTurnRuntime,
            online: current.hostOnline,
            side: "white" as const,
          }
        : {
            ...guestMatch,
            online: guestOnline,
            side: "black" as const,
          };
    if (!local.online.active) {
      throw new Error(
        `온라인 대국이 끊겼거나 종료되어 ${origin} 셀프테스트 발사를 할 수 없습니다.`,
      );
    }
    const startTurnIndex = current.hostOnline.nextTurnIndex;
    const hostStartStep =
      options.hostTurnRuntime.physicsStepNumber;
    const guestStartStep =
      guestMatch.turnRuntime.physicsStepNumber;
    const outcome = local.online.queueLocalLaunch(
      createDeterministicLaunch(
        local,
        local.side,
        pieceId,
        power,
      ),
    );
    if (!outcome.accepted) {
      throw new Error(
        `셀프테스트 ${origin} 발사가 거절됐습니다: ${outcome.reason ?? "원인 없음"}`,
      );
    }
    // 씬 없는 수신자는 다음 RAF를 기다릴 필요 없이 받은 발사를 바로 큐에 넣을 수 있다.
    guestOnline.update(performance.now());
    await waitForCondition(
      `${startTurnIndex}번 셀프테스트 턴 정착`,
      SELF_TEST_TURN_TIMEOUT_MS,
      () =>
        current.hostOnline.nextTurnIndex > startTurnIndex &&
        guestOnline.nextTurnIndex > startTurnIndex &&
        (options.hostTurnRuntime.phase === "ready" ||
          options.hostTurnRuntime.phase === "match-over") &&
        (guestMatch.turnRuntime.phase === "ready" ||
          guestMatch.turnRuntime.phase === "match-over"),
    );
    lastHostTurnStepCount =
      options.hostTurnRuntime.physicsStepNumber -
      hostStartStep;
    lastGuestTurnStepCount =
      guestMatch.turnRuntime.physicsStepNumber -
      guestStartStep;
    await Promise.all([
      current.hostOnline.flush(),
      guestOnline.flush(),
    ]);
    return await refreshState();
  };

  const api: OnlineSelfTestApi = {
    async start(): Promise<OnlineSelfTestState> {
      destroy();
      await options.prepareHostBoard();
      const guestMatch = await createGuestMatch(options);
      // 화면 월드는 재사용 월드 재시작, 게스트는 새 월드 생성이므로 사전 정착의 원시 비트와 접촉 캐시가 다를 수 있다.
      // 실제 온라인 복구 경로를 양쪽에 똑같이 적용해 좌표뿐 아니라 다음 물리 step의 출발 절차도 맞춘다.
      const initialSnapshot = createOnlineStateSnapshot(
        options.hostTurnRuntime,
        0,
      );
      applyOnlineStateSnapshot(
        options.hostTurnRuntime,
        initialSnapshot,
      );
      applyOnlineStateSnapshot(
        guestMatch.turnRuntime,
        initialSnapshot,
      );
      let hostOnline: OnlineRuntime | null = null;
      let guestOnline: OnlineRuntime | null = null;
      try {
        const { hostLink, guestLink } = await connectLoopback();
        const hostTransport =
          createControllableSelfTestTransport(hostLink);
        hostOnline = createOnlineRuntime(
          hostTransport,
          options.hostTurnRuntime,
          options.hostAimRuntime,
          "white",
          {},
          { matchId: SELF_TEST_MATCH_ID },
        );
        guestOnline = createOnlineRuntime(
          guestLink,
          guestMatch.turnRuntime,
          null,
          "black",
          {},
          { matchId: SELF_TEST_MATCH_ID },
        );
        active = {
          hostOnline,
          hostTransport,
          guestOnline,
          guestMatch,
        };
        options.setHostOnlineRuntime(hostOnline);
        hostOnline.startMatch();
        guestOnline.startMatch();
        options.ensureGameLoopStarted();
        await Promise.all([
          hostOnline.waitUntilReady(),
          guestOnline.waitUntilReady(),
        ]);
        await waitForCondition(
          "호스트 첫 턴 카메라 준비",
          5_000,
          () => options.hostTurnRuntime.phase === "ready",
        );
        options.finishMenuStart();
        return await refreshState();
      } catch (error: unknown) {
        if (active !== null) {
          destroy();
        } else {
          hostOnline?.close();
          guestOnline?.close();
          guestMatch.physicsRuntime.world.free();
        }
        throw error;
      }
    },

    state: readState,

    async localShoot(
      pieceId?: string,
      power?: number,
    ): Promise<OnlineSelfTestState> {
      return await shoot("host", pieceId, power);
    },

    async remoteShoot(
      pieceId?: string,
      power?: number,
    ): Promise<OnlineSelfTestState> {
      return await shoot("guest", pieceId, power);
    },

    async dropLink(): Promise<OnlineSelfTestState> {
      if (
        active === null ||
        active.guestOnline === null
      ) {
        throw new Error("먼저 window.__onlineSelfTest.start()를 실행하세요.");
      }
      const current = active;
      const guestOnline = active.guestOnline;
      current.hostOnline.transport.close();
      await waitForCondition(
        "양쪽 온라인 끊김 처리",
        5_000,
        () => !current.hostOnline.active && !guestOnline.active,
      );
      return readState();
    },

    async reconnect(): Promise<OnlineSelfTestState> {
      if (
        active === null ||
        active.guestOnline === null ||
        active.guestMatch === null
      ) {
        throw new Error("먼저 window.__onlineSelfTest.start()를 실행하세요.");
      }
      const { hostLink, guestLink } = await connectLoopback();
      const hostTransport =
        createControllableSelfTestTransport(hostLink);
      const guestOnline = active.guestOnline;
      await Promise.all([
        active.hostOnline.replaceTransport(hostTransport),
        guestOnline.replaceTransport(guestLink),
      ]);
      active.hostTransport = hostTransport;
      await waitForCondition(
        "양쪽 온라인 재개",
        5_000,
        () =>
          active!.hostOnline.active &&
          active!.guestOnline?.active === true,
      );
      return await refreshState();
    },

    async destroyGuest(): Promise<OnlineSelfTestState> {
      if (
        active === null ||
        active.guestOnline === null ||
        active.guestMatch === null
      ) {
        throw new Error("파괴할 참가자 런타임이 없습니다.");
      }
      const current = active;
      const guestOnline = active.guestOnline;
      const guestMatch = active.guestMatch;
      guestOnline.close();
      guestMatch.physicsRuntime.world.free();
      current.guestOnline = null;
      current.guestMatch = null;
      latestGuestHash = null;
      await waitForCondition(
        "방장 온라인 끊김 처리",
        5_000,
        () => !current.hostOnline.active,
      );
      return await refreshState();
    },

    async rejoinAsNewGuest(): Promise<OnlineSelfTestState> {
      if (active === null) {
        throw new Error("먼저 window.__onlineSelfTest.start()를 실행하세요.");
      }
      if (
        active.guestOnline !== null ||
        active.guestMatch !== null
      ) {
        throw new Error(
          "기존 참가자가 남아 있습니다. destroyGuest()를 먼저 실행하세요.",
        );
      }
      const current = active;
      const guestMatch = await createGuestMatch(options);
      let guestOnline: OnlineRuntime | null = null;
      try {
        const { hostLink, guestLink } = await connectLoopback();
        const hostTransport =
          createControllableSelfTestTransport(hostLink);
        guestOnline = createOnlineRuntime(
          guestLink,
          guestMatch.turnRuntime,
          null,
          "black",
          {},
          { matchId: current.hostOnline.matchId },
        );
        current.guestMatch = guestMatch;
        current.guestOnline = guestOnline;
        guestOnline.startMatch({ rejoining: true });
        await Promise.all([
          current.hostOnline.replaceTransport(hostTransport),
          guestOnline.waitUntilReady(),
        ]);
        current.hostTransport = hostTransport;
        await waitForCondition(
          "새 참가자 전체 대국 인계",
          5_000,
          () =>
            current.hostOnline.active &&
            current.guestOnline?.active === true &&
            current.hostOnline.nextTurnIndex ===
              current.guestOnline.nextTurnIndex &&
            options.hostTurnRuntime.currentSide ===
              current.guestMatch?.turnRuntime.currentSide,
        );
        return await refreshState();
      } catch (error: unknown) {
        guestOnline?.close();
        guestMatch.physicsRuntime.world.free();
        current.guestOnline = null;
        current.guestMatch = null;
        throw error;
      }
    },

    async makeGuestOneTurnBehind(): Promise<OnlineSelfTestState> {
      if (
        active === null ||
        active.guestOnline === null ||
        active.guestMatch === null
      ) {
        throw new Error("먼저 window.__onlineSelfTest.start()를 실행하세요.");
      }
      if (!active.hostOnline.active || !active.guestOnline.active) {
        throw new Error("참가자 수신 누락은 연결된 대국에서만 만들 수 있습니다.");
      }
      if (options.hostTurnRuntime.currentSide !== "white") {
        throw new Error("방장 백 차례에서만 참가자 한 턴 수신 누락을 만들 수 있습니다.");
      }
      const current = active;
      const guestOnline = active.guestOnline;
      const guestMatch = active.guestMatch;
      const startTurnIndex = current.hostOnline.nextTurnIndex;
      const hostStartStep =
        options.hostTurnRuntime.physicsStepNumber;
      const guestStartStep =
        guestMatch.turnRuntime.physicsStepNumber;
      current.hostTransport.dropTurnMessages = true;
      const outcome = current.hostOnline.queueLocalLaunch(
        createDeterministicLaunch(
          {
            physicsRuntime:
              options.hostTurnRuntime.physicsRuntime,
            sceneRuntime:
              options.hostTurnRuntime.sceneRuntime,
            turnRuntime: options.hostTurnRuntime,
          },
          "white",
          undefined,
        ),
      );
      if (!outcome.accepted) {
        current.hostTransport.dropTurnMessages = false;
        throw new Error(
          `방장 단독 진행 발사가 거절됐습니다: ${outcome.reason ?? "원인 없음"}`,
        );
      }
      await waitForCondition(
        "방장 단독 턴 정착",
        SELF_TEST_TURN_TIMEOUT_MS,
        () =>
          current.hostOnline.nextTurnIndex ===
            startTurnIndex + 1 &&
          options.hostTurnRuntime.phase === "ready" &&
          guestOnline.nextTurnIndex === startTurnIndex,
      );
      await current.hostOnline.flush();
      lastHostTurnStepCount =
        options.hostTurnRuntime.physicsStepNumber -
        hostStartStep;
      lastGuestTurnStepCount =
        guestMatch.turnRuntime.physicsStepNumber -
        guestStartStep;
      current.hostTransport.close();
      await waitForCondition(
        "한 턴 수신 누락 뒤 링크 단절",
        5_000,
        () =>
          !current.hostOnline.active &&
          !guestOnline.active,
      );
      return await refreshState();
    },

    async resign(side: PieceSide): Promise<OnlineSelfTestState> {
      if (
        active === null ||
        active.guestOnline === null
      ) {
        throw new Error("먼저 window.__onlineSelfTest.start()를 실행하세요.");
      }
      (side === "white"
        ? active.hostOnline
        : active.guestOnline
      ).resign(side);
      await waitForCondition(
        "양쪽 온라인 기권 처리",
        5_000,
        () =>
          !active!.hostOnline.active &&
          active!.guestOnline?.active === false,
      );
      return readState();
    },
  };

  return {
    api,
    stepGuest(): void {
      if (active === null) {
        return;
      }
      const guestMatch = active.guestMatch;
      if (guestMatch === null) {
        return;
      }
      applyPendingLaunchBeforeStep(
        guestMatch.turnRuntime,
      );
      guestMatch.physicsRuntime.world.step();
      updateTurnAfterStep(
        guestMatch.turnRuntime,
        FIXED_STEP,
      );
    },
    updateGuest(now: number): void {
      active?.guestOnline?.update(now);
    },
    destroy,
  };
}
