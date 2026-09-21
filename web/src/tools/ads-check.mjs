// Real ad modules with mocked SDK boundaries. No requests or real impressions.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';

async function setup({ native = false, mode = 'off', consent = true, blocked = false, ids = true, banner = false } = {}) {
  const scripts = [], listeners = new Map(), timers = new Map(), storage = new Map();
  let muted = false, initialized = 0, rewardBehavior = () => {};
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
    hideBanner: async () => {},
    showBanner: async () => { listeners.get('bannerSize')?.({ height: 60 }); },
  };
  const rewardEvents = { Dismissed: 'dismissed', FailedToShow: 'failed', Showed: 'shown', Rewarded: 'reward' };
  const context = createContext({ window, document, console, URLSearchParams, Date,
    clearTimeout: (id) => timers.delete(id),
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    sessionStorage: { getItem: () => null, setItem: () => {} }, alert: () => {},
  });
  const cache = new Map();
  const env = { DEV: false, VITE_WEB_ADS_MODE: mode,
    VITE_ADMOB_BANNER_ID: banner ? 'ca-app-pub-1234567890123456/1234567890' : '',
    VITE_ADSENSE_SLOT_ID: '1234567890',
    VITE_ADMOB_REWARDED_ID: ids ? 'ca-app-pub-1234567890123456/1234567890' : '' };
  async function load(name) {
    if (cache.has(name)) return cache.get(name);
    const exports = name === '@capacitor/core' ? { Capacitor: { isNativePlatform: () => native } }
      : name === '@capacitor-community/admob' ? { AdMob: sdk, RewardAdPluginEvents: rewardEvents,
          BannerAdPluginEvents: { SizeChanged: 'bannerSize' }, BannerAdPosition: { BOTTOM_CENTER: 'bottom' }, BannerAdSize: { ADAPTIVE_BANNER: 'adaptive' },
          InterstitialAdPluginEvents: rewardEvents, AdmobConsentStatus: { REQUIRED: 'REQUIRED' } }
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
    muted: () => muted, initialized: () => initialized,
    nativeReward: (fn) => { rewardBehavior = fn; },
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
console.log('PASS banner space: measured height plus gap, resize, one listener, hide and late-event guard');
