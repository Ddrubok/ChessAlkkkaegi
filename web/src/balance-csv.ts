/**
 * balance-csv.ts
 *
 * 외부 의존성 없는 경량 CSV 파서 및 엄격한 밸런스 검증 엔진.
 * balance.csv의 단일 원본(Single Source of Truth)을 파싱하고 27개 키의 유효성을 검사합니다.
 */

export const BALANCE_KEYS = [
  "PIECE_DENSITY",
  "PIECE_FRICTION",
  "CLASSIC_FRICTION",
  "PIECE_RESTITUTION",
  "PIECE_LINEAR_DAMPING",
  "PIECE_ANGULAR_DAMPING",
  "MAX_LAUNCH_SPEED",
  "CLASSIC_MAX_LAUNCH_SPEED",
  "CLASSIC_KNIGHT_MAX_LAUNCH_SPEED",
  "KNIGHT_LAUNCH_ANGLE_DEG",
  "KNIGHT_MIN_LAUNCH_POWER",
  "ROOK_MAX_OVERDRIVE_POWER",
  "ROOK_SPIN_MAX_POWER",
  "BISHOP_SPIN_TORQUE_MULTIPLIER",
  "BISHOP_DEFLECTION_IMPULSE_FACTOR",
  "PAWN_WEIGHT_MULTIPLIER",
  "PAWN_POWER_MULTIPLIER",
  "KNIGHT_WEIGHT_MULTIPLIER",
  "KNIGHT_POWER_MULTIPLIER",
  "BISHOP_WEIGHT_MULTIPLIER",
  "BISHOP_POWER_MULTIPLIER",
  "ROOK_WEIGHT_MULTIPLIER",
  "ROOK_POWER_MULTIPLIER",
  "QUEEN_WEIGHT_MULTIPLIER",
  "QUEEN_POWER_MULTIPLIER",
  "KING_WEIGHT_MULTIPLIER",
  "KING_POWER_MULTIPLIER",
] as const;

export type BalanceKey = (typeof BALANCE_KEYS)[number];

export type BalanceConfig = Record<BalanceKey, number>;

export interface KeyRange {
  readonly min: number;
  readonly max: number;
  readonly description: string;
}

export const BALANCE_KEY_RANGES: Record<BalanceKey, KeyRange> = {
  PIECE_DENSITY: {
    min: 0.01,
    max: 100,
    description: "말 볼록껍질 부피 기반 기본 물리 밀도",
  },
  PIECE_FRICTION: {
    min: 0,
    max: 10,
    description: "로컬/스테이지/퍼즐 모드 말 기본 마찰 계수",
  },
  CLASSIC_FRICTION: {
    min: 0,
    max: 10,
    description: "온라인 대전 전용 말 마찰 계수",
  },
  PIECE_RESTITUTION: {
    min: 0,
    max: 1,
    description: "말 충돌 반발 계수 (0~1)",
  },
  PIECE_LINEAR_DAMPING: {
    min: 0,
    max: 100,
    description: "말 병진 속도 감쇠값 (0은 무감쇠)",
  },
  PIECE_ANGULAR_DAMPING: {
    min: 0,
    max: 100,
    description: "말 각속도 회전 감쇠값 (0은 무감쇠)",
  },
  MAX_LAUNCH_SPEED: {
    min: 0.1,
    max: 100,
    description: "로컬/스테이지/퍼즐 모드 최대 발사 속도",
  },
  CLASSIC_MAX_LAUNCH_SPEED: {
    min: 0.1,
    max: 100,
    description: "온라인 대전 일반 말 최대 발사 속도",
  },
  CLASSIC_KNIGHT_MAX_LAUNCH_SPEED: {
    min: 0.1,
    max: 100,
    description: "온라인 대전 나이트 최대 발사 속도",
  },
  KNIGHT_LAUNCH_ANGLE_DEG: {
    min: 0,
    max: 89.9,
    description: "나이트 도약 고정 앙각 (도)",
  },
  KNIGHT_MIN_LAUNCH_POWER: {
    min: 0,
    max: 1,
    description: "나이트 최소 발사 세기 보정 비율",
  },
  ROOK_MAX_OVERDRIVE_POWER: {
    min: 0.1,
    max: 5,
    description: "룩 무회전(중앙 타격) 시 최대 오버드라이브 파워 배율",
  },
  ROOK_SPIN_MAX_POWER: {
    min: 0.1,
    max: 5,
    description: "룩 스핀 타격 시 최대 파워 배율",
  },
  BISHOP_SPIN_TORQUE_MULTIPLIER: {
    min: 0,
    max: 20,
    description: "비숍 충돌 회전 토크 증폭 배율",
  },
  BISHOP_DEFLECTION_IMPULSE_FACTOR: {
    min: 0,
    max: 5,
    description: "비숍 충돌 대각선 굴절 충격량 배율",
  },
  PAWN_WEIGHT_MULTIPLIER: {
    min: 0.01,
    max: 20,
    description: "폰 개별 질량/밀도 배율",
  },
  PAWN_POWER_MULTIPLIER: {
    min: 0.01,
    max: 20,
    description: "폰 개별 발사 속도 배율",
  },
  KNIGHT_WEIGHT_MULTIPLIER: {
    min: 0.01,
    max: 20,
    description: "나이트 개별 질량/밀도 배율",
  },
  KNIGHT_POWER_MULTIPLIER: {
    min: 0.01,
    max: 20,
    description: "나이트 개별 발사 속도 배율",
  },
  BISHOP_WEIGHT_MULTIPLIER: {
    min: 0.01,
    max: 20,
    description: "비숍 개별 질량/밀도 배율",
  },
  BISHOP_POWER_MULTIPLIER: {
    min: 0.01,
    max: 20,
    description: "비숍 개별 발사 속도 배율",
  },
  ROOK_WEIGHT_MULTIPLIER: {
    min: 0.01,
    max: 20,
    description: "룩 개별 질량/밀도 배율",
  },
  ROOK_POWER_MULTIPLIER: {
    min: 0.01,
    max: 20,
    description: "룩 개별 발사 속도 배율",
  },
  QUEEN_WEIGHT_MULTIPLIER: {
    min: 0.01,
    max: 20,
    description: "퀸 개별 질량/밀도 배율",
  },
  QUEEN_POWER_MULTIPLIER: {
    min: 0.01,
    max: 20,
    description: "퀸 개별 발사 속도 배율",
  },
  KING_WEIGHT_MULTIPLIER: {
    min: 0.01,
    max: 20,
    description: "킹 개별 질량/밀도 배율",
  },
  KING_POWER_MULTIPLIER: {
    min: 0.01,
    max: 20,
    description: "킹 개별 발사 속도 배율",
  },
};

