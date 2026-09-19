import { I18nManager } from './i18n';
import { escapeHtml } from './html';
import { createPeerLink } from './net';
import { getSupabaseClient } from './supabase-client';
import { connectFriendlyCode, formatFriendlyRoomCode, isValidFriendlyRoomCode, type FriendlyCodeSession } from './friendly-code';
import { getFriendlyCopy as copy } from './friendly-copy';
import type { OnlinePeerSession } from './online';
import { getUnifiedIceServers } from './metered-turn';

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
      ${onFriends ? `<button type="button" data-friendly-friends>${escapeHtml(copy('friend_challenge_title'))} · ${escapeHtml(I18nManager.t('friends.title'))}</button>` : ''}
      <h3>${escapeHtml(copy('guest_code_title'))}</h3>
      <button type="button" data-friendly-host>${escapeHtml(copy('create_room_btn'))}</button>
      <label>${escapeHtml(copy('room_code_label'))}<input data-friendly-code autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="32" placeholder="XXXX-XXXX-XXXX" style="box-sizing:border-box;width:100%;min-height:44px;font:inherit"></label>
      <button type="button" data-friendly-join>${escapeHtml(copy('join_room_btn'))}</button>
      <section data-friendly-output hidden><label>${escapeHtml(copy('room_code_label'))}<input data-friendly-room readonly style="box-sizing:border-box;width:100%;min-height:44px;font:inherit"></label><button type="button" data-friendly-copy>${escapeHtml(copy('copy_code'))}</button></section>
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
      host.disabled = join.disabled = input.disabled = true;
      status.textContent = copy('guest_connecting');
      const iceServers = await getUnifiedIceServers();
      if (closed) return;
      const link = createPeerLink({ iceServers });
      session = connectFriendlyCode(client, link, code, {
        onRoomCreated: room => {
          q('[data-friendly-output]').hidden = false;
          q<HTMLInputElement>('[data-friendly-room]').value = formatFriendlyRoomCode(room);
        },
        onStatusChange: message => { status.textContent = message; },
        onError: error => {
          if (closed) return;
          status.textContent = error.message;
          q('[data-friendly-output]').hidden = true;
          host.disabled = join.disabled = input.disabled = false;
        },
        onReady: (readyLink, role, roomCode) => {
          if (closed) { readyLink.close(); return; }
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
    panel.querySelector<HTMLElement>('[data-friendly-friends]')?.addEventListener('click', () => { cancel(); setTimeout(() => onFriends?.(), 0); });
    if (!client) { status.textContent = copy('peer_error'); host.disabled = join.disabled = true; }
    document.addEventListener('keydown', keydown, true);
    (panel.querySelector<HTMLElement>('[data-friendly-friends]') ?? host).focus();
  });
}
