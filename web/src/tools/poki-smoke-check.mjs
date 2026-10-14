// Run after build:poki. Requires Playwright or PLAYWRIGHT_MODULE, like strike-hud-browser-check.
// Production boot/menu checks use dist-poki unchanged. Forced results and board counters use
// a temporary Poki build with observation-only hooks; no test API is shipped in dist-poki.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, createServer as createViteServer } from 'vite';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const webRoot = fileURLToPath(new URL('../..', import.meta.url));
const productionRoot = resolve(webRoot, 'dist-poki');
await readFile(join(productionRoot, 'index.html'));
const output = await mkdtemp(join(tmpdir(), 'poki-smoke-'));
const observedRoot = join(output, 'dist-poki');
const results = [];

function replaceOnce(code, marker, replacement) {
  assert.equal(code.split(marker).length, 2, `Observation marker changed: ${marker}`);
  return code.replace(marker, replacement);
}

function observationPlugin() {
  return {
    name: 'poki-smoke-observation', enforce: 'pre',
    transform(code, id) {
      const path = id.replaceAll('\\', '/');
      if (path.endsWith('/src/sound.ts')) {
        return `${code}\n(window as any).__pokiSmokeSound = () => adSoundMuted;`;
      }
      if (!path.endsWith('/src/main.ts')) return;
      code = replaceOnce(code, '    const baseOptions = requestedOptions ?? {',
        '    (window as any).__pokiSmokeBoards = ((window as any).__pokiSmokeBoards ?? 0) + 1;\n    const baseOptions = requestedOptions ?? {');
      return replaceOnce(code, '  await AdManager.showBanner();', `  await AdManager.showBanner();
  (window as any).__pokiSmoke = {
    snapshot: () => ({
      boards: (window as any).__pokiSmokeBoards ?? 0,
      mode: gameModeRuntime?.mode, stage: gameModeRuntime?.stageNumber, phase: turnRuntime.phase,
      ad: isAdActive(), blocked: inputRuntime.policy.isInputBlocked(),
      pendingLaunch: turnRuntime.pendingLaunch !== null,
      muted: (window as any).__pokiSmokeSound(),
      tutorialActive: tutorialManager.isActive, tutorialStep: tutorialManager.currentStep,
      tutorialToken: tutorialManager.sessionToken,
    }),
    finish: (winner: "white" | "black" = "white") => {
      if (gameModeRuntime?.mode === "weekly" && weeklyRun?.status === "ready-for-stage") weeklyRun.status = "playing";
      turnRuntime.phase = "match-over";
      turnRuntime.onMatchOver?.(winner);
    },
    stageResult: () => {
      turnRuntime.phase = "match-over";
      showStageRunResult(matchRuntime, gameModeRuntime!.stageNumber, 0, true, () => returnToMainMenu(menuRuntime));
    },
    puzzleWin: () => {
      if (!activePuzzle) throw new Error("No active puzzle");
      turnRuntime.phase = "match-over"; puzzleFinished = true;
      puzzleProgress = applyPuzzleEvaluation(puzzleProgress, activePuzzle, { status: "success", medal: 3 } as any).store;
      savePuzzleProgress(puzzleProgress);
      puzzleUI!.showResult(activePuzzle.puzzleId, { success: true, objectiveMet: true, goldMet: true, medal: 3 });
    },
    weeklyAutomaticWin: () => {
      if (!weeklyRun) throw new Error("No weekly run");
      // A real launch promotes ready-for-stage to playing; this fixture skips the shot.
      weeklyRun.status = "playing";
      finishWeeklyStage(weeklyRun, "white-win");
      weeklyRun.pendingOffer = null; weeklyRun.status = "ready-for-stage";
      turnRuntime.phase = "match-over"; turnRuntime.onMatchOver?.("white");
    },
    tutorialComplete: () => { turnRuntime.phase = "match-over"; tutorialManager.completeTutorial(); },
    tutorialSuccess: () => { void tutorialManager.handleStepSuccess(); },
    tutorialFailure: () => { turnRuntime.lastLaunchHitOpponent = false; turnRuntime.onTurnSettled?.(); },
    exit: () => returnToMainMenu(menuRuntime),
    reenterTutorial: async () => { await startModeAction!("tutorial", 1, "basic"); hideMainMenuAfterModeStart(menuRuntime); },
    tickTimer: () => turnHud.update(performance.now(), 120),
    eventsWhilePending: () => { gameplay.enter("test-pending"); gameplay.leave("test-pending"); },
    requestWhilePlaying: () => gameplay.beforeNewMatch(),
  };`);
    },
  };
}

