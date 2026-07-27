import { Vector3 } from "three";
import {
  updateDirectedShotTelegraph,
  type DirectedShotTelegraph,
} from "./ai";
import {
  cancelAim,
  type AimRuntime,
} from "./aim";
import {
  AI_AIM_PREVIEW_DELAY,
  FIXED_STEP,
  MAX_SETTLE_SECONDS,
} from "./config";
import type { PieceSide } from "./layout";
import {
  createPeerLink,
  type PeerDisconnectCause,
  type PeerLink,
  type PeerLinkState,
} from "./net";
import type { ReplayTurnRecord } from "./replay";
import { capturePhysicsStateHash } from "./state-hash";
import {
  beginCurrentTurnCameraRotation,
  applyPendingLaunchBeforeStep,
  canSelectTurnPiece,
  queueTurnLaunch,
  setLaunchAcceptedHandler,
  setTurnCameraPerspectiveSide,
  setTurnSettledHandler,
  updateTurnAfterStep,
  updateTurnCamera,
  type LaunchQueueResult,
  type TurnLaunchRequest,
  type TurnRuntime,
} from "./turn";

export interface OnlineReadyMessage {
  // 양쪽 표준 보드 재생성이 끝났음을 알리는 준비 메시지 종류다.
  kind: "ready";
  // 다른 대국의 준비 메시지를 섞지 않게 하는 매치 식별자다.
  matchId: string;
  // 방장은 백, 참가자는 흑이라는 연결 역할을 함께 검증한다.
  side: PieceSide;
  // 입력을 열기 전에 양쪽 표준 시작 월드가 같은지 확인하는 원시 상태 해시다.
  stateHash: string;
}

export interface OnlineTurnMessage
  extends Omit<ReplayTurnRecord, "postStateHash"> {
  // 해시를 기다리지 않고 상대 조준 연출을 시작하는 발사 입력 메시지다.
  kind: "turn";
}

export interface OnlineTurnHashMessage {
  // 방장 권위 상태와 참가자 상태를 대조하는 정착 해시 메시지다.
  kind: "turnHash";
  // 0부터 증가하는 완료 턴 번호다.
  turnIndex: number;
  // 원시 Float64 위치·회전 바이트열의 SHA-256이다.
  hash: string;
}

export interface OnlineStateRequestMessage {
  // 참가자가 불일치 턴의 방장 스냅샷을 요청하는 메시지다.
  kind: "stateRequest";
  // 불일치가 확인된 완료 턴 번호다.
  turnIndex: number;
}

export interface OnlineSnapshotPiece {
  // 현재 살아 있는 말의 고유 id다.
  id: string;
  // 월드 위치 x·y·z의 원래 JavaScript 숫자다.
  p: [number, number, number];
  // 월드 회전 quaternion x·y·z·w의 원래 JavaScript 숫자다.
  q: [number, number, number, number];
}

export interface OnlineStateSnapshotMessage {
  // 방장이 권위 상태를 참가자에게 보내는 복구 메시지다.
  kind: "stateSnapshot";
  // 스냅샷이 나타내는 완료 턴 번호다.
  turnIndex: number;
  // 살아 있는 모든 말의 위치·회전 목록이다.
  pieces: OnlineSnapshotPiece[];
}

export interface OnlineResumeMessage {
  // 새 WebRTC 링크에서 보유 턴과 상태를 대조하는 재개 인사다.
  kind: "resume";
  // 초대·응답 코드에서 합의한 이어받을 매치 식별자다.
  matchId: string;
  // 다음에 실행할 턴 번호다.
  turnIndex: number;
  // 현재 살아 있는 말 상태의 SHA-256이다.
  stateHash: string;
}

export interface OnlineResumeTailMessage {
  // 참가자가 놓친 입력 기록을 방장 권위 순서로 전달한다.
  kind: "resumeTail";
  // 첫 기록의 턴 번호다.
  fromTurnIndex: number;
  // 기록을 모두 재생한 뒤 도달해야 하는 방장의 다음 턴 번호다.
  targetTurnIndex: number;
  // 기록 재생 결과를 스냅샷 적용 전에 검증할 방장 권위 해시다.
  stateHash: string;
  // 방장이 보유한 입력 기록 꼬리다.
  turns: OnlineTurnMessage[];
}

export interface OnlineResignMessage {
  // 한 플레이어가 대국을 포기했음을 양쪽에 확정한다.
  kind: "resign";
  // 기권한 진영이다.
  side: PieceSide;
}

export type OnlineRematchAction =
  | "offer"
  | "accept"
  | "decline"
  | "cancel";

export interface OnlineRematchMessage {
  // 종료된 대국 위에서 새 대국 합의를 교환하는 메시지 종류다.
  kind: "rematch";
  // 요청·수락·거절·취소 중 수행할 재대결 동작이다.
  action: OnlineRematchAction;
  // 요청을 결정적으로 식별하고 새 매치 ID를 함께 도출하는 값이다.
  offerId: string;
}

export type OnlineMessage =
  | OnlineReadyMessage
  | OnlineTurnMessage
  | OnlineTurnHashMessage
  | OnlineStateRequestMessage
  | OnlineStateSnapshotMessage
  | OnlineResumeMessage
  | OnlineResumeTailMessage
  | OnlineResignMessage
  | OnlineRematchMessage;

export type OnlineRematchPhase =
  | "idle"
  | "outgoing"
  | "incoming"
  | "declined"
  | "starting"
  | "failed";

export interface OnlineRematchStatus {
  // 결과 화면이 표시할 현재 재대결 상태다.
  phase: OnlineRematchPhase;
  // 현재 응답하거나 기다리는 요청 ID이며 평상시에는 null이다.
  offerId: string | null;
  // 결과 화면에 그대로 표시할 한국어 상태 설명이다.
  message: string;
  // 살아 있는 피어 링크가 있어 재대결 메시지를 보낼 수 있는지 나타낸다.
  connected: boolean;
}

export interface OnlineTransport {
  // 실제 링크는 사용자 상태와 분리해 원래 끊김 원인을 제공한다.
  readonly disconnectCause?: PeerDisconnectCause;
  // JSON 직렬화 가능한 온라인 프로토콜 객체를 보낸다.
  send(payload: object): void;
  // 상대 프로토콜 객체 수신을 구독한다.
  onMessage(handler: (payload: object) => void): () => void;
  // 연결 끊김 때 로컬 입력을 즉시 막기 위한 상태 구독이다.
  onStateChange(handler: (state: PeerLinkState) => void): () => void;
  // 실제 또는 가짜 전송 계층을 닫는다.
  close(): void;
}

export interface OnlineRuntimeHooks {
  // 연결이 끊기면 입력 차단 화면을 열도록 게임 화면에 알린다.
  onDisconnected?: (cause: PeerDisconnectCause) => void;
  // 기권 진영이 확정되면 기존 결과 화면을 열도록 알린다.
  onResigned?: (resignedSide: PieceSide) => void;
  // 재대결 합의 뒤 기존 새 대국 경로로 표준 보드를 다시 준비한다.
  prepareRematch?: (matchId: string) => Promise<void>;
  // 요청·대기·거절·실패 상태가 바뀔 때 결과 오버레이를 갱신한다.
  onRematchStateChange?: (status: OnlineRematchStatus) => void;
  // 턴 0 해시까지 일치해 새 대국 입력이 열렸음을 화면 계층에 알린다.
  onRematchStarted?: (matchId: string) => void;
}

export interface OnlinePeerSession {
  // 연결이 끝난 실제 WebRTC 링크다.
  link: PeerLink;
  // 방장은 백, 참가자는 흑으로 고정된 이 브라우저 진영이다.
  mySide: PieceSide;
  // 최초 연결과 재접속을 같은 대국으로 묶는 식별자다.
  matchId: string;
  // 참가자가 새 대국이 아니라 기존 대국을 이어받아야 하는지 나타낸다.
  rejoining: boolean;
  // 보드 준비 또는 재동기화가 끝난 뒤 연결 패널을 닫는다.
  finishLobby(): void;
}

export interface OnlineLobbyOptions {
  // 재접속 방장은 기존 매치 식별자를 그대로 초대 코드에 넣는다.
  matchId?: string;
  // 새 게스트가 빈 보드에서 resume을 보내게 하는 재접속 초대 표식이다.
  rejoining?: boolean;
}

export interface OnlineRuntimeOptions {
  // 두 피어가 ready와 resume에서 반드시 일치시킬 매치 식별자다.
  matchId?: string;
}

export interface OnlineStartOptions {
  // 새 대국 ready 대신 현재 빈 상태의 resume을 보내 전체 기록을 요청한다.
  rejoining?: boolean;
}

interface ActiveOnlineTurn {
  // 이번 발사가 공유하는 프로토콜 턴 번호다.
  turnIndex: number;
  // 실제 발사한 진영이다.
  side: PieceSide;
  // 로컬 입력인지 받은 상대 입력인지 구분한다.
  origin: "local" | "remote";
}

interface RemoteTurnTelegraph {
  // 네트워크에서 받은 실제 발사 값 전체다.
  message: OnlineTurnMessage;
  // R33 공용 조준 진행 함수가 소비하는 표시 상태다.
  visual: DirectedShotTelegraph;
}

export interface OnlineHashComparison {
  // 양쪽 해시가 가리키는 완료 턴 번호다.
  turnIndex: number;
  // 방장이 보낸 권위 상태 해시다.
  hostHash: string;
  // 스냅샷 복구 전에 참가자가 직접 계산한 상태 해시다.
  guestHash: string;
  // 복구가 필요하지 않도록 두 원시 해시가 같았는지 나타낸다.
  matched: boolean;
}

