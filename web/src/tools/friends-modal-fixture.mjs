// Isolated browser fixture: no account, database or social writes.
import { openFriendsModal } from '../friends-modal.ts';
import { SocialService } from '../social-service.ts';
import { progressStorage } from '../progress-storage.ts';
import { I18nManager } from '../i18n.ts';
import { FRIENDS_COPY } from '../friends-copy.ts';
const results = document.querySelector('#results');
const opener = document.querySelector('#opener');
const report = [];
const assert = (value, label) => { if (!value) throw new Error(label); report.push(`PASS ${label}`); };
const click = selector => document.querySelector(selector).click();
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const member = { id: 'fixture-member', nickname: 'Fixture' };
let subscribers = 0;
SocialService.subscribePresence = () => { subscribers++; return () => { subscribers--; }; };
SocialService.getFriendsList = async () => [];
SocialService.getPendingRequests = async () => [];
for (const method of ['sendFriendRequest', 'sendChallenge', 'deleteFriend', 'respondFriendRequest']) SocialService[method] = () => { throw new Error('Fixture forbids social writes'); };
try {
  I18nManager.currentLang = 'en';
  progressStorage.owner = null;
  opener.focus();
  await openFriendsModal(document.body, { id: 'local_guest', nickname: 'Player' });
  assert(!!document.querySelector('#friends-login-close-btn'), 'guest Player profile gets login gate');
  assert(document.querySelector('[role="dialog"]').getAttribute('aria-modal') === 'true', 'dialog accessible semantics');
  assert(subscribers === 0, 'guest never subscribes to member presence');
  assert(opener.inert && document.activeElement.id === 'friends-login-close-btn', 'background inert and initial guest focus');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert(!document.querySelector('.friends-modal-overlay') && document.activeElement === opener && !opener.inert, 'Escape closes and restores opener');

  progressStorage.owner = member.id;
  let finish;
  SocialService.getFriendsList = () => new Promise(resolve => { finish = resolve; });
  const opening = openFriendsModal(document.body, member);
  assert(!!document.querySelector('#friends-close-btn') && !!document.querySelector('[aria-busy="true"]'), 'member dialog mounts during delayed read');
  assert(!document.querySelector('#tab-friends-list').textContent.includes('(0)'), 'loading never shows false zero');
  click('#friends-close-btn'); finish([]); await opening;
  assert(!document.querySelector('.friends-modal-overlay') && subscribers === 0, 'late read cannot reopen closed modal; presence cleaned');

  SocialService.getFriendsList = async () => null;
  await openFriendsModal(document.body, member);
  assert(!!document.querySelector('[role="alert"]') && !!document.querySelector('#friends-retry-btn'), 'member failed read shows error and retry');
  assert(!document.querySelector('#tab-friends-list').textContent.includes('(0)'), 'error never shows false zero');
  SocialService.getFriendsList = async () => [];
  click('#friends-retry-btn'); await tick();
  assert(document.querySelector('#tab-friends-list').textContent.includes('(0)') && !document.querySelector('[role="alert"]'), 'retry shows authoritative empty success');
  SocialService.getPendingRequests = async () => null;
  click('#tab-friends-requests'); await tick();
  assert(!!document.querySelector('#friends-retry-btn'), 'requests failure is separately recoverable');
  SocialService.getPendingRequests = async () => [];
  click('#friends-retry-btn'); await tick();
  assert(document.querySelector('#tab-friends-requests').textContent.includes('(0)'), 'requests retry yields true empty');

  click('#tab-friends-add');
  const last = document.querySelector('#friend-search-btn');
  last.focus(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  assert(document.activeElement.id === 'friends-close-btn', 'Tab wraps to close');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
  assert(document.activeElement === last, 'Shift Tab wraps to last action');
  assert(!!document.querySelector('#friend-search-input').getAttribute('aria-label'), 'search has accessible name');
  const card = document.querySelector('.friends-modal-card');
  assert(card.scrollWidth <= card.clientWidth && last.getBoundingClientRect().right <= card.getBoundingClientRect().right, 'search action stays fully inside card at fixture viewport');

  SocialService.getFriendsList = () => new Promise(resolve => { finish = resolve; });
  click('#tab-friends-list'); click('#tab-friends-add'); finish([]); await tick();
  assert(!!document.querySelector('#friend-search-input'), 'stale list response cannot replace add tab');
  SocialService.getFriendsList = async () => [];
  await openFriendsModal(document.body, member);
  assert(subscribers === 1 && document.querySelectorAll('.friends-modal-overlay').length === 1, 'replacement cleans previous presence');
  await progressStorage.activate(null, null);
  assert(!document.querySelector('.friends-modal-overlay') && subscribers === 0, 'owner change closes and cleans modal');

  for (const lang of Object.keys(FRIENDS_COPY)) {
    I18nManager.currentLang = lang;
    progressStorage.owner = member.id;
    await openFriendsModal(document.body, member);
    click('#tab-friends-add');
    const card = document.querySelector('.friends-modal-card');
    const button = document.querySelector('#friend-search-btn');
    assert(card.scrollWidth <= card.clientWidth && button.getBoundingClientRect().right <= card.getBoundingClientRect().right, `${lang} search fits viewport`);
    click('#friends-close-btn');
  }
  I18nManager.currentLang = 'en';
  progressStorage.owner = member.id;
  SocialService.getFriendsList = async () => [{ id: 'fixture-friend', nickname: 'Friend', classicMmr: 1000, strategyMmr: 1000, status: 'online' }];
  let answerChallenge;
  let roomSequence = 0;
  const cancelledRooms = [];
  SocialService.sendChallenge = async () => ({ roomId: `fixture-room-${++roomSequence}`, responsePromise: new Promise(resolve => { answerChallenge = resolve; }) });
  SocialService.cancelChallenge = roomId => { cancelledRooms.push(roomId); answerChallenge(false); };
  await openFriendsModal(document.body, member);
  click('.btn-challenge'); await tick();
  assert(!!document.querySelector('#cancel-challenge-btn'), 'isolated outgoing challenge enters wait state');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await tick();
  assert(cancelledRooms.includes('fixture-room-1') && !document.querySelector('.friends-modal-overlay'), 'Escape immediately cancels pending outgoing challenge');
  await openFriendsModal(document.body, member);
  click('.btn-challenge'); await tick();
  await progressStorage.activate(null, null); await tick();
  assert(cancelledRooms.includes('fixture-room-2'), 'owner change immediately cancels pending outgoing challenge');
  progressStorage.owner = member.id;
  await openFriendsModal(document.body, member);
  const challengeButton = document.querySelector('.btn-challenge');
  challengeButton.click(); await tick();
  click('#cancel-challenge-btn'); await tick();
  assert(document.activeElement === challengeButton && !challengeButton.disabled, 'cancel restores focus to originating challenge button');
  let acceptedRoom;
  await openFriendsModal(document.body, member, { onStartFriendlyMatch: (_friend, roomId) => { acceptedRoom = roomId; } });
  click('.btn-challenge'); await tick(); answerChallenge(true); await tick();
  assert(acceptedRoom === 'fixture-room-4' && !cancelledRooms.includes(acceptedRoom), 'accepted match closes modal without cancelling accepted room');
  results.textContent = report.join('\n') + '\nALL PASS';
  document.title = 'PASS friends modal fixture';
} catch (error) {
  results.textContent = report.join('\n') + '\nFAIL ' + error.stack;
  document.title = 'FAIL friends modal fixture';
}
