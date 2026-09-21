import './headless-browser-env.mjs';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'vite';
const vite=await createServer({configFile:false,logLevel:'error',server:{middlewareMode:true,hmr:false}});
try {
  const {renderModeCards,renderWeeklyChallengeEntry}=await vite.ssrLoadModule('/src/lobby.ts');
  const {I18nManager,SUPPORTED_LANGUAGES}=await vite.ssrLoadModule('/src/i18n.ts');
  const {motionCopy}=await vite.ssrLoadModule('/src/ui-motion-copy.ts');
  for(const {code} of SUPPORTED_LANGUAGES){I18nManager.setLanguage(code);assert.deepEqual(Object.keys(motionCopy()).sort(),['description','label','system','title']);for(const value of Object.values(motionCopy()))assert.ok(value.length>0);}
  assert.equal((renderModeCards({userProfile:{id:'guest',nickname:'QA',mmr:1200},onOpenPuzzles(){}},0).match(/data-game-mode=/g)||[]).length,4);
  assert.match(renderWeeklyChallengeEntry(),/data-open-weekly-challenge/);
  const menu=await readFile(new URL('../menu.ts',import.meta.url),'utf8');
  assert.match(menu,/renderQuestLobbyEntry\(questStorage\)\}\$\{renderWeeklyChallengeEntry\(\)\}\$\{renderTutorialBar\(\)/);
  const css=await readFile(new URL('../lobby.css',import.meta.url),'utf8');
  assert.match(css,/\.lobby-weekly-entry\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto/);
  assert.doesNotMatch(css,/\.lobby-weekly-entry\s*\{[^}]*flex-direction:column/);
  console.log('PASS lobby entries/order/compact grid contracts');
} finally {await vite.close();}
