import { Mesh, Scene, Vector3 } from "three";
import type { ChessSetMeta } from "./assets";
import {
  UPGRADE_CARDS,
  createRunCardState,
  type CardId,
  type RunCardState,
} from "./cards";
import {
  FIXED_STEP,
  MAX_SETTLE_SECONDS,
  PERMANENT_UPGRADE_MAX_LEVEL,
  PIECE_TYPES,
  deriveBoardHalfExtent,
} from "./config";
import type { GameMode } from "./game-mode";
import {
  PIECE_INSTANCES,
  type PieceSide,
} from "./layout";
import {
  createDefaultPermanentUpgrades,
  type PermanentUpgrades,
} from "./meta";
import {
  createPhysicsRuntime,
  preSettlePhysics,
  type PhysicsRuntime,
} from "./physics";
import type { SceneRuntime } from "./scene";
import {
  capturePhysicsStateHash,
} from "./state-hash";
import { createDefaultRuntimeTuningSettings } from "./tuning";
import {
  applyPendingLaunchBeforeStep,
  createTurnRuntime,
  queueTurnLaunch,
  setLaunchAcceptedHandler,
  setTurnGameMode,
  setTurnSettledHandler,
  updateTurnAfterStep,
  type TurnLaunchRequest,
  type TurnRuntime,
} from "./turn";

export type ReplayGameMode = GameMode | "online";

export interface ReplayStageHeader {
  // 실제 스폰 버프와 폰 등급을 재구성할 현재 스테이지다.
  stageNumber: number;
  // 누적 카드 횟수를 보존하기 위해 중복을 허용하는 활성 카드 id 목록이다.
  activeCardIds: CardId[];
  // 여섯 말 종류의 힘·중량 영구 레벨 전체다.
  permanentUpgrades: PermanentUpgrades;
}

export interface MatchReplayHeader {
  // 호환되지 않는 기록을 조용히 재생하지 않게 하는 형식 버전이다.
  schemaVersion: 1;
  // 시작 보드 규칙을 고르는 핫시트·스테이지·온라인 모드다.
  gameMode: ReplayGameMode;
  // 기록 시작 시 첫 발사를 허용할 진영이다.
  initialSide: PieceSide;
  // 스테이지 이외 모드에서는 null인 스폰 강화 원본이다.
  stage: ReplayStageHeader | null;
}

export interface ReplayVector3 {
  x: number;
  y: number;
  z: number;
}

export interface ReplayTurnRecord {
  // 0부터 증가하는 대국 내 턴 순번이다.
  turnIndex: number;
  // 이 입력을 발사한 진영이다.
  side: PieceSide;
  // 실제 스폰 목록의 고유 말 id다.
  pieceId: string;
  // 물리 임펄스에 사용한 실제 월드 방향이다.
  direction: ReplayVector3;
  // 게임 발사 경로에 전달한 정규화 세기다.
  normalizedPower: number;
  // 토크를 포함해 그대로 재생할 실제 월드 적용점이다.
  applicationPoint: ReplayVector3;
  // 카드·스테이지·영구 강화까지 합성된 목표 속도 배수다.
  speedMultiplier: number;
  // 낙하 제거와 정착이 끝난 뒤 전체 말 원시 상태 SHA-256이다.
  postStateHash: string;
}

export interface MatchRecording {
  // 정확한 시작 보드를 재구성하는 대국 헤더다.
  header: MatchReplayHeader;
  // 성공한 발사만 순서대로 담은 턴 기록이다.
  turns: ReplayTurnRecord[];
}

export type CompactReplayTurn = [
  turnIndex: number,
  side: 0 | 1,
  pieceId: string,
  directionX: number,
  directionY: number,
  directionZ: number,
  normalizedPower: number,
  applicationX: number,
  applicationY: number,
  applicationZ: number,
  speedMultiplier: number,
  postStateHash: string,
];

