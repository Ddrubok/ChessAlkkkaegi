import { I18nManager, LOCALES } from "./i18n";

export type MousePowerDistance = 180 | 240 | 360;
export const DEFAULT_MOUSE_POWER_DISTANCE: MousePowerDistance = 180;
// Trial tuned against the 30% radius and far-edge 150% reach checks together.
export const MOUSE_POWER_EXPONENT = 2.4;
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
  return Math.max(0, Math.min(canvasWidth, canvasHeight)) * 0.15;
}

export function computeViewportPowerDistance(preferred: number, canvasWidth: number, canvasHeight: number): number {
  // The inverse curve keeps the full 150% pull inside the shared space budget.
  // Wide board views recover vertical space by centering the projected board.
  // Narrow views remain limited by the horizontal camera reserve.
  const budget = canvasWidth >= canvasHeight * 1.5 ? 0.18 : 0.15;
  return Math.min(preferred, Math.max(0, Math.min(canvasWidth, canvasHeight)) * budget / Math.pow(1.5, 1 / MOUSE_POWER_EXPONENT));
}

// Exponent 1 preserves the legacy touch and standalone helper behavior.
export function powerAtPullDistance(distance: number, referenceDistance: number, maxPower: number, exponent = 1): number {
  const ratio = Math.max(0, distance) / referenceDistance;
  const power = Math.pow(ratio, exponent);
  return power >= maxPower - Number.EPSILON ? maxPower : Math.min(power, maxPower);
}

export function pullDistanceForPower(power: number, referenceDistance: number, exponent = 1): number {
  return referenceDistance * Math.pow(Math.max(0, power), 1 / exponent);
}

// A small canvas can cap every preset at the same distance. Give the longer
// presets a wider soft-shot band while keeping the original 50–150% reach.
export function adjustClassicMousePower(power: number, preset: number, referenceDistance: number): number {
  if (preset <= 180 || referenceDistance >= preset || power <= 0.1 || power >= 0.48) return power;
  const compression = Math.min(1, (preset - referenceDistance) / (preset - 180));
  const strength = compression * (preset === 240 ? 0.5 : 1);
  const precise = power <= 0.36 ? 0.1 + (power - 0.1) * 0.5 : 0.23 + (power - 0.36) * (0.25 / 0.12);
  return power + strength * (precise - power);
}

export function powerControlsCopy() {
  return LOCALES[I18nManager.getLanguage()].power_controls;
}

export function rayDistanceToRectEdge(x: number, y: number, dx: number, dy: number, rect: Pick<DOMRect, "left" | "right" | "top" | "bottom">): number {
  const length = Math.hypot(dx, dy);
  if (length === 0 || x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return 0;
  const ux = dx / length, uy = dy / length;
  return Math.min(ux > 0 ? (rect.right - x) / ux : ux < 0 ? (rect.left - x) / ux : Infinity,
    uy > 0 ? (rect.bottom - y) / uy : uy < 0 ? (rect.top - y) / uy : Infinity);
}
