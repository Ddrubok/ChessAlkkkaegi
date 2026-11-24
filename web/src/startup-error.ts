import { getRuntimeText } from "./runtime-text";
import { normalizeLanguage } from "./i18n";
import { startupFailureKind } from "./startup-failure";

export function showStartupError(error: unknown): void {
  console.error("Game startup failed", error);
  const app = document.querySelector<HTMLElement>("#app");
  if (!app) return;
  const kind = startupFailureKind(error);
  const lang = normalizeLanguage(document.documentElement?.lang) ?? undefined;
  const panel = document.createElement("section");
  panel.id = "boot-loading";
  panel.className = "error-panel";
  panel.setAttribute("role", "alert");
  const card = document.createElement("div");
  card.className = "boot-loading-card";
  const heading = document.createElement("h1");
  heading.textContent = getRuntimeText(`startup.${kind}_failed`, undefined, lang);
  const help = document.createElement("p");
  help.textContent = getRuntimeText(`startup.${kind}_help`, undefined, lang);
  const retry = document.createElement("button");
  retry.type = "button";
  retry.textContent = getRuntimeText("startup.retry", undefined, lang);
  retry.addEventListener("click", () => window.location.reload());
  card.append(heading, help, retry);
  panel.append(card);
  app.replaceChildren(panel);
  retry.focus();
}
