import './headless-browser-env.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
globalThis.sessionStorage = new (localStorage.constructor)();
globalThis.BroadcastChannel = undefined;
const vite = await createServer({configFile:false, logLevel:'error', server:{middlewareMode:true, hmr:false}});
try {
  const {deriveWeeklyPresentation} = await vite.ssrLoadModule('/src/weekly-challenge-presentation.ts');
  const {createFallbackPracticeDefinition} = await vite.ssrLoadModule('/src/weekly-challenge-definition.ts');
  const {createPracticeRun} = await vite.ssrLoadModule('/src/weekly-challenge-run.ts');
  const {WeeklyChallengeStorage} = await vite.ssrLoadModule('/src/weekly-challenge-storage.ts');
  const store = new WeeklyChallengeStorage();
  await store.activate(null, null);
  const view = store.view();
  const current = view.localDefinitions[0];
  const run = createPracticeRun(current);
  run.stage = 3;
  view.practice = run;
  assert.equal(deriveWeeklyPresentation(view,'current',Date.now()).practice,'resume');
  view.practice.status = 'playing';
  assert.equal(deriveWeeklyPresentation(view,'current',Date.now()).practice,'start');
  view.practice = createPracticeRun(await createFallbackPracticeDefinition(new Date(),-1));
  assert.equal(deriveWeeklyPresentation(view,'current',Date.now()).practice,'start');
  view.owner = 'fixture-owner'; view.syncState = 'offline';
  assert.equal(deriveWeeklyPresentation(view,'current',Date.now()).canRetry,true);
  view.blocked = true;
  assert.equal(deriveWeeklyPresentation(view,'current',Date.now()).canRetry,false);
  assert.equal(deriveWeeklyPresentation(view,'current',Date.now()).canPractice,false);

  view.blocked = false;
  const {createLocalWeeklyDefinition} = await vite.ssrLoadModule('/src/weekly-challenge-definition.ts');
  const def = await createLocalWeeklyDefinition(new Date());
  view.snapshot = {currentWeek:def,previousWeek:null,activeAttempt:null};
  view.syncState = 'synced';
  assert.deepEqual(deriveWeeklyPresentation(view,'current',Date.now()).accountActions,['start']);
  const attempt = {weekId:def.weekId,definitionHash:def.definitionHash,status:'ready-for-stage',ownerSessionId:view.sessionId};
  view.snapshot.activeAttempt = attempt;
  assert.deepEqual(deriveWeeklyPresentation(view,'current',Date.now()).accountActions,['resume']);
  attempt.ownerSessionId = 'other';
  assert.deepEqual(deriveWeeklyPresentation(view,'current',Date.now()).accountActions,['takeover','terminate']);
  view.recoveryHold = true;
  assert.deepEqual(deriveWeeklyPresentation(view,'current',Date.now()).accountActions,['terminate']);
  assert.deepEqual(deriveWeeklyPresentation(view,'previous',Date.now()).accountActions,[]);
  view.recoveryHold = false;
  assert.deepEqual(deriveWeeklyPresentation(view,'current',Date.parse(def.endsAt)).accountActions,['terminate']);
  const {summarizeQuestTargets} = await vite.ssrLoadModule('/src/quest-target-summary.ts');
  const d = {id:'pieces',metric:'piece-types',target:6,conditionVersion:1};
  const p = {questId:'pieces',periodId:'now',conditionVersion:1,status:'in-progress',progress:{kind:'distinct',targetIds:Object.fromEntries(['Pawn','Knight','Bishop','Rook','Queen'].map(x=>[x,{}]))}};
  assert.deepEqual(summarizeQuestTargets(d,p,'now').unrecordedIds,['King']);
  assert.equal(summarizeQuestTargets(d,p,'now').remaining,1);
  p.progress.targetIds = {Pawn:{},Knight:{}}; p.status='completed';
  assert.deepEqual(summarizeQuestTargets({...d,target:2},p,'now').unrecordedIds,[]);
  assert.deepEqual(summarizeQuestTargets(d,p,'other').achievedIds,[]);
  assert.equal(summarizeQuestTargets({...d,metric:'puzzle-clears'},p,'now'),null);
  p.status='in-progress';p.progress.targetIds={P02:{},P01:{}};
  assert.deepEqual(summarizeQuestTargets({...d,metric:'distinct-gold-puzzles',target:3},p,'now').achievedIds,['P01','P02']);
  const {formatProgressDuration} = await vite.ssrLoadModule('/src/progress-duration.ts');
  assert.equal(formatProgressDuration(NaN,0,'ko'),'—');
  assert.equal(formatProgressDuration(-1,0,'ko'),'0분');
  assert.equal(formatProgressDuration(31*3600000,0,'ko'),'1일 7시간');
  const {formatWeeklyHud} = await vite.ssrLoadModule('/src/weekly-challenge-hud.ts');
  const copy={title:'도전',account:'계정',practice:'연습',playing:'{stage}/10 진행 중',choosing:'{completed} 카드',finished:'{completed} 종료',allCleared:'10/10 완료',score:'완료 {completed} · {turns}턴',pending:'대기',error:'오류'};
  const state={visible:true,source:'practice',stage:4,completedStages:3,completedStageOwnTurns:12,status:'playing',saveState:'none'};
  assert.deepEqual(formatWeeklyHud(state,copy),['도전 · 연습 · 4/10 진행 중','완료 3 · 12턴','']);
  assert.equal(formatWeeklyHud({...state,status:'awaiting-card',saveState:'error'},copy)[2],'오류');
  assert.match(formatWeeklyHud({...state,completedStages:10},copy)[0],/10\/10 완료/);
  const {createWeeklyChallengeHud} = await vite.ssrLoadModule('/src/weekly-challenge-hud.ts');
  const originalDocument = globalThis.document;
  let writes=0;
  const element=()=>{let hidden=false,textContent='';return {append(){},remove(){},setAttribute(){},get hidden(){return hidden;},set hidden(v){writes++;hidden=v;},get textContent(){return textContent;},set textContent(v){writes++;textContent=v;}};};
  try {
    globalThis.document={createElement:element};
    const hud=createWeeklyChallengeHud(element());hud.update(state,copy);writes=0;hud.update(state,copy);
    assert.equal(writes,0,'unchanged HUD must not mutate DOM properties');
    hud.destroy();
  } finally { globalThis.document=originalDocument; }
  const {I18nManager} = await vite.ssrLoadModule('/src/i18n.ts');
  const {progressUiCopy} = await vite.ssrLoadModule('/src/progress-ui-copy.ts');
  I18nManager.setLanguage('en'); const english = progressUiCopy();
  for (const locale of ['ko','en','ja','zh-CN','de','fr','es','ru','pt-BR']) {
    I18nManager.setLanguage(locale);
    const translated = progressUiCopy();
    for (const [key,text] of Object.entries(translated)) {
      assert.ok(text && !text.includes('undefined'),locale+': '+key);
      assert.deepEqual(text.match(/\{\w+\}/g)?.sort() ?? [],english[key].match(/\{\w+\}/g)?.sort() ?? [],locale+': placeholders '+key);
    }
    assert.ok(formatProgressDuration(31*3600000,0,locale).length > 0);
  }
  I18nManager.setLanguage('ko');
  console.log('PASS presentation, targets, localized duration, HUD and all 9 locale copy contracts');
} finally { await vite.close(); }
