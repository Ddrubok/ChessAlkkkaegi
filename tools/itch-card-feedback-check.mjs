import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';
import '../web/src/tools/headless-browser-env.mjs';

const vite = await createServer({ root: fileURLToPath(new URL('../web/', import.meta.url)), configFile: false, logLevel: 'error', optimizeDeps:{noDiscovery:true,include:[]}, server: { middlewareMode: true, hmr:false, ws:false } });
try {
  const cards = await vite.ssrLoadModule('/src/cards.ts');
  const { presentCard } = await vite.ssrLoadModule('/src/crazygames-progression.ts');
  const state = cards.createRunCardState();
  const first = Array.from({ length: 10 }, (_, index) => cards.drawUpgradeCards(index + 1, state))
    .flat().find(card => card.id === 'weight');
  assert.ok(first, 'a displayed weight card should appear in deterministic draws');
  const weight = first;
  assert.match(presentCard(weight, 'en').bonusChange, /^\+0% → \+\d+%$/);
  const initial = presentCard(weight, 'en', { before: 0.05, after: 0.08 });
  assert.equal(initial.bonusChange, '+5% → +8%');
  assert.match(initial.tradeoff, /speed.*same/i);
  assert.doesNotMatch(`${initial.effect} ${initial.tradeoff}`, /shorter travel|distance decrease|edge resistance/i);
  assert.equal(initial.detail, null);
  assert.match(initial.scope, /next stage/i);
  const capped = presentCard(weight, 'en', { before: 0.08, after: 0.08, appliedValues: [{ piece: 'Pawn', stat: 'mass', before: 2, after: 2, unit: 'kg' }] });
  assert.equal(capped.noEffect, true);
  assert.deepEqual(capped.appliedValues, ['Pawn mass: 2kg → 2kg']);
  const giant = presentCard(cards.UPGRADE_CARDS.find(card => card.id === 'giantPawn'), 'en', { pawnsLost: 2 });
  assert.match(giant.tradeoff, /2 pawns removed/);
  assert.match(giant.detailTitle, /Which pawns/);
  assert.doesNotMatch(giant.tradeoff, /4 pawns/);
  const prone = presentCard(cards.UPGRADE_CARDS.find(card => card.id === 'proneStart'), 'ko');
  assert.match(prone.detail, /보장되지/);
  const { showSoloDrawResult, showMatchResult } = await vite.ssrLoadModule('/src/match.ts');
  const platform = await vite.ssrLoadModule('/src/platform.ts');
  platform.PLATFORM.features.solo = true;
  const node = (tag = 'div') => {
    const classes = new Set();
    return {
      tag, hidden: true, disabled: false, textContent: '', children: [], handlers: {},
      classList: { add(value) { classes.add(value); }, remove(value) { classes.delete(value); }, toggle(value, on) { if (on) classes.add(value); else classes.delete(value); } },
      replaceChildren(...children) { this.children = children; }, append(...children) { this.children.push(...children); },
      get firstElementChild() { return this.children[0] ?? null; }, setAttribute() {},
      querySelectorAll(selector) { const found = []; const visit = item => { for (const child of item.children) { if (selector === 'button' && child.tag === 'button') found.push(child); visit(child); } }; visit(this); return found; },
      querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; },
      addEventListener(event, handler) { this.handlers[event] = handler; }, click() { this.handlers.click?.(); },
      focus() { this.focused = true; }, animate() { return { cancel() {}, addEventListener() {} }; },
    };
  };
  document.createElement = tag => node(tag);
  const runtime = {
    overlay: node(), resultKicker: node(), winnerHeading: node(), resultDetails: node(),
    cardChoices: node(), restartButton: node(), menuButton: node(), actionStatus: node(),
    winner: null, restarting: false, onCardSelected: null, onReturnToMenu: null, onRestart: async () => {},
  };
  let replayed = 0; let menu = 0;
  showSoloDrawResult(runtime, 4, async () => { replayed++; }, async () => { menu++; });
  assert.equal(runtime.winner, 'draw');
  assert.equal(runtime.cardChoices.hidden, true);
  assert.equal(runtime.restartButton.hidden, false);
  assert.equal(runtime.menuButton.hidden, false);
  assert.equal(runtime.restartButton.focused, true);
  assert.match(runtime.resultDetails.children[0].textContent, /4/);
  await runtime.onRestart(); await runtime.onReturnToMenu();
  assert.equal(replayed, 1); assert.equal(menu, 1);
  let attempts = 0;
  showMatchResult(runtime, 'white', 'stage', 3, async () => {},
    [weight, cards.UPGRADE_CARDS.find(card => card.id === 'giantPawn'), cards.UPGRADE_CARDS.find(card => card.id === 'proneStart')],
    async () => { if (++attempts === 1) throw new Error('test retry'); }, null, null,
    { weight: { before: .05, after: .08 }, giantPawn: { pawnsLost: 2 } });
  assert.equal(runtime.cardChoices.children.length, 3);
  assert.equal(runtime.cardChoices.children.filter(item => item.children.some(child => child.tag === 'details')).length, 2);
  const [weightButton] = runtime.cardChoices.querySelectorAll('button');
  assert.match(weightButton.children.map(item => item.textContent).join(' '), /\+5% → \+8%/);
  const priorError = console.error; const errors = [];
  console.error = message => errors.push(message);
  weightButton.click(); weightButton.click();
  await new Promise(resolve => setImmediate(resolve));
  console.error = priorError;
  assert.equal(attempts, 1);
  assert.equal(errors.length, 1);
  assert.equal(runtime.restarting, false);
  assert.equal(weightButton.disabled, false);
  weightButton.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(attempts, 2);
  console.log('PASS card copy, replacement previews, dynamic pawns, special details, draw DOM, once-only selection and retry');
} finally {
  await vite.close();
}