export interface ReplayHeaderSource {
  // 현재 게임 또는 향후 온라인 보드의 모드다.
  gameMode: ReplayGameMode;
  // 재생 첫 턴을 시작할 진영이다.
  initialSide: PieceSide;
  // 스테이지 모드에서만 필요한 현재 단계다.
  stageNumber?: number;
  // 중복 선택을 횟수로 보존한 현재 런 카드 상태다.
  runCards?: Readonly<RunCardState>;
  // 스테이지 백 말에 합성된 영구 강화 상태다.
  permanentUpgrades?: Readonly<PermanentUpgrades>;
}

interface PendingReplayTurn {
  recording: MatchRecording;
  turn: Omit<ReplayTurnRecord, "postStateHash">;
}

export interface ReplayRecorder {
  // 발사와 정착 후크를 읽는 실제 턴 런타임이다.
  turnRuntime: TurnRuntime;
  // 저장 버튼이 읽을 현재 대국 기록이다.
  recording: MatchRecording;
  // 발사 수락 뒤 정착 해시를 기다리는 단 하나의 턴이다.
  pendingTurn: PendingReplayTurn | null;
  // 여러 SHA-256 완료가 기록 순서를 바꾸지 않도록 잇는 작업이다.
  completion: Promise<void>;
  // 시작된 대국 안에서 다음에 부여할 0 기반 턴 번호다.
  nextTurnIndex: number;
}

export interface ReplayTurnVerification {
  // 검사한 기록 턴 번호다.
  turnIndex: number;
  // 기록 해시와 재생 해시가 원시 비트 기준 같은지 나타낸다.
  matches: boolean;
  // 저장 파일에 있던 기준 해시다.
  expectedHash: string;
  // 실제 재생 월드에서 계산한 해시다.
  actualHash: string;
  // 재생 후 현재 월드의 말 개수다.
  pieceCount: number;
}

export interface ReplayVerificationResult {
  // 모든 턴의 해시가 일치했는지 나타낸다.
  matched: boolean;
  // 불일치가 없으면 null인 첫 발산 턴 번호다.
  firstMismatchTurn: number | null;
  // 불일치까지 포함해 실제로 검사한 턴 결과다.
  turns: ReplayTurnVerification[];
}

export interface ReplayDevelopmentRuntime {
  // 현재 대국을 수동 기록하는 런타임이다.
  recorder: ReplayRecorder;
  // replay=1에서만 화면에 붙는 개발 패널이다.
  panel: HTMLElement;
  // 보드 전체 재생성 뒤 새 헤더로 기록을 비우는 연결점이다.
  startRecording: (source: ReplayHeaderSource) => void;
}

const CARD_IDS = new Set<CardId>(
  UPGRADE_CARDS.map((card) => card.id),
);
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

/**
 * 중첩 영구 강화 표를 기록과 런타임이 서로 수정하지 않도록 값 복사한다.
 */
function clonePermanentUpgrades(
  upgrades: Readonly<PermanentUpgrades>,
): PermanentUpgrades {
  return Object.fromEntries(
    PIECE_TYPES.map((type) => [
      type,
      {
        force: upgrades[type].force,
        weight: upgrades[type].weight,
      },
    ]),
  ) as PermanentUpgrades;
}

/**
 * 런 카드 상태를 스폰 효과 횟수가 보존되는 활성 id 목록으로 바꾼다.
 */
export function collectActiveCardIds(
  state: Readonly<RunCardState>,
): CardId[] {
  return [
    ...Array<CardId>(state.sizePicks).fill("size"),
    ...Array<CardId>(state.weightPicks).fill("weight"),
    ...Array<CardId>(state.forcePicks).fill("force"),
    ...(state.giantPawn ? (["giantPawn"] as const) : []),
    ...(state.proneStart ? (["proneStart"] as const) : []),
  ];
}

/**
 * 헤더의 중복 카드 id를 기존 스폰 경로가 읽는 런 상태로 복원한다.
 */
