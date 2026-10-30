// Actual main.ts result/new-run callbacks; only UI and board reconstruction are doubles.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { createServer } from 'vite';
import { parseAst } from '../../node_modules/rolldown/dist/parse-ast-index.mjs';
import './headless-browser-env.mjs';

const web = new URL('../../', import.meta.url);
const root = new URL('../', web);
const vite = await createServer({root:fileURLToPath(web),configFile:false,envFile:false,logLevel:'error',server:{middlewareMode:true,hmr:false}});
const source = stripTypeScriptTypes(await readFile(new URL('src/main.ts',web),'utf8'),{mode:'strip'});
const ast = parseAst(source);
function callback(name,index) {
  const hits=[];
  function walk(node) {
    if (!node || typeof node!=='object') return;
    if (node.type==='CallExpression' && node.callee?.name===name) hits.push(node.arguments[index]);
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(walk); else if(value&&typeof value==='object') walk(value);
  }
  walk(ast); assert.equal(hits.length,1,name);
  return source.slice(hits[0].start,hits[0].end);
}
const resultSource=callback('setMatchOverHandler',1);
const freshRunSource=callback('createGameModeRuntime',0);
const compile=(code,bindings)=>new Function(...Object.keys(bindings),`return (${code});`)(...Object.values(bindings));
const noop=()=>{};
try {
  const meta=await vite.ssrLoadModule('/src/meta.ts');
  const cards=await vite.ssrLoadModule('/src/cards.ts');
  const modes=await vite.ssrLoadModule('/src/game-mode.ts');
  const match=await vite.ssrLoadModule('/src/match.ts');
  const { I18nManager, SUPPORTED_LANGUAGES }=await vite.ssrLoadModule('/src/i18n.ts');
  function fixture(start,drawAt) {
    const store=new Map(); let writes=0;
    const storage={getItem:k=>store.get(k)??null,setItem:(k,v)=>{store.set(k,String(v));writes++;}};
    const metaRuntime={state:meta.createDefaultMetaState(),storage};
    metaRuntime.state.points=100;
    const stageRunPoints=meta.createStageRunPointState(start);
    for(let stage=start;stage<drawAt;stage++) meta.recordStageRunClear(stageRunPoints,stage);
    meta.saveMaxClearedStage(storage,drawAt-1);
    const runCardState=cards.createRunCardState();
    const gameModeRuntime={mode:'stage',stageNumber:drawAt,switching:false,onModeChanged:null};
    const matchRuntime={winner:null};
    const menuRuntime={returnButton:{hidden:false}};
    const results=[]; const boards=[]; let failBoard=false;
    const resetBoard=async options=>{if(failBoard)throw Error('board rejected');boards.push(options);matchRuntime.winner=null;};
    const bindings={...meta,...cards,...modes,gameModeRuntime,stageRunPoints,runCardState,metaRuntime,matchRuntime,menuRuntime,
      PLATFORM:{id:'crazygames'},gameplay:{enter:noop},marketingRuntime:{endMatch:noop,startLocalMatch:noop},inputRuntime:{},lockInputForMatchOver:noop,
      questRun:null,masteryRun:null,weeklyRun:null,turnRuntime:{},weeklyTuningSettings:{},tuningRuntime:{settings:{cardEffectScale:1}},cardTuningRuntime:{},
      setTurnGameMode:noop,setTuningGameMode:noop,setCardTuningGameMode:noop,renderMainMenu:noop,STAGE_RUN_LENGTH:10,
      resetBoard,returnToMainMenu:async()=>{await modes.switchGameMode(gameModeRuntime,'hotseat',true);},
      showStageRunResult:(runtime,stage,payout,complete,onMenu,winner)=>{runtime.winner=winner;results.push({stage,payout,complete,winner,copy:match.createStageRunResultCopy(stage,payout,complete,winner),onMenu});},
      showMatchResult:(runtime,winner)=>{runtime.winner=winner;},
    };
    gameModeRuntime.onModeChanged=compile(freshRunSource,bindings);
    return {...bindings,results,boards,result:compile(resultSource,bindings),failBoard:value=>{failBoard=value;},writes:()=>writes};
  }
  const vectors=[];
  for(let start=1;start<=10;start++) for(let drawAt=start;drawAt<=10;drawAt++) {
    const f=fixture(start,drawAt);
    const maxBefore=meta.getMaxClearedStage(f.metaRuntime.storage);
    f.result('draw');
    const expected=Array.from({length:drawAt-start},(_,i)=>start+i).reduce((sum,n)=>sum+n,0);
    assert.equal(f.results.length,1);
    assert.equal(f.results[0].payout,expected);
    assert.equal(f.results[0].winner,'draw');
    assert.equal(f.results[0].complete,false);
    assert.equal(f.results[0].copy.heading,I18nManager.t('ingame.draw'));
    assert.equal(meta.getMaxClearedStage(f.metaRuntime.storage),maxBefore);
    assert.equal(f.metaRuntime.state.points,100+expected);
    assert.deepEqual(f.stageRunPoints,{lastClearedStage:0});
    const writes=f.writes(); f.result('draw');
    assert.equal(f.results.length,1,'Duplicate result ignored');
    assert.equal(f.writes(),writes,'Duplicate result cannot save points twice');
    await f.results[0].onMenu();
    assert.equal(f.gameModeRuntime.mode,'hotseat');
    await modes.switchGameMode(f.gameModeRuntime,'stage',true,1);
    assert.deepEqual(f.runCardState,cards.createRunCardState());
    f.result('white');
    assert.equal(f.stageRunPoints.lastClearedStage,1,'Real next-run result callback clears stage one');
    assert.equal(f.metaRuntime.state.points,100+expected,'Fresh run does not repay prior clears');
    vectors.push({start,drawAt,payout:expected,nextAccepted:true});
  }
  for(const outcome of ['black','white']) {
    const f=fixture(1,outcome==='white'?10:3); f.result(outcome);
    assert.equal(f.results[0].payout,outcome==='white'?55:3);
    assert.equal(f.results[0].complete,outcome==='white');
  }
  const recovery=fixture(5,7); recovery.result('draw');
  await recovery.results[0].onMenu();
  const before={points:recovery.metaRuntime.state.points,cards:structuredClone(recovery.runCardState),run:{...recovery.stageRunPoints}};
  recovery.failBoard(true);
  await assert.rejects(modes.switchGameMode(recovery.gameModeRuntime,'stage',true,5),/board rejected/);
  assert.equal(recovery.gameModeRuntime.mode,'hotseat');
  assert.equal(recovery.gameModeRuntime.switching,false);
  assert.deepEqual(recovery.stageRunPoints,before.run);
  assert.deepEqual(recovery.runCardState,before.cards);
  assert.equal(recovery.metaRuntime.state.points,before.points);
  recovery.failBoard(false);
  await modes.switchGameMode(recovery.gameModeRuntime,'stage',true,5);
  recovery.result('white');
  assert.equal(recovery.stageRunPoints.lastClearedStage,5);
  for(const {code} of SUPPORTED_LANGUAGES){
    I18nManager.setLanguage(code);
    const copy=match.createStageRunResultCopy(2,1,false,'draw');
    assert.equal(copy.heading,I18nManager.t('ingame.draw'));
    assert.ok(!copy.heading.includes('ingame.'));
  }
  const out=new URL('qa/quality-2026-10-30/',root);
  await mkdir(out,{recursive:true});
  await writeFile(new URL('stage-fixed-vectors.json',out),JSON.stringify(vectors,null,2)+'\n');
  console.log(`PASS stage result/new-run callbacks: ${vectors.length} draw paths, duplicate settlement, loss/complete, reset failure/retry, nine languages`);
} finally {await vite.close();}
