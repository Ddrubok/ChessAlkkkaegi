import {
  BANNER_IDS,
  BASIC_BANNER_IDS,
  ACHIEVEMENT_BANNER_IDS,
  ownsBanner,
  getEquippedBanner,
  equipBanner,
  getBannerProgress,
  type BannerId,
} from "./banner-progress";
import {
  bannerCopy,
  bannerThemeName,
  bannerThemeCondition,
  bannerThemeDescription,
  bannerThemeTip,
  bannerThemeMode,
} from "./banner-copy";

export type { BannerId };
export type BannerTheme = BannerId;
export type BannerAppearance = BannerTheme | "plain";

export {
  BANNER_IDS,
  BASIC_BANNER_IDS,
  ACHIEVEMENT_BANNER_IDS,
  ownsBanner,
  getEquippedBanner,
  equipBanner,
  getBannerProgress,
};

export const BANNER_THEMES: readonly BannerTheme[] = BANNER_IDS;
export const DEFAULT_BANNER_IDS = BASIC_BANNER_IDS;

export const BANNER_TARGETS: Record<BannerId, number> = {
  classic: 1,
  slate: 1,
  forest: 1,
  banner_cosmic_knight: 50,
  banner_crimson_sun: 3,
  banner_hidden_myeongnyang: 1,
};

export function isValidTheme(value: unknown): value is BannerTheme {
  return typeof value === "string" && (BANNER_IDS as readonly string[]).includes(value);
}

export function isValidBannerAppearance(value: unknown): value is BannerAppearance {
  return value === "plain" || isValidTheme(value);
}

export function isAchievementBanner(id: BannerId): boolean {
  return (ACHIEVEMENT_BANNER_IDS as readonly BannerId[]).includes(id);
}

/**
 * Returns the proper image URL for the banner theme.
 */
export function bannerImageUrl(theme: BannerTheme, baseUrl?: string): string {
  const rawBase = baseUrl ?? (typeof import.meta !== "undefined" && import.meta.env?.BASE_URL ? import.meta.env.BASE_URL : "/");
  const base = rawBase.endsWith("/") ? rawBase : `${rawBase}/`;
  if ((BASIC_BANNER_IDS as readonly BannerId[]).includes(theme)) {
    return `${base}assets/banners/${theme}.webp`;
  }
  return `${base}assets/banners/${theme}-v1.webp`;
}

/**
 * Preload only the currently equipped banner image for fast startup.
 */
export function preloadEquippedBanner(storage?: unknown, baseUrl?: string): void {
  try {
    if (typeof document === "undefined") return;
    const equipped = getEquippedBanner(storage as Parameters<typeof getEquippedBanner>[0]);
    const url = bannerImageUrl(equipped, baseUrl);
    const existing = document.querySelector(`link[rel="preload"][href="${url}"]`);
    if (existing) return;
    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "image";
    link.href = url;
    document.head?.appendChild(link);
  } catch {
    // ignore
  }
}

export {
  bannerCopy,
  bannerThemeName,
  bannerThemeCondition,
  bannerThemeDescription,
  bannerThemeTip,
  bannerThemeMode,
};
