import { installPortalBrowserGuards } from "./portal-browser-guards";

installPortalBrowserGuards();
const { init } = await import("./crazygames-stubs/portal-lifecycle");
await init();
const { I18nManager, normalizeLanguage } = await import("./i18n");
const { getSdk } = await import("./crazygames-sdk");
let sdkLocale: unknown;
try { sdkLocale = getSdk()?.user.systemInfo?.locale; } catch { /* SDK unavailable. */ }
I18nManager.init(normalizeLanguage(sdkLocale) || "en");
await import("./main");
