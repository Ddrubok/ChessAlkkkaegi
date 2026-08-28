import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { MemoryStorage } from "./headless-browser-env.mjs";

const vite = await createServer({ root: fileURLToPath(new URL("../..", import.meta.url)), configFile: false, logLevel: "error", server: { middlewareMode: true } });
try {
  const deck = await vite.ssrLoadModule("/src/strategy-deck.ts");
  const defaults = deck.createDefaultStrategyDeck();
  const fresh = deck.createDefaultStrategyDeck();
  fresh.Pawn.force = 4;
  assert.equal(defaults.Pawn.force, 0);
  assert.equal(deck.DEFAULT_STRATEGY_DECK.Pawn.force, 0);
  assert.equal(deck.validateStrategyDeck(fresh).isValid, true);
  const copy = deck.cloneStrategyDeck(fresh);
  copy.Pawn.force = 0;
  assert.equal(fresh.Pawn.force, 4);
  for (const invalid of [null, [], "{}", {}, { ...fresh, King: null }, { ...fresh, Queen: [] }]) {
    assert.equal(deck.validateStrategyDeck(invalid).isValid, false);
    assert.deepEqual(deck.parseStrategyDeck(invalid), defaults);
  }
  for (const value of [-1, 0.5, "2", NaN, Infinity, 5, 100, null, undefined, true]) {
    for (const stat of ["force", "weight"]) {
      const invalid = deck.createDefaultStrategyDeck(); invalid.Pawn[stat] = value;
      assert.equal(deck.validateStrategyDeck(invalid).isValid, false, `${stat}: ${value}`);
      assert.deepEqual(deck.parseStrategyDeck(invalid), defaults);
    }
  }
  const ten = deck.createDefaultStrategyDeck();
  ten.Pawn.force = 4; ten.Pawn.weight = 4; ten.Knight.force = 2;
  assert.equal(deck.validateStrategyDeck(ten).totalPoints, 10);
  assert.equal(deck.validateStrategyDeck(ten).isValid, true);
  assert.equal(deck.changeStrategyStat(ten, "Rook", "force", 1), false);
  assert.equal(deck.changeStrategyStat(ten, "Pawn", "force", -1), true);
  assert.equal(deck.changeStrategyStat(ten, "Rook", "force", 1), true);
  assert.equal(deck.changeStrategyStat(ten, "Rook", "weight", -1), false);
  ten.Rook.force++;
  assert.equal(deck.validateStrategyDeck(ten).isValid, false);
  const storage = new MemoryStorage();
  for (const json of ["{", "null", "[]", '"bad"', '{"Pawn":{"force":1,"weight":0}}']) {
    storage.setItem(deck.STRATEGY_STORAGE_KEY, json);
    assert.deepEqual(deck.loadStrategyDeck(storage), defaults);
  }
  assert.equal(deck.saveStrategyDeck(fresh, storage), true);
  assert.deepEqual(deck.loadStrategyDeck(storage), fresh);
  assert.equal(deck.saveStrategyDeck(ten, storage), false);
  assert.deepEqual(deck.loadStrategyDeck(storage), fresh);
  const extra = { ...fresh, Unknown: { force: 999, weight: 999 }, Pawn: { ...fresh.Pawn, unexpected: 999 } };
  assert.deepEqual(deck.parseStrategyDeck(extra), fresh);
  const unavailable = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("quota"); } };
  assert.deepEqual(deck.loadStrategyDeck(unavailable), defaults);
  assert.equal(deck.saveStrategyDeck(fresh, unavailable), false);
  console.log("PASS strategy deck: strict parsing, isolated defaults, 0..4 / total 10, storage compatibility and failures");
} finally { await vite.close(); }
