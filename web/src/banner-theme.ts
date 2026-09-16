import { I18nManager, type LanguageCode } from "./i18n";

export type BannerTheme = "classic" | "slate" | "forest";

export const BANNER_THEMES: readonly BannerTheme[] = ["classic", "slate", "forest"] as const;

const STORAGE_KEY = "chessAlkkagi.bannerTheme";

const listeners = new Set<() => void>();

let currentTheme: BannerTheme = loadThemeFromStorage();

export function isValidTheme(value: unknown): value is BannerTheme {
  return value === "classic" || value === "slate" || value === "forest";
}

function loadThemeFromStorage(): BannerTheme {
  try {
    if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (isValidTheme(stored)) {
        return stored;
      }
    }
  } catch (err) {
    console.warn("Failed to load banner theme from storage:", err);
  }
  return "classic";
}

export function getBannerTheme(): BannerTheme {
  return currentTheme;
}

export function setBannerTheme(theme: BannerTheme): void {
  if (!isValidTheme(theme)) {
    return;
  }
  const changed = currentTheme !== theme;
  currentTheme = theme;
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, theme);
    }
  } catch (err) {
    console.warn("Failed to save banner theme to storage:", err);
  }
  if (changed) {
    listeners.forEach((listener) => {
      try {
        listener();
      } catch (err) {
        console.error("Error in banner theme listener:", err);
      }
    });
  }
}

export function subscribeBannerTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const THEME_LABELS: Record<LanguageCode, Record<BannerTheme, string>> = {
  "ko": { classic: "클래식", slate: "슬레이트", forest: "포레스트" },
  "en": { classic: "Classic", slate: "Slate", forest: "Forest" },
  "ja": { classic: "クラシック", slate: "スレート", forest: "フォレスト" },
  "zh-CN": { classic: "经典", slate: "板岩", forest: "森林" },
  "de": { classic: "Klassisch", slate: "Schiefer", forest: "Wald" },
  "fr": { classic: "Classique", slate: "Ardoise", forest: "Forêt" },
  "es": { classic: "Clásico", slate: "Pizarra", forest: "Bosque" },
  "ru": { classic: "Классический", slate: "Сланец", forest: "Лес" },
  "pt-BR": { classic: "Clássico", slate: "Ardósia", forest: "Floresta" },
};

const SETTINGS_TEXT: Record<LanguageCode, { tab: string; hint: string }> = {
  "ko": {
    tab: "배너",
    hint: "배너 설정은 이 기기에만 저장됩니다.",
  },
  "en": {
    tab: "Banner",
    hint: "Banner preferences are saved on this device.",
  },
  "ja": {
    tab: "バナー",
    hint: "バナー設定はこの端末にのみ保存されます。",
  },
  "zh-CN": {
    tab: "横幅",
    hint: "横幅设置仅保存在此设备上。",
  },
  "de": {
    tab: "Banner",
    hint: "Banner-Einstellungen werden auf diesem Gerät gespeichert.",
  },
  "fr": {
    tab: "Bannière",
    hint: "Les préférences de bannière sont enregistrées sur cet appareil.",
  },
  "es": {
    tab: "Estandarte",
    hint: "Las preferencias de estandarte se guardan en este dispositivo.",
  },
  "ru": {
    tab: "Баннер",
    hint: "Настройки баннера сохраняются на этом устройстве.",
  },
  "pt-BR": {
    tab: "Banner",
    hint: "As preferências de banner são salvas neste dispositivo.",
  },
};

export function bannerThemeLabel(theme: BannerTheme): string {
  const lang = I18nManager.getLanguage?.() || "en";
  const dict = THEME_LABELS[lang] || THEME_LABELS["en"];
  return dict[theme] || theme;
}

export function bannerSettingsText(key: "tab" | "hint"): string {
  const lang = I18nManager.getLanguage?.() || "en";
  const dict = SETTINGS_TEXT[lang] || SETTINGS_TEXT["en"];
  return dict[key] || "";
}
