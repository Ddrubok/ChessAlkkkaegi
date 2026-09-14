import { Capacitor } from "@capacitor/core";

const env = import.meta.env;
export const webAdsMode = env.VITE_WEB_ADS_MODE || "off";
export const adTestMode = Boolean(env.DEV) || env.VITE_AD_TEST_MODE === "true";
const client = env.VITE_ADSENSE_CLIENT_ID || "ca-pub-1173757866262139";
export const displaySlot = env.VITE_ADSENSE_SLOT_ID || "";

export interface AdBreakOptions {
  type: "reward" | "next";
  name: string;
  beforeAd: () => void;
  afterAd: () => void;
  beforeReward?: (showAd: () => void) => void;
  adViewed?: () => void;
  adDismissed?: () => void;
  adBreakDone: () => void;
}

declare global {
  interface Window {
    adsbygoogle?: unknown[];
    adBreak?: (options: AdBreakOptions) => void;
    adConfig?: (options: Record<string, unknown>) => void;
  }
}

let loading: Promise<boolean> | undefined;
export let h5Ready = false;

/** No web advertising is loaded in the native app or before explicit activation. */
export function loadWebAds(game: boolean): Promise<boolean> {
  if (Capacitor.isNativePlatform() || !/^ca-pub-\d{16}$/.test(client) ||
      !["display", "h5"].includes(webAdsMode) || (game && webAdsMode !== "h5")) {
    return Promise.resolve(false);
  }
  if (loading) return loading;
  loading = new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      h5Ready = ready && game;
      resolve(ready);
    };
    const timeout = window.setTimeout(() => finish(false), 8000);
    window.adsbygoogle = window.adsbygoogle || [];
    if (game) {
      window.adBreak = (options) => { window.adsbygoogle!.push(options); };
      window.adConfig = (options) => { window.adsbygoogle!.push(options); };
      window.adConfig({ preloadAdBreaks: "on", sound: "off", onReady: () => finish(true) });
    }
    const script = document.createElement("script");
    script.async = true;
    script.crossOrigin = "anonymous";
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}`;
    if (adTestMode && game) script.dataset.adbreakTest = "on";
    script.onerror = () => finish(false);
    script.onload = () => { if (!game) finish(true); };
    document.head.append(script);
  });
  return loading;
}

/** Display inventory is restricted to the public information pages. */
export async function showContentAd(container: HTMLElement): Promise<void> {
  if (!/^\d+$/.test(displaySlot) || !(await loadWebAds(false))) return;
  const ad = document.createElement("ins");
  ad.className = "adsbygoogle";
  ad.style.cssText = "display:block;min-height:100px";
  ad.dataset.adClient = client;
  ad.dataset.adSlot = displaySlot;
  ad.dataset.adFormat = "auto";
  ad.dataset.fullWidthResponsive = "true";
  if (adTestMode) ad.dataset.adtest = "on";
  container.replaceChildren(ad);
  container.hidden = false;
  window.adsbygoogle!.push({});
}
