import { createRemoteJWKSet, customFetch, decodeProtectedHeader, errors, jwtVerify } from "npm:jose@6.1.0";

const JWKS_URL = "https://userportal.crazygames.com/.well-known/jwks.json";
const encoder = new TextEncoder();
const jwksByFetch = new WeakMap<typeof fetch, ReturnType<typeof createRemoteJWKSet>>();

type Result<T> = { data: T | null; error: { status?: number; code?: string } | null };
type User = { id: string; email?: string; is_anonymous?: boolean; banned_until?: string | null; app_metadata?: Record<string, unknown> };
export type Admin = {
  auth: { getUser(token: string): Promise<Result<{ user: User | null }>>; admin: {
    getUserById(id: string): Promise<Result<{ user: User | null }>>;
    createUser(attributes: Record<string, unknown>): Promise<Result<{ user: User | null }>>;
    generateLink(attributes: { type: "magiclink"; email: string }): Promise<Result<{ properties?: { hashed_token?: string } | null; user?: User | null }>>;
  } };
  from(table: string): { select(columns: string): { eq(column: string, value: string): { maybeSingle(): PromiseLike<{ data: { id: string } | null; error: unknown }> } }; insert(value: Record<string, unknown>): PromiseLike<{ error: unknown }> };
};
export type SessionClient = { auth: { verifyOtp(value: { token_hash: string; type: "magiclink" }): Promise<{ data: { user: User | null; session: { access_token?: string; refresh_token?: string; user?: User } | null }; error: unknown }> } };
type Dependencies = { admin: Admin; sessionClient: () => SessionClient; gameId: string; allowedOrigins: string[]; jwksFetch?: typeof fetch; now?: () => number };

class Failure extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code; }
}
const fail = (status: number, code: string): never => { throw new Failure(status, code); };

export async function verifyCrazyToken(token: string, gameId: string, jwksFetch: typeof fetch = fetch, now = Date.now()): Promise<{ userId: string; gameId: string }> {
  if (!gameId || !/^[A-Za-z0-9_-]+$/.test(gameId)) fail(503, "configuration_error");
  if (token.length > 8192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) fail(401, "invalid_token");
  let payload;
  try {
    const header = decodeProtectedHeader(token);
    if (header.alg !== "RS256" || header.kid !== "ingame-auth") fail(401, "invalid_token");
    let jwks = jwksByFetch.get(jwksFetch);
    if (!jwks) {
      jwks = createRemoteJWKSet(new URL(JWKS_URL), { [customFetch]: jwksFetch, timeoutDuration: 5000 });
      jwksByFetch.set(jwksFetch, jwks);
    }
    ({ payload } = await jwtVerify(token, jwks, { algorithms: ["RS256"], requiredClaims: ["iat", "exp"], currentDate: new Date(now) }));
  } catch (error) {
    if (error instanceof Failure) throw error;
    if (error instanceof errors.JWKSInvalid || error instanceof errors.JWKSNoMatchingKey || error instanceof errors.JWKSMultipleMatchingKeys || !(error instanceof errors.JOSEError)) fail(503, "verification_unavailable");
    fail(401, "invalid_token");
  }
  const seconds = Math.floor(now / 1000);
  if (typeof payload.userId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(payload.userId)
    || payload.gameId !== gameId || !Number.isInteger(payload.iat) || !Number.isInteger(payload.exp)
    || (payload.iat as number) > seconds + 60 || (payload.exp as number) <= seconds
    || (payload.exp as number) <= (payload.iat as number) || (payload.exp as number) - (payload.iat as number) > 3700) fail(401, "invalid_token");
  return { userId: payload.userId as string, gameId };
}

