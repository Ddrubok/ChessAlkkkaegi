import assert from 'node:assert/strict';
import { presentCard } from '../crazygames-progression.ts';

const cases = [
  ['size', '상대 공격에도 더 잘 맞음'],
  ['weight', '같은 힘에서 이동거리 감소'],
  ['force', null],
  ['giantPawn', '폰 4개를 잃음'],
  ['proneStart', null],
];

for (const [id, tradeoff] of cases) {
  const card = {
    id,
    name: id === 'size' ? '크기 강화 · 중급' : id,
    description: id === 'size' ? '크기 증가 · 효과 +20%' : 'generic',
    category: id === 'giantPawn' || id === 'proneStart' ? 'special' : 'general',
    oneShot: id === 'giantPawn' || id === 'proneStart',
  };
  const ko = presentCard(card, 'ko');
  const en = presentCard(card, 'en');
  assert.ok(ko.icon && ko.effect && en.effect);
  assert.equal(ko.tradeoff, tradeoff);
  if (id === 'size') {
    assert.equal(ko.grade, '중급');
    assert.equal(ko.measuredEffect, '+20%');
  } else {
    assert.equal(ko.measuredEffect, null);
  }
}

const weeklyCard = { id: 'force', name: '힘 강화', description: '이동거리 증가', category: 'general', oneShot: false };
assert.equal(presentCard(weeklyCard, 'en').measuredEffect, null);
assert.equal(presentCard(weeklyCard, 'fr').effect, presentCard(weeklyCard, 'en').effect);
assert.equal(presentCard(weeklyCard, 'en', { before: .1, after: .2 }).measuredEffect, '+10% → +20%');
const giant = {id:'giantPawn', name:'Giant Pawn', description:'', category:'special', oneShot:true};
assert.equal(presentCard(giant, 'en', {pawnsLost:1}).tradeoff, 'Next match: lose 1 pawn');
console.log('CrazyGames card presentation: 5 cards, real value parsing, fallback OK');
