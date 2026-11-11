import { I18nManager } from './i18n';
import { escapeHtml } from './html';
import { createPeerLink } from './net';
import { getSupabaseClient } from './supabase-client';
import { connectFriendlyCode, formatFriendlyRoomCode, isValidFriendlyRoomCode, type FriendlyCodeSession } from './friendly-code';
import { getFriendlyCopy as copy } from './friendly-copy';
import type { OnlinePeerSession } from './online';
import { getUnifiedIceServers } from './metered-turn';
import { marketingRuntime } from './marketing-runtime';
import { clearRoom, consumeLaunchInvite, inviteLink, updateRoom } from './crazygames-multiplayer';
import { PLATFORM } from './platform';
import { feedbackCopy } from './feedback-copy';
import { progressStorage } from './progress-storage';

/** A single shared code; SDP answers are exchanged through Realtime, not the clipboard. */
export function openFriendlyLobby(parent: HTMLElement, onFriends?: () => void): Promise<OnlinePeerSession> {
  return new Promise((resolve, reject) => {
    const client = getSupabaseClient();
    const opener = document.activeElement as HTMLElement | null;
    const panel = document.createElement('section');
    panel.className = 'online-lobby-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'friendly-title');
    panel.innerHTML = `<div class="online-lobby-card">
      <h2 id="friendly-title">${escapeHtml(copy('title'))}</h2>
      <p class="feedback-online-guide">${escapeHtml(feedbackCopy().friendGuide)}${PLATFORM.id === 'itch' && progressStorage.owner === null ? `<br>${escapeHtml(feedbackCopy().onlineGuest)} ${escapeHtml(feedbackCopy().onlineSiteLogin)}` : ''}</p>
      ${onFriends ? `<button type="button" data-friendly-friends>${escapeHtml(copy('friend_challenge_title'))} · ${escapeHtml(I18nManager.t('friends.title'))}</button>` : ''}
      <h3>${escapeHtml(copy('guest_code_title'))}</h3>
      <button type="button" data-friendly-host>${escapeHtml(copy('create_room_btn'))}</button>
      <label>${escapeHtml(copy('room_code_label'))}<input data-friendly-code autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="32" placeholder="XXXX-XXXX-XXXX" style="box-sizing:border-box;width:100%;min-height:44px;font:inherit"></label>
      <button type="button" data-friendly-join>${escapeHtml(copy('join_room_btn'))}</button>
      <section data-friendly-output hidden><label>${escapeHtml(copy('room_code_label'))}<input data-friendly-room readonly style="box-sizing:border-box;width:100%;min-height:44px;font:inherit"></label><button type="button" data-friendly-copy>${escapeHtml(copy('copy_code'))}</button></section>
      <section data-friendly-link-output hidden><label data-friendly-link-label for="friendly-invite-link"></label><input id="friendly-invite-link" data-friendly-link readonly style="box-sizing:border-box;width:100%;min-height:44px;font:inherit"><button type="button" data-friendly-link-copy></button></section>
      <p data-friendly-status role="status" aria-live="polite"></p>
      <button type="button" data-friendly-close>${escapeHtml(I18nManager.t('common.cancel'))}</button>
    </div>`;
    const background = [...parent.children].filter((e): e is HTMLElement => e instanceof HTMLElement).map(e => ({ e, inert: e.inert }));
    background.forEach(({ e }) => { e.inert = true; });
    parent.append(panel);
    const q = <T extends HTMLElement>(selector: string) => panel.querySelector<T>(selector)!;
    const status = q('[data-friendly-status]');
    const input = q<HTMLInputElement>('[data-friendly-code]');
    const host = q<HTMLButtonElement>('[data-friendly-host]');
    const join = q<HTMLButtonElement>('[data-friendly-join]');
    const portalCopy = I18nManager.getLanguage() === 'ko'
      ? { link: 'CrazyGames 초대 링크', copy: '링크 복사', copied: '복사됨' }
      : { link: 'CrazyGames invite link', copy: 'Copy link', copied: 'Copied!' };
    if (PLATFORM.id === 'itch') portalCopy.link = I18nManager.getLanguage() === 'ko'
      ? 'itch.io 게임 페이지 (방 코드도 공유하세요)' : 'itch.io game page (share the room code too)';
    q<HTMLElement>('[data-friendly-link-label]').textContent = portalCopy.link;
    q<HTMLButtonElement>('[data-friendly-link-copy]').textContent = portalCopy.copy;
    let session: FriendlyCodeSession | null = null;
    let connected = false, closed = false;
    const dispose = () => {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', keydown, true);
      background.forEach(({ e, inert }) => { e.inert = inert; });
      panel.remove();
      if (opener?.isConnected) opener.focus();
    };
    const cancel = () => {
      if (connected || closed) return;
      session?.cancel();
      clearRoom();
      dispose();
      reject(new DOMException('Friendly lobby closed', 'AbortError'));
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); cancel(); }
      if (event.key !== 'Tab') return;
      const items = [...panel.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)')].filter(e => e.getClientRects().length);
      const index = items.indexOf(document.activeElement as HTMLElement);
      if (index < 0 || (!event.shiftKey && index === items.length - 1) || (event.shiftKey && index === 0)) {
        event.preventDefault(); (event.shiftKey ? items.at(-1) : items[0])?.focus();
      }
    };
    const start = async (code?: string) => {
      if (!client || connected || closed) return;
      if (code !== undefined && !isValidFriendlyRoomCode(code)) { status.textContent = copy('invalid_code'); input.focus(); return; }
      session?.cancel();
      clearRoom();
      host.disabled = join.disabled = input.disabled = true;
      status.textContent = copy('guest_connecting');
      const iceServers = await getUnifiedIceServers();
      if (closed) return;
      const link = createPeerLink({ iceServers });
      session = connectFriendlyCode(client, link, code, {
        onRoomCreated: room => {
          marketingRuntime.inviteCreated(`friendly-${room}`);
          updateRoom(room, true);
          q('[data-friendly-output]').hidden = false;
          q<HTMLInputElement>('[data-friendly-room]').value = formatFriendlyRoomCode(room);
          const link = inviteLink(room);
          q<HTMLElement>('[data-friendly-link-output]').hidden = !link;
          q<HTMLInputElement>('[data-friendly-link]').value = link ?? '';
        },
        onStatusChange: message => { status.textContent = message; },
        onError: error => {
          if (closed) return;
          status.textContent = error.message;
          clearRoom();
          q('[data-friendly-output]').hidden = true;
          q('[data-friendly-link-output]').hidden = true;
          host.disabled = join.disabled = input.disabled = false;
        },
        onReady: (readyLink, role, roomCode) => {
          if (closed) { readyLink.close(); return; }
          if (role === 'guest') marketingRuntime.inviteJoined(`friendly-${roomCode}`);
          updateRoom(roomCode, false);
          connected = true;
          q<HTMLButtonElement>('[data-friendly-close]').disabled = true;
          resolve({ link: readyLink, mySide: role === 'host' ? 'white' : 'black', matchId: `friendly-${roomCode}`, rejoining: false, finishLobby: dispose });
        },
      }, { timeoutMs: code === undefined ? 180_000 : 45_000 });
    };
    host.onclick = () => { void start(); };
    join.onclick = () => { void start(input.value); };
    input.onkeydown = event => { if (event.key === 'Enter' && !join.disabled) start(input.value); };
    q('[data-friendly-close]').onclick = cancel;
    q<HTMLButtonElement>('[data-friendly-copy]').onclick = async event => {
      const button = event.currentTarget as HTMLElement;
      const field = q<HTMLInputElement>('[data-friendly-room]');
      try { await navigator.clipboard.writeText(field.value); button.textContent = copy('copied'); }
      catch { field.focus(); field.select(); }
    };
    q<HTMLButtonElement>('[data-friendly-link-copy]').onclick = async event => {
      const button = event.currentTarget as HTMLElement;
      const field = q<HTMLInputElement>('[data-friendly-link]');
      try { await navigator.clipboard.writeText(field.value); button.textContent = portalCopy.copied; }
      catch { field.focus(); field.select(); }
    };
    panel.querySelector<HTMLElement>('[data-friendly-friends]')?.addEventListener('click', () => { cancel(); setTimeout(() => onFriends?.(), 0); });
    if (!client) { status.textContent = copy('peer_error'); host.disabled = join.disabled = true; }
    document.addEventListener('keydown', keydown, true);
    (panel.querySelector<HTMLElement>('[data-friendly-friends]') ?? host).focus();
    const launch = consumeLaunchInvite();
    if (launch?.room !== undefined) {
      if (isValidFriendlyRoomCode(launch.room)) {
        input.value = formatFriendlyRoomCode(launch.room);
        void start(launch.room);
      } else {
        status.textContent = copy('invalid_code');
        input.focus();
      }
    } else if (launch?.instant) void start();
  });
}
