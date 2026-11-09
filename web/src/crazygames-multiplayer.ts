import { getSdk, init } from './crazygames-sdk';
import { isValidFriendlyRoomCode, normalizeFriendlyRoomCode } from './friendly-code';

export type LaunchInvite = { room?: string; instant: boolean };
let launchInvite: LaunchInvite | null = null;
let prepared = false;
let activeRoom: string | null = null;

/** Read the SDK launch data once, after SDK initialization and before opening the menu. */
export async function prepareLaunchInvite(): Promise<void> {
  if (prepared) return;
  await init();
  if (prepared) return;
  prepared = true;
  const game = getSdk()?.game;
  if (!game) return;
  let room: string | null | undefined;
  try { room = game.getInviteParam?.('room'); } catch { /* SDK unavailable on this host. */ }
  const instant = game.isInstantMultiplayer === true;
  if (typeof room === 'string' && room.length) launchInvite = { room, instant };
  else if (instant) launchInvite = { instant };
}

export function hasLaunchInvite(): boolean { return launchInvite !== null; }

export function consumeLaunchInvite(): LaunchInvite | null {
  const invite = launchInvite;
  launchInvite = null;
  return invite;
}

/** Only the validated room code is sent to the SDK; no app URL or auth state is copied. */
export function inviteLink(room: string): string | null {
  if (!isValidFriendlyRoomCode(room)) return null;
  try {
    const link = getSdk()?.game.inviteLink?.({ room: normalizeFriendlyRoomCode(room) });
    if (typeof link !== 'string') return null;
    const url = new URL(link);
    return url.protocol === 'https:' && (url.hostname === 'crazygames.com' || url.hostname.endsWith('.crazygames.com'))
      ? link : null;
  } catch { return null; }
}

export function updateRoom(room: string, isJoinable: boolean): void {
  if (!isValidFriendlyRoomCode(room)) return;
  const code = normalizeFriendlyRoomCode(room);
  try {
    getSdk()?.game.updateRoom?.({ roomId: `friendly-${code}`, isJoinable, inviteParams: { room: code } });
    activeRoom = code;
  } catch { /* The match remains playable if portal status is unavailable. */ }
}

export function clearRoom(): void {
  if (!activeRoom) return;
  activeRoom = null;
  try { getSdk()?.game.leftRoom?.(); } catch { /* Portal status is best effort. */ }
}
