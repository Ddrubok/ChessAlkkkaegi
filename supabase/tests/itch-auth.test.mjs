import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHandler } from '../functions/itch-auth/core.ts';

const base = 'https://yoajmckkrpgvcljrffww.supabase.co/functions/v1/itch-auth';
const origin = 'https://html-classic.itch.zone';
const state = 's'.repeat(43);
const verifier = 'v'.repeat(43);
const challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString('base64url');
const userId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const user = (id = userId, email = 'person@example.com') => ({ id, email, is_anonymous: false });
const ok = data => ({ data, error: null });
const missing = { data: null, error: { status: 404 } };
function fixture({ link = false, provider = 'ok', existingIdentity = null, existingUser = null, authUser = user(), now = Date.now() } = {}) {
  const rows = new Map(), identities = new Map(), users = new Map(), admitted = [];
  if (existingIdentity) identities.set('42', existingIdentity);
  if (existingUser) users.set(existingUser.id, existingUser);
  if (link) users.set(userId, user());
  const calls = { exchange: 0, create: 0, mint: 0, profile: 0 };
  const store = {
    async start(hash, code_challenge, link_user_id) {
      if (rows.has(hash) && Date.parse(rows.get(hash).expires_at) > now) return 'duplicate';
      rows.delete(hash);
      for (const [key, row] of rows) if (Date.parse(row.expires_at) <= now) rows.delete(key);
      if (admitted.filter(time => time > now - 60_000).length >= 60 || [...rows.values()].filter(row => Date.parse(row.expires_at) > now).length >= 200) return 'rate_limited';
      admitted.push(now);
      rows.set(hash, { code_challenge, link_user_id, expires_at: new Date(now + 300_000).toISOString(), callback_code: null, callback_error: null, claimed_at: null });
      return 'started';
    },
    async pending(hash) { return rows.get(hash) ?? null; },
    async callback(hash, code, error) { const row = rows.get(hash); if (!row || row.claimed_at || row.callback_code || row.callback_error || Date.parse(row.expires_at) <= now) return false; row.callback_code = code; row.callback_error = error; return true; },
    async claim(hash, proof) { const row = rows.get(hash); if (!row || row.claimed_at || row.code_challenge !== proof || (!row.callback_code && !row.callback_error)) return null; row.claimed_at = new Date(now).toISOString(); const result = { code: row.callback_code, error: row.callback_error, link_user_id: row.link_user_id }; row.callback_code = null; return result; },
    async cancel(hash, proof) { const row = rows.get(hash); if (row?.code_challenge === proof && !row.claimed_at) rows.delete(hash); },
    async identity(itchId) { return identities.get(itchId) ?? null; },
    async identityForUser(id) { return [...identities].find(([, v]) => v === id)?.[0] ?? null; },
    async bind(itchId, id) { if (identities.has(itchId) || [...identities.values()].includes(id)) return false; identities.set(itchId, id); return true; },
  };
  const admin = { auth: {
    getUser: async token => token === 'a'.repeat(30) ? ok({ user: authUser }) : token === 'b'.repeat(30) ? ok({ user: user(otherId) }) : token === 'access' ? ok({ user: users.get([...identities.values()][0]) ?? users.get(userId) ?? null }) : missing,
    admin: {
      getUserById: async id => users.has(id) ? ok({ user: users.get(id) }) : missing,
      createUser: async attrs => { calls.create++; const made = { id: attrs.id, email: attrs.email, app_metadata: attrs.app_metadata, is_anonymous: false }; users.set(made.id, made); return ok({ user: made }); },
      generateLink: async ({ email }) => { calls.mint++; return ok({ user: [...users.values()].find(u => u.email === email), properties: { hashed_token: 'hash' } }); },
    },
  }, from: () => ({ select: () => ({ eq: (_field, id) => ({ maybeSingle: async () => ok(calls.profile ? { id } : null) }) }), insert: async () => { calls.profile++; return { error: null }; } }) };
  const sessionClient = () => ({ auth: { verifyOtp: async () => { const id = [...identities.values()][0]; const u = users.get(id); return { data: { user: u, session: { access_token: 'access', refresh_token: 'refresh', user: u } }, error: null }; } } });
  const fetcher = async (url, init) => {
    if (url.endsWith('/oauth/token')) { calls.exchange++; assert.equal(init.body.get('client_id'), 'client_1'); assert.equal(init.body.get('code_verifier'), verifier); return provider === 'token-error' ? new Response('{}', { status: 400 }) : new Response(JSON.stringify(provider === 'bad-token' ? { access_token: 'secret', token_type: 'bearer', scope: 'profile:games' } : { access_token: 'secret', token_type: 'bearer', scope: 'profile:me' })); }
    assert.equal(init.headers.Authorization, 'Bearer secret');
    return new Response(JSON.stringify(provider === 'bad-profile' ? { user: { username: 'player' } } : { user: { id: 42, username: 'player' } }));
  };
  const h = createHandler({ store, admin, sessionClient, clientId: 'client_1', allowedOrigins: [origin, 'https://html.itch.zone'], fetcher, now: () => now });
  return { h, rows, identities, users, calls };
}
function post(h, action, values = {}, headers = {}) { return h(new Request(base, { method: 'POST', headers: { origin, 'content-type': 'application/json', ...headers }, body: JSON.stringify({ action, state, ...values }) })); }
function cb(h, query) { return h(new Request(`${base}/callback?${query}`)); }
async function started(f, link = false) { const result = await post(f.h, 'start', { codeChallenge: challenge, linkAccount: link }, link ? { authorization: `Bearer ${'a'.repeat(30)}` } : {}); assert.equal(result.status, 200); return result.json(); }
const finish = (f, values = {}, headers = {}) => post(f.h, 'finish', { codeVerifier: verifier, ...values }, headers);

