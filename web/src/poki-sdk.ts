import { PLATFORM } from "./platform";

interface PokiSdk {
  init(): Promise<void>;
  gameLoadingFinished(): void;
  gameplayStart(): void;
  gameplayStop(): void;
  commercialBreak(onStart: () => void): Promise<void>;
}

let sdk: PokiSdk | null = null;
let initialization: Promise<void> | null = null;
let loadingReported = false;
let playing = false;
let boundaryVersion = 0;
let breakDue = false;
let adPending = false;
let adPromise: Promise<void> | null = null;
let prepareAd = (): void => {};
let pauseAd = (): void => {};
let resumeAd = (): void => {};

// poki-entry imports this before its storage guard, so sound must be configured later.
export function setAdControls(pause: () => void, resume: () => void): void {
  pauseAd = pause;
  resumeAd = resume;
}

export function setBeforeAd(prepare: () => void): void {
  prepareAd = prepare;
}

export function isAdActive(): boolean {
  return adPending;
}

export function loadingFinished(): void {
  if (sdk === null || loadingReported) return;
  loadingReported = true;
  sdk.gameLoadingFinished();
}

export const gameplay = {
  enter(_reason: string, resumeVersion?: number): void {
    if (sdk === null || adPending || playing) return;
    if (resumeVersion !== undefined && resumeVersion !== boundaryVersion) return;
    playing = true;
    breakDue = false;
    sdk.gameplayStart();
  },
  leave(_reason: string): number | null {
    if (sdk === null || adPending) return null;
    const version = ++boundaryVersion;
    // A result opened while paused invalidates that pause's eventual resume.
    if (!playing) return null;
    playing = false;
    breakDue = true;
    sdk.gameplayStop();
    return version;
  },
  beforeNewMatch(): Promise<void> {
    if (adPromise !== null) return adPromise;
    if (sdk === null || playing || !breakDue) return Promise.resolve();
    const currentSdk = sdk;
    breakDue = false;
    prepareAd();
    adPending = true;
    // A late onStart must finish before the caller may create its next board. No timeout.
    adPromise = Promise.resolve().then(async () => {
      pauseAd();
      await currentSdk.commercialBreak(pauseAd);
    }).catch((error: unknown) => {
      console.warn("Poki commercial break failed; continuing without an ad.", error);
    }).finally(() => {
      try { resumeAd(); }
      finally { adPending = false; adPromise = null; }
    });
    return adPromise;
  },
};

export function isSdkAvailable(): boolean {
  return sdk !== null;
}

/** Download and initialization share one budget; a failed session never reactivates. */
export function init(): Promise<void> {
  if (initialization !== null) return initialization;
  if (PLATFORM.id !== "poki") return Promise.resolve();
  initialization = new Promise<void>((resolve) => {
    const script = document.createElement("script");
    let settled = false;
    const finish = (loaded: PokiSdk | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      script.onload = null;
      script.onerror = null;
      sdk = loaded;
      if (loaded === null) script.remove();
      resolve();
    };
    const timeout = window.setTimeout(() => finish(null), 5000);
    script.src = "https://game-cdn.poki.com/scripts/v2/poki-sdk.js";
    script.async = true;
    script.onerror = () => finish(null);
    script.onload = () => {
      const candidate = (window as Window & { PokiSDK?: PokiSdk }).PokiSDK;
      if (!candidate) { finish(null); return; }
      void Promise.resolve().then(() => {
        if (settled) return;
        return candidate.init();
      }).then(() => finish(candidate), () => finish(null));
    };
    document.head.append(script);
  });
  return initialization;
}
