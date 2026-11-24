// Execute the actual main.ts draw callback and solo replay transaction with UI doubles.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { createServer } from 'vite';
import { parseAst } from '../../node_modules/rolldown/dist/parse-ast-index.mjs';
import './headless-browser-env.mjs';

const vite = await createServer({ configFile: false, envFile: false, root: process.cwd(), logLevel: 'error', optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, ws: false } });
try {
  const source = stripTypeScriptTypes(await readFile(new URL('../main.ts', import.meta.url), 'utf8'), { mode: 'strip' });
  const tree = parseAst(source);
  let callback, prepare;
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression' && node.callee?.name === 'setMatchOverHandler') callback = node.arguments[1];
    if (node.type === 'VariableDeclarator' && node.id?.name === 'prepareSoloRunBoard') prepare = node.init;
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value === 'object') walk(value);
  }
  walk(tree);
  assert.ok(callback, 'main.ts result callback exists');
  assert.ok(prepare, 'main.ts solo replay transaction exists');
  const callbackCode = source.slice(callback.start, callback.end);
  const prepareCode = source.slice(prepare.start, prepare.end);
  const platform = await vite.ssrLoadModule('/src/platform.ts');
  platform.PLATFORM.id = 'itch'; platform.PLATFORM.features.solo = true;
  const cards = await vite.ssrLoadModule('/src/cards.ts');
  const meta = await vite.ssrLoadModule('/src/meta.ts');
  const solo = await vite.ssrLoadModule('/src/solo-run.ts');
  const noop = () => {};

  for (let stage = 1; stage <= 10; stage++) {
    let run = solo.createSoloRun(null, 1);
    for (let cleared = 1; cleared < stage; cleared++) {
      run = solo.recordSoloRunResult(run, 'white');
      run = solo.chooseSoloRunCard(run, run.offer.choices[0]);
      run = solo.readySoloRun(run);
    }
    const runCards = cards.cloneRunCardState(run.cards), points = { ...run.points };
    const storage = new Map();
    const store = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
    let saves = 0, settlements = 0, rewards = 0, boardReject = false;
    const shown = [], boards = [], entered = [];
    const matchRuntime = { winner: null, actionStatus: { hidden: true, textContent: '' } };
    const gameModeRuntime = { mode: 'stage', stageNumber: stage };
    const bindings = {
      PLATFORM: platform.PLATFORM, initialSoloRun: run, shown, persistSoloRun: next => { saves++; assert.equal(solo.saveSoloRun(next, store), true); },
      gameModeRuntime, matchRuntime, inputRuntime: {}, turnRuntime: {}, progressStorage: { owner: null },
      lockInputForMatchOver: noop, marketingRuntime: { endMatch: noop, startLocalMatch: noop }, gameplay: { enter: event => entered.push(event) },
      metaRuntime: { state: { points: 100 }, storage: {} }, runCardState: runCards, stageRunPoints: points,
      recordSoloRunResult: solo.recordSoloRunResult, retrySoloRun: solo.retrySoloRun, readySoloRun: solo.readySoloRun,
      countRemainingPieces: () => ({ white: 3, black: 2 }), soloLastShot: undefined,
      resetBoard: async options => { if (boardReject) throw Error('board failed'); boards.push(options); },
      setStageNumber: (runtime, number) => { runtime.stageNumber = number; }, ensureGameLoopStarted: noop,
      hideMatchResult: runtime => { runtime.winner = null; }, soloRunText: key => key,
      returnToMainMenu: async () => {}, menuRuntime: { visible: false, returnButton: {} },
      clearStageTip: noop, onlineRuntime: null, weeklyRun: null, questRun: null, masteryRun: null,
      writeSoloCheckpoint: () => { throw Error('active solo draw used legacy checkpoint'); },
      settleStageRunPoints: () => { settlements++; }, recordStageRunClear: () => { rewards++; },
    };
    const factory = new Function(...Object.keys(bindings), `
      let soloRun = initialSoloRun, soloActionPending = false;
      const currentSoloRun = () => soloRun;
      const commitSoloRun = next => { soloRun = next; persistSoloRun(next); };
      const restoreSoloBoundary = () => { Object.assign(runCardState, soloRun.cards); Object.assign(stageRunPoints, soloRun.points); };
      const presentSoloRun = () => { matchRuntime.winner = 'draw'; shown.push({ run: structuredClone(soloRun), onReplay: prepareSoloRunBoard, onMenu: () => returnToMainMenu(menuRuntime) }); };
      const prepareSoloRunBoard = ${prepareCode};
      return { result: ${callbackCode}, currentSoloRun };
    `);
    const { result, currentSoloRun } = factory(...Object.values(bindings));
    result('draw');
    assert.equal(shown.length, 1, `stage ${stage}: result shown`);
    assert.equal(saves, 1); assert.equal(settlements, 0); assert.equal(rewards, 0);
    assert.equal(currentSoloRun().phase, 'stage-result'); assert.equal(currentSoloRun().result.winner, 'draw');
    assert.equal(currentSoloRun().stage, stage);
    assert.deepEqual(runCards, run.cards); assert.deepEqual(points, run.points); assert.equal(bindings.metaRuntime.state.points, 100);
    assert.deepEqual(solo.readSoloRun(null, store).run, currentSoloRun(), 'draw survives reload');
    result('draw'); assert.equal(shown.length, 1); assert.equal(saves, 1);
    boardReject = true;
    await assert.rejects(shown[0].onReplay(), /board failed/);
    assert.equal(matchRuntime.winner, 'draw'); assert.equal(currentSoloRun().phase, 'stage-ready');
    assert.deepEqual(solo.readSoloRun(null, store).run, currentSoloRun(), 'failed reset retains retryable run');
    assert.deepEqual(runCards, run.cards); assert.deepEqual(points, run.points);
    boardReject = false;
    await shown.at(-1).onReplay();
    assert.deepEqual(boards, [{ gameMode: 'stage', stageNumber: stage }]);
    assert.equal(matchRuntime.winner, null); assert.equal(currentSoloRun().phase, 'stage-ready');
    assert.deepEqual(runCards, run.cards); assert.deepEqual(points, run.points);
    assert.equal(settlements, 0); assert.equal(rewards, 0);
    assert.deepEqual(entered, ['solo-stage-retry']);
    result('draw'); assert.equal(shown.length, 3);
    await shown.at(-1).onMenu();
    assert.equal(solo.readSoloRun(null, store).run.stage, stage);
  }

  // The solo platform can still have no v3 run, for example with an old checkpoint.
  for (let stage = 1; stage <= 10; stage++) {
    const runCards = cards.createRunCardState(), points = meta.createStageRunPointState(1);
    for (let cleared = 1; cleared < stage; cleared++) {
      cards.applyCardPick(runCards, ['weight', 'force', 'size'][(cleared - 1) % 3]);
      meta.recordStageRunClear(points, cleared);
    }
    const snapshot = { cards: structuredClone(runCards), points: { ...points } };
    let checkpoints = 0, settlements = 0, rewards = 0, shown = 0;
    const bindings = {
      PLATFORM: platform.PLATFORM, soloRun: null, gameModeRuntime: { mode: 'stage', stageNumber: stage },
      matchRuntime: { winner: null }, inputRuntime: {}, turnRuntime: {}, onlineRuntime: null,
      lockInputForMatchOver: noop, marketingRuntime: { endMatch: noop }, gameplay: { enter: noop },
      metaRuntime: { state: { points: 100 }, storage: {} }, runCardState: runCards, stageRunPoints: points,
      progressStorage: { owner: null }, menuRuntime: { returnButton: {} },
      questRun: null, masteryRun: null, weeklyRun: null, clearStageTip: noop,
      writeSoloCheckpoint: (_owner, value) => { assert.equal(value, null); checkpoints++; },
      settleStageRunPoints: () => { settlements++; return 0; }, recordStageRunClear: () => { rewards++; },
      renderMainMenu: noop, restartStageRun: noop, showStageRunResult: (_runtime, resultStage, _payout, complete, _onMenu, winner) => {
        assert.equal(resultStage, stage); assert.equal(complete, false); assert.equal(winner, 'draw'); shown++;
      },
    };
    const result = new Function(...Object.keys(bindings), `return ${callbackCode};`)(...Object.values(bindings));
    result('draw');
    assert.equal(checkpoints, 1); assert.equal(settlements, 1); assert.equal(rewards, 0); assert.equal(shown, 1);
    assert.deepEqual(runCards, snapshot.cards); assert.deepEqual(points, snapshot.points);
    assert.equal(bindings.metaRuntime.state.points, 100);
  }
  console.log('PASS actual solo draw callback: active and null run, stages 1-10, duplicate result, persisted retry, reset failure/retry, no card or point reward.');
} finally { await vite.close(); }