export function restoreRunCards(
  activeCardIds: readonly CardId[],
): RunCardState {
  const state = createRunCardState();
  for (const cardId of activeCardIds) {
    if (cardId === "size") {
      state.sizePicks += 1;
    } else if (cardId === "weight") {
      state.weightPicks += 1;
    } else if (cardId === "force") {
      state.forcePicks += 1;
    } else if (cardId === "giantPawn") {
      if (state.giantPawn) {
        throw new Error("리플레이 헤더에 거대 폰 카드가 중복됐습니다.");
      }
      state.giantPawn = true;
    } else {
      if (state.proneStart) {
        throw new Error("리플레이 헤더에 포복 개시 카드가 중복됐습니다.");
      }
      state.proneStart = true;
    }
    state.picksSoFar += 1;
  }
  return state;
}

/**
 * 현재 모드와 강화 상태를 정확한 시작 보드 헤더로 값 복사한다.
 */
export function createReplayHeader(
  source: ReplayHeaderSource,
): MatchReplayHeader {
  if (source.gameMode !== "stage") {
    return {
      schemaVersion: 1,
      gameMode: source.gameMode,
      initialSide: source.initialSide,
      stage: null,
    };
  }
  if (
    source.stageNumber === undefined ||
    !Number.isInteger(source.stageNumber) ||
    source.stageNumber < 1 ||
    source.runCards === undefined ||
    source.permanentUpgrades === undefined
  ) {
    throw new Error(
      "스테이지 리플레이 헤더에는 단계·카드·영구 강화가 모두 필요합니다.",
    );
  }
  return {
    schemaVersion: 1,
    gameMode: "stage",
    initialSide: source.initialSide,
    stage: {
      stageNumber: source.stageNumber,
      activeCardIds: collectActiveCardIds(source.runCards),
      permanentUpgrades: clonePermanentUpgrades(
        source.permanentUpgrades,
      ),
    },
  };
}

/**
 * 정식 턴 객체를 필드명 반복이 없는 P3 전송용 고정 배열로 줄인다.
 */
export function toCompactTurn(
  turn: Readonly<ReplayTurnRecord>,
): CompactReplayTurn {
  return [
    turn.turnIndex,
    turn.side === "white" ? 0 : 1,
    turn.pieceId,
    turn.direction.x,
    turn.direction.y,
    turn.direction.z,
    turn.normalizedPower,
    turn.applicationPoint.x,
    turn.applicationPoint.y,
    turn.applicationPoint.z,
    turn.speedMultiplier,
    turn.postStateHash,
  ];
}

/**
 * 저장·다운로드에 불필요한 공백이 없는 JSON 문자열을 만든다.
 */
export function serializeRecording(
  recording: Readonly<MatchRecording>,
): string {
  return JSON.stringify(recording);
}

/**
 * 임의 JSON 값이 유한한 3차원 벡터인지 확인하고 값 복사한다.
 */
function parseVector(value: unknown, label: string): ReplayVector3 {
  if (typeof value !== "object" || value === null) {
    throw new Error(`${label}가 3차원 벡터 객체가 아닙니다.`);
  }
  const source = value as Record<string, unknown>;
  if (
    typeof source.x !== "number" ||
    typeof source.y !== "number" ||
    typeof source.z !== "number" ||
    ![source.x, source.y, source.z].every(Number.isFinite)
  ) {
    throw new Error(`${label} 좌표에 유한하지 않은 값이 있습니다.`);
  }
  return { x: source.x, y: source.y, z: source.z };
}

/**
 * JSON 영구 강화 표를 여섯 종류·두 트랙의 유효 레벨로 엄격히 읽는다.
 */
