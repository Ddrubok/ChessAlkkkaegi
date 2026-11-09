import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getOrCreateUserProfile, type UserProfile } from "./supabase-auth";
import { getCachedUser, getIdentityVersion, getSdk, getUser, init, onIdentityChanged } from "./crazygames-sdk";

let activeClient: SupabaseClient | null = null;
let pending: Promise<UserProfile | null> | null = null;
let cleanup: Promise<unknown> = Promise.resolve();
let authenticationStarted = false;
let authenticated = false;
let lastFailure = 0;
let verifiedProfile: UserProfile | null = null;
let verifiedVersion = -1;

function bounded<T>(operation: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("CrazyGames token timed out")), ms);
    operation.then(value => { clearTimeout(timeout); resolve(value); }, error => { clearTimeout(timeout); reject(error); });
  });
}

function boundToCrazyGames(user: User | undefined, sdkUserId: string): boolean {
  const binding = user?.app_metadata?.crazygames;
  return !!user && user.is_anonymous !== true
    && !!binding && typeof binding === "object" && !Array.isArray(binding)
    && binding.user_id === sdkUserId
    && typeof binding.game_id === "string" && binding.game_id.length > 0;
}

function identityChanged(): void {
  const needsCleanup = authenticationStarted || authenticated;
  verifiedProfile = null;
  verifiedVersion = -1;
  if (!activeClient || !needsCleanup) return;
  const client = activeClient;
  authenticated = false;
  // Wait only for an exchange already in progress. Waiting for a cache check
  // would deadlock when that check discovers the identity change itself.
  cleanup = (authenticationStarted ? pending ?? Promise.resolve() : Promise.resolve())
    .then(() => client.auth.signOut()).catch(() => undefined);
}

async function exchange(client: SupabaseClient, interactive: boolean): Promise<UserProfile | null> {
  await cleanup;
  authenticated = false;
  verifiedProfile = null;
  let installedSession = false;
  try {
    authenticationStarted = true;
    const sdk = getSdk();
    if (!sdk?.user.isUserAccountAvailable) return null;
    let portalUser = await getUser();
    if (!portalUser && interactive) {
      await sdk.user.showAuthPrompt();
      portalUser = await getUser();
    }
    if (!portalUser?.__dangerousUserId) return null;
    const version = getIdentityVersion();
    const token = await bounded(sdk.user.getUserToken({ signingKeyType: "IN_GAME_AUTH" }), 5000);
    if (!token || getIdentityVersion() !== version) return null;
    const { data, error } = await client.functions.invoke("crazygames-auth", { body: { token }, timeout: 10000 });
    if (error || getIdentityVersion() !== version) return null;
    const session = data?.session;
    if (typeof session?.access_token !== "string" || !session.access_token
      || typeof session?.refresh_token !== "string" || !session.refresh_token) return null;
    const installed = await client.auth.setSession(session);
    installedSession = true;
    if (installed.error || getIdentityVersion() !== version
      || !boundToCrazyGames(installed.data.user ?? installed.data.session?.user, portalUser.__dangerousUserId)) return null;
    const profile = await getOrCreateUserProfile(client);
    const current = await client.auth.getSession();
    if (getIdentityVersion() !== version || current.data.session?.user.id !== profile.id
      || !current.data.session.expires_at || current.data.session.expires_at * 1000 <= Date.now() + 30000
      || !boundToCrazyGames(current.data.session?.user, portalUser.__dangerousUserId)
      || getCachedUser()?.__dangerousUserId !== portalUser.__dangerousUserId) return null;
    authenticated = true;
    verifiedVersion = version;
    verifiedProfile = { ...profile, nickname: portalUser.username };
    return verifiedProfile;
  } catch {
    return null;
  } finally {
    authenticationStarted = false;
    if (!authenticated || !installedSession) {
      authenticated = false;
      verifiedProfile = null;
      verifiedVersion = -1;
      await client.auth.signOut().catch(() => undefined);
    }
  }
}

/** Returns null for guests or any unverified exchange; ranked callers must require a profile. */
export function signInCrazyGames(client: SupabaseClient, interactive = false): Promise<UserProfile | null> {
  if (!activeClient) {
    activeClient = client;
    onIdentityChanged(identityChanged);
  }
  if (activeClient !== client) return Promise.resolve(null);
  if (pending) return pending;
  pending = (async () => {
    if (interactive) await init(true);
    const sdkUser = await getUser();
    const version = getIdentityVersion();
    if (authenticated && verifiedProfile && verifiedVersion === version && sdkUser?.__dangerousUserId) {
      try {
        const { data, error } = await client.auth.getSession();
        const session = data.session;
        if (!error && getIdentityVersion() === version && session?.user.id === verifiedProfile.id
          && session.expires_at && session.expires_at * 1000 > Date.now() + 30000
          && boundToCrazyGames(session.user, sdkUser.__dangerousUserId)) {
          // Reuse authentication, but refresh server ranks after a completed match.
          const profile = await getOrCreateUserProfile(client);
          if (getIdentityVersion() !== version || profile.id !== session.user.id) return null;
          verifiedProfile = { ...profile, nickname: sdkUser.username };
          return verifiedProfile;
        }
      } catch { /* Re-exchange below. */ }
    }
    if (!interactive && Date.now() - lastFailure < 1500) return null;
    return exchange(client, interactive);
  })().then((profile) => {
    lastFailure = profile ? 0 : Date.now();
    return profile;
  }).finally(() => { pending = null; });
  return pending;
}