export interface OnlineRuntime {
  // JSON 메시지만 아는 게임 비종속 전송 계층이다.
  transport: OnlineTransport;
  // 실제 발사·정착·스냅샷을 적용할 기존 턴 런타임이다.
  turnRuntime: TurnRuntime;
  // 브라우저에서 상대 조준을 보여 주고 헤드리스에서는 null이다.
  aimRuntime: AimRuntime | null;
  // 방장은 white, 참가자는 black인 로컬 소유 진영이다.
  mySide: PieceSide;
  // 내 진영이 백이면 권위 스냅샷을 제공하는 방장이다.
  isHost: boolean;
  // 새 연결이 같은 대국인지 검증하는 불변 매치 식별자다.
  matchId: string;
  // 표준 보드 재생성과 턴 후크 연결이 끝났는지 나타낸다.
  localReady: boolean;
  // 상대의 ready 메시지를 받았는지 나타낸다.
  remoteReady: boolean;
  // 양쪽 준비와 연결이 끝나 로컬 선택을 허용하는 상태다.
  active: boolean;
  // 다음에 수락할 순차 턴 번호다.
  nextTurnIndex: number;
  // 현재 물리 정착을 기다리는 발사 정보다.
  activeTurn: ActiveOnlineTurn | null;
  // 상대 입력을 실제 값 그대로 표시 중인 상태다.
  remoteTelegraph: RemoteTurnTelegraph | null;
  // 실제 불일치 복구를 수행하거나 제공한 누적 횟수다.
  desyncCount: number;
  // 디버그 오버레이에 보여 줄 마지막 연결·동기화 사건이다.
  lastEvent: string;
  // 정착된 전체 입력을 재접속 복구용으로 보존한다.
  turnLog: OnlineTurnMessage[];
  // 마지막 resumeTail과 스냅샷 JSON 전송량 합계다.
  lastResumeTransferBytes: number;
  // 마지막 재접속에서 입력 기록 재생만으로 권위 해시에 도달했는지 나타낸다.
  lastResumeReplayMatched: boolean | null;
  // 가장 최근 턴에서 스냅샷 복구 전에 실제 비교한 양쪽 원시 해시다.
  lastHashComparison: OnlineHashComparison | null;
  // 보드 재생성 뒤 턴 후크를 연결하고 ready 교환을 시작한다.
  startMatch(options?: OnlineStartOptions): void;
  // 양쪽 ready가 확인될 때까지 메뉴 진입 흐름이 기다리는 약속이다.
  waitUntilReady(): Promise<void>;
  // 매 렌더 프레임 상대 조준과 준비 재전송을 진행한다.
  update(now: number): void;
  // 기존 입력 선택 정책에서 온라인 소유권을 함께 검사한다.
  canSelectLocalPiece(pieceId: string): boolean;
  // 기존 queueTurnLaunch를 그대로 사용하면서 로컬 진영 소유권을 검사한다.
  queueLocalLaunch(request: TurnLaunchRequest): LaunchQueueResult;
  // 입력 계층이 상대 조준 중 자체 선택을 건드리지 않게 한다.
  isRemoteTelegraphActive(): boolean;
  // 헤드리스 검사가 비동기 SHA-256·복구 작업 완료를 기다린다.
  flush(): Promise<void>;
  // 디버그 오버레이가 읽을 온라인 상태를 반환한다.
  getDebugStatus(): {
    mySide: PieceSide;
    desyncCount: number;
    lastEvent: string;
  };
  // 끊어진 링크를 새 수동 시그널링 링크로 교체하고 resume를 교환한다.
  replaceTransport(transport: OnlineTransport): Promise<void>;
  // 내 진영의 기권을 상대에게 알리고 양쪽 결과 흐름을 끝낸다.
  resign(side?: PieceSide): void;
  // 연결된 결과 화면에서 결정적 ID로 재대결을 요청한다.
  offerRematch(): void;
  // 상대 재대결 요청을 수락하거나 거절한다.
  respondRematch(accept: boolean): void;
  // 아직 수락되지 않은 내 재대결 요청을 취소한다.
  cancelRematch(): void;
  // 결과 화면과 셀프테스트가 읽을 현재 재대결 상태를 반환한다.
  getRematchStatus(): OnlineRematchStatus;
  // 연결 단절 대국을 승패 없이 종료하고 모든 후속 입력을 막는다.
  terminate(): void;
  // 턴 후크·조준·연결·카메라 소유 설정을 모두 정리한다.
  close(): void;
}

// ready·resume이 초기 핸들러 설치보다 먼저 도착해도 다시 받을 수 있는 실제 시간 간격이다.
const READY_RETRY_MILLISECONDS = 500;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const MATCH_ID_PATTERN = /^[a-zA-Z0-9-]{8,64}$/u;
const REMATCH_OFFER_ID_PATTERN = /^(white|black)-[1-9][0-9]*$/u;
const LOBBY_CODE_PREFIX = "ca-online-1";

/**
 * 대국 물리 결정성과 무관한 128비트 브라우저 난수로 새 매치 식별자를 만든다.
 */
function createOnlineMatchId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * 외부 입력의 매치 식별자를 프로토콜에서 사용할 수 있는 짧은 문자열로 검증한다.
 */
function parseMatchId(value: unknown, label: string): string {
  if (typeof value !== "string" || !MATCH_ID_PATTERN.test(value)) {
    throw new Error(`${label} 매치 식별자가 유효하지 않습니다.`);
  }
  return value;
}

/**
 * 프로토콜 숫자 벡터가 필요한 길이와 유한값을 갖는지 검사한다.
 */
function parseNumberTuple(
  value: unknown,
  length: number,
  label: string,
): number[] {
  if (
    !Array.isArray(value) ||
    value.length !== length ||
    !value.every(
      (component) =>
        typeof component === "number" &&
        Number.isFinite(component),
    )
  ) {
    throw new Error(`${label}가 유한한 ${length}개 숫자 배열이 아닙니다.`);
  }
  return value;
}

/**
 * 임의 JSON 객체를 누락·NaN 없는 온라인 프로토콜 메시지로 엄격히 읽는다.
 */
export function parseOnlineMessage(
  payload: object,
): OnlineMessage {
  const source = payload as Record<string, unknown>;
  switch (source.kind) {
    case "ready": {
      if (
        (source.side !== "white" && source.side !== "black") ||
        typeof source.stateHash !== "string" ||
        !SHA256_PATTERN.test(source.stateHash)
      ) {
        throw new Error("온라인 ready 진영 또는 해시가 유효하지 않습니다.");
      }
      return {
        kind: "ready",
        matchId: parseMatchId(source.matchId, "온라인 ready"),
        side: source.side,
        stateHash: source.stateHash,
      };
    }
    case "turn": {
      if (
        typeof source.turnIndex !== "number" ||
        !Number.isInteger(source.turnIndex) ||
        source.turnIndex < 0 ||
        (source.side !== "white" && source.side !== "black") ||
        typeof source.pieceId !== "string" ||
        source.pieceId.length === 0 ||
        typeof source.normalizedPower !== "number" ||
        !Number.isFinite(source.normalizedPower) ||
        source.normalizedPower < 0 ||
        source.normalizedPower > 1 ||
        typeof source.speedMultiplier !== "number" ||
        !Number.isFinite(source.speedMultiplier) ||
        source.speedMultiplier !== 1
      ) {
        throw new Error("온라인 turn 필수 값이 유효하지 않습니다.");
      }
      const direction = source.direction as
        | Record<string, unknown>
        | null;
      const applicationPoint = source.applicationPoint as
        | Record<string, unknown>
        | null;
      if (
        direction === null ||
        typeof direction !== "object" ||
        applicationPoint === null ||
        typeof applicationPoint !== "object"
      ) {
        throw new Error("온라인 turn 방향 또는 적용점이 객체가 아닙니다.");
      }
      const directionValues = [
        direction.x,
        direction.y,
        direction.z,
      ];
      const applicationValues = [
        applicationPoint.x,
        applicationPoint.y,
        applicationPoint.z,
      ];
      if (
        !directionValues.every(
          (value) =>
            typeof value === "number" &&
            Number.isFinite(value),
        ) ||
        Math.hypot(
          directionValues[0] as number,
          directionValues[1] as number,
          directionValues[2] as number,
        ) <= 1e-12 ||
        !applicationValues.every(
          (value) =>
            typeof value === "number" &&
            Number.isFinite(value),
        )
      ) {
        throw new Error("온라인 turn 방향 또는 적용점 값이 유효하지 않습니다.");
      }
      return {
        kind: "turn",
        turnIndex: source.turnIndex,
        side: source.side,
        pieceId: source.pieceId,
        direction: {
          x: directionValues[0] as number,
          y: directionValues[1] as number,
          z: directionValues[2] as number,
        },
        normalizedPower: source.normalizedPower,
        applicationPoint: {
          x: applicationValues[0] as number,
          y: applicationValues[1] as number,
          z: applicationValues[2] as number,
        },
        speedMultiplier: source.speedMultiplier,
      };
    }
    case "turnHash": {
      if (
        typeof source.turnIndex !== "number" ||
        !Number.isInteger(source.turnIndex) ||
        source.turnIndex < 0 ||
        typeof source.hash !== "string" ||
        !SHA256_PATTERN.test(source.hash)
      ) {
        throw new Error("온라인 turnHash 값이 유효하지 않습니다.");
      }
      return {
        kind: "turnHash",
        turnIndex: source.turnIndex,
        hash: source.hash,
      };
    }
    case "stateRequest": {
      if (
        typeof source.turnIndex !== "number" ||
        !Number.isInteger(source.turnIndex) ||
        source.turnIndex < 0
      ) {
        throw new Error("온라인 stateRequest 턴 번호가 유효하지 않습니다.");
      }
      return {
        kind: "stateRequest",
        turnIndex: source.turnIndex,
      };
    }
    case "stateSnapshot": {
      if (
        typeof source.turnIndex !== "number" ||
        !Number.isInteger(source.turnIndex) ||
        source.turnIndex < 0 ||
        !Array.isArray(source.pieces)
      ) {
        throw new Error("온라인 stateSnapshot 기본 값이 유효하지 않습니다.");
      }
      const pieces = source.pieces.map(
        (piece, index): OnlineSnapshotPiece => {
          if (typeof piece !== "object" || piece === null) {
            throw new Error(`${index}번 스냅샷 말이 객체가 아닙니다.`);
          }
          const raw = piece as Record<string, unknown>;
          if (typeof raw.id !== "string" || raw.id.length === 0) {
            throw new Error(`${index}번 스냅샷 말 id가 없습니다.`);
          }
          const p = parseNumberTuple(raw.p, 3, `${raw.id} 위치`);
          const q = parseNumberTuple(raw.q, 4, `${raw.id} 회전`);
          return {
            id: raw.id,
            p: [p[0], p[1], p[2]],
            q: [q[0], q[1], q[2], q[3]],
          };
        },
      );
      return {
        kind: "stateSnapshot",
        turnIndex: source.turnIndex,
        pieces,
      };
    }
    case "resume": {
      if (
        typeof source.turnIndex !== "number" ||
        !Number.isInteger(source.turnIndex) ||
        source.turnIndex < 0 ||
        typeof source.stateHash !== "string" ||
        !SHA256_PATTERN.test(source.stateHash)
      ) {
        throw new Error("온라인 resume 턴 번호 또는 해시가 유효하지 않습니다.");
      }
      return {
        kind: "resume",
        matchId: parseMatchId(source.matchId, "온라인 resume"),
        turnIndex: source.turnIndex,
        stateHash: source.stateHash,
      };
    }
    case "resumeTail": {
      if (
        typeof source.fromTurnIndex !== "number" ||
        !Number.isInteger(source.fromTurnIndex) ||
        source.fromTurnIndex < 0 ||
        typeof source.targetTurnIndex !== "number" ||
        !Number.isInteger(source.targetTurnIndex) ||
        source.targetTurnIndex < source.fromTurnIndex ||
        typeof source.stateHash !== "string" ||
        !SHA256_PATTERN.test(source.stateHash) ||
        !Array.isArray(source.turns)
      ) {
        throw new Error("온라인 resumeTail 기본 값이 유효하지 않습니다.");
      }
      const turns = source.turns.map((turn) => {
        if (typeof turn !== "object" || turn === null) {
          throw new Error("온라인 resumeTail에 객체가 아닌 턴이 있습니다.");
        }
        const parsed = parseOnlineMessage(turn);
        if (parsed.kind !== "turn") {
          throw new Error("온라인 resumeTail에는 turn만 들어갈 수 있습니다.");
        }
        return parsed;
      });
      return {
        kind: "resumeTail",
        fromTurnIndex: source.fromTurnIndex,
        targetTurnIndex: source.targetTurnIndex,
        stateHash: source.stateHash,
        turns,
      };
    }
    case "resign": {
      if (source.side !== "white" && source.side !== "black") {
        throw new Error("온라인 resign 진영이 유효하지 않습니다.");
      }
      return { kind: "resign", side: source.side };
    }
    case "rematch": {
      if (
        source.action !== "offer" &&
        source.action !== "accept" &&
        source.action !== "decline" &&
        source.action !== "cancel"
      ) {
        throw new Error("온라인 rematch 동작이 유효하지 않습니다.");
      }
      if (
        typeof source.offerId !== "string" ||
        !REMATCH_OFFER_ID_PATTERN.test(source.offerId)
      ) {
        throw new Error("온라인 rematch 요청 식별자가 유효하지 않습니다.");
      }
      return {
        kind: "rematch",
        action: source.action,
        offerId: source.offerId,
      };
    }
    default:
      throw new Error(`알 수 없는 온라인 메시지 종류 ${String(source.kind)}입니다.`);
  }
}

