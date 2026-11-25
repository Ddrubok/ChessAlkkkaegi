import type { I18nManager as I18nManagerType, LanguageCode } from "./i18n";
import "./crazygames-privacy-notice.css";

const DISMISSED_KEY = "ca_crazygames_privacy_notice_dismissed_v1";

const copy: Record<LanguageCode, { title: string; body: string; policy: string; dismiss: string }> = {
  en: {
    title: "Game privacy",
    body: "This browser stores progress and settings locally. Signing in uses your CrazyGames player ID and session token to load saved account progress.",
    policy: "Privacy policy",
    dismiss: "Close",
  },
  ko: {
    title: "게임 개인정보 안내",
    body: "이 브라우저는 진행도와 설정을 기기에 저장합니다. 로그인 시 CrazyGames 플레이어 ID와 세션 토큰으로 저장된 계정 진행도를 불러옵니다.",
    policy: "개인정보 처리방침",
    dismiss: "닫기",
  },
  ja: { title: "ゲームのプライバシー", body: "このブラウザーには進行状況と設定が保存されます。ログイン時にはCrazyGamesのプレイヤーIDとセッショントークンを使い、保存済みのアカウント進行状況を読み込みます。", policy: "プライバシーポリシー", dismiss: "閉じる" },
  "zh-CN": { title: "游戏隐私", body: "此浏览器会在本地保存进度和设置。登录时会使用 CrazyGames 玩家 ID 和会话令牌加载已保存的账号进度。", policy: "隐私政策", dismiss: "关闭" },
  de: { title: "Datenschutz im Spiel", body: "Dieser Browser speichert Fortschritt und Einstellungen lokal. Beim Anmelden werden deine CrazyGames-Spieler-ID und ein Sitzungstoken verwendet, um den gespeicherten Kontofortschritt zu laden.", policy: "Datenschutzerklärung", dismiss: "Schließen" },
  fr: { title: "Confidentialité du jeu", body: "Ce navigateur conserve la progression et les paramètres localement. À la connexion, votre identifiant de joueur CrazyGames et un jeton de session servent à charger la progression du compte.", policy: "Politique de confidentialité", dismiss: "Fermer" },
  es: { title: "Privacidad del juego", body: "Este navegador guarda el progreso y los ajustes localmente. Al iniciar sesión, se usan tu ID de jugador de CrazyGames y un token de sesión para cargar el progreso guardado de la cuenta.", policy: "Política de privacidad", dismiss: "Cerrar" },
  ru: { title: "Конфиденциальность игры", body: "Браузер хранит прогресс и настройки локально. При входе ID игрока CrazyGames и токен сеанса используются для загрузки сохранённого прогресса учётной записи.", policy: "Политика конфиденциальности", dismiss: "Закрыть" },
  "pt-BR": { title: "Privacidade do jogo", body: "Este navegador salva o progresso e as configurações localmente. Ao entrar, seu ID de jogador CrazyGames e um token de sessão são usados para carregar o progresso salvo da conta.", policy: "Política de privacidade", dismiss: "Fechar" },
};

export function showFirstVisitPrivacyNotice(i18n: typeof I18nManagerType): void {
  if (document.querySelector(".cg-privacy-notice")) return;
  try {
    if (localStorage.getItem(DISMISSED_KEY) === "1") return;
  } catch { /* Private or blocked storage: show the notice for this visit. */ }

  const notice = document.createElement("aside");
  notice.className = "cg-privacy-notice";
  notice.setAttribute("role", "region");
  const title = document.createElement("strong");
  title.id = "cg-privacy-notice-title";
  notice.setAttribute("aria-labelledby", title.id);
  const body = document.createElement("p");
  const actions = document.createElement("div");
  actions.className = "cg-privacy-notice-actions";
  const policy = document.createElement("a");
  policy.href = "./privacy.html";
  policy.target = "_blank";
  policy.rel = "noopener noreferrer";
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  const close = (): void => {
    notice.remove();
    unsubscribe();
    document.removeEventListener("pointerup", onCanvasRelease, true);
    document.removeEventListener("click", onGameAction, true);
    try { localStorage.setItem(DISMISSED_KEY, "1"); } catch { /* Dismiss for this visit. */ }
  };
  // Removing the notice resizes the board. Finish the shot against the same canvas that received the press.
  const onCanvasRelease = (event: PointerEvent): void => {
    if (event.target instanceof Element && event.target.closest("#app canvas")) requestAnimationFrame(close);
  };
  const onGameAction = (event: MouseEvent): void => {
    if (event.target instanceof Element && event.target.closest("#app button")) requestAnimationFrame(close);
  };
  dismiss.addEventListener("click", close);
  actions.append(policy, dismiss);
  notice.append(title, body, actions);

  const render = (): void => {
    const language = i18n.getLanguage();
    const strings = copy[language];
    notice.lang = language;
    title.textContent = strings.title;
    body.textContent = strings.body;
    policy.textContent = strings.policy;
    dismiss.textContent = strings.dismiss;
  };
  render();
  const unsubscribe = i18n.subscribe(render);

  document.body.append(notice);
  document.addEventListener("pointerup", onCanvasRelease, true);
  document.addEventListener("click", onGameAction, true);
}
