// Developer-only browser fixture. No Supabase client, production RPC or application entry point.
import { WeeklyChallengeStorage } from '../weekly-challenge-storage.ts';
import { createLocalWeeklyDefinition } from '../weekly-challenge-definition.ts';
import { openWeeklyChallenge } from '../weekly-challenge-ui.ts';
import { QuestStorage } from '../quest-storage.ts';
import { makePieceLaunchEvent, makePuzzleClearEvent } from '../quest-events.ts';
import { renderQuestLobbyEntry, renderQuestProfileSummary, updateQuestSummaries, openQuestBook } from '../quest-ui.ts';
import { I18nManager } from '../i18n.ts';
import '../weekly-challenge-ui.css';
import '../quest-ui.css';
const root=document.querySelector('#summaries'), output=document.querySelector('#result');
const assert=(value,message)=>{if(!value)throw Error(message);output.textContent+='\nPASS '+message;};
const wait=async(fn)=>{for(let i=0;i<120;i++){if(fn())return;await new Promise(requestAnimationFrame);}throw Error('Timed out waiting for UI');};
const data={currentWeek:await createLocalWeeklyDefinition(new Date()),previousWeek:await createLocalWeeklyDefinition(new Date(),-1),activeAttempt:null,records:{current:null,previous:null},capabilities:{accountAttempts:true,boundaryResume:true,inStageRestore:false}};
const ok=()=>({error:null,data:{ok:true,code:'OK',serverNow:new Date().toISOString(),data}});
const fail=()=>({data:null,error:{code:'NETWORK_ERROR'}});
let calls=0, mode='error', release;
const client={rpc:async()=>{calls++;if(mode==='delay')return new Promise(r=>{release=r;});if(mode==='throw')throw Error('Synthetic failure');return mode==='ok'?ok():fail();}};
const store=new WeeklyChallengeStorage();
await store.activate(client,'qa-fixture-'+crypto.randomUUID());
const noop=async()=>{};
const actions={retry:()=>store.refresh(),practice:noop,start:noop,resume:noop,takeover:noop,terminate:noop};
const quests=new QuestStorage();await quests.activate(null,'qa-targets-'+crypto.randomUUID());
const ctx=quests.captureContext();
for(const pieceType of ['Pawn','Knight','Bishop','Rook','Queen']) quests.enqueue(makePieceLaunchEvent({source:'tutorial',runId:crypto.randomUUID(),launchOrdinal:1,pieceType},ctx.periods,ctx.occurredAt));
for(const id of ['P01','P02']) quests.enqueue(makePuzzleClearEvent(crypto.randomUUID(),id,1,3,ctx.periods,ctx.occurredAt));
function summaries(){root.innerHTML=renderQuestLobbyEntry(quests)+renderQuestProfileSummary(quests);root.querySelectorAll('[data-open-quests]').forEach(b=>b.onclick=()=>openQuestBook(root,quests));}
summaries();quests.subscribe(()=>updateQuestSummaries(root,quests));
document.querySelector('#quest').onclick=()=>openQuestBook(root,quests);
document.querySelector('#weekly').onclick=()=>openWeeklyChallenge(store,actions);
document.querySelector('#language').onchange=e=>{I18nManager.setLanguage(e.target.value);summaries();};
let scaled=false;document.querySelector('#scale').onclick=()=>{scaled=!scaled;let style=document.querySelector('#qa-scale');if(!style){style=document.createElement('style');style.id='qa-scale';document.head.append(style);}style.textContent=scaled?'.quest-modal,.weekly-modal{font-size:32px}.quest-modal p,.quest-modal small,.quest-modal em,.quest-modal li,.weekly-modal p,.weekly-modal li,.weekly-modal strong,.weekly-modal span{font-size:24px!important}.quest-modal h2,.weekly-modal h2{font-size:40px!important}':'';};
document.querySelector('#suite').onclick=async()=>{
  output.textContent='Running real DOM + real storage with synthetic RPC';
  try{
    const opener=root.querySelector('[data-quest-opener="lobby"]');opener.focus();
    quests.enqueue(makePieceLaunchEvent({source:'tutorial',runId:crypto.randomUUID(),launchOrdinal:1,pieceType:'Pawn'},ctx.periods,ctx.occurredAt));
    assert(opener===root.querySelector('[data-quest-opener="lobby"]')&&document.activeElement===opener,'summary updates retain button node and focus');
    opener.click();
    const daily=document.querySelectorAll('.quest-card')[2];
    assert(daily.textContent.includes('목표 완료')&&!daily.textContent.includes('아직 기록되지'),'completed daily target does not mark four other types missing');
    document.querySelector('[data-cadence="weekly"]').click();
    assert(document.querySelectorAll('.quest-card')[3].textContent.includes('킹')&&document.querySelectorAll('.quest-card')[3].textContent.includes('추가 1종'),'weekly fifth type identifies remaining King');
    document.querySelector('[data-quest-close]').click();
    assert(document.activeElement===opener,'quest close restores lobby opener');
    mode='error';await store.refresh();openWeeklyChallenge(store,actions);
    mode='delay';const before=calls;
    document.querySelector('[data-weekly-action="retry"]').click();
    document.querySelector('[data-weekly-action="retry"]').click();
    await wait(()=>release);
    assert(calls===before+1,'duplicate retry starts one RPC');
    assert(!document.querySelector('[data-weekly-action="practice"]').disabled,'practice remains available during retry');
    release(ok());release=null;
    await wait(()=>document.querySelector('[data-weekly-action="start"]'));
    assert(!!document.querySelector('.weekly-modal'),'successful retry keeps modal open');
    const details=document.querySelector('details');details.open=true;details.querySelector('summary').focus();document.querySelector('.weekly-dialog').scrollTop=130;
    const scroll=document.querySelector('.weekly-dialog').scrollTop;
    mode='error';await store.refresh();
    assert(document.querySelector('details').open&&document.querySelector('.weekly-dialog').scrollTop===scroll&&document.activeElement.matches('summary'),'refresh retains expanded details, scroll and focus');
    document.querySelector('[data-weekly-action="retry"]').click();
    await wait(()=>!document.querySelector('[data-weekly-action="retry"]').disabled);
    assert(document.querySelector('.weekly-status').textContent.includes('서버')&&document.querySelector('.weekly-status').textContent.includes('저장'),'failed retry preserves cause and saved-state explanation');
    mode='delay';document.querySelector('[data-weekly-action="retry"]').click();await wait(()=>release);
    document.querySelector('[data-weekly-action="close"]').click();release(ok());release=null;
    await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
    assert(!document.querySelector('.weekly-modal'),'late response does not reopen closed modal');
    mode='error';await store.refresh();openWeeklyChallenge(store,actions);
    await store.activate(null,'qa-other-'+crypto.randomUUID());
    assert(!document.querySelector('.weekly-modal'),'owner switch closes old modal');
    output.textContent+='\nALL 11 DOM CHECKS PASSED';
  }catch(error){output.textContent+='\nFAIL '+error.stack;}
};

