import type { I18nManager as I18nManagerType } from "./i18n";
import "./crazygames-privacy-notice.css";

const DISMISSED_KEY = "ca_crazygames_privacy_notice_dismissed_v1";

const copy = {
  en: {
    title: "Game privacy",
    body: "When signed in, your CrazyGames ID links your progress and match results.",
    policy: "Privacy policy",
    dismiss: "Close",
  },
  ko: {
    title: "게임 개인정보 안내",
    body: "로그인하면 CrazyGames 계정 ID에 진행도와 대전 결과가 연결됩니다.",
    policy: "개인정보 처리방침",
    dismiss: "닫기",
  },
} as const;

export function showFirstVisitPrivacyNotice(i18n: typeof I18nManagerType): void {
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
    document.removeEventListener("click", onPlay, true);
    try { localStorage.setItem(DISMISSED_KEY, "1"); } catch { /* Dismiss for this visit. */ }
  };
  const onPlay = (event: Event): void => {
    if (event.target instanceof Element && event.target.closest("#app canvas, #app button")) close();
  };
  dismiss.addEventListener("click", close);
  actions.append(policy, dismiss);
  notice.append(title, body, actions);

  const render = (): void => {
    const strings = i18n.getLanguage() === "ko" ? copy.ko : copy.en;
    notice.lang = i18n.getLanguage() === "ko" ? "ko" : "en";
    title.textContent = strings.title;
    body.textContent = strings.body;
    policy.textContent = strings.policy;
    dismiss.textContent = strings.dismiss;
  };
  render();
  const unsubscribe = i18n.subscribe(render);

  document.body.append(notice);
  document.addEventListener("click", onPlay, true);
}
