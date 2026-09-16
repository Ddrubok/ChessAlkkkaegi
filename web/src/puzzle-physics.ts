import RAPIER from "@dimforge/rapier3d-compat";
import { FALL_OUT_Y } from "./config";
import type { PhysicsRuntime } from "./physics";

export type PuzzleFallReason = "hole" | "outside" | "unresolved";

export interface PuzzlePieceContactEvent {
  step: number;
  firstPieceId: string;
  secondPieceId: string;
}

export interface PuzzleProtectedPieceContactEvent
  extends PuzzlePieceContactEvent {
  protectedPieceId: string;
}

export interface PuzzleWallContactEvent {
  step: number;
  pieceId: string;
  wallId: string;
  kind: "breakable-wall" | "pocket-wall" | "board-floor";
}

export interface PuzzleWallDestructionEvent {
  step: number;
  wallId: string;
}

export interface PuzzlePieceFallEvent {
  step: number;
  pieceId: string;
  reason: PuzzleFallReason;
  // hole 판정은 최종 위치가 아닌 보드 상면을 통과한 말 중심 경로에서만 한다.
  holeId?: string;
  crossingX?: number;
  crossingZ?: number;
  classificationBasis: "body-center-board-top-crossing" | "no-board-top-crossing";
}

export interface PuzzlePhysicsEvidence {
  shotPieceId: string | null;
  shotStartStep: number | null;
  pieceContacts: PuzzlePieceContactEvent[];
  protectedPieceContacts: PuzzleProtectedPieceContactEvent[];
  wallContacts: PuzzleWallContactEvent[];
  destroyedWalls: PuzzleWallDestructionEvent[];
  fallenPieces: PuzzlePieceFallEvent[];
  wallContactBeforeShotTargetContact: boolean;
}

interface BodyPosition {
  x: number;
  y: number;
  z: number;
}

interface BoardTopCrossing {
  x: number;
  z: number;
}

function pairKey(firstPieceId: string, secondPieceId: string): string {
  return firstPieceId < secondPieceId
    ? `${firstPieceId}\u0000${secondPieceId}`
    : `${secondPieceId}\u0000${firstPieceId}`;
}

function hasSolverContact(
  world: RAPIER.World,
  firstCollider: RAPIER.Collider,
  secondCollider: RAPIER.Collider,
): boolean {
  let touching = false;
  world.contactPair(firstCollider, secondCollider, (manifold) => {
    if (manifold.numSolverContacts() > 0) {
      touching = true;
    }
  });
  return touching;
}

function copyPosition(body: RAPIER.RigidBody): BodyPosition {
  const center = body.worldCom();
  return { x: center.x, y: center.y, z: center.z };
}

/**
 * 퍼즐 한 발의 물리 증거를 수집한다.
 *
 * beginShot()은 접촉 상승 전이와 낙하 경로의 기준점을 초기화한다.
 * sample()은 removeFallenPieces 직전에 호출해야 하며, FALL_OUT_Y를 이미
 * 통과한 말도 직전 위치에서 보드 상면 교차를 계산할 수 있도록 보존한다.
 */
export class PuzzlePhysicsTracker {
  private readonly runtime: PhysicsRuntime;
  private shotPieceId: string | null = null;
  private shotStartStep: number | null = null;
  private lastSampleStep: number | null = null;
  private previousPositions = new Map<string, BodyPosition>();
  private boardTopCrossings = new Map<string, BoardTopCrossing>();
  private activePieceContacts = new Set<string>();
  private activeWallContacts = new Set<string>();
  private recordedFallenPieces = new Set<string>();
  private recordedDestroyedWalls = new Set<string>();
  private protectedPieceIds = new Set<string>();
  private readonly pieceContacts: PuzzlePieceContactEvent[] = [];
  private readonly protectedPieceContacts: PuzzleProtectedPieceContactEvent[] = [];
  private readonly wallContacts: PuzzleWallContactEvent[] = [];
  private readonly destroyedWalls: PuzzleWallDestructionEvent[] = [];
  private readonly fallenPieces: PuzzlePieceFallEvent[] = [];

