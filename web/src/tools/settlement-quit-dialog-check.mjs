import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const main = readFileSync(fileURLToPath(new URL('../main.ts', import.meta.url)), 'utf8');
const menu = readFileSync(fileURLToPath(new URL('../menu.ts', import.meta.url)), 'utf8');

function blockAfter(source, marker) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `missing ${marker}`);
  const open = source.indexOf('{', start + marker.length);
  let depth = 1;
  let end = open + 1;
  while (depth && end < source.length) {
    if (source[end] === '{') depth++;
    if (source[end] === '}') depth--;
    end++;
  }
  assert.equal(depth, 0, `unclosed ${marker}`);
  return source.slice(open + 1, end - 1);
}

function runnable(body, args) {
  return new Function(...args, body.replace(' as HTMLButtonElement', ''));
}

const settlement = blockAfter(main, 'if (menuRuntime.verifiedPortalProfile?.id === me.id && progressStorage.owner === me.id)');
const updateVerified = runnable(`if (menuRuntime.verifiedPortalProfile?.id === me.id && progressStorage.owner === me.id) { ${settlement} }`,
  ['menuRuntime', 'progressStorage', 'profile', 'me']);
const renderVerified = runnable(`if (runtime.verifiedPortalProfile && runtime.verifiedPortalProfile.id === progressStorage.owner) {
  ${blockAfter(menu, 'if (runtime.verifiedPortalProfile && runtime.verifiedPortalProfile.id === progressStorage.owner)')}
}`, ['runtime', 'progressStorage']);

const oldProfile = { id: 'account-a', wins: 0, losses: 0 };
const settledProfile = { id: 'account-a', wins: 1, losses: 0 };
const runtime = { userProfile: settledProfile, verifiedPortalProfile: oldProfile };
updateVerified(runtime, { owner: 'account-a' }, settledProfile, { id: 'account-a' });
renderVerified(runtime, { owner: 'account-a' });
assert.equal(runtime.userProfile.wins, 1, 'menu render must show the settled win without reload');
assert.equal(runtime.verifiedPortalProfile, settledProfile);

for (const [verifiedId, owner] of [['account-b', 'account-a'], ['account-a', 'account-b']]) {
  const other = { id: verifiedId, wins: 9 };
  const isolated = { userProfile: settledProfile, verifiedPortalProfile: other };
  updateVerified(isolated, { owner }, settledProfile, { id: 'account-a' });
  assert.equal(isolated.verifiedPortalProfile, other, 'settlement must not update another account cache');
}

assert.match(menu, /runtime\.confirmOverlay\.hidden = false;\s*cancelButton\.focus\(\);/);
const keydown = runnable(blockAfter(menu, 'confirmOverlay.addEventListener("keydown", (event) =>'),
  ['event', 'cancelButton', 'forfeitButton', 'confirmButton', 'document']);

function checkTabs(visibleForfeit) {
  const document = { activeElement: null };
  const button = (hidden = false) => ({ hidden, disabled: false, focus() { document.activeElement = this; }, click() {} });
  const cancel = button();
  const forfeit = button(!visibleForfeit);
  const confirm = button();
  const actions = visibleForfeit ? [cancel, forfeit, confirm] : [cancel, confirm];
  function tab(shiftKey = false) {
    let prevented = false;
    keydown({ code: 'Tab', shiftKey, preventDefault() { prevented = true; }, stopPropagation() {} },
      cancel, forfeit, confirm, document);
    if (!prevented) {
      const enabled = actions.filter(action => !action.disabled);
      const index = enabled.indexOf(document.activeElement);
      enabled[index + (shiftKey ? -1 : 1)].focus();
    }
  }
  cancel.focus();
  for (const expected of [...actions.slice(1), cancel]) { tab(); assert.equal(document.activeElement, expected); }
  for (const expected of [...actions.slice(1).reverse(), cancel]) { tab(true); assert.equal(document.activeElement, expected); }
  if (visibleForfeit) {
    forfeit.disabled = true;
    cancel.focus(); tab(); assert.equal(document.activeElement, confirm, 'disabled action is skipped');
    tab(); assert.equal(document.activeElement, cancel);
  }
}
checkTabs(true);
checkTabs(false);
console.log('settlement profile cache and quit dialog keyboard checks passed');
