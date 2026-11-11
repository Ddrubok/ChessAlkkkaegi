import { isValidFriendlyRoomCode, normalizeFriendlyRoomCode } from './friendly-code';

export type LaunchInvite = { room?: string; instant: boolean };
let launchInvite: LaunchInvite | null = null;

export async function prepareLaunchInvite(): Promise<void> {
  // itch.io does not reliably forward project-page query strings into its game iframe.
  // Accept a room only when it actually reaches this document (for example, a host
  // configured to forward query parameters). The room code remains the fallback.
  const room = new URL(location.href).searchParams.get('room');
  if (room && isValidFriendlyRoomCode(room)) launchInvite = { room: normalizeFriendlyRoomCode(room), instant: false };
}

export function hasLaunchInvite(): boolean { return launchInvite !== null; }
export function consumeLaunchInvite(): LaunchInvite | null {
  const invite = launchInvite;
  launchInvite = null;
  return invite;
}

export function inviteLink(room: string): string | null {
  if (!isValidFriendlyRoomCode(room)) return null;
  const url = new URL('https://ddurubok.itch.io/chess-alkkagi');
  url.searchParams.set('room', normalizeFriendlyRoomCode(room));
  return url.href;
}

export function updateRoom(_room: string, _isJoinable: boolean): void {}
export function clearRoom(): void {}
