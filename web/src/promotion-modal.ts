/**
 * 폰 승급(프로모션) 선택 모달
 * 상대 진영 끝에서 1턴 생존한 폰을 5종 기물(킹, 퀸, 룩, 비숍, 나이트) 중 하나로 전직 선택하는 UI
 */

import type { PieceType } from "./config";
import type { PieceSide } from "./layout";

export interface PromotionPieceOption {
  type: PieceType;
  name: string;
  symbol: string;
  badge: string;
  badgeColor: string;
  borderColor: string;
  hoverGlow: string;
  summary: string;
  gimmickText: string;
}

export const PROMOTION_PIECE_OPTIONS: readonly PromotionPieceOption[] = [
  {
    type: "King",
    name: "킹 (King)",
    symbol: "👑",
    badge: "수호 거신",
    badgeColor: "#d97706",
    borderColor: "#b45309",
    hoverGlow: "rgba(245, 158, 11, 0.35)",
    summary: "최고 중량과 거대한 밀치기 충격량",
    gimmickText: "압도적인 질량으로 적을 장외로 밀어냅니다.",
  },
  {
    type: "Queen",
    name: "퀸 (Queen)",
    symbol: "♕",
    badge: "전장의 여왕",
    badgeColor: "#db2777",
    borderColor: "#be185d",
    hoverGlow: "rgba(236, 72, 153, 0.35)",
    summary: "최상급 기동성과 완벽한 공수 밸런스",
    gimmickText: "가장 균형 잡힌 속도와 타격력을 발휘합니다.",
  },
  {
    type: "Rook",
    name: "룩 (Rook)",
    symbol: "♖",
    badge: "150% 오버드라이브",
    badgeColor: "#dc2626",
    borderColor: "#b91c1c",
    hoverGlow: "rgba(239, 68, 68, 0.35)",
    summary: "무회전 시 최대 150% 일직선 파쇄력",
    gimmickText: "스핀 없을 때 150% 초강력 오버드라이브 발사 가능!",
  },
  {
    type: "Bishop",
    name: "비숍 (Bishop)",
    symbol: "♗",
    badge: "스핀 리코셰",
    badgeColor: "#7c3aed",
    borderColor: "#6d28d9",
    hoverGlow: "rgba(139, 92, 246, 0.35)",
    summary: "2.2배 스핀 충돌 대각선 굴절 튕김",
    gimmickText: "강한 회전으로 적과 충돌 시 예리한 대각선으로 리코셰!",
  },
  {
    type: "Knight",
    name: "나이트 (Knight)",
    symbol: "♘",
    badge: "65° 포물선 도약",
    badgeColor: "#059669",
    borderColor: "#047857",
    hoverGlow: "rgba(16, 185, 129, 0.35)",
    summary: "65° 고각 포물선 비행 도약",
    gimmickText: "앞에 있는 기물을 뛰어넘어 후방을 직접 타격!",
  },
];

/**
 * 폰 승급 모달을 띄우고 선택 결과를 콜백으로 전달한다.
 */
export function openPromotionModal(
  _pieceId: string,
  side: PieceSide,
  onSelect: (chosenType: PieceType) => void,
  parentContainer?: HTMLElement,
): void {
  const container = parentContainer ?? document.body;
  const existing = document.querySelector(".promotion-modal-overlay");
  if (existing) {
    existing.remove();
  }

  const overlay = document.createElement("div");
  overlay.className = "promotion-modal-overlay";

  const card = document.createElement("div");
  card.className = "promotion-modal-card";

  const sideLabel = side === "white" ? "백(White)" : "흑(Black)";

  card.innerHTML = `
    <div class="promotion-modal-header">
      <div class="promotion-badge-top">♟️ PROMOTION READY</div>
      <h2 class="promotion-title">폰 승급 (Pawn Promotion)</h2>
      <p class="promotion-subtitle">
        <strong>${sideLabel}</strong> 폰이 상대 진영 끝에서 생존 성공!<br>
        전직할 기물을 선택하세요.
      </p>
    </div>
    <div class="promotion-piece-grid">
      ${PROMOTION_PIECE_OPTIONS.map(
        (opt) => `
        <button class="promotion-piece-card" data-piece-type="${opt.type}" style="--accent-border: ${opt.borderColor}; --accent-glow: ${opt.hoverGlow};">
          <div class="promotion-piece-symbol">${opt.symbol}</div>
          <div class="promotion-piece-info">
            <div class="promotion-piece-name-row">
              <span class="promotion-piece-name">${opt.name}</span>
              <span class="promotion-piece-tag" style="background: ${opt.badgeColor};">${opt.badge}</span>
            </div>
            <div class="promotion-piece-summary">${opt.summary}</div>
            <div class="promotion-piece-gimmick">${opt.gimmickText}</div>
          </div>
        </button>
      `,
      ).join("")}
    </div>
  `;

  overlay.appendChild(card);
  container.appendChild(overlay);

  const buttons = card.querySelectorAll<HTMLButtonElement>(
    ".promotion-piece-card",
  );
  for (const btn of buttons) {
    btn.addEventListener("click", () => {
      const chosenType = btn.dataset.pieceType as PieceType;
      overlay.classList.add("promotion-closing");
      setTimeout(() => {
        overlay.remove();
        onSelect(chosenType);
      }, 150);
    });
  }
}
