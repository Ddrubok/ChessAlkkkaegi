const encoder = new TextEncoder();
const callbackUrl = "https://yoajmckkrpgvcljrffww.supabase.co/functions/v1/itch-auth/callback";
const statePattern = /^[A-Za-z0-9_-]{43}$/;
const challengePattern = /^[A-Za-z0-9_-]{43}$/;
const verifierPattern = /^[A-Za-z0-9_-]{43,128}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type User = { id: string; email?: string; is_anonymous?: boolean; banned_until?: string | null; app_metadata?: Record<string, unknown> };
type Pending = { code_challenge: string; callback_code: string | null; callback_error: string | null; link_user_id: string | null; expires_at: string; claimed_at: string | null };
type Claim = { code: string | null; error: string | null; link_user_id: string | null };
type Result<T> = { data: T | null; error: unknown };
export type Store = {
  start(hash: string, challenge: string, linkUserId: string | null): Promise<"started" | "duplicate" | "rate_limited">;
  pending(hash: string): Promise<Pending | null>;
  callback(hash: string, code: string | null, error: string | null): Promise<boolean>;
  claim(hash: string, challenge: string): Promise<Claim | null>;
  cancel(hash: string, challenge: string): Promise<void>;
  identity(itchId: string): Promise<string | null>;
  identityForUser(userId: string): Promise<string | null>;
  bind(itchId: string, userId: string): Promise<boolean>;
};
export type Admin = { auth: {
  getUser(token: string): Promise<Result<{ user: User | null }>>;
  admin: {
    getUserById(id: string): Promise<Result<{ user: User | null }>>;
    createUser(value: Record<string, unknown>): Promise<Result<{ user: User | null }>>;
    generateLink(value: { type: "magiclink"; email: string }): Promise<Result<{ user: User | null; properties?: { hashed_token?: string } }>>;
  };
}; from(table: string): { select(columns: string): { eq(column: string, value: string): { maybeSingle(): PromiseLike<Result<{ id: string }>> } }; insert(value: Record<string, unknown>): PromiseLike<{ error: unknown }> } };
export type SessionClient = { auth: { verifyOtp(value: { token_hash: string; type: "magiclink" }): Promise<{ data: { user: User | null; session: { access_token?: string; refresh_token?: string; user?: User } | null }; error: unknown }> } };
export type Dependencies = { store: Store; admin: Admin; sessionClient: () => SessionClient; clientId: string; allowedOrigins: string[]; fetcher?: typeof fetch; now?: () => number };
class Failure extends Error { status: number; code: string; constructor(status: number, code: string) { super(code); this.status = status; this.code = code; } }
function fail(status: number, code: string): never { throw new Failure(status, code); }
const sha = async (value: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)))].map(x => x.toString(16).padStart(2, "0")).join("");
const challenge = async (verifier: string) => {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(verifier)));
  let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
