import assert from 'node:assert/strict';
import { presentCard } from '../crazygames-progression.ts';

const cases = [
  ['size', '상대 공격에도 더 잘 맞음'],
  ['weight', '같은 파워의 목표 초기 발사 속도는 유지'],
  ['force', null],
  ['giantPawn', '다음 단계에서 일부 폰 제거'],
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
  }
  assert.equal(ko.bonusChange, null, 'description text must not invent a measured bonus');
}

const weeklyCard = { id: 'force', name: '힘 강화', description: '이동거리 증가', category: 'general', oneShot: false };
assert.equal(presentCard(weeklyCard, 'en').bonusChange, null);
assert.equal(presentCard(weeklyCard, 'fr').effect, presentCard(weeklyCard, 'en').effect);
assert.equal(presentCard(weeklyCard, 'en', { before: .1, after: .2 }).bonusChange, '+10% → +20%');
const giant = {id:'giantPawn', name:'Giant Pawn', description:'', category:'special', oneShot:true};
assert.equal(presentCard(giant, 'en', {pawnsLost:1}).tradeoff, '1 pawn removed next stage');
const measured=presentCard(weeklyCard,'en',{appliedValues:[{piece:'Pawn',stat:'speed',before:4,after:5,unit:'m/s'}]});
assert.ok(measured.appliedValues[0].includes('4m/s → 5m/s'));
console.log('CrazyGames card presentation: 5 cards, supplied bonuses/applied values, actual pawn loss, fallback OK');
