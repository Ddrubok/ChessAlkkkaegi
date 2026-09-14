import assert from 'node:assert/strict';
import { getTier, TIER_START_MMR, DIVISION_MMR, QUEEN_MMR, KING_MMR } from '../tier.ts';

for (let level = 0; level < 20; level++) {
  const floor = TIER_START_MMR + level * DIVISION_MMR;
  const tier = getTier(floor);
  assert.equal(tier.piece, ['pawn', 'knight', 'bishop', 'rook'][Math.floor(level / 5)]);
  assert.equal(tier.division, 5 - level % 5);
  assert.equal(tier.level, level);
  assert.equal(tier.progress, 0);
  assert.equal(tier.pointsToNext, DIVISION_MMR);
  assert.equal(getTier(floor + DIVISION_MMR - 1).level, level);
  if (level > 0) assert.equal(getTier(floor - 1).level, level - 1, 'Loss across threshold demotes');
}
assert.equal(getTier(QUEEN_MMR).piece, 'queen');
assert.equal(getTier(QUEEN_MMR).division, null);
assert.equal(getTier(KING_MMR - 1).pointsToNext, 1);
assert.equal(getTier(KING_MMR).piece, 'king');
assert.equal(getTier(KING_MMR).points, 0);
assert.equal(getTier(KING_MMR + 327).points, 327);
assert.equal(getTier(KING_MMR + 327).pointsToNext, null);
assert.equal(getTier(1200).piece, 'pawn');
assert.equal(getTier(1200).division, 5);
assert.equal(getTier(100).pointsToNext, 1150);
for (const bad of [NaN, Infinity, -Infinity]) assert.deepEqual(getTier(bad), getTier(1200));
for (let mmr = 100; mmr <= 3500; mmr++) {
  const tier = getTier(mmr);
  assert.ok(tier.progress >= 0 && tier.progress <= 1);
  assert.ok(tier.level >= getTier(mmr - 1).level);
  if (tier.pointsToNext !== null) assert.equal(getTier(mmr + tier.pointsToNext).level, tier.level + 1);
}
console.log('PASS: all 22 tiers, promotion/demotion boundaries, King score, invalid inputs');