/**
 * 현재 살아 있는 방장 말 상태를 JSON 숫자 스냅샷으로 고정한다.
 */
export function createOnlineStateSnapshot(
  turnRuntime: TurnRuntime,
  turnIndex: number,
): OnlineStateSnapshotMessage {
  const pieces = [...turnRuntime.physicsRuntime.pieces.values()]
    .sort((left, right) =>
      left.instance.id < right.instance.id
        ? -1
        : left.instance.id > right.instance.id
          ? 1
          : 0,
    )
    .map((binding): OnlineSnapshotPiece => {
      const position = binding.body.translation();
      const rotation = binding.body.rotation();
      return {
        id: binding.instance.id,
        p: [position.x, position.y, position.z],
        q: [
          rotation.x,
          rotation.y,
          rotation.z,
          rotation.w,
        ],
      };
    });
  return { kind: "stateSnapshot", turnIndex, pieces };
}

/**
 * 같은 살아 있는 말 집합에 방장 위치·회전을 적용하고 모든 운동을 지운 뒤 즉시 수면시킨다.
 */
export function applyOnlineStateSnapshot(
  turnRuntime: TurnRuntime,
  snapshot: OnlineStateSnapshotMessage,
): void {
  const preservesMatchOver =
    turnRuntime.phase === "match-over";
  const currentIds = [...turnRuntime.physicsRuntime.pieces.keys()].sort();
  const snapshotIds = snapshot.pieces
    .map((piece) => piece.id)
    .sort();
  const snapshotIdSet = new Set(snapshotIds);
  const missingLocalIds = snapshotIds.filter(
    (id) => !turnRuntime.physicsRuntime.pieces.has(id),
  );
  if (missingLocalIds.length > 0) {
    throw new Error(
      `온라인 스냅샷에 로컬에서 복원할 수 없는 말이 있습니다: ${missingLocalIds.join(",")}`,
    );
  }
  // 새 게스트의 초기 32말 중 방장 대국에서 이미 낙하한 말은 권위 스냅샷 적용 전에 제거한다.
  for (const pieceId of currentIds) {
    if (snapshotIdSet.has(pieceId)) {
      continue;
    }
    const binding = turnRuntime.physicsRuntime.pieces.get(pieceId);
    const mesh = turnRuntime.sceneRuntime.pieceMeshes.get(pieceId);
    if (binding === undefined) {
      continue;
    }
    turnRuntime.physicsRuntime.world.removeRigidBody(binding.body);
    turnRuntime.physicsRuntime.pieces.delete(pieceId);
    if (mesh !== undefined) {
      turnRuntime.sceneRuntime.scene.remove(mesh);
      turnRuntime.sceneRuntime.pieceMeshes.delete(pieceId);
    }
    turnRuntime.onPieceRemoved?.(pieceId);
  }
  for (const piece of snapshot.pieces) {
    const binding = turnRuntime.physicsRuntime.pieces.get(piece.id);
    if (binding === undefined) {
      throw new Error(`${piece.id} 스냅샷 대상 바디가 없습니다.`);
    }
    binding.body.setTranslation(
      { x: piece.p[0], y: piece.p[1], z: piece.p[2] },
      false,
    );
    binding.body.setRotation(
      {
        x: piece.q[0],
        y: piece.q[1],
        z: piece.q[2],
        w: piece.q[3],
      },
      false,
    );
    binding.body.setLinvel({ x: 0, y: 0, z: 0 }, false);
    binding.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
    binding.body.resetForces(false);
    binding.body.resetTorques(false);
    binding.body.enableCcd(false);
    binding.body.sleep();
  }
  // 강체 좌표를 직접 덮은 뒤 부착 콜라이더 좌표도 즉시 동기화한다.
  // 다음 발사 전까지 물리 스텝이 없어도 복구 직후의 충돌 공간 상태가 호스트와 같아진다.
  const world = turnRuntime.physicsRuntime.world;
  world.propagateModifiedBodyPositionsToColliders();
  // 시간을 진행하지 않는 한 스텝으로 접촉 캐시도 양쪽에서 같은 절차로 다시 만든다.
  const previousTimestep = world.timestep;
  try {
    world.timestep = 0;
    world.step();
  } finally {
    world.timestep = previousTimestep;
  }
  for (const binding of turnRuntime.physicsRuntime.pieces.values()) {
    binding.body.setLinvel({ x: 0, y: 0, z: 0 }, false);
    binding.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
    binding.body.resetForces(false);
    binding.body.resetTorques(false);
    binding.body.sleep();
  }
  const awakeIds = [...turnRuntime.physicsRuntime.pieces.values()]
    .filter((binding) => !binding.body.isSleeping())
    .map((binding) => binding.instance.id);
  if (awakeIds.length > 0) {
    throw new Error(
      `온라인 스냅샷 적용 뒤 깨어 있는 말: ${awakeIds.join(", ")}`,
    );
  }
  turnRuntime.pendingLaunch = null;
  turnRuntime.pendingTurnChange = false;
  turnRuntime.pendingRemovalIds.clear();
  turnRuntime.restHoldSeconds = 0;
  turnRuntime.settleSeconds = 0;
  turnRuntime.ccdPieceId = null;
  turnRuntime.cameraRotation = null;
  turnRuntime.phase = preservesMatchOver
    ? "match-over"
    : "ready";
  turnRuntime.sceneRuntime.controls.enabled =
    !preservesMatchOver;
}

/**
 * 온라인 표준 대국은 백부터 시작하므로 다음 턴 번호의 짝·홀로 현재 진영을 복원한다.
 */
function sideForOnlineTurnIndex(turnIndex: number): PieceSide {
  return turnIndex % 2 === 0 ? "white" : "black";
}

/**
 * 실제 링크 또는 헤드리스 가짜 전송 계층을 기존 턴 런타임에 연결한다.
 */
