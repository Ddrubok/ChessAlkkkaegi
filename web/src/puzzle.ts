import { progressStorage } from "./progress-storage.ts";
import type { PieceType } from "./config";
import type { PieceSide } from "./layout";

/**
 * 퍼즐 좌표는 보드 반폭 H로 나눈 시안이다. 실제 물리 보드에서의 성공 가능성은
 * 제작 검수 전까지 확정하지 않는다.
 */
export interface NormalizedBoardPosition {
  x: number;
  z: number;
  positionValidated: false;
}

export type PuzzlePose = "upright" | "prone";
export type PuzzleLane =
  | "direct"
  | "ricochet"
  | "chain"
  | "hole"
  | "pillar"
  | "break-wall"
  | "protected"
  | "center";
export type PuzzleBoardTemplate =
  | "basic"
  | "breakable"
  | "hole"
  | "holes"
  | "pocket"
  | "pillars";

export interface PuzzlePieceDefinition {
  id: string;
  type: PieceType;
  side: PieceSide;
  position: NormalizedBoardPosition;
  pose: PuzzlePose;
  lane: PuzzleLane;
  protected?: boolean;
}

export interface PuzzleAbilityPolicy {
  research: false;
  deck: false;
  pawnPromotion: false;
  kingSpecial: false;
}

export interface PuzzleContactSequence {
  shooterId: string;
  wallIds: readonly string[];
  targetId: string;
}

export interface PuzzleRookShotRule {
  pieceId: string;
  requireCenterHit?: boolean;
  maxPower?: number;
}

export interface PuzzleRule {
  maxLaunches: number;
  requiredFallIds: readonly string[];
  requiredAliveIds?: readonly string[];
  requiredHoleOutIds?: readonly string[];
  requiredWallDestroyedCounts?: Readonly<Record<string, number>>;
  contactSequence?: PuzzleContactSequence;
  requireCustomHit?: boolean;
  rookShot?: PuzzleRookShotRule;
  forbiddenContactIds?: readonly string[];
  wallDestructionBeforeFall?: {
    wallIds: readonly string[];
    fallIds: readonly string[];
  };
}

export interface PuzzleMedalRules {
  bronze: PuzzleRule;
  silver: PuzzleRule;
  gold: PuzzleRule;
}

export interface PuzzleDefinition {
  puzzleId: string;
  revision: number;
  chapter: 1 | 2 | 3;
  title: string;
  boardTemplate: PuzzleBoardTemplate;
  /** 기존 맵 재사용 시 참고할 스테이지 번호다. */
  boardStage: number;
  /** 실제 물리 검증 후 전체 카탈로그를 공개하기 전에 먼저 확인할 기준 문제다. */
  validationGate?: boolean;
  pieces: readonly PuzzlePieceDefinition[];
  launchBudget: number;
  abilityPolicy: PuzzleAbilityPolicy;
  required: PuzzleRule;
  forbidden: {
    fallIds: readonly string[];
    contactIds: readonly string[];
    actions: readonly string[];
  };
  medals: PuzzleMedalRules;
  hints: readonly [string, string];
  failureCopy: string;
}

/** 정착 후 물리 추적기가 넘기는 충돌 사건. order는 한 시도 안에서 단조 증가한다. */
export interface PuzzleContactEvent {
  order: number;
  launch: number;
  shooterId: string;
  targetId: string;
  targetKind: "piece" | "wall" | "hole" | "pillar";
  wallDestroyedCount?: number;
}

export interface PuzzleFallOrderEvent {
  order: number;
  launch: number;
  pieceId: string;
}

export interface PuzzleWallDestructionOrderEvent {
  order: number;
  launch: number;
  wallId: string;
}

export interface PuzzleRookShotEvidence {
  pieceId: string;
  centerHit: boolean;
  power: number;
}

export interface PuzzleEvaluationInput {
  settled?: boolean;
  dataError?: string;
  launches: number;
  fallenIDs: readonly string[];
  contactEvents: readonly PuzzleContactEvent[];
  protectedContactIDs?: readonly string[];
  holeOutIDs?: readonly string[];
  wallDestroyedCounts?: Readonly<Record<string, number>>;
  customHitUsed?: boolean;
  rookShots?: readonly PuzzleRookShotEvidence[];
  usedActions?: readonly string[];
  fallOrderEvents?: readonly PuzzleFallOrderEvent[];
  wallDestructionOrderEvents?: readonly PuzzleWallDestructionOrderEvent[];
}

export type PuzzleMedal = 0 | 1 | 2 | 3;
export type PuzzleEvaluationStatus = "pending" | "in-progress" | "success" | "failed";

export type PuzzleFailureCode =
  | "data-error"
  | "not-settled"
  | "forbidden-fall"
  | "forbidden-action"
  | "required-fall-missing"
  | "required-alive-fallen"
  | "required-hole-out-missing"
  | "required-wall-destruction-missing"
  | "contact-sequence-missing"
  | "custom-hit-missing"
  | "rook-shot-rule-missing"
  | "forbidden-contact"
  | "no-player-pieces"
  | "launch-budget-exceeded"
  | "wall-destruction-order-missing";

export interface PuzzleFailureReason {
  code: PuzzleFailureCode;
  ids?: readonly string[];
}

export interface PuzzleEvaluation {
  puzzleId: string;
  revision: number;
  status: PuzzleEvaluationStatus;
  medal: PuzzleMedal;
  requiredComplete: boolean;
  protectedContactIDs: readonly string[];
  failureReasons: readonly PuzzleFailureReason[];
  medalChecks: Readonly<Record<"bronze" | "silver" | "gold", boolean>>;
}

export interface PuzzleShotSummary {
  finishedAt: string;
  launches: number;
  medal: PuzzleMedal;
  hintsUsed: number;
  customHitUsed: boolean;
}