  public constructor(runtime: PhysicsRuntime) {
    this.runtime = runtime;
  }

  public beginShot(
    pieceId: string,
    step: number,
    protectedPieceIds: Iterable<string> = [],
  ): void {
    if (!Number.isInteger(step) || step < 0) {
      throw new Error(`퍼즐 물리 샷 step ${step}가 유효하지 않습니다.`);
    }
    if (!this.runtime.pieces.has(pieceId)) {
      throw new Error(`퍼즐 물리 샷 기물 ${pieceId}를 찾지 못했습니다.`);
    }
    this.shotPieceId = pieceId;
    this.shotStartStep = step;
    this.lastSampleStep = null;
    this.previousPositions.clear();
    this.boardTopCrossings.clear();
    for (const [id, binding] of this.runtime.pieces) {
      this.previousPositions.set(id, copyPosition(binding.body));
    }
    this.activePieceContacts.clear();
    this.activeWallContacts.clear();
    this.seedActiveContacts();
    this.recordedFallenPieces.clear();
    this.recordedDestroyedWalls.clear();
    this.protectedPieceIds = new Set(protectedPieceIds);
    this.pieceContacts.length = 0;
    this.protectedPieceContacts.length = 0;
    this.wallContacts.length = 0;
    this.destroyedWalls.length = 0;
    this.fallenPieces.length = 0;
  }

  /** 현재 샷의 물리 상태를 한 fixed step만큼 관측한다. */
  public sample(step: number): PuzzlePhysicsEvidence {
    if (this.shotPieceId === null || this.shotStartStep === null) {
      return this.evidence;
    }
    if (!Number.isInteger(step) || step < this.shotStartStep) {
      throw new Error(`퍼즐 물리 관측 step ${step}가 샷 시작보다 빠릅니다.`);
    }
    if (this.lastSampleStep !== null && step < this.lastSampleStep) {
      throw new Error(`퍼즐 물리 관측 step ${step}가 뒤로 이동했습니다.`);
    }
    this.lastSampleStep = step;

    const pieceBindings = [...this.runtime.pieces.entries()].sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    const currentPieceContacts = new Set<string>();
    for (let leftIndex = 0; leftIndex < pieceBindings.length; leftIndex += 1) {
      const [firstPieceId, firstBinding] = pieceBindings[leftIndex];
      for (let rightIndex = leftIndex + 1; rightIndex < pieceBindings.length; rightIndex += 1) {
        const [secondPieceId, secondBinding] = pieceBindings[rightIndex];
        if (!hasSolverContact(this.runtime.world, firstBinding.collider, secondBinding.collider)) {
          continue;
        }
        const key = pairKey(firstPieceId, secondPieceId);
        currentPieceContacts.add(key);
        if (this.activePieceContacts.has(key)) {
          continue;
        }
        const contact = { step, firstPieceId, secondPieceId };
        this.pieceContacts.push(contact);
        const firstProtected = this.protectedPieceIds.has(firstPieceId);
        const secondProtected = this.protectedPieceIds.has(secondPieceId);
        if (firstProtected || secondProtected) {
          const protectedPieceId = firstProtected ? firstPieceId : secondPieceId;
          this.protectedPieceContacts.push({ ...contact, protectedPieceId });
        }
      }
    }
    this.activePieceContacts = currentPieceContacts;

    const currentWallContacts = new Set<string>();
    const walls = [...this.runtime.breakableWalls.entries()].sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    for (const [wallId, wall] of walls) {
      const kind =
        wall.definition.variant === "breakable"
          ? "breakable-wall"
          : "pocket-wall";
      for (const [pieceId, piece] of pieceBindings) {
        if (!hasSolverContact(this.runtime.world, piece.collider, wall.collider)) {
          continue;
        }
        const key = `${pieceId}\u0000${kind}\u0000${wallId}`;
        currentWallContacts.add(key);
        if (!this.activeWallContacts.has(key)) {
          this.wallContacts.push({ step, pieceId, wallId, kind });
        }
      }
    }
    for (let boardColliderIndex = 0; boardColliderIndex < this.runtime.boardColliders.length; boardColliderIndex += 1) {
      const boardCollider = this.runtime.boardColliders[boardColliderIndex];
      const wallId = `board-floor-${boardColliderIndex}`;
      for (const [pieceId, piece] of pieceBindings) {
        if (!hasSolverContact(this.runtime.world, piece.collider, boardCollider)) {
          continue;
        }
        const key = `${pieceId}\u0000board-floor\u0000${boardColliderIndex}`;
        currentWallContacts.add(key);
        if (!this.activeWallContacts.has(key)) {
          this.wallContacts.push({
            step,
            pieceId,
            wallId,
            kind: "board-floor",
          });
        }
      }
    }
    this.activeWallContacts = currentWallContacts;

    for (const wallId of this.runtime.destroyedBreakableWallIds) {
      if (!this.recordedDestroyedWalls.has(wallId)) {
        this.recordedDestroyedWalls.add(wallId);
        this.destroyedWalls.push({ step, wallId });
      }
    }

    for (const [pieceId, binding] of pieceBindings) {
      const current = copyPosition(binding.body);
      const previous = this.previousPositions.get(pieceId);
      if (
        previous !== undefined &&
        !this.boardTopCrossings.has(pieceId) &&
        previous.y > this.runtime.boardTop &&
        current.y <= this.runtime.boardTop &&
        current.y < previous.y
      ) {
        const crossingT = (this.runtime.boardTop - previous.y) / (current.y - previous.y);
        this.boardTopCrossings.set(pieceId, {
          x: previous.x + (current.x - previous.x) * crossingT,
          z: previous.z + (current.z - previous.z) * crossingT,
        });
      }
      if (
        previous !== undefined &&
        !this.recordedFallenPieces.has(pieceId) &&
        binding.body.translation().y < FALL_OUT_Y
      ) {
        this.fallenPieces.push(this.classifyFall(pieceId, step, previous, current));
        this.recordedFallenPieces.add(pieceId);
      }
      this.previousPositions.set(pieceId, current);
    }

    return this.evidence;
  }

