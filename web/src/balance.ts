/**
 * balance.ts
 *
 * 밸런스 설정 단일 진실 공급원(Single Source of Truth).
 * ../balance.csv를 Vite raw 문자열로 임포트하여 초기화 시 엄격 검증 후 내보냅니다.
 */

import balanceCsvRaw from "../balance.csv?raw";
import {
  parseAndValidateBalanceCsv,
  getPieceWeightMultiplierFromConfig,
  getPiecePowerMultiplierFromConfig,
  type BalanceConfig,
  type BalanceKey,
} from "./balance-csv";

export const balanceConfig: BalanceConfig = parseAndValidateBalanceCsv(balanceCsvRaw);

/**
 * 말 종류별 중량(밀도) 배율을 조회합니다.
 * @param type 말 종류 이름 (Pawn, Knight, Bishop, Rook, Queen, King 등)
 */
export function getPieceWeightMultiplier(type: string): number {
  return getPieceWeightMultiplierFromConfig(balanceConfig, type);
}

/**
 * 말 종류별 발사 속도(파워) 배율을 조회합니다.
 * @param type 말 종류 이름 (Pawn, Knight, Bishop, Rook, Queen, King 등)
 */
export function getPiecePowerMultiplier(type: string): number {
  return getPiecePowerMultiplierFromConfig(balanceConfig, type);
}

export { balanceCsvRaw };
export type { BalanceConfig, BalanceKey };
