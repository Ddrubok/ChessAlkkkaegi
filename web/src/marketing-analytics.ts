/** Client-reported product events. The server must not treat these as match evidence. */
export type MarketingMode = "menu" | "ai" | "friend" | "hotseat" | "tutorial" | "puzzle" | "weekly" | "ranked";
export type RegularMode = "ai" | "friend" | "hotseat" | "ranked";
export type MarketingEventName = "session_start" | "game_ready" | "first_shot" | "tutorial_complete" | "match_start" | "match_end" | "match_abort" | "invite_created" | "invite_joined" | "rematch_start";
export type MarketingCampaign = Partial<Record<"source" | "campaign" | "content", string>>;
export type MarketingDetails = {
  first_session?: boolean;
  outcome?: "win" | "loss" | "draw";
  resigned?: boolean;
  reason?: "menu_exit" | "restart" | "disconnected" | "error";
  tutorial?: "basic" | "advanced";
  previous_match_id?: string;
};
export type MarketingEvent = {
  event_id: string;
  name: MarketingEventName;
  occurred_at: string;
  analytics_id: string;
  session_id: string;
  environment: "production" | "development" | "qa";
  platform: "web" | "android";
  build: string;
  mode: MarketingMode;
  match_id: string | null;
  campaign: MarketingCampaign | null;
  details: MarketingDetails;
};

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;
export type MarketingAnalyticsOptions = {
  storage?: Storage;
  now?: () => number;
  uuid?: () => string;
  environment: MarketingEvent["environment"];
  platform: MarketingEvent["platform"];
  build: string;
  enabled: boolean;
  /** Resolve only after record_marketing_events has accepted the full batch; reject on RPC error. */
  send: (events: MarketingEvent[]) => Promise<void>;
  campaign?: MarketingCampaign | null;
};

