import assert from 'node:assert/strict';
import { cancelItchAuth, startItchAuth } from '../itch-auth.ts';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
async function until(predicate) {
  for (let i = 0; i < 100 && !predicate(); i++) await flush();
  assert.ok(predicate(), 'expected asynchronous auth step');
}

let now = 1_000_000;
const originalNow = Date.now;
Date.now = () => now;
const timers = new Map();
let nextTimer = 0;
let popup;
let reloads = 0;
let cancels = 0;
let commits = 0;
const statuses = [];
globalThis.window = {
  open() {
    popup = {
      closed: false,
      document: { body: {} },
      close() { this.closed = true; },
      location: { replace() { popup.closed = true; } },
    };
    return popup;
  },
  setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id; },
  clearTimeout(id) { timers.delete(id); },
  location: { reload() { reloads++; } },
};
function tick(ms = 2_000) {
  assert.equal(timers.size, 1, 'one auth timer should be scheduled');
  const [id, task] = timers.entries().next().value;
  timers.delete(id);
  now += ms;
  task();
}

let finish;
let releaseSession;
const client = {
  functions: {
    async invoke(_name, { body }) {
      if (body.action === 'start') return { data: { authorizeUrl: 'https://itch.io/user/oauth' }, error: null };
      if (body.action === 'cancel') { cancels++; return { data: { ok: true }, error: null }; }
      return finish(body);
    },
  },
  auth: {
    async setSession(session) {
      commits++;
      assert.equal(session.access_token, 'approved-access');
      return new Promise((resolve) => { releaseSession = resolve; });
    },
  },
};
const status = (message) => statuses.push(message);
const approved = { data: { session: { access_token: 'approved-access', refresh_token: 'approved-refresh' } }, error: null };
async function start() {
  startItchAuth(client, false, status);
  await until(() => popup.closed && timers.size === 1);
}

try {
  // Popup closure after approval can precede the callback database write.
  let polls = 0;
  finish = async () => ++polls < 3 ? { data: { pending: true }, error: null } : approved;
  await start();
  tick(); await until(() => polls === 1 && timers.size === 1);
  tick(); await until(() => polls === 2 && timers.size === 1);
  assert.equal(reloads, 0);
  assert.equal(cancels, 0);
  tick(); await until(() => commits === 1);
  assert.equal(await cancelItchAuth(), false, 'Cancel during setSession must not claim cancellation');
  assert.equal(cancels, 0);
  assert.equal(reloads, 0);
  assert.equal(statuses.at(-1), 'Finishing itch.io sign-in...');
  releaseSession({ error: null });
  await until(() => reloads === 1);
  assert.equal(statuses.at(-1), 'Signed in. Reloading your account progress...');
  assert.equal(await cancelItchAuth(), true);

  // An explicit cancel before the commit must still discard a late finish response.
  let releaseFinish;
  finish = () => new Promise((resolve) => { releaseFinish = resolve; });
  await start();
  tick(); await until(() => Boolean(releaseFinish));
  assert.equal(await cancelItchAuth(), true);
  releaseFinish(approved);
  await flush();
  assert.equal(commits, 1);
  assert.equal(reloads, 1);
  assert.equal(timers.size, 0);

  // Closure grace is bounded when the callback never arrives.
  finish = async () => ({ data: { pending: true }, error: null });
  await start();
  tick(); await until(() => timers.size === 1);
  tick(); await until(() => timers.size === 1);
  tick(); await until(() => timers.size === 1);
  tick(); await until(() => cancels === 2);
  assert.equal(statuses.at(-1), 'Itch.io sign-in was closed.');
  assert.equal(timers.size, 0);
  console.log('PASS itch auth: delayed callback after popup closure, held session commit, explicit cancel, bounded closure grace');
} finally {
  Date.now = originalNow;
}