  public get evidence(): PuzzlePhysicsEvidence {
    const targetContacts = this.pieceContacts.filter(
      (contact) =>
        contact.firstPieceId === this.shotPieceId ||
        contact.secondPieceId === this.shotPieceId,
    );
    const firstTargetStep = targetContacts[0]?.step;
    const firstWallStep = this.wallContacts
      .filter(
        (contact) =>
          contact.pieceId === this.shotPieceId &&
          contact.kind !== "board-floor",
      )
      .map((contact) => contact.step)
      .sort((left, right) => left - right)[0];
    return {
      shotPieceId: this.shotPieceId,
      shotStartStep: this.shotStartStep,
      pieceContacts: this.pieceContacts.map((contact) => ({ ...contact })),
      protectedPieceContacts: this.protectedPieceContacts.map((contact) => ({ ...contact })),
      wallContacts: this.wallContacts.map((contact) => ({ ...contact })),
      destroyedWalls: this.destroyedWalls.map((wall) => ({ ...wall })),
      fallenPieces: this.fallenPieces.map((piece) => ({ ...piece })),
      // 같은 step은 선행으로 인정하지 않는다.
      wallContactBeforeShotTargetContact:
        firstWallStep !== undefined &&
        firstTargetStep !== undefined &&
        firstWallStep < firstTargetStep,
    };
  }

  /** 같은 샷에서 발사 기물의 표면 접촉이 대상 기물 접촉보다 엄격히 선행했는지 반환한다. */
  public hasWallContactBeforeShotTargetContact(): boolean {
    return this.evidence.wallContactBeforeShotTargetContact;
  }

