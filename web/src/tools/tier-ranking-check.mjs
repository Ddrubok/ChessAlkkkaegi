/**
 * tier-ranking-check.mjs
 * Mocked regression & unit test suite for Tier Ranking feature.
 *
 * Tests SocialService (getLeaderboard, getMyRank with server-side King filter & tie policy)
 * UI lifecycle and layout are verified in a real browser, not a partial DOM mock.
 * Headless Vite SSR environment with mocked query builder, zero remote writes.
 */

import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import "./headless-browser-env.mjs";

const webRoot = fileURLToPath(new URL("../..", import.meta.url));

// Mock only the network boundary; load the real tier and rendering modules.
const mockClientPlugin = {
  name: "mock-supabase-client",
  load(id) {
    if (id.includes("supabase-client")) return `
      let mockClient = null;
      export function setMockClient(client) { mockClient = client; }
      export function getSupabaseClient() { return mockClient; }
    `;
  },
};

const vite = await createServer({
  root: webRoot,
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  logLevel: "error",
  appType: "custom",
  server: { middlewareMode: true },
  plugins: [mockClientPlugin],
});

let passes = 0;
let failures = 0;

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`✅ PASS: ${name}`);
    passes++;
  } catch (err) {
    console.error(`❌ FAIL: ${name}`);
    console.error(err);
    failures++;
  }
}

