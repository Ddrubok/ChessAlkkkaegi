import { installPortalBrowserGuards } from "./portal-browser-guards";

installPortalBrowserGuards();
// Basic has no portal SDK locale; keep an explicit choice, otherwise start in English.
if (!localStorage.getItem("app_language")) localStorage.setItem("app_language", "en");
await import("./main");
