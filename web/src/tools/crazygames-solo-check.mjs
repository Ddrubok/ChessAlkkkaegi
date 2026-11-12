import './headless-browser-env.mjs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const vite = await createServer({root:fileURLToPath(new URL('../..',import.meta.url)),configFile:false,logLevel:'error',server:{middlewareMode:true,hmr:false}});
const values = new Map();
const storage = {get length(){return values.size;},key:i=>[...values.keys()][i]??null,getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k),clear:()=>values.clear()};
try {
  const {readSoloState,writeSoloIntro,writeSoloCheckpoint}=await vite.ssrLoadModule('/src/crazygames-solo.ts');
  const {resilientPortalStorage}=await vite.ssrLoadModule('/src/portal-browser-guards.ts');
  const cards={sizeGrade:0,weightGrade:0,forceGrade:1,giantPawn:false,proneStart:false,picksSoFar:1};
  const checkpoint={stage:2,metaPoints:100,cards,points:{lastClearedStage:1}};
  storage.setItem('has_completed_tutorial','true');
  writeSoloIntro('account-a','complete',storage);
  writeSoloCheckpoint('account-a',checkpoint,storage);
  assert.deepEqual(readSoloState('account-a',storage),{intro:'complete',run:checkpoint});
  assert.deepEqual(readSoloState('account-b',storage),{intro:null,run:null});
  assert.deepEqual(readSoloState(null,storage),{intro:null,run:null});
  assert.equal(storage.getItem('has_completed_tutorial'),'true','Preserve existing tutorial reward flag');
  writeSoloCheckpoint('account-a',null,storage);
  assert.deepEqual(readSoloState('account-a',storage),{intro:'complete',run:null});
  for(const patch of [{stage:11},{stage:2,cards:{...cards,picksSoFar:9}},{cards:{...cards,forceGrade:5}},{points:{lastClearedStage:2}}]) {
    storage.setItem('ca_cg_opening_v2:account-a',JSON.stringify({intro:'complete',run:{...checkpoint,...patch}}));
    assert.equal(readSoloState('account-a',storage).run,null,'Reject impossible boundary');
  }
  let warnings=0;
  window.dispatchEvent=()=>{warnings++;return true;};
  const protectedStorage=resilientPortalStorage(storage,true);
  protectedStorage.setItem('stage','1');
  storage.setItem=()=>{throw new DOMException('Full','QuotaExceededError');};
  protectedStorage.setItem('stage','2');
  protectedStorage.setItem('card','force');
  assert.equal(protectedStorage.getItem('stage'),'2');
  assert.equal(protectedStorage.getItem('card'),'force');
  assert.equal(protectedStorage.getItem('has_completed_tutorial'),'true');
  assert.equal(warnings,1,'Report transition to session-only storage once');
  protectedStorage.removeItem('card');assert.equal(protectedStorage.getItem('card'),null);
  console.log('PASS: solo boundaries, account isolation, legacy preservation, impossible records and late quota recovery');
} finally { await vite.close(); }