export async function accountId(itchId: string): Promise<string> {
  const hash = await sha(`itch-auth:v1\0${itchId}`);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
function active(user: User | null | undefined, id: string): user is User {
  return !!user && user.id === id && user.is_anonymous !== true && (!user.banned_until || (Number.isFinite(Date.parse(user.banned_until)) && Date.parse(user.banned_until) <= Date.now()));
}
async function getUser(admin: Admin, id: string): Promise<User | null> {
  const result = await admin.auth.admin.getUserById(id);
  if (result.error) {
    if ((result.error as { status?: number }).status === 404) return null;
    fail(502, "account_unavailable");
  }
  return result.data?.user ?? null;
}
async function profile(admin: Admin, id: string): Promise<void> {
  const lookup = () => admin.from("profiles").select("id").eq("id", id).maybeSingle();
  const old = await lookup(); if (old.error) fail(502, "profile_unavailable");
  if (old.data) return;
  const inserted = await admin.from("profiles").insert({ id, nickname: `IT_${id.replace(/-/g, "").slice(0, 16)}` });
  if (inserted.error && !(await lookup()).data) fail(502, "profile_unavailable");
}
async function readJson(response: Response, max = 8192): Promise<unknown> {
  const text = await response.text();
  if (text.length > max) fail(502, "provider_unavailable");
  try { return JSON.parse(text); } catch { fail(502, "provider_unavailable"); }
}
async function exchange(deps: Dependencies, code: string, verifier: string): Promise<{ id: string; username: string }> {
  const fetcher = deps.fetcher ?? fetch;
  const body = new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: callbackUrl, client_id: deps.clientId });
  let tokenResponse: Response;
  try { tokenResponse = await fetcher("https://api.itch.io/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(8000) }); }
  catch { fail(502, "provider_unavailable"); }
  if (!tokenResponse!.ok) fail(502, "provider_unavailable");
  const token = await readJson(tokenResponse!) as Record<string, unknown>;
  if (!token || typeof token.access_token !== "string" || !token.access_token || token.access_token.length > 4096 || String(token.token_type).toLowerCase() !== "bearer" || typeof token.scope !== "string" || !token.scope.split(/\s+/).includes("profile:me")) fail(502, "provider_unavailable");
  let profileResponse: Response;
  try { profileResponse = await fetcher("https://api.itch.io/profile", { headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(8000) }); }
  catch { fail(502, "provider_unavailable"); }
  if (!profileResponse!.ok) fail(502, "provider_unavailable");
  const value = await readJson(profileResponse!) as Record<string, unknown>;
  const user = value?.user as Record<string, unknown> | undefined;
  const id = typeof user?.id === "number" && Number.isSafeInteger(user.id) ? String(user.id) : user?.id;
  if (typeof id !== "string" || !/^[0-9]{1,32}$/.test(id) || typeof user?.username !== "string" || !user.username || user.username.length > 128) fail(502, "provider_unavailable");
  return { id, username: user.username };
}
async function currentUser(deps: Dependencies, request: Request): Promise<User> {
  const header = request.headers.get("authorization") ?? "";
  if (!/^Bearer [A-Za-z0-9._-]{20,8192}$/.test(header)) fail(401, "authentication_required");
  const result = await deps.admin.auth.getUser(header.slice(7));
  const user = result.data?.user;
  if (result.error || !user || !uuidPattern.test(user.id) || !active(user, user.id)) fail(401, "authentication_required");
  return user;
}
async function issue(deps: Dependencies, id: string): Promise<{ access_token: string; refresh_token: string }> {
  const user = await getUser(deps.admin, id);
  if (!active(user, id) || !user.email) fail(409, "account_unavailable");
  const link = await deps.admin.auth.admin.generateLink({ type: "magiclink", email: user.email });
  const hash = link.data?.properties?.hashed_token;
  if (link.error || !hash || link.data?.user?.id !== id) fail(502, "session_unavailable");
  const otp = await deps.sessionClient().auth.verifyOtp({ token_hash: hash, type: "magiclink" });
  const session = otp.data?.session;
  if (otp.error || !session?.access_token || !session.refresh_token || !active(otp.data?.user, id) || !active(session.user, id)) fail(502, "session_unavailable");
  const checked = await deps.admin.auth.getUser(session.access_token);
  if (checked.error || !active(checked.data?.user, id)) fail(502, "session_unavailable");
  return { access_token: session.access_token, refresh_token: session.refresh_token };
}
async function resolve(deps: Dependencies, itchId: string, linkUserId: string | null): Promise<string> {
  const mapped = await deps.store.identity(itchId);
  if (linkUserId) {
    if (mapped && mapped !== linkUserId) fail(409, "account_collision");
    const bound = await deps.store.identityForUser(linkUserId);
    if (bound && bound !== itchId) fail(409, "account_collision");
    if (!active(await getUser(deps.admin, linkUserId), linkUserId)) fail(409, "account_unavailable");
    if (!mapped && !(await deps.store.bind(itchId, linkUserId)) && await deps.store.identity(itchId) !== linkUserId) fail(409, "account_collision");
    return linkUserId;
  }
  if (mapped) { if (!active(await getUser(deps.admin, mapped), mapped)) fail(409, "account_unavailable"); return mapped; }
  const id = await accountId(itchId);
  const email = `itch-${id.replace(/-/g, "")}@accounts.itch.invalid`;
  let user = await getUser(deps.admin, id);
  if (!user) {
    const created = await deps.admin.auth.admin.createUser({ id, email, email_confirm: true, app_metadata: { itch_id: itchId } });
    user = created.error ? await getUser(deps.admin, id) : created.data?.user ?? null;
  }
  if (!active(user, id) || user.email !== email || user.app_metadata?.itch_id !== itchId) fail(409, "account_collision");
  if (!(await deps.store.bind(itchId, id))) {
    const winner = await deps.store.identity(itchId);
    if (winner !== id) fail(409, "account_collision");
  }
  await profile(deps.admin, id);
  return id;
}
export function createHandler(deps: Dependencies): (request: Request) => Promise<Response> {
  const allowed = new Set(deps.allowedOrigins);
  return async (request) => {
    const origin = request.headers.get("origin");
    const headers = new Headers({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" });
    if (origin && allowed.has(origin)) {
      headers.set("Access-Control-Allow-Origin", origin); headers.set("Vary", "Origin");
      headers.set("Access-Control-Allow-Methods", "POST, OPTIONS"); headers.set("Access-Control-Allow-Headers", "apikey, authorization, content-type, x-client-info");
    }
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: new Headers({ ...Object.fromEntries(headers), "Content-Type": "application/json" }) });
    try {
      const path = new URL(request.url).pathname;
      const isCallback = path.endsWith("/itch-auth/callback");
      if (isCallback) {
        if (request.method !== "GET") fail(405, "method_not_allowed");
        if (request.url.length > 4096) fail(400, "invalid_callback");
        const params = new URL(request.url).searchParams;
        const state = params.get("state"), code = params.get("code"), error = params.get("error");
        if (params.getAll("state").length !== 1 || params.getAll("code").length > 1 || params.getAll("error").length > 1 || !state || !statePattern.test(state) || (code !== null) === (error !== null) || (code !== null && (code.length < 1 || code.length > 2048)) || (error !== null && error !== "access_denied")) fail(400, "invalid_callback");
        const saved = await deps.store.callback(await sha(state), code, error);
        if (!saved) fail(400, "invalid_callback");
        headers.set("Content-Type", "text/plain; charset=utf-8");
        return new Response("You can close this window and return to the game.", { status: 200, headers });
      }
      if (origin && !allowed.has(origin)) fail(403, "origin_forbidden");
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
      if (request.method !== "POST") fail(405, "method_not_allowed");
      if (!origin || !allowed.has(origin)) fail(403, "origin_forbidden");
      if (!deps.clientId || !/^[A-Za-z0-9_-]{1,128}$/.test(deps.clientId)) fail(503, "configuration_error");
      if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) fail(415, "invalid_content_type");
      if (Number(request.headers.get("content-length")) > 4096) fail(413, "body_too_large");
      const reader = request.body?.getReader(); if (!reader) fail(400, "invalid_body");
      const chunks: Uint8Array[] = []; let size = 0;
      while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > 4096) { await reader.cancel(); fail(413, "body_too_large"); } chunks.push(next.value); }
      const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      let body: Record<string, unknown>;
      try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { fail(400, "invalid_body"); }
      if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.state !== "string" || !statePattern.test(body.state)) fail(400, "invalid_body");
      const hash = await sha(body.state);
      if (body.action === "start") {
        if (typeof body.codeChallenge !== "string" || !challengePattern.test(body.codeChallenge) || typeof body.linkAccount !== "boolean") fail(400, "invalid_body");
        const linkUser = body.linkAccount ? await currentUser(deps, request) : null;
        if (linkUser && !linkUser.email) fail(409, "account_unavailable");
        const userId = linkUser?.id ?? null;
        const admission = await deps.store.start(hash, body.codeChallenge, userId);
        if (admission === "duplicate") fail(409, "attempt_exists");
        if (admission === "rate_limited") fail(429, "rate_limited");
        if (admission !== "started") fail(502, "auth_unavailable");
        const url = new URL("https://itch.io/user/oauth");
        url.search = new URLSearchParams({ client_id: deps.clientId, scope: "profile:me", redirect_uri: callbackUrl, response_type: "code", code_challenge: body.codeChallenge, code_challenge_method: "S256", state: body.state }).toString();
        return json(200, { authorizeUrl: url.toString(), expiresIn: 300 });
      }
      if (body.action !== "finish" && body.action !== "cancel") fail(400, "invalid_action");
      if (typeof body.codeVerifier !== "string" || !verifierPattern.test(body.codeVerifier)) fail(400, "invalid_body");
      const proof = await challenge(body.codeVerifier);
      const pending = await deps.store.pending(hash);
      if (!pending || pending.code_challenge !== proof || pending.claimed_at || Date.parse(pending.expires_at) <= (deps.now?.() ?? Date.now())) fail(400, "invalid_attempt");
      if (body.action === "cancel") { await deps.store.cancel(hash, proof); return json(200, { ok: true }); }
      if (pending.link_user_id) { const user = await currentUser(deps, request); if (user.id !== pending.link_user_id) fail(403, "account_mismatch"); }
      if (!pending.callback_code && !pending.callback_error) return json(202, { pending: true });
      const claimed = await deps.store.claim(hash, proof);
      if (!claimed) fail(409, "attempt_consumed");
      if (claimed.error) fail(403, "authorization_denied");
      if (!claimed.code || claimed.link_user_id !== pending.link_user_id) fail(409, "attempt_consumed");
      const itchUser = await exchange(deps, claimed.code, body.codeVerifier);
      const id = await resolve(deps, itchUser.id, claimed.link_user_id);
      const session = await issue(deps, id);
      return json(200, { session, itchUser });
    } catch (error) {
      const failure = error instanceof Failure ? error : new Failure(502, "auth_unavailable");
      return json(failure.status, { error: failure.code });
    }
  };
}
