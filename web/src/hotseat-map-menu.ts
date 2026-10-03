import { I18nManager } from "./i18n";
import { escapeHtml } from "./html";
import { getHotseatMap, HOTSEAT_MAP_CATALOG } from "./maps/map-catalog";

export interface HotseatMapMenuOptions {
  selectedMapId: string;
  onSelect: (mapId: string) => void;
  onStart: (mapId: string) => Promise<void>;
  onClose: () => void;
}

// Captured offline by src/tools/capture-map-previews.mjs; the menu never creates a renderer.
const previewAssets = import.meta.glob<string>("/src/assets/map-previews/*.webp", {
  eager: true, query: "?url", import: "default",
});
const MAP_COLUMNS = 7;
const previewImage = (mapId: string, view: "perspective" | "plan" | "thumb", name: string) => {
  const url = previewAssets[`/src/assets/map-previews/${mapId}-${view}.webp`];
  if (!url) return "";
  const dimensions = view === "plan" ? [400, 400] : view === "thumb" ? [240, 150] : [960, 600];
  return `<img src="${escapeHtml(url)}" alt="${view === "thumb" ? "" : escapeHtml(name)}" width="${dimensions[0]}" height="${dimensions[1]}" decoding="async" ${view === "thumb" ? 'aria-hidden="true"' : ""}>`;
};