await build({ root: webRoot, mode: 'poki', logLevel: 'error',
  plugins: [observationPlugin()], build: { outDir: observedRoot, emptyOutDir: true } });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm' };
const gameServer = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://local');
    const observed = url.pathname.startsWith('/observed/');
    const root = observed ? observedRoot : productionRoot;
    const prefix = observed ? '/observed/' : '/production/';
    assert.ok(url.pathname.startsWith(prefix));
    const file = resolve(root, decodeURIComponent(url.pathname.slice(prefix.length)) || 'index.html');
    assert.ok(file.startsWith(root + sep));
    response.setHeader('Content-Type', mime[extname(file)] ?? 'application/octet-stream');
    response.end(await readFile(file));
  } catch { response.statusCode = 404; response.end(); }
});
await new Promise(resolve => gameServer.listen(0, '127.0.0.1', resolve));
const gameOrigin = `http://127.0.0.1:${gameServer.address().port}`;
const parentServer = createServer((request, response) => {
  const source = new URL(request.url, 'http://local').searchParams.get('source');
  response.setHeader('Content-Type', 'text/html');
  response.end(`<body style="height:2000px;margin:0"><iframe title="game" allow="autoplay" src="${source}" style="border:0;width:836px;height:580px"></iframe></body>`);
});
await new Promise(resolve => parentServer.listen(0, '127.0.0.1', resolve));
const parentOrigin = `http://127.0.0.1:${parentServer.address().port}`;
const browser = await chromium.launch({ channel: process.env.QA_BROWSER_CHANNEL ?? 'msedge', headless: true });
let normalServer;
let current;

function sdkScript(initMode) {
  return `(() => {
    const trace = window.__pokiSdkTrace = [];
    const control = window.__pokiSdkControl = { mode: 'no-ad', pending: false };
    const record = (type) => {
      const menu = document.querySelector('.main-menu-overlay');
      trace.push({ type, pending: control.pending,
        interactive: !!menu && !menu.hidden && !menu.closest('[inert]') && !!menu.querySelector('[data-game-mode]:not(:disabled)'),
        boards: window.__pokiSmoke?.snapshot().boards });
    };
    window.PokiSDK = {
      init() { record('init');
        return ${initMode === 'reject' ? 'Promise.reject(new Error("expected init rejection"))' : initMode === 'late' ? 'new Promise(r => setTimeout(r, 6200))' : 'Promise.resolve()'};
      },
      gameLoadingFinished() { record('loadingFinished'); },
      gameplayStart() { record('start'); },
      gameplayStop() { record('stop'); },
      commercialBreak(onStart) {
        record('break'); control.pending = true;
        return new Promise((resolve, reject) => {
          control.start = () => { record('ad-start'); onStart(); };
          control.resolve = () => { record('ad-end'); control.pending = false; resolve(); };
          control.reject = () => { record('ad-reject'); control.pending = false; reject(new Error('expected ad rejection')); };
          if (control.mode === 'ad') control.start();
          else if (control.mode === 'no-ad') queueMicrotask(control.resolve);
          else if (control.mode === 'reject') queueMicrotask(control.reject);
        });
      },
    };
  })();`;
}

