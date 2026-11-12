import { getSdk, init as initSdk, isSdkAvailable } from "../crazygames-sdk";
import { clearRoom } from "../crazygames-multiplayer";

export { isSdkAvailable };
export const setAdControls = (_pause: () => void, _resume: () => void): void => {};
export const setBeforeAd = (_prepare: () => void): void => {};
export const isAdActive = (): boolean => false;

let loading = false;
let finished = false;
let started = false;
let playing = false;
let boundaryVersion = 0;

export async function init(): Promise<void> {
  await initSdk();
  const game = getSdk()?.game;
  if (!game || started) return;
  started = true;
  game.loadingStart();
  loading = true;
  if (finished) loadingFinished();
}

export function loadingFinished(): void {
  finished = true;
  if (!loading) return;
  loading = false;
  getSdk()?.game.loadingStop();
}

export const gameplay = {
  enter(_reason: string, resumeVersion?: number): void {
    const game = getSdk()?.game;
    if (!game || playing || (resumeVersion !== undefined && resumeVersion !== boundaryVersion)) return;
    playing = true;
    game.gameplayStart();
  },
  leave(reason: string): number | null {
    if (reason === "return-to-menu") clearRoom();
    const game = getSdk()?.game;
    if (!game) return null;
    const version = ++boundaryVersion;
    if (!playing) return null;
    playing = false;
    game.gameplayStop();
    return version;
  },
  beforeNewMatch: async (): Promise<void> => {},
};
