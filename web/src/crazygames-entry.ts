import { installPortalBrowserGuards } from "./portal-browser-guards";
import { showStartupError } from "./startup-error";

try {
  installPortalBrowserGuards();
  const { init } = await import("./crazygames-stubs/portal-lifecycle");
  await init();
  const { I18nManager, normalizeLanguage } = await import("./i18n");
  const { getSdk } = await import("./crazygames-sdk");
  let sdkLocale: unknown;
  try { sdkLocale = getSdk()?.user.systemInfo?.locale; } catch { /* SDK unavailable. */ }
  I18nManager.init(normalizeLanguage(sdkLocale) || "en");
  const { showFirstVisitPrivacyNotice } = await import("./crazygames-privacy-notice");
  showFirstVisitPrivacyNotice(I18nManager);
  await import("./main");
} catch (error) {
  showStartupError(error);
}
