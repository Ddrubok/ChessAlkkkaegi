import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

// Execute the actual application presenters with the real run model; WebGL and network are substitutes.
const source = await readFile(new URL('../main.ts', import.meta.url), 'utf8');
const begin = source.indexOf('  let soloConfirmedPayout:');
const end = source.indexOf('  menuRuntime.onEndSoloRun = ', begin);
assert(begin >= 0 && end > begin);
const vite = await createServer({ root: fileURLToPath(new URL('../..', import.meta.url)), configFile:false,
  define:{__CRAZYGAMES_BUILD__:true,__ITCH_BUILD__:false,__POKI_BUILD__:false},
  logLevel:'error',server:{middlewareMode:true,hmr:false,ws:false} });
try {
  const model = await vite.ssrLoadModule('/src/solo-run.ts');
  const cards = await vite.ssrLoadModule('/src/cards.ts');
  const stage = await vite.ssrLoadModule('/src/stage.ts');
  const { PIECE_INSTANCES } = await vite.ssrLoadModule('/src/layout.ts');
  const { finalCardValues } = await vite.ssrLoadModule('/src/feedback-card-preview.ts');
  const meta=JSON.parse(await readFile(new URL('../../public/assets/chess-set.meta.json',import.meta.url),'utf8'));
  let resets=0, starts=0, settlements=0, displayed=null, pick=null, previews=null, failPrepare=false, shownHumanShot;
  const context = {
    ...model, ...cards, ...stage, PIECE_INSTANCES, finalCardValues,
    assets:{meta},physicsRuntime:{pieces:new Map()},cardTuningRuntime:{settings:{}},
    createCardEffectTuning:()=>undefined,I18nManager:{getLanguage:()=>'en'},
    soloRun: model.createSoloRun(null,1,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    soloActionPending:false, soloLookupPending:false, soloSaved:true,
    soloLastShot:undefined, soloLastHumanShot:undefined,
    progressStorage:{owner:null, lookupSoloRunSettlement:async()=>({status:'unpaid'}),
      settleSoloRun:async()=>{settlements++;return {status:'paid',payout:1};}},
    tuningRuntime:{settings:{cardEffectScale:1}}, gameModeRuntime:{stageNumber:1,mode:'hotseat'},
    menuRuntime:{visible:false}, turnRuntime:{phase:'ready'},inputRuntime:{},
    matchRuntime:{overlay:{hidden:true,dataset:{}},menuButton:{},restartButton:{},winnerHeading:{},actionStatus:{}},
    metaRuntime:{storage:{},state:{}},
    clearStageTip(){}, hideMainMenuAfterModeStart(){}, lockInputForMatchOver(){},
    restoreSoloBoundary(){}, setStageNumber(runtime,stage){runtime.stageNumber=stage;},
    async resetBoard(){resets++;if(failPrepare) throw Error('prepare failure');},
    async switchGameMode(runtime,mode,_force,stage){await context.resetBoard();runtime.mode=mode;runtime.stageNumber=stage;},
    ensureGameLoopStarted(){},
    commitSoloRun(run){context.soloRun=run;},
    showMatchResult(runtime,_winner,_mode,_stage,_retry,_cards,onPick,_menu,_side,values){runtime.overlay.hidden=false;displayed='card';pick=onPick;previews=values;},
    showSoloRunState(runtime,run,_retry,_menu,_remaining,_payout,humanShot){runtime.overlay.hidden=false;displayed=run.phase;shownHumanShot=humanShot;},
    hideMatchResult(runtime){runtime.overlay.hidden=true;},
    gameplay:{enter(){starts++;}},marketingRuntime:{startLocalMatch(){}},
    returnToMainMenu(){},countRemainingPieces:()=>({white:0,black:1}),
    loadMetaState:()=>({points:1}),renderMainMenu(){},soloRunText:key=>key,
  };
  const api=runInNewContext(`${stripTypeScriptTypes(source.slice(begin,end))}; ({prepare:prepareSoloRunBoard,resume:resumeSoloRun,present:presentSoloRun,settle:settleSoloRun})`,context);
  context.soloRun=model.recordSoloRunResult(context.soloRun,'black');
  const id=context.soloRun.runId;
  api.present();assert.equal(displayed,'stage-result');
  assert.equal(shownHumanShot,undefined,'a reloaded result must not invent shot details');
  context.soloLastHumanShot={piece:'Knight',power:0.735};
  api.present();assert.deepEqual(shownHumanShot,context.soloLastHumanShot,'live result keeps the accepted human shot');
  context.soloLastHumanShot=undefined;
  await api.prepare();
  assert.equal(context.gameModeRuntime.mode,'stage','retry from a saved result must enter stage rules');
  assert.equal(context.soloRun.runId,id);assert.equal(context.soloRun.stage,1);
  assert.equal(context.soloRun.phase,'stage-ready');assert.equal(starts,1);
  context.soloRun=model.recordSoloRunResult(context.soloRun,'white');
  const offer=JSON.stringify(context.soloRun.offer);
  await api.resume();assert.equal(displayed,'card');
  assert(previews.force.after>previews.force.before,'saved-card screen retains actual effect previews');
  assert.equal(JSON.stringify(context.soloRun.offer),offer,'resume must not reroll');
  failPrepare=true;
  await assert.rejects(pick(context.soloRun.offer.choices[0]),/prepare failure/);
  assert.equal(context.soloRun.phase,'preparing-stage');assert.equal(context.soloRun.cards.picksSoFar,1);
  assert.equal(context.soloRun.stage,2);assert.equal(context.soloRun.points.lastClearedStage,1);
  assert.equal(context.matchRuntime.actionStatus.textContent,'prepareFailed');
  failPrepare=false;await api.prepare();
  assert.equal(context.soloRun.phase,'stage-ready');assert.equal(context.soloRun.cards.picksSoFar,1);
  assert.equal(context.matchRuntime.overlay.hidden,true);
  context.soloRun=model.recordSoloRunResult(context.soloRun,'draw');
  await api.prepare();assert.equal(context.soloRun.stage,2);assert.equal(context.soloRun.cards.picksSoFar,1);
  context.progressStorage.lookupSoloRunSettlement=async()=>({status:'pending'});
  await api.resume();assert.equal(context.soloLookupPending,true);assert.equal(context.matchRuntime.overlay.hidden,false);
  assert.equal(context.matchRuntime.winnerHeading.textContent,'settlementPending');
  context.progressStorage.lookupSoloRunSettlement=async()=>({status:'unpaid'});
  await api.settle();assert.equal(context.soloRun.phase,'ended');assert.equal(settlements,1);
  context.progressStorage.lookupSoloRunSettlement=async()=>({status:'paid',payout:1});
  await api.resume();assert.equal(context.soloRun.phase,'ended');assert.equal(settlements,1);
  assert(resets>=4);

  const boundaryStart=source.indexOf('    // Saved results and card offers remain accessible');
  const boundaryEnd=source.indexOf('    const previousHotseatMapId = ',boundaryStart);
  assert(boundaryStart>=0&&boundaryEnd>boundaryStart);
  const boundary=stripTypeScriptTypes(`(async()=>{${source.slice(boundaryStart,boundaryEnd)};return 'prepare';})()`);
  for(const phase of ['stage-result','awaiting-card','preparing-stage','stage-ready']) {
    let resumed=0;
    const next=await runInNewContext(boundary,{
      PLATFORM:{features:{solo:true}},mode:'stage',soloRun:{phase},async resumeSoloRun(){resumed++;},
    });
    assert.equal(resumed,phase==='stage-ready'?0:1);
    assert.equal(next,phase==='stage-ready'?'prepare':undefined,'saved panels must bypass board setup');
  }

  // Run the real tail of startModeAction: a resumed result/card/pending lookup is not gameplay.
  const start=source.lastIndexOf('    ensureGameLoopStarted();',source.indexOf('  const startPreparedWeeklyRun = '));
  const stop=source.indexOf('\n  };',start);
  assert(start>=0&&stop>start);
  const tail=stripTypeScriptTypes(source.slice(start,stop));
  for(const covered of [true,false]) {
    let entered=0, matches=0;
    await runInNewContext(`(async()=>{${tail}})()`,{
      mode:'stage',PLATFORM:{features:{solo:true}},awaitingWeeklyCard:false,
      ensureGameLoopStarted(){},async resumeSoloRun(){},matchRuntime:{overlay:{hidden:!covered}},
      marketingRuntime:{startLocalMatch(){matches++;}},gameplay:{enter(){entered++;}},
    });
    assert.equal(entered,covered?0:1);assert.equal(matches,covered?0:1);
  }
  console.log('PASS solo application flow: retry, saved offers, preparation recovery, draw, pending/paid receipt and gameplay gate');
} finally { await vite.close(); }