export interface PuzzleProgressEntry {
  puzzleId: string;
  revision: number;
  bestMedal: PuzzleMedal;
  attempts: number;
  hintsUsed: number;
  bestLaunches: number | null;
  lastShot: PuzzleShotSummary | null;
  completedAt: string | null;
}

export interface PuzzleProgressStore {
  version: 1;
  revision: 1;
  records: Record<string, PuzzleProgressEntry>;
  rewardIds: string[];
}

export interface PuzzleStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  setItems?(values: Record<string, string>): void;
}

export const PUZZLE_STORAGE_KEY = "ca_puzzle_progress_v1";
export const PUZZLE_SAVE_VERSION = 1 as const;
export const PUZZLE_SAVE_REVISION = 1 as const;
export const PUZZLE_ABILITY_POLICY: PuzzleAbilityPolicy = {
  research: false,
  deck: false,
  pawnPromotion: false,
  kingSpecial: false,
};

function position(x: number, z: number): NormalizedBoardPosition {
  return { x, z, positionValidated: false };
}

function piece(
  id: string,
  type: PieceType,
  side: PieceSide,
  x: number,
  z: number,
  lane: PuzzleLane,
  pose: PuzzlePose = "upright",
  isProtected = false,
): PuzzlePieceDefinition {
  return {
    id,
    type,
    side,
    position: position(x, z),
    pose,
    lane,
    ...(isProtected ? { protected: true } : {}),
  };
}

function rule(
  maxLaunches: number,
  requiredFallIds: readonly string[],
  extras: Omit<PuzzleRule, "maxLaunches" | "requiredFallIds"> = {},
): PuzzleRule {
  return { maxLaunches, requiredFallIds, ...extras };
}

function simpleMedals(
  bronze: PuzzleRule,
  silver: PuzzleRule,
  gold: PuzzleRule,
): PuzzleMedalRules {
  return { bronze, silver, gold };
}

const P01_PLAYER = "p01-player-pawn";
const P01_TARGET = "p01-target-pawn";
const P02_PLAYER = "p02-player-pawn";
const P02_PROTECTED = "p02-protected-pawn";
const P02_TARGET = "p02-target-bishop";
const P03_PLAYER = "p03-player-rook";
const P03_TARGET = "p03-target-pawn";
const P03_WALL = "p03-pocket-wall";
const P04_PLAYER = "p04-player-pawn";
const P04_TARGET_A = "p04-target-pawn-a";
const P04_TARGET_B = "p04-target-pawn-b";
const P05_PLAYER = "p05-player-rook";
const P05_TARGET = "p05-target-pawn";
const P06_PLAYER = "p06-player-pawn";
const P06_PROTECTED = "p06-protected-king";
const P06_TARGET = "p06-target-rook";
const P07_PLAYER = "p07-player-bishop";
const P07_TARGET_A = "p07-target-pawn-a";
const P07_TARGET_B = "p07-target-pawn-b";
const P08_PLAYER = "p08-player-rook";
const P08_TARGET = "p08-target-pawn";
const P09_PLAYER = "p09-player-knight";
const P09_TARGET = "p09-target-pawn";
const P10_PLAYER = "p10-player-bishop";
const P10_TARGET = "p10-target-pawn";
const P10_PROTECTED = "p10-protected-pawn";
const P11_PLAYER = "p11-player-rook";
const P11_TARGET = "p11-target-pawn";
const P11_WALL = "p11-breakable-wall";
const P12_PLAYER = "p12-player-pawn";
const P12_PLAYER_B = "p12-player-pawn-b";
const P12_PROTECTED = "p12-protected-king";
const P12_TARGET_A = "p12-target-pawn-a";
const P12_TARGET_B = "p12-target-pawn-b";
const P12_TARGET_C = "p12-target-pawn-c";

