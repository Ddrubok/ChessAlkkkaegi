import { cancelUiMotion, playUiMotion } from './ui-motion';
type ResultState = { id: string; token: symbol; values: Map<string, number>; nodes: Set<HTMLElement> };
const states = new WeakMap<HTMLElement, ResultState>();

/** Identity comes from the game/stage within a reset lifecycle, never a render counter. */
export function beginResultMotion(root: HTMLElement, id: string, title: HTMLElement, animateTitle = true): symbol {
  const previous = states.get(root);
  if (previous?.id === id) return previous.token;
  closeResultMotion(root);
  const state: ResultState = { id, token: Symbol(id), values: new Map(), nodes: new Set([title]) };
  states.set(root, state);
  if (animateTitle) playUiMotion(title, 'result');
  return state.token;
}
export function closeResultMotion(root: HTMLElement): void {
  const state = states.get(root);
  if (state) for (const node of state.nodes) cancelUiMotion(node);
  states.delete(root);
}
export function highlightResultProgress(root: HTMLElement, token: symbol, row: HTMLElement, id: string, before: number, after: number, confirmed: boolean): void {
  const state = states.get(root);
  if (!state || state.token !== token || root.hidden || !root.isConnected || !confirmed || !Number.isFinite(after) || after <= Math.max(before, state.values.get(id) ?? before)) return;
  state.values.set(id, after);
  state.nodes.add(row);
  // Numbers and actions already contain the final state; this never gates them.
  playUiMotion(row, 'progress');
}
export function notifyResultProgress(container: HTMLElement, row: HTMLElement, id: string, before: number, after: number, confirmed = true): void {
  const root = container.closest<HTMLElement>('.match-result-overlay, .puzzle-ui-overlay');
  const state = root && states.get(root);
  if (root && state) highlightResultProgress(root, state.token, row, id, before, after, confirmed);
}
