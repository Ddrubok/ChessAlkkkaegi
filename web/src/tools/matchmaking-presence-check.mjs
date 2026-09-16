import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import './headless-browser-env.mjs';
const vite = await createServer({ root: fileURLToPath(new URL('../..', import.meta.url)), configFile: false, logLevel: 'error', server: { middlewareMode: true } });
const originalNow = Date.now, originalInterval = window.setInterval, originalClear = globalThis.clearInterval;
let now = 100000, nextTimer = 0;
const timers = new Map();
Date.now = () => now;
window.setInterval = (callback, delay) => { assert.equal(delay, 1000); timers.set(++nextTimer, callback); return nextTimer; };
globalThis.clearInterval = id => timers.delete(id);
try {
  const { SupabaseMatchmaker } = await vite.ssrLoadModule('/src/supabase-matchmaker.ts');
  const channels = [];
  const client = {
    getChannels: () => [],
    channel(name) {
      const channel = { name, state: {}, tracks: [], handlers: {},
        on(type, filter, callback) { this.handlers[`${type}:${filter.event}`] = callback; return this; },
        subscribe(callback) { this.subscribed = callback; return this; },
        async track(payload) { this.tracks.push(payload); },
        presenceState() { return this.state; }, async untrack() {},
      };
      channels.push(channel); return channel;
    },
    async removeChannel(channel) { await channel.subscribed('CLOSED'); },
  };
  for (const mode of ['classic', 'strategy']) {
    const statuses = [], errors = [];
    const matcher = new SupabaseMatchmaker(client, { id: 'self', nickname: 'Me', mmr: 1200 }, mode);
    const start = () => matcher.startMatching(s => statuses.push(s), () => {}, e => errors.push(e));
    await start(); const channel = channels.at(-1);
    assert.equal(channel.name, `ca-matchmaking-${mode}`);
    assert.equal(statuses.at(-1).waitingPlayers, null);
    await channel.subscribed('SUBSCRIBED');
    for (let second = 1; second <= 3; second++) {
      now += 1000; [...timers.values()].forEach(fn => fn());
      assert.equal(statuses.at(-1).waitTimeSeconds, second);
      assert.equal(statuses.at(-1).waitingPlayers, null, 'Before sync, unknown is not zero');
    }
    const person = (id, extra = {}) => ({ id, nickname: id, mmr: 4000, ...extra });
    channel.state = { self: [person('SELF'), person('self')], a: [person('a'), person('a')], b: [person('b')], busy: [person('busy'), person('busy', { targetMatchId: 'game' })] };
    channel.handlers['presence:sync']();
    assert.equal(statuses.at(-1).waitingPlayers, 2, 'Exclude self, deduplicate tabs, exclude busy accounts; do not filter by MMR');
    channel.state = { self: [person('self')] };
    channel.handlers['presence:sync']();
    assert.equal(statuses.at(-1).waitingPlayers, 0, 'Leaves update to a confirmed zero');
    assert.equal(channel.tracks.length, 1, 'Timer and counts do not send new messages');
    await matcher.trackQueueMatch('game'); assert.equal(channel.tracks.at(-1).targetMatchId, 'game');
    matcher.resetSignalingState(); assert.equal(channel.tracks.at(-1).targetMatchId, undefined);
    matcher.updateStatus('match-found', 'found'); assert.equal(statuses.at(-1).waitingPlayers, null);
    matcher.cancel(); await Promise.resolve(); await Promise.resolve();
    assert.equal(timers.size, 0); assert.equal(errors.length, 0, 'Intentional channel close is not an error');
    await start(); const nextChannel = channels.at(-1);
    const countBeforeStale = statuses.length;
    channel.handlers['presence:sync'](); await channel.subscribed('SUBSCRIBED');
    assert.equal(statuses.length, countBeforeStale, 'Ignore obsolete channel callbacks after re-entry');
    assert.equal(statuses.at(-1).waitingPlayers, null);
    await nextChannel.subscribed('SUBSCRIBED'); await nextChannel.subscribed('CHANNEL_ERROR');
    assert.equal(statuses.at(-1).waitingPlayers, null); assert.equal(errors.length, 1); assert.equal(timers.size, 0);
  }
  console.log('PASS: both queues, 1-second timer, unknown/zero, self and tab deduplication, departure, busy state, cancellation, re-entry and channel failure');
} finally {
  Date.now = originalNow; window.setInterval = originalInterval; globalThis.clearInterval = originalClear;
  await vite.close();
}