function parsePermanentUpgrades(value: unknown): PermanentUpgrades {
  if (typeof value !== "object" || value === null) {
    throw new Error("리플레이 영구 강화 표가 객체가 아닙니다.");
  }
  const source = value as Record<string, unknown>;
  const upgrades = createDefaultPermanentUpgrades();
  for (const type of PIECE_TYPES) {
    const piece = source[type];
    if (typeof piece !== "object" || piece === null) {
      throw new Error(`리플레이 영구 강화에 ${type} 항목이 없습니다.`);
    }
    const tracks = piece as Record<string, unknown>;
    for (const track of ["force", "weight"] as const) {
      const level = tracks[track];
      if (
        typeof level !== "number" ||
        !Number.isInteger(level) ||
        level < 0 ||
        level > PERMANENT_UPGRADE_MAX_LEVEL
      ) {
        throw new Error(
          `${type}.${track} 리플레이 강화 레벨 ${String(level)}가 유효하지 않습니다.`,
        );
      }
      upgrades[type][track] = level;
    }
  }
  return upgrades;
}

/**
 * 저장 JSON을 누락·손상 필드 없이 안전한 대국 기록으로 역직렬화한다.
 */
export function deserializeRecording(json: string): MatchRecording {
  const value = JSON.parse(json) as unknown;
  if (typeof value !== "object" || value === null) {
    throw new Error("리플레이 JSON 최상위 값이 객체가 아닙니다.");
  }
  const source = value as Record<string, unknown>;
  const headerValue = source.header;
  if (typeof headerValue !== "object" || headerValue === null) {
    throw new Error("리플레이 헤더가 없습니다.");
  }
  const rawHeader = headerValue as Record<string, unknown>;
  if (
    rawHeader.schemaVersion !== 1 ||
    !["hotseat", "stage", "online"].includes(
      String(rawHeader.gameMode),
    ) ||
    !["white", "black"].includes(String(rawHeader.initialSide))
  ) {
    throw new Error("리플레이 헤더 버전·모드·선공 정보가 유효하지 않습니다.");
  }
  const gameMode = rawHeader.gameMode as ReplayGameMode;
  let stage: ReplayStageHeader | null = null;
  if (gameMode === "stage") {
    const rawStage = rawHeader.stage;
    if (typeof rawStage !== "object" || rawStage === null) {
      throw new Error("스테이지 리플레이 헤더에 단계 정보가 없습니다.");
    }
    const stageSource = rawStage as Record<string, unknown>;
    if (
      typeof stageSource.stageNumber !== "number" ||
      !Number.isInteger(stageSource.stageNumber) ||
      stageSource.stageNumber < 1 ||
      !Array.isArray(stageSource.activeCardIds)
    ) {
      throw new Error("스테이지 번호 또는 활성 카드 목록이 유효하지 않습니다.");
    }
    const activeCardIds = stageSource.activeCardIds.map((cardId) => {
      if (
        typeof cardId !== "string" ||
        !CARD_IDS.has(cardId as CardId)
      ) {
        throw new Error(`알 수 없는 리플레이 카드 id ${String(cardId)}입니다.`);
      }
      return cardId as CardId;
    });
    restoreRunCards(activeCardIds);
    stage = {
      stageNumber: stageSource.stageNumber,
      activeCardIds,
      permanentUpgrades: parsePermanentUpgrades(
        stageSource.permanentUpgrades,
      ),
    };
  } else if (rawHeader.stage !== null) {
    throw new Error("스테이지가 아닌 리플레이의 stage 필드는 null이어야 합니다.");
  }
  if (!Array.isArray(source.turns)) {
    throw new Error("리플레이 turns 배열이 없습니다.");
  }
  const turns = source.turns.map((rawTurn, index): ReplayTurnRecord => {
    if (typeof rawTurn !== "object" || rawTurn === null) {
      throw new Error(`${index}번 리플레이 턴이 객체가 아닙니다.`);
    }
    const turn = rawTurn as Record<string, unknown>;
    if (
      turn.turnIndex !== index ||
      !["white", "black"].includes(String(turn.side)) ||
      typeof turn.pieceId !== "string" ||
      turn.pieceId.length === 0 ||
      typeof turn.normalizedPower !== "number" ||
      !Number.isFinite(turn.normalizedPower) ||
      typeof turn.speedMultiplier !== "number" ||
      !Number.isFinite(turn.speedMultiplier) ||
      turn.speedMultiplier <= 0 ||
      typeof turn.postStateHash !== "string" ||
      !SHA256_PATTERN.test(turn.postStateHash)
    ) {
      throw new Error(`${index}번 리플레이 턴의 필수 값이 유효하지 않습니다.`);
    }
    return {
      turnIndex: index,
      side: turn.side as PieceSide,
      pieceId: turn.pieceId,
      direction: parseVector(turn.direction, `${index}번 방향`),
      normalizedPower: turn.normalizedPower,
      applicationPoint: parseVector(
        turn.applicationPoint,
        `${index}번 적용점`,
      ),
      speedMultiplier: turn.speedMultiplier,
      postStateHash: turn.postStateHash,
    };
  });
  return {
    header: {
      schemaVersion: 1,
      gameMode,
      initialSide: rawHeader.initialSide as PieceSide,
      stage,
    },
    turns,
  };
}

