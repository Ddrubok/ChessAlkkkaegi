// Run from web/: node src/tools/crazygames-two-session-smoke.mjs
// Test-only identities and in-memory Realtime/WebRTC. No server or ranked record.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import './headless-browser-env.mjs';

const main = await readFile(new URL('../main.ts', import.meta.url), 'utf8');
const ui = await readFile(new URL('../supabase-match-ui.ts', import.meta.url), 'utf8');
assert.match(main, /mode === "online"[\s\S]*?new SupabaseMatchUi\(/u);
assert.doesNotMatch(main, /PLATFORM\.id === "crazygames"\s*\|\|\s*portalInvite/u);
assert.match(main, /if \(portalInvite \|\|/u, 'SDK invite must retain the friendly entry route');
assert.match(ui, /openMatchingModal\(card, null, "classic"\)/u);
assert.match(ui, /new SupabaseMatchmaker\(this\.client, this\.profile, matchMode\)/u);
const friendly = await readFile(new URL('../friendly-lobby.ts', import.meta.url), 'utf8');
assert.match(friendly, /const launch = consumeLaunchInvite\(\)/u);
assert.match(friendly, /if \(launch\?\.room !== undefined\)/u);
assert.match(friendly, /else if \(launch\?\.instant\) void start\(\)/u);

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: true, json: async () => [] });
globalThis.RTCSessionDescription = class { constructor(value) { Object.assign(this, value); } };
globalThis.RTCIceCandidate = class { constructor(value) { Object.assign(this, value); } };
let hostChannel;
class DataChannel {
  readyState = 'connecting';
  peer = null;
  send(data) { assert.equal(this.readyState, 'open'); queueMicrotask(() => this.peer?.onmessage?.({ data })); }
  close() { this.readyState = 'closed'; this.onclose?.(); }
}
class PeerConnection {
  connectionState = 'new';
  remoteDescription = null;
  localDescription = null;
  createDataChannel(label) { assert.equal(label, 'chess-alkkaegi-p2p'); this.channel = new DataChannel(); hostChannel = this.channel; return this.channel; }
  async createOffer() { return { type: 'offer', sdp: 'isolated-offer' }; }
  async createAnswer() { return { type: 'answer', sdp: 'isolated-answer' }; }
  async setLocalDescription(value) { this.localDescription = value; }
  async setRemoteDescription(value) {
    this.remoteDescription = value;
    if (value.type === 'offer') {
      this.channel = new DataChannel();
      this.channel.peer = hostChannel; hostChannel.peer = this.channel;
      queueMicrotask(() => this.ondatachannel?.({ channel: this.channel }));
    } else {
      for (const channel of [hostChannel, hostChannel.peer]) {
        channel.readyState = 'open'; queueMicrotask(() => channel.onopen?.());
      }
    }
  }
  async addIceCandidate() {}
  close() { this.connectionState = 'closed'; }
  async getStats() { return new Map(); }
}
globalThis.RTCPeerConnection = PeerConnection;

const room = new Set(), presence = new Map(), traffic = [];
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function client() {
  return {
    getChannels: () => [],
    channel(name) {
      assert.equal(name, 'ca-matchmaking-classic');
      const channel = {
        handlers: {},
        on(type, filter, handler) { this.handlers[`${type}:${filter.event}`] = handler; return this; },
        subscribe(handler) { room.add(this); queueMicrotask(() => handler('SUBSCRIBED')); return this; },
        async track(value) { presence.set(this, value); for (const peer of [...room].reverse()) peer.handlers['presence:sync']?.(); },
        presenceState() { return Object.fromEntries([...presence.values()].map(value => [value.id, [value]])); },
        async send(message) {
          traffic.push(message.payload);
          for (const peer of room) if (peer !== this) queueMicrotask(() => peer.handlers['broadcast:webrtc-signal']?.({ payload: message.payload }));
        },
        async untrack() { presence.delete(this); },
      };
      return channel;
    },
    async removeChannel(channel) { room.delete(channel); presence.delete(channel); },
  };
}

const vite = await createServer({ root: fileURLToPath(new URL('../..', import.meta.url)), configFile: false,
  envFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false } });
const matchers = [];
try {
  const { SupabaseMatchmaker } = await vite.ssrLoadModule('/src/supabase-matchmaker.ts');
  const ids = ['qa-automatic-a', 'qa-automatic-b'];
  const sessions = ids.map((id, i) => ({ profile: { id, nickname: `QA ${i}`, mmr: 1200, classicMmr: 1200 }, ready: null, errors: [], phases: [] }));
  for (const session of sessions) {
    const matcher = new SupabaseMatchmaker(client(), session.profile, 'classic');
    matchers.push(matcher);
    await matcher.startMatching(status => session.phases.push(status.phase),
      (transport, side, matchId, opponent) => { session.ready = { transport, side, matchId, opponent }; },
      error => session.errors.push(error.message));
    await tick();
  }
  for (let i = 0; i < 100 && sessions.some(session => !session.ready); i++) await tick();
  assert.deepEqual(sessions.map(session => session.errors), [[], []]);
  assert.ok(sessions.every(session => session.phases.includes('searching')));
  assert.ok(sessions.every(session => session.ready), 'Both queue clients must connect');
  assert.match(sessions[0].ready.matchId, /^match-/u);
  assert.equal(sessions[0].ready.matchId, sessions[1].ready.matchId);
  assert.deepEqual(sessions.map(session => session.ready.side), ['white', 'black']);
  assert.deepEqual(sessions.map(session => session.ready.opponent.id), ids.toReversed());
  assert.ok(traffic.some(message => message.type === 'offer' && message.matchId === sessions[0].ready.matchId));
  assert.ok(traffic.some(message => message.type === 'answer' && message.matchId === sessions[0].ready.matchId));
  for (const [sender, receiver, side] of [[0, 1, 'white'], [1, 0, 'black']]) {
    const received = [];
    const stop = sessions[receiver].ready.transport.onMessage(message => received.push(message));
    const shot = { kind: 'turn', side, pieceId: `qa-${side}`, impulse: { x: 1, z: 0 } };
    sessions[sender].ready.transport.send(shot);
    await tick();
    assert.deepEqual(received, [shot], `${side} shot traverses transport`);
    stop();
  }
  console.log(`PASS isolated CrazyGames classic queue: menu route, two identities, same ${sessions[0].ready.matchId}, opposite sides, offer/answer, two transport shots`);
} finally {
  for (const matcher of matchers) matcher.cancel();
  await vite.close();
  globalThis.fetch = originalFetch;
}
