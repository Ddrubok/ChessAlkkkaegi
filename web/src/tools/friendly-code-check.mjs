import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import './headless-browser-env.mjs';

const vite = await createServer({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  configFile: false,
  logLevel: 'error',
  server: { middlewareMode: true },
});

try {
  const {
    generateFriendlyRoomCode,
    normalizeFriendlyRoomCode,
    isValidFriendlyRoomCode,
    formatFriendlyRoomCode,
    connectFriendlyCode,
  } = await vite.ssrLoadModule('/src/friendly-code.ts');

  const {
    getFriendlyCopy,
    FRIENDLY_LOCALES,
  } = await vite.ssrLoadModule('/src/friendly-copy.ts');

  console.log('--- 1. Testing Code Generation, Normalization & Formatting ---');
  const code1 = generateFriendlyRoomCode();
  assert.equal(code1.length, 12, 'Room code length must be 12');
  assert.ok(isValidFriendlyRoomCode(code1), 'Generated room code must be valid');

  assert.equal(normalizeFriendlyRoomCode('ab3c-4d5e-6f7g'), 'AB3C4D5E6F7G');
  assert.equal(normalizeFriendlyRoomCode('  ab3c 4d5e 6f7g '), 'AB3C4D5E6F7G');
  assert.equal(isValidFriendlyRoomCode('AB3C-4D5E-6F7G'), true);
  assert.equal(isValidFriendlyRoomCode('INVALID'), false);
  assert.equal(isValidFriendlyRoomCode('01IO12345678'), false, 'Should reject ambiguous chars');

  const formatted = formatFriendlyRoomCode('ABC23456789K');
  assert.equal(formatted, 'ABC2-3456-789K');
  console.log('PASS: Code utils verified');

  console.log('--- 2. Testing 9-Language Localization Copy ---');
  const requiredLocales = ['ko', 'en', 'ja', 'zh-CN', 'de', 'fr', 'es', 'ru', 'pt-BR'];
  const requiredKeys = [
    'title', 'create_room_btn', 'join_room_btn', 'host_waiting',
    'guest_connecting', 'handshake_signaling', 'connected',
    'cancelled_by_host', 'cancelled_by_user', 'invalid_code',
    'room_timeout', 'room_not_found', 'peer_error', 'copy_code',
    'copied', 'enter_code_placeholder', 'friend_challenge_title',
    'guest_code_title', 'room_code_label',
  ];

  for (const loc of requiredLocales) {
    assert.ok(FRIENDLY_LOCALES[loc], `Missing locale: ${loc}`);
    for (const key of requiredKeys) {
      assert.ok(FRIENDLY_LOCALES[loc][key], `Missing key ${key} in ${loc}`);
      const rendered = getFriendlyCopy(key, loc, { code: 'TEST-1234' });
      assert.ok(typeof rendered === 'string' && rendered.length > 0);
    }
  }
  console.log('PASS: 9-language translations complete & verified');

  console.log('--- 3. Testing connectFriendlyCode in Simulated Supabase Realtime Environment ---');

  // Simulated Realtime Bus connecting channels with the same topic
  const channelBus = new Map();

  function createMockSupabaseClient() {
    return {
      getChannels: () => [],
      channel(name, options = {}) {
        const listeners = new Map();
        let isSubscribed = false;

        const ch = {
          topic: name,
          on(event, filter, callback) {
            const key = `${event}:${filter?.event || '*'}`;
            if (!listeners.has(key)) listeners.set(key, []);
            listeners.get(key).push(callback);
            return ch;
          },
          subscribe(callback) {
            isSubscribed = true;
            if (!channelBus.has(name)) channelBus.set(name, new Set());
            channelBus.get(name).add(ch);
            setTimeout(() => {
              if (callback) callback('SUBSCRIBED');
            }, 5);
            return ch;
          },
          async send(message) {
            const topicChannels = channelBus.get(name) || new Set();
            for (const other of topicChannels) {
              if (other === ch && options?.config?.broadcast?.self === false) {
                continue;
              }
              const handlers = other._getHandlers(`broadcast:${message.event}`);
              for (const h of handlers) {
                h({ payload: message.payload });
              }
            }
          },
          _getHandlers(key) {
            return listeners.get(key) || [];
          },
          _close() {
            if (channelBus.has(name)) {
              channelBus.get(name).delete(ch);
            }
          },
        };
        return ch;
      },
      async removeChannel(ch) {
        ch._close();
      },
    };
  }

  function createMockPeerLink() {
    let state = 'idle';
    const stateListeners = new Set();
    const messageListeners = new Set();

    const link = {
      get disconnectCause() { return null; },
      async createHost() {
        state = 'waiting-answer';
        link._emitState('waiting-answer');
        return 'MOCK_OFFER_SDP_CODE';
      },
      async joinWithInvite(offerCode) {
        assert.equal(offerCode, 'MOCK_OFFER_SDP_CODE');
        state = 'connecting';
        link._emitState('connecting');
        return 'MOCK_ANSWER_SDP_CODE';
      },
      async acceptAnswer(answerCode) {
        assert.equal(answerCode, 'MOCK_ANSWER_SDP_CODE');
        state = 'connected';
        link._emitState('connected');
      },
      send(payload) {},
      onMessage(handler) {
        messageListeners.add(handler);
        return () => messageListeners.delete(handler);
      },
      onStateChange(handler) {
        stateListeners.add(handler);
        handler(state);
        return () => stateListeners.delete(handler);
      },
      close() {
        state = 'disconnected';
        link._emitState('disconnected');
      },
      _emitState(s) {
        state = s;
        for (const l of stateListeners) l(s);
      },
      _mockConnectGuest() {
        state = 'connected';
        link._emitState('connected');
      },
    };
    return link;
  }

  // TEST 3.1: Host Creates Room, Guest Joins, Handshake Completes
  {
    const client = createMockSupabaseClient();
    const hostLink = createMockPeerLink();
    const guestLink = createMockPeerLink();

    let hostCreatedCode = '';
    let hostReady = false;
    let guestReady = false;

    const hostSession = connectFriendlyCode(client, hostLink, null, {
      onRoomCreated(code) {
        hostCreatedCode = code;
      },
      onReady(link, role, code) {
        assert.equal(role, 'host');
        hostReady = true;
      },
    }, { retryIntervalMs: 50, timeoutMs: 2000 });

    // Wait for Host to subscribe & create room
    await new Promise(r => setTimeout(r, 30));
    assert.ok(hostCreatedCode.length === 12);

    const guestSession = connectFriendlyCode(client, guestLink, hostCreatedCode, {
      onReady(link, role, code) {
        assert.equal(role, 'guest');
        guestReady = true;
      },
    }, { retryIntervalMs: 50, timeoutMs: 2000 });

    // Wait for simulated signaling exchange
    await new Promise(r => setTimeout(r, 100));

    // Simulate guest link transitioning to connected after answer ack
    guestLink._mockConnectGuest();

    await new Promise(r => setTimeout(r, 50));
    assert.ok(hostReady, 'Host must be ready');
    assert.ok(guestReady, 'Guest must be ready');
    console.log('PASS: Host-Guest handshake established successfully');
  }

  // TEST 3.2: Invalid Code Rejection
  {
    const client = createMockSupabaseClient();
    const guestLink = createMockPeerLink();
    let errorCaught = false;

    connectFriendlyCode(client, guestLink, 'INVALID_123', {
      onError(err) {
        errorCaught = true;
      },
    });

    assert.ok(errorCaught, 'Invalid code must trigger onError immediately');
    console.log('PASS: Invalid code rejected');
  }

  // TEST 3.3: Host Cancellation Broadcast to Guest
  {
    const client = createMockSupabaseClient();
    const hostLink = createMockPeerLink();
    const guestLink = createMockPeerLink();

    let hostCode = '';
    let guestErrorMsg = '';

    const hostSession = connectFriendlyCode(client, hostLink, null, {
      onRoomCreated(code) { hostCode = code; },
    }, { retryIntervalMs: 500, timeoutMs: 2000 });

    await new Promise(r => setTimeout(r, 20));

    // Override host acceptAnswer to prevent instant connection
    hostLink.acceptAnswer = async () => {};

    const guestSession = connectFriendlyCode(client, guestLink, hostCode, {
      onError(err) {
        guestErrorMsg = err.message;
      },
    }, { retryIntervalMs: 500, timeoutMs: 2000 });

    await new Promise(r => setTimeout(r, 20));

    // Host cancels room
    hostSession.cancel();

    await new Promise(r => setTimeout(r, 50));
    assert.ok(guestErrorMsg.length > 0, 'Guest should receive cancellation error');
    console.log('PASS: Host cancellation properly handled by guest');
  }

  // TEST 3.4: Timeout Handling
  {
    const client = createMockSupabaseClient();
    const hostLink = createMockPeerLink();
    let timeoutError = false;

    const hostSession = connectFriendlyCode(client, hostLink, null, {
      onError(err) {
        timeoutError = true;
      },
    }, { retryIntervalMs: 20, timeoutMs: 100 });

    await new Promise(r => setTimeout(r, 150));
    assert.ok(timeoutError, 'Unanswered room must time out');
    console.log('PASS: Timeout error handled properly');
  }

  console.log('=== ALL FRIENDLY MATCH & CODE TESTS PASSED! ===');
} finally {
  await vite.close();
}