/**
 * RFC 4180 호환 경량 CSV 토크나이저.
 * UTF-8 BOM, CRLF/LF 개행, 따옴표("") 이스케이프 및 쉼표 포함 문자열을 지원합니다.
 */
export function parseCsvRows(input: string): string[][] {
  const text = input.startsWith("\uFEFF") ? input.slice(1) : input;
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;
  let quoteClosed = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          currentField += '"';
          i += 2;
          continue;
        } else {
          inQuotes = false;
          quoteClosed = true;
          i++;
          continue;
        }
      } else {
        currentField += char;
        i++;
        continue;
      }
    } else {
      if (quoteClosed && char !== "," && char !== "\r" && char !== "\n") {
        throw new Error("CSV 파싱 오류: 닫는 따옴표 뒤에는 구분자만 올 수 있습니다.");
      }
      if (char === '"') {
        if (currentField.length > 0) throw new Error("CSV 파싱 오류: 따옴표는 필드 시작에만 올 수 있습니다.");
        inQuotes = true;
        i++;
        continue;
      } else if (char === ",") {
        currentRow.push(currentField);
        currentField = "";
        quoteClosed = false;
        i++;
        continue;
      } else if (char === "\r") {
        if (i + 1 < text.length && text[i + 1] === "\n") {
          i++;
        }
        currentRow.push(currentField);
        currentField = "";
        rows.push(currentRow);
        currentRow = [];
        quoteClosed = false;
        i++;
        continue;
      } else if (char === "\n") {
        currentRow.push(currentField);
        currentField = "";
        rows.push(currentRow);
        currentRow = [];
        quoteClosed = false;
        i++;
        continue;
      } else {
        currentField += char;
        i++;
        continue;
      }
    }
  }

  if (inQuotes) {
    throw new Error("CSV 파싱 오류: 닫히지 않은 따옴표가 있습니다.");
  }

  // 남은 필드 및 마지막 행 처리
  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows;
}

const DECIMAL_NUMBER_REGEX = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

/**
 * CSV 텍스트를 파싱하고 정확한 키, 유한 십진수, 허용 범위를 엄격하게 검증합니다.
 */
