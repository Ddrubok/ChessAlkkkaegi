import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import "./headless-browser-env.mjs";

const vite = await createServer({ root: fileURLToPath(new URL("../..", import.meta.url)), configFile: false, logLevel: "error", server: { middlewareMode: true } });
try {
  const { SupabaseMatchmaker } = await vite.ssrLoadModule("/src/supabase-matchmaker.ts");
  const report = { matchId: "same-match", mode: "strategy", whitePlayerId: "white", blackPlayerId: "black", winnerId: null };
  let calls = 0;
  const result = await SupabaseMatchmaker.recordMatchResult({ rpc: async (name, params) => {
    assert.equal(name, "finish_match_v2");
    assert.deepEqual(params, { p_match_id: "same-match", p_mode: "strategy", p_white_id: "white", p_black_id: "black", p_winner_id: null });
    return { error: null, data: ++calls === 1 ? { status: "pending" } : { status: "settled", white_delta: 0, black_delta: 0 } };
  } }, report);
  assert.deepEqual(result, { status: "settled", whiteDelta: 0, blackDelta: 0 });
  assert.equal(calls, 2);
  await assert.rejects(SupabaseMatchmaker.recordMatchResult({ rpc: async () => ({ error: { message: "permission denied" } }) }, report), /permission denied/);
  await assert.rejects(SupabaseMatchmaker.recordMatchResult({ rpc: async () => ({ data: { status: "settled", white_delta: "16", black_delta: -16 } }) }, report), /점수/);
  console.log("PASS: stable match identity, bilateral retry, real zero delta and fail-closed RPC errors");
} finally { await vite.close(); }