try {
  console.log("=== Running Tier Ranking Regression Suite ===");

  const { SocialService } = await vite.ssrLoadModule("/src/social-service.ts");
  const { KING_MMR } = await vite.ssrLoadModule("/src/tier.ts");
  const { setMockClient } = await vite.ssrLoadModule("/src/supabase-client.ts");

  // --------------------------------------------------------------------------
  // 1. SocialService.getLeaderboard - All scope (kingOnly = false)
  // --------------------------------------------------------------------------
  await runTest("getLeaderboard (all): queries correct columns and computes tie ranks strictly higher + 1", async () => {
    let capturedTable = null;
    let capturedSelect = null;
    let gteCalled = false;
    const orderCalls = [];
    let limitValue = null;

    setMockClient({
      from: (table) => {
        capturedTable = table;
        return {
          select: (cols) => {
            capturedSelect = cols;
            const builder = {
              gte: () => {
                gteCalled = true;
                return builder;
              },
              order: (col, opts) => {
                orderCalls.push({ col, opts });
                return builder;
              },
              limit: (lim) => {
                limitValue = lim;
                return Promise.resolve({
                  data: [
                    { id: "u1", nickname: "User1", classic_mmr: 2500, classic_wins: 10, classic_losses: 2, classic_draws: 0 },
                    { id: "u2", nickname: "User2", classic_mmr: 2400, classic_wins: 8, classic_losses: 3, classic_draws: 0 },
                    { id: "u3", nickname: "User3", classic_mmr: 2400, classic_wins: 5, classic_losses: 1, classic_draws: 0 },
                    { id: "u4", nickname: "User4", classic_mmr: 2100, classic_wins: 2, classic_losses: 4, classic_draws: 0 },
                  ],
                  error: null,
                });
              },
            };
            return builder;
          },
        };
      },
    });

    const list = await SocialService.getLeaderboard("classic", 50, false);
    assert.equal(capturedTable, "profiles");
    assert.ok(capturedSelect.includes("classic_mmr"));
    assert.equal(gteCalled, false, "All scope must not apply gte filter");
    assert.equal(orderCalls.length, 3, "Must order by mmr, wins, and id");
    assert.equal(orderCalls[0].col, "classic_mmr");
    assert.equal(orderCalls[1].col, "classic_wins");
    assert.equal(orderCalls[2].col, "id");
    assert.equal(limitValue, 50);

    // Verify tie ranking policy: 1, 2, 2, 4
    assert.equal(list.length, 4);
    assert.equal(list[0].rank, 1);
    assert.equal(list[1].rank, 2);
    assert.equal(list[2].rank, 2, "Tied MMR gets same rank (1 person strictly higher + 1 = 2)");
    assert.equal(list[3].rank, 4, "Next gets 3 strictly higher + 1 = 4");
  });

  // --------------------------------------------------------------------------
  // 2. SocialService.getLeaderboard - King scope (kingOnly = true)
  // --------------------------------------------------------------------------
  await runTest("getLeaderboard (kingOnly): filters rating >= KING_MMR server-side before limit", async () => {
    let gteCall = null;
    let limitCalledAfterGte = false;

    setMockClient({
      from: (table) => ({
        select: () => {
          const builder = {
            gte: (col, val) => {
              gteCall = { col, val };
              return builder;
            },
            order: () => builder,
            limit: (lim) => {
              if (gteCall) limitCalledAfterGte = true;
              return Promise.resolve({
                data: [
                  { id: "k1", nickname: "King1", classic_mmr: 2600, classic_wins: 20, classic_losses: 5, classic_draws: 0 },
                ],
                error: null,
              });
            },
          };
          return builder;
        },
      }),
    });

    const list = await SocialService.getLeaderboard("classic", 25, true);
    assert.ok(gteCall, "Must call gte filter");
    assert.equal(gteCall.col, "classic_mmr");
    assert.equal(gteCall.val, KING_MMR);
    assert.equal(limitCalledAfterGte, true, "gte filter must be chained server-side before limit");
    assert.equal(list.length, 1);
    assert.equal(list[0].rank, 1);
  });

  // --------------------------------------------------------------------------
  // 3. SocialService.getLeaderboard - empty and failed requests are distinct
  // --------------------------------------------------------------------------
  await runTest("getLeaderboard: distinguishes a failed query from an empty leaderboard", async () => {
    setMockClient({
      from: () => ({
        select: () => ({
          gte: function () { return this; },
          order: function () { return this; },
          limit: () => Promise.resolve({ data: null, error: new Error("connection failure") }),
        }),
      }),
    });

    const list = await SocialService.getLeaderboard("strategy", 50, false);
    assert.equal(list, null, "A failed query must not look like an empty leaderboard");
  });
  await runTest("getLeaderboard: a successful empty query remains empty", async () => {
    const query = { select() { return this; }, order() { return this; }, limit: async () => ({ data: [], error: null }) };
    setMockClient({ from: () => query });
    assert.deepEqual(await SocialService.getLeaderboard("classic"), []);
  });

  // --------------------------------------------------------------------------
  // 4. SocialService.getMyRank - All scope
  // --------------------------------------------------------------------------
  await runTest("getMyRank (all): calculates higherCount + 1 accurately", async () => {
    setMockClient({
      from: (table) => ({
        select: (cols, opts) => {
          if (opts && opts.head) {
            // Count query
            return {
              gt: (_col, val) => {
                assert.equal(val, 1600);
                return Promise.resolve({ count: 7, error: null });
              },
              // total count query
              then: (resolve) => resolve({ count: 100, error: null }),
            };
          }
          return {
            eq: (_col, val) => ({
              maybeSingle: () => Promise.resolve({
                data: { id: val, classic_mmr: 1600 },
                error: null,
              }),
            }),
          };
        },
      }),
    });

    const rank = await SocialService.getMyRank("user-123", "classic", false);
    assert.ok(rank);
    assert.equal(rank.rank, 8, "7 higher -> rank 8");
    assert.equal(rank.mmr, 1600);
    assert.equal(rank.totalPlayers, 100);
  });

  // --------------------------------------------------------------------------
  // 5. SocialService.getMyRank - King scope: Non-King returns null
  // --------------------------------------------------------------------------
  await runTest("getMyRank (kingOnly): returns null if user rating < KING_MMR", async () => {
    setMockClient({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({
              data: { id: "pawn-user", classic_mmr: KING_MMR - 50 },
              error: null,
            }),
          }),
        }),
      }),
    });

    const rank = await SocialService.getMyRank("pawn-user", "classic", true);
    assert.equal(rank, null, "Non-king user must have null rank in kingOnly scope");
  });

  // --------------------------------------------------------------------------
  // 6. SocialService.getMyRank - King scope: King user returns King rank
  // --------------------------------------------------------------------------
  await runTest("getMyRank (kingOnly): returns rank among Kings if user rating >= KING_MMR", async () => {
    let gteCalledOnTotal = false;

    setMockClient({
      from: () => ({
        select: (_cols, opts) => {
          if (opts && opts.head) {
            const countBuilder = {
              gt: () => countBuilder,
              gte: () => {
                gteCalledOnTotal = true;
                return countBuilder;
              },
              then: (resolve) => resolve({ count: 2, error: null }),
            };
            return countBuilder;
          }
          return {
            eq: () => ({
              maybeSingle: () => Promise.resolve({
                data: { id: "king-user", strategy_mmr: KING_MMR + 100 },
                error: null,
              }),
            }),
          };
        },
      }),
    });

    const rank = await SocialService.getMyRank("king-user", "strategy", true);
    assert.ok(rank);
    assert.equal(rank.rank, 3, "2 higher kings -> rank 3");
    assert.equal(rank.mmr, KING_MMR + 100);
    assert.equal(gteCalledOnTotal, true, "King rank counts must filter by KING_MMR");
  });

  // --------------------------------------------------------------------------
  // 7. SocialService.getMyRank - DB error returns null (never fake rank 1)
  // --------------------------------------------------------------------------
  await runTest("getMyRank: returns null on DB error, never inventing rank 1", async () => {
    setMockClient({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: new Error("DB fail") }),
          }),
        }),
      }),
    });

    const rank = await SocialService.getMyRank("error-user", "classic", false);
    assert.equal(rank, null, "Must return null on DB error");
  });

  console.log("==========================================");
  console.log(`Test Summary: ${passes} passed, ${failures} failed.`);
  console.log("==========================================");

  if (failures > 0) {
    process.exit(1);
  }
} finally {
  await vite.close();
}
