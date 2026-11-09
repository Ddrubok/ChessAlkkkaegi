import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accountId, createHandler, verifyCrazyToken } from '../functions/crazygames-auth/core.ts';

const gameId = '20267';
const userId = 'UOuZBKgjwpY9k4TSBB2NPugbsHD3';
const origin = 'https://www.crazygames.com';
const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'ingame-auth', alg: 'RS256', use: 'sig' };
const jwksFetch = async (url) => { assert.equal(url, 'https://userportal.crazygames.com/.well-known/jwks.json'); return new Response(JSON.stringify({ keys: [jwk] })); };
const b64 = (value) => Buffer.from(value instanceof Uint8Array ? value : typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
async function token(payload = {}, header = {}) {
  const head = b64({ alg: 'RS256', kid: 'ingame-auth', ...header });
  const body = b64({ userId, gameId, iat: now - 10, exp: now + 3500, ...payload });
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${b64(signature)}`;
}
const id = await accountId(gameId, userId);
const email = `cg-${id.replace(/-/g, '')}@accounts.crazygames.invalid`;
const binding = { crazygames: { game_id: gameId, user_id: userId } };
const user = { id, email, app_metadata: binding, is_anonymous: false };
const ok = (data) => ({ data, error: null });
const err = (status, code) => ({ data: null, error: { status, code } });
function mock({ existing = null, getError = null, createError = null, created = user, profile = null, linkError = null, otpError = null, otpUser = user, issuedUser = user } = {}) {
  const calls = { create: 0, insert: 0, link: 0, inserted: null, created: null };
  let account = existing;
  let row = profile;
  const admin = {
    auth: {
      getUser: async () => issuedUser ? ok({ user: issuedUser }) : err(401, 'invalid_token'),
      admin: {
        getUserById: async () => getError ?? (account ? ok({ user: account }) : err(404, 'user_not_found')),
        createUser: async (value) => { calls.create++; calls.created = value; if (createError) { if (created) account = created; return createError; } account = created; return ok({ user: created }); },
        generateLink: async () => { calls.link++; return linkError ?? ok({ user: account, properties: { hashed_token: 'hash-secret' } }); },
      },
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }),
      insert: async (value) => { calls.insert++; calls.inserted = value; row = { id: value.id }; return { error: null }; },
    }),
  };
  const sessionClient = () => ({ auth: { verifyOtp: async () => otpError ?? { data: { user: otpUser, session: { access_token: 'access', refresh_token: 'refresh', user: otpUser } }, error: null } } });
  return { admin, sessionClient, calls };
}
function request(value, headers = {}) { return new Request('https://example.supabase.co/functions/v1/crazygames-auth', { method: 'POST', headers: { origin, apikey: 'public', 'content-type': 'application/json', ...headers }, body: JSON.stringify(value) }); }
function handler(m, extra = {}) { return createHandler({ ...m, gameId, allowedOrigins: [origin], jwksFetch, ...extra }); }
const response = async (res) => [res.status, await res.json()];

test('valid RS256 token creates bound Supabase user and ordinary session; repeat preserves profile', async () => {
  const m = mock(); const h = handler(m); const signed = await token();
  assert.deepEqual(await response(await h(request({ token: signed }))), [200, { session: { access_token: 'access', refresh_token: 'refresh' } }]);
  assert.deepEqual(await response(await h(request({ token: signed }))), [200, { session: { access_token: 'access', refresh_token: 'refresh' } }]);
  assert.equal(m.calls.create, 1); assert.equal(m.calls.insert, 1); assert.equal(m.calls.link, 2);
  assert.deepEqual(m.calls.created, { id, email, email_confirm: true, app_metadata: binding });
  assert.deepEqual(m.calls.inserted, { id, nickname: `CG_${id.replace(/-/g, '').slice(0, 16)}` });
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('rejects expired, future, wrong game, forged, critical-header, and legacy tokens', async () => {
  const valid = await token();
  const [head, , signature] = valid.split('.');
  const cases = [await token({ exp: now - 1 }), await token({ iat: now + 120 }), await token({ nbf: now + 120 }), await token({ gameId: 'other' }),
    `${head}.${b64({ userId: 'forged', gameId, iat: now - 10, exp: now + 3500 })}.${signature}`,
    await token({}, { crit: ['unrecognized'], unrecognized: true }), await token({}, { kid: 'ingame-auth-legacy' }), await token({}, { alg: 'HS256' }), 'fake-token'];
  for (const signed of cases) assert.equal((await response(await handler(mock())(request({ token: signed }))))[0], 401);
  assert.equal((await response(await handler(mock(), { gameId: '' })(request({ token: valid }))))[0], 503);
});

test('uses cached official JWKS and fails closed when JWKS is malformed', async () => {
  const signed = await token();
  let fetches = 0;
  const cachedFetch = async (url) => { fetches++; return jwksFetch(url); };
  await verifyCrazyToken(signed, gameId, cachedFetch);
  await verifyCrazyToken(signed, gameId, cachedFetch);
  assert.equal(fetches, 1);
  const malformedFetch = async () => new Response(JSON.stringify({ keys: [{ kid: 'ingame-auth', kty: 'RSA', n: 'bad', e: 'AQAB' }] }));
  await assert.rejects(verifyCrazyToken(signed, gameId, malformedFetch), (error) => error.status === 503 && error.code === 'verification_unavailable');
});

test('rejects account collision and banned account', async () => {
  const signed = await token();
  for (const existing of [{ ...user, app_metadata: {} }, { ...user, email: 'victim@example.com' }, { ...user, banned_until: '2099-01-01T00:00:00Z' }]) {
    const m = mock({ existing });
    assert.equal((await response(await handler(m)(request({ token: signed }))))[0], 409);
    assert.equal(m.calls.link, 0);
  }
});

test('creation race resolves only to correctly bound account; admin failure is distinct from missing', async () => {
  const signed = await token();
  assert.equal((await response(await handler(mock({ createError: err(422, 'email_exists') }))(request({ token: signed }))))[0], 200);
  assert.equal((await response(await handler(mock({ getError: err(500, 'db_down') }))(request({ token: signed }))))[0], 502);
  const m = mock({ createError: err(500, 'db_down'), created: null });
  assert.equal((await response(await handler(m)(request({ token: signed }))))[1].error, 'account_unavailable');
  const collision = mock({ createError: err(422, 'duplicate'), created: { ...user, app_metadata: {} } });
  assert.deepEqual(await response(await handler(collision)(request({ token: signed }))), [409, { error: 'account_collision' }]);
});

test('rejects failed or mismatched minted sessions', async () => {
  const signed = await token();
  for (const m of [mock({ linkError: err(403, 'banned') }), mock({ linkError: ok({ user: { ...user, id: crypto.randomUUID() }, properties: { hashed_token: 'hash-secret' } }) }), mock({ otpError: { data: { user: null, session: null }, error: { status: 403 } } }), mock({ otpUser: { ...user, id: crypto.randomUUID() } }), mock({ issuedUser: null }), mock({ issuedUser: { ...user, banned_until: '2099-01-01T00:00:00Z' } })]) {
    assert.deepEqual(await response(await handler(m)(request({ token: signed }))), [502, { error: 'session_unavailable' }]);
  }
});

test('CORS, preflight, method, and streamed body limits', async () => {
  const h = handler(mock());
  const preflight = await h(new Request('https://example.supabase.co/functions/v1/crazygames-auth', { method: 'OPTIONS', headers: { origin, 'access-control-request-headers': 'apikey,authorization,content-type,x-client-info' } }));
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
  assert.match(preflight.headers.get('access-control-allow-headers'), /x-client-info/);
  assert.equal((await h(new Request('https://example.supabase.co/functions/v1/crazygames-auth', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }))).status, 403);
  assert.equal((await h(new Request('https://example.supabase.co/functions/v1/crazygames-auth', { method: 'GET', headers: { origin } }))).status, 405);
  assert.equal((await h(request({ token: 'x'.repeat(10000) }))).status, 413);
  assert.equal((await h(request({ token: 'x' }, { 'content-length': '10000' }))).status, 413);
  assert.equal((await h(request({ token: 'x' }, { 'content-type': 'text/plain' }))).status, 415);
  assert.equal((await h(request({ token: await token() }, { apikey: 'sb_publishable_client_key', 'x-client-info': 'supabase-js-web/2' }))).status, 200);
});
