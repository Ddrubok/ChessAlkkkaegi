import { init } from "./poki-sdk";
import { installPortalBrowserGuards } from "./portal-browser-guards";

installPortalBrowserGuards();

await init();
await import("./main");