/** 초기 12문제. 좌표는 H 정규화 제작 시안이며 물리 검수 전에는 공개 해법으로 간주하지 않는다. */
export const PUZZLE_CATALOG: readonly PuzzleDefinition[] = [
  {
    puzzleId: "P01",
    revision: 1,
    chapter: 1,
    title: "마지막 한 칸",
    boardTemplate: "basic",
    boardStage: 1,
    validationGate: true,
    pieces: [
      piece(P01_PLAYER, "Pawn", "white", -0.42, -0.3, "direct"),
      piece(P01_TARGET, "Pawn", "black", 0.42, 0.3, "direct"),
    ],
    launchBudget: 2,
    abilityPolicy: PUZZLE_ABILITY_POLICY,
    required: rule(2, [P01_TARGET]),
    forbidden: { fallIds: [], contactIds: [], actions: ["promotion", "king-special"] },
    medals: simpleMedals(
      rule(2, [P01_TARGET]),
      rule(1, [P01_TARGET]),
      rule(1, [P01_TARGET], { requiredAliveIds: [P01_PLAYER] }),
    ),
    hints: ["먼저 목표 말의 진행 방향을 살펴보세요.", "약한 측면 타격으로 목표만 밀어 보세요."],
    failureCopy: "목표 말을 장외로 보내지 못했습니다.",
  },
  {
    puzzleId: "P02",
    revision: 1,
    chapter: 1,
    title: "비껴 맞히기",
    boardTemplate: "basic",
    boardStage: 1,
    pieces: [
      piece(P02_PLAYER, "Pawn", "white", -0.5, -0.35, "direct"),
      piece(P02_PROTECTED, "Pawn", "white", 0, 0.7, "protected", "upright", true),
      piece(P02_TARGET, "Bishop", "black", 0.48, 0.34, "direct"),
    ],
    launchBudget: 2,
    abilityPolicy: PUZZLE_ABILITY_POLICY,
    required: rule(2, [P02_TARGET]),
    forbidden: { fallIds: [P02_PROTECTED], contactIds: [], actions: ["promotion", "king-special"] },
    medals: simpleMedals(
      rule(2, [P02_TARGET]),
      rule(1, [P02_TARGET]),
      rule(1, [P02_TARGET], { forbiddenContactIds: [P02_PROTECTED] }),
    ),
    hints: ["보호 말 주변의 빈 공간을 먼저 확인하세요.", "보호 말의 반대쪽에서 비껴 밀어 보세요."],
    failureCopy: "보호 말이 장외로 떨어졌거나 목표가 남아 있습니다.",
  },
  {
    puzzleId: "P03",
    revision: 1,
    chapter: 1,
    title: "돌아오는 길",
    boardTemplate: "pocket",
    boardStage: 7,
    validationGate: true,
    pieces: [
      piece(P03_PLAYER, "Rook", "white", -0.4, 0.9, "ricochet"),
      piece(P03_TARGET, "Pawn", "black", 0.96, 0.8, "ricochet"),
    ],
    launchBudget: 2,
    abilityPolicy: PUZZLE_ABILITY_POLICY,
    required: rule(2, [P03_TARGET]),
    forbidden: { fallIds: [], contactIds: [], actions: ["promotion", "king-special"] },
    medals: simpleMedals(
      rule(2, [P03_TARGET]),
      rule(2, [P03_TARGET], { contactSequence: { shooterId: P03_PLAYER, wallIds: [P03_WALL], targetId: P03_TARGET } }),
      rule(1, [P03_TARGET], {
        requiredAliveIds: [P03_PLAYER],
        contactSequence: { shooterId: P03_PLAYER, wallIds: [P03_WALL], targetId: P03_TARGET },
      }),
    ),
    hints: ["직접 충돌보다 고정벽을 먼저 이용해 보세요.", "룩을 벽 쪽으로 보내 반사된 뒤 목표를 맞히세요."],
    failureCopy: "목표를 제거했지만 지정된 벽 반사 조건을 만족하지 못했습니다.",
  },
  {
    puzzleId: "P04",
    revision: 1,
    chapter: 1,
    title: "둘을 한 번에",
    boardTemplate: "basic",
    boardStage: 1,
    pieces: [
      piece(P04_PLAYER, "Pawn", "white", -0.5, -0.35, "chain"),
      piece(P04_TARGET_A, "Pawn", "black", 0.18, 0.18, "chain"),
      piece(P04_TARGET_B, "Pawn", "black", 0.58, 0.42, "chain"),
    ],
    launchBudget: 2,
    abilityPolicy: PUZZLE_ABILITY_POLICY,
    required: rule(2, [P04_TARGET_A, P04_TARGET_B]),
    forbidden: { fallIds: [], contactIds: [], actions: ["promotion", "king-special"] },
    medals: simpleMedals(
      rule(2, [P04_TARGET_A, P04_TARGET_B]),
      rule(1, [P04_TARGET_A, P04_TARGET_B]),
      rule(1, [P04_TARGET_A, P04_TARGET_B], { requiredAliveIds: [P04_PLAYER] }),
    ),
    hints: ["두 목표의 일직선과 간격을 비교해 보세요.", "첫 충돌 뒤 두 번째 목표로 이어지는 방향을 만드세요."],
    failureCopy: "두 목표를 모두 장외로 보내지 못했습니다.",
  },
  {
    puzzleId: "P05",
    revision: 1,
    chapter: 2,
    title: "가운데로",
    boardTemplate: "hole",
    boardStage: 5,
    pieces: [
      piece(P05_PLAYER, "Rook", "white", 0.55, 0.6, "hole"),
      piece(P05_TARGET, "Pawn", "black", 0.15, 0.2, "hole"),
    ],
    launchBudget: 3,
    abilityPolicy: PUZZLE_ABILITY_POLICY,
    required: rule(3, [P05_TARGET], { requiredHoleOutIds: [P05_TARGET] }),
    forbidden: { fallIds: [], contactIds: [], actions: ["promotion", "king-special"] },
    medals: simpleMedals(
      rule(3, [P05_TARGET], { requiredHoleOutIds: [P05_TARGET] }),
      rule(2, [P05_TARGET], { requiredHoleOutIds: [P05_TARGET] }),
      rule(1, [P05_TARGET], { requiredHoleOutIds: [P05_TARGET], requiredAliveIds: [P05_PLAYER] }),
    ),
    hints: ["중앙 구멍의 가장자리와 목표의 이동선을 관찰하세요.", "목표의 속도를 중앙 구멍 방향으로 바꾸세요."],
    failureCopy: "목표가 중앙 구멍으로 제거되지 않았습니다.",
  },
  {
    puzzleId: "P06",
    revision: 1,
    chapter: 2,
    title: "아군 사이",
    boardTemplate: "basic",
    boardStage: 1,
    validationGate: true,
    pieces: [
      piece(P06_PLAYER, "Pawn", "white", -0.48, -0.36, "direct"),
      piece(P06_PROTECTED, "King", "white", 0, 0.7, "protected", "upright", true),
      piece(P06_TARGET, "Rook", "black", 0.46, 0.3, "direct"),
    ],
    launchBudget: 3,
    abilityPolicy: PUZZLE_ABILITY_POLICY,
    required: rule(3, [P06_TARGET], { requiredAliveIds: [P06_PROTECTED] }),
    forbidden: { fallIds: [P06_PROTECTED], contactIds: [], actions: ["promotion", "king-special"] },
    medals: simpleMedals(
      rule(3, [P06_TARGET], { requiredAliveIds: [P06_PROTECTED] }),
      rule(2, [P06_TARGET], { requiredAliveIds: [P06_PROTECTED] }),
      rule(1, [P06_TARGET], { requiredAliveIds: [P06_PROTECTED], forbiddenContactIds: [P06_PROTECTED] }),
    ),
    hints: ["보호 말이 움직이지 않을 빈 각도를 찾으세요.", "적 말의 측면만 건드리도록 세기를 낮춰 보세요."],
    failureCopy: "적을 제거하면서 보호 아군을 지키지 못했습니다.",
  },
  {
    puzzleId: "P07",
    revision: 1,
    chapter: 2,
    title: "누운 창",
    boardTemplate: "basic",
    boardStage: 1,
    validationGate: true,
    pieces: [
      piece(P07_PLAYER, "Bishop", "white", -0.42, -0.3, "chain", "prone"),
      piece(P07_TARGET_A, "Pawn", "black", 0.1, 0.12, "chain"),
      piece(P07_TARGET_B, "Pawn", "black", 0.53, 0.4, "chain"),
    ],
    launchBudget: 3,
    abilityPolicy: PUZZLE_ABILITY_POLICY,
    required: rule(3, [P07_TARGET_A, P07_TARGET_B]),
    forbidden: { fallIds: [], contactIds: [], actions: ["promotion", "king-special"] },
    medals: simpleMedals(
      rule(3, [P07_TARGET_A, P07_TARGET_B]),
      rule(2, [P07_TARGET_A, P07_TARGET_B]),
      rule(2, [P07_TARGET_A, P07_TARGET_B], { requiredAliveIds: [P07_PLAYER] }),
    ),
    hints: ["누운 말도 그대로 선택해 발사할 수 있습니다.", "낮은 자세가 만드는 첫 충돌 각도를 활용하세요."],
    failureCopy: "두 목표를 모두 제거하지 못했습니다.",
  },
  {
    puzzleId: "P08",
    revision: 1,
    chapter: 2,
    title: "힘을 남겨라",
    boardTemplate: "basic",
    boardStage: 1,
    pieces: [
      piece(P08_PLAYER, "Rook", "white", -0.46, -0.32, "center"),
      piece(P08_TARGET, "Pawn", "black", 0.42, 0.32, "center"),
    ],
    launchBudget: 2,
    abilityPolicy: PUZZLE_ABILITY_POLICY,
    required: rule(2, [P08_TARGET]),
    forbidden: { fallIds: [], contactIds: [], actions: ["promotion", "king-special"] },
    medals: simpleMedals(
      rule(2, [P08_TARGET]),
      rule(1, [P08_TARGET], { rookShot: { pieceId: P08_PLAYER, requireCenterHit: true } }),
      rule(1, [P08_TARGET], { rookShot: { pieceId: P08_PLAYER, requireCenterHit: true, maxPower: 0.6 } }),
    ),
    hints: ["룩의 중앙 타점은 회전을 줄여 줍니다.", "표시 세기를 60% 이하로 맞춰 목표를 밀어 보세요."],
    failureCopy: "목표 제거 또는 룩의 세기·타점 조건을 만족하지 못했습니다.",
  },
  {
    puzzleId: "P09",
    revision: 1,
    chapter: 3,
    title: "넘어가는 길",
    boardTemplate: "holes",
    boardStage: 6,
    pieces: [
      piece(P09_PLAYER, "Knight", "white", 0.32, -0.78, "hole"),
      piece(P09_TARGET, "Pawn", "black", 0.92, -0.78, "hole"),
    ],
    launchBudget: 2,
    abilityPolicy: PUZZLE_ABILITY_POLICY,
    required: rule(2, [P09_TARGET]),
    forbidden: { fallIds: [], contactIds: [], actions: ["promotion", "king-special"] },
    medals: simpleMedals(
      rule(2, [P09_TARGET]),
      rule(1, [P09_TARGET]),
      rule(1, [P09_TARGET], { requiredAliveIds: [P09_PLAYER] }),
    ),
    hints: ["나이트는 앞의 장애물을 뛰어넘을 수 있습니다.", "구멍을 피하는 착지 지점을 먼저 정하세요."],
    failureCopy: "나이트로 목표를 제거하지 못했습니다.",
  },
  {
    puzzleId: "P10",
    revision: 1,
    chapter: 3,
    title: "회전의 차이",
    boardTemplate: "pillars",
    boardStage: 9,
    pieces: [
      piece(P10_PLAYER, "Bishop", "white", -0.48, -0.35, "pillar"),
      piece(P10_TARGET, "Pawn", "black", 0.18, 0.2, "pillar"),
      piece(P10_PROTECTED, "Pawn", "black", 0.52, 0.4, "protected", "upright", true),
    ],
    launchBudget: 3,
    abilityPolicy: PUZZLE_ABILITY_POLICY,
    required: rule(3, [P10_TARGET]),
    forbidden: { fallIds: [], contactIds: [], actions: ["promotion", "king-special"] },
    medals: simpleMedals(
      rule(3, [P10_TARGET]),
      rule(3, [P10_TARGET], { requireCustomHit: true }),
      rule(2, [P10_TARGET], { requireCustomHit: true, forbiddenContactIds: [P10_PROTECTED] }),
    ),
    hints: ["기둥을 기준으로 비숍의 접근선을 바꿔 보세요.", "커스텀 타점으로 첫 회전량을 조절하세요."],
    failureCopy: "지정 적 제거 또는 보호 적 접촉 조건을 만족하지 못했습니다.",
  },
  {
    puzzleId: "P11",
    revision: 1,
    chapter: 3,
    title: "벽을 열어라",
    boardTemplate: "breakable",
    boardStage: 3,
    pieces: [
      piece(P11_PLAYER, "Rook", "white", -0.45, -0.35, "break-wall"),
      piece(P11_TARGET, "Pawn", "black", -0.6, 0.2, "break-wall"),
    ],
    launchBudget: 4,
    abilityPolicy: PUZZLE_ABILITY_POLICY,
    required: rule(4, [P11_TARGET], {
      requiredWallDestroyedCounts: { [P11_WALL]: 1 },
      wallDestructionBeforeFall: { wallIds: [P11_WALL], fallIds: [P11_TARGET] },
    }),
    forbidden: { fallIds: [], contactIds: [], actions: ["promotion", "king-special"] },
    medals: simpleMedals(
      rule(4, [P11_TARGET], {
        requiredWallDestroyedCounts: { [P11_WALL]: 1 },
        wallDestructionBeforeFall: { wallIds: [P11_WALL], fallIds: [P11_TARGET] },
      }),
      rule(3, [P11_TARGET], {
        requiredWallDestroyedCounts: { [P11_WALL]: 1 },
        wallDestructionBeforeFall: { wallIds: [P11_WALL], fallIds: [P11_TARGET] },
      }),
      rule(2, [P11_TARGET], {
        requiredAliveIds: [P11_PLAYER],
        requiredWallDestroyedCounts: { [P11_WALL]: 1 },
        wallDestructionBeforeFall: { wallIds: [P11_WALL], fallIds: [P11_TARGET] },
      }),
    ),
    hints: ["벽의 남은 내구도를 확인하고 길을 열어야 합니다.", "첫 샷으로 벽을 파괴한 뒤 열린 경로를 이용하세요."],
    failureCopy: "벽을 열고 목표를 장외로 보내지 못했습니다.",
  },
  {
    puzzleId: "P12",
    revision: 1,
    chapter: 3,
    title: "내 해법",
    boardTemplate: "pillars",
    boardStage: 9,
    pieces: [
      piece(P12_PLAYER, "Pawn", "white", -0.8, 0.1, "chain"),
      piece(P12_PLAYER_B, "Pawn", "white", -0.8, 0.8, "chain"),
      piece(P12_PROTECTED, "King", "white", 0.8, -0.8, "protected", "upright", true),
      piece(P12_TARGET_A, "Pawn", "black", 0.65, 0.15, "chain"),
      piece(P12_TARGET_B, "Pawn", "black", 0.85, 0.25, "chain"),
      piece(P12_TARGET_C, "Pawn", "black", -0.8, 0, "chain"),
    ],
    launchBudget: 4,
    abilityPolicy: PUZZLE_ABILITY_POLICY,
    required: rule(4, [P12_TARGET_A, P12_TARGET_B, P12_TARGET_C]),
    forbidden: { fallIds: [P12_PROTECTED], contactIds: [], actions: ["promotion", "king-special"] },
    medals: simpleMedals(
      rule(4, [P12_TARGET_A, P12_TARGET_B, P12_TARGET_C]),
      rule(3, [P12_TARGET_A, P12_TARGET_B, P12_TARGET_C]),
      rule(2, [P12_TARGET_A, P12_TARGET_B, P12_TARGET_C], { requiredAliveIds: [P12_PROTECTED] }),
    ),
    hints: ["목표의 순서를 정하면 샷 수를 줄일 수 있습니다.", "보호 아군 쪽으로 튀지 않는 연쇄 각도를 찾으세요."],
    failureCopy: "세 목표를 모두 제거하지 못했거나 보호 아군을 잃었습니다.",
  },
] as const;

