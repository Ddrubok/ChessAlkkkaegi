import './headless-browser-env.mjs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// Extend minimal headless DOM stub for TurnHud tree traversal and queries
function createFakeElement(tag = 'div') {
  const children = [];
  let parent = null;
  const element = {
    tagName: tag.toUpperCase(),
    style: {},
    className: '',
    innerHTML: '',
    textContent: '',
    hidden: false,
    id: '',
    get children() { return children; },
    get parentElement() { return parent; },
    set parentElement(p) { parent = p; },
    appendChild(child) {
      if (child.parentElement) {
        child.remove();
      }
      child.parentElement = element;
      children.push(child);
      return child;
    },
    remove() {
      if (parent) {
        const index = parent.children.indexOf(element);
        if (index !== -1) {
          parent.children.splice(index, 1);
        }
        parent = null;
      }
    },
    querySelector(selector) {
      if (selector.startsWith('#')) {
        const id = selector.slice(1);
        if (element.id === id || (typeof element.innerHTML === 'string' && element.innerHTML.includes(`id="${id}"`))) {
          return { textContent: '' };
        }
      }
      if (selector.startsWith('.')) {
        const cls = selector.slice(1);
        if (element.className?.split(/\s+/).includes(cls)) return element;
      }
      for (const child of children) {
        const found = child.querySelector?.(selector);
        if (found) return found;
      }
      return null;
    },
    matches(selector) {
      if (selector.startsWith('.')) {
        const cls = selector.slice(1);
        return element.className?.split(/\s+/).includes(cls) ?? false;
      }
      return false;
    },
  };
  return element;
}

globalThis.document.createElement = (tag) => createFakeElement(tag);
globalThis.document.querySelector = (selector) => null;

function findDescendantByClass(root, className) {
  if (root.className?.split(/\s+/).includes(className)) {
    return root;
  }
  for (const child of root.children ?? []) {
    const match = findDescendantByClass(child, className);
    if (match) return match;
  }
  return null;
}

const vite = await createServer({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  configFile: false,
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false },
});

try {
  const { createTurnHud } = await vite.ssrLoadModule('/src/turn-hud.ts');

  const parent = createFakeElement('div');
  const turnRuntime = {
    phase: 'ready',
    currentSide: 'white',
    settleSeconds: 0,
  };

  let menuVisible = false;
  let timeoutCount = 0;

  const options = {
    getGameMode: () => 'stage',
    getMySide: () => 'white',
    isMenuVisible: () => menuVisible,
    onTimeoutLaunch: () => {
      timeoutCount += 1;
    },
    getTrackedObjective: () => null,
  };

  const hud = createTurnHud(parent, turnRuntime, options);
  const timerTextEl = findDescendantByClass(hud.element, 'turn-hud-timer-text');
  assert.ok(timerTextEl, 'Timer text element must exist in turn HUD hierarchy');

  // Case 1: initial20
  hud.update(0, 0);
  assert.equal(timerTextEl.textContent, '20s', 'Case initial20: initial countdown must be 20s');

  // Case 2: elapse5=>15
  hud.update(5000, 5.0);
  assert.equal(timerTextEl.textContent, '15s', 'Case elapse5=>15: after 5s elapsed, timer must show 15s');

  // Case 3: reset same white=>20
  hud.reset();
  hud.update(5000, 0);
  assert.equal(timerTextEl.textContent, '20s', 'Case reset same white=>20: reset on same white side restores 20s');

  // Case 4: timeout onlyonce
  hud.update(25000, 20.0);
  assert.equal(timerTextEl.textContent, '0s', 'Timer should hit 0s on timeout');
  assert.equal(timeoutCount, 1, 'Case timeout onlyonce: onTimeoutLaunch must be called exactly once');

  hud.update(30000, 5.0);
  assert.equal(timeoutCount, 1, 'Case timeout onlyonce: subsequent ready updates past 0s must not re-trigger timeout');

  // Case 5: reset after timeout permits another timeout
  hud.reset();
  hud.update(30000, 0);
  assert.equal(timerTextEl.textContent, '20s', 'Case reset after timeout: resets timer to 20s');

  hud.update(50000, 20.0);
  assert.equal(timerTextEl.textContent, '0s', 'Timer should hit 0s after second timeout period');
  assert.equal(timeoutCount, 2, 'Case reset after timeout permits another timeout: second timeout fires callback');

  // Case 6: black turn resets
  hud.reset();
  hud.update(50000, 0);
  hud.update(58000, 8.0);
  assert.equal(timerTextEl.textContent, '12s', 'Timer decremented to 12s');

  turnRuntime.currentSide = 'black';
  hud.update(58000, 0);
  assert.equal(timerTextEl.textContent, '20s', 'Case black turn resets: switching to black turn resets timer to 20s');

  hud.update(68000, 10.0);
  assert.equal(timerTextEl.textContent, '10s', 'Timer decremented to 10s on black turn');

  turnRuntime.currentSide = 'white';
  hud.update(68000, 0);
  assert.equal(timerTextEl.textContent, '20s', 'Switching back to white turn resets timer to 20s');

  // Case 7: menu hide/show preserves remaining time
  hud.reset();
  hud.update(70000, 0);
  hud.update(77000, 7.0);
  assert.equal(timerTextEl.textContent, '13s', 'Timer at 13s before opening menu');

  menuVisible = true;
  hud.update(87000, 10.0);
  assert.equal(hud.element.style.display, 'none', 'Case menu hide/show: HUD container must be hidden when menu is open');

  menuVisible = false;
  hud.update(87000, 0);
  assert.equal(hud.element.style.display, 'flex', 'HUD container display must restore to flex when menu is closed');
  assert.equal(timerTextEl.textContent, '13s', 'Case menu hide/show preserves remaining time: elapsed time during menu is not counted');

  // Case 8: match-over update does not count
  hud.update(91000, 4.0);
  assert.equal(timerTextEl.textContent, '9s', 'Timer at 9s before match-over');

  turnRuntime.phase = 'match-over';
  hud.update(101000, 10.0);
  assert.equal(hud.element.style.display, 'none', 'Case match-over: HUD container hidden in match-over phase');

  turnRuntime.phase = 'ready';
  hud.update(101000, 0);
  assert.equal(hud.element.style.display, 'flex', 'HUD container restored in ready phase');
  assert.equal(timerTextEl.textContent, '9s', 'Case match-over update does not count: time in match-over phase did not count down');

  // Settling must not advertise a live deadline or count down.
  hud.reset();
  hud.update(0, 16);
  assert.equal(timerTextEl.textContent, '4s');
  turnRuntime.phase = 'settling';
  hud.update(0, 8);
  assert.equal(timerTextEl.textContent, '4s');
  assert.equal(timerTextEl.style.animation, 'none');
  const timerWrap = findDescendantByClass(hud.element, 'turn-hud-timer-wrap');
  assert.equal(timerWrap.style.display, 'none');
  const side = findDescendantByClass(hud.element, 'turn-hud-side');
  const { uiText } = await vite.ssrLoadModule('/src/ui-text.ts');
  assert.equal(side.textContent, uiText('settling'));
  turnRuntime.phase = 'ready';
  turnRuntime.currentSide = 'black';
  hud.update(0, 0);
  assert.equal(timerWrap.style.display, 'flex');
  assert.equal(timerTextEl.textContent, '20s');
  hud.destroy();
  console.log('PASS: turn-timer regression (initial20, elapse5=>15, reset same white=>20, timeout onlyonce, reset after timeout permits another timeout, black turn resets, menu hide/show preserves remaining time, match-over update does not count)');
} finally {
  await vite.close();
}