type ActiveMatch = { mode: RegularMode; matchId: string; sessionId: string };
type State = {
  analyticsId: string;
  sessionId: string;
  lastActivity: number;
  readySessionId: string | null;
  firstShot: boolean;
  campaign: MarketingCampaign | null;
  active: ActiveMatch | null;
  queue: MarketingEvent[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRIVATE_MATCH_ID = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|m-[0-9a-f]{64})$/i;
const CAMPAIGN_VALUE = /^[A-Za-z0-9_.-]{1,64}$/;
const REGULAR = new Set<MarketingMode>(["ai", "friend", "hotseat", "ranked"]);
const MODES = new Set<MarketingMode>(["menu", "ai", "friend", "hotseat", "tutorial", "puzzle", "weekly", "ranked"]);
const NAMES = new Set<MarketingEventName>(["session_start", "game_ready", "first_shot", "tutorial_complete", "match_start", "match_end", "match_abort", "invite_created", "invite_joined", "rematch_start"]);
const IDLE_MS = 30 * 60_000;
const MAX_QUEUE = 100;
const BATCH_SIZE = 20;

/** Parse only approved UTM fields. Native install attribution stays unknown until separately verified. */
export function parseMarketingCampaign(url: string | URL, platform: MarketingEvent["platform"] = "web"): MarketingCampaign | null {
  if (platform !== "web") return null;
  try {
    const text = url.toString();
    const params = text.startsWith("?") ? new URLSearchParams(text.slice(1)) : new URL(text).searchParams;
    const campaign: MarketingCampaign = {};
    for (const key of ["source", "campaign", "content"] as const) {
      const value = params.get(`utm_${key}`);
      if (value && CAMPAIGN_VALUE.test(value)) campaign[key] = value;
    }
    return Object.keys(campaign).length ? campaign : null;
  } catch { return null; }
}

export function createMarketingAnalytics(options: MarketingAnalyticsOptions) {
  const disabled = !options.enabled || typeof options.build !== "string" || options.build.length > 80;
  const now = options.now ?? Date.now;
  const uuid = options.uuid ?? (() => globalThis.crypto.randomUUID());
  const key = `marketing-analytics-v1:${options.environment}`;
  const safeUuid = () => { try { const id = uuid(); return UUID.test(id) ? id : null; } catch { return null; } };
  const fresh = (): State => ({ analyticsId: safeUuid() ?? "", sessionId: "", lastActivity: 0, readySessionId: null, firstShot: false, campaign: null, active: null, queue: [] });
  let state = fresh();
  let loaded = false;
  let sending: Promise<void> | null = null;
  let ready = false;
  const campaign = options.platform === "web" && options.campaign
    ? Object.fromEntries(Object.entries(options.campaign).filter(([k, v]) => ["source", "campaign", "content"].includes(k) && typeof v === "string" && CAMPAIGN_VALUE.test(v))) as MarketingCampaign
    : null;

  function persist() { if (disabled) return; try { options.storage?.setItem(key, JSON.stringify(state)); } catch { /* Storage is optional. */ } }
  function load() {
    if (loaded || disabled) return;
    loaded = true;
    try {
      const raw = options.storage?.getItem(key);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<State>;
        if (UUID.test(saved.analyticsId ?? "")) state.analyticsId = saved.analyticsId!;
        if (UUID.test(saved.sessionId ?? "")) state.sessionId = saved.sessionId!;
        if (typeof saved.lastActivity === "number" && Number.isFinite(saved.lastActivity)) state.lastActivity = saved.lastActivity;
        if (UUID.test(saved.readySessionId ?? "")) state.readySessionId = saved.readySessionId!;
        state.firstShot = saved.firstShot === true;
        if (saved.campaign && typeof saved.campaign === "object") {
          state.campaign = Object.fromEntries(Object.entries(saved.campaign).filter(([k, v]) =>
            ["source", "campaign", "content"].includes(k) && typeof v === "string" && CAMPAIGN_VALUE.test(v)));
        }
        if (Array.isArray(saved.queue)) state.queue = saved.queue.map(readStoredEvent).filter((event): event is MarketingEvent => event !== null).slice(-MAX_QUEUE);
      }
    } catch { /* Corrupt or unavailable storage must not stop play. */ }
    // A board cannot be resumed by this module. A reload is not an observed abort.
    state.active = null;
    persist();
  }
  function readStoredEvent(event: unknown): MarketingEvent | null {
    if (!event || typeof event !== "object") return null;
    const e = event as Partial<MarketingEvent>;
    if (!UUID.test(e.event_id ?? "") || !UUID.test(e.analytics_id ?? "") || !UUID.test(e.session_id ?? "") ||
        !NAMES.has(e.name as MarketingEventName) || !MODES.has(e.mode as MarketingMode) ||
        e.environment !== options.environment || e.platform !== options.platform ||
        typeof e.build !== "string" || e.build.length > 80 ||
        typeof e.occurred_at !== "string" || !Number.isFinite(Date.parse(e.occurred_at)) ||
        Date.parse(e.occurred_at) < now() - 90 * 86400000 ||
        (e.match_id !== null && (typeof e.match_id !== "string" || !PRIVATE_MATCH_ID.test(e.match_id))) ||
        !e.details || typeof e.details !== "object" || Array.isArray(e.details)) return null;
    const details: MarketingDetails = {};
    if (e.details.first_session !== undefined) {
      if (typeof e.details.first_session !== "boolean") return null;
      details.first_session = e.details.first_session;
    }
    if (e.details.outcome !== undefined) {
      if (!["win", "loss", "draw"].includes(e.details.outcome)) return null;
      details.outcome = e.details.outcome;
    }
    if (e.details.resigned !== undefined) {
      if (typeof e.details.resigned !== "boolean") return null;
      details.resigned = e.details.resigned;
    }
    if (e.details.reason !== undefined) {
      if (!["menu_exit", "restart", "disconnected", "error"].includes(e.details.reason)) return null;
      details.reason = e.details.reason;
    }
    if (e.details.tutorial !== undefined) {
      if (!["basic", "advanced"].includes(e.details.tutorial)) return null;
      details.tutorial = e.details.tutorial;
    }
    if (e.details.previous_match_id !== undefined) {
      if (!PRIVATE_MATCH_ID.test(e.details.previous_match_id)) return null;
      details.previous_match_id = e.details.previous_match_id;
    }
    const savedCampaign = e.campaign;
    const cleanCampaign: MarketingCampaign = {};
    if (savedCampaign && typeof savedCampaign === "object" && !Array.isArray(savedCampaign)) {
      for (const key of ["source", "campaign", "content"] as const) {
        const value = savedCampaign[key];
        if (typeof value === "string" && CAMPAIGN_VALUE.test(value)) cleanCampaign[key] = value;
      }
    }
    return { event_id: e.event_id!, name: e.name!, occurred_at: new Date(e.occurred_at).toISOString(),
      analytics_id: e.analytics_id!, session_id: e.session_id!, environment: e.environment,
      platform: e.platform, build: e.build, mode: e.mode!, match_id: e.match_id ?? null,
      campaign: Object.keys(cleanCampaign).length ? cleanCampaign : null, details };
  }
  function emit(name: MarketingEventName, mode: MarketingMode, matchId: string | null = null, details: MarketingDetails = {}) {
    const eventId = safeUuid();
    if (!eventId || !state.analyticsId || !state.sessionId) return;
    const event: MarketingEvent = {
      event_id: eventId, name, occurred_at: new Date(now()).toISOString(), analytics_id: state.analyticsId,
      session_id: state.sessionId, environment: options.environment, platform: options.platform,
      build: options.build, mode, match_id: matchId, campaign: state.campaign && Object.keys(state.campaign).length ? state.campaign : null, details,
    };
    state.queue.push(event);
    if (state.queue.length > MAX_QUEUE) state.queue.splice(0, state.queue.length - MAX_QUEUE);
    persist();
  }
  function touch() {
    if (disabled) return false;
    load();
    const current = now();
    if (!Number.isFinite(current)) return false;
    if (!state.analyticsId) state.analyticsId = safeUuid() ?? "";
    if (!state.analyticsId) return false;
    if (!state.sessionId || current - state.lastActivity >= IDLE_MS || current < state.lastActivity) {
      const firstSession = !state.sessionId;
      state.sessionId = safeUuid() ?? "";
      state.readySessionId = null;
      state.campaign = campaign;
      // A live board may survive a long background pause; a new session does not end its match.
      if (!state.sessionId) return false;
      emit("session_start", "menu", null, { first_session: firstSession });
      if (ready) markReady();
    }
    state.lastActivity = current;
    persist();
    return true;
  }
  function markReady() {
    if (state.readySessionId === state.sessionId) return;
    state.readySessionId = state.sessionId;
    emit("game_ready", "menu");
    persist();
  }
  function validMatchId(id: string | undefined): id is string { return typeof id === "string" && PRIVATE_MATCH_ID.test(id) && id.length <= 160; }
  function matchEvent(name: "invite_created" | "invite_joined", matchId: string) {
    if (!validMatchId(matchId) || !touch()) return;
    emit(name, "friend", matchId);
  }

  return {
    /** Call when the game accepts input; safe to call repeatedly. */
    ready() { if (disabled) return; ready = true; if (touch()) markReady(); },
    /** Call for meaningful player activity, not timer ticks. */
    activity() { if (!disabled) touch(); },
    /** Call only after a valid shot succeeds. Once per browser install and environment. */
    firstShot(mode: MarketingMode) { if (disabled || !touch() || state.firstShot) return; state.firstShot = true; emit("first_shot", state.active?.mode ?? mode, state.active?.matchId ?? null); persist(); },
    tutorialComplete(type: "basic" | "advanced") { if (!disabled && (type === "basic" || type === "advanced") && touch()) emit("tutorial_complete", "tutorial", null, { tutorial: type }); },
    /** matchId and previousMatchId must be private UUIDs or m- SHA-256 IDs, never room codes. */
    startMatch(mode: MarketingMode, matchId?: string, previousMatchId?: string) {
      if (disabled || !REGULAR.has(mode) || (matchId !== undefined && !validMatchId(matchId)) ||
          (previousMatchId !== undefined && !validMatchId(previousMatchId)) || !touch()) return null;
      const id = matchId ?? safeUuid();
      if (!id || state.active) return null;
      state.active = { mode: mode as RegularMode, matchId: id, sessionId: state.sessionId };
      persist();
      emit("match_start", mode, id);
      if (previousMatchId) emit("rematch_start", mode, id, { previous_match_id: previousMatchId });
      return id;
    },
    endMatch(outcome: "win" | "loss" | "draw", resigned = false) {
      if (disabled || !["win", "loss", "draw"].includes(outcome) || !state.active || !touch()) return;
      const active = state.active;
      if (!active) return;
      state.active = null;
      emit("match_end", active.mode, active.matchId, { outcome, resigned: Boolean(resigned) });
      persist();
    },
    abortMatch(reason: "menu_exit" | "restart" | "disconnected" | "error") {
      if (disabled || !["menu_exit", "restart", "disconnected", "error"].includes(reason) || !state.active || !touch()) return;
      const active = state.active;
      if (!active) return;
      state.active = null;
      emit("match_abort", active.mode, active.matchId, { reason });
      persist();
    },
    inviteCreated(matchId: string) { matchEvent("invite_created", matchId); },
    inviteJoined(matchId: string) { matchEvent("invite_joined", matchId); },
    /** Call periodically and on visibility changes. An error retains the same event IDs for retry. */
    flush(): Promise<void> {
      if (disabled) return Promise.resolve();
      load();
      if (sending) return sending;
      state.queue = state.queue.filter(e => Date.parse(e.occurred_at) >= now() - 90 * 86400000);
      persist();
      if (!state.queue.length) return Promise.resolve();
      const batch = state.queue.slice(0, BATCH_SIZE);
      sending = Promise.resolve().then(() => options.send(batch)).then(() => {
        const sent = new Set(batch.map(e => e.event_id));
        state.queue = state.queue.filter(e => !sent.has(e.event_id));
        persist();
      }).catch(() => { /* Retry on next flush. */ }).finally(() => { sending = null; });
      return sending;
    },
    getSnapshot() {
      if (disabled) return { enabled: false as const, analyticsId: null, sessionId: null, queued: 0, activeMatchId: null, firstShot: false };
      load();
      return { enabled: true as const, analyticsId: state.analyticsId || null, sessionId: state.sessionId || null,
        queued: state.queue.length, activeMatchId: state.active?.matchId ?? null, firstShot: state.firstShot };
    },
  };
}
