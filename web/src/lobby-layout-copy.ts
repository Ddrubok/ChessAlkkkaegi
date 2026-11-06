import { I18nManager, type LanguageCode } from "./i18n";

const copy: Record<LanguageCode, { account: string; quests: string; more: string }> = {
  ko: { account: "내 정보", quests: "퀘스트", more: "더보기" },
  en: { account: "My Info", quests: "Quests", more: "More" },
  ja: { account: "マイ情報", quests: "クエスト", more: "もっと見る" },
  "zh-CN": { account: "我的资料", quests: "任务", more: "更多" },
  de: { account: "Mein Profil", quests: "Quests", more: "Mehr" },
  fr: { account: "Mon profil", quests: "Quêtes", more: "Plus" },
  es: { account: "Mi perfil", quests: "Misiones", more: "Más" },
  ru: { account: "Мой профиль", quests: "Задания", more: "Ещё" },
  "pt-BR": { account: "Meu perfil", quests: "Missões", more: "Mais" },
};

export function lobbyLayoutCopy(): { account: string; quests: string; more: string } {
  return copy[I18nManager.getLanguage()];
}
