/**
 * 킹 위치 교환(스왑) 선택 모달
 * 게임당 1회 한정으로 보드 위의 모든 기물 중 하나를 선택해 킹과 위치를 맞바꾸는 UI
 */

import type { PieceType } from "./config";
import type { PieceSide } from "./layout";
import type { PhysicsRuntime } from "./physics";

interface CandidatePiece {
  id: string;
  type: PieceType;
  side: PieceSide;
  isOpponent: boolean;
  symbol: string;
  displayName: string;
  tagText: string;
}

const PIECE_SYMBOLS: Record<PieceType, { white: string; black: string }> = {
  King: { white: "♔", black: "♚" },
  Queen: { white: "♕", black: "♛" },
  Rook: { white: "♖", black: "♜" },
  Bishop: { white: "♗", black: "♝" },
  Knight: { white: "♘", black: "♞" },
  Pawn: { white: "♙", black: "♟" },
};

const PIECE_KOREAN_NAMES: Record<PieceType, string> = {
  King: "킹",
  Queen: "퀸",
  Rook: "룩",
  Bishop: "비숍",
  Knight: "나이트",
  Pawn: "폰",
};

const TYPE_PRIORITY: Record<PieceType, number> = {
  Queen: 1,
  Rook: 2,
  Bishop: 3,
  Knight: 4,
  Pawn: 5,
  King: 6,
};

/**
 * 킹 위치 교환 모달을 띄우고 대상 기물 선택 시 콜백을 실행한다.
 */
export function openKingSwapModal(
  kingPieceId: string,
  currentSide: PieceSide,
  physicsRuntime: PhysicsRuntime,
  onSelect: (targetPieceId: string) => void,
  parentContainer?: HTMLElement,
): void {
  const container = parentContainer ?? document.body;
  const existing = document.querySelector(".king-swap-modal-overlay");
  if (existing) {
    existing.remove();
  }

  const candidates: CandidatePiece[] = [];
  for (const binding of physicsRuntime.pieces.values()) {
    if (binding.instance.id === kingPieceId) {
      continue;
    }
    const pos = binding.body.translation();
    if (pos.y < -1.0) {
      // 낙하한 기물 제외
      continue;
    }
    const isOpponent = binding.instance.side !== currentSide;
    const type = binding.instance.type;
    const symbol = PIECE_SYMBOLS[type]?.[binding.instance.side] ?? "♟";
    const sideLabel = binding.instance.side === "white" ? "백" : "흑";
    const roleLabel = isOpponent ? "적군" : "아군";
    candidates.push({
      id: binding.instance.id,
      type,
      side: binding.instance.side,
      isOpponent,
      symbol,
      displayName: `${sideLabel} ${PIECE_KOREAN_NAMES[type] ?? type}`,
      tagText: roleLabel,
    });
  }

  // 정렬: 적군 기물 우선, 그 안에서는 퀸 > 룩 > 비숍 > 나이트 > 폰 > 킹 순
  candidates.sort((a, b) => {
    if (a.isOpponent !== b.isOpponent) {
      return a.isOpponent ? -1 : 1;
    }
    return (TYPE_PRIORITY[a.type] ?? 99) - (TYPE_PRIORITY[b.type] ?? 99);
  });

  const overlay = document.createElement("div");
  overlay.className = "promotion-modal-overlay king-swap-modal-overlay";

  const card = document.createElement("div");
  card.className = "promotion-modal-card king-swap-modal-card";

  card.innerHTML = `
    <div class="promotion-modal-header">
      <h2 class="promotion-title">킹 위치 교환 (King Swap)</h2>
      <p class="promotion-subtitle">
        게임당 1회: 보드 위의 다른 기물을 선택하여 킹과 위치를 맞바꿉니다.
      </p>
    </div>
    <div class="king-swap-grid">
      ${candidates
        .map(
          (c) => `
        <button class="king-swap-piece-card ${c.isOpponent ? "card-opponent" : "card-friendly"}" data-piece-id="${c.id}" type="button">
          <span class="king-swap-piece-symbol">${c.symbol}</span>
          <div class="king-swap-piece-info">
            <span class="king-swap-piece-name">${c.displayName}</span>
            <span class="king-swap-piece-tag ${c.isOpponent ? "tag-opponent" : "tag-friendly"}">${c.tagText}</span>
          </div>
        </button>
      `,
        )
        .join("")}
    </div>
    <div class="king-swap-footer">
      <button class="king-swap-cancel-btn" type="button">닫기 (취소)</button>
    </div>
  `;

  overlay.appendChild(card);
  container.appendChild(overlay);

  const close = () => {
    overlay.classList.add("promotion-closing");
    setTimeout(() => {
      overlay.remove();
    }, 120);
  };

  const buttons = card.querySelectorAll<HTMLButtonElement>(
    ".king-swap-piece-card",
  );
  for (const btn of buttons) {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.pieceId;
      if (!targetId) return;
      close();
      onSelect(targetId);
    });
  }

  const cancelBtn = card.querySelector<HTMLButtonElement>(".king-swap-cancel-btn");
  cancelBtn?.addEventListener("click", () => {
    close();
  });
}
