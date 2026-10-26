import { Capacitor } from "@capacitor/core";
import { PLATFORM } from "./platform";
import { getSupabaseClient } from "./supabase-client";
import { createMarketingAnalytics, parseMarketingCampaign } from "./marketing-analytics";
import type { GameMode } from "./game-mode";

// Enable only after the collector migration and privacy disclosures are deployed.
const enabled = PLATFORM.id !== "poki" && import.meta.env?.VITE_MARKETING_ENABLED === "true";
const native = Capacitor.getPlatform() === "android";
const localWeb = !native && typeof location !== "undefined" && ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
const environment = (typeof navigator !== "undefined" && navigator.webdriver) || import.meta.env?.VITE_MARKETING_ENV === "qa" ? "qa"
  : localWeb || import.meta.env?.VITE_MARKETING_ENV === "development" || import.meta.env?.MODE === "staging" || import.meta.env?.DEV ? "development" : "production";
let storage: Storage | undefined;
if (enabled) { try { storage = window.localStorage; } catch { /* Restricted storage must not block play. */ } }
const analytics = createMarketingAnalytics({
  enabled, storage,
  environment, platform: native ? "android" : "web",
  build: typeof __BUILD_INFO__ !== "undefined" ? __BUILD_INFO__.build : "unknown",
  campaign: native || typeof window === "undefined" ? null : parseMarketingCampaign(window.location?.search ?? ""),
  send: async (events) => {
    const client = getSupabaseClient();
    if (!client) throw new Error("Marketing collector unavailable");
    const { error } = await client.rpc("record_marketing_events", { p_events: events })
      .abortSignal(AbortSignal.timeout(8000));
    if (error) throw error;
  },
});

// Serializing only telemetry preserves start/end order while hashing shared match IDs.
// The game never waits for this chain or a network request.
let pending = Promise.resolve();
const record = (action: () => void | Promise<void>): void => {
  if (enabled) pending = pending.then(action).catch(() => {});
};
const modeFor = (mode: GameMode) => mode === "stage" ? "ai" : mode === "online" ? "friend" : mode;
let lastOnlineId: string | undefined;
export async function privateMarketingMatchId(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`chessalkkagi:marketing:v1:${raw}`));
  return `m-${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}`;
}

export const marketingRuntime = {
  ready: () => record(() => analytics.ready()),
  activity: () => record(() => analytics.activity()),
  firstShot: (mode: GameMode) => record(() => analytics.firstShot(modeFor(mode))),
  tutorialComplete: (type: "basic" | "advanced") => record(() => analytics.tutorialComplete(type)),
  startLocalMatch: (mode: GameMode) => record(() => {
    analytics.abortMatch("restart");
    if (mode === "stage" || mode === "hotseat") analytics.startMatch(modeFor(mode));
  }),
  startOnlineMatch: (id: string, ranked = false, rematch = false) => record(async () => {
    const next = await privateMarketingMatchId(id);
    const previous = rematch ? lastOnlineId : undefined;
    analytics.abortMatch("restart");
    analytics.startMatch(ranked ? "ranked" : "friend", next, previous);
    lastOnlineId = next;
  }),
  endMatch: (winner: "white" | "black" | "draw", ownSide: "white" | "black" = "white", resigned = false) =>
    record(() => analytics.endMatch(winner === "draw" ? "draw" : winner === ownSide ? "win" : "loss", resigned)),
  abortMatch: (reason: "menu_exit" | "restart" | "disconnected" | "error") => record(() => analytics.abortMatch(reason)),
  inviteCreated: (id: string) => record(async () => analytics.inviteCreated(await privateMarketingMatchId(id))),
  inviteJoined: (id: string) => record(async () => analytics.inviteJoined(await privateMarketingMatchId(id))),
  flush: async () => { await pending; await analytics.flush(); },
  // Local QA reads this through a test-only Vite injection; no player UI is added.
  snapshot: () => analytics.getSnapshot(),
};

if (enabled) {
  analytics.activity();
  document.addEventListener("pointerdown", marketingRuntime.activity, { passive: true });
  document.addEventListener("keydown", marketingRuntime.activity, { passive: true });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void marketingRuntime.flush(); });
  window.addEventListener("online", () => { void marketingRuntime.flush(); });
  window.addEventListener("pagehide", () => { void marketingRuntime.flush(); });
  // No synthetic abort on pagehide: app termination is inferred after 24 hours in reports.
  window.setInterval(() => { void marketingRuntime.flush(); }, 10000);
}
