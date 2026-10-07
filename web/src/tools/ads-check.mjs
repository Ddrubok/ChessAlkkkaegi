// Real ad modules with mocked SDK boundaries. No requests or real impressions.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';

async function setup({ native = false, mode = 'off', consent = true, blocked = false, ids = true, banner = false,
  prepare = async () => ({ adUnitId: 'test' }) } = {}) {
  const scripts = [], listeners = new Map(), timers = new Map(), storage = new Map();
  let muted = false, initialized = 0, rewardBehavior = () => {}, bannerHidden = false;
  let interstitialBehavior = () => {};
  let interstitialPrepareCalls = 0;
  let prepareBehavior = prepare;
  let nowOffset = 0;
  const MockDate = class extends Date {
    static now() { return Date.now() + nowOffset; }
  };
  const app = { inert: false };
  const window = { location: { search: '' }, setTimeout: (fn) => { timers.set(fn, fn); return fn; } };
  const document = {
    documentElement: { style: { setProperty: (key, value) => storage.set(key, value) } },
    getElementById: () => app,
    createElement: () => ({ dataset: {}, style: {} }),
    head: { append: (script) => {
      scripts.push(script);
      queueMicrotask(() => {
        if (blocked) script.onerror();
        else { script.onload(); window.adsbygoogle?.find((o) => o.onReady)?.onReady(); }
      });
    } },
  };
  const sdk = {
    requestConsentInfo: async () => ({ status: 'NOT_REQUIRED', canRequestAds: consent }),
    initialize: async () => { initialized++; },
    addListener: async (event, fn) => {
      listeners.set(event, fn);
      return { remove: async () => listeners.delete(event) };
    },
    prepareRewardVideoAd: async () => {},
    showRewardVideoAd: () => { rewardBehavior(); return new Promise(() => {}); },
    prepareInterstitial: async (opts) => { interstitialPrepareCalls++; return prepareBehavior(opts); },
    showInterstitial: async () => { return interstitialBehavior(); },
    hideBanner: async () => { bannerHidden = true; },
    resumeBanner: async () => { bannerHidden = false; listeners.get('bannerSize')?.({ height: 60 }); },
    showBanner: async () => { listeners.get('bannerSize')?.({ height: 60 }); },
  };
  const rewardEvents = { Dismissed: 'dismissed', FailedToShow: 'failed', Showed: 'shown', Rewarded: 'reward' };
  const interstitialEvents = {
    Dismissed: 'interstitialDismissed',
    FailedToShow: 'interstitialFailedToShow',
    Showed: 'interstitialShowed',
  };
  const context = createContext({ window, document, console, URLSearchParams, Date: MockDate,
    clearTimeout: (id) => timers.delete(id),
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    sessionStorage: { getItem: () => null, setItem: () => {} }, alert: () => {},
  });
  const cache = new Map();
  const env = { DEV: false, VITE_WEB_ADS_MODE: mode,
    VITE_ADMOB_BANNER_ID: banner ? 'ca-app-pub-1234567890123456/1234567890' : '',
    VITE_ADSENSE_SLOT_ID: '1234567890',
    VITE_ADMOB_REWARDED_ID: ids ? 'ca-app-pub-1234567890123456/1234567890' : '',
    VITE_ADMOB_INTERSTITIAL_ID: ids ? 'ca-app-pub-1234567890123456/1234567890' : '' };
  async function load(name) {
    if (cache.has(name)) return cache.get(name);
    const exports = name === '@capacitor/core' ? { Capacitor: { isNativePlatform: () => native } }
      : name === '@capacitor-community/admob' ? { AdMob: sdk, RewardAdPluginEvents: rewardEvents,
          BannerAdPluginEvents: { SizeChanged: 'bannerSize' }, BannerAdPosition: { BOTTOM_CENTER: 'bottom' }, BannerAdSize: { ADAPTIVE_BANNER: 'adaptive' },
          InterstitialAdPluginEvents: interstitialEvents, AdmobConsentStatus: { REQUIRED: 'REQUIRED' } }
      : name === './sound' ? { setAdSoundMuted: (value) => { muted = value; } } : null;
    let module;
    if (exports) module = new SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context });
    else {
      const source = await readFile(new URL(`../${name.replace('./', '')}.ts`, import.meta.url), 'utf8');
      module = new SourceTextModule(stripTypeScriptTypes(source), { context,
        initializeImportMeta: (meta) => { meta.env = env; },
        importModuleDynamically: async (specifier) => { const mod = await load(specifier); if (mod.status !== 'evaluated') await mod.evaluate(); return mod; },
      });
    }
    cache.set(name, module);
    await module.link(load);
    return module;
  }
  const mod = await load('./ad-manager'); await mod.evaluate();
  const manager = mod.namespace.AdManager;
  await manager.init();
  return { manager, scripts, window, timers, app, listeners, sdk, storage,
    web: cache.get('./web-ads').namespace,
    muted: () => muted, initialized: () => initialized, bannerHidden: () => bannerHidden,
    nativeReward: (fn) => { rewardBehavior = fn; },
    nativeInterstitial: (fn) => { interstitialBehavior = fn; },
    setPrepareBehavior: (fn) => { prepareBehavior = fn; },
    getPrepareCount: () => interstitialPrepareCalls,
    advanceTime: (ms) => { nowOffset += ms; },
  };
}

