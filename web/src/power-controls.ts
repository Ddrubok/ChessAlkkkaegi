import { I18nManager } from "./i18n";

export type MousePowerDistance = 180 | 240 | 360;
export const DEFAULT_MOUSE_POWER_DISTANCE: MousePowerDistance = 180;
const KEY = "chessAlkkagi.mousePowerDistance";
const CHOICES: readonly MousePowerDistance[] = [180, 240, 360];
let current: MousePowerDistance = read();
const listeners = new Set<() => void>();

function read(): MousePowerDistance {
  try {
    const value = Number(localStorage.getItem(KEY));
    return CHOICES.includes(value as MousePowerDistance) ? value as MousePowerDistance : DEFAULT_MOUSE_POWER_DISTANCE;
  } catch {
    return DEFAULT_MOUSE_POWER_DISTANCE;
  }
}

export function getMousePowerDistance(): MousePowerDistance { return current; }
export function setMousePowerDistance(value: MousePowerDistance): void {
  if (!CHOICES.includes(value)) throw new Error("Unsupported mouse power distance");
  if (current === value) return;
  current = value;
  try { localStorage.setItem(KEY, String(value)); } catch { /* session only */ }
  listeners.forEach(listener => listener());
}
export function resetMousePowerDistance(): void { setMousePowerDistance(DEFAULT_MOUSE_POWER_DISTANCE); }
export function subscribeMousePowerDistance(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Keep the same pull budget for every piece and direction in a given canvas.
export function computeViewportPullReserve(canvasWidth: number, canvasHeight: number): number {
  return Math.max(0, Math.min(canvasWidth, canvasHeight)) * 0.18;
}

export function computeViewportPowerDistance(preferred: number, canvasWidth: number, canvasHeight: number): number {
  // 150% pull uses at most 80% of the camera's per-edge reserve.
  return Math.min(preferred, computeViewportPullReserve(canvasWidth, canvasHeight) * 0.8 / 1.5);
}

export function powerControlsCopy() {
  const ko = I18nManager.currentLang === "ko";
  return ko ? {
    tab: "조작", title: "마우스 당김 거리", description: "긴 거리를 선택하면 작은 세기를 더 정밀하게 조절할 수 있습니다. 실제 거리는 게임 화면 크기에 맞춰 줄어들 수 있으며 최대 발사 세기는 그대로입니다.",
    short: "짧게", standard: "보통", precise: "정밀", reset: "기본값 복원 (180px)",
    actual: "이 화면에서 실제 사용", limited: "화면 크기로 제한됨", sameDistance: "이 화면에서는 모든 선택지의 실제 당김 거리가 같습니다.",
    unavailable: "이 방향에서는 화면 가장자리 때문에 최대 세기에 도달할 수 없습니다. 다른 방향이나 더 짧은 거리를 사용하세요.",
    redDotUnavailable: "이 화면에서는 빨간 점 아래 공간이 부족해 최대 세기에 도달할 수 없습니다. 더 짧은 거리를 선택하세요.",
    hint: "살짝 당기면 약하게 발사합니다. 말 쪽으로 되돌리면 세기가 줄어듭니다.",
  } : {
    tab: "Controls", title: "Mouse pull distance", description: "A longer distance makes small power adjustments easier. The actual distance may shrink to fit the game canvas; maximum shot power stays the same.",
    short: "Short", standard: "Standard", precise: "Precise", reset: "Reset to 180px",
    actual: "Actual on this screen", limited: "Limited by screen size", sameDistance: "All choices use the same actual pull distance on this screen.",
    unavailable: "The screen edge prevents full power in this direction. Try another direction or a shorter distance.",
    redDotUnavailable: "There is too little room below the red dot for full power. Choose a shorter distance.",
    hint: "Pull a little for a softer shot. Move back toward the piece to reduce power.",
  };
}

export function rayDistanceToRectEdge(x: number, y: number, dx: number, dy: number, rect: Pick<DOMRect, "left" | "right" | "top" | "bottom">): number {
  const length = Math.hypot(dx, dy);
  if (length === 0 || x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return 0;
  const ux = dx / length, uy = dy / length;
  return Math.min(ux > 0 ? (rect.right - x) / ux : ux < 0 ? (rect.left - x) / ux : Infinity,
    uy > 0 ? (rect.bottom - y) / uy : uy < 0 ? (rect.top - y) / uy : Infinity);
}
