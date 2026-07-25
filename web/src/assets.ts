import { BufferGeometry, Mesh } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { PIECE_TYPES, type PieceType } from "./config";

export type ColliderPoint = [number, number, number];

export interface PieceMeta {
  triangles: number;
  bounds: {
    x: number;
    y: number;
    z: number;
  };
  baseRadius: number;
  baseFlattenEps: number;
  basePointCount: number;
  baseHullPointCount: number;
  colliderPoints: ColliderPoint[];
}

export interface ChessSetMeta {
  unit: string;
  globalScale: number;
  cellSize: number;
  boardThickness: number;
  pieces: Record<string, PieceMeta>;
  source: {
    file: string;
    sha256: string;
  };
}

export interface ChessAssets {
  meta: ChessSetMeta;
  geometries: Map<PieceType, BufferGeometry>;
}

/**
 * JSON 값이 필드 검사를 계속할 수 있는 일반 객체인지 확인한다.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 물리 크기에 쓰이는 값이 유한한 양수인지 확인하고 원래 숫자를 반환한다.
 */
function requirePositiveNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} 값이 유한한 양수가 아닙니다.`);
  }
  return value;
}

/**
 * 오차 허용값처럼 0을 허용하는 수치가 유한한 음이 아닌 값인지 검증한다.
 */
function requireNonNegativeNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} 값이 유한한 음이 아닌 수가 아닙니다.`);
  }
  return value;
}

/**
 * 점 개수 계약이 소수나 0으로 약해지지 않도록 양의 정수만 허용한다.
 */
function requirePositiveInteger(value: unknown, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value <= 0
  ) {
    throw new Error(`${label} 값이 양의 정수가 아닙니다.`);
  }
  return value;
}

/**
 * 콜라이더 한 점이 Rapier에 전달 가능한 세 개의 유한한 좌표인지 확인한다.
 */
function requireColliderPoint(value: unknown, label: string): ColliderPoint {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    value.some(
      (coordinate) =>
        typeof coordinate !== "number" || !Number.isFinite(coordinate),
    )
  ) {
    throw new Error(`${label} 콜라이더 점 형식이 올바르지 않습니다.`);
  }
  return [value[0] as number, value[1] as number, value[2] as number];
}

/**
 * 최종 메타데이터에서 런타임에 필요한 필수 6종만 엄격히 검증하고 추가 종류는 허용한다.
 */
function validateMeta(value: unknown): ChessSetMeta {
  if (!isRecord(value) || !isRecord(value.pieces)) {
    throw new Error("chess-set.meta.json에 pieces 객체가 없습니다.");
  }

  const pieces: Record<string, PieceMeta> = {};
  for (const type of PIECE_TYPES) {
    const rawPiece = value.pieces[type];
    if (!isRecord(rawPiece) || !isRecord(rawPiece.bounds)) {
      throw new Error(`메타데이터에 필수 말 ${type} 정보가 없습니다.`);
    }
    if (!Array.isArray(rawPiece.colliderPoints)) {
      throw new Error(`${type} 메타데이터에 colliderPoints 배열이 없습니다.`);
    }
    if (
      rawPiece.colliderPoints.length < 4 ||
      rawPiece.colliderPoints.length > 400
    ) {
      throw new Error(
        `${type} colliderPoints 개수 ${rawPiece.colliderPoints.length}개가 4~400 범위를 벗어났습니다.`,
      );
    }

    pieces[type] = {
      triangles: requirePositiveNumber(
        rawPiece.triangles,
        `${type} triangles`,
      ),
      bounds: {
        x: requirePositiveNumber(rawPiece.bounds.x, `${type} bounds.x`),
        y: requirePositiveNumber(rawPiece.bounds.y, `${type} bounds.y`),
        z: requirePositiveNumber(rawPiece.bounds.z, `${type} bounds.z`),
      },
      baseRadius: requirePositiveNumber(
        rawPiece.baseRadius,
        `${type} baseRadius`,
      ),
      baseFlattenEps: requireNonNegativeNumber(
        rawPiece.baseFlattenEps,
        `${type} baseFlattenEps`,
      ),
      basePointCount: requirePositiveInteger(
        rawPiece.basePointCount,
        `${type} basePointCount`,
      ),
      baseHullPointCount: requirePositiveInteger(
        rawPiece.baseHullPointCount,
        `${type} baseHullPointCount`,
      ),
      colliderPoints: rawPiece.colliderPoints.map((point, index) =>
        requireColliderPoint(point, `${type} ${index}번`),
      ),
    };
  }

  return {
    unit: typeof value.unit === "string" ? value.unit : "",
    globalScale: requirePositiveNumber(value.globalScale, "globalScale"),
    cellSize: requirePositiveNumber(value.cellSize, "cellSize"),
    boardThickness: requirePositiveNumber(
      value.boardThickness,
      "boardThickness",
    ),
    pieces,
    source: {
      file:
        isRecord(value.source) && typeof value.source.file === "string"
          ? value.source.file
          : "",
      sha256:
        isRecord(value.source) && typeof value.source.sha256 === "string"
          ? value.source.sha256
          : "",
    },
  };
}

/**
 * GitHub Pages 하위 경로에서도 동작하도록 Vite 기준 경로로 최종 에셋을 불러온다.
 */
export async function loadChessAssets(): Promise<ChessAssets> {
  const assetBaseUrl = `${import.meta.env.BASE_URL}assets/`;
  const metaUrl = `${assetBaseUrl}chess-set.meta.json`;
  const glbUrl = `${assetBaseUrl}chess-pieces.glb`;
  const loader = new GLTFLoader();

  const [metaResponse, gltf] = await Promise.all([
    fetch(metaUrl),
    loader.loadAsync(glbUrl),
  ]);
  if (!metaResponse.ok) {
    throw new Error(
      `chess-set.meta.json 요청이 실패했습니다: HTTP ${metaResponse.status} ${metaResponse.statusText}`,
    );
  }

  const meta = validateMeta((await metaResponse.json()) as unknown);
  const geometries = new Map<PieceType, BufferGeometry>();
  gltf.scene.traverse((object) => {
    if (
      object instanceof Mesh &&
      PIECE_TYPES.includes(object.name as PieceType)
    ) {
      const type = object.name as PieceType;
      const position = object.geometry.getAttribute("position");
      if (position === undefined || position.count === 0) {
        throw new Error(`${type} GLB 메시의 POSITION 속성이 없습니다.`);
      }
      object.geometry.computeBoundingBox();
      geometries.set(type, object.geometry);
    }
  });

  for (const type of PIECE_TYPES) {
    if (!geometries.has(type)) {
      throw new Error(
        `chess-pieces.glb에 필수 ${type} Mesh와 POSITION 속성이 없습니다.`,
      );
    }
  }

  return { meta, geometries };
}
