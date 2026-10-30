import { installPortalBrowserGuards } from "./portal-browser-guards";

installPortalBrowserGuards();
// Basic has no SDK locale. Use English without saving an inferred preference.
const { I18nManager } = await import("./i18n");
I18nManager.init("en");
await import("./main");
