import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import './headless-browser-env.mjs';

const vite = await createServer({ root: fileURLToPath(new URL('../..', import.meta.url)), configFile: false,
  envFile: false, logLevel: 'error', server: { middlewareMode: true, hmr: false } });
const oldRtc = globalThis.RTCPeerConnection;
const oldFetch = globalThis.fetch;
const oldInterval = window.setInterval;
const oldTimeout = window.setTimeout;
const oldClearInterval = globalThis.clearInterval;
const oldClearTimeout = globalThis.clearTimeout;
const timers = new Map(), timerDelays = new Map(); let timerId = 0;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const drain = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const peers = [];
class Peer {
  connectionState = 'connecting'; iceConnectionState = 'checking'; localDescription = null;
  constructor() { peers.push(this); }
  createDataChannel() { return this.dc = { readyState: 'connecting', close() { this.readyState = 'closed'; }, send() {} }; }
  async createOffer() { return { type: 'offer', sdp: 'offer' }; }
  async setLocalDescription(value) { this.localDescription = value; }
  close() { this.connectionState = 'closed'; this.onconnectionstatechange?.(); }
  open() { this.connectionState = 'connected'; this.dc.readyState = 'open'; this.dc.onopen?.(); this.onconnectionstatechange?.(); }
}
globalThis.RTCPeerConnection = Peer;
globalThis.fetch = async () => ({ ok: true, json: async () => [{ urls: 'stun:offline.invalid' }] });
window.setInterval = window.setTimeout = (fn, delay) => { timers.set(++timerId, fn); timerDelays.set(timerId, delay); return timerId; };
globalThis.clearInterval = globalThis.clearTimeout = id => { timers.delete(id); };
try {
  const { SupabaseMatchmaker } = await vite.ssrLoadModule('/src/supabase-matchmaker.ts');
  function fixture() {
    const channels = [], ready = [], errors = [], statuses = [];
    let untrackGate = null, removeGate = null;
    const client = { getChannels: () => [], async removeChannel() { if (removeGate) await removeGate.promise; },
      channel(name) { const channel = { name, handlers: {}, on(type, filter, cb) { this.handlers[`${type}:${filter.event}`] = cb; return this; },
        subscribe(cb) { this.subscribed = cb; return this; }, async track() {}, async send() {},
        untrack() { return untrackGate?.promise ?? Promise.resolve(); },
        presenceState() { return { 'b-player': [{ id: 'b-player', nickname: 'Opponent', mmr: 1200 }] }; } };
        channels.push(channel); return channel; } };
    const matcher = new SupabaseMatchmaker(client, { id: 'a-player', nickname: 'Self', mmr: 1200 }, 'classic');
    const start = () => matcher.startMatching(s => statuses.push(s.phase), (...args) => ready.push(args), e => errors.push(e));
    const prepare = async () => { const pending = start(); await pending; const channel = channels.at(-1);
      await channel.subscribed('SUBSCRIBED'); channel.handlers['presence:sync'](); await drain();
      return { channel, peer: peers.at(-1) }; };
    return { matcher, channels, ready, errors, statuses, start, prepare,
      holdUntrack() { return untrackGate = deferred(); }, holdRemove() { return removeGate = deferred(); },
      release() { untrackGate?.resolve(); removeGate?.resolve(); untrackGate = removeGate = null; } };
  }
  {
    const f = fixture(); const { peer } = await f.prepare();
    const gate = f.holdUntrack(); f.matcher.cancel();
    assert.equal(peer.dc.readyState, 'closed', 'local data channel closes before untrack settles');
    peer.open(); assert.equal(f.ready.length, 0); assert.equal(f.statuses.at(-1), 'cancelled');
    gate.resolve(); await drain(); assert.equal(f.errors.length, 0);
  }
  {
    const f = fixture(); const { peer } = await f.prepare();
    const gate = f.holdRemove(); f.matcher.cancel(); peer.open();
    assert.equal(f.ready.length, 0, 'late open during remove wait is ignored');
    gate.resolve(); await drain();
  }
  {
    const f = fixture(); const { peer: oldPeer, channel: oldChannel } = await f.prepare();
    const oldPolls = [...timers].filter(([id]) => timerDelays.get(id) === 80);
    const gate = f.holdUntrack(); f.matcher.cancel();
    const next = f.start(); await next; const newChannel = f.channels.at(-1);
    await newChannel.subscribed('SUBSCRIBED'); newChannel.handlers['presence:sync'](); await drain();
    const newPeer = peers.at(-1); assert.notEqual(newPeer, oldPeer);
    for (const [id, poll] of oldPolls) {
      poll();
      assert.equal(timers.has(id), false, 'a cancelled attempt must stop polling even after immediate retry');
    }
    oldPeer.open(); oldChannel.handlers['presence:sync'](); await oldChannel.subscribed('CHANNEL_ERROR');
    gate.resolve(); await drain();
    assert.equal(f.matcher.peerConnection, newPeer, 'stale cleanup keeps new peer');
    assert.equal(f.errors.length, 0, 'stale error ignored');
    newPeer.open(); newPeer.open();
    assert.equal(f.ready.length, 1, 'new ready delivered once');
    assert.equal(f.matcher.peerConnection, null, 'ready transport handed off');
    f.matcher.cancel(); assert.equal(newPeer.dc.readyState, 'open', 'cancel after handoff keeps game transport');
  }
  {
    const f = fixture(); const pending = f.start(); f.matcher.cancel(); await pending;
    assert.equal(f.channels.length, 0, 'cancel during initial async setup prevents channel');
  }
  {
    const f = fixture();
    const started = f.matcher.startMatching(status => { if (status.phase === 'connected') f.matcher.cancel(); },
      (...args) => f.ready.push(args), e => f.errors.push(e));
    await started; const channel = f.channels.at(-1);
    await channel.subscribed('SUBSCRIBED'); channel.handlers['presence:sync'](); await drain();
    const peer = peers.at(-1); peer.open();
    assert.equal(f.ready.length, 0, 'cancel in connected status callback blocks ready');
    assert.equal(peer.dc.readyState, 'closed');
  }
  {
    const f = fixture(); const friend = { id: 'b-player', nickname: 'Friend', mmr: 1200 };
    await f.matcher.startDirectFriendlyMatch('room-1', true, friend, (...args) => f.ready.push(args));
    await f.channels.at(-1).subscribed('SUBSCRIBED'); await drain();
    const peer = peers.at(-1); peer.open(); peer.open();
    assert.equal(f.ready.length, 1, 'friendly ready delivered once');
    f.matcher.cancel(); assert.equal(peer.dc.readyState, 'open', 'friendly handoff owns transport');
  }
  {
    const f = fixture(), friend = { id: 'b-player', nickname: 'Friend', mmr: 1200 };
    const connectGuest = async room => {
      await f.matcher.startDirectFriendlyMatch(room, false, friend, (...args) => f.ready.push(args));
      await f.channels.at(-1).subscribed('SUBSCRIBED'); await drain();
      const pc = peers.at(-1); pc.createDataChannel(); pc.ondatachannel({channel:pc.dc}); return pc;
    };
    const old = await connectGuest('guest-room-1');
    const oldPolls = [...timers].filter(([id]) => timerDelays.get(id) === 80);
    f.matcher.cancel();
    const current = await connectGuest('guest-room-2');
    for (const [id, poll] of oldPolls) { poll(); assert.equal(timers.has(id), false, 'guest stale polling stops'); }
    const late = { readyState:'open', close() { this.readyState='closed'; } };
    old.ondatachannel({channel:late}); assert.equal(late.readyState,'closed');
    current.open(); current.open();
    assert.equal(f.ready.length,1); assert.equal(f.ready[0][1],'black');
    f.matcher.cancel(); assert.equal(current.dc.readyState,'open');
  }
  console.log('PASS: cancel setup, untrack/remove late open, retry, host/guest stale polling, stale cleanup/error, duplicate ready, ranked and friendly handoff');
} finally {
  globalThis.RTCPeerConnection = oldRtc; globalThis.fetch = oldFetch;
  window.setInterval = oldInterval; window.setTimeout = oldTimeout;
  globalThis.clearInterval = oldClearInterval; globalThis.clearTimeout = oldClearTimeout;
  await vite.close();
}