export function createOnlineRuntime(
  transport: OnlineTransport,
  turnRuntime: TurnRuntime,
  aimRuntime: AimRuntime | null,
  mySide: PieceSide,
  hooks: OnlineRuntimeHooks = {},
  options: OnlineRuntimeOptions = {},
): OnlineRuntime {
  let currentTransport = transport;
  const isHost = mySide === "white";
  let matchId = parseMatchId(
    options.matchId ?? "legacy-online-match",
    "온라인 런타임",
  );
  let hooksAttached = false;
  let launchOrigin: "local" | "remote" = "local";
  let remoteLaunchTurnIndex: number | null = null;
  let previousLaunchHandler = turnRuntime.onLaunchAccepted;
  let previousSettledHandler = turnRuntime.onTurnSettled;
  let launchHandler:
    | ((
        request: TurnLaunchRequest,
        side: PieceSide,
      ) => void)
    | null = null;
  let settledHandler: (() => void) | null = null;
  let lastReadySentAt = Number.NEGATIVE_INFINITY;
  let lastResumeSentAt = Number.NEGATIVE_INFINITY;
  let readyResolver: (() => void) | null = null;
  let readyRejecter: ((reason: Error) => void) | null = null;
  let pendingWork = Promise.resolve();
  let transportConnected = true;
  let sessionEnded = false;
  let rejoiningSession = false;
  let replayingResumeTail = false;
  let replayTurnIndex: number | null = null;
  let removeMessageHandler = (): void => {};
  let removeStateHandler = (): void => {};
  const localHashes = new Map<number, string>();
  const authoritativeHashes = new Map<number, string>();
  const hostSnapshots =
    new Map<number, OnlineStateSnapshotMessage>();
  const requestedSnapshots = new Set<number>();
  let awaitingResumeSnapshot = false;
  let resumeReplayMatched = false;
  let resumeTargetTurnIndex: number | null = null;
  let resumeTargetHash: string | null = null;
  let localReadyHash: string | null = null;
  let remoteReadyHash: string | null = null;
  let rematchOfferCounter = 0;
  let outgoingRematchOfferId: string | null = null;
  let incomingRematchOfferId: string | null = null;
  let rematchPreparationId: string | null = null;
  let rematchStatus: OnlineRematchStatus = {
    phase: "idle",
    offerId: null,
    message: "",
    connected: true,
  };

  // 상대 조준 표시와 예약 발사를 함께 지워 연결 종료 뒤 화면과 발사가 남지 않게 한다.
  const cancelRemoteTelegraph = (): void => {
    if (
      runtime.remoteTelegraph !== null &&
      aimRuntime !== null
    ) {
      cancelAim(aimRuntime, true);
    }
    runtime.remoteTelegraph = null;
  };

  // 재대결 상태를 불변 복사본으로 저장하고 결과 화면 구독자에게 즉시 알린다.
  const setRematchStatus = (
    next: Omit<OnlineRematchStatus, "connected">,
  ): void => {
    rematchStatus = {
      ...next,
      connected: transportConnected,
    };
    hooks.onRematchStateChange?.({ ...rematchStatus });
  };

  // 살아 있는 링크와 종료된 대국이 모두 있어야 재대결 협상을 허용한다.
  const assertCanRematch = (): void => {
    if (!transportConnected) {
      throw new Error(
        "상대 연결이 끊겨 재대결을 요청할 수 없습니다.",
      );
    }
    if (turnRuntime.phase !== "match-over") {
      throw new Error(
        "대국 결과가 확정된 뒤에만 재대결할 수 있습니다.",
      );
    }
    if (hooks.prepareRematch === undefined) {
      throw new Error(
        "재대결용 새 대국 준비 경로가 연결되지 않았습니다.",
      );
    }
  };

  // 요청 ID만으로 양쪽이 별도 왕복 없이 같은 새 매치 식별자를 만든다.
  const deriveRematchMatchId = (offerId: string): string =>
    parseMatchId(`rematch-${offerId}`, "재대결");

  const runtime: OnlineRuntime = {
    transport: currentTransport,
    turnRuntime,
    aimRuntime,
    mySide,
    isHost,
    matchId,
    localReady: false,
    remoteReady: false,
    active: false,
    nextTurnIndex: 0,
    activeTurn: null,
    remoteTelegraph: null,
    desyncCount: 0,
    lastEvent: "온라인 보드 준비 전",
    turnLog: [],
    lastResumeTransferBytes: 0,
    lastResumeReplayMatched: null,
    lastHashComparison: null,

    startMatch(startOptions: OnlineStartOptions = {}): void {
      if (hooksAttached) {
        throw new Error("온라인 대국 턴 후크가 이미 연결됐습니다.");
      }
      sessionEnded = false;
      rejoiningSession = startOptions.rejoining === true;
      hooksAttached = true;
      previousLaunchHandler = turnRuntime.onLaunchAccepted;
      previousSettledHandler = turnRuntime.onTurnSettled;
      launchHandler = (request, side) => {
        if (!replayingResumeTail) {
          previousLaunchHandler?.(request, side);
        }
        const turnIndex =
          replayingResumeTail
            ? replayTurnIndex
            : launchOrigin === "remote"
            ? remoteLaunchTurnIndex
            : runtime.nextTurnIndex;
        if (turnIndex === null) {
          throw new Error("상대 발사의 프로토콜 턴 번호가 없습니다.");
        }
        if (runtime.activeTurn !== null) {
          throw new Error(
            `${runtime.activeTurn.turnIndex}번 온라인 턴이 아직 정착되지 않았습니다.`,
          );
        }
        runtime.activeTurn = {
          turnIndex,
          side,
          origin: launchOrigin,
        };
        const message: OnlineTurnMessage = {
            kind: "turn",
            turnIndex,
            side,
            pieceId: request.pieceId,
            direction: {
              x: request.direction.x,
              y: request.direction.y,
              z: request.direction.z,
            },
            normalizedPower: request.normalizedPower,
            applicationPoint: {
              x: request.applicationPoint.x,
              y: request.applicationPoint.y,
              z: request.applicationPoint.z,
            },
            speedMultiplier: request.speedMultiplier ?? 1,
        };
        if (!runtime.turnLog.some((turn) => turn.turnIndex === turnIndex)) {
          runtime.turnLog.push(message);
        }
        if (replayingResumeTail) {
          runtime.lastEvent = `${turnIndex}번 재접속 기록 재생`;
        } else if (launchOrigin === "local") {
          currentTransport.send(message);
          runtime.lastEvent = `${turnIndex}번 로컬 발사 전송`;
        } else {
          runtime.lastEvent = `${turnIndex}번 상대 발사 적용`;
        }
      };
      settledHandler = () => {
        if (!replayingResumeTail) {
          previousSettledHandler?.();
        }
        const completedTurn = runtime.activeTurn;
        if (completedTurn === null) {
          throw new Error("정착된 온라인 활성 턴이 없습니다.");
        }
        runtime.activeTurn = null;
        runtime.nextTurnIndex = completedTurn.turnIndex + 1;
        if (replayingResumeTail) {
          return;
        }
        const statePromise = capturePhysicsStateHash(
          turnRuntime.physicsRuntime,
        );
        const snapshot = isHost
          ? createOnlineStateSnapshot(
              turnRuntime,
              completedTurn.turnIndex,
            )
          : null;
        pendingWork = pendingWork.then(async () => {
          const state = await statePromise;
          localHashes.set(completedTurn.turnIndex, state.sha256);
          if (isHost && snapshot !== null) {
            hostSnapshots.set(completedTurn.turnIndex, snapshot);
            const message: OnlineTurnHashMessage = {
              kind: "turnHash",
              turnIndex: completedTurn.turnIndex,
              hash: state.sha256,
            };
            if (transportConnected) {
              currentTransport.send(message);
            }
            runtime.lastEvent =
              `${completedTurn.turnIndex}번 권위 해시 전송`;
          } else {
            compareGuestHash(completedTurn.turnIndex);
          }
        });
      };
      setLaunchAcceptedHandler(turnRuntime, launchHandler);
      setTurnSettledHandler(turnRuntime, settledHandler);
      setTurnCameraPerspectiveSide(turnRuntime, mySide);
      beginCurrentTurnCameraRotation(turnRuntime);
      if (rejoiningSession) {
        runtime.localReady = true;
        lastResumeSentAt = performance.now();
        pendingWork = pendingWork.then(async () => {
          await sendResumeState();
          runtime.lastEvent = "대국을 이어받는 중입니다.";
        });
      } else {
        runtime.localReady = false;
        pendingWork = pendingWork.then(async () => {
          const state = await capturePhysicsStateHash(
            turnRuntime.physicsRuntime,
          );
          localReadyHash = state.sha256;
          runtime.localReady = true;
          sendReady(performance.now());
          updateActiveState();
          runtime.lastEvent = "내 보드 준비 완료";
        });
      }
    },

    waitUntilReady(): Promise<void> {
      if (runtime.active) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve, reject) => {
        readyResolver = resolve;
        readyRejecter = reject;
      });
    },

    update(now: number): void {
      if (
        !sessionEnded &&
        !rejoiningSession &&
        transportConnected &&
        runtime.localReady &&
        !runtime.active &&
        now - lastReadySentAt >= READY_RETRY_MILLISECONDS
      ) {
        sendReady(now);
      }
      if (
        !sessionEnded &&
        rejoiningSession &&
        transportConnected &&
        runtime.localReady &&
        !runtime.active &&
        now - lastResumeSentAt >= READY_RETRY_MILLISECONDS
      ) {
        lastResumeSentAt = now;
        pendingWork = pendingWork.then(sendResumeState);
      }
      const remote = runtime.remoteTelegraph;
      if (remote === null || !runtime.active) {
        return;
      }
      const readyToLaunch =
        aimRuntime === null ||
        updateDirectedShotTelegraph(
          aimRuntime,
          remote.visual,
          now,
        );
      if (!readyToLaunch) {
        return;
      }
      remoteLaunchTurnIndex = remote.message.turnIndex;
      launchOrigin = "remote";
      const outcome = queueTurnLaunch(turnRuntime, {
        pieceId: remote.message.pieceId,
        direction: new Vector3(
          remote.message.direction.x,
          remote.message.direction.y,
          remote.message.direction.z,
        ),
        normalizedPower: remote.message.normalizedPower,
        applicationPoint: new Vector3(
          remote.message.applicationPoint.x,
          remote.message.applicationPoint.y,
          remote.message.applicationPoint.z,
        ),
        speedMultiplier: remote.message.speedMultiplier,
      });
      launchOrigin = "local";
      remoteLaunchTurnIndex = null;
      if (!outcome.accepted) {
        throw new Error(
          `상대 ${remote.message.turnIndex}번 발사 거절: ${outcome.reason ?? "원인 없음"}`,
        );
      }
      if (aimRuntime !== null) {
        cancelAim(aimRuntime, true);
      }
      runtime.remoteTelegraph = null;
    },

    canSelectLocalPiece(pieceId: string): boolean {
      return (
        runtime.active &&
        turnRuntime.currentSide === mySide &&
        canSelectTurnPiece(turnRuntime, pieceId)
      );
    },

    queueLocalLaunch(
      request: TurnLaunchRequest,
    ): LaunchQueueResult {
      if (sessionEnded) {
        return {
          accepted: false,
          reason: "온라인 대국이 이미 종료되었습니다.",
        };
      }
      if (!runtime.active) {
        return {
          accepted: false,
          reason: "온라인 연결이 준비되지 않았습니다.",
        };
      }
      if (turnRuntime.currentSide !== mySide) {
        return {
          accepted: false,
          reason: `${mySide} 로컬 플레이어의 턴이 아닙니다.`,
        };
      }
      launchOrigin = "local";
      return queueTurnLaunch(turnRuntime, request);
    },

    isRemoteTelegraphActive(): boolean {
      return runtime.remoteTelegraph !== null;
    },

    async flush(): Promise<void> {
      while (true) {
        const work = pendingWork;
        await work;
        if (work === pendingWork) {
          return;
        }
      }
    },

    getDebugStatus() {
      return {
        mySide,
        desyncCount: runtime.desyncCount,
        lastEvent:
          currentTransport.disconnectCause === undefined ||
          currentTransport.disconnectCause === null
            ? runtime.lastEvent
            : `${runtime.lastEvent} · ${currentTransport.disconnectCause}`,
      };
    },

    async replaceTransport(nextTransport: OnlineTransport): Promise<void> {
      if (sessionEnded) {
        throw new Error("종료된 온라인 대국은 재연결할 수 없습니다.");
      }
      rejoiningSession = true;
      removeMessageHandler();
      removeStateHandler();
      currentTransport.close();
      currentTransport = nextTransport;
      runtime.transport = nextTransport;
      transportConnected = false;
      bindTransport();
      await new Promise<void>((resolve, reject) => {
        let remove = (): void => {};
        remove = nextTransport.onStateChange((state) => {
          if (state === "connected") {
            remove();
            resolve();
          } else if (state === "failed") {
            remove();
            reject(new Error("새 P2P 링크 연결에 실패했습니다."));
          }
        });
      });
      lastResumeSentAt = performance.now();
      await sendResumeState();
      runtime.lastEvent = "재연결 상태 대조 중";
      await new Promise<void>((resolve, reject) => {
        const startedAt = performance.now();
        const inspect = (): void => {
          if (runtime.active) {
            resolve();
          } else if (performance.now() - startedAt >= 10_000) {
            reject(new Error("재연결 상태 동기화가 10초 안에 끝나지 않았습니다."));
          } else {
            globalThis.setTimeout(inspect, 25);
          }
        };
        inspect();
      });
    },

    resign(side = mySide): void {
      if (side !== mySide) {
        throw new Error("내 진영만 기권할 수 있습니다.");
      }
      const message: OnlineResignMessage = {
        kind: "resign",
        side,
      };
      if (transportConnected) {
        currentTransport.send(message);
      }
      sessionEnded = true;
      runtime.active = false;
      turnRuntime.phase = "match-over";
      turnRuntime.sceneRuntime.controls.enabled = false;
      cancelRemoteTelegraph();
      hooks.onResigned?.(side);
      runtime.lastEvent = `${side} 기권`;
    },

    offerRematch(): void {
      assertCanRematch();
      if (
        rematchStatus.phase === "outgoing" ||
        rematchStatus.phase === "incoming" ||
        rematchStatus.phase === "starting"
      ) {
        throw new Error("이미 처리 중인 재대결 요청이 있습니다.");
      }
      rematchOfferCounter += 1;
      const offerId = `${mySide}-${rematchOfferCounter}`;
      outgoingRematchOfferId = offerId;
      incomingRematchOfferId = null;
      const message: OnlineRematchMessage = {
        kind: "rematch",
        action: "offer",
        offerId,
      };
      currentTransport.send(message);
      setRematchStatus({
        phase: "outgoing",
        offerId,
        message: "상대 응답을 기다리는 중",
      });
    },

    respondRematch(accept: boolean): void {
      assertCanRematch();
      const offerId = incomingRematchOfferId;
      if (
        rematchStatus.phase !== "incoming" ||
        offerId === null
      ) {
        throw new Error("응답할 상대 재대결 요청이 없습니다.");
      }
      const message: OnlineRematchMessage = {
        kind: "rematch",
        action: accept ? "accept" : "decline",
        offerId,
      };
      currentTransport.send(message);
      incomingRematchOfferId = null;
      if (accept) {
        beginRematch(offerId);
      } else {
        setRematchStatus({
          phase: "idle",
          offerId: null,
          message: "",
        });
      }
    },

    cancelRematch(): void {
      assertCanRematch();
      const offerId = outgoingRematchOfferId;
      if (
        rematchStatus.phase !== "outgoing" ||
        offerId === null
      ) {
        throw new Error("취소할 재대결 요청이 없습니다.");
      }
      const message: OnlineRematchMessage = {
        kind: "rematch",
        action: "cancel",
        offerId,
      };
      currentTransport.send(message);
      outgoingRematchOfferId = null;
      setRematchStatus({
        phase: "idle",
        offerId: null,
        message: "",
      });
    },

    getRematchStatus(): OnlineRematchStatus {
      return {
        ...rematchStatus,
        connected: transportConnected,
      };
    },

    terminate(): void {
      sessionEnded = true;
      runtime.active = false;
      turnRuntime.phase = "match-over";
      turnRuntime.sceneRuntime.controls.enabled = false;
      cancelRemoteTelegraph();
      runtime.lastEvent = "연결 단절 대국 종료";
      setRematchStatus({
        phase: "idle",
        offerId: null,
        message: "",
      });
    },

    close(): void {
      removeMessageHandler();
      removeStateHandler();
      if (
        hooksAttached &&
        turnRuntime.onLaunchAccepted === launchHandler
      ) {
        setLaunchAcceptedHandler(
          turnRuntime,
          previousLaunchHandler,
        );
      }
      if (
        hooksAttached &&
        turnRuntime.onTurnSettled === settledHandler
      ) {
        setTurnSettledHandler(
          turnRuntime,
          previousSettledHandler,
        );
      }
      hooksAttached = false;
      cancelRemoteTelegraph();
      runtime.active = false;
      setTurnCameraPerspectiveSide(turnRuntime, null);
      currentTransport.close();
      runtime.lastEvent = "온라인 연결 종료";
    },
  };

  // 새 표준 보드를 준비한 뒤 기록·복구 상태를 비우고 턴 0 ready 해시 교환을 시작한다.
  const beginRematch = (offerId: string): void => {
    const nextMatchId = deriveRematchMatchId(offerId);
    if (
      rematchPreparationId === nextMatchId ||
      runtime.matchId === nextMatchId
    ) {
      return;
    }
    if (hooks.prepareRematch === undefined) {
      throw new Error(
        "재대결용 새 대국 준비 경로가 연결되지 않았습니다.",
      );
    }
    rematchPreparationId = nextMatchId;
    outgoingRematchOfferId = null;
    incomingRematchOfferId = null;
    runtime.active = false;
    runtime.localReady = false;
    runtime.remoteReady = false;
    turnRuntime.sceneRuntime.controls.enabled = false;
    cancelRemoteTelegraph();
    setRematchStatus({
      phase: "starting",
      offerId,
      message: "새 대국을 준비하는 중입니다",
    });
    matchId = nextMatchId;
    runtime.matchId = nextMatchId;
    sessionEnded = false;
    rejoiningSession = false;
    replayingResumeTail = false;
    replayTurnIndex = null;
    runtime.nextTurnIndex = 0;
    runtime.activeTurn = null;
    runtime.turnLog.length = 0;
    runtime.desyncCount = 0;
    runtime.lastResumeTransferBytes = 0;
    runtime.lastResumeReplayMatched = null;
    runtime.lastHashComparison = null;
    localHashes.clear();
    authoritativeHashes.clear();
    hostSnapshots.clear();
    requestedSnapshots.clear();
    awaitingResumeSnapshot = false;
    resumeReplayMatched = false;
    resumeTargetTurnIndex = null;
    resumeTargetHash = null;
    localReadyHash = null;
    remoteReadyHash = null;
    runtime.localReady = false;
    runtime.remoteReady = false;
    const prepareRematch = hooks.prepareRematch;
    pendingWork = pendingWork
      .then(async () => {
        await prepareRematch(nextMatchId);
        setTurnCameraPerspectiveSide(turnRuntime, mySide);
        beginCurrentTurnCameraRotation(turnRuntime);
        const state = await capturePhysicsStateHash(
          turnRuntime.physicsRuntime,
        );
        localReadyHash = state.sha256;
        runtime.localReady = true;
        sendReady(performance.now());
        updateActiveState();
        runtime.lastEvent = "재대결 턴 0 해시 대조 중";
      })
      .catch((error: unknown) => {
        const failure =
          error instanceof Error ? error : new Error(String(error));
        rematchPreparationId = null;
        runtime.active = false;
        turnRuntime.phase = "match-over";
        turnRuntime.sceneRuntime.controls.enabled = false;
        setRematchStatus({
          phase: "failed",
          offerId,
          message: `재대결 시작 실패: ${failure.message}`,
        });
        console.error(failure.stack ?? failure.message);
      });
  };

  // 최초 ready 또는 재접속 동기화가 끝나면 입력과 메뉴 대기를 함께 해제한다.
  const activateRuntime = (event: string): void => {
    const startedRematchId = rematchPreparationId;
    rejoiningSession = false;
    runtime.active = true;
    runtime.lastEvent = event;
    readyResolver?.();
    readyResolver = null;
    readyRejecter = null;
    if (startedRematchId !== null) {
      rematchPreparationId = null;
      setRematchStatus({
        phase: "idle",
        offerId: null,
        message: "",
      });
      hooks.onRematchStarted?.(startedRematchId);
    }
  };

  // 양쪽 ready가 모두 도착하면 입력을 열고 메뉴 대기를 해제한다.
  const updateActiveState = (): void => {
    if (
      sessionEnded ||
      runtime.active ||
      !transportConnected ||
      !runtime.localReady ||
      !runtime.remoteReady ||
      localReadyHash === null ||
      remoteReadyHash === null
    ) {
      return;
    }
    if (localReadyHash !== remoteReadyHash) {
      const failure = new Error(
        `온라인 턴 0 상태 해시가 다릅니다: local=${localReadyHash}, remote=${remoteReadyHash}`,
      );
      runtime.active = false;
      turnRuntime.phase = "match-over";
      turnRuntime.sceneRuntime.controls.enabled = false;
      runtime.lastEvent = "턴 0 해시 불일치";
      readyRejecter?.(failure);
      readyResolver = null;
      readyRejecter = null;
      if (rematchPreparationId !== null) {
        const failedOfferId =
          rematchStatus.offerId ?? outgoingRematchOfferId;
        rematchPreparationId = null;
        setRematchStatus({
          phase: "failed",
          offerId: failedOfferId,
          message: "재대결 시작 실패: 턴 0 상태가 서로 다릅니다.",
        });
      }
      console.error(failure.stack ?? failure.message);
      return;
    }
    activateRuntime("양쪽 보드 준비 완료");
  };

  // 초기 핸들러 설치 경합을 견디도록 ready를 주기적으로 같은 값으로 보낸다.
  const sendReady = (now: number): void => {
    const message: OnlineReadyMessage = {
      kind: "ready",
      matchId,
      side: mySide,
      stateHash:
        localReadyHash ??
        (() => {
          throw new Error("온라인 ready를 보낼 로컬 상태 해시가 없습니다.");
        })(),
    };
    currentTransport.send(message);
    lastReadySentAt = now;
  };

  // 현재 턴 번호와 원시 상태 해시를 새 링크의 같은 매치 상대에게 보낸다.
  const sendResumeState = async (): Promise<void> => {
    const state = await capturePhysicsStateHash(
      turnRuntime.physicsRuntime,
    );
    const resume: OnlineResumeMessage = {
      kind: "resume",
      matchId,
      turnIndex: runtime.nextTurnIndex,
      stateHash: state.sha256,
    };
    currentTransport.send(resume);
    lastResumeSentAt = performance.now();
  };

  /**
   * 새 참가자의 표준 시작 월드에서 누락된 입력을 실제 발사·정착 경로로 재생해 Rapier 내부 이력까지 복원한다.
   */
  const replayResumeTurns = async (
    message: OnlineResumeTailMessage,
  ): Promise<boolean> => {
    const turns = message.turns
      .filter((turn) => turn.turnIndex >= runtime.nextTurnIndex)
      .sort((left, right) => left.turnIndex - right.turnIndex);
    const maximumSteps = Math.ceil(
      (MAX_SETTLE_SECONDS * 2) / FIXED_STEP,
    );
    turnRuntime.currentSide =
      sideForOnlineTurnIndex(runtime.nextTurnIndex);
    replayingResumeTail = true;
    try {
      for (const turn of turns) {
        if (
          turn.turnIndex !== runtime.nextTurnIndex ||
          turn.side !== turnRuntime.currentSide
        ) {
          throw new Error(
            `${turn.turnIndex}번 재접속 기록의 순서·진영이 현재 ${runtime.nextTurnIndex}번 ${turnRuntime.currentSide}과 다릅니다.`,
          );
        }
        if (turnRuntime.phase === "camera-rotating") {
          updateTurnCamera(turnRuntime, Number.POSITIVE_INFINITY);
        }
        if (turnRuntime.phase !== "ready") {
          throw new Error(
            `${turn.turnIndex}번 재접속 기록 재생 전 턴 단계가 ${turnRuntime.phase}입니다.`,
          );
        }
        replayTurnIndex = turn.turnIndex;
        const outcome = queueTurnLaunch(turnRuntime, {
          pieceId: turn.pieceId,
          direction: new Vector3(
            turn.direction.x,
            turn.direction.y,
            turn.direction.z,
          ),
          normalizedPower: turn.normalizedPower,
          applicationPoint: new Vector3(
            turn.applicationPoint.x,
            turn.applicationPoint.y,
            turn.applicationPoint.z,
          ),
          speedMultiplier: turn.speedMultiplier,
        });
        if (!outcome.accepted) {
          throw new Error(
            `${turn.turnIndex}번 재접속 기록 발사 거절: ${outcome.reason ?? "원인 없음"}`,
          );
        }
        let steps = 0;
        while (
          steps < maximumSteps &&
          String(turnRuntime.phase) === "settling"
        ) {
          applyPendingLaunchBeforeStep(turnRuntime);
          turnRuntime.physicsRuntime.world.step();
          updateTurnAfterStep(turnRuntime, FIXED_STEP);
          steps += 1;
        }
        if (String(turnRuntime.phase) === "camera-rotating") {
          updateTurnCamera(turnRuntime, Number.POSITIVE_INFINITY);
        }
        if (
          turnRuntime.phase !== "ready" ||
          runtime.nextTurnIndex !== turn.turnIndex + 1
        ) {
          throw new Error(
            `${turn.turnIndex}번 재접속 기록이 ${maximumSteps} step 안에 정착되지 않았습니다: phase=${turnRuntime.phase}, next=${runtime.nextTurnIndex}`,
          );
        }
      }
      const replayed = await capturePhysicsStateHash(
        turnRuntime.physicsRuntime,
      );
      return (
        runtime.nextTurnIndex === message.targetTurnIndex &&
        replayed.sha256 === message.stateHash
      );
    } finally {
      replayTurnIndex = null;
      replayingResumeTail = false;
    }
  };

  // 참가자는 방장 해시와 자기 해시가 모두 있을 때만 불일치 복구를 요청한다.
  const compareGuestHash = (turnIndex: number): void => {
    if (isHost || requestedSnapshots.has(turnIndex)) {
      return;
    }
    const localHash = localHashes.get(turnIndex);
    const hostHash = authoritativeHashes.get(turnIndex);
    if (localHash === undefined || hostHash === undefined) {
      return;
    }
    runtime.lastHashComparison = {
      turnIndex,
      hostHash,
      guestHash: localHash,
      matched: localHash === hostHash,
    };
    if (localHash === hostHash) {
      runtime.lastEvent = `${turnIndex}번 해시 일치`;
      return;
    }
    requestedSnapshots.add(turnIndex);
    runtime.desyncCount += 1;
    const request: OnlineStateRequestMessage = {
      kind: "stateRequest",
      turnIndex,
    };
    currentTransport.send(request);
    runtime.lastEvent = `${turnIndex}번 해시 불일치·복구 요청`;
  };

  // 프로토콜 오류를 전체 스택으로 남기고 온라인 입력을 닫는다.
  const handleProtocolError = (error: unknown): void => {
    const failure =
      error instanceof Error ? error : new Error(String(error));
    const fullError = failure.stack ?? failure.message;
    console.error(`[온라인 프로토콜] ${fullError}`);
    runtime.active = false;
    cancelRemoteTelegraph();
    runtime.lastEvent = "프로토콜 오류";
    readyRejecter?.(failure);
    readyResolver = null;
    readyRejecter = null;
    if (rematchPreparationId !== null) {
      const failedOfferId = rematchStatus.offerId;
      rematchPreparationId = null;
      setRematchStatus({
        phase: "failed",
        offerId: failedOfferId,
        message: `재대결 시작 실패: ${failure.message}`,
      });
    }
  };

  const handleMessage = (payload: object): void => {
    try {
      const message = parseOnlineMessage(payload);
      switch (message.kind) {
        case "ready": {
          if (
            sessionEnded &&
            rematchPreparationId === null
          ) {
            return;
          }
          const expectedMatchId =
            rematchPreparationId ?? matchId;
          if (message.matchId !== expectedMatchId) {
            throw new Error(
              `온라인 ready 매치가 다릅니다: local=${expectedMatchId}, remote=${message.matchId}`,
            );
          }
          if (message.side === mySide) {
            throw new Error("상대 ready 진영이 내 진영과 같습니다.");
          }
          runtime.remoteReady = true;
          remoteReadyHash = message.stateHash;
          updateActiveState();
          return;
        }
        case "turn": {
          if (
            !runtime.active ||
            message.turnIndex !== runtime.nextTurnIndex ||
            message.side === mySide ||
            message.side !== turnRuntime.currentSide ||
            turnRuntime.phase !== "ready" ||
            runtime.remoteTelegraph !== null
          ) {
            throw new Error(
              `${message.turnIndex}번 상대 turn의 순서·진영·단계가 맞지 않습니다.`,
            );
          }
          const binding =
            turnRuntime.physicsRuntime.pieces.get(message.pieceId);
          if (
            binding === undefined ||
            binding.instance.side !== message.side
          ) {
            throw new Error(
              `${message.pieceId}가 상대 진영의 살아 있는 말이 아닙니다.`,
            );
          }
          const direction = new Vector3(
            message.direction.x,
            message.direction.y,
            message.direction.z,
          );
          runtime.remoteTelegraph = {
            message,
            visual: {
              pieceId: message.pieceId,
              direction,
              applicationPoint: new Vector3(
                message.applicationPoint.x,
                message.applicationPoint.y,
                message.applicationPoint.z,
              ),
              normalizedPower: message.normalizedPower,
              previewAt:
                performance.now() +
                AI_AIM_PREVIEW_DELAY * 1000,
              chargeStartedAt: null,
            },
          };
          runtime.lastEvent = `${message.turnIndex}번 상대 조준 수신`;
          return;
        }
        case "turnHash": {
          if (isHost) {
            throw new Error("참가자가 권위 turnHash를 보냈습니다.");
          }
          authoritativeHashes.set(
            message.turnIndex,
            message.hash,
          );
          if (
            awaitingResumeSnapshot &&
            resumeTargetTurnIndex === message.turnIndex
          ) {
            // 기록 재생 실패 뒤 도착한 정규화 해시를 스냅샷 검증 기준으로 교체한다.
            resumeTargetHash = message.hash;
          }
          compareGuestHash(message.turnIndex);
          return;
        }
        case "stateRequest": {
          if (!isHost) {
            throw new Error("방장이 아닌 쪽에 stateRequest가 도착했습니다.");
          }
          const snapshot = hostSnapshots.get(message.turnIndex);
          if (snapshot === undefined) {
            throw new Error(
              `${message.turnIndex}번 권위 스냅샷이 없습니다.`,
            );
          }
          runtime.desyncCount += 1;
          // 양쪽 런타임이 같은 위치 덮어쓰기·수면 절차를 거치게 해 Rapier 내부 상태도 정규화한다.
          applyOnlineStateSnapshot(turnRuntime, snapshot);
          // setRotation의 quaternion 정규화까지 반영된 방장 상태를 새 권위 기준으로 보낸다.
          // 적용 전 해시와 적용 후 pose를 섞으면 양쪽 월드가 같아도 복구 검증이 실패한다.
          const canonicalSnapshot = createOnlineStateSnapshot(
            turnRuntime,
            message.turnIndex,
          );
          const canonicalStatePromise = capturePhysicsStateHash(
            turnRuntime.physicsRuntime,
          );
          pendingWork = pendingWork.then(async () => {
            const canonicalState = await canonicalStatePromise;
            localHashes.set(
              message.turnIndex,
              canonicalState.sha256,
            );
            hostSnapshots.set(
              message.turnIndex,
              canonicalSnapshot,
            );
            const correctedHash: OnlineTurnHashMessage = {
              kind: "turnHash",
              turnIndex: message.turnIndex,
              hash: canonicalState.sha256,
            };
            currentTransport.send(correctedHash);
            currentTransport.send(canonicalSnapshot);
            runtime.lastEvent =
              `${message.turnIndex}번 정규화 권위 스냅샷 전송`;
          });
          return;
        }
        case "stateSnapshot": {
          if (
            isHost ||
            (!awaitingResumeSnapshot &&
              !requestedSnapshots.has(message.turnIndex))
          ) {
            throw new Error("요청하지 않은 stateSnapshot이 도착했습니다.");
          }
          if (awaitingResumeSnapshot) {
            pendingWork = pendingWork.then(async () => {
              if (
                resumeTargetTurnIndex === null ||
                resumeTargetHash === null ||
                message.turnIndex !== resumeTargetTurnIndex
              ) {
                throw new Error(
                  `${message.turnIndex}번 재접속 스냅샷이 기다리던 ${resumeTargetTurnIndex ?? "없음"}번과 다릅니다.`,
                );
              }
              if (!resumeReplayMatched) {
                applyOnlineStateSnapshot(turnRuntime, message);
                const recovered = await capturePhysicsStateHash(
                  turnRuntime.physicsRuntime,
                );
                if (recovered.sha256 !== resumeTargetHash) {
                  throw new Error(
                    `${message.turnIndex}번 재접속 스냅샷 적용 뒤 해시가 방장과 다릅니다.`,
                  );
                }
              }
              awaitingResumeSnapshot = false;
              requestedSnapshots.delete(message.turnIndex);
              runtime.nextTurnIndex = message.turnIndex;
              turnRuntime.currentSide =
                sideForOnlineTurnIndex(message.turnIndex);
              activateRuntime(
                resumeReplayMatched
                  ? `${message.turnIndex}번 전체 기록 재생으로 재개`
                  : `${message.turnIndex}번 방장 상태로 재개`,
              );
              resumeReplayMatched = false;
              resumeTargetTurnIndex = null;
              resumeTargetHash = null;
            });
            return;
          }
          applyOnlineStateSnapshot(turnRuntime, message);
          const verificationPromise = capturePhysicsStateHash(
            turnRuntime.physicsRuntime,
          );
          pendingWork = pendingWork.then(async () => {
            const recovered = await verificationPromise;
            const expected = authoritativeHashes.get(
              message.turnIndex,
            );
            if (expected === undefined || recovered.sha256 !== expected) {
              throw new Error(
                `${message.turnIndex}번 스냅샷 적용 뒤 해시가 방장과 다릅니다.`,
              );
            }
            localHashes.set(message.turnIndex, recovered.sha256);
            requestedSnapshots.delete(message.turnIndex);
            runtime.lastEvent =
              `${message.turnIndex}번 스냅샷 복구 완료`;
          });
          return;
        }
        case "resume": {
          if (sessionEnded) {
            throw new Error("종료된 온라인 대국에 resume이 도착했습니다.");
          }
          if (!runtime.localReady) {
            runtime.lastEvent = "로컬 보드 준비 전 재개 메시지 대기";
            return;
          }
          if (message.matchId !== matchId) {
            throw new Error(
              `온라인 resume 매치가 다릅니다: local=${matchId}, remote=${message.matchId}`,
            );
          }
          const localStatePromise = capturePhysicsStateHash(
            turnRuntime.physicsRuntime,
          );
          pendingWork = pendingWork.then(async () => {
            const localState = await localStatePromise;
            // 먼저 도착한 다른 resume·스냅샷으로 이미 재개됐다면 늦은 중복 메시지를 처리하지 않는다.
            if (runtime.active) {
              return;
            }
            if (
              message.turnIndex === runtime.nextTurnIndex &&
              message.stateHash === localState.sha256
            ) {
              turnRuntime.currentSide =
                sideForOnlineTurnIndex(runtime.nextTurnIndex);
              activateRuntime(
                `${runtime.nextTurnIndex}번 턴에서 재연결 완료`,
              );
              return;
            }
            if (!isHost) {
              awaitingResumeSnapshot = true;
              runtime.lastEvent = "방장 권위 복구 대기";
              // 참가자의 최초 resume이 핸들러 설치 경합으로 사라져도 방장 resume에 즉시 응답한다.
              await sendResumeState();
              return;
            }
            const tail: OnlineResumeTailMessage = {
              kind: "resumeTail",
              fromTurnIndex: Math.min(
                message.turnIndex,
                runtime.nextTurnIndex,
              ),
              targetTurnIndex: runtime.nextTurnIndex,
              stateHash: localState.sha256,
              turns: runtime.turnLog.filter(
                (turn) => turn.turnIndex >= message.turnIndex,
              ),
            };
            const snapshot = createOnlineStateSnapshot(
              turnRuntime,
              runtime.nextTurnIndex,
            );
            // 기록 재생이 실패한 경우에만 참가자가 요청하도록 권위 스냅샷을 보관한다.
            // 성공한 재생에 pose 덮어쓰기를 섞지 않아 Rapier 내부 이력을 그대로 유지한다.
            hostSnapshots.set(runtime.nextTurnIndex, snapshot);
            currentTransport.send(tail);
            runtime.lastResumeTransferBytes =
              new TextEncoder().encode(JSON.stringify(tail)).byteLength;
            turnRuntime.currentSide =
              sideForOnlineTurnIndex(runtime.nextTurnIndex);
            activateRuntime("방장 기록 꼬리 전송");
          });
          return;
        }
        case "resumeTail": {
          if (isHost) {
            throw new Error("방장에게 resumeTail이 도착했습니다.");
          }
          for (const turn of message.turns) {
            if (!runtime.turnLog.some(
              (recorded) => recorded.turnIndex === turn.turnIndex,
            )) {
              runtime.turnLog.push(turn);
            }
          }
          runtime.turnLog.sort(
            (left, right) => left.turnIndex - right.turnIndex,
          );
          awaitingResumeSnapshot = true;
          resumeReplayMatched = false;
          resumeTargetTurnIndex = message.targetTurnIndex;
          resumeTargetHash = message.stateHash;
          pendingWork = pendingWork.then(async () => {
            resumeReplayMatched =
              await replayResumeTurns(message);
            runtime.lastResumeReplayMatched =
              resumeReplayMatched;
            if (resumeReplayMatched) {
              awaitingResumeSnapshot = false;
              turnRuntime.currentSide =
                sideForOnlineTurnIndex(message.targetTurnIndex);
              activateRuntime(
                `${message.fromTurnIndex}번부터 전체 기록 재생으로 재개`,
              );
              resumeReplayMatched = false;
              resumeTargetTurnIndex = null;
              resumeTargetHash = null;
            } else {
              requestedSnapshots.add(message.targetTurnIndex);
              const request: OnlineStateRequestMessage = {
                kind: "stateRequest",
                turnIndex: message.targetTurnIndex,
              };
              currentTransport.send(request);
              runtime.lastEvent =
                `${message.fromTurnIndex}번부터 기록 재생 불일치·권위 스냅샷 요청`;
            }
          });
          runtime.lastEvent =
            `${message.fromTurnIndex}번부터 기록 꼬리 수신`;
          return;
        }
        case "resign": {
          sessionEnded = true;
          runtime.active = false;
          turnRuntime.phase = "match-over";
          turnRuntime.sceneRuntime.controls.enabled = false;
          cancelRemoteTelegraph();
          hooks.onResigned?.(message.side);
          runtime.lastEvent = `${message.side} 기권`;
          return;
        }
        case "rematch": {
          if (
            runtime.matchId ===
              deriveRematchMatchId(message.offerId)
          ) {
            return;
          }
          if (rematchPreparationId !== null) {
            if (message.action === "offer") {
              const winningOfferId =
                rematchStatus.offerId;
              if (winningOfferId === null) {
                throw new Error(
                  "준비 중인 재대결 요청 식별자가 없습니다.",
                );
              }
              currentTransport.send({
                kind: "rematch",
                action: "accept",
                offerId: winningOfferId,
              } satisfies OnlineRematchMessage);
            }
            return;
          }
          assertCanRematch();
          if (message.action === "offer") {
            if (outgoingRematchOfferId !== null) {
              const winningOfferId = isHost
                ? outgoingRematchOfferId
                : message.offerId;
              const acceptance: OnlineRematchMessage = {
                kind: "rematch",
                action: "accept",
                offerId: winningOfferId,
              };
              currentTransport.send(acceptance);
              beginRematch(winningOfferId);
              return;
            }
            incomingRematchOfferId = message.offerId;
            setRematchStatus({
              phase: "incoming",
              offerId: message.offerId,
              message: "상대가 재대결을 요청했습니다",
            });
            return;
          }
          if (message.action === "accept") {
            if (
              outgoingRematchOfferId === null &&
              rematchPreparationId === null
            ) {
              throw new Error(
                "보내지 않은 재대결 요청의 수락이 도착했습니다.",
              );
            }
            beginRematch(message.offerId);
            return;
          }
          if (message.action === "decline") {
            if (message.offerId !== outgoingRematchOfferId) {
              throw new Error(
                "현재 요청과 다른 재대결 거절이 도착했습니다.",
              );
            }
            outgoingRematchOfferId = null;
            setRematchStatus({
              phase: "declined",
              offerId: message.offerId,
              message: "상대가 재대결을 거절했습니다",
            });
            return;
          }
          if (message.offerId === incomingRematchOfferId) {
            incomingRematchOfferId = null;
            setRematchStatus({
              phase: "idle",
              offerId: null,
              message: "",
            });
          }
          return;
        }
      }
    } catch (error: unknown) {
      handleProtocolError(error);
    }
  };

  const bindTransport = (): void => {
    removeMessageHandler = currentTransport.onMessage(handleMessage);
    removeStateHandler = currentTransport.onStateChange((state) => {
      transportConnected = state === "connected";
      if (state === "connected") {
        rematchStatus = {
          ...rematchStatus,
          connected: true,
        };
        hooks.onRematchStateChange?.({ ...rematchStatus });
      }
      if (state === "disconnected" || state === "failed") {
        runtime.active = false;
        rejoiningSession = true;
        cancelRemoteTelegraph();
        runtime.lastEvent = "연결 끊김";
        outgoingRematchOfferId = null;
        incomingRematchOfferId = null;
        rematchStatus = {
          phase: "idle",
          offerId: null,
          message: "",
          connected: false,
        };
        hooks.onRematchStateChange?.({ ...rematchStatus });
        hooks.onDisconnected?.(
          currentTransport.disconnectCause ?? null,
        );
      }
    });
  };
  bindTransport();
  return runtime;
}

