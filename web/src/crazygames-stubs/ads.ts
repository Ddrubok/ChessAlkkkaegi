const noop = async (): Promise<void> => {};

export const AdManager = {
  isNative: () => false,
  hasPrivacyOptions: () => false,
  isRewardAvailable: () => false,
  init: noop,
  showBanner: noop,
  hideBanner: noop,
  showPrivacyOptions: noop,
  preloadInterstitial: noop,
  showInterstitial: async () => false,
  showRewardVideo: async () => false,
};
