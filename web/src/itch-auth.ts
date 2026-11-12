import type { SupabaseClient } from '@supabase/supabase-js';

type Attempt = {
  client: SupabaseClient;
  state: string;
  verifier: string;
  popup: Window;
  linkAccount: boolean;
  linkedUserId: string | null;
  cancelled: boolean;
  started: boolean;
  committing: boolean;
  closedAt: number | null;
  deadline: number;
  timer: number | null;
  onStatus: (message: string, busy: boolean) => void;
};

let activeAttempt: Attempt | null = null;
const FUNCTION_NAME = 'itch-auth';
const POLL_MS = 2000;
const TIMEOUT_MS = 300_000;
const CLOSED_GRACE_MS = 6_000;

function randomBase64Url(bytes: number): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return btoa(String.fromCharCode(...value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function challengeFor(verifier: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return btoa(String.fromCharCode(...digest)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function isCurrent(attempt: Attempt): boolean {
  return activeAttempt === attempt && !attempt.cancelled;
}

function clearTimer(attempt: Attempt): void {
  if (attempt.timer !== null) window.clearTimeout(attempt.timer);
  attempt.timer = null;
}

async function bridge(client: SupabaseClient, body: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> {
  return client.functions.invoke(FUNCTION_NAME, { body });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(attempt: Attempt, message: string): void {
  if (!isCurrent(attempt)) return;
  attempt.onStatus(message, false);
  void cancelItchAuth();
}

function monitorPendingStart(attempt: Attempt): void {
  if (!isCurrent(attempt) || attempt.started) return;
  if (attempt.popup.closed) { fail(attempt, 'Itch.io sign-in was closed.'); return; }
  if (Date.now() >= attempt.deadline) { fail(attempt, 'Itch.io sign-in timed out. Please try again.'); return; }
  attempt.timer = window.setTimeout(() => monitorPendingStart(attempt), POLL_MS);
}

async function poll(client: SupabaseClient, attempt: Attempt): Promise<void> {
  if (!isCurrent(attempt)) return;
  if (Date.now() >= attempt.deadline) { fail(attempt, 'Itch.io sign-in timed out. Please try again.'); return; }
  try {
    const { data, error } = await bridge(client, { action: 'finish', state: attempt.state, codeVerifier: attempt.verifier });
    if (!isCurrent(attempt)) return;
    if (error || !isRecord(data)) { fail(attempt, 'Itch.io sign-in failed. Please try again.'); return; }
    if (data.pending === true) {
      if (attempt.popup.closed) {
        attempt.closedAt ??= Date.now();
        if (Date.now() - attempt.closedAt >= CLOSED_GRACE_MS) { fail(attempt, 'Itch.io sign-in was closed.'); return; }
      } else {
        attempt.closedAt = null;
      }
      attempt.timer = window.setTimeout(() => { void poll(client, attempt); }, POLL_MS);
      return;
    }
    const session = data.session;
    if (!isRecord(session) || typeof session.access_token !== 'string' || typeof session.refresh_token !== 'string' || !session.access_token || !session.refresh_token) {
      fail(attempt, 'Itch.io sign-in returned an invalid session.');
      return;
    }
    // A link must keep the same signed-in account for the entire attempt.
    if (attempt.linkAccount) {
      const { data: current, error: currentError } = await client.auth.getUser();
      if (!isCurrent(attempt)) return;
      if (currentError || !current.user || current.user.is_anonymous || current.user.id !== attempt.linkedUserId) { fail(attempt, 'Your account changed. Please try linking again.'); return; }
    }
    attempt.committing = true;
    const { error: sessionError } = await client.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
    attempt.committing = false;
    if (!isCurrent(attempt)) return;
    if (sessionError) { fail(attempt, 'Could not save the account session. Please try again.'); return; }
    clearTimer(attempt);
    activeAttempt = null;
    attempt.popup.close();
    attempt.onStatus('Signed in. Reloading your account progress...', false);
    window.location.reload();
  } catch {
    attempt.committing = false;
    fail(attempt, 'Itch.io sign-in failed. Please try again.');
  }
}

/** Call directly from a trusted button click so browsers permit the popup. */
export function startItchAuth(client: SupabaseClient, linkAccount: boolean, onStatus: (message: string, busy: boolean) => void): void {
  if (activeAttempt) { onStatus('An itch.io sign-in is already open.', true); return; }
  const popup = window.open('', '_blank', 'popup=yes,width=560,height=720');
  if (!popup) { onStatus('Please allow the sign-in popup and try again.', false); return; }
  popup.document.title = 'Connect to itch.io';
  popup.document.body.textContent = 'Opening itch.io sign-in...';
  const attempt: Attempt = {
    client, state: randomBase64Url(32), verifier: randomBase64Url(32), popup, linkAccount, linkedUserId: null,
    cancelled: false, started: false, committing: false, closedAt: null, deadline: Date.now() + TIMEOUT_MS, timer: null, onStatus,
  };
  activeAttempt = attempt;
  onStatus(linkAccount ? 'Connecting your itch.io identity to this account...' : 'Opening itch.io sign-in...', true);
  attempt.timer = window.setTimeout(() => monitorPendingStart(attempt), POLL_MS);
  void (async () => {
    try {
      if (linkAccount) {
        const { data, error } = await client.auth.getUser();
        if (!isCurrent(attempt)) return;
        if (error || !data.user || data.user.is_anonymous) { fail(attempt, 'Sign in to your account before linking itch.io.'); return; }
        attempt.linkedUserId = data.user.id;
      }
      const codeChallenge = await challengeFor(attempt.verifier);
      if (!isCurrent(attempt)) return;
      const { data, error } = await bridge(client, { action: 'start', state: attempt.state, codeChallenge, linkAccount });
      attempt.started = !error && isRecord(data) && typeof data.authorizeUrl === 'string';
      clearTimer(attempt);
      if (!isCurrent(attempt)) {
        if (attempt.started) void bridge(client, { action: 'cancel', state: attempt.state, codeVerifier: attempt.verifier }).catch(() => {});
        return;
      }
      if (!attempt.started || !isRecord(data) || typeof data.authorizeUrl !== 'string') { fail(attempt, 'Could not open itch.io sign-in. Please try again.'); return; }
      const target = new URL(data.authorizeUrl);
      if (target.origin !== 'https://itch.io' || target.protocol !== 'https:') { fail(attempt, 'Invalid itch.io sign-in destination.'); return; }
      if (popup.closed) { fail(attempt, 'Itch.io sign-in was closed.'); return; }
      popup.location.replace(target.href);
      onStatus('Complete sign-in in the popup, then return to the game.', true);
      attempt.timer = window.setTimeout(() => { void poll(client, attempt); }, POLL_MS);
    } catch {
      fail(attempt, 'Could not start itch.io sign-in. Please try again.');
    }
  })();
}

/** False means the final session commit is in progress and must finish before changing identity. */
export async function cancelItchAuth(): Promise<boolean> {
  const attempt = activeAttempt;
  if (!attempt) return true;
  if (attempt.committing) {
    attempt.onStatus('Finishing itch.io sign-in...', true);
    return false;
  }
  activeAttempt = null;
  attempt.cancelled = true;
  clearTimer(attempt);
  attempt.popup.close();
  if (attempt.started) {
    try {
      await bridge(attempt.client, { action: 'cancel', state: attempt.state, codeVerifier: attempt.verifier });
    } catch { /* The pending attempt expires server-side. */ }
  }
  return true;
}
