import './headless-browser-env.mjs';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
const vite=await createServer({configFile:false,logLevel:'error',server:{middlewareMode:true,hmr:false}});
try {
  const {renderModeCards,renderWeeklyChallengeEntry}=await vite.ssrLoadModule('/src/lobby.ts');
  const {I18nManager,SUPPORTED_LANGUAGES}=await vite.ssrLoadModule('/src/i18n.ts');
  const {motionCopy}=await vite.ssrLoadModule('/src/ui-motion-copy.ts');
  for(const {code} of SUPPORTED_LANGUAGES){I18nManager.setLanguage(code);assert.deepEqual(Object.keys(motionCopy()).sort(),['description','label','system','title']);for(const value of Object.values(motionCopy()))assert.ok(value.length>0);}
  assert.equal((renderModeCards({userProfile:{id:'guest',nickname:'QA',mmr:1200},onOpenPuzzles(){}},0).match(/data-game-mode=/g)||[]).length,4);
  assert.match(renderWeeklyChallengeEntry(),/data-open-weekly-challenge/);
  // Responsive navigation and modal routing run in lobby-responsive-browser-check.mjs.
  // The retired vertical-stack source template is no longer a layout contract.
  console.log('PASS lobby mode availability and localized motion copy');
} finally {await vite.close();}
