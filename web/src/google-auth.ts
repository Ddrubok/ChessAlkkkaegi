import { Capacitor } from '@capacitor/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { I18nManager, type LanguageCode } from './i18n';
import { getSupabaseClient, getSavedSupabaseConfig } from './supabase-client';

export const GOOGLE_APP_CALLBACK = 'com.chessalkkagi.app://auth/callback';
const PENDING_KEY = 'ca_google_oauth_pending';
const ERROR_KEY = 'ca_google_oauth_error';
let starting = false;
let callbackFailed = false;
let availability: Promise<boolean> | null = null;

function googleAvailable(): Promise<boolean> {
  if (availability) return availability;
  const config = getSavedSupabaseConfig();
  if (!config) return Promise.resolve(false);
  availability = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(`${config.url.replace(/\/$/, '')}/auth/v1/settings`, {
        headers: { apikey: config.anonKey }, signal: controller.signal,
      });
      if (!response.ok) return false;
      const settings = await response.json();
      return settings?.external?.google === true;
    } catch { return false; }
    finally { clearTimeout(timer); }
  })();
  return availability;
}
const copy: Record<LanguageCode, [string, string, string]> = {
  ko: ['Google로 계속하기', 'Google 로그인으로 이동 중…', 'Google 로그인을 완료하지 못했습니다. 다시 시도하거나 이메일로 로그인해 주세요.'],
  en: ['Continue with Google', 'Opening Google sign-in…', 'Google sign-in was not completed. Try again or sign in with email.'],
  ja: ['Googleで続ける', 'Googleログインを開いています…', 'Googleログインを完了できませんでした。再試行するか、メールでログインしてください。'],
  'zh-CN': ['使用 Google 继续', '正在打开 Google 登录…', '未能完成 Google 登录。请重试或使用邮箱登录。'],
  de: ['Mit Google fortfahren', 'Google-Anmeldung wird geöffnet…', 'Google-Anmeldung nicht abgeschlossen. Erneut versuchen oder per E-Mail anmelden.'],
  fr: ['Continuer avec Google', 'Ouverture de la connexion Google…', 'Connexion Google non terminée. Réessayez ou connectez-vous par e-mail.'],
  es: ['Continuar con Google', 'Abriendo el acceso de Google…', 'No se completó el acceso con Google. Reintenta o accede con tu correo.'],
  ru: ['Продолжить с Google', 'Открывается вход через Google…', 'Вход через Google не завершён. Повторите попытку или войдите по почте.'],
  'pt-BR': ['Continuar com Google', 'Abrindo o login do Google…', 'O login do Google não foi concluído. Tente novamente ou entre por e-mail.'],
};

export function googleRedirectUrl(native: boolean, href: string): string {
  return native ? GOOGLE_APP_CALLBACK : new URL('./', href).href;
}

export function isGoogleAppCallback(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'com.chessalkkagi.app:' && url.hostname === 'auth' &&
      url.pathname === '/callback' && !url.username && !url.password && !url.port;
  } catch { return false; }
}

/** PKCE verifies that the returning code belongs to this device's sign-in attempt. */
export async function completeGoogleAppCallback(client: SupabaseClient, raw: string): Promise<boolean> {
  if (!isGoogleAppCallback(raw)) return false;
  const startedAt = Number(localStorage.getItem(PENDING_KEY));
  if (!startedAt || Date.now() - startedAt < 0 || Date.now() - startedAt > 600_000) return false;
  localStorage.removeItem(PENDING_KEY); // Ignore duplicate deep-link delivery.
  const url = new URL(raw);
  const code = url.searchParams.get('code');
  if (!code || url.searchParams.has('error') || new URLSearchParams(url.hash.slice(1)).has('error')) {
    throw new Error('OAuth callback did not include a code');
  }
  const { data, error } = await client.auth.exchangeCodeForSession(code);
  if (error || !data.session || data.session.user.is_anonymous) throw new Error('OAuth session exchange failed');
  return true;
}

export async function initializeGoogleAuth(client: SupabaseClient | null): Promise<void> {
  callbackFailed = sessionStorage.getItem(ERROR_KEY) === 'true';
  sessionStorage.removeItem(ERROR_KEY);
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.slice(1));
  if (url.searchParams.has('error') || hash.has('error')) {
    callbackFailed = true;
    for (const key of ['error', 'error_code', 'error_description']) { url.searchParams.delete(key); hash.delete(key); }
    url.hash = hash.toString();
    history.replaceState(null, '', url);
  }
  if (!client) return;
  if (!Capacitor.isNativePlatform()) {
    if (url.searchParams.has('code')) {
      // The SDK completes web PKCE during initialization. Show a retry on an expired/foreign code.
      const { data, error } = await client.auth.getSession();
      if (error || !data.session) callbackFailed = true;
      const clean = new URL(window.location.href);
      clean.searchParams.delete('code');
      history.replaceState(null, '', clean);
    }
    return;
  }
  const { App } = await import('@capacitor/app');
  await App.addListener('appUrlOpen', ({ url }) => {
    void completeGoogleAppCallback(client, url).then(completed => {
      if (completed) window.location.reload();
    }).catch(() => { sessionStorage.setItem(ERROR_KEY, 'true'); window.location.reload(); });
  });
  const launch = await App.getLaunchUrl();
  if (launch?.url) {
    try { await completeGoogleAppCallback(client, launch.url); }
    catch { callbackFailed = true; }
  }
}

export async function signInWithGoogle(client: SupabaseClient): Promise<void> {
  if (starting) return;
  starting = true;
  const native = Capacitor.isNativePlatform();
  try {
    if (native) localStorage.setItem(PENDING_KEY, String(Date.now()));
    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: googleRedirectUrl(native, window.location.href),
        skipBrowserRedirect: true,
        queryParams: { prompt: 'select_account' },
      },
    });
    if (error || !data.url) throw new Error('Google OAuth is unavailable');
    if (native) {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url: data.url });
    } else window.location.assign(data.url);
  } catch (error) {
    localStorage.removeItem(PENDING_KEY);
    throw error;
  } finally { starting = false; }
}

/** One shared, neutral sign-in button across guest, sign-in and sign-up screens. */
export function appendGoogleSignIn(container: HTMLElement): void {
  const [label, opening, failed] = copy[I18nManager.getLanguage()];
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.googleSignIn = '';
  button.hidden = true;
  button.textContent = label;
  button.style.cssText = 'width:100%;min-height:44px;margin-top:12px;padding:10px 16px;border:1px solid #64748b;border-radius:8px;background:#fff;color:#1f1f1f;font:inherit;font-weight:600;cursor:pointer;';
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  status.style.cssText = 'margin:6px 0 0;font-size:12px;line-height:1.5;color:#cbd5e1;overflow-wrap:anywhere;';
  if (callbackFailed) status.textContent = failed;
  button.onclick = async () => {
    if (starting) return;
    button.disabled = true;
    status.textContent = opening;
    try {
      const client = getSupabaseClient();
      if (!client) throw new Error('Auth unavailable');
      await signInWithGoogle(client);
      status.textContent = '';
    } catch { status.textContent = failed; }
    finally { button.disabled = false; }
  };
  container.append(button, status);
  void googleAvailable().then(available => { button.hidden = !available; });
}
