import type { CardId, UpgradeCard } from "./cards";

/** before/after are effective card bonus fractions, not final physical values. */
export interface CardPreview {
  before?: number;
  after?: number;
  pawnsLost?: number;
  /** Optional final values computed from the actual next board, including caps and other bonuses. */
  appliedValues?: readonly { piece: string; stat: string; before: number; after: number; unit?: string }[];
}

export interface CardPresentation {
  icon: string;
  effect: string;
  tradeoff: string | null;
  bonusChange: string | null;
  appliedValues: readonly string[];
  scope: string;
  detailTitle: string | null;
  detail: string | null;
  grade: string | null;
  noEffect: boolean;
}

const copy = {
  ko: {
    size: ["내 말의 크기와 충돌 범위 증가", "상대 공격에도 더 잘 맞음"],
    weight: ["내 말의 질량 증가", "같은 파워의 목표 초기 발사 속도는 유지"],
    force: ["같은 파워에서 목표 초기 발사 속도 증가", null],
    giantPawn: ["남은 폰에 크기 ×1.3 배수 적용", null],
    proneStart: ["내 말이 다음 단계에서 누운 자세로 시작", null],
  },
  en: {
    size: ["Your pieces grow and cover more space", "Easier for opponents to hit"],
    weight: ["Increases your pieces' mass", "Initial launch speed at the same power stays the same"],
    force: ["Increases initial launch speed at the same power", null],
    giantPawn: ["Remaining pawns gain a ×1.3 size multiplier", null],
    proneStart: ["Your pieces start the next stage lying down", null],
  },
} as const;

const icons: Record<CardId, string> = {
  size: "♙", weight: "♜", force: "♞", giantPawn: "♟", proneStart: "♝",
};

const percent = (value: number): string => `+${Math.round(value * 100)}%`;

/** Only supplied board values are labelled actual; bonus fractions remain card bonuses. */
export function presentCard(card: UpgradeCard, language: string, preview?: CardPreview): CardPresentation {
  const ko = language === "ko";
  const [effect, tradeoff] = (ko ? copy.ko : copy.en)[card.id];
  const grade = card.category === "general" ? card.name.split(" · ")[1] ?? null : null;
  const before = preview?.before ?? card.cardBonusBefore;
  const after = preview?.after ?? card.cardBonusAfter;
  const bonusChange = Number.isFinite(before) && Number.isFinite(after)
    ? `${percent(before!)} → ${percent(after!)}` : null;
  const formatValue = (value: number) => Number(value.toPrecision(4)).toString();
  const groups = new Map<string, { pieces: string[]; value: NonNullable<CardPreview["appliedValues"]>[number] }>();
  for (const value of preview?.appliedValues ?? []) {
    if (!Number.isFinite(value.before) || !Number.isFinite(value.after)) continue;
    const key = `${value.stat}:${value.before}:${value.after}:${value.unit ?? ""}`;
    const group = groups.get(key);
    if (group) group.pieces.push(value.piece);
    else groups.set(key, { pieces: [value.piece], value });
  }
  const appliedValues = [...groups.values()]
    .map(({ pieces, value }) => ({ ...value, piece: pieces.length > 2 ? ko ? `내 말 ${pieces.length}종` : `${pieces.length} piece types` : pieces.join(" / ") }))
    .filter(value => Number.isFinite(value.before) && Number.isFinite(value.after))
    .map(value => `${value.piece} ${value.stat}: ${formatValue(value.before)}${value.unit ?? ""} → ${formatValue(value.after)}${value.unit ?? ""}`);
  const noEffect = card.category === "general" &&
    ((preview?.appliedValues?.length ?? 0) > 0
      ? preview!.appliedValues!.every(value => Math.abs(value.after - value.before) < 1e-9)
      : before !== undefined && after !== undefined && Math.abs(after - before) < 1e-9);
  const scope = card.id === "giantPawn"
    ? ko ? "다음 단계부터 이번 도전의 남은 폰" : "Remaining pawns from the next stage, this run"
    : ko ? "다음 단계부터 이번 도전의 내 말" : "Your pieces from the next stage, this run";
  const detailTitle = card.id === "giantPawn"
    ? ko ? "어떤 폰이 제거되나요?" : "Which pawns are removed?"
    : card.id === "proneStart"
      ? ko ? "누운 자세는 어떻게 적용되나요?" : "How does prone start work?"
      : null;
  const detail = card.id === "giantPawn"
    ? ko ? "다음 단계 배치에서 a·c·e·g열의 폰을 제거합니다. 실제 제거 수는 단계 배치에 따라 달라집니다."
      : "Pawns on files a, c, e and g are removed from the next stage layout. The count depends on that layout."
    : card.id === "proneStart"
      ? ko ? "시작 자세만 바뀝니다. 이동 거리나 회피 효과는 보장되지 않습니다."
        : "Only the starting pose changes. Travel distance and evasion are not guaranteed."
      : null;
  return {
    icon: icons[card.id], effect,
    tradeoff: card.id === "giantPawn"
      ? preview?.pawnsLost !== undefined
        ? ko ? `다음 단계 폰 ${preview.pawnsLost}개 제거` : `${preview.pawnsLost} pawn${preview.pawnsLost === 1 ? "" : "s"} removed next stage`
        : ko ? "다음 단계에서 일부 폰 제거" : "Some pawns removed next stage"
      : tradeoff,
    bonusChange, appliedValues, scope, detailTitle, detail, grade, noEffect,
  };
}
