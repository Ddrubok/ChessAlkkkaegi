import './headless-browser-env.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
const vite=await createServer({root:fileURLToPath(new URL('../..',import.meta.url)),configFile:false,logLevel:'error',server:{middlewareMode:true,hmr:false}});
try {
 const {AccountProgressStorage}=await vite.ssrLoadModule('/src/progress-storage.ts');
 const {equipCosmeticLoadout,getCosmeticLoadout,DEFAULT_COSMETICS}=await vite.ssrLoadModule('/src/cosmetics.ts');
 const {MASTERY_PREFERENCES_KEY: key}=await vite.ssrLoadModule('/src/mastery.ts');
 const cache=new Map(), rows=new Map(), writes=[];
 const local={getItem:k=>cache.get(k)??null,setItem:(k,v)=>cache.set(k,v)};
 let v4=false,hold=null;
 const client={rpc:async(name,args)=>{
  if(name.endsWith('_v4')&&!v4)return {error:{code:'PGRST202'}};
  assert.ok(name.endsWith('_v3')||name.endsWith('_v4'));
  const owner=args.p_expected_user_id, row=rows.get(owner)??{data:{},revision:0};
  if(name.startsWith('save_')){
   if(hold){const wait=hold;hold=null;await wait;}
   if(args.p_expected_revision!==row.revision)return {error:{code:'40001'}};
   if(name.endsWith('_v3')&&args.p_data[key]){
    const p=JSON.parse(args.p_data[key]);assert.ok(!('badgeFrame'in p.equipped));assert.ok(!('titleFrame'in p.equipped));
    assert.notEqual(p.equipped.frame?.itemId,'frame:classic-gold');assert.notEqual(p.equipped.title?.itemId,'title:challenger');
   }
   rows.set(owner,{data:structuredClone(args.p_data),revision:row.revision+1});writes.push(name);
  }
  return {data:{...structuredClone(rows.get(owner)??row),capabilities:['account-progress-v1','mastery-v1','banners-v1',...(v4?['cosmetics-v1']:[])]}};
 }};
 const loadout={...DEFAULT_COSMETICS,banner:'forest',frame:'frame:classic-gold',badgeFrame:'badgeFrame:silver',title:'title:challenger',titleFrame:'titleFrame:violet'};
 const store=new AccountProgressStorage(()=>local);await store.activate(client,'A');
 assert.ok(equipCosmeticLoadout(store,loadout));assert.ok(await store.flush());assert.equal(store.cosmeticsPending,true);assert.deepEqual(getCosmeticLoadout(store),loadout);
 await store.activate(client,'A');assert.deepEqual(getCosmeticLoadout(store),loadout);
 assert.ok(cache.has('ca_account_progress_v4:A'));assert.ok(!cache.has('ca_account_progress_v3:A'));
 v4=true;await store.retry();assert.equal(store.cosmeticsSupported,true);assert.equal(store.cosmeticsPending,false);assert.deepEqual(getCosmeticLoadout(store),loadout);assert.equal(writes.at(-1),'save_account_progress_v4');
 assert.equal(JSON.parse(rows.get('A').data[key]).equipped.titleFrame.itemId,loadout.titleFrame);
 const before=store.getItem(key);assert.equal(equipCosmeticLoadout(store,{...loadout,badge:'badge:mastery-m08'}),false);assert.equal(store.getItem(key),before);
 let release;hold=new Promise(r=>release=r);equipCosmeticLoadout(store,{...loadout,titleFrame:'titleFrame:gold'});const saving=store.flush();equipCosmeticLoadout(store,{...loadout,titleFrame:null});release();await saving;assert.equal(JSON.parse(rows.get('A').data[key]).equipped.titleFrame.itemId,null);
 await store.activate(client,'B');assert.deepEqual(getCosmeticLoadout(store),DEFAULT_COSMETICS);await store.activate(null,null);assert.equal(getCosmeticLoadout(store).banner,'plain');assert.equal(equipCosmeticLoadout(store,loadout),false);
 cache.set('ca_account_progress_v3:C',JSON.stringify({data:{'chessAlkkagi.meta.maxStage':'4'},revision:0,dirty:true,base:{}}));await store.activate(client,'C');assert.equal(store.getItem('chessAlkkagi.meta.maxStage'),'4');assert.ok(cache.has('ca_account_progress_v4:C'));await store.activate(null,null);
 console.log('PASS cosmetics storage: strict v3 projection, local retention, v4 upgrade, atomic ownership, in-flight edits, account/guest isolation, old cache migration');
}finally{await vite.close();}
