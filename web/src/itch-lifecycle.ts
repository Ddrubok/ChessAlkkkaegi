// Standalone solo build: the shared gameplay has no portal lifecycle or ads.
export const isSdkAvailable = (): boolean => false;
export const setAdControls = (_pause: () => void, _resume: () => void): void => {};
export const setBeforeAd = (_prepare: () => void): void => {};
export const isAdActive = (): boolean => false;
export const loadingFinished = (): void => {};
export const gameplay = {
  enter(_reason: string, _resumeVersion?: number): void {},
  leave(_reason: string): null { return null; },
  beforeNewMatch: async (): Promise<void> => {},
};
