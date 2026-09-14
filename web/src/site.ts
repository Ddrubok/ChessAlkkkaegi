import { showContentAd } from "./web-ads";

const placement = document.querySelector<HTMLElement>("[data-display-ad]");
if (placement) void showContentAd(placement).catch(() => { placement.hidden = true; });
