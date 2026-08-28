import type { PieceType } from "./config";
import { I18nManager } from "./i18n";

// 새 문구는 이곳에 모은다. 기존 언어팩과 번역 키는 변경하지 않는다.
const text: Record<string, string> = {
  strategyTitle: "전략 덱", strategyDescription: "총 10점 · 항목당 최대 4점 · 1점마다 힘 또는 중량 +2%",
  researchTitle: "영구 연구", researchDescription: "기초 연구 → 전체 크기 → 심화 연구 순서로 강화합니다.",
  allocated: "배분", pointsHeld: "보유 포인트", remaining: "남음", current: "현재 최종 효과", next: "다음 최종 효과",
  level: "단계", cost: "비용", maximum: "최대 단계입니다.", budgetSpent: "10점을 모두 배분했습니다. 다른 항목에서 점수를 빼세요.",
  minimum: "더 이상 줄일 수 없습니다.", insufficientPoints: "보유 포인트가 부족합니다.",
  advancedLocked: "전체 크기 연구를 구매하면 심화 연구가 열립니다.",
  kingBasicLocked: "폰과 나이트의 기초 힘·중량을 모두 3단계까지 연구하세요.",
  queenBasicLocked: "룩과 비숍의 기초 힘·중량을 모두 3단계까지 연구하세요.",
  kingAdvancedLocked: "폰과 나이트의 심화 힘·중량을 모두 3단계까지 연구하세요.",
  queenAdvancedLocked: "룩과 비숍의 심화 힘·중량을 모두 3단계까지 연구하세요.",
  sizeLocked: "여섯 말의 기초 힘·중량을 모두 3단계까지 연구하세요.",
  sizeDescription: "내 모든 말의 실제 크기 +5% · 심화 연구 해금", size: "전체 크기",
  increase: "늘리기", decrease: "줄이기", buy: "연구하기", preview: "3D 미리보기", previewHint: "좌우로 드래그해 회전",
  resetView: "시점 초기화", previewUnavailable: "3D 미리보기를 사용할 수 없습니다. 강화와 배분은 계속할 수 있습니다.",
  previewLoading: "3D 미리보기 준비 중", researchNoDecrease: "연구는 개별 감소할 수 없습니다. 전체 초기화를 이용하세요.",
  allocationSaved: "배분을 저장했습니다.", allocationReset: "배분을 초기화했습니다.",
  storageUnavailable: "배분은 적용했지만 이 브라우저에 저장하지 못했습니다.",
  purchaseSuccess: "연구를 완료했습니다.", purchaseFailed: "연구를 구매하지 못했습니다.", researchReset: "연구를 초기화하고 포인트를 전액 반환했습니다.",
  resetAllocation: "배분 초기화", resetResearch: "연구 전체 초기화", findMatch: "전략 대국 찾기",
  confirm: "확인", cancel: "취소", resetQuestion: "모든 연구를 초기화할까요? 반환 포인트:",
  unspentQuestion: "아직 배분하지 않은 포인트가 있습니다. 이 덱으로 대국을 찾을까요? 남은 포인트:",
  actionFailed: "요청을 완료하지 못했습니다. 잠시 후 다시 시도하세요.", basic: "기초", advanced: "심화", locked: "잠김",
  force: "힘", weight: "중량", pieceList: "말 선택",
};
const existing: Record<string, string> = {
  force: "lobby.stat_force", weight: "lobby.stat_weight", basic: "lobby.upgrade_basic", advanced: "lobby.upgrade_advanced",
  findMatch: "online.find_strategy", resetResearch: "lobby.upgrade_reset_btn", cancel: "common.cancel",
};
export function statText(key: string): string {
  const translationKey = existing[key];
  if (translationKey) {
    const translated = I18nManager.t(translationKey);
    if (translated !== translationKey) return translated;
  }
  return text[key] ?? key;
}
export function pieceLabel(type: PieceType): string { return I18nManager.t(`lobby.piece_${type.toLowerCase()}`); }
export function effectLabel(value: number): string { return `+${Math.round(value * 100)}%`; }
