import type { SupabaseClient } from '@supabase/supabase-js';
import type { UserProfile } from './supabase-auth';
import { I18nManager, type LanguageCode } from './i18n';
import { escapeHtml } from './html';
import { progressStorage } from './progress-storage';

// Keep inventory and free-use state on the server, outside editable account-progress JSON.
export interface NicknameState { nickname: string; free_available: boolean; tickets: number }
const labels: Record<LanguageCode, string[]> = {
  ko: ['닉네임 변경', '중복 확인', '사용할 수 있는 닉네임입니다.', 'Google 회원은 계정당 1회 무료로 변경할 수 있습니다.', '무료로 변경', '변경권 1장 사용', '보유 변경권', '닉네임 변경권이 필요합니다.', '닉네임 변경 기능을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.', '확인 중…'],
  en: ['Change nickname', 'Check availability', 'This nickname is available.', 'Google members get one free change per account.', 'Change for free', 'Use 1 change ticket', 'Change tickets', 'A nickname change ticket is required.', 'Nickname changes are unavailable. Please try again later.', 'Checking…'],
  ja: ['ニックネーム変更', '重複を確認', 'このニックネームは使用できます。', 'Google会員はアカウントごとに1回無料で変更できます。', '無料で変更', '変更券を1枚使用', '所持変更券', 'ニックネーム変更券が必要です。', 'ニックネームを変更できません。後でもう一度お試しください。', '確認中…'],
  'zh-CN': ['修改昵称', '检查是否可用', '此昵称可用。', 'Google 会员每个账号可免费修改一次。', '免费修改', '使用1张改名卡', '持有改名卡', '需要一张改名卡。', '暂时无法修改昵称，请稍后重试。', '正在检查…'],
  de: ['Spitznamen ändern', 'Verfügbarkeit prüfen', 'Dieser Name ist verfügbar.', 'Google-Mitglieder können den Namen einmal pro Konto kostenlos ändern.', 'Kostenlos ändern', '1 Änderungsticket nutzen', 'Änderungstickets', 'Ein Namensticket ist erforderlich.', 'Namensänderungen sind derzeit nicht verfügbar. Bitte später erneut versuchen.', 'Prüfung…'],
  fr: ['Changer de pseudo', 'Vérifier la disponibilité', 'Ce pseudo est disponible.', 'Les membres Google ont droit à un changement gratuit par compte.', 'Changer gratuitement', 'Utiliser 1 ticket', 'Tickets de changement', 'Un ticket de changement de pseudo est nécessaire.', 'Changement indisponible. Réessayez plus tard.', 'Vérification…'],
  es: ['Cambiar apodo', 'Comprobar disponibilidad', 'Este apodo está disponible.', 'Las cuentas de Google tienen un cambio gratuito por cuenta.', 'Cambiar gratis', 'Usar 1 vale de cambio', 'Vales de cambio', 'Necesitas un vale para cambiar el apodo.', 'No se puede cambiar el apodo ahora. Inténtalo más tarde.', 'Comprobando…'],
  ru: ['Изменить никнейм', 'Проверить доступность', 'Этот никнейм доступен.', 'Для аккаунта Google доступна одна бесплатная смена.', 'Изменить бесплатно', 'Использовать 1 билет', 'Билеты смены имени', 'Нужен билет смены никнейма.', 'Смена никнейма недоступна. Попробуйте позже.', 'Проверка…'],
  'pt-BR': ['Alterar apelido', 'Verificar disponibilidade', 'Este apelido está disponível.', 'Contas Google têm uma alteração gratuita por conta.', 'Alterar grátis', 'Usar 1 vale de alteração', 'Vales de alteração', 'É necessário um vale para alterar o apelido.', 'Não é possível alterar o apelido agora. Tente mais tarde.', 'Verificando…'],
};
export const nicknameCopy = () => labels[I18nManager.getLanguage()];
export const normalizeNickname = (name: string) => name.normalize('NFKC').trim();
export function nicknameError(code?: string): string {
  if (code === 'taken' || code === '23505') return I18nManager.t('auth.nickname_already_used');
  if (code === 'invalid') return I18nManager.t('auth.nickname_length');
  if (code === 'ticket_required') return nicknameCopy()[7];
  return nicknameCopy()[8];
}
function readState(data: unknown): NicknameState {
  const s = data as NicknameState;
  if (!s || typeof s.nickname !== 'string' || typeof s.free_available !== 'boolean' || !Number.isSafeInteger(s.tickets) || s.tickets < 0) throw new Error(nicknameCopy()[8]);
  return s;
}
export async function getNicknameState(client: SupabaseClient): Promise<NicknameState> {
  const { data, error } = await client.rpc('get_nickname_state_v1');
  if (error) throw new Error(nicknameCopy()[8]);
  return readState(data);
}
export async function changeNickname(client: SupabaseClient, userId: string, name: string, requestId: string): Promise<NicknameState> {
  const { data, error } = await client.rpc('change_nickname_v1', {
    p_nickname: normalizeNickname(name), p_request_id: requestId, p_expected_user_id: userId,
  });
  if (error || data?.ok !== true) throw new Error(nicknameError(error?.code ?? data?.code));
  const state = readState(data);
  const { data: session, error: sessionError } = await client.auth.getSession();
  if (sessionError || session.session?.user.id !== userId) throw new Error(nicknameCopy()[8]);
  localStorage.setItem('ca_local_nickname', state.nickname);
  return state;
}