interface OnlineLobbyCode {
  // 초대와 응답이 가리키는 동일한 온라인 대국 식별자다.
  matchId: string;
  // 기존 대국을 이어받는 연결인지 나타낸다.
  rejoining: boolean;
  // net.ts가 생성한 압축 SDP 코드 원문이다.
  peerCode: string;
}

/**
 * 게임 비종속 net 코드를 매치 식별자와 재접속 표식이 있는 온라인 코드로 감싼다.
 */
function encodeOnlineLobbyCode(
  peerCode: string,
  matchId: string,
  rejoining: boolean,
): string {
  if (peerCode.length === 0) {
    throw new Error("빈 P2P 코드는 온라인 코드로 만들 수 없습니다.");
  }
  return [
    LOBBY_CODE_PREFIX,
    rejoining ? "r" : "n",
    parseMatchId(matchId, "온라인 코드"),
    peerCode,
  ].join(".");
}

/**
 * 붙여넣은 온라인 코드에서 매치 식별자·재접속 표식·압축 SDP를 엄격히 읽는다.
 */
function decodeOnlineLobbyCode(code: string): OnlineLobbyCode {
  const [prefix, mode, rawMatchId, ...peerParts] =
    code.trim().split(".");
  const peerCode = peerParts.join(".");
  if (
    prefix !== LOBBY_CODE_PREFIX ||
    (mode !== "n" && mode !== "r") ||
    peerCode.length === 0
  ) {
    throw new Error("온라인 초대·응답 코드 형식이 올바르지 않습니다.");
  }
  return {
    matchId: parseMatchId(rawMatchId, "온라인 코드"),
    rejoining: mode === "r",
    peerCode,
  };
}

