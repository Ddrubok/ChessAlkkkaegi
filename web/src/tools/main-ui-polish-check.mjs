import './headless-browser-env.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
globalThis.sessionStorage = new (localStorage.constructor)();
globalThis.BroadcastChannel = undefined;
const vite = await createServer({configFile:false,logLevel:'error',server:{middlewareMode:true,hmr:false}});
let failures = 0;
const check = (name, fn) => { try { fn(); console.log(`PASS ${name}`); } catch(e) { failures++; console.error(`FAIL ${name}: ${e.message.split('\n')[0]}`); } };
const source = async path => readFile(new URL(path, import.meta.url),'utf8');
try {
  const {renderModeCards, renderProfilePanel} = await vite.ssrLoadModule('/src/lobby.ts');
  const {I18nManager, SUPPORTED_LANGUAGES} = await vite.ssrLoadModule('/src/i18n.ts');
  const runtime = {userProfile:{id:'local_guest',nickname:'QA guest',mmr:1200},onOpenPuzzles:()=>{}};
  check('guest online card names its friendly destination',()=>assert.match(renderModeCards(runtime,0),/온라인 친선전/));
  check('expanded profile makes full nickname readable',()=>assert.match(renderProfilePanel(runtime.userProfile,0),/QA guest/));
  const aim = await source('../aimparams.ts');
  check('normal strike preview omits physics vectors',()=>assert.doesNotMatch(aim.slice(aim.indexOf('runtime.feedback.textContent ='),aim.indexOf('return solution;',aim.indexOf('runtime.feedback.textContent ='))),/Δv|Δω/));
  const cosmetic = await source('../cosmetics-settings.ts');
  check('guest restriction notice occurs once',()=>assert.equal((cosmetic.slice(cosmetic.indexOf('if (!isLocalBannerPreview'),cosmetic.indexOf('// Member Mode')).match(/escapeHtml\(copy.guestNotice\)/g)||[]).length,1));
  const research = await source('../piece-stat-workbench.css');
  check('mobile research editor precedes preview',()=>assert.match(research,/\[data-mode="research"\] \.psw-editor\s*\{[^}]*order:\s*1/));
  const settings = await source('../settings-modal.ts');
  for (const id of ['settings-mute-toggle','settings-bgm-slider','settings-sfx-slider']) check(`${id} accessible name`,()=>assert.match(settings,new RegExp(`<input[^>]*id="${id}"[^>]*aria-label=`)));
  for (const file of ['privacy.html','delete-account.html']) {
    const html = await source('../../public/'+file);
    check(`${file} shared responsive policy styling`,()=>assert.match(html,/href="\.\/policy-layout.css"/));
  }
  // Ensure all language paths resolve real copy (not missing keys).
  for (const lang of SUPPORTED_LANGUAGES) {
    I18nManager.setLanguage(lang.code);
    check(`guest copy ${lang.code}`,()=>assert.doesNotMatch(renderModeCards(runtime,0),/undefined|\[missing|ui\.friendly/));
  }
} finally { await vite.close(); }
if(failures) process.exitCode = 1;