/**
 * 현재 기록을 새 시작 헤더와 빈 턴 목록으로 교체한다.
 */
export function startReplayRecording(
  recorder: ReplayRecorder,
  source: ReplayHeaderSource,
): void {
  void recorder.completion.catch((error: unknown) => {
    const fullError =
      error instanceof Error
        ? (error.stack ?? error.message)
        : String(error);
    console.error(`[대국 기록 이전 해시 실패] ${fullError}`);
  });
  recorder.recording = {
    header: createReplayHeader(source),
    turns: [],
  };
  recorder.pendingTurn = null;
  recorder.completion = Promise.resolve();
  recorder.nextTurnIndex = 0;
}

/**
 * 성공 발사와 정착 후크를 연결해 물리 경로에 개입하지 않는 recorder를 만든다.
 */
export function createReplayRecorder(
  turnRuntime: TurnRuntime,
  initialSource: ReplayHeaderSource,
): ReplayRecorder {
  const recorder: ReplayRecorder = {
    turnRuntime,
    recording: {
      header: createReplayHeader(initialSource),
      turns: [],
    },
    pendingTurn: null,
    completion: Promise.resolve(),
    nextTurnIndex: 0,
  };
  setLaunchAcceptedHandler(turnRuntime, (request, side) => {
    if (recorder.pendingTurn !== null) {
      throw new Error("이전 발사 기록이 정착 해시를 받기 전에 다음 발사가 수락됐습니다.");
    }
    const speedMultiplier = request.speedMultiplier ?? 1;
    recorder.pendingTurn = {
      recording: recorder.recording,
      turn: {
        turnIndex: recorder.nextTurnIndex,
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
        speedMultiplier,
      },
    };
    recorder.nextTurnIndex += 1;
  });
  setTurnSettledHandler(turnRuntime, () => {
    const pending = recorder.pendingTurn;
    recorder.pendingTurn = null;
    if (pending === null) {
      return;
    }
    const hashPromise = Promise.resolve().then(() =>
      capturePhysicsStateHash(turnRuntime.physicsRuntime),
    );
    recorder.completion = recorder.completion.then(async () => {
      const state = await hashPromise;
      pending.recording.turns.push({
        ...pending.turn,
        postStateHash: state.sha256,
      });
    });
  });
  return recorder;
}

/**
 * 예약된 SHA-256을 모두 기다린 뒤 현재 기록의 독립 값 복사본을 반환한다.
 */
export async function readReplayRecording(
  recorder: ReplayRecorder,
): Promise<MatchRecording> {
  await recorder.completion;
  if (recorder.pendingTurn !== null) {
    throw new Error("현재 발사가 아직 완전히 정착하지 않아 기록을 저장할 수 없습니다.");
  }
  return deserializeRecording(serializeRecording(recorder.recording));
}

/**
 * 헤더가 지정한 실제 스폰 옵션으로 독립 재생 월드를 만든다.
 */