const CATALOG_BY_ID = new Map(PUZZLE_CATALOG.map((puzzle) => [puzzle.puzzleId, puzzle]));

export function getPuzzleDefinition(puzzleId: string): PuzzleDefinition | undefined {
  return CATALOG_BY_ID.get(puzzleId);
}

export function getPuzzleProgressKey(puzzleId: string, revision: number): string {
  return `${puzzleId}@${revision}`;
}

function uniqueStrings(ids: readonly string[] | undefined): string[] {
  return [...new Set((ids ?? []).filter((id) => typeof id === "string" && id.length > 0))];
}

function checkContactSequence(
  sequence: PuzzleContactSequence | undefined,
  events: readonly PuzzleContactEvent[],
): boolean {
  if (sequence === undefined) return true;
  const ordered = [...events].sort((a, b) => a.order - b.order);
  const target = ordered.find(
    (event) => event.shooterId === sequence.shooterId && event.targetId === sequence.targetId,
  );
  if (target === undefined) return false;
  return ordered.some(
    (event) =>
      event.shooterId === sequence.shooterId &&
      event.order < target.order &&
      event.targetKind === "wall" &&
      sequence.wallIds.includes(event.targetId),
  );
}

function checkRookShot(
  ruleValue: PuzzleRookShotRule | undefined,
  shots: readonly PuzzleRookShotEvidence[] | undefined,
): boolean {
  if (ruleValue === undefined) return true;
  const matching = (shots ?? []).filter((shot) => shot.pieceId === ruleValue.pieceId);
  return matching.some(
    (shot) =>
      (ruleValue.requireCenterHit !== true || shot.centerHit) &&
      (ruleValue.maxPower === undefined || shot.power <= ruleValue.maxPower + 1e-9),
  );
}

