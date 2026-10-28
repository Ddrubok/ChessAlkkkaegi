const noop = (): void => {};
export const setAdControls = noop;
export const setBeforeAd = noop;
export const isAdActive = () => false;
export const loadingFinished = noop;
export const isSdkAvailable = () => false;
export const init = async (): Promise<void> => {};
export const gameplay = {
  enter: noop,
  leave: (): null => null,
  beforeNewMatch: async (): Promise<void> => {},
};