for (const mode of ['off', 'invalid', 'display']) {
  const s = await setup({ mode });
  assert.equal(s.scripts.length, 0, 'game does not load display/off ads');
  assert.equal(await s.manager.showRewardVideo(() => assert.fail()), false);
}
const display = await setup({ mode: 'display' });
const box = { hidden: true, replaceChildren(ad) { this.ad = ad; } };
await display.web.showContentAd(box);
assert.equal(box.hidden, false); assert.equal(box.ad.dataset.adSlot, '1234567890');
assert.equal(display.scripts.length, 1);

const blocked = await setup({ mode: 'h5', blocked: true });
assert.equal(blocked.manager.isRewardAvailable(), false);
assert.equal(await blocked.manager.showRewardVideo(() => assert.fail()), false);

const h5 = await setup({ mode: 'h5' });
let rewards = 0;
h5.window.adBreak = (o) => o.adBreakDone();
assert.equal(await h5.manager.showRewardVideo(() => rewards++), false, 'no fill completes');
h5.window.adBreak = (o) => { o.beforeAd(); o.adDismissed(); o.adViewed(); o.adBreakDone(); };
assert.equal(await h5.manager.showRewardVideo(() => rewards++), false, 'cancel cannot reward');
assert.equal(rewards, 0);
let pending;
h5.window.adBreak = (o) => { pending = o; };
const waiting = h5.manager.showRewardVideo(() => rewards++);
assert.equal(h5.app.inert, true);
assert.equal(await h5.manager.showRewardVideo(() => rewards++), false, 'duplicate blocked');
for (const timer of h5.timers.values()) timer();
assert.equal(await waiting, false);
pending.adViewed(); assert.equal(rewards, 0, 'late callback ignored');
assert.equal(h5.app.inert, false); assert.equal(h5.muted(), false);
h5.window.adBreak = (o) => { o.beforeReward(() => { o.beforeAd(); o.adViewed(); o.adViewed(); o.afterAd(); o.adBreakDone(); }); };
assert.equal(await h5.manager.showRewardVideo(() => rewards++), true);
assert.equal(rewards, 1, "one callback for one verified completion");
rewards = 0;
await h5.manager.hideBanner();
assert.equal(await h5.manager.showRewardVideo(() => assert.fail()), false, 'no ads during play');