function checkRule(
  ruleValue: PuzzleRule,
  input: PuzzleEvaluationInput,
  fallen: ReadonlySet<string>,
  holes: ReadonlySet<string>,
  wallCounts: Readonly<Record<string, number>>,
  allProtectedContacts: ReadonlySet<string>,
  fallOrderEvents: readonly PuzzleFallOrderEvent[],
  wallDestructionOrderEvents: readonly PuzzleWallDestructionOrderEvent[],
): { ok: boolean; reasons: PuzzleFailureReason[] } {
  const reasons: PuzzleFailureReason[] = [];
  if (input.launches > ruleValue.maxLaunches) reasons.push({ code: "launch-budget-exceeded" });
  const missingFalls = ruleValue.requiredFallIds.filter((id) => !fallen.has(id));
  if (missingFalls.length > 0) reasons.push({ code: "required-fall-missing", ids: missingFalls });
  const fallenAlive = (ruleValue.requiredAliveIds ?? []).filter((id) => fallen.has(id));
  if (fallenAlive.length > 0) reasons.push({ code: "required-alive-fallen", ids: fallenAlive });
  const missingHoles = (ruleValue.requiredHoleOutIds ?? []).filter((id) => !holes.has(id));
  if (missingHoles.length > 0) reasons.push({ code: "required-hole-out-missing", ids: missingHoles });
  const missingWalls = Object.entries(ruleValue.requiredWallDestroyedCounts ?? {})
    .filter(([id, minimum]) => (wallCounts[id] ?? 0) < minimum)
    .map(([id]) => id);
  if (missingWalls.length > 0) reasons.push({ code: "required-wall-destruction-missing", ids: missingWalls });
  if (!checkContactSequence(ruleValue.contactSequence, input.contactEvents)) {
    reasons.push({ code: "contact-sequence-missing" });
  }
  if (ruleValue.requireCustomHit === true && input.customHitUsed !== true) {
    reasons.push({ code: "custom-hit-missing" });
  }
  if (!checkRookShot(ruleValue.rookShot, input.rookShots)) {
    reasons.push({ code: "rook-shot-rule-missing" });
  }
  const forbiddenContacts = (ruleValue.forbiddenContactIds ?? []).filter((id) =>
    allProtectedContacts.has(id),
  );
  if (forbiddenContacts.length > 0) reasons.push({ code: "forbidden-contact", ids: forbiddenContacts });
  const orderedRequirement = ruleValue.wallDestructionBeforeFall;
  if (orderedRequirement !== undefined) {
    const firstWallOrder = wallDestructionOrderEvents
      .filter((event) => orderedRequirement.wallIds.includes(event.wallId))
      .map((event) => event.order)
      .sort((left, right) => left - right)[0];
    const missingOrder = orderedRequirement.fallIds.filter((fallId) => {
      const firstFallOrder = fallOrderEvents
        .filter((event) => event.pieceId === fallId)
        .map((event) => event.order)
        .sort((left, right) => left - right)[0];
      return firstWallOrder === undefined || firstFallOrder === undefined || firstWallOrder >= firstFallOrder;
    });
    if (missingOrder.length > 0) {
      reasons.push({ code: "wall-destruction-order-missing", ids: missingOrder });
    }
  }
  return { ok: reasons.length === 0, reasons };
}

