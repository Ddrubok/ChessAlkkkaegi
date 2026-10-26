#!/usr/bin/env node
// Privileged JSON export only. Client events are unverified, pseudonymous observations.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const regular = new Set(['ai', 'friend', 'hotseat']);
const dayMs = 86400000;
const dayKst = ms => new Date(ms + 9 * 3600000).toISOString().slice(0, 10);
const dayNumber = day => Date.parse(`${day}T00:00:00Z`) / dayMs;
const unique = values => new Set(values).size;
const sum = (rows, name) => rows.filter(row => row.name === name).length;
const rate = (numerator, denominator) => ({ numerator, denominator, rate: denominator ? numerator / denominator : null });
const normal = e => e?.name === 'match_end' && e.details?.resigned !== true && ['win', 'loss', 'draw'].includes(e.details?.outcome);

export function reportMarketing(events, { asOf = new Date().toISOString(), environment = 'production', platform, campaignSource } = {}) {
  const now = Date.parse(asOf);
  if (!Number.isFinite(now)) throw new Error('Invalid --as-of');
  const seen = new Set();
  let rows = events.filter(e => {
    if (seen.has(e.event_id)) return false;
    if (!(e.environment === environment && (!platform || e.platform === platform) &&
      Number.isFinite(Date.parse(e.occurred_at)) && Date.parse(e.occurred_at) <= now &&
      Number.isFinite(Date.parse(e.recorded_at ?? e.occurred_at)) && Date.parse(e.recorded_at ?? e.occurred_at) <= now)) return false;
    seen.add(e.event_id);
    return true;
  }).sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));
  if (campaignSource) {
    // Filter acquisition cohorts, retaining their later direct visits and outcomes.
    const firstSessions = new Map();
    for (const e of rows) if (e.name === 'session_start' && e.details?.first_session === true && !firstSessions.has(e.analytics_id)) firstSessions.set(e.analytics_id, e);
    const selected = new Set([...firstSessions].filter(([, e]) => (e.campaign?.source ?? 'unknown') === campaignSource).map(([id]) => id));
    rows = rows.filter(e => selected.has(e.analytics_id));
  }
  const byId = Map.groupBy ? Map.groupBy(rows, e => e.analytics_id) : rows.reduce((m, e) => m.set(e.analytics_id, [...(m.get(e.analytics_id) ?? []), e]), new Map());
  const starts = rows.filter(e => e.name === 'match_start' && regular.has(e.mode) && e.match_id);
  const endings = rows.filter(e => e.name === 'match_end' && regular.has(e.mode) && e.match_id);
  const aborts = rows.filter(e => e.name === 'match_abort' && regular.has(e.mode) && e.match_id);
  const key = e => `${e.environment}\0${e.mode}\0${e.match_id}`;
  const participantKey = e => `${key(e)}\0${e.analytics_id}`;
  const ended = new Set(endings.map(participantKey));
  const aborted = new Set(aborts.map(participantKey));
  const lastRecord = new Map();
  for (const e of rows) if (e.match_id && regular.has(e.mode)) lastRecord.set(participantKey(e), Date.parse(e.occurred_at));
  const pending = new Set(starts.map(participantKey));
  for (const k of ended) pending.delete(k);
  for (const k of aborted) pending.delete(k);
  const cohorts = { d1: rate(0, 0), d7: rate(0, 0) };
  const people = [];
  let firstExecutionUnknown = 0;
  for (const personRows of byId.values()) {
    const firstSession = personRows.find(e => e.name === 'session_start' && e.session_id && e.details?.first_session === true);
    const firstStart = firstSession && personRows.find(e => e.name === 'match_start' && regular.has(e.mode) && e.match_id);
    const firstEnd = firstStart && personRows.find(e => e.name === 'match_end' && e.match_id === firstStart.match_id &&
      e.mode === firstStart.mode && Date.parse(e.occurred_at) >= Date.parse(firstStart.occurred_at));
    const firstFinish = normal(firstEnd) ? firstEnd : null;
    const firstSessionFinish = Boolean(firstSession && firstStart && firstFinish &&
      firstStart.session_id === firstSession.session_id && firstFinish.session_id === firstSession.session_id);
    const second = firstSessionFinish && personRows.some(e => e.name === 'match_start' && regular.has(e.mode) &&
      e.match_id && e.match_id !== firstStart.match_id && e.session_id === firstSession.session_id &&
      Date.parse(e.occurred_at) > Date.parse(firstFinish.occurred_at));
    const firstFriend = firstSession && personRows.find(e => e.name === 'match_start' && e.mode === 'friend' && e.match_id);
    const friendFinish = firstFriend && personRows.find(e => e.name === 'match_end' && e.mode === 'friend' &&
      e.match_id === firstFriend.match_id && Date.parse(e.occurred_at) >= Date.parse(firstFriend.occurred_at));
    const friendNormal = normal(friendFinish);
    const friendRematch = friendNormal && personRows.some(e => e.name === 'rematch_start' && e.mode === 'friend' &&
      e.details?.previous_match_id === firstFriend.match_id && Date.parse(e.occurred_at) >= Date.parse(friendFinish.occurred_at) &&
      personRows.some(start => start.name === 'match_start' && start.mode === 'friend' && start.match_id === e.match_id));
    people.push({ rows: personRows, firstSession, firstStart, firstFinish, firstSessionFinish, second, friendNormal, friendRematch });
    if (!firstSession) { firstExecutionUnknown++; continue; }
    const cohortDay = dayNumber(dayKst(Date.parse(firstSession.occurred_at)));
    const nowDay = dayNumber(dayKst(now));
    for (const [label, offset] of [['d1', 1], ['d7', 7]]) {
      if (nowDay <= cohortDay + offset) continue; // Full KST return date must finish.
      cohorts[label].denominator++;
      if (personRows.some(e => e.name === 'match_start' && regular.has(e.mode) && e.match_id &&
        dayNumber(dayKst(Date.parse(e.occurred_at))) === cohortDay + offset)) cohorts[label].numerator++;
    }
  }
  for (const cohort of Object.values(cohorts)) cohort.rate = cohort.denominator ? cohort.numerator / cohort.denominator : null;
  const ratesFor = group => {
    const entrants = group.filter(p => p.firstSession);
    const has = (p, name) => p.rows.some(e => e.name === name);
    return {
      ready: rate(entrants.filter(p => has(p, 'game_ready')).length, entrants.length),
      start: rate(entrants.filter(p => p.firstStart).length, entrants.length),
      normal_first_completion: rate(group.filter(p => p.firstStart && p.firstFinish).length, group.filter(p => p.firstStart).length),
      entry_completion: rate(entrants.filter(p => p.firstFinish).length, entrants.length),
      second_match_first_session: rate(group.filter(p => p.second).length, group.filter(p => p.firstFinish).length),
      friend_rematch: rate(group.filter(p => p.friendRematch).length, group.filter(p => p.friendNormal).length),
      first_shot: rate(entrants.filter(p => has(p, 'first_shot')).length, entrants.length),
      tutorial_complete: rate(entrants.filter(p => has(p, 'tutorial_complete')).length, entrants.length),
      basic_tutorial_complete: rate(entrants.filter(p => p.rows.some(e => e.name === 'tutorial_complete' && e.details?.tutorial === 'basic')).length, entrants.length),
      advanced_tutorial_complete: rate(entrants.filter(p => p.rows.some(e => e.name === 'tutorial_complete' && e.details?.tutorial === 'advanced')).length, entrants.length),
    };
  };
  const breakdown = field => Object.fromEntries([...new Set(people.map(p => field(p) ?? 'unknown'))].sort().map(value => {
    const group = people.filter(p => (field(p) ?? 'unknown') === value);
    return [value, { analytics_ids: group.length, rates: ratesFor(group) }];
  }));
  const uniqueEndings = [...new Map(endings.slice().reverse().map(e => [participantKey(e), e])).values()];
  const outcomes = { win: 0, loss: 0, draw: 0, resigned: 0 };
  for (const e of uniqueEndings) {
    if (e.details?.resigned === true) outcomes.resigned++;
    else if (normal(e)) outcomes[e.details.outcome]++;
  }
  const createdRooms = new Set(rows.filter(e => e.name === 'invite_created' && e.mode === 'friend' && e.match_id).map(key));
  // A guest can join from another platform/campaign. Attribute that room to its creator's selected scope.
  const joinedRooms = new Set(events.filter(e => e.environment === environment && e.name === 'invite_joined' && e.mode === 'friend' &&
    e.match_id && Date.parse(e.occurred_at) <= now && Date.parse(e.recorded_at ?? e.occurred_at) <= now).map(key));
  return {
    scope: { environment, platform: platform ?? 'all', campaign_source: campaignSource ?? 'all', as_of: asOf },
    unit: 'analytics IDs, not verified people or installs',
    limitations: {
      first_execution_unknown: firstExecutionUnknown,
      first_execution_unknown_excluded_from_cohorts_and_entry_rates: true,
      recorded_at_missing_assumed_occurred_at: rows.some(e => !e.recorded_at),
      cost: 'unavailable: no verified install attribution and attributed spend in this export',
    },
    events: rows.length, analytics_ids: byId.size,
    funnel: Object.fromEntries(['session_start','game_ready','first_shot','tutorial_complete','match_start','match_end','match_abort','invite_created','invite_joined','rematch_start']
      .map(name => [name, { events: name === 'match_end' ? uniqueEndings.length : sum(rows, name),
        analytics_ids: unique(rows.filter(e => e.name === name).map(e => e.analytics_id)) }])),
    rates: { ...ratesFor(people), invite_join: rate([...createdRooms].filter(k => joinedRooms.has(k)).length, createdRooms.size) },
    regular: {
      matches_started: unique(starts.map(key)), matches_ended_reported: unique(endings.map(key)),
      participants_started: unique(starts.map(participantKey)), participants_finished: uniqueEndings.length,
      participant_outcomes: outcomes, participants_aborted: unique(aborts.map(participantKey)),
      participants_unconfirmed_24h: [...pending].filter(k => now - lastRecord.get(k) >= dayMs).length,
      participants_pending_under_24h: [...pending].filter(k => now - lastRecord.get(k) < dayMs).length,
      second_match_after_first_normal_finish_in_first_session: people.filter(p => p.second).length,
      kst_return_after_first_execution: cohorts,
    },
    by_build: breakdown(p => p.firstSession?.build ?? p.rows[0]?.build),
    by_platform: breakdown(p => p.firstSession?.platform ?? p.rows[0]?.platform),
    by_mode: breakdown(p => p.firstStart?.mode),
    by_campaign_source: breakdown(p => p.firstSession?.campaign?.source ?? p.rows[0]?.campaign?.source),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
  const input = option('--input');
  if (!input) {
    console.error('Usage: node scripts/marketing-metrics.mjs --input privileged-export.json [--as-of ISO] [--environment production|development|qa] [--platform web|android] [--campaign-source SOURCE]');
    process.exitCode = 2;
  } else {
    const data = JSON.parse(await readFile(input, 'utf8'));
    const events = Array.isArray(data) ? data : data.events;
    if (!Array.isArray(events)) throw new Error('Export must be an array or {"events":[]}');
    console.log(JSON.stringify(reportMarketing(events, { asOf: option('--as-of'), environment: option('--environment') ?? 'production', platform: option('--platform'), campaignSource: option('--campaign-source') }), null, 2));
  }
}