export function parseAndValidateBalanceCsv(csvText: string): BalanceConfig {
  const allRows = parseCsvRows(csvText);

  // 빈 행 제거
  const rows = allRows.filter((row) =>
    row.some((cell) => cell.trim().length > 0),
  );

  if (rows.length === 0) {
    throw new Error("밸런스 CSV 검증 실패: CSV 파일이 비어 있습니다.");
  }

  // 헤더 검증
  const header = rows[0].map((h) => h.trim().toLowerCase());
  if (
    header.length !== 3 ||
    header[0] !== "key" ||
    header[1] !== "value" ||
    header[2] !== "description"
  ) {
    throw new Error(
      `밸런스 CSV 헤더 오류: 'key,value,description' 형식이어야 합니다. (실제 헤더: ${rows[0].join(",")})`,
    );
  }

  const expectedKeySet = new Set<string>(BALANCE_KEYS);
  const seenKeys = new Set<string>();
  const parsedMap: Partial<BalanceConfig> = {};

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    if (row.length !== 3) throw new Error(`밸런스 CSV ${rowIndex + 1}행 오류: 열은 정확히 3개여야 합니다.`);
    const rawKey = row[0]?.trim();
    const rawValue = row[1]?.trim();

    if (!rawKey) {
      throw new Error(
        `밸런스 CSV ${rowIndex + 1}행 오류: key가 비어 있습니다.`,
      );
    }

    if (seenKeys.has(rawKey)) {
      throw new Error(
        `밸런스 CSV 중복 키 오류: '${rawKey}' 키가 여러 번 정의되었습니다. (행 ${rowIndex + 1})`,
      );
    }

    if (!expectedKeySet.has(rawKey)) {
      throw new Error(
        `밸런스 CSV 알 수 없는 키 오류: '${rawKey}'는 허용되지 않는 키입니다. (행 ${rowIndex + 1})`,
      );
    }

    if (rawValue === undefined || rawValue === "") {
      throw new Error(
        `밸런스 CSV ${rowIndex + 1}행 오류: '${rawKey}'의 수치(value)가 비어 있습니다.`,
      );
    }

    if (!DECIMAL_NUMBER_REGEX.test(rawValue)) {
      throw new Error(
        `밸런스 CSV 수치 오류: '${rawKey}'의 값 '${rawValue}'는 올바른 십진수 형식이 아닙니다. (행 ${rowIndex + 1})`,
      );
    }

    const numValue = Number(rawValue);
    if (!Number.isFinite(numValue) || Number.isNaN(numValue)) {
      throw new Error(
        `밸런스 CSV 유한수 오류: '${rawKey}'의 값 '${rawValue}'는 유한한 숫자가 아닙니다. (행 ${rowIndex + 1})`,
      );
    }

    const key = rawKey as BalanceKey;
    const range = BALANCE_KEY_RANGES[key];
    if (numValue < range.min || numValue > range.max) {
      throw new Error(
        `밸런스 CSV 범위 초과: '${key}'의 수치 ${numValue}는 허용 범위 [${range.min}, ${range.max}]를 벗어났습니다. (${range.description})`,
      );
    }

    seenKeys.add(key);
    parsedMap[key] = numValue;
  }

  // 누락된 키 검사
  const missingKeys = BALANCE_KEYS.filter((k) => !seenKeys.has(k));
  if (missingKeys.length > 0) {
    throw new Error(
      `밸런스 CSV 누락 키 오류: 다음 필수 키가 CSV에 없습니다 -> [${missingKeys.join(", ")}]`,
    );
  }

  return parsedMap as BalanceConfig;
}

/**
 * 말 종류별 중량(밀도) 배율 반환 (Pawn, Knight, Bishop, Rook, Queen, King).
 * 정의되지 않은 종류이거나 불일치 시 기본 1.0 반환.
 */
export function getPieceWeightMultiplierFromConfig(
  config: BalanceConfig,
  type: string,
): number {
  switch (type.toLowerCase()) {
    case "pawn":
      return config.PAWN_WEIGHT_MULTIPLIER;
    case "knight":
      return config.KNIGHT_WEIGHT_MULTIPLIER;
    case "bishop":
      return config.BISHOP_WEIGHT_MULTIPLIER;
    case "rook":
      return config.ROOK_WEIGHT_MULTIPLIER;
    case "queen":
      return config.QUEEN_WEIGHT_MULTIPLIER;
    case "king":
      return config.KING_WEIGHT_MULTIPLIER;
    default:
      return 1.0;
  }
}

/**
 * 말 종류별 발사 속도(파워) 배율 반환 (Pawn, Knight, Bishop, Rook, Queen, King).
 * 정의되지 않은 종류이거나 불일치 시 기본 1.0 반환.
 */
export function getPiecePowerMultiplierFromConfig(
  config: BalanceConfig,
  type: string,
): number {
  switch (type.toLowerCase()) {
    case "pawn":
      return config.PAWN_POWER_MULTIPLIER;
    case "knight":
      return config.KNIGHT_POWER_MULTIPLIER;
    case "bishop":
      return config.BISHOP_POWER_MULTIPLIER;
    case "rook":
      return config.ROOK_POWER_MULTIPLIER;
    case "queen":
      return config.QUEEN_POWER_MULTIPLIER;
    case "king":
      return config.KING_POWER_MULTIPLIER;
    default:
      return 1.0;
  }
}
