import './headless-browser-env.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
globalThis.sessionStorage = new (localStorage.constructor)();
globalThis.BroadcastChannel = undefined;
const vite = await createServer({configFile:false,logLevel:'error',server:{middlewareMode:true,hmr:false}});
try {
const {WeeklyChallengeStorage} = await vite.ssrLoadModule('/src/weekly-challenge-storage.ts');
const {createLocalWeeklyDefinition} = await vite.ssrLoadModule('/src/weekly-challenge-definition.ts');
const now = new Date();
const data = {
  currentWeek: await createLocalWeeklyDefinition(now),
  previousWeek: await createLocalWeeklyDefinition(now,-1),
  activeAttempt: null,
  records: {current:null,previous:null},
  capabilities: {accountAttempts:true,boundaryResume:true,inStageRestore:false},
};
let mode = 'error';
let calls = 0;
const client = {rpc: async name => {
  assert.equal(name,'get_weekly_challenge_snapshot_v1'); calls++;
  return mode === 'error' ? {data:null,error:{code:'NETWORK_ERROR'}}
    : {error:null,data:{ok:true,code:'OK',serverNow:new Date().toISOString(),data}};
}};
const store = new WeeklyChallengeStorage();
await store.activate(client,'test-account-A');
assert.equal(store.view().syncState,'offline');
mode='ok'; await store.refresh();
assert.equal(calls,2);
assert.equal(store.view().syncState,'synced');
assert.equal(store.view().snapshot.currentWeek.weekId,data.currentWeek.weekId);

mode='error'; await store.refresh(); assert.equal(store.view().syncState,'offline');
mode='ok'; await store.refresh(); assert.equal(store.view().syncState,'synced');
const initial = new WeeklyChallengeStorage();
mode='error'; await initial.activate(client,'qa-initial-failure');
mode='ok'; await initial.refreshAtBoundary(); assert.equal(initial.view().syncState,'synced');
const bad = {rpc:async()=>({error:null,data:{ok:true,code:'OK',serverNow:new Date().toISOString(),data:{bad:true}}})};
await initial.activate(bad,'qa-malformed'); assert.equal(initial.view().syncState,'error');
let resolve, started;
const began = new Promise(r=>{started=r;});
const delayed = {rpc:async()=>{started();return new Promise(r=>{resolve=r;});}};
const pending = initial.activate(delayed,'qa-old-owner');
await began;
await initial.activate(null,'qa-new-owner');
resolve({error:null,data:{ok:true,code:'OK',serverNow:new Date().toISOString(),data}});
await pending;
assert.equal(initial.owner,'qa-new-owner');
assert.equal(initial.view().snapshot,null);
console.log('PASS retry recovery, missing snapshot, malformed response and stale-owner isolation');
} finally { await vite.close(); }
