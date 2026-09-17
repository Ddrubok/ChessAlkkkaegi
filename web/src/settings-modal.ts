import { uiText } from "./ui-text";
/**
 * 통합 환경 설정 모달 (SettingsModal)
 * - 탭 1: 사운드 설정 (BGM 볼륨, SFX 볼륨, 전체 음소거)
 * - 탭 2: 배너 설정 (6가지 배너 테마 - 보유 배너 장착 / 잠금 배너 진행도 표시)
 * - 탭 3: 언어 설정 (9개국 글로벌 언어 그리드 선택)
 */

import { I18nManager, SUPPORTED_LANGUAGES, type LanguageCode } from "./i18n";
import { getSoundSettings, updateSoundSettings } from "./sound";
import { AdManager } from "./ad-manager";
import {
  BANNER_IDS,
  getBannerTheme,
  setBannerTheme,
  bannerThemeLabel,
  bannerSettingsText,
  ownsBanner,
  getBannerProgress,
  bannerImageUrl,
  type BannerTheme,
} from "./banner-theme";
import {
  bannerCopy,
  bannerThemeCondition,
  bannerThemeMode,
} from "./banner-copy";
import { progressStorage } from "./progress-storage";
import { escapeHtml } from "./html";

export function openSettingsModal(parentContainer?: HTMLElement): void {
  const container = parentContainer ?? document.body;
  const existing = document.querySelector(".settings-modal-overlay");
  if (existing) existing.dispatchEvent(new Event("settings-request-close"));

  const modal = document.createElement("div");
  modal.className = "settings-modal-overlay";
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

  const cleanupListeners: Array<() => void> = [];

  const closeModal = () => {
    if (closed) return;
    closed = true;
    cleanupListeners.forEach((cleanup) => cleanup());
    cleanupListeners.length = 0;
    modal.remove();
  };

  modal.addEventListener("settings-request-close", closeModal, { once: true });

  const render = (): void => {
    if (closed) return;
    const scrollTop = card.scrollTop;
    const focused = card.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
    const focusId = focused?.id;
    const focusTheme = focused?.dataset.theme;
    const soundSettings = getSoundSettings();
    const currentLang = I18nManager.currentLang;
    const copy = bannerCopy(currentLang);

    card.innerHTML = `
      <!-- 헤더 -->
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #334155; padding-bottom:12px; flex-shrink:0;">
        <h3 style="margin:0; font-size:18px; font-weight:800; color:#f8fafc; white-space:nowrap;">${escapeHtml(I18nManager.t("common.settings"))}</h3>
        <button id="settings-modal-close" style="background:transparent; border:none; color:#94a3b8; font-size:20px; cursor:pointer; padding:4px 8px; line-height:1;" aria-label="${escapeHtml(I18nManager.t("common.close") || "Close")}">✕</button>
      </div>

      <!-- 탭 선택 바 -->
      <div style="display:flex; gap:6px; background:#0f172a; padding:4px; border-radius:8px; flex-shrink:0;">
        <button id="tab-btn-sound" style="flex:1; border:none; border-radius:6px; padding:10px 6px; font-size:13px; font-weight:700; cursor:pointer; background:${activeTab === "sound" ? "#2563eb" : "transparent"}; color:${activeTab === "sound" ? "white" : "#94a3b8"}; white-space:nowrap;">
          ${escapeHtml(I18nManager.t("common.sound"))}
        </button>
        <button id="tab-btn-banner" style="flex:1; border:none; border-radius:6px; padding:10px 6px; font-size:13px; font-weight:700; cursor:pointer; background:${activeTab === "banner" ? "#2563eb" : "transparent"}; color:${activeTab === "banner" ? "white" : "#94a3b8"}; white-space:nowrap;">
          ${escapeHtml(bannerSettingsText("tab", currentLang))}
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
    card.querySelector("#ad-privacy-options")?.addEventListener("click", () => { void AdManager.showPrivacyOptions(); });
    card.querySelector("#settings-modal-close")?.addEventListener("click", closeModal);

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
      // 2. 배너 외형 설정 탭 (회원: 6종 카드 / 게스트: 기본 단색 배너 안내)
      // -------------------------------------------------------------
      const isMember = progressStorage.owner !== null;

      if (!isMember) {
        content.innerHTML = `
          <div style="display:flex; flex-direction:column; gap:14px; align-items:center;">
            <div style="
              width: 100%;
              aspect-ratio: 3/1;
              background: #334155;
              border: 1px solid #64748b;
              border-radius: 12px;
              display: flex;
              align-items: center;
              justify-content: center;
              box-sizing: border-box;
              padding: 14px;
            ">
              <div style="display:flex; flex-direction:column; align-items:center; gap:4px; text-align:center;">
                <span style="font-size:16px; font-weight:750; color:#f8fafc;">${escapeHtml(I18nManager.t("online.guest_mode"))}</span>
                <span style="font-size:12px; font-weight:600; color:#94a3b8;">${escapeHtml(I18nManager.t("online.guest_mode"))}</span>
              </div>
            </div>
            <div style="font-size:13px; color:#94a3b8; text-align:center; line-height:1.5; padding:0 8px; word-break:keep-all;">
              ${escapeHtml(copy.guestNotice)}
            </div>
          </div>
        `;
      } else {
        const currentTheme = getBannerTheme();

        content.innerHTML = `
          <div style="display:flex; flex-direction:column; gap:12px;">
            <div style="display:flex; flex-direction:column; gap:10px;">
              ${BANNER_IDS.map((theme) => {
                const owned = ownsBanner(progressStorage, theme);
                const isSelected = currentTheme === theme;
                const label = bannerThemeLabel(theme, currentLang);
                const condition = bannerThemeCondition(theme, currentLang);
                const mode = bannerThemeMode(theme, currentLang);
                const progress = getBannerProgress(progressStorage, theme);
                const imgSrc = bannerImageUrl(theme);

                if (owned) {
                  return `
                    <button class="banner-theme-select-btn" data-theme="${escapeHtml(theme)}" aria-pressed="${isSelected ? "true" : "false"}" style="
                      background: ${isSelected ? "#1e293b" : "#0f172a"};
                      border: 2px solid ${isSelected ? "#3b82f6" : "#334155"};
                      color: #f8fafc;
                      border-radius: 12px;
                      overflow: hidden;
                      padding: 0;
                      cursor: pointer;
                      display: flex;
                      flex-direction: column;
                      transition: border-color 0.15s, transform 0.1s;
                      text-align: left;
                      box-sizing: border-box;
                      width: 100%;
                    ">
                      <div style="width:100%; aspect-ratio:3/1; overflow:hidden; background:#0b0f19;">
                        <img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(label)}" loading="lazy" style="width:100%; height:100%; object-fit:cover; display:block;" />
                      </div>
                      <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 14px; width:100%; box-sizing:border-box; gap:10px;">
                        <div style="display:flex; flex-direction:column; gap:2px; min-width:0; overflow:hidden;">
                          <span style="font-size:14px; font-weight:700; color:#f8fafc; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(label)}</span>
                          <span style="font-size:11px; color:#94a3b8; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(condition)}</span>
                        </div>
                        ${isSelected ? `<span class="selected-indicator" style="font-size:11px; font-weight:800; background:#2563eb; color:white; padding:3px 7px; border-radius:6px; flex-shrink:0;">${escapeHtml(copy.equipped)} ✓</span>` : `<span style="font-size:11px; font-weight:600; color:#94a3b8; flex-shrink:0;">${escapeHtml(copy.equip)}</span>`}
                      </div>
                    </button>
                  `;
                }

                // Locked banner card - accurate PvE condition and progress, no fake equip button
                return `
                  <div class="banner-theme-locked-card" aria-disabled="true" style="
                    background: #0b0f19;
                    border: 1px dashed #475569;
                    color: #94a3b8;
                    border-radius: 12px;
                    overflow: hidden;
                    padding: 0;
                    display: flex;
                    flex-direction: column;
                    box-sizing: border-box;
                    width: 100%;
                    opacity: 0.85;
                  ">
                    <div style="width:100%; aspect-ratio:3/1; overflow:hidden; background:#070a10; position:relative; filter:brightness(0.6) grayscale(0.4);">
                      <img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(label)}" loading="lazy" style="width:100%; height:100%; object-fit:cover; display:block;" />
                      <div style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.4); font-size:24px;">
                        🔒
                      </div>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:6px; padding:10px 14px; width:100%; box-sizing:border-box;">
                      <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
                        <span style="font-size:14px; font-weight:700; color:#cbd5e1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(label)}</span>
                        <span style="font-size:11px; font-weight:700; color:#e2e8f0; background:#334155; padding:2px 6px; border-radius:4px; flex-shrink:0;">${progress.current}/${progress.target}</span>
                      </div>
                      <div style="font-size:12px; color:#94a3b8; line-height:1.4;">
                        ${escapeHtml(condition)}
                      </div>
                      <div style="display:flex; align-items:center; justify-content:space-between; font-size:11px; color:#64748b; margin-top:2px;">
                        <span>${escapeHtml(mode)}</span>
                        <span style="font-weight:600; color:#f59e0b;">${escapeHtml(copy.locked)}</span>
                      </div>
                    </div>
                  </div>
                `;
              }).join("")}
            </div>
            ${progressStorage.masteryPending || progressStorage.bannersPending || progressStorage.saveFailed ? `<p style="font-size:12px; color:${progressStorage.saveFailed ? "#f87171" : "#38bdf8"}; text-align:center; margin:2px 0;">${escapeHtml(progressStorage.status)}</p><button type="button" data-banner-retry>${escapeHtml(I18nManager.t("lobby.progress_retry_save"))}</button>` : ""}
            <div style="font-size:12px; color:#94a3b8; text-align:center; margin-top:4px;">
              ${escapeHtml(bannerSettingsText("hint", currentLang))}
            </div>
          </div>
        `;

        content.querySelector<HTMLButtonElement>("[data-banner-retry]")?.addEventListener("click", () => { void progressStorage.retry(); });
        content.querySelectorAll<HTMLButtonElement>(".banner-theme-select-btn").forEach((btn) => {
          btn.addEventListener("click", () => {
            if (progressStorage.owner === null || !progressStorage.ready || progressStorage.unsafeData) return;
            const theme = btn.dataset.theme as BannerTheme;
            if (theme && ownsBanner(progressStorage, theme)) {
              setBannerTheme(theme);
              render();
            }
          });
        });
      }
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
    else if (focusTheme) card.querySelector<HTMLElement>(`[data-theme="${CSS.escape(focusTheme)}"]`)?.focus({ preventScroll: true });
    card.scrollTop = scrollTop;
  };

  // Subscribe to progressStorage and I18n updates while modal is open
  if (typeof progressStorage?.subscribe === "function") {
    const unsubProgress = progressStorage.subscribe(() => {
      if (!closed) render();
    });
    cleanupListeners.push(unsubProgress);
  }

  if (typeof I18nManager?.subscribe === "function") {
    const unsubI18n = I18nManager.subscribe(() => {
      if (!closed) render();
    });
    cleanupListeners.push(unsubI18n);
  }

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      closeModal();
    }
  };
  document.addEventListener("keydown", handleKeydown);
  cleanupListeners.push(() => document.removeEventListener("keydown", handleKeydown));

  modal.addEventListener("pointerdown", (event) => {
    if (event.target === modal) closeModal();
  });

  render();
  modal.appendChild(card);
  container.appendChild(modal);
}
