import assert from 'node:assert/strict';
import { reportMarketing } from './marketing-metrics.mjs';

const t = minutes => new Date(Date.parse('2026-10-01T14:50:00Z') + minutes * 60000).toISOString();
const event = (id, name, minutes, person = 'a', match = null, extra = {}) => ({
  event_id: String(id), name, occurred_at: t(minutes), recorded_at: t(minutes),
  analytics_id: person, session_id: 'session-1', environment: 'production',
  platform: 'web', build: 'test', mode: 'menu', match_id: match,
  details: name === 'session_start' ? { first_session: true } : {}, ...extra,
});
const report = (rows, minutes = 3000) => reportMarketing(rows, { asOf: t(minutes) });

// Hotseat is a regular match from one pseudonymous environment. Resignation is separate.
const resigned = [
  event(1, 'session_start', 0), event(2, 'game_ready', 1),
  event(3, 'match_start', 2, 'a', 'first', { mode: 'hotseat' }),
  event(4, 'match_end', 3, 'a', 'first', { mode: 'hotseat', details: { outcome: 'win', resigned: true } }),
  event(5, 'match_start', 4, 'a', 'later', { mode: 'ai' }),
  event(6, 'match_end', 5, 'a', 'later', { mode: 'ai', details: { outcome: 'win' } }),
];
const r = report(resigned);
assert.equal(r.regular.matches_started, 2);
assert.equal(r.regular.participant_outcomes.resigned, 1);
assert.equal(r.regular.participant_outcomes.win, 1);
assert.deepEqual(r.rates.normal_first_completion, { numerator: 0, denominator: 1, rate: 0 });
assert.deepEqual(r.rates.second_match_first_session, { numerator: 0, denominator: 0, rate: null });
assert.deepEqual(r.rates.ready, { numerator: 1, denominator: 1, rate: 1 });
assert.deepEqual(r.rates.start, { numerator: 1, denominator: 1, rate: 1 });
assert.deepEqual(r.rates.entry_completion, { numerator: 0, denominator: 1, rate: 0 });
assert.equal(r.by_mode.hotseat.rates.normal_first_completion.denominator, 1);
assert.equal(r.by_build.test.analytics_ids, 1);
assert.equal(r.by_platform.web.analytics_ids, 1);
assert.match(r.limitations.cost, /unavailable/);
assert.equal(report([...resigned, event(7, 'match_end', 3.5, 'a', 'first', { mode: 'hotseat', details: { outcome: 'win' } })]).rates.normal_first_completion.numerator, 0);

// A later win cannot rescue an aborted first match.
const aborted = [event(10, 'session_start', 0),
  event(11, 'match_start', 1, 'a', 'aborted', { mode: 'ai' }),
  event(12, 'match_abort', 2, 'a', 'aborted', { mode: 'ai' }),
  event(13, 'match_start', 3, 'a', 'later', { mode: 'friend' }),
  event(14, 'match_end', 4, 'a', 'later', { mode: 'friend', details: { outcome: 'win' } })];
assert.equal(report(aborted).rates.normal_first_completion.numerator, 0);

// Recorded session identity survives sparse telemetry gaps over 30 minutes.
const sparse = [event(20, 'session_start', 0),
  event(21, 'match_start', 1, 'a', 'one', { mode: 'friend' }),
  event(22, 'match_end', 40, 'a', 'one', { mode: 'friend', details: { outcome: 'draw' } }),
  event(23, 'match_end', 40, 'a', 'one', { mode: 'friend', details: { outcome: 'draw' } }),
  event(24, 'match_start', 80, 'a', 'two', { mode: 'ai' })];
const s = report(sparse);
assert.deepEqual(s.rates.second_match_first_session, { numerator: 1, denominator: 1, rate: 1 });
assert.equal(s.regular.participant_outcomes.draw, 1);
assert.equal(s.regular.participants_finished, 1);
assert.equal(s.funnel.match_end.events, 1);
assert.equal(report(sparse, 100).regular.participants_pending_under_24h, 1);
assert.equal(report([...sparse, { ...event(24, 'match_start', 80, 'a', 'two', { mode: 'ai' }) }]).events, sparse.length);
assert.equal(report([...sparse.slice(0, 4), event(25, 'match_start', 80, 'a', 'two', { mode: 'ai', session_id: 'session-2' })]).rates.second_match_first_session.numerator, 0);

// The cohort date is first execution, even if regular play starts the next KST day.
const cohort = [event(30, 'session_start', 0), event(31, 'first_shot', 1),
  event(32, 'tutorial_complete', 2), event(33, 'match_start', 20, 'a', 'next-day', { mode: 'hotseat' })];
