import './ui-motion.css';

export type MotionKind = 'panel' | 'tab' | 'result' | 'progress';
const KEY = 'chessalkkagi.motion.v1';
let preference = false;
try { preference = globalThis.localStorage?.getItem(KEY) === 'true'; } catch { /* optional device storage */ }
const media = typeof globalThis.matchMedia === 'function'
  ? globalThis.matchMedia('(prefers-reduced-motion: reduce)') : null;
const listeners = new Set<() => void>();
const animations = new WeakMap<HTMLElement, Animation>();
const active = new Set<HTMLElement>();
export const resolveReducedMotion = (local: boolean, system: boolean): boolean => local || system;
export const getMotionPreference = (): boolean => preference;
export const isMotionReduced = (): boolean => resolveReducedMotion(preference, media?.matches ?? false);
export function cancelUiMotion(element: HTMLElement): void {
  animations.get(element)?.cancel();
  animations.delete(element);
  active.delete(element);
}
function publish(): void {
  if (typeof document !== 'undefined') document.documentElement?.classList?.toggle('ui-motion-reduced', isMotionReduced());
  for (const element of active) cancelUiMotion(element);
  for (const listener of listeners) listener();
}
export function setMotionReduced(value: boolean): void {
  if (preference === value) return;
  preference = value;
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(value)); } catch { /* still applies this session */ }
  publish();
}
export function subscribeMotion(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
media?.addEventListener?.('change', publish);
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== KEY && event.key !== null) return;
    const next = event.newValue === 'true';
    if (next !== preference) { preference = next; publish(); }
  });
  window.addEventListener('pagehide', () => { for (const element of active) cancelUiMotion(element); });
}
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => {
  if (document.hidden) for (const element of active) cancelUiMotion(element);
});
publish();

export function playUiMotion(element: HTMLElement, kind: MotionKind): void {
  cancelUiMotion(element);
  if (isMotionReduced() || typeof element.animate !== 'function') return;
  const frames: Keyframe[] = kind === 'panel'
    ? [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }]
    : kind === 'progress'
      ? [{ backgroundColor: 'rgba(147,197,253,.2)' }, { backgroundColor: 'transparent' }]
      : [{ opacity: kind === 'tab' ? .85 : .5 }, { opacity: 1 }];
  const animation = element.animate(frames, { duration: kind === 'tab' ? 120 : kind === 'progress' ? 240 : 180, delay: kind === 'progress' ? 120 : 0, easing: 'ease-out' });
  animations.set(element, animation);
  active.add(element);
  const release = () => {
    if (animations.get(element) === animation) { animations.delete(element); active.delete(element); }
  };
  animation.addEventListener('finish', release, { once: true });
  animation.addEventListener('cancel', release, { once: true });
}

/** Owned by an existing modal lifecycle. Data refresh with the same key never replays. */
export function createPanelMotion() {
  let previous: HTMLElement | null = null;
  let key: string | undefined;
  let opened = false;
  return {
    refresh(panel: HTMLElement | null, nextKey = '', tabPanel: HTMLElement | null = panel) {
      if (!panel) return;
      const target = opened ? tabPanel ?? panel : panel;
      if (previous && previous !== target) cancelUiMotion(previous);
      if (!opened || key !== nextKey) playUiMotion(target, opened ? 'tab' : 'panel');
      previous = target; key = nextKey; opened = true;
      markMenuPressables(panel);
    },
    cancel() { if (previous) cancelUiMotion(previous); previous = null; opened = false; key = undefined; },
  };
}
/** Only call on menu surfaces, never on gameplay controls. Uses CSS scale, not transform. */
export function markMenuPressables(root: HTMLElement): void {
  root.querySelectorAll('button').forEach(button => button.classList.add('ui-motion-pressable'));
}