export function evaluatePuzzleAttempt(
  puzzle: PuzzleDefinition,
  input: PuzzleEvaluationInput,
): PuzzleEvaluation {
  const protectedContactIDs = uniqueStrings(input.protectedContactIDs);
  const base = {
    puzzleId: puzzle.puzzleId,
    revision: puzzle.revision,
    protectedContactIDs,
  };
  if (input.dataError !== undefined && input.dataError.trim().length > 0) {
    return {
      ...base,
      status: "failed",
      medal: 0,
      requiredComplete: false,
      failureReasons: [{ code: "data-error" }],
      medalChecks: { bronze: false, silver: false, gold: false },
    };
  }
  if (input.settled === false) {
    return {
      ...base,
      status: "pending",
      medal: 0,
      requiredComplete: false,
      failureReasons: [{ code: "not-settled" }],
      medalChecks: { bronze: false, silver: false, gold: false },
    };
  }
  const fallen = new Set(uniqueStrings(input.fallenIDs));
  const holes = new Set(uniqueStrings(input.holeOutIDs));
  const contacts = new Set(protectedContactIDs);
  const wallCounts = input.wallDestroyedCounts ?? {};
  const usedActions = new Set(uniqueStrings(input.usedActions));
  const immediateReasons: PuzzleFailureReason[] = [];
  const forbiddenFalls = puzzle.forbidden.fallIds.filter((id) => fallen.has(id));
  if (forbiddenFalls.length > 0) immediateReasons.push({ code: "forbidden-fall", ids: forbiddenFalls });
  const forbiddenActions = puzzle.forbidden.actions.filter((action) => usedActions.has(action));
  if (forbiddenActions.length > 0) immediateReasons.push({ code: "forbidden-action", ids: forbiddenActions });
  const forbiddenContacts = puzzle.forbidden.contactIds.filter((id) => contacts.has(id));
  if (forbiddenContacts.length > 0) immediateReasons.push({ code: "forbidden-contact", ids: forbiddenContacts });

  const checks = {
    bronze: checkRule(puzzle.medals.bronze, input, fallen, holes, wallCounts, contacts, input.fallOrderEvents ?? [], input.wallDestructionOrderEvents ?? []),
    silver: checkRule(puzzle.medals.silver, input, fallen, holes, wallCounts, contacts, input.fallOrderEvents ?? [], input.wallDestructionOrderEvents ?? []),
    gold: checkRule(puzzle.medals.gold, input, fallen, holes, wallCounts, contacts, input.fallOrderEvents ?? [], input.wallDestructionOrderEvents ?? []),
  };
  const requiredComplete = checks.bronze.ok;
  const playerPieceIds = puzzle.pieces
    .filter((piece) => piece.side === "white")
    .map((piece) => piece.id);
  if (
    !requiredComplete &&
    playerPieceIds.length > 0 &&
    playerPieceIds.every((id) => fallen.has(id))
  ) {
    immediateReasons.push({ code: "no-player-pieces", ids: playerPieceIds });
  }
  const medal: PuzzleMedal = immediateReasons.length > 0 || !requiredComplete
    ? 0
    : checks.gold.ok
      ? 3
      : checks.silver.ok
        ? 2
        : 1;
  let status: PuzzleEvaluationStatus;
  if (immediateReasons.length > 0) {
    status = "failed";
  } else if (requiredComplete) {
    status = "success";
  } else if (input.launches < puzzle.launchBudget) {
    status = "in-progress";
  } else {
    status = "failed";
  }
  const failureReasons = [
    ...immediateReasons,
    ...(status === "failed" && !requiredComplete ? checks.bronze.reasons : []),
  ];
  return {
    ...base,
    status,
    medal,
    requiredComplete,
    failureReasons,
    medalChecks: { bronze: checks.bronze.ok, silver: checks.silver.ok, gold: checks.gold.ok },
  };
}

function browserStorage(): PuzzleStorage | undefined {
  return progressStorage;
}

function emptyStore(): PuzzleProgressStore {
  return { version: 1, revision: 1, records: {}, rewardIds: [] };
}

