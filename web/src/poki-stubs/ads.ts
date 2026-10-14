// Legacy web/native advertising is excluded from the Poki bundle.
import { setAdControls } from "../poki-sdk";
import { setAdSoundMuted } from "../sound";

let restoreInput: (() => void) | undefined;
function pause(): void {
  if (restoreInput) return;
  // These game dialogs are mounted outside #app; their buttons must also wait for the ad.
  const roots = [...document.querySelectorAll<HTMLElement>("#app, .tutorial-modal-overlay, .weekly-modal")];
  const previous = roots.map((root) => root.inert);
  roots.forEach((root) => { root.inert = true; });
  restoreInput = () => roots.forEach((root, index) => { root.inert = previous[index]; });
  window.dispatchEvent(new Event("blur"));
  setAdSoundMuted(true);
}
function resume(): void {
  restoreInput?.();
  restoreInput = undefined;
  setAdSoundMuted(false);
}
const noop = async (): Promise<void> => {};
export const AdManager = {
  isNative: () => false,
  hasPrivacyOptions: () => false,
  isRewardAvailable: () => false,
  init: async (): Promise<void> => { setAdControls(pause, resume); },
  showBanner: noop,
  hideBanner: noop,
  showPrivacyOptions: noop,
  preloadInterstitial: noop,
  showInterstitial: async () => false,
  showRewardVideo: async () => false,
};