async function createReplayWorld(
  meta: ChessSetMeta,
  header: MatchReplayHeader,
): Promise<{
  physicsRuntime: PhysicsRuntime;
  turnRuntime: TurnRuntime;
}> {
  const runCards =
    header.stage === null
      ? undefined
      : restoreRunCards(header.stage.activeCardIds);
  const stageOptions =
    header.gameMode === "stage" && header.stage !== null
      ? {
          gameMode: "stage" as const,
          stageNumber: header.stage.stageNumber,
          runCards,
          permanentUpgrades: header.stage.permanentUpgrades,
        }
      : {
          gameMode: "hotseat" as const,
          stageNumber: 1,
        };
  const physicsRuntime = await createPhysicsRuntime(
    meta,
    PIECE_INSTANCES,
    deriveBoardHalfExtent(meta.cellSize),
    stageOptions,
  );
  preSettlePhysics(physicsRuntime);
  const scene = new Scene();
  const pieceMeshes = new Map<string, Mesh>();
  for (const binding of physicsRuntime.pieces.values()) {
    const mesh = new Mesh();
    mesh.name = binding.instance.id;
    pieceMeshes.set(binding.instance.id, mesh);
    scene.add(mesh);
  }
  const sceneRuntime = {
    scene,
    pieceMeshes,
    controls: { enabled: true },
  } as unknown as SceneRuntime;
  const turnRuntime = createTurnRuntime(
    physicsRuntime,
    sceneRuntime,
    createDefaultRuntimeTuningSettings(),
  );
  turnRuntime.currentSide = header.initialSide;
  setTurnGameMode(
    turnRuntime,
    header.gameMode === "stage" ? "stage" : "hotseat",
  );
  return { physicsRuntime, turnRuntime };
}

/**
 * 실제 정착·낙하 제거 경로가 ready 또는 match-over가 될 때까지 고정 스텝을 진행한다.
 */
function settleReplayTurn(
  physicsRuntime: PhysicsRuntime,
  turnRuntime: TurnRuntime,
): void {
  const maximumSteps = Math.ceil(
    (MAX_SETTLE_SECONDS * 2) / FIXED_STEP,
  );
  let steps = 0;
  while (
    steps < maximumSteps &&
    turnRuntime.phase !== "ready" &&
    turnRuntime.phase !== "match-over"
  ) {
    applyPendingLaunchBeforeStep(turnRuntime);
    physicsRuntime.world.step();
    updateTurnAfterStep(turnRuntime, FIXED_STEP);
    steps += 1;
  }
  if (
    turnRuntime.phase !== "ready" &&
    turnRuntime.phase !== "match-over"
  ) {
    throw new Error(
      `리플레이 턴이 ${maximumSteps} fixed step 안에 정착하지 못했습니다.`,
    );
  }
}

/**
 * 기록 입력을 실제 스폰·발사 경로로 재생하고 첫 해시 불일치를 즉시 보고한다.
 */
export async function replayRecording(
  meta: ChessSetMeta,
  recording: Readonly<MatchRecording>,
  onTurnVerified?: (result: ReplayTurnVerification) => void,
): Promise<ReplayVerificationResult> {
  const validated = deserializeRecording(
    serializeRecording(recording),
  );
  const { physicsRuntime, turnRuntime } =
    await createReplayWorld(meta, validated.header);
  const results: ReplayTurnVerification[] = [];
  for (const turn of validated.turns) {
    if (turnRuntime.phase === "match-over") {
      throw new Error(
        `${turn.turnIndex}번 입력 전에 대국이 이미 끝났습니다.`,
      );
    }
    if (turnRuntime.currentSide !== turn.side) {
      throw new Error(
        `${turn.turnIndex}번 진영 불일치: 기록=${turn.side}, 재생=${turnRuntime.currentSide}`,
      );
    }
    const request: TurnLaunchRequest = {
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
    };
    const queued = queueTurnLaunch(turnRuntime, request);
    if (!queued.accepted) {
      throw new Error(
        `${turn.turnIndex}번 리플레이 발사가 거절됐습니다: ${queued.reason ?? "원인 없음"}`,
      );
    }
    settleReplayTurn(physicsRuntime, turnRuntime);
    const state = await capturePhysicsStateHash(physicsRuntime);
    const result: ReplayTurnVerification = {
      turnIndex: turn.turnIndex,
      matches: state.sha256 === turn.postStateHash,
      expectedHash: turn.postStateHash,
      actualHash: state.sha256,
      pieceCount: state.pieceCount,
    };
    results.push(result);
    onTurnVerified?.(result);
    if (!result.matches) {
      return {
        matched: false,
        firstMismatchTurn: turn.turnIndex,
        turns: results,
      };
    }
  }
  return {
    matched: true,
    firstMismatchTurn: null,
    turns: results,
  };
}