async function openGame({ observed = true, init = 'ok', normal = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  const errors = [], external = [];
  await context.addInitScript(() => localStorage.setItem('app_language', 'en'));
  const source = normal ? normalServer.resolvedUrls.local[0] : `${gameOrigin}/${observed ? 'observed' : 'production'}/`;
  await context.route('**/*', route => {
    const url = route.request().url();
    if (url === 'https://game-cdn.poki.com/scripts/v2/poki-sdk.js') {
      if (init === 'missing') return route.abort();
      return route.fulfill({ contentType: 'text/javascript', body: sdkScript(init) });
    }
    if ([gameOrigin, parentOrigin, new URL(source).origin].some(origin => url.startsWith(`${origin}/`))) return route.continue();
    external.push(url); return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !(init === 'missing' && message.text().includes('net::ERR_FAILED'))) errors.push(message.text());
  });
  const began = Date.now();
  await page.goto(`${parentOrigin}/?source=${encodeURIComponent(source)}`, { waitUntil: 'domcontentloaded' });
  const frame = page.frames().find(frame => frame.parentFrame() === page.mainFrame());
  assert.ok(frame, 'Game iframe loaded');
  await frame.waitForURL(url => url.href.startsWith(source));
  if (normal) await frame.locator('#btn-guest-submit').click();
  await frame.locator('.lobby-modes button:not([disabled])').first().waitFor({ timeout: 15000 });
  if (observed || normal) await frame.waitForFunction(() => !!window.__pokiSmoke);
  current = { context, page, frame, errors, external, elapsed: Date.now() - began };
  return current;
}

const trace = game => game.frame.evaluate(() => window.__pokiSdkTrace ?? []);
const snapshot = game => game.frame.evaluate(() => window.__pokiSmoke.snapshot());
async function startMode(game, mode) {
  const { frame } = game;
  if (mode === 'tutorial') {
    const toggle = frame.locator('#menu-tutorial-btn');
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    await frame.locator('[data-game-mode="tutorial"][data-tutorial-type="basic"]').click();
  } else if (mode === 'weekly') {
    await frame.locator('[data-open-weekly-challenge]').click();
    await frame.locator('[data-weekly-action="practice"]').first().click();
  } else {
    await frame.locator(`[data-game-mode="${mode}"]`).click();
    if (mode === 'stage') await frame.locator('#pve-start-btn').click();
    if (mode === 'hotseat') await frame.locator('[data-map-action="start"]').click();
    if (mode === 'puzzle') {
      await frame.locator('[data-puzzle-id]:not([disabled])').first().click();
      await frame.locator('[data-action="start"]').click();
    }
  }
  await frame.locator('.main-menu-overlay').waitFor({ state: 'hidden' });
}

async function finish(game, name) {
  const events = await trace(game);
  const transitions = events.filter(event => event.type === 'start' || event.type === 'stop');
  transitions.forEach((event, index) => {
    assert.equal(event.pending, false, `No gameplay event during ad: ${name}`);
    if (index) assert.notEqual(event.type, transitions[index - 1].type, `Alternating events: ${name}`);
  });
  assert.deepEqual(game.external, [], `Unexpected network: ${name}`);
  assert.deepEqual(game.errors, [], `Browser errors: ${name}`);
  results.push({ name, events, errors: game.errors, external: game.external });
  console.log(`PASS ${name}`);
  await game.context.close(); current = null;
}

async function waitForAd(game, boards) {
  await game.frame.waitForFunction(() => window.__pokiSmoke.snapshot().ad && document.querySelector('#app').inert);
  const state = await snapshot(game);
  assert.equal(state.boards, boards, 'No new board before SDK settles');
  assert.equal(state.blocked, true); assert.equal(state.muted, true);
  assert.equal(state.phase, 'match-over');
  const before = await trace(game);
  await game.frame.evaluate(() => { window.__pokiSmoke.eventsWhilePending(); window.__pokiSmoke.tickTimer(); });
  await game.page.waitForTimeout(100);
  const after = await snapshot(game);
  assert.equal(after.boards, boards); assert.equal(after.pendingLaunch, false);
  assert.deepEqual(await trace(game), before, 'No events while ad pending');
}

