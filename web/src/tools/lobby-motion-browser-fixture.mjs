import '../style.css';
import '../lobby.css';
import '../quest-ui.css';
import {renderHeaderActions,renderProfileCard,renderRecommendationCard,getRecommendation,renderWeeklyChallengeEntry,renderTutorialBar,renderModeCards,renderFooterLinks} from '../lobby.ts';
import {renderQuestLobbyEntry} from '../quest-ui.ts';
import {I18nManager} from '../i18n.ts';
import {QuestStorage} from '../quest-storage.ts';
import {openSettingsModal} from '../settings-modal.ts';
import {openMasteryBook} from '../mastery-ui.ts';
import {openFriendsModal} from '../friends-modal.ts';
import {openQuestBook} from '../quest-ui.ts';
import {openWeeklyChallenge} from '../weekly-challenge-ui.ts';
import {WeeklyChallengeStorage} from '../weekly-challenge-storage.ts';
import {PuzzleUI} from '../puzzle-ui.ts';
import {getMotionPreference,setMotionReduced,playUiMotion} from '../ui-motion.ts';
import {createMatchRuntime,showMatchResult,hideMatchResult} from '../match.ts';
import '../piece-stat-workbench.css';
import '../mastery-ui.css';
import '../weekly-challenge-ui.css';
const params=new URLSearchParams(location.search);
const savedLanguage=localStorage.getItem('app_language');
I18nManager.setLanguage(params.get('lang')||'ko');
if(savedLanguage===null) localStorage.removeItem('app_language');else localStorage.setItem('app_language',savedLanguage);
const storage={getItem:()=>null,setItem:()=>{}};
storage.view=()=>({...new QuestStorage().view(),ready:true});
const runtime={userProfile:{id:'guest',nickname:'QA Player',mmr:1200},metaRuntime:{storage,state:{points:0}},onOpenPuzzles(){}};
document.querySelector('#app').innerHTML=`<div class="main-menu-overlay"><div class="main-menu-panel" style="max-width:440px;padding:28px"><header class="lobby-header"><h1>체스 알까기</h1>${renderHeaderActions({showLogout:true})}</header>${renderProfileCard(runtime.userProfile,0)}${renderRecommendationCard(getRecommendation(runtime),'')}${renderQuestLobbyEntry(storage)}${renderWeeklyChallengeEntry()}${renderTutorialBar()}${renderModeCards(runtime,0)}${renderFooterLinks()}<button id="run-layout">배치 검사</button><pre id="results" style="white-space:pre-wrap"></pre></div></div>`;
if(params.get('text')==='200') {const sizes=[...document.querySelectorAll('.main-menu-panel *')].map(element=>[element,parseFloat(getComputedStyle(element).fontSize)]);for(const [element,size] of sizes) element.style.fontSize=`${size*2}px`;}
document.querySelector('#run-layout').onclick=()=>{
 document.querySelector('.main-menu-panel').scrollTop=0;
 const rect=s=>document.querySelector(s).getBoundingClientRect();
 const q=rect('.quest-lobby-entry'),w=rect('.lobby-weekly-entry'),b=rect('.lobby-weekly-entry button');
 const modes=[...document.querySelectorAll('.lobby-mode')];
 const tests={'quest before weekly':q.bottom<=w.top,'four modes':modes.length===4,'44px secondary action':b.height>=44,'no horizontal overflow':document.documentElement.scrollWidth<=innerWidth};
 const panel=document.querySelector('.main-menu-panel');
 tests['panel has no horizontal overflow']=panel.scrollWidth<=panel.clientWidth;
 for(const selector of ['.quest-lobby-entry','.lobby-weekly-entry']) {const entry=document.querySelector(selector),text=entry.firstElementChild.getBoundingClientRect(),button=entry.querySelector('button').getBoundingClientRect();tests[`${selector} no overlap`]=text.right<=button.left;}
 if(innerWidth===390&&!params.has('text')&&(!params.has('lang')||params.get('lang')==='ko')) {tests['weekly <=68px']=w.height<=68;tests['four modes in viewport']=modes.at(-1).getBoundingClientRect().bottom<=innerHeight;}
 document.querySelector('#results').textContent=Object.entries(tests).map(([k,v])=>`${v?'PASS':'FAIL'} ${k}`).join('\n')+`\nweekly height=${w.height}`;
};
const tools=document.createElement('div');tools.style.cssText='position:fixed;right:0;top:0;z-index:10001;background:#101827';
tools.innerHTML='<button id="run-motion">모션 검사</button><button id="sample">타이밍 샘플</button><select id="time"><option>0</option><option>100</option><option>200</option><option>400</option></select><pre id="motion-results" style="max-height:40vh;overflow:auto;white-space:pre-wrap;font-size:11px"></pre>';
document.body.append(tools);
const host=document.createElement('div');document.body.append(host);
const out=tools.querySelector('#motion-results');
const assert=(condition,message)=>{if(!condition)throw Error(message);};
const tick=()=>new Promise(requestAnimationFrame);
tools.querySelector('#run-motion').onclick=async()=>{
 out.textContent='';const saved=getMotionPreference();setMotionReduced(false);
 const calls=[];const original=Element.prototype.animate;
 Element.prototype.animate=function(frames,options){const animation=original.call(this,frames,options);calls.push({element:this,animation,options});return animation;};
 const check=async(name,fn)=>{try{await fn();out.textContent+=`PASS ${name}\n`;}catch(e){out.textContent+=`FAIL ${name}: ${e.message}\n`;}};
 try {
 await check('settings entry/tab/no duplicate/focus/reduced',()=>{
  const n=calls.length;openSettingsModal(host);assert(calls.length===n+1,'entry count');
  host.querySelector('#tab-btn-language').click();assert(calls.length===n+2,'tab count');
  host.querySelector('#tab-btn-language').click();assert(calls.length===n+2,'same tab replays');
  host.querySelector('#tab-btn-sound').click();const toggle=host.querySelector('#settings-motion-toggle');toggle.focus();toggle.click();
  assert(document.activeElement.id==='settings-motion-toggle','focus lost');
  assert(calls.every(c=>c.animation.playState==='idle'),'active effects not canceled');
  host.querySelector('#settings-modal-close').click();setMotionReduced(false);
 });
 await check('20 settings open/close cycles release effects',async()=>{
  for(let i=0;i<20;i++){openSettingsModal(host);document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));}
  await tick();assert(!host.querySelector('.settings-modal-overlay'),'modal leaked');assert(calls.every(c=>c.animation.playState==='idle'||c.animation.playState==='finished'),'animation leaked');
 });
 await check('mastery refresh no repeat and immediate close',()=>{
  const n=calls.length;openMasteryBook(host,storage,()=>{});host.querySelector('[data-mastery-detail="M02"]').click();assert(calls.length===n+1,'detail repeated entry');host.querySelector('[data-mastery-close]').click();
 });
 await check('guest friends open/close',async()=>{const n=calls.length;await openFriendsModal(host,null);assert(calls.length===n+1,'guest entry');host.querySelector('#friends-login-close-btn').click();});
 const quests=new QuestStorage();const questView={...quests.view(),ready:true};let updateQuest;
 const questStore={owner:null,ready:true,view:()=>questView,subscribe:fn=>{updateQuest=fn;return()=>{updateQuest=null;};}};
 await check('quest initial/tab/data refresh/cleanup',()=>{const n=calls.length;openQuestBook(host,questStore);document.querySelector('[data-cadence="weekly"]').click();updateQuest();assert(calls.length===n+2,'data refresh animated');document.querySelector('[data-quest-close]').click();assert(updateQuest===null,'subscription leak');});
 const weekly=new WeeklyChallengeStorage();await weekly.activate(null,null);
 await check('weekly tab changes only',()=>{const n=calls.length;openWeeklyChallenge(weekly,{practice:async()=>{},start:async()=>{}});document.querySelector('[data-weekly-tab="previous"]').click();document.querySelector('[data-weekly-tab="previous"]').click();assert(calls.length===n+2,'weekly count');document.querySelector('[data-weekly-action="close"]').click();});
 let starts=0;const puzzle=new PuzzleUI(host,{progress:()=>({clearedIds:[],medals:{}}),onStart:()=>{starts++;}});
 await check('puzzle entry and immediate action',()=>{const n=calls.length;puzzle.showLibrary();puzzle.showBriefing('puzzle-01');assert(calls.length===n+2,'puzzle entry count');host.querySelector('[data-action="start"]').click();assert(starts===1,'action gated');puzzle.hide();});
 await check('puzzle result duplicate and reduced',()=>{const n=calls.length;const result={success:true,objectiveMet:true,goldMet:true,medal:3};puzzle.showResult('puzzle-01',result);puzzle.showResult('puzzle-01',result);assert(calls.length===n+1,'duplicate result replay');puzzle.hide();setMotionReduced(true);puzzle.showResult('puzzle-01',result);assert(calls.length===n+1,'reduced animated');puzzle.dispose();setMotionReduced(false);});
 await check('match result cards and immediate one-shot action',async()=>{
  let chosen=0;const match=createMatchRuntime(host,async()=>{});const n=calls.length;
  showMatchResult(match,'white','stage',1,async()=>{},[{id:'force',name:'Force',description:'Test'}],async()=>{chosen++;},async()=>{});
  assert(!match.cardChoices.hidden&&match.restartButton.hidden&&match.menuButton.hidden,'card visibility changed');
  const button=match.cardChoices.querySelector('button');button.click();button.click();assert(chosen===1,'card action blocked or duplicated');await Promise.resolve();assert(match.overlay.hidden,'did not close');
  showMatchResult(match,'white','online',1,async()=>{},[],null,async()=>{},null);assert(calls.length===n+1,'unknown side animated');hideMatchResult(match);match.overlay.remove();
 });
 } finally {Element.prototype.animate=original;setMotionReduced(saved);}
};
tools.querySelector('#sample').onclick=()=>{
 host.replaceChildren();const card=document.createElement('div');card.style.cssText='position:fixed;left:10%;top:30%;width:80%;padding:24px;box-sizing:border-box;background:#1e293b;color:white;border:1px solid #475569;border-radius:12px';card.innerHTML='<h2>연출 타이밍</h2><p>숫자와 버튼은 처음부터 사용 가능합니다.</p><button>메뉴로</button>';host.append(card);playUiMotion(card,'panel');for(const animation of card.getAnimations()){animation.pause();animation.currentTime=Number(tools.querySelector('#time').value);}
};
