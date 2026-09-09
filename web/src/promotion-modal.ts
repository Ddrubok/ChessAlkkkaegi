/**
 * 폰 승급(프로모션) 선택 모달
 * 상대 진영 끝에서 1턴 생존한 폰을 4종 기물(퀸, 룩, 비숍, 나이트) 중 하나로 선택하는 UI
 */

import type { PieceType } from "./config";
import type { PieceSide } from "./layout";

export interface PromotionPieceOption {
  type: PieceType;
  name: string;
  symbol: string;
  description: string;
}

export const PROMOTION_PIECE_OPTIONS: readonly PromotionPieceOption[] = [
  {
    type: "Queen",
    name: "퀸 (Queen)",
    symbol: "♕",
    description: "무회전 150% 일직선 오버드라이브와 스핀 2.2배 리코셰 굴절을 모두 구사합니다.",
  },
  {
    type: "Rook",
    name: "룩 (Rook)",
    symbol: "♖",
    description: "무회전 발사 시 최대 150% 일직선 오버드라이브 파워.",
  },
  {
    type: "Bishop",
    name: "비숍 (Bishop)",
    symbol: "♗",
    description: "스핀 충돌 시 2.2배 각도로 튕겨 나가는 대각선 리코셰.",
  },
  {
    type: "Knight",
    name: "나이트 (Knight)",
    symbol: "♘",
    description: "65° 고각 포물선으로 앞 기물을 뛰어넘어 도약합니다.",
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

  const sideLabel = side === "white" ? "백" : "흑";

  card.innerHTML = `
    <div class="promotion-modal-header">
      <h2 class="promotion-title">폰 승급 (Pawn Promotion)</h2>
      <p class="promotion-subtitle">
        ${sideLabel} 진영 폰이 상대 진영 끝에서 생존했습니다. 전직할 기물을 선택하세요.
      </p>
    </div>
    <div class="promotion-piece-grid">
      ${PROMOTION_PIECE_OPTIONS.map(
        (opt) => `
        <button class="promotion-piece-card" data-piece-type="${opt.type}">
          <span class="promotion-piece-symbol">${opt.symbol}</span>
          <div class="promotion-piece-info">
            <span class="promotion-piece-name">${opt.name}</span>
            <span class="promotion-piece-desc">${opt.description}</span>
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
      }, 120);
    });
  }
}