test('start fixes OAuth parameters and callback is plain text without secrets', async () => {
  const f = fixture(); const { authorizeUrl, expiresIn } = await started(f);
  const u = new URL(authorizeUrl); assert.equal(expiresIn, 300); assert.equal(u.origin, 'https://itch.io'); assert.equal(u.searchParams.get('scope'), 'profile:me'); assert.equal(u.searchParams.get('code_challenge'), challenge); assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal((await finish(f)).status, 202);
  const response = await cb(f.h, `code=code-secret&state=${state}`); assert.equal(response.status, 200); const text = await response.text(); assert.doesNotMatch(text, /code-secret|access|refresh/);
  assert.equal((await finish(f)).status, 200); assert.equal(f.calls.exchange, 1); assert.equal(f.calls.create, 1); assert.equal(f.calls.mint, 1);
  assert.equal((await finish(f)).status, 400);
});
test('start rejects the 61st global request and preserves duplicate status with spoofable Origin', async () => {
  const f = fixture();
  for (let i = 0; i < 60; i++) {
    const response = await post(f.h, 'start', { state: String(i).padStart(43, 's'), codeChallenge: challenge, linkAccount: false }, { origin: i % 2 ? origin : 'https://html.itch.zone' });
    assert.equal(response.status, 200);
  }
  const duplicate = await post(f.h, 'start', { state: String(0).padStart(43, 's'), codeChallenge: challenge, linkAccount: false });
  assert.equal(duplicate.status, 409);
  assert.deepEqual(await duplicate.json(), { error: 'attempt_exists' });
  const throttled = await post(f.h, 'start', { state: 'new'.padStart(43, 's'), codeChallenge: challenge, linkAccount: false }, { origin: 'https://html.itch.zone', 'x-forwarded-for': '198.51.100.40' });
  assert.equal(throttled.status, 429);
  assert.deepEqual(await throttled.json(), { error: 'rate_limited' });
  assert.equal(f.rows.size, 60);
});
test('start rejects when 200 live attempts occupy the shared pending cap', async () => {
  const f = fixture();
  for (let i = 0; i < 200; i++) f.rows.set(i.toString(16).padStart(64, '0'), { expires_at: new Date(Date.now() + 300_000).toISOString() });
  const response = await post(f.h, 'start', { codeChallenge: challenge, linkAccount: false });
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), { error: 'rate_limited' });
  assert.equal(f.rows.size, 200);
});
test('wrong state and verifier cannot consume, cancel, or exchange', async () => {
  const f = fixture(); await started(f);
  assert.equal((await cb(f.h, `code=secret&state=${'z'.repeat(43)}`)).status, 400);
  assert.equal((await post(f.h, 'cancel', { codeVerifier: 'x'.repeat(43) })).status, 400);
  assert.equal((await finish(f, { codeVerifier: 'x'.repeat(43) })).status, 400);
  assert.equal((await cb(f.h, `code=code-secret&state=${state}`)).status, 200);
  assert.equal((await finish(f, { state: 'z'.repeat(43) })).status, 400);
  assert.equal((await finish(f)).status, 200); assert.equal(f.calls.exchange, 1);
});
test('concurrent finish claims exactly once', async () => {
  const f = fixture(); await started(f); await cb(f.h, `code=code-secret&state=${state}`);
  const results = await Promise.all([finish(f), finish(f)]);
  assert.equal(results.filter(r => r.status === 200).length, 1); assert.ok([400, 409].includes(results.find(r => r.status !== 200)?.status)); assert.equal(f.calls.exchange, 1);
});
test('expired attempt, denial and duplicate callback fail closed', async () => {
  const f = fixture(); await started(f); const row = [...f.rows.values()][0]; row.expires_at = new Date(Date.now() - 1000).toISOString();
  assert.equal((await cb(f.h, `code=code-secret&state=${state}`)).status, 400); assert.equal((await finish(f)).status, 400);
  const denied = fixture(); await started(denied); assert.equal((await cb(denied.h, `error=access_denied&state=${state}`)).status, 200);
  assert.equal((await cb(denied.h, `code=another&state=${state}`)).status, 400);
  assert.equal((await finish(denied)).status, 403); assert.equal(denied.calls.exchange, 0);
});
test('origin, callback shape, body size and link ownership rejection', async () => {
  const f = fixture({ link: true });
  assert.equal((await post(f.h, 'start', { codeChallenge: challenge, linkAccount: true })).status, 401);
  await started(f, true);
  assert.equal((await post(f.h, 'finish', { codeVerifier: verifier }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await cb(f.h, `code=a&error=access_denied&state=${state}`)).status, 400);
  await cb(f.h, `code=code-secret&state=${state}`);
  assert.equal((await finish(f)).status, 401);
  assert.equal((await finish(f, {}, { authorization: `Bearer ${'b'.repeat(30)}` })).status, 403);
  assert.equal((await finish(f, {}, { authorization: `Bearer ${'a'.repeat(30)}` })).status, 200);
  const big = await post(f.h, 'start', { codeChallenge: challenge, linkAccount: false, padding: 'x'.repeat(5000) }); assert.equal(big.status, 413);
});
test('provider failures consume attempt and never mint a session', async () => {
  for (const provider of ['token-error', 'bad-token', 'bad-profile']) {
    const f = fixture({ provider }); await started(f); await cb(f.h, `code=code-secret&state=${state}`);
    assert.equal((await finish(f)).status, 502); assert.equal((await finish(f)).status, 400); assert.equal(f.calls.mint, 0);
  }
});
test('identity collision and no automatic email linking', async () => {
  const collision = fixture({ link: true, existingIdentity: otherId, existingUser: user(otherId) }); await started(collision, true); await cb(collision.h, `code=code-secret&state=${state}`);
  assert.equal((await finish(collision, {}, { authorization: `Bearer ${'a'.repeat(30)}` })).status, 409);
  const f = fixture({ existingUser: user(otherId) }); await started(f); await cb(f.h, `code=code-secret&state=${state}`);
  const response = await finish(f); assert.equal(response.status, 200); assert.equal(f.calls.create, 1); assert.notEqual(f.identities.get('42'), otherId);
});
test('mapped banned user is rejected without minting or creating another account', async () => {
  const f = fixture({ existingIdentity: otherId, existingUser: { ...user(otherId), banned_until: '2099-01-01T00:00:00Z' } });
  await started(f); await cb(f.h, `code=code-secret&state=${state}`);
  assert.equal((await finish(f)).status, 409); assert.equal(f.calls.create, 0); assert.equal(f.calls.mint, 0);
});
