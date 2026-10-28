import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import './headless-browser-env.mjs';

const webRoot = fileURLToPath(new URL('../..', import.meta.url));
const vite = await createServer({
  root: webRoot,
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true },
});

class MockIceEvent extends Event {
  constructor(type, init = {}) {
    super(type);
    this.candidate = init.candidate ?? null;
  }
}

class MockPeerConnection extends EventTarget {
  constructor(initialState = {}) {
    super();
    this.iceGatheringState = initialState.iceGatheringState ?? 'new';
    this.connectionState = initialState.connectionState ?? 'new';
    this.signalingState = initialState.signalingState ?? 'stable';
    this.localDescription = initialState.localDescription ?? null;
  }

  close() {
    this.connectionState = 'closed';
    this.signalingState = 'closed';
    this.dispatchEvent(new Event('connectionstatechange'));
  }

  emitCandidate(candidate) {
    if (candidate?.candidate) this.localDescription.sdp += 'a=' + candidate.candidate + '\r\n';
    this.dispatchEvent(new MockIceEvent('icecandidate', { candidate }));
  }

  emitGatheringState(state) {
    this.iceGatheringState = state;
    this.dispatchEvent(new Event('icegatheringstatechange'));
  }
}

try {
  const { waitForIceGatheringComplete, createPeerLink, encodeCode } = await vite.ssrLoadModule('/src/net.ts');

  console.log('--- 1. Testing Normal ICE Gathering Complete ---');
  {
    const pc = new MockPeerConnection({
      iceGatheringState: 'gathering',
      localDescription: {
        type: 'offer',
        sdp: 'v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n',
      },
    });

    const waitPromise = waitForIceGatheringComplete(pc, 200);

    // Candidates gathered early
    pc.emitCandidate({ candidate: 'candidate:1 1 udp 2122260223 192.168.1.1 50000 typ host' });
    pc.emitCandidate({ candidate: 'candidate:2 1 udp 1686052607 203.0.113.1 50000 typ srflx' });

    // Gathering reaches complete normally
    pc.emitGatheringState('complete');

    await waitPromise;
    console.log('PASS: Normal complete resolved promptly');
  }

  console.log('--- 2. Testing Partial Usable Candidates at Deadline (ONL-F01 Fallback) ---');
  {
    const pc = new MockPeerConnection({
      iceGatheringState: 'gathering',
      localDescription: {
        type: 'offer',
        sdp: 'v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n',
      },
    });

    const startTime = Date.now();
    const waitPromise = waitForIceGatheringComplete(pc, 60);

    // Usable candidate gathered at 15ms, but ICE complete hangs (e.g. 40s TURN timeout)
    setTimeout(() => {
      pc.emitCandidate({ candidate: 'candidate:3 1 udp 1686052607 203.0.113.2 50000 typ srflx' });
    }, 15);

    await waitPromise;
    const elapsed = Date.now() - startTime;
    assert.ok(elapsed >= 50, `Expected bounded wait near deadline, elapsed: ${elapsed}ms`);
    assert.equal(pc.iceGatheringState, 'gathering', 'State remains gathering, fallback permitted');
    console.log('PASS: Bounded candidate gathering fallback succeeded at deadline');
  }

  console.log('--- 3. Testing No-Candidate Failure Preservation ---');
  {
    const pc = new MockPeerConnection({
      iceGatheringState: 'gathering',
      localDescription: {
        type: 'offer',
        sdp: 'v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n',
      },
    });

    let errorCaught = null;
    try {
      await waitForIceGatheringComplete(pc, 50);
    } catch (err) {
      errorCaught = err;
    }

    assert.ok(errorCaught !== null, 'Must throw error when 0 candidates were gathered');
    assert.match(
      errorCaught.message,
      /유효한 ICE 후보를 하나도 수집하지 못했습니다/,
      'Error message must indicate failure to collect candidates',
    );
    console.log('PASS: No-candidate failure preserved properly');
  }

  console.log('--- 4. Testing Cancellation and Cleanup ---');
  {
    // 4a: AbortSignal cancellation
    const abortController = new AbortController();
    const pcA = new MockPeerConnection({
      iceGatheringState: 'gathering',
      localDescription: {
        type: 'offer',
        sdp: 'v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n',
      },
    });

    const abortPromise = waitForIceGatheringComplete(pcA, 200, abortController.signal);
    abortController.abort();

    let abortError = null;
    try {
      await abortPromise;
    } catch (err) {
      abortError = err;
    }

    assert.ok(abortError !== null, 'Must reject upon AbortSignal abort');
    assert.equal(abortError.name, 'AbortError');
    assert.equal(getEventListeners(abortController.signal, 'abort').length, 0);
    assert.equal(getEventListeners(pcA, 'icegatheringstatechange').length, 0);
    assert.equal(getEventListeners(pcA, 'connectionstatechange').length, 0);

    // 4b: PeerConnection close cancellation
    const pcB = new MockPeerConnection({
      iceGatheringState: 'gathering',
      localDescription: {
        type: 'offer',
        sdp: 'v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n',
      },
    });

    const closePromise = waitForIceGatheringComplete(pcB, 200);
    pcB.close();

    let closeError = null;
    try {
      await closePromise;
    } catch (err) {
      closeError = err;
    }

    assert.ok(closeError !== null, 'Must reject when peer connection is closed');
    assert.match(closeError.message, /연결이 닫혀/);
    console.log('PASS: Cancellation and cleanup verified');
  }

  {
    const code = await encodeCode({ type: 'offer', sdp: [
      'v=0', 'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
      'a=ice-ufrag:test', 'a=ice-pwd:cancel-test-only', 'a=fingerprint:sha-256 00:00', '',
    ].join('\r\n') });
    const link = createPeerLink();
    const pendingJoin = link.joinWithInvite(code);
    link.close();
    await assert.rejects(pendingJoin, { name: 'AbortError' });
    console.log('PASS: Closing during invite decoding cannot recreate a connection');
  }

  console.log('=== ALL ICE GATHERING CHECKS PASSED! ===');
} finally {
  await vite.close();
}