  private classifyFall(
    pieceId: string,
    step: number,
    previous: BodyPosition,
    current: BodyPosition,
  ): PuzzlePieceFallEvent {
    const storedCrossing = this.boardTopCrossings.get(pieceId);
    if (storedCrossing !== undefined) {
      const hole = this.runtime.boardHoleRectangles.find(
        (rectangle) =>
          storedCrossing.x >= rectangle.minX &&
          storedCrossing.x <= rectangle.maxX &&
          storedCrossing.z >= rectangle.minZ &&
          storedCrossing.z <= rectangle.maxZ,
      );
      if (hole !== undefined) {
        return {
          step,
          pieceId,
          reason: "hole",
          holeId: hole.id,
          crossingX: storedCrossing.x,
          crossingZ: storedCrossing.z,
          classificationBasis: "body-center-board-top-crossing",
        };
      }
      return {
        step,
        pieceId,
        reason: "outside",
        crossingX: storedCrossing.x,
        crossingZ: storedCrossing.z,
        classificationBasis: "body-center-board-top-crossing",
      };
    }
    const deltaY = current.y - previous.y;
    if (previous.y > this.runtime.boardTop && deltaY < 0) {
      const crossingT = (this.runtime.boardTop - previous.y) / deltaY;
      const crossingX = previous.x + (current.x - previous.x) * crossingT;
      const crossingZ = previous.z + (current.z - previous.z) * crossingT;
      const hole = this.runtime.boardHoleRectangles.find(
        (rectangle) =>
          crossingX >= rectangle.minX &&
          crossingX <= rectangle.maxX &&
          crossingZ >= rectangle.minZ &&
          crossingZ <= rectangle.maxZ,
      );
      if (hole !== undefined) {
        return {
          step,
          pieceId,
          reason: "hole",
          holeId: hole.id,
          crossingX,
          crossingZ,
          classificationBasis: "body-center-board-top-crossing",
        };
      }
      return {
        step,
        pieceId,
        reason: "outside",
        crossingX,
        crossingZ,
        classificationBasis: "body-center-board-top-crossing",
      };
    }
    return {
      step,
      pieceId,
      reason: "unresolved",
      classificationBasis: "no-board-top-crossing",
    };
  }

  /** 샷 시작 전 정착 상태의 접촉을 기준선으로 삼아 휴지 접촉을 이벤트에서 제외한다. */
  private seedActiveContacts(): void {
    const pieceBindings = [...this.runtime.pieces.entries()].sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    for (let leftIndex = 0; leftIndex < pieceBindings.length; leftIndex += 1) {
      const [firstPieceId, firstBinding] = pieceBindings[leftIndex];
      for (let rightIndex = leftIndex + 1; rightIndex < pieceBindings.length; rightIndex += 1) {
        const [secondPieceId, secondBinding] = pieceBindings[rightIndex];
        if (hasSolverContact(this.runtime.world, firstBinding.collider, secondBinding.collider)) {
          this.activePieceContacts.add(pairKey(firstPieceId, secondPieceId));
        }
      }
    }
    for (const [wallId, wall] of this.runtime.breakableWalls) {
      const kind =
        wall.definition.variant === "breakable"
          ? "breakable-wall"
          : "pocket-wall";
      for (const [pieceId, piece] of pieceBindings) {
        if (hasSolverContact(this.runtime.world, piece.collider, wall.collider)) {
          this.activeWallContacts.add(`${pieceId}\u0000${kind}\u0000${wallId}`);
        }
      }
    }
    for (let boardColliderIndex = 0; boardColliderIndex < this.runtime.boardColliders.length; boardColliderIndex += 1) {
      const boardCollider = this.runtime.boardColliders[boardColliderIndex];
      for (const [pieceId, piece] of pieceBindings) {
        if (hasSolverContact(this.runtime.world, piece.collider, boardCollider)) {
          this.activeWallContacts.add(`${pieceId}\u0000board-floor\u0000${boardColliderIndex}`);
        }
      }
    }
  }
}