export function openNicknameDialog(client: SupabaseClient, profile: UserProfile, onChanged: (name: string) => void): void {
  if (!progressStorage.ready || progressStorage.owner !== profile.id) return;
  document.querySelector<HTMLDialogElement>('.nickname-dialog')?.close();
  const c = nicknameCopy();
  const dialog = document.createElement('dialog');
  dialog.className = 'nickname-dialog';
  dialog.setAttribute('aria-labelledby', 'nickname-title');
  dialog.style.cssText = 'width:min(400px,calc(100vw - 32px));max-height:calc(100dvh - 32px);box-sizing:border-box;overflow:auto;padding:20px;border:1px solid #64748b;border-radius:12px;background:#0f172a;color:#f8fafc;';
  dialog.innerHTML = `<form method="dialog" style="display:grid;gap:12px;min-width:0">
    <h2 id="nickname-title" style="font-size:18px;margin:0">${escapeHtml(c[0])}</h2>
    <p data-nickname-info style="margin:0;line-height:1.5">${escapeHtml(c[9])}</p>
    <label style="display:grid;gap:6px">${escapeHtml(I18nManager.t('lobby.nickname_label'))}<input data-nickname-input autocomplete="off" spellcheck="false" style="min-width:0;box-sizing:border-box;width:100%;padding:10px;font:inherit" /></label>
    <button type="button" data-nickname-check disabled>${escapeHtml(c[1])}</button>
    <p data-nickname-status role="status" style="margin:0;line-height:1.5;overflow-wrap:anywhere"></p>
    <button type="button" data-nickname-save disabled>${escapeHtml(c[0])}</button>
    <button value="cancel" data-nickname-cancel>${escapeHtml(I18nManager.t('common.cancel'))}</button>
  </form>`;
  dialog.querySelectorAll('button').forEach(b => { b.style.cssText = 'min-height:44px;padding:10px;font:inherit;white-space:normal;'; });
  const input = dialog.querySelector<HTMLInputElement>('[data-nickname-input]')!;
  const check = dialog.querySelector<HTMLButtonElement>('[data-nickname-check]')!;
  const save = dialog.querySelector<HTMLButtonElement>('[data-nickname-save]')!;
  const info = dialog.querySelector<HTMLElement>('[data-nickname-info]')!;
  const status = dialog.querySelector<HTMLElement>('[data-nickname-status]')!;
  let state: NicknameState | null = null, checked = '', busy = false, saving = false, closed = false, requestId = crypto.randomUUID();
  let requestName = '';
  input.value = profile.nickname;
  const refresh = () => {
    check.disabled = busy || !state;
    save.disabled = busy || !state || checked !== normalizeNickname(input.value) || (!state.free_available && state.tickets < 1);
    input.disabled = busy;
    dialog.querySelector<HTMLButtonElement>('[data-nickname-cancel]')!.disabled = saving;
    if (state) {
      info.textContent = `${state.free_available ? c[3] + ' ' : ''}${c[6]}: ${state.tickets}${!state.free_available && !state.tickets ? ' · ' + c[7] : ''}`;
      save.textContent = state.free_available ? c[4] : c[5];
    }
  };
  const unsubscribe = progressStorage.subscribe(() => { if (!progressStorage.ready || progressStorage.owner !== profile.id) dialog.close(); });
  dialog.addEventListener('close', () => { closed = true; unsubscribe(); dialog.remove(); }, { once: true });
  dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
  dialog.querySelector('form')!.addEventListener('submit', event => { if (!(event as SubmitEvent).submitter) event.preventDefault(); });
  input.oninput = () => { checked = ''; status.textContent = ''; refresh(); };
  check.onclick = async () => {
    const name = normalizeNickname(input.value);
    busy = true; status.textContent = c[9]; refresh();
    try {
      const { data, error } = await client.rpc('check_nickname_v1', { p_nickname: name });
      if (closed) return;
      if (error || data?.ok !== true || typeof data.nickname !== 'string') throw new Error(nicknameError(error?.code ?? data?.code));
      input.value = checked = data.nickname; status.textContent = c[2];
    } catch (error) { if (!closed) status.textContent = error instanceof Error ? error.message : c[8]; }
    finally { busy = false; if (!closed) refresh(); }
  };
  save.onclick = async () => {
    if (save.disabled) return;
    const name = normalizeNickname(input.value);
    if (requestName !== name) { requestId = crypto.randomUUID(); requestName = name; }
    busy = saving = true; refresh();
    try {
      const next = await changeNickname(client, profile.id, name, requestId);
      if (closed) return;
      onChanged(next.nickname); dialog.close();
    } catch (error) { if (!closed) status.textContent = error instanceof Error ? error.message : c[8]; }
    finally { busy = saving = false; if (!closed) refresh(); }
  };
  document.body.append(dialog); dialog.showModal();
  void getNicknameState(client).then(next => { if (!closed) { state = next; input.value = next.nickname; refresh(); input.focus(); } })
    .catch(() => { if (!closed) { info.textContent = c[8]; input.disabled = true; } });
}
