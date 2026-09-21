// Local QA only: real domain/storage modules, in-memory browser storage, no server.
import './headless-browser-env.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
globalThis.sessionStorage = new (localStorage.constructor)();
globalThis.BroadcastChannel = undefined;
const vite = await createServer({ configFile: false, logLevel: 'error', server: { middlewareMode: true, hmr: false } });
let checks = 0;
function check(name, fn) { fn(); checks++; console.log('PASS ' + name); }
try {
  const model = await vite.ssrLoadModule('/src/quest-model.ts');
  const events = await vite.ssrLoadModule('/src/quest-events.ts');
  const evals = await vite.ssrLoadModule('/src/quest-evaluator.ts');
  const { QuestStorage } = await vite.ssrLoadModule('/src/quest-storage.ts');
  const { WeeklyChallengeStorage } = await vite.ssrLoadModule('/src/weekly-challenge-storage.ts');
  const defs = await vite.ssrLoadModule('/src/weekly-challenge-definition.ts');
  const runs = await vite.ssrLoadModule('/src/weekly-challenge-run.ts');
  const at = '2026-09-19T12:00:00.000Z', periods = model.makeLocalPeriods(new Date(at));
  const before = model.makeLocalPeriods(new Date('2026-09-20T19:59:59.999Z'));
  const after = model.makeLocalPeriods(new Date('2026-09-20T20:00:00.000Z'));
  check('Monday 05:00 KST rolls daily and weekly', () => { for (const cadence of ['daily','weekly']) assert.notEqual(before.find(p=>p.cadence===cadence).periodId,after.find(p=>p.cadence===cadence).periodId); });
  let progress = evals.materializeQuestProgress(periods, [], new Date(at));
  const apply = event => { progress = evals.applyQuestEvent(progress, periods, event, new Date(at)); };
  const count = id => evals.questProgressCount(progress.find(p=>p.questId===id));
  const win = events.makePveWinEvent(crypto.randomUUID(),1,periods,at); apply(win); apply(win);
  check('Duplicate win counted once in both cadences',()=>{assert.equal(count('daily-wins'),1);assert.equal(count('weekly-wins'),1);});
  apply(events.makePveWinEvent(crypto.randomUUID(),1,periods,at));
  check('Daily win completes at two; weekly remains active',()=>{assert.equal(progress.find(p=>p.questId==='daily-wins').status,'completed');assert.equal(count('weekly-wins'),2);});
  for (let i=0;i<5;i++) apply(events.makePuzzleClearEvent(crypto.randomUUID(),'P01',1,3,periods,at));
  check('Repeated puzzle counts clears but not distinct or distinct gold',()=>{assert.equal(count('weekly-puzzle-clears'),5);assert.equal(count('weekly-distinct-puzzles'),1);assert.equal(count('weekly-distinct-gold-puzzles'),1);});
  for (const pieceType of model.QUEST_PIECE_TYPES) apply(events.makePieceLaunchEvent({source:'tutorial',runId:crypto.randomUUID(),launchOrdinal:1,pieceType},periods,at));
  check('Six distinct piece types complete weekly',()=>assert.equal(count('weekly-piece-types'),6));
  const store = new QuestStorage(); await store.activate(null,null);
  const ctx = store.captureContext(); store.enqueue(events.makePveWinEvent(crypto.randomUUID(),1,ctx.periods,ctx.occurredAt));
  await store.activate(null,null);
  check('Guest progress survives activation',()=>assert.equal(evals.questProgressCount(store.view().progress.find(p=>p.questId==='daily-wins')),1));
  await store.activate(null,'synthetic-qa-account');
  check('Guest and account caches are isolated',()=>assert.equal(evals.questProgressCount(store.view().progress.find(p=>p.questId==='daily-wins')),0));
  store.suspend();
  const definition = await defs.createFallbackPracticeDefinition(new Date(at));
  const run = runs.createPracticeRun(definition);
  for (let stage=1;stage<=10;stage++) { run.status='playing'; runs.countWeeklySettledTurn(run,'white'); runs.countWeeklySettledTurn(run,'black'); runs.finishWeeklyStage(run,'white-win'); if(run.pendingOffer) runs.pickWeeklyCard(run,run.pendingOffer.choices[0]); }
  check('Ten-stage completion and only own settled turns counted',()=>{assert.equal(run.status,'finished');assert.deepEqual(run.score,{completedStages:10,completedStageOwnTurns:10});});
  const loss = runs.createPracticeRun(definition);loss.status='playing';loss.stageOwnTurns=7;runs.finishWeeklyStage(loss,'black-win');
  check('Failed-stage turns excluded',()=>assert.deepEqual(loss.score,{completedStages:0,completedStageOwnTurns:0}));
  check('Score ordering: stages first, fewer turns second',()=>{assert.ok(runs.compareWeeklyScores({completedStages:2,completedStageOwnTurns:100},{completedStages:1,completedStageOwnTurns:1})>0);assert.ok(runs.compareWeeklyScores({completedStages:2,completedStageOwnTurns:10},{completedStages:2,completedStageOwnTurns:11})>0);});
  const weekly = new WeeklyChallengeStorage();await weekly.activate(null,null);
  const selected = weekly.view().localDefinitions[0];await weekly.ensurePractice(selected);
  weekly.updatePractice(r=>{r.stage=4;r.score={completedStages:3,completedStageOwnTurns:12};r.status='playing';});
  const restarted=await weekly.ensurePractice(selected);
  check('Observed: practice action restarts in-stage run at stage one',()=>assert.equal(restarted.stage,1));
  check('Personal best survives restart',()=>assert.equal(weekly.view().localRecords[0].completedStages,3));
  let rpcCalls=0;const fake={rpc:async()=>{rpcCalls++;return {error:{code:'NETWORK_ERROR'}};}};
  await weekly.activate(fake,'synthetic-qa-account');await weekly.refreshAtBoundary();
  check('Missing snapshot can retry at boundary',()=>{assert.equal(weekly.view().syncState,'offline');assert.equal(rpcCalls,2);});
  console.log(`Completed ${checks} local checks; no production RPCs made.`);
} finally { await vite.close(); }