/**
 * 메인 메뉴 위에 방장·참가자 수동 코드 교환 패널을 열고 연결된 세션을 반환한다.
 */
export function openOnlineLobby(
  parent: HTMLElement,
  options: OnlineLobbyOptions = {},
): Promise<OnlinePeerSession> {
  const link = createPeerLink();
  const panel = document.createElement("section");
  panel.className = "online-lobby-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "online-lobby-title");
  panel.innerHTML = `
    <div class="online-lobby-card">
      <p>친구와 P2P 연결</p>
      <h2 id="online-lobby-title">온라인 대전</h2>
      <p data-online-status aria-live="polite">방을 만들거나 초대 코드로 참가하세요.</p>
      <div class="online-path-buttons">
        <button type="button" data-online-host>방 만들기</button>
        <button type="button" data-online-guest>참가하기</button>
      </div>
      <section data-online-host-panel hidden>
        <label>초대 코드
          <textarea rows="4" readonly data-online-invite-output></textarea>
        </label>
        <button type="button" data-online-copy-invite>초대 코드 복사</button>
        <label>응답 코드 붙여넣기
          <textarea rows="4" data-online-answer-input></textarea>
        </label>
        <button type="button" data-online-accept>응답 코드로 연결</button>
      </section>
      <section data-online-guest-panel hidden>
        <label>초대 코드 붙여넣기
          <textarea rows="4" data-online-invite-input></textarea>
        </label>
        <button type="button" data-online-join>초대 코드로 참가</button>
        <label>응답 코드
          <textarea rows="4" readonly data-online-answer-output></textarea>
        </label>
        <button type="button" data-online-copy-answer>응답 코드 복사</button>
      </section>
      <button type="button" data-online-cancel>취소</button>
    </div>
  `;
  parent.append(panel);

  const query = <T extends Element>(selector: string): T => {
    const element = panel.querySelector<T>(selector);
    if (element === null) {
      throw new Error(`온라인 로비 요소 ${selector}를 만들지 못했습니다.`);
    }
    return element;
  };
  const status = query<HTMLElement>("[data-online-status]");
  const hostPanel = query<HTMLElement>("[data-online-host-panel]");
  const guestPanel = query<HTMLElement>("[data-online-guest-panel]");
  const inviteOutput =
    query<HTMLTextAreaElement>("[data-online-invite-output]");
  const answerInput =
    query<HTMLTextAreaElement>("[data-online-answer-input]");
  const inviteInput =
    query<HTMLTextAreaElement>("[data-online-invite-input]");
  const answerOutput =
    query<HTMLTextAreaElement>("[data-online-answer-output]");
  let selectedSide: PieceSide | null = null;
  let negotiatedMatchId: string | null =
    options.matchId === undefined
      ? null
      : parseMatchId(options.matchId, "온라인 로비");
  let negotiatedRejoining = options.rejoining === true;
  let finished = false;

  const reportError = (error: unknown): void => {
    const fullError =
      error instanceof Error
        ? (error.stack ?? error.message)
        : String(error);
    console.error(fullError);
    status.textContent =
      error instanceof Error ? error.message : String(error);
  };
  const runAction = (action: () => Promise<void>): void => {
    void action().catch(reportError);
  };
  const copyCode = async (
    code: string,
    label: string,
  ): Promise<void> => {
    if (code.length === 0) {
      throw new Error(`${label}가 아직 생성되지 않았습니다.`);
    }
    await navigator.clipboard.writeText(code);
    status.textContent = `${label} ${code.length}자를 복사했습니다.`;
  };

  return new Promise<OnlinePeerSession>((resolve, reject) => {
    const removeStateHandler = link.onStateChange((state) => {
      const labels: Record<PeerLinkState, string> = {
        idle: "연결 방법을 선택하세요.",
        "waiting-answer": "상대의 응답 코드를 기다리는 중입니다.",
        connecting: "상대 브라우저와 연결 중입니다.",
        connected: "연결됐습니다. 표준 대국을 준비합니다.",
        disconnected: "연결이 끊겼습니다.",
        failed: "연결에 실패했습니다.",
      };
      status.textContent = labels[state];
      if (
        state === "connected" &&
        selectedSide !== null &&
        negotiatedMatchId !== null &&
        !finished
      ) {
        finished = true;
        removeStateHandler();
        status.textContent = negotiatedRejoining
          ? "대국을 이어받는 중입니다."
          : "연결됐습니다. 표준 대국을 준비합니다.";
        resolve({
          link,
          mySide: selectedSide,
          matchId: negotiatedMatchId,
          rejoining: negotiatedRejoining,
          finishLobby: () => {
            panel.remove();
          },
        });
      }
    });

    query<HTMLButtonElement>("[data-online-host]").addEventListener(
      "click",
      () => {
        selectedSide = "white";
        negotiatedMatchId =
          options.matchId ?? createOnlineMatchId();
        negotiatedRejoining = options.rejoining === true;
        hostPanel.hidden = false;
        guestPanel.hidden = true;
        runAction(async () => {
          status.textContent = "ICE 후보를 모아 초대 코드를 만드는 중입니다.";
          const peerCode = await link.createHost();
          inviteOutput.value = encodeOnlineLobbyCode(
            peerCode,
            negotiatedMatchId!,
            negotiatedRejoining,
          );
          status.textContent =
            `초대 코드 ${inviteOutput.value.length}자를 상대에게 보내세요.`;
        });
      },
    );
    query<HTMLButtonElement>("[data-online-guest]").addEventListener(
      "click",
      () => {
        selectedSide = "black";
        guestPanel.hidden = false;
        hostPanel.hidden = true;
        status.textContent = "받은 초대 코드를 붙여넣으세요.";
      },
    );
    query<HTMLButtonElement>("[data-online-copy-invite]").addEventListener(
      "click",
      () => {
        runAction(() =>
          copyCode(inviteOutput.value, "초대 코드"),
        );
      },
    );
    query<HTMLButtonElement>("[data-online-join]").addEventListener(
      "click",
      () => {
        selectedSide = "black";
        runAction(async () => {
          status.textContent = "ICE 후보를 모아 응답 코드를 만드는 중입니다.";
          const invite = decodeOnlineLobbyCode(
            inviteInput.value,
          );
          negotiatedMatchId = invite.matchId;
          negotiatedRejoining = invite.rejoining;
          const peerAnswer = await link.joinWithInvite(
            invite.peerCode,
          );
          answerOutput.value = encodeOnlineLobbyCode(
            peerAnswer,
            invite.matchId,
            invite.rejoining,
          );
          status.textContent =
            invite.rejoining
              ? `재접속 응답 코드 ${answerOutput.value.length}자를 방장에게 보내세요.`
              : `응답 코드 ${answerOutput.value.length}자를 방장에게 보내세요.`;
        });
      },
    );
    query<HTMLButtonElement>("[data-online-copy-answer]").addEventListener(
      "click",
      () => {
        runAction(() =>
          copyCode(answerOutput.value, "응답 코드"),
        );
      },
    );
    query<HTMLButtonElement>("[data-online-accept]").addEventListener(
      "click",
      () => {
        runAction(async () => {
          status.textContent = "응답 코드를 적용해 연결하는 중입니다.";
          const answer = decodeOnlineLobbyCode(
            answerInput.value,
          );
          if (
            negotiatedMatchId === null ||
            answer.matchId !== negotiatedMatchId ||
            answer.rejoining !== negotiatedRejoining
          ) {
            throw new Error(
              "응답 코드의 매치 식별자 또는 재접속 표식이 초대와 다릅니다.",
            );
          }
          await link.acceptAnswer(answer.peerCode);
        });
      },
    );
    query<HTMLButtonElement>("[data-online-cancel]").addEventListener(
      "click",
      () => {
        if (finished) {
          return;
        }
        finished = true;
        removeStateHandler();
        link.close();
        panel.remove();
        reject(new Error("온라인 대전 연결을 취소했습니다."));
      },
    );
  });
}
