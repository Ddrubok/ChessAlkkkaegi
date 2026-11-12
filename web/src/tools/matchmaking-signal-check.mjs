import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import './headless-browser-env.mjs';

const vite = await createServer({ root: fileURLToPath(new URL('../..', import.meta.url)),
  configFile: false, envFile: false, logLevel: 'error', server: { middlewareMode: true, hmr: false } });
const oldDescription = globalThis.RTCSessionDescription;
const oldCandidate = globalThis.RTCIceCandidate;
globalThis.RTCSessionDescription = class { constructor(value) { Object.assign(this, value); } };
globalThis.RTCIceCandidate = class { constructor(value) { Object.assign(this, value); } };

try {
  const { SupabaseMatchmaker } = await vite.ssrLoadModule('/src/supabase-matchmaker.ts');
  const matcher = new SupabaseMatchmaker({}, { id: 'me', nickname: 'Me', mmr: 1200 });
  const applied = [];
  const sent = [];
  let releaseAnswer;
  const pendingAnswer = new Promise(resolve => { releaseAnswer = resolve; });
  matcher.activeMatchId = 'match-current';
  matcher.opponentProfile = { id: 'peer-current', nickname: 'Peer', mmr: 1200 };
  matcher.isHost = true;
  matcher.hostOfferSdp = 'current-offer';
  matcher.sendSignal = async signal => { sent.push(signal); };
  matcher.peerConnection = {
    remoteDescription: null,
    async setRemoteDescription(description) {
      applied.push(description.sdp);
      if (description.sdp === 'current-answer') await pendingAnswer;
      this.remoteDescription = description;
    },
    async addIceCandidate(candidate) { applied.push(candidate.candidate); },
  };
  const signal = (type, matchId, fromId, extra = {}) =>
    ({ type, matchId, fromId, toId: 'me', ...extra });
  await matcher.handleIncomingSignal(signal('answer', 'match-other', 'peer-current', { sdp: 'wrong-match' }));
  await matcher.handleIncomingSignal(signal('answer', 'match-current', 'peer-other', { sdp: 'wrong-peer' }));
  await matcher.handleIncomingSignal(signal('ice', 'match-other', 'peer-current', { candidate: { candidate: 'wrong-ice' } }));
  await matcher.handleIncomingSignal(signal('guest-ready', 'match-current', 'peer-other'));
  assert.deepEqual(applied, []);
  assert.deepEqual(sent, []);

  const firstAnswer = matcher.handleIncomingSignal(signal('answer', 'match-current', 'peer-current', { sdp: 'current-answer' }));
  await Promise.resolve();
  matcher.resetSignalingState();
  matcher.activeMatchId = 'match-new';
  matcher.opponentProfile = { id: 'peer-new', nickname: 'New', mmr: 1200 };
  matcher.isHost = true;
  const nextPc = { remoteDescription: null, async setRemoteDescription(description) {
    this.remoteDescription = description; applied.push(description.sdp);
  }, async addIceCandidate(candidate) { applied.push(candidate.candidate); } };
  matcher.peerConnection = nextPc;
  releaseAnswer();
  await firstAnswer;
  assert.equal(nextPc.remoteDescription, null, 'Old async answer changed the new match');
  await matcher.handleIncomingSignal(signal('answer', 'match-new', 'peer-new', { sdp: 'new-answer' }));
  await matcher.handleIncomingSignal(signal('ice', 'match-new', 'peer-new', { candidate: { candidate: 'new-ice' } }));
  assert.deepEqual(applied, ['current-answer', 'new-answer', 'new-ice']);

  matcher.isHost = false;
  matcher.peerConnection = { localDescription: { type: 'answer', sdp: 'new-local-answer' } };
  await matcher.handleIncomingSignal(signal('offer', 'match-other', 'peer-new', { sdp: 'wrong-offer' }));
  await matcher.handleIncomingSignal(signal('offer', 'match-new', 'peer-other', { sdp: 'wrong-peer-offer' }));
  assert.deepEqual(sent, []);
  await matcher.handleIncomingSignal(signal('offer', 'match-new', 'peer-new', { sdp: 'new-offer' }));
  assert.equal(sent.at(-1)?.sdp, 'new-local-answer');

  matcher.isCancelled = true;
  const count = sent.length;
  await matcher.handleIncomingSignal(signal('offer', 'match-new', 'peer-new', { sdp: 'late-offer' }));
  assert.equal(sent.length, count);
  matcher.processingOffer = true;
  matcher.processingAnswer = true;
  await matcher.cleanup();
  assert.equal(matcher.processingOffer, false);
  assert.equal(matcher.processingAnswer, false);
  const guest = new SupabaseMatchmaker({}, { id: 'me', nickname: 'Me', mmr: 1200 });
  guest.opponentProfile = { id: 'host', nickname: 'Host', mmr: 1200 };
  guest.trackQueueMatch = async () => {};
  guest.startSignalingTimeout = () => {};
  guest.sendSignal = async signal => sent.push(signal);
  const earlyIce = [];
  guest.setupGuestWebRTC = async () => { guest.peerConnection = {
    remoteDescription: null,
    async setRemoteDescription(value) { this.remoteDescription = value; },
    async addIceCandidate(value) { earlyIce.push(value.candidate); },
    async createAnswer() { return { type: 'answer', sdp: 'guest-answer' }; },
    async setLocalDescription(value) { this.localDescription = value; },
  }; };
  await guest.handleIncomingSignal(signal('ice', 'chosen', 'other', { candidate: { candidate: 'wrong-peer' } }));
  await guest.handleIncomingSignal(signal('ice', 'stale', 'host', { candidate: { candidate: 'wrong-match' } }));
  await guest.handleIncomingSignal(signal('ice', 'chosen', 'host', { candidate: { candidate: 'early-host' } }));
  assert.equal(guest.pendingIceCandidates.length, 2);
  await guest.handleIncomingSignal(signal('offer', 'chosen', 'host', { sdp: 'host-offer' }));
  assert.deepEqual(earlyIce, ['early-host'], 'only ICE for the selected host offer may be applied');
  assert.equal(sent.at(-1)?.matchId, 'chosen');
  await guest.cleanup();

  // Same room ID, new connection generation: an old finally cannot unlock new work.
  for (const type of ['offer', 'answer']) {
    const room = new SupabaseMatchmaker({}, { id: 'me', nickname: 'Me', mmr: 1200 });
    const field = type === 'offer' ? 'processingOffer' : 'processingAnswer';
    let releaseOld, releaseNew, remoteCalls = 0;
    const oldGate = new Promise(resolve => { releaseOld = resolve; });
    const newGate = new Promise(resolve => { releaseNew = resolve; });
    const pc = gate => ({ remoteDescription: null,
      async setRemoteDescription(value) { remoteCalls++; await gate; this.remoteDescription = value; },
      async createAnswer() { return { type: 'answer', sdp: 'answer' }; },
      async setLocalDescription(value) { this.localDescription = value; }, close() {},
    });
    const setup = connection => {
      room.activeMatchId = 'same-room'; room.opponentProfile = { id: 'peer', nickname: 'Peer', mmr: 1200 };
      room.isHost = type === 'answer'; room.peerConnection = connection;
      room.setupGuestWebRTC = async () => {}; room.sendSignal = async () => {};
    };
    setup(pc(oldGate));
    const oldWork = room.handleIncomingSignal(signal(type, 'same-room', 'peer', { sdp: 'old' }));
    await Promise.resolve(); await Promise.resolve();
    room.attempt++; await room.cleanup(); setup(pc(newGate));
    const newWork = room.handleIncomingSignal(signal(type, 'same-room', 'peer', { sdp: 'new' }));
    await Promise.resolve(); await Promise.resolve();
    releaseOld(); await oldWork;
    assert.equal(room[field], true, `${type}: stale finally must retain new processing latch`);
    await room.handleIncomingSignal(signal(type, 'same-room', 'peer', { sdp: 'duplicate' }));
    assert.equal(remoteCalls, 2);
    releaseNew(); await newWork;
    assert.equal(room[field], false); await room.cleanup();
  }
  console.log('PASS: unrelated signals, selected peer, stale async answer, new match and cancellation');
} finally {
  globalThis.RTCSessionDescription = oldDescription;
  globalThis.RTCIceCandidate = oldCandidate;
  await vite.close();
}