for (const options of [{ consent: false }, { ids: false }]) {
  const s = await setup({ native: true, mode: 'h5', ...options });
  assert.equal(s.scripts.length, 0, 'native never loads AdSense');
  assert.equal(s.manager.isRewardAvailable(), false);
  assert.equal(s.initialized(), 0);
}
const native = await setup({ native: true, mode: 'h5' });
assert.equal(native.scripts.length, 0);
native.nativeReward(() => native.listeners.get('dismissed')());
assert.equal(await native.manager.showRewardVideo(() => assert.fail()), false, 'dismissal resolves even when plugin promise does not');
assert.equal(native.listeners.size, 0);
native.nativeReward(() => {
  native.listeners.get('shown')(); native.listeners.get('reward')(); native.listeners.get('reward')(); native.listeners.get('dismissed')();
});
assert.equal(await native.manager.showRewardVideo(() => rewards++), true);
assert.equal(rewards, 1); assert.equal(native.listeners.size, 0);
assert.equal(native.app.inert, false); assert.equal(native.muted(), false);
console.log('PASS: platform/approval gates, display slot, blocked SDK, no fill, cancel, timeout, duplicate reward, native dismissal and cleanup');
const banner = await setup({ native: true, banner: true });
await banner.manager.showBanner();
assert.equal(banner.storage.get('--menu-ad-inset'), '84px');
await banner.manager.showBanner(); assert.equal(banner.listeners.size, 1);
banner.listeners.get('bannerSize')({ height: 100 });
assert.equal(banner.storage.get('--menu-ad-inset'), '124px');
await banner.manager.hideBanner();
banner.listeners.get('bannerSize')({ height: 60 });
assert.equal(banner.storage.get('--menu-ad-inset'), '0px');
assert.equal(banner.bannerHidden(), true);
await banner.manager.showBanner();
assert.equal(banner.bannerHidden(), false, 'returning to menu restores the native banner visibility');
assert.equal(banner.storage.get('--menu-ad-inset'), '84px');
const originalShowBanner = banner.sdk.showBanner;
banner.sdk.showBanner = async () => { await banner.manager.hideBanner(); };
await banner.manager.showBanner();
assert.equal(banner.bannerHidden(), true, 'entering gameplay during banner load must keep it hidden');
banner.sdk.showBanner = originalShowBanner;
console.log('PASS banner space: measured height plus gap, resize, one listener, hide and late-event guard');

// Native interstitial tests
// 1. Web platform skip
const webAds = await setup({ native: false });
assert.equal(await webAds.manager.showInterstitial(), false, 'web platform must skip interstitial');

// 2. Load failure
const loadFail = await setup({ native: true, prepare: async () => { throw new Error('AdMob load failed'); } });
await loadFail.manager.preloadInterstitial();
assert.equal(await loadFail.manager.showInterstitial(), false, 'load failure immediately returns false');
assert.equal(loadFail.app.inert, false, 'overlay not locked on load failure');
assert.equal(loadFail.muted(), false, 'sound not muted on load failure');

// 3. Not ready immediately returns false without waiting (triggers background preload)
let pendingPreloadResolve;
let lateShows = 0;
const notReady = await setup({ native: true, prepare: () => new Promise((resolve) => { pendingPreloadResolve = resolve; }) });
notReady.nativeInterstitial(() => { lateShows++; });
assert.equal(await notReady.manager.showInterstitial(), false, 'not ready ad immediately returns false');
pendingPreloadResolve();
await notReady.manager.preloadInterstitial();
assert.equal(lateShows, 0, 'a late preload must not display an ad after the transition was skipped');

// 4. Successful dismissed display
const interstitial = await setup({ native: true });
await interstitial.manager.preloadInterstitial();
let shownCount = 0;
interstitial.nativeInterstitial(() => {
  shownCount++;
  interstitial.listeners.get('interstitialShowed')();
  assert.equal(interstitial.app.inert, true, 'app inert during interstitial display');
  assert.equal(interstitial.muted(), true, 'sound muted during interstitial display');
  interstitial.listeners.get('interstitialDismissed')();
});
assert.equal(await interstitial.manager.showInterstitial(), true, 'dismissal resolves true');
assert.equal(shownCount, 1, 'interstitial showed once');
assert.equal(interstitial.app.inert, false, 'app inert restored after dismissal');
assert.equal(interstitial.muted(), false, 'sound unmuted after dismissal');
assert.equal(interstitial.listeners.size, 0, 'listeners cleaned up after dismissal');

// 5. Cooldown (3 minutes) and impression counting on actual Showed event only
await interstitial.manager.preloadInterstitial();
assert.equal(await interstitial.manager.showInterstitial(), false, 'blocked during cooldown');
interstitial.advanceTime(2 * 60 * 1000);
assert.equal(await interstitial.manager.showInterstitial(), false, 'blocked at 2 minutes into cooldown');
interstitial.advanceTime(1 * 60 * 1000 + 1000);
let cooldownExpiredShow = false;
interstitial.nativeInterstitial(() => {
  cooldownExpiredShow = true;
  interstitial.listeners.get('interstitialShowed')();
  interstitial.listeners.get('interstitialDismissed')();
});
assert.equal(await interstitial.manager.showInterstitial(), true, 'shows after 3 minute cooldown');
assert.equal(cooldownExpiredShow, true);