function isMedal(value: unknown): value is PuzzleMedal {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

function normalizeEntry(value: unknown): PuzzleProgressEntry | null {
  if (value === null || typeof value !== "object") return null;
  const candidate = value as Partial<PuzzleProgressEntry>;
  if (
    typeof candidate.puzzleId !== "string" ||
    typeof candidate.revision !== "number" ||
    !Number.isInteger(candidate.revision)
  ) return null;
  const revision = candidate.revision;
  const attempts =
    typeof candidate.attempts === "number" && Number.isFinite(candidate.attempts) && candidate.attempts >= 0
      ? Math.floor(candidate.attempts)
      : 0;
  const hintsUsed =
    typeof candidate.hintsUsed === "number" && Number.isFinite(candidate.hintsUsed) && candidate.hintsUsed >= 0
      ? Math.floor(candidate.hintsUsed)
      : 0;
  const bestLaunches =
    candidate.bestLaunches === null
      ? null
      : typeof candidate.bestLaunches === "number" && Number.isFinite(candidate.bestLaunches) && candidate.bestLaunches > 0
        ? Math.floor(candidate.bestLaunches)
        : null;
  const lastShotCandidate =
    candidate.lastShot !== null && typeof candidate.lastShot === "object"
      ? candidate.lastShot
      : null;
  const lastShot = lastShotCandidate === null
    ? null
    : {
        finishedAt: typeof lastShotCandidate.finishedAt === "string" ? lastShotCandidate.finishedAt : "",
        launches:
          typeof lastShotCandidate.launches === "number" && Number.isFinite(lastShotCandidate.launches)
            ? Math.max(0, Math.floor(lastShotCandidate.launches))
            : 0,
        medal: isMedal(lastShotCandidate.medal) ? lastShotCandidate.medal : 0,
        hintsUsed:
          typeof lastShotCandidate.hintsUsed === "number" && Number.isFinite(lastShotCandidate.hintsUsed)
            ? Math.max(0, Math.floor(lastShotCandidate.hintsUsed))
            : 0,
        customHitUsed: lastShotCandidate.customHitUsed === true,
      };
  return {
    puzzleId: candidate.puzzleId,
    revision,
    bestMedal: isMedal(candidate.bestMedal) ? candidate.bestMedal : 0,
    attempts,
    hintsUsed,
    bestLaunches,
    lastShot,
    completedAt: typeof candidate.completedAt === "string" ? candidate.completedAt : null,
  };
}

export function validatePuzzleProgress(value: unknown): PuzzleProgressStore {
  if (value === null || typeof value !== "object") return emptyStore();
  const candidate = value as Partial<PuzzleProgressStore>;
  const store = emptyStore();
  if (candidate.version !== 1 || candidate.revision !== 1) return store;
  if (candidate.records && typeof candidate.records === "object") {
    for (const [key, raw] of Object.entries(candidate.records)) {
      const entry = normalizeEntry(raw);
      if (entry !== null && key === getPuzzleProgressKey(entry.puzzleId, entry.revision)) {
        store.records[key] = entry;
      }
    }
  }
  store.rewardIds = uniqueStrings(candidate.rewardIds);
  return store;
}

export function loadPuzzleProgress(storage: PuzzleStorage | undefined = browserStorage()): PuzzleProgressStore {
  if (storage === undefined) return emptyStore();
  try {
    const raw = storage.getItem(PUZZLE_STORAGE_KEY);
    if (raw !== null) return validatePuzzleProgress(JSON.parse(raw));
    const cleared = JSON.parse(storage.getItem("ca_puzzle_cleared_v1") ?? "[]");
    const medals = JSON.parse(storage.getItem("ca_puzzle_medals_v1") ?? "{}");
    const store = emptyStore();
    for (const puzzle of PUZZLE_CATALOG) {
      const medal = medals?.[puzzle.puzzleId] ?? (Array.isArray(cleared) && cleared.includes(puzzle.puzzleId) ? 1 : 0);
      if (!isMedal(medal) || medal === 0) continue;
      const entry = normalizeEntry({ puzzleId: puzzle.puzzleId, revision: puzzle.revision, bestMedal: medal });
      if (entry) store.records[getPuzzleProgressKey(puzzle.puzzleId, puzzle.revision)] = entry;
    }
    return store;
  } catch {
    return emptyStore();
  }
}

export function savePuzzleProgress(
  store: PuzzleProgressStore,
  storage: PuzzleStorage | undefined = browserStorage(),
): boolean {
  if (storage === undefined) return false;
  try {
    const normalized = validatePuzzleProgress(store);
    const medals = Object.fromEntries(PUZZLE_CATALOG.map(puzzle => [puzzle.puzzleId,
      getPuzzleProgress(normalized, puzzle.puzzleId, puzzle.revision)?.bestMedal ?? 0]));
    const values = {
      [PUZZLE_STORAGE_KEY]: JSON.stringify(normalized),
      ca_puzzle_cleared_v1: JSON.stringify(Object.keys(medals).filter(id => medals[id] > 0)),
      ca_puzzle_medals_v1: JSON.stringify(medals),
    };
    if (storage.setItems) storage.setItems(values);
    else for (const [key, value] of Object.entries(values)) storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function laterTimestamp(first: string | null, second: string | null): string | null {
  if (first === null) return second;
  if (second === null) return first;
  return first >= second ? first : second;
}

export function mergePuzzleProgress(
  first: PuzzleProgressStore,
  second: PuzzleProgressStore,
): PuzzleProgressStore {
  const merged = emptyStore();
  const allKeys = new Set([...Object.keys(first.records), ...Object.keys(second.records)]);
  for (const key of allKeys) {
    const left = first.records[key];
    const right = second.records[key];
    if (left === undefined) merged.records[key] = { ...right };
    else if (right === undefined) merged.records[key] = { ...left };
    else {
      const leftLast = left.lastShot;
      const rightLast = right.lastShot;
      const chosenLast = leftLast === null
        ? rightLast
        : rightLast === null
          ? leftLast
          : leftLast.finishedAt >= rightLast.finishedAt
            ? leftLast
            : rightLast;
      merged.records[key] = {
        puzzleId: left.puzzleId,
        revision: left.revision,
        bestMedal: Math.max(left.bestMedal, right.bestMedal) as PuzzleMedal,
        attempts: Math.max(left.attempts, right.attempts),
        hintsUsed: Math.max(left.hintsUsed, right.hintsUsed),
        bestLaunches:
          left.bestLaunches === null
            ? right.bestLaunches
            : right.bestLaunches === null
              ? left.bestLaunches
              : Math.min(left.bestLaunches, right.bestLaunches),
        lastShot: chosenLast,
        completedAt: laterTimestamp(left.completedAt, right.completedAt),
      };
    }
  }
  merged.rewardIds = uniqueStrings([...first.rewardIds, ...second.rewardIds]);
  return merged;
}

export interface ApplyPuzzleResultOptions {
  hintsUsedThisAttempt?: number;
  finishedAt?: string;
  launches?: number;
  customHitUsed?: boolean;
}

export interface ApplyPuzzleResult {
  store: PuzzleProgressStore;
  entry: PuzzleProgressEntry;
  newlyGrantedRewardIds: readonly string[];
}

function completedCount(store: PuzzleProgressStore, chapter: 1 | 2 | 3): number {
  return PUZZLE_CATALOG.filter(
    (puzzle) =>
      puzzle.chapter === chapter &&
      store.records[getPuzzleProgressKey(puzzle.puzzleId, puzzle.revision)]?.bestMedal !== undefined &&
      (store.records[getPuzzleProgressKey(puzzle.puzzleId, puzzle.revision)]?.bestMedal ?? 0) >= 1,
  ).length;
}

function goldCount(store: PuzzleProgressStore): number {
  return PUZZLE_CATALOG.filter(
    (puzzle) =>
      (store.records[getPuzzleProgressKey(puzzle.puzzleId, puzzle.revision)]?.bestMedal ?? 0) >= 3,
  ).length;
}

export function applyPuzzleEvaluation(
  store: PuzzleProgressStore,
  puzzle: PuzzleDefinition,
  evaluation: PuzzleEvaluation,
  options: ApplyPuzzleResultOptions = {},
): ApplyPuzzleResult {
  if (evaluation.status !== "success" && evaluation.status !== "failed") {
    throw new Error("정착 전 또는 진행 중 퍼즐 결과는 저장할 수 없습니다.");
  }
  const next = validatePuzzleProgress(store);
  const key = getPuzzleProgressKey(puzzle.puzzleId, puzzle.revision);
  const previous = next.records[key] ?? {
    puzzleId: puzzle.puzzleId,
    revision: puzzle.revision,
    bestMedal: 0,
    attempts: 0,
    hintsUsed: 0,
    bestLaunches: null,
    lastShot: null,
    completedAt: null,
  };
  const hintsUsedThisAttempt = Math.max(0, Math.floor(options.hintsUsedThisAttempt ?? 0));
  const medal = evaluation.status === "success" ? evaluation.medal : 0;
  const finishedAt = options.finishedAt ?? new Date().toISOString();
  const entry: PuzzleProgressEntry = {
    ...previous,
    bestMedal: Math.max(previous.bestMedal, medal) as PuzzleMedal,
    attempts: previous.attempts + 1,
    hintsUsed: previous.hintsUsed + hintsUsedThisAttempt,
    bestLaunches:
      medal > 0 && options.launches !== undefined && options.launches > 0
        ? previous.bestLaunches === null
          ? Math.floor(options.launches)
          : Math.min(previous.bestLaunches, Math.floor(options.launches))
        : previous.bestLaunches,
    lastShot: {
      finishedAt,
      launches: Math.max(0, Math.floor(options.launches ?? 0)),
      medal,
      hintsUsed: hintsUsedThisAttempt,
      customHitUsed: options.customHitUsed === true,
    },
    completedAt: previous.completedAt ?? (medal > 0 ? finishedAt : null),
  };
  next.records[key] = entry;
  const beforeRewards = new Set(next.rewardIds);
  if (previous.bestMedal < 1 && entry.bestMedal >= 1) beforeRewards.add(`puzzle:${puzzle.puzzleId}:bronze`);
  if (completedCount(next, 1) >= 4) beforeRewards.add("badge:puzzle-chapter-1");
  if (completedCount(next, 2) >= 4) beforeRewards.add("badge:puzzle-chapter-2");
  if (completedCount(next, 3) >= 4) beforeRewards.add("badge:puzzle-chapter-3");
  if (PUZZLE_CATALOG.every((item) => (next.records[getPuzzleProgressKey(item.puzzleId, item.revision)]?.bestMedal ?? 0) >= 1)) {
    beforeRewards.add("badge:puzzle-research-lab");
  }
  if (goldCount(next) >= 8) beforeRewards.add("cosmetic:puzzle-chalk-analysis-board");
  next.rewardIds = [...beforeRewards];
  return {
    store: next,
    entry,
    newlyGrantedRewardIds: next.rewardIds.filter((id) => !store.rewardIds.includes(id)),
  };
}

export function getPuzzleProgress(
  store: PuzzleProgressStore,
  puzzleId: string,
  revision = getPuzzleDefinition(puzzleId)?.revision ?? 1,
): PuzzleProgressEntry | null {
  return store.records[getPuzzleProgressKey(puzzleId, revision)] ?? null;
}

export function isPuzzleUnlocked(store: PuzzleProgressStore, puzzle: PuzzleDefinition): boolean {
  if (puzzle.chapter === 1) return true;
  const prerequisiteChapter = puzzle.chapter === 2 ? 1 : 2;
  return completedCount(store, prerequisiteChapter) >= 3;
}
