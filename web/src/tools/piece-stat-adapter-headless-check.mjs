import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { MemoryStorage } from "./headless-browser-env.mjs";

const vite = await createServer({ root: fileURLToPath(new URL("../..", import.meta.url)), configFile: false, logLevel: "error", server: { middlewareMode: true } });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
try {
  const [{ createStrategyStatAdapter }, { createPermanentResearchAdapter }, meta, { PIECE_STAT_ORDER }] = await Promise.all([
    vite.ssrLoadModule("/src/strategy-stat-adapter.ts"), vite.ssrLoadModule("/src/permanent-research-adapter.ts"), vite.ssrLoadModule("/src/meta.ts"), vite.ssrLoadModule("/src/piece-stat-model.ts"),
  ]);
  const storage = new MemoryStorage();
  let matchDeck;
  const strategy = createStrategyStatAdapter({ storage, onMatch: async deck => { matchDeck = deck; } });
  let notifications = 0;
  const unsubscribe = strategy.subscribe(() => notifications++);
  for (let i = 0; i < 4; i++) assert.equal(strategy.increase("Pawn", "force").changed, true);
  assert.equal(strategy.increase("Pawn", "force").changed, false);
  assert.equal(notifications, 4);
  near(strategy.getSummary("Pawn").pieces[0].force.currentEffectFraction, 0.08);
  const snapshot = strategy.getSummary("Pawn"); snapshot.pieces[0].force.level = 99;
  assert.equal(strategy.getSummary("Pawn").pieces[0].force.level, 4);
  for (let i = 0; i < 4; i++) strategy.increase("Pawn", "weight");
  for (let i = 0; i < 2; i++) strategy.increase("Knight", "force");
  assert.equal(strategy.getSummary("Pawn").resourceCurrent, 10);
  assert.equal(strategy.increase("Rook", "force").changed, false);
  assert.equal(strategy.getSummary("Rook").pieces.find(p => p.type === "Rook").force.disabledReasonKey, "budgetSpent");
  assert.equal(strategy.decrease("Pawn", "force").changed, true);
  await strategy.executePrimaryAction();
  assert.equal(matchDeck.Pawn.force, 3);
  matchDeck.Pawn.force = 0;
  assert.equal(strategy.getSummary("Pawn").pieces[0].force.level, 3);
  const restored = createStrategyStatAdapter({ storage, onMatch: async () => {} });
  assert.equal(restored.getSummary("Pawn").resourceCurrent, 9);
  unsubscribe(); const previousNotifications = notifications;
  strategy.reset(); assert.equal(notifications, previousNotifications);
  assert.equal(strategy.getSummary("Pawn").resourceCurrent, 0);
  assert.equal(strategy.getSummary("Pawn").primaryActionEnabled, true, "unspent decks remain matchable after UI confirmation");

  const researchStorage = new MemoryStorage();
  const runtime = meta.createMetaRuntime(researchStorage);
  const research = createPermanentResearchAdapter(runtime);
  assert.equal(research.increase("Pawn", "force").changed, false);
  assert.equal(research.getSummary("Pawn").pieces[0].force.disabledReasonKey, "insufficientPoints");
  runtime.state.points = 500;
  assert.equal(research.increase("King", "force").changed, false);
  assert.equal(research.increase("Queen", "weight").changed, false);
  research.setResearchTier("advanced");
  assert.equal(research.getSummary("Pawn").pieces[0].force.disabledReasonKey, "advancedLocked");
  assert.equal(research.increase("Pawn", "force").changed, false);
  research.setResearchTier("basic");
  const strategyBeforeResearch = storage.getItem("ca_strategy_deck");
  const purchaseTier = (tier, effects, regularCosts, royalCosts) => {
    research.setResearchTier(tier);
    for (const type of PIECE_STAT_ORDER) {
      for (const stat of ["force", "weight"]) {
        for (let level = 0; level < 3; level++) {
          const p = research.getSummary(type).pieces.find(p => p.type === type);
          const cost = (["King", "Queen"].includes(type) ? royalCosts : regularCosts)[level];
          assert.equal(p[stat].increaseCost, cost);
          near(p[stat].nextEffectFraction, (tier === "advanced" ? 0.06 : 0) + effects[level]);
          const pointsBefore = runtime.state.points;
          assert.equal(research.increase(type, stat).changed, true, `${tier}/${type}/${stat}/${level}`);
          assert.equal(runtime.state.points, pointsBefore - cost);
          near(research.getSummary(type).pieces.find(p => p.type === type)[stat].currentEffectFraction, (tier === "advanced" ? 0.06 : 0) + effects[level]);
        }
        assert.equal(research.increase(type, stat).changed, false);
        assert.equal(research.decrease(type, stat).changed, false);
      }
      if (type === "Pawn") assert.equal(research.increase("King", "force").changed, false, "King also needs Knight");
      if (type === "Bishop") assert.equal(research.increase("Queen", "force").changed, false, "Queen also needs Rook");
    }
  };
  purchaseTier("basic", [0.01, 0.03, 0.06], [1, 3, 5], [2, 4, 6]);
  assert.equal(research.getSummary("King").size.canIncrease, true);
  assert.equal(research.getSummary("King").resetRefund, 120);
  assert.equal(research.increaseSize().changed, true);
  assert.equal(research.increaseSize().changed, false);
  near(research.getSummary("King").size.currentEffectFraction, 0.05);
  purchaseTier("advanced", [0.05, 0.08, 0.14], [3, 5, 7], [4, 6, 8]);
  assert.equal(research.getSummary("King").resetRefund, 322);
  assert.equal(runtime.state.points, 178);
  const reloaded = meta.createMetaRuntime(researchStorage);
  assert.deepEqual(reloaded.state, runtime.state);
  assert.equal(research.reset().changed, true);
  assert.equal(runtime.state.points, 500);
  assert.equal(research.getSummary("Pawn").size.level, 0);
  assert.equal(research.getSummary("Pawn").pieces[0].force.disabledReasonKey, "advancedLocked");
  assert.equal(research.reset().changed, false);
  assert.equal(storage.getItem("ca_strategy_deck"), strategyBeforeResearch, "research does not write strategy storage");
  assert.deepEqual(meta.createMetaRuntime(researchStorage).state, runtime.state);
  console.log("PASS adapters: strategy save/match isolation; complete 322P research tree, costs, locks, final effects, size, reload and full refund");
} finally { await vite.close(); }
