import { Capacitor } from "@capacitor/core";
import type { PluginListenerHandle } from "@capacitor/core";
import { adTestMode, h5Ready, loadWebAds } from "./web-ads";
import { setAdSoundMuted } from "./sound";

const env = import.meta.env;
const testIds = {
  banner: "ca-app-pub-3940256099942544/6300978111",
  rewarded: "ca-app-pub-3940256099942544/5224354917",
  interstitial: "ca-app-pub-3940256099942544/1033173712",
};
function nativeId(kind: keyof typeof testIds): string {
  if (adTestMode) return testIds[kind];
  const id = env[`VITE_ADMOB_${kind.toUpperCase()}_ID`] || "";
  return /^ca-app-pub-\d{16}\/\d{10}$/.test(id) && !id.includes("3940256099942544") ? id : "";
}

let nativeReady = false;
let privacyOptionsRequired = false;
let initializing: Promise<void> | undefined;
let busy = false;
let gameplayActive = false;
let bannerSizeListener: PluginListenerHandle | undefined;
function reserveBannerSpace(height: number): void {
  const inset = Number.isFinite(height) && height > 0 ? height + 24 : 0;
  document.documentElement.style.setProperty("--menu-ad-inset", `${inset}px`);
}
let restoreInput: (() => void) | undefined;

function pauseForAd(): void {
  if (restoreInput) return;
  const app = document.getElementById("app");
  const wasInert = app?.inert ?? false;
  if (app) app.inert = true;
  restoreInput = () => { if (app) app.inert = wasInert; };
  setAdSoundMuted(true);
}
function resumeAfterAd(): void {
  restoreInput?.();
  restoreInput = undefined;
  setAdSoundMuted(false);
}

/** Ads are only requested while gameplay is stopped in a menu. */
async function webFullscreen(onRewarded?: (amount: number) => void): Promise<boolean> {
  if (!h5Ready || !window.adBreak) return false;
  return new Promise<boolean>((resolve) => {
    let earned = false;
    let shown = false;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resumeAfterAd();
      resolve(onRewarded ? earned : shown);
    };
    const timer = window.setTimeout(finish, 10000);
    try {
      window.adBreak!({
        type: onRewarded ? "reward" : "next",
        name: onRewarded ? "optional_reward" : "return_to_menu",
        beforeAd: () => {
          if (finished) return;
          clearTimeout(timer);
          shown = true;
          pauseForAd();
        },
        afterAd: resumeAfterAd,
        ...(onRewarded ? {
          beforeReward: (showAd: () => void) => {
            // Reward presentation is only allowed after an explicit player request.
            if (!finished) showAd();
          },
          adViewed: () => {
            if (!finished && !earned) { earned = true; onRewarded(2); }
          },
          adDismissed: finish,
        } : {}),
        adBreakDone: finish,
      });
    } catch { finish(); }
  });
}

const INTERSTITIAL_COOLDOWN_MS = 3 * 60 * 1000;
const INTERSTITIAL_EXPIRY_MS = 55 * 60 * 1000;

let interstitialReady = false;
let interstitialLoadedAt = 0;
let preloadPromise: Promise<void> | undefined;
let lastInterstitialShowTime = 0;

function isInterstitialExpired(): boolean {
  return interstitialReady && (Date.now() - interstitialLoadedAt > INTERSTITIAL_EXPIRY_MS);
}

function isInterstitialReady(): boolean {
  if (isInterstitialExpired()) {
    interstitialReady = false;
  }
  return interstitialReady;
}

async function preloadInterstitial(): Promise<void> {
  if (!Capacitor.isNativePlatform() || !nativeReady) return;
  const id = nativeId("interstitial");
  if (!id) return;
  if (isInterstitialReady()) return;
  if (preloadPromise) return preloadPromise;

  preloadPromise = (async () => {
    try {
      const { AdMob } = await import("@capacitor-community/admob");
      await AdMob.prepareInterstitial({ adId: id, isTesting: adTestMode });
      interstitialReady = true;
      interstitialLoadedAt = Date.now();
    } catch (error) {
      interstitialReady = false;
      console.warn("전면 광고를 준비하지 못했습니다.", error);
    } finally {
      preloadPromise = undefined;
    }
  })();
  return preloadPromise;
}

async function showNativeInterstitial(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  if (busy || gameplayActive || !nativeReady) return false;

  if (Date.now() - lastInterstitialShowTime < INTERSTITIAL_COOLDOWN_MS) {
    if (!isInterstitialReady()) {
      void preloadInterstitial();
    }
    return false;
  }

  if (!isInterstitialReady()) {
    void preloadInterstitial();
    return false;
  }

  const id = nativeId("interstitial");
  if (!id) return false;

  interstitialReady = false;
  busy = true;
  pauseForAd();

  const listeners: PluginListenerHandle[] = [];
  let shown = false;
  let finished = false;
  let complete!: (value: boolean) => void;
  const done = new Promise<boolean>((resolve) => { complete = resolve; });

  const finish = (result?: boolean) => {
    if (finished) return;
    finished = true;
    complete(result ?? shown);
  };

  const showed = () => {
    if (finished) return;
    shown = true;
    lastInterstitialShowTime = Date.now();
    pauseForAd();
  };

  try {
    const { AdMob, InterstitialAdPluginEvents } = await import("@capacitor-community/admob");
    listeners.push(await AdMob.addListener(InterstitialAdPluginEvents.Dismissed, () => finish(shown)));
    listeners.push(await AdMob.addListener(InterstitialAdPluginEvents.FailedToShow, () => finish(false)));
    listeners.push(await AdMob.addListener(InterstitialAdPluginEvents.Showed, showed));

    if (gameplayActive) {
      finish(false);
      return false;
    }

    void AdMob.showInterstitial().catch(() => finish(false));
    return await done;
  } catch (error) {
    console.warn("전면 광고를 표시하지 못했습니다.", error);
    finish(false);
    return false;
  } finally {
    finished = true;
    await Promise.allSettled(listeners.map((listener) => listener.remove()));
    resumeAfterAd();
    busy = false;
    void preloadInterstitial();
  }
}

