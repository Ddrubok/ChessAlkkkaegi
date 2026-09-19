import type { UserProfile } from './supabase-auth';
import { uiText } from "./ui-text";
/**
 * 통합 환경 설정 모달 (SettingsModal)
 * - 탭 1: 사운드 설정 (BGM 볼륨, SFX 볼륨, 전체 음소거)
 * - 탭 2: 치장품 설정 (6슬롯 외형 꾸미기 - 배경, 프레임, 배지, 배지프레임, 칭호, 칭호프레임)
 * - 탭 3: 언어 설정 (9개국 글로벌 언어 그리드 선택)
 */

import { I18nManager, SUPPORTED_LANGUAGES, type LanguageCode } from "./i18n";
import { getSoundSettings, updateSoundSettings } from "./sound";
import { AdManager } from "./ad-manager";
import { progressStorage } from "./progress-storage";
import { escapeHtml } from "./html";
import { mountCosmeticsSettingsPanel } from "./cosmetics-settings";
import type { CosmeticLoadout } from "./cosmetics";
import { getCosmeticsCopy } from "./cosmetics-copy";
import "./cosmetics-settings.css";

export function openSettingsModal(parentContainer?: HTMLElement, getProfile?: () => UserProfile | null): void {
  const container = parentContainer ?? document.body;
  const existing = document.querySelector(".settings-modal-overlay");
  if (existing) existing.dispatchEvent(new Event("settings-request-close"));

  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const openerSelector = previousFocus?.id
    ? `#${CSS.escape(previousFocus.id)}`
    : previousFocus?.hasAttribute("data-open-settings")
      ? "[data-open-settings]"
      : null;

  const modal = document.createElement("div");
  modal.className = "settings-modal-overlay";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "settings-modal-title");
  modal.tabIndex = -1;
  modal.style.cssText = `
    position: fixed;
    inset: 0;
    background: rgba(11, 15, 25, 0.92);
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    box-sizing: border-box;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans CJK KR", "Noto Sans CJK JP", "Noto Sans CJK SC", "Meiryo", "Microsoft YaHei", sans-serif;
  `;

  const card = document.createElement("div");
  card.className = "settings-modal-card";
  card.style.cssText = `
    width: 100%;
    max-width: 480px;
    max-height: 88vh;
    overflow-y: auto;
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 16px;
    padding: 24px;
    box-shadow: 0 25px 50px -12px rgba(0,0,0,0.6);
    color: #f8fafc;
    display: flex;
    flex-direction: column;
    gap: 16px;
    box-sizing: border-box;
    word-break: keep-all;
  `;

  let activeTab: "sound" | "banner" | "language" = "sound";
  let closed = false;
  let cosmeticPanel: ReturnType<typeof mountCosmeticsSettingsPanel> | null = null;
  let modalDraftLoadout: CosmeticLoadout | null = null;
  let lastOwner: string | null | undefined = progressStorage?.owner;

  const background = [...container.children]
    .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== modal)
    .map((element) => ({ element, inert: element.inert }));

  const cleanupListeners: Array<() => void> = [];

  const focusable = () =>
    [
      ...modal.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex='0']"
      ),
    ].filter((element) => element.getClientRects().length > 0);

  const closeModal = (restoreFocus = true) => {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", trapFocus, true);
    background.forEach(({ element, inert }) => {
      element.inert = inert;
    });
    cosmeticPanel?.cleanup();
    cosmeticPanel = null;
    modalDraftLoadout = null;
    cleanupListeners.forEach((cleanup) => cleanup());
    cleanupListeners.length = 0;
    modal.remove();
    if (restoreFocus) {
      queueMicrotask(() => {
        const target = previousFocus?.isConnected
          ? previousFocus
          : openerSelector
            ? document.querySelector<HTMLElement>(openerSelector)
            : null;
        target?.focus();
      });
    }
  };

  const trapFocus = (event: KeyboardEvent) => {
    if (closed) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeModal();
      return;
    }
    if (event.key !== "Tab") return;
    const items = focusable();
    if (!items.length) {
      event.preventDefault();
      event.stopPropagation();
      modal.focus();
      return;
    }
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.shiftKey) {
      if (index <= 0) {
        event.preventDefault();
        event.stopPropagation();
        items[items.length - 1].focus();
      }
    } else {
      if (index === -1 || index >= items.length - 1) {
        event.preventDefault();
        event.stopPropagation();
        items[0].focus();
      }
    }
  };

  modal.addEventListener("settings-request-close", () => closeModal(false), { once: true });

  const render = (): void => {
    if (closed) return;
    if (progressStorage?.owner !== lastOwner) {
      lastOwner = progressStorage?.owner;
      modalDraftLoadout = null;
    }
    cosmeticPanel?.cleanup();
    cosmeticPanel = null;
    const scrollTop = card.scrollTop;
    const focused = card.contains(document.activeElement) ? (document.activeElement as HTMLElement) : null;
    const focusId = focused?.id;
    const soundSettings = getSoundSettings();
    const currentLang = I18nManager.currentLang;
    const cosmeticsCopy = getCosmeticsCopy(currentLang);

    card.innerHTML = `
      <!-- 헤더 -->
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #334155; padding-bottom:12px; flex-shrink:0;">
        <h3 id="settings-modal-title" style="margin:0; font-size:18px; font-weight:800; color:#f8fafc; white-space:nowrap;">${escapeHtml(I18nManager.t("common.settings"))}</h3>
        <button id="settings-modal-close" style="background:transparent; border:none; color:#94a3b8; font-size:20px; cursor:pointer; padding:4px 8px; line-height:1;" aria-label="${escapeHtml(I18nManager.t("common.close") || "Close")}">✕</button>
      </div>

      <!-- 탭 선택 바 -->
      <div style="display:flex; gap:6px; background:#0f172a; padding:4px; border-radius:8px; flex-shrink:0;">
        <button id="tab-btn-sound" style="flex:1; border:none; border-radius:6px; padding:10px 6px; font-size:13px; font-weight:700; cursor:pointer; background:${activeTab === "sound" ? "#2563eb" : "transparent"}; color:${activeTab === "sound" ? "white" : "#94a3b8"}; white-space:nowrap;">
          ${escapeHtml(I18nManager.t("common.sound"))}
        </button>
        <button id="tab-btn-banner" style="flex:1; border:none; border-radius:6px; padding:10px 6px; font-size:13px; font-weight:700; cursor:pointer; background:${activeTab === "banner" ? "#2563eb" : "transparent"}; color:${activeTab === "banner" ? "white" : "#94a3b8"}; white-space:nowrap;">
          ${escapeHtml(cosmeticsCopy.tabTitle)}
        </button>
        <button id="tab-btn-language" style="flex:1; border:none; border-radius:6px; padding:10px 6px; font-size:13px; font-weight:700; cursor:pointer; background:${activeTab === "language" ? "#2563eb" : "transparent"}; color:${activeTab === "language" ? "white" : "#94a3b8"}; white-space:nowrap;">
          ${escapeHtml(I18nManager.t("common.language"))}
        </button>
      </div>

      <!-- 탭 본문 -->
      <div id="settings-tab-content" style="display:flex; flex-direction:column;"></div>
      ${AdManager.hasPrivacyOptions() ? `<button id="ad-privacy-options" type="button" style="flex-shrink:0;">${escapeHtml(uiText("privacy"))}</button>` : ""}
    `;

    // 닫기 이벤트
    card.querySelector("#ad-privacy-options")?.addEventListener("click", () => {
      void AdManager.showPrivacyOptions();
    });
    card.querySelector("#settings-modal-close")?.addEventListener("click", () => closeModal());

    // 탭 전환 이벤트
    card.querySelector("#tab-btn-sound")?.addEventListener("click", () => {
      activeTab = "sound";
      render();
    });
    card.querySelector("#tab-btn-banner")?.addEventListener("click", () => {
      activeTab = "banner";
      render();
    });
    card.querySelector("#tab-btn-language")?.addEventListener("click", () => {
      activeTab = "language";
      render();
    });

    const content = card.querySelector("#settings-tab-content") as HTMLElement;
    if (!content) return;

    if (activeTab === "sound") {
      // -------------------------------------------------------------
      // 1. 사운드 설정 탭
      // -------------------------------------------------------------
      content.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:16px;">
          <!-- 전체 음소거 -->
          <div style="display:flex; justify-content:space-between; align-items:center; background:#0f172a; padding:12px 14px; border-radius:10px; border:1px solid #334155;">
            <div>
              <div style="font-size:14px; font-weight:700; color:#f8fafc; white-space:nowrap;">${escapeHtml(I18nManager.t("common.mute"))}</div>
              <div style="font-size:12px; color:#94a3b8; margin-top:2px;">${escapeHtml(I18nManager.t("common.muteDesc"))}</div>
            </div>
            <input type="checkbox" id="settings-mute-toggle" ${soundSettings.muted ? "checked" : ""} style="width:20px; height:20px; cursor:pointer; accent-color:#3b82f6;" />
          </div>

          <!-- BGM 볼륨 -->
          <div style="background:#0f172a; padding:12px 14px; border-radius:10px; border:1px solid #334155; opacity:${soundSettings.muted ? 0.4 : 1};">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <span style="font-size:13px; font-weight:600; color:#cbd5e1; white-space:nowrap;">${escapeHtml(I18nManager.t("common.bgm"))}</span>
              <span id="settings-bgm-val" style="font-size:13px; font-weight:700; color:#38bdf8;">${Math.round(soundSettings.bgmVolume * 100)}%</span>
            </div>
            <input type="range" id="settings-bgm-slider" min="0" max="100" value="${Math.round(soundSettings.bgmVolume * 100)}" ${soundSettings.muted ? "disabled" : ""} style="width:100%; cursor:pointer; accent-color:#38bdf8;" />
          </div>

          <!-- SFX 볼륨 -->
          <div style="background:#0f172a; padding:12px 14px; border-radius:10px; border:1px solid #334155; opacity:${soundSettings.muted ? 0.4 : 1};">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <span style="font-size:13px; font-weight:600; color:#cbd5e1; white-space:nowrap;">${escapeHtml(I18nManager.t("common.sfx"))}</span>
              <span id="settings-sfx-val" style="font-size:13px; font-weight:700; color:#38bdf8;">${Math.round(soundSettings.sfxVolume * 100)}%</span>
            </div>
            <input type="range" id="settings-sfx-slider" min="0" max="100" value="${Math.round(soundSettings.sfxVolume * 100)}" ${soundSettings.muted ? "disabled" : ""} style="width:100%; cursor:pointer; accent-color:#38bdf8;" />
          </div>
        </div>
      `;

      // 사운드 컨트롤 핸들러
      const muteToggle = content.querySelector("#settings-mute-toggle") as HTMLInputElement;
      const bgmSlider = content.querySelector("#settings-bgm-slider") as HTMLInputElement;
      const sfxSlider = content.querySelector("#settings-sfx-slider") as HTMLInputElement;
      const bgmVal = content.querySelector("#settings-bgm-val") as HTMLElement;
      const sfxVal = content.querySelector("#settings-sfx-val") as HTMLElement;

      muteToggle?.addEventListener("change", () => {
        updateSoundSettings({ muted: muteToggle.checked });
        render();
      });

      bgmSlider?.addEventListener("input", () => {
        const val = Number(bgmSlider.value);
        if (bgmVal) bgmVal.textContent = `${val}%`;
        updateSoundSettings({ bgmVolume: val / 100 });
      });

      sfxSlider?.addEventListener("input", () => {
        const val = Number(sfxSlider.value);
        if (sfxVal) sfxVal.textContent = `${val}%`;
        updateSoundSettings({ sfxVolume: val / 100 });
      });
    } else if (activeTab === "banner") {
      // -------------------------------------------------------------
      // 2. 6슬롯 치장품 설정 탭 (외형 꾸미기 프로덕션 UI 패널)
      // -------------------------------------------------------------
      cosmeticPanel = mountCosmeticsSettingsPanel(content, {
        getProfile,
        initialDraft: modalDraftLoadout ?? undefined,
        onDraftChange: (draft, isDirty) => {
          modalDraftLoadout = isDirty ? draft : null;
        },
        onApplied: () => {
          modalDraftLoadout = null;
        },
      });
    } else {
      // -------------------------------------------------------------
      // 3. 언어 설정 탭 (9개국 글로벌 언어 그리드)
      // -------------------------------------------------------------
      content.innerHTML = `
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
          ${SUPPORTED_LANGUAGES.map((lang) => {
            const isSelected = currentLang === lang.code;
            return `
              <button class="lang-select-btn" data-lang="${escapeHtml(lang.code)}" style="
                background: ${isSelected ? "#1e3a8a" : "#0f172a"};
                border: 1px solid ${isSelected ? "#3b82f6" : "#334155"};
                color: ${isSelected ? "#ffffff" : "#cbd5e1"};
                border-radius: 10px;
                padding: 12px 10px;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 8px;
                font-weight: 700;
                font-size: 13px;
                text-align: left;
                white-space: nowrap;
                overflow: hidden;
                box-shadow: ${isSelected ? "0 0 10px rgba(59,130,246,0.3)" : "none"};
              ">
                <span style="font-size:20px; line-height:1; flex-shrink:0;">${lang.flag}</span>
                <div style="flex:1; min-width:0; overflow:hidden;">
                  <div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(lang.nativeLabel)}</div>
                  <div style="font-size:11px; font-weight:normal; opacity:0.75; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:${isSelected ? "#93c5fd" : "#94a3b8"};">${escapeHtml(lang.label)}</div>
                </div>
                ${isSelected ? '<span style="font-size:10px; background:#2563eb; color:white; padding:2px 5px; border-radius:4px; flex-shrink:0;">✓</span>' : ""}
              </button>
            `;
          }).join("")}
        </div>
      `;

      content.querySelectorAll<HTMLButtonElement>(".lang-select-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const langCode = btn.dataset.lang as LanguageCode;
          if (langCode && langCode !== I18nManager.currentLang) {
            I18nManager.setLanguage(langCode);
            render();
          }
        });
      });
    }
    if (focusId) card.querySelector<HTMLElement>(`#${CSS.escape(focusId)}`)?.focus({ preventScroll: true });
    card.scrollTop = scrollTop;
  };

  // Subscribe to progressStorage and I18n updates while modal is open
  if (typeof progressStorage?.subscribe === "function") {
    const unsubProgress = progressStorage.subscribe(() => {
      if (!closed && activeTab !== "banner") render();
    });
    cleanupListeners.push(unsubProgress);
  }

  if (typeof I18nManager?.subscribe === "function") {
    const unsubI18n = I18nManager.subscribe(() => {
      if (!closed && activeTab !== "banner") render();
    });
    cleanupListeners.push(unsubI18n);
  }

  document.addEventListener("keydown", trapFocus, true);

  modal.addEventListener("pointerdown", (event) => {
    if (event.target === modal) closeModal();
  });

  render();
  modal.appendChild(card);
  container.appendChild(modal);
  background.forEach(({ element }) => {
    element.inert = true;
  });
  card.querySelector<HTMLButtonElement>("#settings-modal-close")?.focus();
}