const boundaryButton=document.createElement('button');boundaryButton.textContent='Run real boundary timer check (65 seconds)';document.querySelector('#fixture').prepend(boundaryButton);
boundaryButton.onclick=async()=>{
  output.textContent='Boundary test running: real 30-second timer, first boundary RPC fails';
  let boundaryCalls=0;
  const oldData={...data,currentWeek:await createLocalWeeklyDefinition(new Date(),-1),previousWeek:await createLocalWeeklyDefinition(new Date(),-2)};
  const boundaryClient={rpc:async()=>{boundaryCalls++;return boundaryCalls===2?fail():{error:null,data:{ok:true,code:'OK',serverNow:new Date().toISOString(),data:boundaryCalls===1?oldData:data}};}};
  const boundaryStore=new WeeklyChallengeStorage();await boundaryStore.activate(boundaryClient,'qa-boundary-'+crypto.randomUUID());
  openWeeklyChallenge(boundaryStore,{...actions,retry:()=>boundaryStore.refresh()});
  document.querySelector('details').open=true;document.querySelector('summary').focus();document.querySelector('.weekly-dialog').scrollTop=100;
  const scroll=document.querySelector('.weekly-dialog').scrollTop;
  setTimeout(()=>{
    try{
      assert(boundaryCalls===3,'boundary failure retries on next real 30-second tick');
      assert(boundaryStore.view().snapshot.currentWeek.weekId===data.currentWeek.weekId,'new weekly definition replaces expired week');
      assert(document.querySelector('details').open&&document.activeElement.matches('summary')&&document.querySelector('.weekly-dialog').scrollTop===scroll,'two timer ticks retain details, focus and scroll');
      document.querySelector('[data-weekly-action="close"]').click();
      output.textContent+='\nALL 3 REAL TIMER CHECKS PASSED';
    }catch(error){output.textContent+='\nFAIL '+error.stack;}
  },65000);
};