// 6. FailedToShow does NOT trigger cooldown (only actual Showed event counts)
const failedShow = await setup({ native: true });
await failedShow.manager.preloadInterstitial();
failedShow.nativeInterstitial(() => {
  failedShow.listeners.get('interstitialFailedToShow')();
});
assert.equal(await failedShow.manager.showInterstitial(), false, 'FailedToShow resolves false');
assert.equal(failedShow.app.inert, false, 'cleanup input on failure');
assert.equal(failedShow.muted(), false, 'cleanup sound on failure');
assert.equal(failedShow.listeners.size, 0, 'cleanup listeners on failure');

await failedShow.manager.preloadInterstitial();
let retrySuccess = false;
failedShow.nativeInterstitial(() => {
  retrySuccess = true;
  failedShow.listeners.get('interstitialShowed')();
  failedShow.listeners.get('interstitialDismissed')();
});
assert.equal(await failedShow.manager.showInterstitial(), true, 'next ad shows immediately because failed show did not trigger cooldown');
assert.equal(retrySuccess, true);

// 7. Duplicate calls (prevent double calls)
const duplicateTest = await setup({ native: true });
await duplicateTest.manager.preloadInterstitial();
let signalShown;
const didShow = new Promise(resolve => { signalShown = resolve; });
duplicateTest.nativeInterstitial(() => {
  duplicateTest.listeners.get('interstitialShowed')();
  signalShown();
});
const inFlightShow = duplicateTest.manager.showInterstitial();
assert.equal(await duplicateTest.manager.showInterstitial(), false, 'concurrent showInterstitial call returns false');
await didShow;
duplicateTest.listeners.get('interstitialDismissed')();
assert.equal(await inFlightShow, true);

// 8. Active gameplay guard
const gameplayTest = await setup({ native: true });
await gameplayTest.manager.preloadInterstitial();
await gameplayTest.manager.hideBanner();
assert.equal(await gameplayTest.manager.showInterstitial(), false, 'blocked during active gameplay');
await gameplayTest.manager.showBanner();
let gameToMenuShow = false;
gameplayTest.nativeInterstitial(() => {
  gameToMenuShow = true;
  gameplayTest.listeners.get('interstitialShowed')();
  gameplayTest.listeners.get('interstitialDismissed')();
});
assert.equal(await gameplayTest.manager.showInterstitial(), true, 'allowed after returning to menu');
assert.equal(gameToMenuShow, true);

// 9. Preload expiry (55 minutes)
const expiryTest = await setup({ native: true });
await expiryTest.manager.preloadInterstitial();
expiryTest.advanceTime(55 * 60 * 1000 + 1000);
assert.equal(await expiryTest.manager.showInterstitial(), false, 'expired preloaded ad returns false');
await expiryTest.manager.preloadInterstitial();
let freshAdShown = false;
expiryTest.nativeInterstitial(() => {
  freshAdShown = true;
  expiryTest.listeners.get('interstitialShowed')();
  expiryTest.listeners.get('interstitialDismissed')();
});
assert.equal(await expiryTest.manager.showInterstitial(), true, 'replenished fresh ad shows successfully');
assert.equal(freshAdShown, true);

// 10. SDK show rejection cleanup
const rejectTest = await setup({ native: true });
await rejectTest.manager.preloadInterstitial();
rejectTest.nativeInterstitial(() => {
  throw new Error('SDK rejected show call');
});
assert.equal(await rejectTest.manager.showInterstitial(), false, 'SDK rejection caught and resolves false');
assert.equal(rejectTest.app.inert, false, 'overlay cleaned up after SDK rejection');
assert.equal(rejectTest.muted(), false, 'sound unmuted after SDK rejection');
assert.equal(rejectTest.listeners.size, 0, 'listeners cleaned up after SDK rejection');

console.log('PASS native interstitial: web skip, ready/not ready, load failure, dismissed display, cooldown, duplicates, gameplay guard, 55m expiry, cleanup');
