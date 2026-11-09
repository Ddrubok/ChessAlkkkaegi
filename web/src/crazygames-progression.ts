import type { CardId, UpgradeCard } from "./cards";

export interface CardPreview { before?: number; after?: number; pawnsLost?: number }

export interface CardPresentation {
  icon: string;
  effect: string;
  tradeoff: string | null;
  measuredEffect: string | null;
  grade: string | null;
}

const copy = {
  ko: {
    size: ["내 말의 크기와 충돌 범위 증가", "상대 공격에도 더 잘 맞음"],
    weight: ["내 말의 중량과 장외 저항 증가", "같은 힘에서 이동거리 감소"],
    force: ["내 말의 이동거리와 밀어내는 힘 증가", null],
    giantPawn: ["남은 폰의 크기 ×1.3", "폰 4개를 잃음"],
    proneStart: ["내 모든 말이 누운 자세로 시작", null],
  },
  en: {
    size: ["Your pieces grow and gain hit area", "Easier for opponents to hit"],
    weight: ["Your pieces gain mass and edge resistance", "Shorter travel at the same power"],
    force: ["Your pieces travel farther and push harder", null],
    giantPawn: ["Remaining pawns grow to ×1.3 size", "Lose 4 pawns"],
    proneStart: ["All your pieces start prone", null],
  },
} as const;

const icons: Record<CardId, string> = {
  size: "♙",
  weight: "♜",
  force: "♞",
  giantPawn: "♟",
  proneStart: "♝",
};

/** The stage draw supplies a Korean grade and effect; weekly offers may not. */
export function presentCard(card: UpgradeCard, language: string, preview?: CardPreview): CardPresentation {
  const locale = language === "ko" ? copy.ko : copy.en;
  const [effect, tradeoff] = locale[card.id];
  const grade = card.category === "general" ? card.name.split(" · ")[1] ?? null : null;
  const measured = card.category === "general"
    ? /(?:^| · )효과 \+(\d+)%/.exec(card.description)
    : null;
  return {
    icon: icons[card.id],
    effect,
    tradeoff: preview?.pawnsLost !== undefined
      ? language === "ko" ? `다음 경기: 폰 ${preview.pawnsLost}개 감소` : `Next match: lose ${preview.pawnsLost} pawn${preview.pawnsLost === 1 ? "" : "s"}`
      : tradeoff,
    measuredEffect: preview?.before !== undefined && preview.after !== undefined
      ? `+${Math.round(preview.before * 100)}% → +${Math.round(preview.after * 100)}%`
      : measured ? `+${measured[1]}%` : null,
    grade,
  };
}
