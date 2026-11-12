import type { PieceType } from "./config";
import type { GameMode } from "./game-mode";
import { I18nManager } from "./i18n";
import { pieceLabel } from "./piece-stat-text";

export function pieceIdentityCopy(type: PieceType, mode: GameMode, spin: boolean, kingUsed: boolean, promotionEnabled = true) {
  const ko = I18nManager.currentLang === "ko";
  switch (type) {
    case "Rook": return {
      condition: ko ? `최대 ${spin ? 100 : 150}% · ${spin ? "스핀 타점" : "중앙 타점"}` : `Max ${spin ? 100 : 150}% · ${spin ? "spin strike" : "central strike"}`,
      detail: ko ? "중앙 타격은 최대 150%, 스핀 타격은 최대 100%입니다." : "Central strikes allow 150% power; adding spin limits power to 100%.",
    };
    case "Queen": return {
      condition: ko ? "최대 150% · 스핀 굴절" : "Max 150% · spin ricochet",
      detail: ko ? "중앙·스핀 타점 모두 최대 150%입니다. 편심 타격은 회전을 더하고 충돌 시 굴절에 영향을 줍니다." : "Both central and spin strikes allow 150%. Off-center strikes add spin and affect ricochets on contact.",
    };
    case "Bishop": return {
      condition: ko ? "최대 100% · 스핀 굴절" : "Max 100% · spin ricochet",
      detail: ko ? "편심 타격은 회전을 더합니다. 스핀 중 다른 기물과 부딪히면 옆 방향으로 굴절합니다." : "Off-center strikes add spin. Contact with another piece while spinning adds a sideways deflection.",
    };
    case "Knight": return {
      condition: ko ? "65° 도약 · 최대 100%" : "65° jump · max 100%",
      detail: ko ? "높은 포물선으로 앞 기물을 넘습니다. 약한 입력에도 최소 도약 세기 보정이 적용됩니다." : "A high arc can clear pieces in front. Even soft input receives a minimum jump-power correction.",
    };
    case "Pawn": return {
      condition: mode === "online" || mode === "puzzle" || !promotionEnabled ? (ko ? "최대 100% · 이 판에서는 승격 없음" : "Max 100% · no promotion in this match") : (ko ? "최대 100% · 끝 진영 생존 시 승격" : "Max 100% · promotion at the far end"),
      detail: mode === "online" || mode === "puzzle" || !promotionEnabled ? (ko ? "현재 모드·단계에서는 폰 승격을 지원하지 않습니다." : "Pawn promotion is unavailable in this mode or stage.") : (ko ? "상대 진영 끝에 도달한 뒤 상대 턴을 버텨내면 승격할 수 있습니다." : "Reach the opponent's end and survive the opponent's turn to promote."),
    };
    case "King": return {
      condition: mode === "online" || mode === "puzzle" ? (ko ? "최대 100% · 이 모드에서는 특수기 없음" : "Max 100% · specials unavailable here") : kingUsed ? (ko ? "최대 100% · 특수기 사용 완료" : "Max 100% · special already used") : (ko ? "최대 100% · 교환 / 방어 중 한 번" : "Max 100% · one swap or defense"),
      detail: ko ? "교환·방어는 둘 중 하나만 사용할 수 있습니다. 온라인과 퍼즐에서는 사용할 수 없습니다." : "Use either swap or defense once. Neither is available in online matches or puzzles.",
    };
  }
}

export function createPieceIdentity(parent: HTMLElement) {
  const element = document.createElement("details");
  element.className = "piece-identity";
  element.hidden = true;
  const summary = document.createElement("summary");
  const title = document.createElement("strong");
  const condition = document.createElement("span");
  const detail = document.createElement("p");
  summary.append(title, condition);
  element.append(summary, detail);
  parent.append(element);
  let previous = "";
  return {
    element,
    update(type: PieceType | null, mode: GameMode, spin: boolean, kingUsed: boolean, promotionEnabled = true) {
      element.hidden = type === null;
      if (type === null) { previous = ""; element.open = false; return; }
      const key = `${type}:${mode}:${spin}:${kingUsed}:${promotionEnabled}:${I18nManager.currentLang}`;
      if (key === previous) return;
      element.open = false;
      previous = key;
      const copy = pieceIdentityCopy(type, mode, spin, kingUsed, promotionEnabled);
      title.textContent = pieceLabel(type);
      condition.textContent = copy.condition;
      detail.textContent = copy.detail;
    },
  };
}
