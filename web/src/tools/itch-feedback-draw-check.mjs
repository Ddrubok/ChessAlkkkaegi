// Executes the actual main.ts result callback; UI and board rebuild are doubles.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { createServer } from 'vite';
import { parseAst } from '../../node_modules/rolldown/dist/parse-ast-index.mjs';
import './headless-browser-env.mjs';

const vite=await createServer({configFile:false,envFile:false,root:process.cwd(),logLevel:'error',optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,ws:false}});
try {
  const source=stripTypeScriptTypes(await readFile(new URL('../main.ts',import.meta.url),'utf8'),{mode:'strip'});
  const tree=parseAst(source); let callback;
  function walk(node){if(!node||typeof node!=='object')return;
    if(node.type==='CallExpression'&&node.callee?.name==='setMatchOverHandler') callback=node.arguments[1];
    for(const value of Object.values(node)) if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value);
  } walk(tree); assert.ok(callback);
  const code=source.slice(callback.start,callback.end);
  const cards=await vite.ssrLoadModule('/src/cards.ts');
  const meta=await vite.ssrLoadModule('/src/meta.ts');
  const solo=await vite.ssrLoadModule('/src/crazygames-solo.ts');
  const platform=await vite.ssrLoadModule('/src/platform.ts');platform.PLATFORM.id='itch';platform.PLATFORM.features.solo=true;
  const noop=()=>{};
  for(let stage=1;stage<=10;stage++) {
    const run=cards.createRunCardState(), points=meta.createStageRunPointState(1);
    for(let n=1;n<stage;n++){cards.applyCardPick(run,['weight','force','size'][(n-1)%3]);meta.recordStageRunClear(points,n);}
    const snapshot={cards:structuredClone(run),points:{...points},metaPoints:100};
    const storage=new Map(); let checkpoints=0,settlements=0,rewards=0,boardReject=false;const shown=[],boards=[];
    const bindings={PLATFORM:platform.PLATFORM,gameModeRuntime:{mode:'stage',stageNumber:stage},matchRuntime:{winner:null},inputRuntime:{},
      lockInputForMatchOver:noop,marketingRuntime:{endMatch:noop,startLocalMatch:noop},gameplay:{enter:noop},
      metaRuntime:{state:{points:100}},runCardState:run,stageRunPoints:points,cloneRunCardState:cards.cloneRunCardState,
      progressStorage:{owner:null},onlineRuntime:null,menuRuntime:{},clearStageTip:noop,
      writeSoloCheckpoint:(owner,value)=>{checkpoints++;solo.writeSoloCheckpoint(owner,value,{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)});},
      showSoloDrawResult:(runtime,n,onReplay,onMenu)=>{runtime.winner='draw';shown.push({n,onReplay,onMenu});},
      resetBoard:async options=>{if(boardReject)throw Error('board failed');boards.push(options);},
      hideMatchResult:runtime=>{runtime.winner=null;},returnToMainMenu:async()=>{},
      settleStageRunPoints:()=>{settlements++;},recordStageRunClear:()=>{rewards++;},questRun:null,masteryRun:null,weeklyRun:null,
    };
    const result=new Function(...Object.keys(bindings),`return (${code});`)(...Object.values(bindings));
    result('draw');assert.equal(shown.length,1);assert.equal(checkpoints,1);assert.equal(settlements,0);assert.equal(rewards,0);
    assert.deepEqual(run,snapshot.cards);assert.deepEqual(points,snapshot.points);assert.equal(bindings.metaRuntime.state.points,100);
    const saved=solo.readSoloState(null,{getItem:k=>storage.get(k)??null});
    assert.equal(saved.run.stage,stage);assert.deepEqual(saved.run.cards,run);assert.deepEqual(saved.run.points,points);
    result('draw');assert.equal(shown.length,1);assert.equal(checkpoints,1);
    boardReject=true;await assert.rejects(shown[0].onReplay(),/board failed/);assert.equal(bindings.matchRuntime.winner,'draw');
    assert.deepEqual(run,snapshot.cards);assert.deepEqual(points,snapshot.points);
    boardReject=false;await shown[0].onReplay();assert.deepEqual(boards,[{gameMode:'stage',stageNumber:stage}]);
    assert.equal(bindings.matchRuntime.winner,null);assert.equal(settlements,0);assert.equal(rewards,0);
    result('draw');await shown[1].onMenu();assert.equal(solo.readSoloState(null,{getItem:k=>storage.get(k)??null}).run.stage,stage);
  }
  console.log('PASS actual solo result callback: stages 1–10, duplicate draw, checkpoint reload, same-stage replay, reset failure/retry, no payout/card reroll.');
} finally {await vite.close();}
