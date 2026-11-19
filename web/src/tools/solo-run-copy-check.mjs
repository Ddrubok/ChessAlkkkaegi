import './headless-browser-env.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
const vite=await createServer({logLevel:'error',server:{middlewareMode:true,hmr:false,ws:false}});
try {
  const {I18nManager,SUPPORTED_LANGUAGES}=await vite.ssrLoadModule('/src/i18n.ts');
  const {soloRunText,soloRunOwnedUpgrade}=await vite.ssrLoadModule('/src/solo-run-copy.ts');
  const emptyCards={sizeGrade:0,weightGrade:0,forceGrade:0,giantPawn:false,proneStart:false,picksSoFar:0};
  for(const {code} of SUPPORTED_LANGUAGES){
    I18nManager.setLanguage(code);
    for(const key of ['loss','draw','retained','retry','menu','pendingPoints','shotSummary','remainingSummary','aiShot','playerShot','preparing','prepareFailed','prepareRetry','choiceCommitted','saveFailed','sessionOnly','resume','resumeCard','settlementPending','settlementRetry','endRun','endTitle','endDescription','continueRun','confirmEnd','newRun','conflict','lockUnavailable','invalidSave','migrated','alreadyEnded','settled','ownedUpgrade']) {
      const value=soloRunText(key,{stage:4,points:55,own:2,enemy:3,card:'CARD'});
      assert.ok(value && !value.includes('{'),`${code}:${key} unresolved text`);
    }
    assert.equal(soloRunOwnedUpgrade(emptyCards),null,`${code} must not claim an unowned card`);
    const owned={...emptyCards,forceGrade:2,giantPawn:true,picksSoFar:3};
    assert.ok(soloRunOwnedUpgrade(owned,'force').includes(I18nManager.t('cards.force_name')),`${code} uses the saved card's localized name`);
    assert.ok(soloRunOwnedUpgrade(owned,'force').includes('2'),`${code} shows saved grade`);
    assert.ok(soloRunOwnedUpgrade(owned,'giantPawn').includes(I18nManager.t('cards.giantPawn_name')),`${code} shows the selected owned special`);
    assert.ok(!soloRunOwnedUpgrade(owned,'proneStart').includes(I18nManager.t('cards.proneStart_name')),`${code} ignores an unowned offer`);
    assert.ok(soloRunText('settled',{points:55}).includes('55'),`${code} must show actual credit`);
    assert.ok(soloRunText('shotSummary',{own:2,enemy:3}).includes('2'));
  }
  console.log('PASS solo run copy: all 9 locales, owned upgrade summaries, placeholders and paid amount');
}finally{await vite.close();}
