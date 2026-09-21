import './headless-browser-env.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
globalThis.sessionStorage = new (localStorage.constructor)();
globalThis.BroadcastChannel = undefined;
const vite=await createServer({configFile:false,logLevel:'error',server:{middlewareMode:true,hmr:false}});
try {
  const {renderProfileCard}=await vite.ssrLoadModule('/src/lobby.ts');
  const html=renderProfileCard({nickname:'QA player',mmr:1200},0);
  assert.match(html,/class="lobby-icon-btn lobby-mastery-btn"/,'mastery must be a compact profile-row action');
  assert.match(html,/data-open-mastery/);
  assert.doesNotMatch(html,/mastery-profile-summary|quest-profile-summary|weekly-profile-summary/,'expanded profile must omit the three summary sections');
  assert.ok(html.indexOf('data-open-mastery') < html.indexOf('lobby-chip-tier'),'mastery precedes the rank');
  console.log('PASS compact mastery entry and clean expanded profile');
} finally { await vite.close(); }