async function waitForNewBoard(game, boards) {
  await game.frame.waitForFunction(boards => {
    const s = window.__pokiSmoke.snapshot(); return s.boards === boards + 1 && !s.ad;
  }, boards);
  assert.equal((await snapshot(game)).muted, false);
  assert.equal(await game.frame.locator('#app').evaluate(app => app.inert), false);
}

try {
  // Real, unmodified production output.
  let game = await openGame({ observed: false });
  assert.equal(await game.frame.evaluate(() => window.__pokiSmoke), undefined, 'No observation API in production');
  let events = await trace(game);
  assert.deepEqual(events.map(e => e.type), ['init', 'loadingFinished']);
  assert.equal(events[1].interactive, false, 'Loading reported before menu activation');
  await startMode(game, 'hotseat');
  assert.deepEqual((await trace(game)).map(e => e.type), ['init', 'loadingFinished', 'start']);
  await game.frame.locator('.return-menu-button').click();
  await game.frame.locator('[data-menu-cancel]').click();
  assert.deepEqual((await trace(game)).map(e => e.type).slice(-2), ['stop', 'start']);
  assert.equal((await trace(game)).some(e => e.type === 'break'), false);
  await game.frame.locator('.return-menu-button').click();
  await game.frame.locator('[data-menu-confirm]').click();
  await game.frame.locator('.lobby-modes button:not([disabled])').first().waitFor();
  await startMode(game, 'hotseat');
  assert.deepEqual((await trace(game)).map(e => e.type).slice(-3), ['break', 'ad-end', 'start']);
  await finish(game, 'production: init/loading/menu, first match, confirm stop/start, menu/new-match ad');

  for (const init of ['missing', 'reject', 'late']) {
    game = await openGame({ observed: false, init });
    assert.ok(game.elapsed < 10000, 'SDK failure must not block boot');
    await startMode(game, 'hotseat');
    if (init === 'late') await game.page.waitForTimeout(1500);
    assert.deepEqual((await trace(game)).map(e => e.type), init === 'missing' ? [] : ['init']);
    await finish(game, `production: SDK ${init}, playable without lifecycle (${game.elapsed} ms boot)`);
  }

  game = await openGame(); await startMode(game, 'hotseat');
  for (const mode of ['ad', 'delayed', 'reject', 'no-ad', 'reject-after-start']) {
    await game.frame.evaluate(() => window.__pokiSmoke.finish('white'));
    await game.frame.locator('[data-match-restart]').waitFor();
    const boards = (await snapshot(game)).boards;
    await game.frame.evaluate(mode => { window.__pokiSdkControl.mode = mode === 'reject-after-start' ? 'ad' : mode; }, mode);
    await game.frame.locator('[data-match-restart]').click();
    if (['ad', 'delayed', 'reject-after-start'].includes(mode)) {
      await waitForAd(game, boards);
      if (mode === 'delayed') {
        await game.page.waitForTimeout(1300);
        await waitForAd(game, boards);
        await game.frame.evaluate(() => window.__pokiSdkControl.start());
      }
      await game.frame.evaluate(reject => window.__pokiSdkControl[reject ? 'reject' : 'resolve'](), mode === 'reject-after-start');
    }
    await waitForNewBoard(game, boards);
    await game.frame.locator('[data-match-restart]').waitFor({ state: 'hidden' });
    console.log(`PASS hotseat restart ${mode}: SDK settles before board, input/audio restored`);
  }
  const count = (await trace(game)).length;
  await game.frame.evaluate(() => window.__pokiSmoke.requestWhilePlaying());
  assert.equal((await trace(game)).length, count, 'Active gameplay cannot request an ad');
  await game.frame.locator('.return-menu-button').click();
  const pausedStarts = (await trace(game)).filter(e => e.type === 'start').length;
  await game.frame.evaluate(() => window.__pokiSmoke.finish('white'));
  await game.frame.locator('[data-menu-cancel]').dispatchEvent('click');
  assert.equal((await trace(game)).filter(e => e.type === 'start').length, pausedStarts, 'A result invalidates the paused match resume');
  await finish(game, 'ad/no-ad/delayed/rejections, board barrier, mute/input, active invariant');

  game = await openGame(); await startMode(game, 'stage');
  await game.frame.evaluate(() => window.__pokiSmoke.finish('white'));
  let boards = (await snapshot(game)).boards;
  await game.frame.locator('.upgrade-card').first().click();
  await waitForNewBoard(game, boards); assert.equal((await snapshot(game)).stage, 2);
  await game.frame.evaluate(() => window.__pokiSmoke.stageResult());
  assert.equal((await trace(game)).at(-1).type, 'stop');
  await finish(game, 'stage card next and stage-run result');

  game = await openGame(); await startMode(game, 'hotseat');
  await game.frame.evaluate(() => window.__pokiSmoke.exit());
  boards = (await snapshot(game)).boards;
  await game.frame.locator('[data-open-weekly-challenge]').click();
  await game.frame.evaluate(() => { window.__pokiSdkControl.mode = 'ad'; });
  await game.frame.locator('[data-weekly-action="practice"]').first().click();
  await waitForAd(game, boards);
  assert.equal(await game.frame.locator('.weekly-modal').evaluate(modal => modal.inert), true);
  await game.frame.evaluate(() => window.__pokiSdkControl.resolve());
  await game.frame.locator('.weekly-modal').waitFor({ state: 'detached' });
  await waitForNewBoard(game, boards);
  await game.frame.evaluate(() => { window.__pokiSdkControl.mode = 'no-ad'; });
  await game.frame.evaluate(() => window.__pokiSmoke.finish('white'));
  await game.frame.locator('.upgrade-card').first().waitFor();
  boards = (await snapshot(game)).boards;
  await game.frame.locator('.upgrade-card').first().click();
  await waitForNewBoard(game, boards);
  assert.deepEqual((await trace(game)).map(e => e.type).slice(-3), ['break', 'ad-end', 'start']);
  await game.frame.evaluate(() => window.__pokiSmoke.finish('white'));
  await game.frame.locator('.upgrade-card').first().waitFor();
  // Reload preserves the pending local offer. It must not count as an interactive first match.
  await game.page.reload({ waitUntil: 'domcontentloaded' });
  game.frame = game.page.frames().find(frame => frame.parentFrame() === game.page.mainFrame());
  await game.frame.waitForFunction(() => !!window.__pokiSmoke);
  await startMode(game, 'weekly');
  await game.frame.locator('.upgrade-card').first().waitFor();
  assert.deepEqual((await trace(game)).map(e => e.type), ['init', 'loadingFinished']);
  boards = (await snapshot(game)).boards;
  await game.frame.locator('.upgrade-card').first().click();
  await waitForNewBoard(game, boards);
  events = await trace(game); boards = (await snapshot(game)).boards;
  await game.frame.evaluate(() => window.__pokiSmoke.weeklyAutomaticWin());
  await waitForNewBoard(game, boards);
  assert.deepEqual(await trace(game), events, 'Automatic weekly continuation is one session');
  await finish(game, 'weekly modal block/card next/restored offer/first match/automatic continuation');

  game = await openGame(); await startMode(game, 'puzzle');
  for (let hint = 0; hint < 3; hint++) await game.frame.locator('[data-action="hint"]').click();
  assert.deepEqual((await trace(game)).map(e => e.type).slice(-2), ['stop', 'start']);
  assert.equal((await trace(game)).some(e => e.type === 'break'), false);
  boards = (await snapshot(game)).boards;
  await game.frame.locator('[data-action="restart"]').click(); await waitForNewBoard(game, boards);
  assert.deepEqual((await trace(game)).map(e => e.type).slice(-4), ['stop', 'break', 'ad-end', 'start']);
  await game.frame.evaluate(() => window.__pokiSmoke.puzzleWin());
  boards = (await snapshot(game)).boards;
  await game.frame.locator('[data-action="retry"]').click(); await waitForNewBoard(game, boards);
  await game.frame.evaluate(() => window.__pokiSmoke.puzzleWin());
  boards = (await snapshot(game)).boards;
  await game.frame.locator('[data-action="next"]').click();
  await game.frame.locator('[data-action="start"]').click(); await waitForNewBoard(game, boards);
  const starts = (await trace(game)).filter(e => e.type === 'start').length;
  await game.frame.locator('[data-action="library"]').click();
  await game.frame.locator('[data-screen="library"]').waitFor();
  assert.equal((await trace(game)).filter(e => e.type === 'start').length, starts);
  assert.equal((await trace(game)).at(-1).type, 'stop');
  await finish(game, 'puzzle hint/restart/result/retry/next/library');

  game = await openGame(); await startMode(game, 'tutorial');
  await game.frame.evaluate(() => window.__pokiSmoke.tutorialComplete());
  assert.equal((await trace(game)).at(-1).type, 'stop');
  boards = (await snapshot(game)).boards;
  await game.frame.locator('#btn-tutorial-accept-adv').click(); await waitForNewBoard(game, boards);
  assert.deepEqual((await trace(game)).map(e => e.type).slice(-3), ['break', 'ad-end', 'start']);
  await finish(game, 'tutorial complete/advanced accept');

  normalServer = await createViteServer({ root: webRoot, logLevel: 'error', plugins: [observationPlugin()],
    server: { host: '127.0.0.1', port: 0, hmr: false } });
  await normalServer.listen();
  for (const normal of [false, true]) {
    game = await openGame({ normal }); await startMode(game, 'tutorial');
    boards = (await snapshot(game)).boards; events = await trace(game);
    await game.frame.evaluate(() => window.__pokiSmoke.tutorialSuccess());
    await game.frame.waitForFunction(boards => window.__pokiSmoke.snapshot().boards === boards + 1, boards);
    assert.deepEqual(await trace(game), events, 'Automatic tutorial step keeps its session');
    for (const kind of ['tutorialSuccess', 'tutorialFailure']) {
      await game.frame.evaluate(async kind => { window.__pokiSmoke[kind](); await window.__pokiSmoke.exit(); }, kind);
      boards = (await snapshot(game)).boards;
      await game.page.waitForTimeout(1450);
      assert.equal((await snapshot(game)).boards, boards, 'Exited tutorial callback cannot rebuild a board');
      await startMode(game, 'tutorial');
      await game.frame.evaluate(async kind => {
        window.__pokiSmoke[kind](); await window.__pokiSmoke.exit(); await window.__pokiSmoke.reenterTutorial();
      }, kind);
      boards = (await snapshot(game)).boards;
      const token = (await snapshot(game)).tutorialToken;
      await game.page.waitForTimeout(1450);
      assert.equal((await snapshot(game)).boards, boards, 'Previous session cannot rebuild a new tutorial');
      assert.equal((await snapshot(game)).tutorialToken, token);
    }
    await finish(game, `${normal ? 'normal dev' : 'poki'}: continuous step, stale success/retry after exit/re-entry`);
  }
  await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`PASS Poki smoke: ${results.length} scenario groups; ${output}`);
} catch (error) {
  if (current) {
    console.error(JSON.stringify({ errors: current.errors, external: current.external, events: await trace(current) }));
    await current.page.screenshot({ path: join(output, 'failure.png') });
  }
  throw error;
} finally {
  await browser.close();
  await normalServer?.close();
  await new Promise(resolve => gameServer.close(resolve));
  await new Promise(resolve => parentServer.close(resolve));
}