export async function accountId(gameId: string, userId: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(`crazygames-auth:v1\0${gameId}\0${userId}`)));
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = [...hash.slice(0, 16)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function bound(user: User | null | undefined, id: string, email: string, gameId: string, userId: string): boolean {
  const binding = user?.app_metadata?.crazygames;
  return user?.id === id && user.email === email && user.is_anonymous !== true
    && (!user.banned_until || (Number.isFinite(Date.parse(user.banned_until)) && Date.parse(user.banned_until) <= Date.now()))
    && !!binding && typeof binding === "object" && !Array.isArray(binding)
    && (binding as Record<string, unknown>).game_id === gameId
    && (binding as Record<string, unknown>).user_id === userId;
}

async function getExisting(admin: Admin, id: string): Promise<User | null> {
  const { data, error } = await admin.auth.admin.getUserById(id);
  if (error) {
    if (error.status === 404 || error.code === "user_not_found") return null;
    return fail(502, "account_unavailable");
  }
  if (!data?.user) return fail(502, "account_unavailable");
  return data.user;
}

async function ensureProfile(admin: Admin, id: string): Promise<void> {
  const lookup = () => admin.from("profiles").select("id").eq("id", id).maybeSingle();
  const existing = await lookup();
  if (existing.error) fail(502, "profile_unavailable");
  if (existing.data) return;
  const nickname = `CG_${id.replace(/-/g, "").slice(0, 16)}`;
  const inserted = await admin.from("profiles").insert({ id, nickname });
  if (inserted.error) {
    const raced = await lookup();
    if (raced.error || !raced.data) fail(502, "profile_unavailable");
  }
}

export function createHandler(deps: Dependencies): (request: Request) => Promise<Response> {
  const allowed = new Set(deps.allowedOrigins);
  return async (request) => {
    const origin = request.headers.get("origin");
    const cors = new Headers({ "Cache-Control": "no-store" });
    if (origin && allowed.has(origin)) {
      cors.set("Access-Control-Allow-Origin", origin);
      cors.set("Vary", "Origin");
      cors.set("Access-Control-Allow-Methods", "POST, OPTIONS");
      cors.set("Access-Control-Allow-Headers", "apikey, authorization, content-type, x-client-info");
      cors.set("Access-Control-Max-Age", "600");
    }
    const respond = (status: number, body: unknown) => {
      const headers = new Headers(cors);
      headers.set("Content-Type", "application/json");
      return new Response(JSON.stringify(body), { status, headers });
    };
    if (origin && !allowed.has(origin)) return respond(403, { error: "origin_forbidden" });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return respond(405, { error: "method_not_allowed" });
    try {
      if (!deps.gameId || !deps.allowedOrigins.length) fail(503, "configuration_error");
      if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) fail(415, "invalid_content_type");
      if (Number(request.headers.get("content-length")) > 9000) fail(413, "body_too_large");
      const stream = request.body;
      if (!stream) fail(400, "invalid_body");
      const reader = stream!.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 9000) { await reader.cancel(); fail(413, "body_too_large"); }
        chunks.push(value);
      }
      const combined = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.length; }
      const body = new TextDecoder().decode(combined);
      let value: unknown;
      try { value = JSON.parse(body); } catch { fail(400, "invalid_body"); }
      if (!value || typeof value !== "object" || Array.isArray(value) || typeof (value as Record<string, unknown>).token !== "string") fail(400, "invalid_body");
      const verified = await verifyCrazyToken((value as { token: string }).token, deps.gameId, deps.jwksFetch, deps.now?.());
      const id = await accountId(verified.gameId, verified.userId);
      const email = `cg-${id.replace(/-/g, "")}@accounts.crazygames.invalid`;
      let user = await getExisting(deps.admin, id);
      if (!user) {
        const created = await deps.admin.auth.admin.createUser({ id, email, email_confirm: true, app_metadata: { crazygames: { game_id: verified.gameId, user_id: verified.userId } } });
        user = created.error ? await getExisting(deps.admin, id) : created.data?.user ?? null;
        if (!user) fail(502, "account_unavailable");
      }
      if (!bound(user, id, email, verified.gameId, verified.userId)) fail(409, "account_collision");
      await ensureProfile(deps.admin, id);
      const link = await deps.admin.auth.admin.generateLink({ type: "magiclink", email });
      const hash = link.data?.properties?.hashed_token;
      if (link.error || !hash || link.data?.user?.id !== id) fail(502, "session_unavailable");
      const verifiedOtp = await deps.sessionClient().auth.verifyOtp({ token_hash: hash!, type: "magiclink" });
      const session = verifiedOtp.data?.session;
      if (verifiedOtp.error || !session?.access_token || !session.refresh_token
        || !bound(verifiedOtp.data.user, id, email, verified.gameId, verified.userId)
        || !bound(session.user, id, email, verified.gameId, verified.userId)) fail(502, "session_unavailable");
      const issued = await deps.admin.auth.getUser(session!.access_token!);
      if (issued.error || !bound(issued.data?.user, id, email, verified.gameId, verified.userId)) fail(502, "session_unavailable");
      return respond(200, { session: { access_token: session!.access_token, refresh_token: session!.refresh_token } });
    } catch (error) {
      const failure = error instanceof Failure ? error : new Failure(502, "bridge_unavailable");
      return respond(failure.status, { error: failure.code });
    }
  };
}
