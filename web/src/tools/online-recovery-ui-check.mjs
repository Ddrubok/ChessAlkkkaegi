import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';

// Exercise the application's actual recovery presenter, including a stale local
// result screen, without booting WebGL or opening an external service.
const source = await readFile(new URL('../main.ts', import.meta.url), 'utf8');
const start = source.indexOf('  const showOnlineRecoveryOverlay = ');
const end = source.indexOf('  const hideDisconnectOverlay = ', start);
assert(start >= 0 && end > start, 'recovery presenter exists');
const functions = stripTypeScriptTypes(source.slice(start, end));
const title = { textContent: '' }, heading = { textContent: '' };
const status = { textContent: '' }, abandon = { textContent: '', focus() { this.focused = true; } };
const reconnect = { textContent: '', focus() { this.focused = true; } };
const overlay = { hidden: true, querySelector(selector) { return selector === 'h1' ? heading : title; } };
const turn = { phase: 'ready' };
const match = { hidden: false, overlay: { hidden: false } };
const input = {};
let inputLocks = 0;
const presenters = runInNewContext(`${functions}; ({
  disconnected: showDisconnectOverlay,
  protocolError: showProtocolErrorOverlay,
  blocked: () => onlineConnectionBlocked,
})`, {
  onlineConnectionBlocked: false, turnRuntime: turn, matchRuntime: match,
  inputRuntime: input, disconnectOverlay: overlay, reconnectStatus: status,
  reconnectButton: reconnect, abandonButton: abandon,
  getRuntimeText: key => key, uiText: key => key,
  hideMatchResult: runtime => { assert.equal(runtime, match); runtime.hidden = true; runtime.overlay.hidden = true; },
  lockInputForMatchOver: runtime => { assert.equal(runtime, input); inputLocks++; },
});

presenters.disconnected();
assert.equal(overlay.hidden, false);
assert.equal(heading.textContent, 'online.reconnect_overlay_disconnected');
assert.equal(status.textContent, 'online.reconnect_overlay_prompt');
assert.equal(reconnect.hidden, false);
assert.equal(presenters.blocked(), true);

// A terminal local simulation must not mask a failed authoritative correction.
turn.phase = 'match-over';
overlay.hidden = true;
match.hidden = false;
presenters.disconnected();
assert.equal(overlay.hidden, true, 'ordinary disconnect preserves a completed result');
match.overlay.hidden = true;
presenters.disconnected();
assert.equal(overlay.hidden, false, 'unconfirmed local terminal state still offers connection recovery');
overlay.hidden = true;
match.overlay.hidden = false;
presenters.protocolError();
assert.equal(match.hidden, true, 'discard stale result when authority cannot be restored');
assert.equal(overlay.hidden, false, 'protocol failure remains actionable after local match-over');
assert.equal(heading.textContent, 'syncFailed');
assert.equal(status.textContent, 'syncRecoveryHint');
assert.equal(inputLocks, 1, 'cancel the in-progress aim/gesture before offering recovery');
assert.equal(abandon.focused, true);
assert.equal(reconnect.hidden, true, 'fatal protocol sessions cannot offer an unusable reconnect action');
assert.equal(reconnect.textContent, 'online.reconnect_overlay_create_code');
assert.equal(abandon.textContent, 'online.reconnect_overlay_abandon');
assert.equal(source.split('onProtocolError: showProtocolErrorOverlay').length - 1, 2,
  'guest-code and member-friendly entry points both wire recovery UI');

const syncStart = source.indexOf('  const synchronizeOnlineSnapshotUi = ');
const syncEnd = source.indexOf('  turnRuntime.onPromotionReady = ', syncStart);
assert(syncStart >= 0 && syncEnd > syncStart);
const physics = { pieces: new Map([['black-king-e8', {}], ['white-pawn-a2', {}]]) };
input.selectablePieceIds = new Set(['removed-extra']);
turn.phase = 'ready';
match.hidden = false;
let cancellations = 0;
const synchronize = runInNewContext(`${stripTypeScriptTypes(source.slice(syncStart, syncEnd))}; synchronizeOnlineSnapshotUi`, {
  inputRuntime: input, physicsRuntime: physics, turnRuntime: turn, matchRuntime: match,
  cancelInputInteraction: (runtime, clearSelection) => {
    assert.equal(runtime, input); assert.equal(clearSelection, true); cancellations++;
  },
  hideMatchResult: runtime => { runtime.hidden = true; },
});
synchronize();
assert.equal(input.selectablePieceIds.has('black-king-e8'), true, 'restored own piece can be picked again');
assert.equal(input.selectablePieceIds.has('removed-extra'), false, 'removed extra piece cannot remain selectable');
assert.equal(match.hidden, true, 'restored live board dismisses a stale local result');
turn.phase = 'match-over';
match.hidden = false;
synchronize();
assert.equal(match.hidden, false, 'authoritative finished board retains its result');
assert.equal(cancellations, 2);
assert.equal(source.split('onStateRestored: synchronizeOnlineSnapshotUi').length - 1, 2);
console.log('PASS online recovery UI, input lock, stale-result replacement, restored-piece selection, reconnect/end actions, both entry points');