async function nativeFullscreen(onRewarded?: (amount: number) => void): Promise<boolean> {
  if (!onRewarded) return false;
  const id = nativeId("rewarded");
  if (!nativeReady || !id) return false;
  const { AdMob, RewardAdPluginEvents } = await import("@capacitor-community/admob");
  const listeners: PluginListenerHandle[] = [];
  let earned = false;
  let finished = false;
  let complete!: () => void;
  const done = new Promise<void>((resolve) => { complete = resolve; });
  const finish = () => { finished = true; complete(); };
  const showed = () => { pauseForAd(); };
  try {
    listeners.push(await AdMob.addListener(RewardAdPluginEvents.Dismissed, finish));
    listeners.push(await AdMob.addListener(RewardAdPluginEvents.FailedToShow, finish));
    listeners.push(await AdMob.addListener(RewardAdPluginEvents.Showed, showed));
    listeners.push(await AdMob.addListener(RewardAdPluginEvents.Rewarded, () => {
      if (!finished && !earned) { earned = true; onRewarded(2); }
    }));
    await AdMob.prepareRewardVideoAd({ adId: id, isTesting: adTestMode });
    void AdMob.showRewardVideoAd().catch(finish);
    await done;
    return earned;
  } catch {
    return earned;
  } finally {
    finished = true;
    await Promise.allSettled(listeners.map((listener) => listener.remove()));
    resumeAfterAd();
  }
}

async function fullscreen(onRewarded?: (amount: number) => void): Promise<boolean> {
  if (busy || gameplayActive) return false;
  busy = true;
  pauseForAd();
  try {
    return Capacitor.isNativePlatform() ? await nativeFullscreen(onRewarded) : await webFullscreen(onRewarded);
  } finally { resumeAfterAd(); busy = false; }
}

export const AdManager = {
  isNative: () => Capacitor.isNativePlatform(),
  hasPrivacyOptions: () => Capacitor.isNativePlatform() && privacyOptionsRequired,
  isRewardAvailable: () => !busy && !gameplayActive && (Capacitor.isNativePlatform()
    ? nativeReady && Boolean(nativeId("rewarded")) : h5Ready),
  init: (): Promise<void> => {
    if (initializing) return initializing;
    initializing = (async () => {
      try {
        if (!Capacitor.isNativePlatform()) { await loadWebAds(true); return; }
        if (!nativeId("banner") && !nativeId("rewarded") && !nativeId("interstitial")) return;
        const { AdMob, AdmobConsentStatus } = await import("@capacitor-community/admob");
        let consent = await AdMob.requestConsentInfo();
        if (consent.status === AdmobConsentStatus.REQUIRED && consent.isConsentFormAvailable) {
          consent = await AdMob.showConsentForm();
        }
        privacyOptionsRequired = consent.privacyOptionsRequirementStatus === "REQUIRED";
        if (!consent.canRequestAds) return;
        await AdMob.initialize({ initializeForTesting: adTestMode });
        nativeReady = true;
        void preloadInterstitial();
      } catch (error) { console.warn("광고를 준비하지 못했습니다.", error); }
    })();
    return initializing;
  },
  showBanner: async (): Promise<void> => {
    gameplayActive = false;
    if (!Capacitor.isNativePlatform() || !nativeReady || !nativeId("banner")) return;
    try {
      const { AdMob, BannerAdPosition, BannerAdSize, BannerAdPluginEvents } = await import("@capacitor-community/admob");
      if (!bannerSizeListener) {
        bannerSizeListener = await AdMob.addListener(BannerAdPluginEvents.SizeChanged, size => {
          reserveBannerSpace(gameplayActive ? 0 : size.height);
        });
      }
      if (gameplayActive) return;
      await AdMob.showBanner({ adId: nativeId("banner"), position: BannerAdPosition.BOTTOM_CENTER,
        adSize: BannerAdSize.ADAPTIVE_BANNER, isTesting: adTestMode });
      // Existing Android banners remain GONE after showBanner reloads them.
      if (gameplayActive) await AdMob.hideBanner();
      else await AdMob.resumeBanner();
    } catch (error) { console.warn("배너를 표시하지 못했습니다.", error); }
  },
  hideBanner: async (): Promise<void> => {
    gameplayActive = true;
    reserveBannerSpace(0);
    if (!Capacitor.isNativePlatform() || !nativeReady) return;
    try { const { AdMob } = await import("@capacitor-community/admob"); await AdMob.hideBanner(); }
    catch (error) { console.warn("배너를 닫지 못했습니다.", error); }
  },
  showPrivacyOptions: async (): Promise<void> => {
    if (!Capacitor.isNativePlatform()) return;
    try {
      const { AdMob } = await import("@capacitor-community/admob");
      await AdMob.hideBanner();
      await AdMob.showPrivacyOptionsForm();
      nativeReady = false;
      interstitialReady = false;
      preloadPromise = undefined;
      initializing = undefined;
      await AdManager.init();
    } catch (error) { console.warn("광고 개인정보 설정을 열지 못했습니다.", error); }
  },
  preloadInterstitial: () => preloadInterstitial(),
  showInterstitial: () => showNativeInterstitial(),
  showRewardVideo: (onRewarded: (amount: number) => void) => fullscreen(onRewarded),
};
