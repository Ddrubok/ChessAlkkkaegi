import assert from "node:assert/strict";
import { createMarketingAnalytics, parseMarketingCampaign, type MarketingEvent } from "../marketing-analytics.ts";

const ids = Array.from({ length: 200 }, (_, i) => `00000000-0000-4000-8000-${i.toString(16).padStart(12, "0")}`);
let nextId = 0;
let time = Date.UTC(2026, 9, 26);
const values = new Map<string, string>();
const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
const deliveries: MarketingEvent[][] = [];
let fail = false;
const options = {
  storage, now: () => time, uuid: () => ids[nextId++], environment: "qa" as const, platform: "web" as const,
  build: "check", enabled: true,
  campaign: parseMarketingCampaign("https://example.test/?utm_source=demo&utm_campaign=x_1&utm_content=%3Csecret%3E&token=secret", "web"),
  send: async (events: MarketingEvent[]) => { deliveries.push(structuredClone(events)); if (fail) throw Error("offline"); },
};
const names = () => deliveries.flat().map(e => e.name);
const analytics = createMarketingAnalytics(options);
analytics.ready();
analytics.ready();
analytics.firstShot("tutorial");
analytics.firstShot("ai");
analytics.tutorialComplete("basic");
assert.equal(analytics.startMatch("puzzle"), null);
assert.equal(analytics.startMatch("tutorial"), null);
const firstMatch = analytics.startMatch("ai");
assert.ok(firstMatch);
analytics.endMatch("loss", true);
assert.equal(analytics.getSnapshot().queued, 6);
fail = true;
await analytics.flush();
assert.equal(analytics.getSnapshot().queued, 6);
await analytics.flush();
assert.deepEqual(deliveries[0], deliveries[1], "retry must retain exact payload and event IDs");
fail = false;
await analytics.flush();
assert.equal(analytics.getSnapshot().queued, 0);
assert.equal(names().filter(n => n === "first_shot").length, 3, "one first shot in each retry of the same batch");
const first = deliveries[0];
assert.deepEqual(first.map(e => e.name), ["session_start", "game_ready", "first_shot", "tutorial_complete", "match_start", "match_end"]);
assert.deepEqual(first[5].details, { outcome: "loss", resigned: true });
assert.equal(first[0].details.first_session, true);
assert.deepEqual(first[0].campaign, { source: "demo", campaign: "x_1" });
for (const event of first) {
  assert.deepEqual(Object.keys(event).sort(), ["event_id", "name", "occurred_at", "analytics_id", "session_id", "environment", "platform", "build", "mode", "match_id", "campaign", "details"].sort());
  assert.equal(event.analytics_id, first[0].analytics_id);
  assert.match(event.occurred_at, /^2026-10-26T00:00:00\.000Z$/);
  assert.ok(!JSON.stringify(event).includes("secret"));
}

// A login transition leaves the same pseudonymous browser ID; auth identity is server-side.
const sameBrowser = createMarketingAnalytics(options);
sameBrowser.ready();
assert.equal(sameBrowser.getSnapshot().analyticsId, analytics.getSnapshot().analyticsId);
assert.equal(sameBrowser.getSnapshot().sessionId, analytics.getSnapshot().sessionId);
sameBrowser.firstShot("ai");
assert.equal(sameBrowser.getSnapshot().queued, 0);

// Reload loses the board. It cannot claim that a player abandoned or finished it.
const friendId = ids[150];
sameBrowser.startMatch("friend", friendId);
const afterKill = createMarketingAnalytics(options);
assert.equal(afterKill.getSnapshot().activeMatchId, null);
afterKill.ready();
afterKill.abortMatch("disconnected");
await afterKill.flush();
assert.ok(!names().includes("match_abort"));
assert.equal(names().filter(n => n === "match_start").length, 4); // three retries plus one new match

time += 30 * 60_000;
afterKill.activity();
assert.notEqual(afterKill.getSnapshot().sessionId, first[0].session_id);
await afterKill.flush();
assert.deepEqual(deliveries.at(-1)?.map(e => e.name), ["session_start", "game_ready"]);
assert.equal(deliveries.at(-1)?.[0].details.first_session, false);
assert.equal(afterKill.getSnapshot().analyticsId, first[0].analytics_id);

// Invalid room-like IDs and native attribution never reach the wire.
assert.equal(afterKill.startMatch("friend", "ABCD12"), null);
afterKill.inviteCreated("ABCD12");
assert.equal(afterKill.getSnapshot().queued, 0);
const hashedId = `m-${"a".repeat(64)}`;
afterKill.inviteCreated(hashedId);
assert.equal(afterKill.getSnapshot().queued, 1);
await afterKill.flush();
assert.equal(deliveries.at(-1)?.[0].match_id, hashedId);
assert.equal(parseMarketingCampaign("?utm_source=demo", "android"), null);

let accessed = 0;
const disabled = createMarketingAnalytics({ ...options, enabled: false, storage: {
  getItem: () => { accessed++; throw Error("read"); }, setItem: () => { accessed++; throw Error("write"); },
}, send: async () => { accessed++; } });
disabled.ready(); disabled.firstShot("ai"); disabled.startMatch("ai"); await disabled.flush(); disabled.getSnapshot();
assert.equal(accessed, 0);

const brokenStorage = createMarketingAnalytics({ ...options, storage: {
  getItem: () => { throw Error("blocked"); }, setItem: () => { throw Error("blocked"); },
} });
assert.doesNotThrow(() => { brokenStorage.ready(); brokenStorage.startMatch("ai"); brokenStorage.endMatch("win"); });
await brokenStorage.flush();

const storedKey = "marketing-analytics-v1:qa";
const saved = JSON.parse(values.get(storedKey)!) as { queue: unknown[] };
saved.queue = [{ ...first[0], unexpected: "secret", details: { unexpected: "secret" }, campaign: { source: "demo", token: "secret" } }];
values.set(storedKey, JSON.stringify(saved));
const sanitized = createMarketingAnalytics(options);
await sanitized.flush();
assert.deepEqual(deliveries.at(-1)?.[0], { ...first[0], details: {}, campaign: { source: "demo" } });

// Returning to a still-live board after 30 minutes starts a session, not a new match.
const live = createMarketingAnalytics({ ...options, storage: undefined });
live.ready();
const liveId = live.startMatch("ai");
time += 30 * 60_000;
live.activity();
live.endMatch("win");
await live.flush();
assert.equal(deliveries.at(-1)?.filter(e => e.name === "match_start").length, 1);
assert.equal(deliveries.at(-1)?.find(e => e.name === "match_end")?.match_id, liveId);
console.log("marketing analytics checks passed");
// A reload without the UTM query preserves attribution until that session expires.
const utmState = new Map<string, string>();
const utmOptions = { ...options, storage: {
  getItem: (k: string) => utmState.get(k) ?? null,
  setItem: (k: string, v: string) => { utmState.set(k, v); },
} };
const landing = createMarketingAnalytics(utmOptions);
landing.ready(); await landing.flush();
const reloaded = createMarketingAnalytics({ ...utmOptions, campaign: null });
reloaded.startMatch("hotseat"); await reloaded.flush();
assert.equal(deliveries.at(-1)?.[0].campaign?.source, "demo");
time += 30 * 60_000;
reloaded.endMatch("win"); await reloaded.flush();
assert.equal(deliveries.at(-1)?.at(-1)?.campaign, null);
