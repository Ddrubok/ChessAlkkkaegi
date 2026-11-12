import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import { createHandler, type Admin, type SessionClient } from "./core.ts";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const gameId = Deno.env.get("CRAZYGAMES_GAME_ID") ?? "";
const allowedOrigins = (Deno.env.get("CRAZYGAMES_ALLOWED_ORIGINS") ?? "").split(",").map((value) => value.trim()).filter((value) => /^https:\/\/[^/]+$/.test(value));
const options = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
const admin = createClient(url, serviceKey, options) as unknown as Admin;
const handler = createHandler({
  admin,
  sessionClient: () => createClient(url, anonKey, options) as unknown as SessionClient,
  gameId,
  allowedOrigins,
});

Deno.serve(handler);
