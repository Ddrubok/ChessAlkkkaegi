import { I18nManager } from './i18n';
import { formatTier } from './tier-view';
import { getRuntimeText } from './runtime-text';
import { getBannerTheme, subscribeBannerTheme, type BannerTheme } from './banner-theme';
import type { UserProfile } from './supabase-auth';
import type { PieceSide } from './layout';
import type { GameMode } from './game-mode';
import './player-banner.css';

export interface PlayerBannerState {
  visible: boolean;
  mode: GameMode;
  stage: number;
  currentSide: PieceSide;
  mySide: PieceSide | null;
  profile: UserProfile | null;
  opponent: { id: string; nickname: string; mmr: number } | null;
  rankedMode: 'classic' | 'strategy';
  loggedIn: boolean;
  opponentBannerTheme?: BannerTheme;
}

export function getPlayerBannerModels(state: PlayerBannerState) {
  const mine = state.mode === 'online' ? state.mySide ?? 'white' : 'white';
  const opposite = mine === 'white' ? 'black' : 'white';
  const profile = state.profile;
  const rating = state.rankedMode === 'strategy' && state.mode === 'online' ? profile?.strategyMmr : profile?.classicMmr;
  const self = {
    side: mine, name: profile?.nickname || I18nManager.t('online.guest_mode'),
    detail: state.loggedIn && rating !== undefined ? formatTier(rating) : I18nManager.t('online.guest_mode'),
    bot: false,
  };
  const opponent = state.mode === 'stage'
    ? { side: opposite, name: 'AI', detail: I18nManager.t('lobby.stage_label', { stage: state.stage }), bot: true }
    : state.mode === 'online'
      ? { side: opposite, name: state.opponent?.nickname || getRuntimeText('matchmaking.default_opponent_name'),
          detail: state.opponent ? formatTier(state.opponent.mmr) : I18nManager.t('p2p.subtitle'), bot: false }
      : { side: opposite, name: I18nManager.t('ingame.turn_black'), detail: I18nManager.t('lobby.mode_2p_short'), bot: false };
  return { self, opponent, canAddFriend: state.mode === 'online' && state.loggedIn && !!profile &&
    !!state.opponent && state.opponent.id !== profile.id };
}

export function createPlayerBanners(parent: HTMLElement, options: {
  getState: () => PlayerBannerState;
  requestFriend: (profileId: string, opponent: NonNullable<PlayerBannerState['opponent']>) => Promise<{ success: boolean; error?: string }>;
}) {
  const element = document.createElement('div');
  element.className = 'player-banners';
  element.hidden = true;
  const makeCard = (mine: boolean) => {
    const card = document.createElement('section');
    card.className = 'player-banner';
    card.dataset.owner = mine ? 'self' : 'opponent';
    const emblem = document.createElement('span'); emblem.className = 'player-banner-emblem'; emblem.setAttribute('aria-hidden', 'true');
    const text = document.createElement('div'); text.className = 'player-banner-text';
    const name = document.createElement('strong'); name.className = 'player-banner-name';
    const detail = document.createElement('span'); detail.className = 'player-banner-detail';
    text.append(name, detail); card.append(emblem, text); element.append(card);
    return { card, emblem, name, detail };
  };
  const self = makeCard(true), opponent = makeCard(false);
  const add = document.createElement('button'); add.type = 'button'; add.className = 'player-banner-add';
  const status = document.createElement('p'); status.className = 'player-banner-status'; status.setAttribute('role', 'status'); status.hidden = true;
  opponent.card.append(add, status); parent.append(element);
  const completed = new Set<string>(), pending = new Set<string>();
  const messages = new Map<string, { key: string; name: string }>();
  let last = '', destroyed = false;
  const update = () => {
    if (destroyed) return;
    const state = options.getState();
    element.hidden = !state.visible || !['stage', 'online', 'hotseat'].includes(state.mode);
    if (element.hidden) return;
    const key = `${state.profile?.id}:${state.opponent?.id}`;
    const signature = JSON.stringify([state, I18nManager.getLanguage(), getBannerTheme(), pending.has(key), completed.has(key), messages.get(key)]);
    if (signature === last) return;
    last = signature;
    const models = getPlayerBannerModels(state);
    for (const [view, model] of [[self, models.self], [opponent, models.opponent]] as const) {
      view.name.textContent = model.name; view.name.title = model.name;
      view.detail.textContent = model.detail;
      view.emblem.textContent = model.bot ? '♚' : model.side === 'white' ? '♙' : '♟';
      view.card.dataset.active = String(model.side === state.currentSide);
      view.card.dataset.theme = view === self ? getBannerTheme() : state.mode === 'online' ? state.opponentBannerTheme ?? 'classic' : 'classic';
      view.card.setAttribute('aria-label', `${model.name} · ${model.detail}`);
    }
    add.hidden = !models.canAddFriend;
    add.disabled = pending.has(key) || completed.has(key);
    add.textContent = completed.has(key) ? '✓' : pending.has(key) ? '…' : '+';
    add.title = I18nManager.t(completed.has(key) ? 'friends.request_already_sent' : 'friends.tab_add');
    add.setAttribute('aria-label', add.title);
    const message = messages.get(key);
    status.hidden = !models.canAddFriend || !message;
    status.textContent = message ? I18nManager.t(message.key, { name: message.name }) : '';
  };
  add.addEventListener('click', async () => {
    const state = options.getState(), target = state.opponent;
    if (!state.visible || !getPlayerBannerModels(state).canAddFriend || !state.profile || !target) return;
    const key = `${state.profile.id}:${target.id}`;
    if (pending.has(key) || completed.has(key)) return;
    pending.add(key); messages.delete(key); update();
    try {
      const result = await options.requestFriend(state.profile.id, target);
      if (result.success || result.error === 'request_already_sent') completed.add(key);
      const known = ['request_already_sent', 'user_not_found', 'cannot_add_self', 'login_required'];
      const message = result.success ? 'friends.request_sent_success' : known.includes(result.error ?? '') ? `friends.${result.error}` : 'online.server_error_fallback';
      messages.set(key, { key: message, name: target.nickname });
    } catch {
      messages.set(key, { key: 'online.server_error_fallback', name: target.nickname });
    } finally { pending.delete(key); update(); }
  });
  const unsubscribeTheme = subscribeBannerTheme(update), unsubscribeLanguage = I18nManager.subscribe(update);
  return { element, update, destroy() { destroyed = true; unsubscribeTheme(); unsubscribeLanguage(); element.remove(); } };
}
