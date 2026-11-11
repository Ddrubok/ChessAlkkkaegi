import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import { createHandler, type Admin, type SessionClient, type Store } from "./core.ts";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const clientId = Deno.env.get("ITCH_OAUTH_CLIENT_ID") ?? "";
const options = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
const client = createClient(url, serviceKey, options);
const store: Store = {
  async start(hash, challenge, linkUserId) {
    const { data, error } = await client.rpc("itch_oauth_start", { p_hash: hash, p_challenge: challenge, p_link_user_id: linkUserId });
    if (error) throw error;
    if (data !== "started" && data !== "duplicate" && data !== "rate_limited") throw new Error("invalid itch OAuth admission response");
    return data;
  },
  async pending(hash) {
    const { data, error } = await client.from("itch_oauth_pending").select("code_challenge,callback_code,callback_error,link_user_id,expires_at,claimed_at").eq("state_hash", hash).maybeSingle();
    if (error) throw error;
    return data;
  },
  async callback(hash, code, errorValue) {
    const { data, error } = await client.rpc("itch_oauth_callback", { p_hash: hash, p_code: code, p_error: errorValue });
    if (error) throw error;
    return data === true;
  },
  async claim(hash, challenge) {
    const { data, error } = await client.rpc("itch_oauth_claim", { p_hash: hash, p_challenge: challenge });
    if (error) throw error;
    return data?.[0] ?? null;
  },
  async cancel(hash, challenge) {
    const { error } = await client.rpc("itch_oauth_cancel", { p_hash: hash, p_challenge: challenge });
    if (error) throw error;
  },
  async identity(itchId) {
    const { data, error } = await client.from("itch_identities").select("user_id").eq("itch_user_id", itchId).maybeSingle();
    if (error) throw error;
    return data?.user_id ?? null;
  },
  async identityForUser(userId) {
    const { data, error } = await client.from("itch_identities").select("itch_user_id").eq("user_id", userId).maybeSingle();
    if (error) throw error;
    return data?.itch_user_id ?? null;
  },
  async bind(itchId, userId) {
    const { error } = await client.from("itch_identities").insert({ itch_user_id: itchId, user_id: userId });
    if (error?.code === "23505") return false;
    if (error) throw error;
    return true;
  },
};
const handler = createHandler({
  store,
  admin: client as unknown as Admin,
  sessionClient: () => createClient(url, anonKey, options) as unknown as SessionClient,
  clientId,
  allowedOrigins: ["https://html-classic.itch.zone", "https://html.itch.zone", "https://ddurubok.itch.io"],
});
Deno.serve(handler);