const c = report(cohort, 2 * 1440);
assert.deepEqual(c.regular.kst_return_after_first_execution.d1, { numerator: 1, denominator: 1, rate: 1 });
assert.deepEqual(c.rates.first_shot, { numerator: 1, denominator: 1, rate: 1 });
assert.deepEqual(c.rates.tutorial_complete, { numerator: 1, denominator: 1, rate: 1 });
assert.equal(report(cohort, 1440).regular.kst_return_after_first_execution.d1.denominator, 0);
assert.equal(report(cohort, 8 * 1440).regular.kst_return_after_first_execution.d7.denominator, 1);
assert.equal(report(cohort, 7 * 1440).regular.kst_return_after_first_execution.d7.denominator, 0);
const unknown = report([event(34, 'match_start', 0, 'missing', 'm', { mode: 'ai' })]);
assert.equal(unknown.limitations.first_execution_unknown, 1);
assert.equal(unknown.rates.start.denominator, 0);
assert.equal(unknown.regular.kst_return_after_first_execution.d1.denominator, 0);

// As-of excludes events that happened earlier but were received later; later reports resolve pending endings.
const late = [event(40, 'session_start', 0), event(41, 'match_start', 1, 'a', 'late', { mode: 'ai' }),
  event(42, 'match_end', 2, 'a', 'late', { mode: 'ai', recorded_at: t(2000), details: { outcome: 'loss' } })];
assert.equal(report(late, 1500).regular.participants_unconfirmed_24h, 1);
assert.equal(report(late, 1500).rates.normal_first_completion.numerator, 0);
assert.equal(report(late, 2500).regular.participants_unconfirmed_24h, 0);
assert.equal(report(late, 2500).rates.normal_first_completion.numerator, 1);
assert.equal(report([...late, event(43, 'match_end', 2, 'a', 'late', { mode: 'ai', recorded_at: t(2001), details: { outcome: 'loss' } })], 2500).regular.participant_outcomes.loss, 1);
assert.equal(reportMarketing([event(50, 'session_start', 0, 'qa', null, { environment: 'qa' })], { environment: 'qa', asOf: t(10) }).analytics_ids, 1);
console.log('PASS marketing metrics: first match, cohort, session identity, deduplication, rates, and receipt cutoff');
const acquired = [event(60, 'session_start', 0, 'campaign-user', null, { campaign: { source: 'shorts' } }),
  event(61, 'match_start', 20, 'campaign-user', 'direct-return', { mode: 'hotseat', campaign: null, session_id: 'next' })];
assert.equal(reportMarketing(acquired, { asOf: t(2 * 1440), campaignSource: 'shorts' }).regular.kst_return_after_first_execution.d1.numerator, 1);
const lateSessionFinish = [event(70, 'session_start', 0), event(71, 'match_start', 1, 'a', 'first', { mode: 'ai' }),
  event(72, 'match_end', 40, 'a', 'first', { mode: 'ai', session_id: 'new-session', details: { outcome: 'win', resigned: false } })];
assert.deepEqual(report(lateSessionFinish).rates.second_match_first_session, { numerator: 0, denominator: 1, rate: 0 });
const invitations = [event(80, 'invite_created', 0, 'host', 'room', { mode: 'friend', platform: 'android' }),
  event(81, 'invite_created', 0, 'host', 'room', { mode: 'friend', platform: 'android' }),
  event(82, 'invite_created', 0, 'host', 'expired', { mode: 'friend', platform: 'android' }),
  event(83, 'invite_joined', 1, 'guest', 'room', { mode: 'friend', platform: 'web' }),
  event(84, 'invite_joined', 1, 'guest', 'room', { mode: 'friend', platform: 'web' })];
assert.deepEqual(reportMarketing(invitations, { asOf: t(5), platform: 'android' }).rates.invite_join, { numerator: 1, denominator: 2, rate: .5 });
const friends = [event(88, 'session_start', 0, 'a'), event(89, 'session_start', 0, 'b'),
  event(90, 'match_start', 1, 'a', 'friend-first', { mode: 'friend' }),
  event(91, 'match_end', 2, 'a', 'friend-first', { mode: 'friend', details: { outcome: 'win', resigned: false } }),
  event(92, 'rematch_start', 3, 'a', 'friend-second', { mode: 'friend', details: { previous_match_id: 'friend-first' } }),
  event(93, 'match_start', 3, 'a', 'friend-second', { mode: 'friend' }),
  event(94, 'match_start', 1, 'b', 'friend-first', { mode: 'friend' }),
  event(95, 'match_end', 2, 'b', 'friend-first', { mode: 'friend', details: { outcome: 'loss', resigned: false } })];
assert.deepEqual(report(friends).rates.friend_rematch, { numerator: 1, denominator: 2, rate: .5 });
const returningOnly = [event(100, 'session_start', 0, 'old', null, { details: { first_session: false } }),
  event(101, 'match_start', 1, 'old', 'later', { mode: 'ai' }),
  event(102, 'match_end', 2, 'old', 'later', { mode: 'ai', details: { outcome: 'win', resigned: false } })];
assert.equal(report(returningOnly).rates.normal_first_completion.denominator, 0);
assert.equal(report(returningOnly).regular.kst_return_after_first_execution.d1.denominator, 0);
