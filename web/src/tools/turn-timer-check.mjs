import './headless-browser-env.mjs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// Extend minimal headless DOM stub for TurnHud tree traversal and queries
function createFakeElement(tag = 'div') {
  const children = [];
  let parent = null;
  const writes = { textContent: 0, innerHTML: 0, hidden: 0, style: 0 };
  const style = new Proxy({}, {
    set(target, key, value) {
      writes.style += 1;
      target[key] = value;
      return true;
    },
  });
  const element = {
    tagName: tag.toUpperCase(),
    style,
    writes,
    className: '',
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
  for (const [property, initial] of [['innerHTML', ''], ['textContent', ''], ['hidden', false]]) {
    let value = initial;
    Object.defineProperty(element, property, {
      get() { return value; },
      set(next) { writes[property] += 1; value = next; },
    });
  }
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
  let gameMode = 'stage';
  let mySide = 'white';
  let onlineReady = true;
  let timeoutCount = 0;

  const options = {
    getGameMode: () => gameMode,
    getMySide: () => mySide,
    isMenuVisible: () => menuVisible,
    isOnlineReady: () => onlineReady,
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
  const sideEl = findDescendantByClass(hud.element, 'turn-hud-side');
  const objectiveEl = findDescendantByClass(hud.element, 'mastery-hud-objective');
  const unchangedWrites = [timerTextEl, sideEl, objectiveEl, hud.element].map((el) => ({ ...el.writes }));
  for (let frame = 0; frame < 120; frame += 1) hud.update(frame * 16, 0);
  [timerTextEl, sideEl, objectiveEl, hud.element].forEach((el, index) => {
    assert.deepEqual(el.writes, unchangedWrites[index], 'Unchanged HUD fields must not be written every frame');
  });
  hud.update(1000, 0.1);
  assert.equal(timerTextEl.textContent, '20s', 'Subsecond elapsed time keeps the integer label');
  assert.equal(timerTextEl.writes.textContent, unchangedWrites[0].textContent, 'Smooth timer progress must not rewrite the same label');
  const progressFill = findDescendantByClass(hud.element, 'turn-hud-progress-track').children[0];
  assert.equal(progressFill.style.width, '99.5%', 'Subsecond timer progress keeps its one decimal precision');
  hud.reset();

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

  // A hidden iframe may return after a single long frame. Only the local side sends a shot.
  const { createTurnClock } = await vite.ssrLoadModule('/src/turn-clock.ts');
  const clock = createTurnClock();
  gameMode = 'online';
  turnRuntime.currentSide = 'white';
  hud.reset();
  hud.update(0, clock(0, 'game-1:white', true));
  hud.update(1000, clock(1000, 'game-1:white', true));
  assert.equal(timerTextEl.textContent, '19s');
  hud.update(25000, clock(25000, 'game-1:white', true));
  assert.equal(timerTextEl.textContent, '0s');
  assert.equal(timeoutCount, 3, 'One late frame triggers one local timeout shot');
  hud.update(26000, clock(26000, 'game-1:white', true));
  assert.equal(timeoutCount, 3, 'Subsequent frames do not repeat timeout shot');

  turnRuntime.currentSide = 'black';
  hud.update(27000, clock(27000, 'game-1:black', true));
  assert.equal(timerTextEl.textContent, '20s', 'New turn does not inherit elapsed time');
  hud.update(50000, clock(50000, 'game-1:black', true));
  assert.equal(timeoutCount, 3, 'Remote side cannot send a timeout shot');

  mySide = 'black';
  hud.reset();
  hud.update(51000, clock(51000, 'game-2:black', true));
  hud.update(72000, clock(72000, 'game-2:black', true));
  assert.equal(timeoutCount, 4, 'Black local side can send its timeout shot');
  hud.reset();
  onlineReady = false;
  hud.update(100000, 40);
  assert.equal(timeoutCount, 4, 'Connection wait cannot consume the timeout');
  onlineReady = true;
  hud.update(110000, 10);
  assert.equal(timerTextEl.textContent, '20s', 'Ready handshake begins with a full deadline');
  hud.update(115000, 5);
  assert.equal(timerTextEl.textContent, '15s');
  onlineReady = false;
  hud.update(140000, 25);
  onlineReady = true;
  hud.update(150000, 10);
  assert.equal(timerTextEl.textContent, '15s', 'Reconnection preserves the remaining deadline');
  hud.update(165000, 15);
  assert.equal(timeoutCount, 5, 'Resumed local turn times out once when eligible');

  const { tutorialManager } = await vite.ssrLoadModule('/src/tutorial.ts');
  const { I18nManager } = await vite.ssrLoadModule('/src/i18n.ts');
  const originalLanguage = I18nManager.getLanguage();
  gameMode = 'tutorial';
  tutorialManager.isActive = true;
  tutorialManager.tutorialType = 'basic';
  tutorialManager.currentStep = 1;
  hud.reset();
  hud.update(170000, 5);
  assert.equal(timerWrap.style.display, 'none', 'Basic tutorial hides its timer');
  assert.equal(timerTextEl.textContent, '20s', 'Basic tutorial does not consume time');
  I18nManager.setLanguage('en');
  hud.update(170000, 0);
  assert.equal(side.textContent, I18nManager.t('ingame.unlimited_time'), 'Language change refreshes cached side text');
  tutorialManager.tutorialType = 'advanced';
  tutorialManager.currentStep = tutorialManager.stepCount;
  hud.update(170000, 0);
  assert.equal(timerWrap.style.display, 'flex', 'Advanced tutorial match shows timer');
  assert.ok(side.innerHTML.includes(I18nManager.t('ingame.time_limited')), 'Tutorial phase change refreshes cached HTML');
  hud.update(171000, 1);
  assert.equal(timerTextEl.textContent, '19s', 'Advanced tutorial match keeps timer accuracy');
  I18nManager.setLanguage(originalLanguage);
  tutorialManager.isActive = false;
  hud.destroy();
  console.log('PASS: turn-timer regression (idempotent HUD writes, subsecond progress, timeout, side changes, menu, settling, tutorial and language)');
} finally {
  await vite.close();
}
