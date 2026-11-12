import { installPortalBrowserGuards } from "./portal-browser-guards";

installPortalBrowserGuards();
const { I18nManager } = await import("./i18n");
I18nManager.init("en");
await import("./main");