/** Keeps selection open on startup errors and consumes keys before the lobby. */
export function openHotseatMapMenu(container: HTMLElement, options: HotseatMapMenuOptions): () => void {
  const previousFocus = document.activeElement as HTMLElement | null;
  const lobbyPanel = container.querySelector<HTMLElement>(".main-menu-panel");
  const wasInert = lobbyPanel?.inert ?? false;
  if (lobbyPanel) lobbyPanel.inert = true;
  const modal = document.createElement("section");
  modal.className = "hotseat-map-overlay";
  modal.tabIndex = -1;
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "hotseat-map-title");
  modal.setAttribute("aria-describedby", "hotseat-map-description");
  let selectedMapId = options.selectedMapId;
  let starting = false;
  let closed = false;
  let errorKey = getHotseatMap(selectedMapId) ? "" : "hotseat_map.unavailable";
  let unsubscribe = () => {};

  const close = () => {
    if (closed) return;
    closed = true;
    unsubscribe();
    window.removeEventListener("resize", scrollSelectedMap);
    modal.remove();
    if (lobbyPanel) lobbyPanel.inert = wasInert;
    options.onClose();
    if (previousFocus?.isConnected) previousFocus.focus();
    else container.querySelector<HTMLButtonElement>('[data-game-mode="hotseat"]')?.focus();
  };
  const cancel = () => { if (!starting) close(); };
  const scrollSelectedMap = () => {
    modal.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };
  const focusMap = (mapId: string) => {
    const button = [...modal.querySelectorAll<HTMLButtonElement>("[data-map-id]")].find(card => card.dataset.mapId === mapId);
    button?.focus({ preventScroll: true });
    button?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };
  const render = () => {
    const previousList = modal.querySelector<HTMLElement>(".hotseat-map-list");
    const listScrollTop = previousList?.scrollTop ?? 0;
    const listScrollLeft = previousList?.scrollLeft ?? 0;
    const active = document.activeElement as HTMLButtonElement | null;
    const activeAction = modal.contains(active) ? active?.dataset.mapAction : undefined;
    const activeMap = modal.contains(active) ? active?.dataset.mapId : undefined;
    const selectedMap = getHotseatMap(selectedMapId);
    const selectedName = selectedMap ? I18nManager.t(selectedMap.nameKey) : "";
    modal.setAttribute("aria-busy", String(starting));
    modal.innerHTML = `<div class="hotseat-map-panel">
      <header class="hotseat-map-header">
        <h2 id="hotseat-map-title">${escapeHtml(I18nManager.t("hotseat_map.title"))}</h2>
      </header>
      <p id="hotseat-map-description" class="hotseat-map-intro">${escapeHtml(I18nManager.t("hotseat_map.description"))}</p>
      <div class="hotseat-map-showcase">
        <aside class="hotseat-map-detail">
          <div class="hotseat-map-plan">${selectedMap ? previewImage(selectedMap.id, "plan", selectedName) : ""}</div>
          <div class="hotseat-map-copy">
            <h3>${escapeHtml(selectedName)}</h3>
            <p>${selectedMap ? escapeHtml(I18nManager.t(selectedMap.descriptionKey)) : ""}</p>
          </div>
        </aside>
        <div class="hotseat-map-perspective">
          ${selectedMap ? previewImage(selectedMap.id, "perspective", selectedName) : ""}
          <span class="hotseat-map-preview-title" aria-hidden="true">${escapeHtml(selectedName)}</span>
        </div>
      </div>
      <div class="hotseat-map-list" role="group" aria-labelledby="hotseat-map-title">
        ${HOTSEAT_MAP_CATALOG.map(map => {
          const name = I18nManager.t(map.nameKey);
          return `<button type="button" class="hotseat-map-card" data-map-id="${escapeHtml(map.id)}" aria-label="${escapeHtml(name)}" title="${escapeHtml(name)}" aria-pressed="${map.id === selectedMapId}" ${starting ? "disabled" : ""}>
            <span class="hotseat-map-thumbnail">${previewImage(map.id, "thumb", name)}</span>
            <span class="hotseat-map-code" aria-hidden="true">${escapeHtml(name)}</span>
          </button>`;
        }).join("")}
      </div>
      <footer class="hotseat-map-actions">
        <p class="hotseat-map-status" role="status" aria-live="polite">${escapeHtml(I18nManager.t(starting ? "hotseat_map.starting" : errorKey || "hotseat_map.ready", selectedMap ? { map: selectedName } : {}))}</p>
        <div class="hotseat-map-buttons">
          <button type="button" data-map-action="back" ${starting ? "disabled" : ""}>${escapeHtml(I18nManager.t("hotseat_map.back"))}</button>
          <button type="button" data-map-action="start" ${starting || !selectedMap ? "disabled" : ""}>${escapeHtml(I18nManager.t("hotseat_map.start"))}</button>
        </div>
      </footer>
    </div>`;
    modal.querySelector('[data-map-action="back"]')?.addEventListener("click", cancel);
    modal.querySelector('[data-map-action="start"]')?.addEventListener("click", () => { void start(); });
    modal.querySelectorAll<HTMLButtonElement>("[data-map-id]").forEach(button => {
      button.addEventListener("click", () => {
        if (starting) return;
        selectedMapId = button.dataset.mapId!;
        errorKey = "";
        options.onSelect(selectedMapId);
        render();
        focusMap(selectedMapId);
      });
    });
    const list = modal.querySelector<HTMLElement>(".hotseat-map-list");
    if (list) {
      list.scrollTop = listScrollTop;
      list.scrollLeft = listScrollLeft;
    }
    if (starting) modal.focus();
    else if (activeAction) modal.querySelector<HTMLButtonElement>(`[data-map-action="${activeAction}"]`)?.focus();
    else if (activeMap) focusMap(activeMap);
  };
  const start = async () => {
    if (starting || closed || !getHotseatMap(selectedMapId)) return;
    starting = true;
    errorKey = "";
    render();
    try {
      await options.onStart(selectedMapId);
      close();
    } catch (error) {
      console.error("Hotseat map start failed", error);
      if (!closed) {
        errorKey = getHotseatMap(selectedMapId) ? "hotseat_map.start_failed" : "hotseat_map.unavailable";
        starting = false;
        render();
        modal.querySelector<HTMLButtonElement>('[data-map-action="start"]')?.focus();
      }
    }
  };
  modal.addEventListener("click", event => { if (event.target === modal) cancel(); });
  modal.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    } else if (event.key === "Tab") {
      event.preventDefault();
      const buttons = [...modal.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
      if (buttons.length) {
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = index < 0 ? (event.shiftKey ? buttons.length - 1 : 0) : (index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
        buttons[next].focus();
      }
    } else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      const buttons = [...modal.querySelectorAll<HTMLButtonElement>("[data-map-id]:not(:disabled)")];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (index >= 0 && buttons.length) {
        event.preventDefault();
        const rowStart = Math.floor(index / MAP_COLUMNS) * MAP_COLUMNS;
        const rowLength = Math.min(MAP_COLUMNS, buttons.length - rowStart);
        const next = event.key === "ArrowUp" || event.key === "ArrowDown"
          ? (index + (event.key === "ArrowUp" ? -MAP_COLUMNS : MAP_COLUMNS) + buttons.length) % buttons.length
          : rowStart + (index - rowStart + (event.key === "ArrowLeft" ? -1 : 1) + rowLength) % rowLength;
        buttons[next].click();
      }
    }
    event.stopPropagation();
  });
  container.append(modal);
  render();
  window.addEventListener("resize", scrollSelectedMap);
  unsubscribe = I18nManager.subscribe(() => { if (!closed) render(); });
  focusMap(getHotseatMap(selectedMapId) ? selectedMapId : HOTSEAT_MAP_CATALOG[0].id);
  return close;
}