/**
 * replay=1 개발 경로에 저장·불러오기와 턴별 해시 상태 패널을 붙인다.
 */
export function createReplayDevelopmentRuntime(
  container: HTMLElement,
  meta: ChessSetMeta,
  turnRuntime: TurnRuntime,
  initialSource: ReplayHeaderSource,
): ReplayDevelopmentRuntime {
  const recorder = createReplayRecorder(
    turnRuntime,
    initialSource,
  );
  const panel = document.createElement("aside");
  panel.className = "replay-panel";
  panel.innerHTML = `
    <h2>대국 기록·재생</h2>
    <button type="button" data-replay-save>기록 저장</button>
    <button type="button" data-replay-load>기록 불러와 재생</button>
    <input type="file" accept="application/json,.json" data-replay-file hidden>
    <p data-replay-status aria-live="polite">기록 중 · 0턴</p>
  `;
  const saveButton =
    panel.querySelector<HTMLButtonElement>("[data-replay-save]");
  const loadButton =
    panel.querySelector<HTMLButtonElement>("[data-replay-load]");
  const fileInput =
    panel.querySelector<HTMLInputElement>("[data-replay-file]");
  const status =
    panel.querySelector<HTMLElement>("[data-replay-status]");
  if (
    saveButton === null ||
    loadButton === null ||
    fileInput === null ||
    status === null
  ) {
    throw new Error("리플레이 개발 패널의 필수 요소를 만들지 못했습니다.");
  }
  const reportError = (error: unknown): void => {
    const fullError =
      error instanceof Error
        ? (error.stack ?? error.message)
        : String(error);
    console.error(fullError);
    status.textContent = `오류: ${error instanceof Error ? error.message : String(error)}`;
  };
  saveButton.addEventListener("click", () => {
    void readReplayRecording(recorder).then((recording) => {
      const blob = new Blob(
        [serializeRecording(recording)],
        { type: "application/json" },
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "chess-alkkagi-replay.json";
      anchor.click();
      URL.revokeObjectURL(url);
      status.textContent = `기록 저장 완료 · ${recording.turns.length}턴`;
    }, reportError);
  });
  loadButton.addEventListener("click", () => {
    fileInput.click();
  });
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file === undefined) {
      return;
    }
    saveButton.disabled = true;
    loadButton.disabled = true;
    status.textContent = "리플레이 준비 중…";
    void file.text().then(async (json) => {
      const recording = deserializeRecording(json);
      const result = await replayRecording(
        meta,
        recording,
        (turn) => {
          status.textContent =
            `턴 ${turn.turnIndex + 1}: ${turn.matches ? "해시 일치" : "해시 불일치"}`;
        },
      );
      status.textContent = result.matched
        ? `재생 완료 · ${result.turns.length}턴 모두 일치`
        : `재생 중단 · 턴 ${(result.firstMismatchTurn ?? 0) + 1} 불일치`;
    }).catch(reportError).finally(() => {
      saveButton.disabled = false;
      loadButton.disabled = false;
      fileInput.value = "";
    });
  });
  container.append(panel);
  return {
    recorder,
    panel,
    startRecording: (source) => {
      startReplayRecording(recorder, source);
      status.textContent = "기록 중 · 0턴";
    },
  };
}
