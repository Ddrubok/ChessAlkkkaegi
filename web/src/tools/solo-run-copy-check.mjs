import './headless-browser-env.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
const vite=await createServer({logLevel:'error',server:{middlewareMode:true,hmr:false,ws:false}});
try {
  const {I18nManager,SUPPORTED_LANGUAGES}=await vite.ssrLoadModule('/src/i18n.ts');
  const {soloRunText}=await vite.ssrLoadModule('/src/solo-run-copy.ts');
  for(const {code} of SUPPORTED_LANGUAGES){
    I18nManager.setLanguage(code);
    for(const key of ['loss','draw','retained','retry','menu','pendingPoints','shotSummary','remainingSummary','aiShot','playerShot','preparing','prepareFailed','prepareRetry','choiceCommitted','saveFailed','sessionOnly','resume','resumeCard','settlementPending','settlementRetry','endRun','endTitle','endDescription','continueRun','confirmEnd','newRun','conflict','lockUnavailable','invalidSave','migrated','alreadyEnded','settled']) {
      const value=soloRunText(key,{stage:4,points:55,own:2,enemy:3});
      assert.ok(value && !value.includes('{'),`${code}:${key} unresolved text`);
    }
    assert.ok(soloRunText('settled',{points:55}).includes('55'),`${code} must show actual credit`);
    assert.ok(soloRunText('shotSummary',{own:2,enemy:3}).includes('2'));
  }
  console.log('PASS solo run copy: all 9 locales, 32 states, placeholders and paid amount');
}finally{await vite.close();}
