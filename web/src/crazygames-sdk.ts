import { setPlatformSoundMuted } from "./sound";

export interface CrazyGamesUser {
  username: string;
  profilePictureUrl: string;
  /** Display comparison only. Authentication must use getUserToken. */
  __dangerousUserId: string;
}

export interface CrazyGamesSdk {
  init(): Promise<void>;
  user: {
    systemInfo?: { locale?: string | null };
    isUserAccountAvailable: boolean;
    getUser(): Promise<CrazyGamesUser | null>;
    getUserToken(options: { signingKeyType: "IN_GAME_AUTH" }): Promise<string>;
    showAuthPrompt(): Promise<CrazyGamesUser | null>;
    addAuthListener(listener: (user: CrazyGamesUser | null) => void): void;
    removeAuthListener(listener: (user: CrazyGamesUser | null) => void): void;
  };
  game: {
    settings?: { muteAudio?: boolean };
    addSettingsChangeListener?(listener: (settings: { muteAudio?: boolean }) => void): void;
    removeSettingsChangeListener?(listener: (settings: { muteAudio?: boolean }) => void): void;
    loadingStart(): void;
    loadingStop(): void;
    gameplayStart(): void;
    gameplayStop(): void;
    isInstantMultiplayer?: boolean;
    getInviteParam?(name: string): string | null;
    inviteLink?(params: Record<string, string>): string;
    updateRoom?(room: { roomId?: string; isJoinable?: boolean; inviteParams?: Record<string, string> }): void;
    leftRoom?(): void;
  };
}

declare global {
  interface Window { CrazyGames?: { SDK?: CrazyGamesSdk } }
}

let sdk: CrazyGamesSdk | null = null;
let initialization: Promise<void> | null = null;
let initializationFailed = false;
let cachedUser: CrazyGamesUser | null = null;
let identityVersion = 0;
let lastUserCheck = 0;
let userRequest: Promise<CrazyGamesUser | null> | null = null;
const listeners = new Set<() => void>();
const USER_CACHE_MS = 2000;

function userId(user: CrazyGamesUser | null): string | null {
  return typeof user?.__dangerousUserId === "string" && user.__dangerousUserId.trim()
    ? user.__dangerousUserId : null;
}

function bounded<T>(operation: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("CrazyGames SDK timed out")), ms);
    operation.then(value => { clearTimeout(timeout); resolve(value); }, error => { clearTimeout(timeout); reject(error); });
  });
}

export const isSdkAvailable = (): boolean => sdk !== null;
export const getSdk = (): CrazyGamesSdk | null => sdk;
export const getCachedUser = (): CrazyGamesUser | null => cachedUser;
export const getIdentityVersion = (): number => identityVersion;
export function onIdentityChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function updateUser(user: CrazyGamesUser | null): void {
  const next = userId(user) ? user : null;
  const changed = userId(cachedUser) !== userId(next);
  cachedUser = next;
  lastUserCheck = Date.now();
  if (!changed) return;
  identityVersion++;
  for (const listener of listeners) listener();
}

export async function getUser(): Promise<CrazyGamesUser | null> {
  await init();
  if (!sdk?.user.isUserAccountAvailable) {
    updateUser(null);
    return null;
  }
  if (Date.now() - lastUserCheck < USER_CACHE_MS) return cachedUser;
  if (userRequest) return userRequest;
  const version = identityVersion;
  userRequest = (async () => {
    try {
      const user = await bounded(sdk!.user.getUser(), 5000);
      // An auth event during the request takes precedence over its old response.
      if (identityVersion === version) updateUser(user);
    } catch {
      if (identityVersion === version) updateUser(null);
    }
    return cachedUser;
  })().finally(() => { userRequest = null; });
  return userRequest;
}

/** A failed attempt is retried only by an explicit login action. */
export function init(retry = false): Promise<void> {
  if (initialization && (!retry || !initializationFailed)) return initialization;
  if (typeof window === "undefined" || typeof document === "undefined") return Promise.resolve();
  initializationFailed = false;
  initialization = new Promise<void>((resolve) => {
    const script = document.createElement("script");
    let finished = false;
    const finish = (candidate: CrazyGamesSdk | null): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      script.onload = script.onerror = null;
      if (!candidate) script.remove();
      sdk = candidate;
      if (sdk) {
        try { sdk.user.addAuthListener(updateUser); }
        catch { sdk = null; }
      }
      initializationFailed = sdk === null;
      if (sdk) {
        setPlatformSoundMuted(sdk.game.settings?.muteAudio === true);
        sdk.game.addSettingsChangeListener?.(settings => setPlatformSoundMuted(settings.muteAudio === true));
      }
      if (!sdk?.user.isUserAccountAvailable) { resolve(); return; }
      const version = identityVersion;
      void bounded(sdk.user.getUser(), 5000).then(user => {
        // Boot primes silently; a recovered account must notify main so it
        // cannot keep using the guest progress namespace.
        if (identityVersion === version) {
          if (retry) updateUser(user);
          else {
            cachedUser = userId(user) ? user : null;
            lastUserCheck = Date.now();
          }
        }
      }, () => undefined).finally(resolve);
    };
    const timeout = window.setTimeout(() => finish(null), 5000);
    script.src = "https://sdk.crazygames.com/crazygames-sdk-v3.js";
    script.async = true;
    script.onerror = () => finish(null);
    script.onload = () => {
      const candidate = window.CrazyGames?.SDK;
      if (!candidate) return finish(null);
      void Promise.resolve().then(() => candidate.init()).then(() => finish(candidate), () => finish(null));
    };
    document.head.append(script);
  });
  return initialization;
}
