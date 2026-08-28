/**
 * 통합 환경 설정 모달 (SettingsModal)
 * - 탭 1: 사운드 설정 (BGM 볼륨, SFX 볼륨, 전체 음소거)
 * - 탭 2: 언어 설정 (6개 언어 그리드 선택)
 */

import { I18nManager, SUPPORTED_LANGUAGES, type LanguageCode } from "./i18n";
import { getSoundSettings, updateSoundSettings } from "./sound";

export function openSettingsModal(parentContainer?: HTMLElement): void {
  const container = parentContainer ?? document.body;
  const existing = document.querySelector(".settings-modal-overlay");
  if (existing) existing.remove();

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
    padding: 20px;
    box-sizing: border-box;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  `;

  const card = document.createElement("div");
  card.className = "settings-modal-card";
  card.style.cssText = `
    width: 100%;
    max-width: 440px;
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
  `;

  let activeTab: "sound" | "language" = "sound";

  const render = (): void => {
    const soundSettings = getSoundSettings();
    const currentLang = I18nManager.currentLang;

    card.innerHTML = `
      <!-- 헤더 -->
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #334155; padding-bottom:12px;">
        <h3 style="margin:0; font-size:18px; font-weight:800; color:#f8fafc;">${I18nManager.t("common.settings")}</h3>
        <button id="settings-modal-close" style="background:transparent; border:none; color:#94a3b8; font-size:20px; cursor:pointer; padding:4px 8px; line-height:1;">✕</button>
      </div>

      <!-- 탭 선택 바 -->
      <div style="display:flex; gap:6px; background:#0f172a; padding:4px; border-radius:8px;">
        <button id="tab-btn-sound" style="flex:1; border:none; border-radius:6px; padding:10px 6px; font-size:13px; font-weight:700; cursor:pointer; background:${activeTab === "sound" ? "#2563eb" : "transparent"}; color:${activeTab === "sound" ? "white" : "#94a3b8"};">
          ${I18nManager.t("common.sound")}
        </button>
        <button id="tab-btn-language" style="flex:1; border:none; border-radius:6px; padding:10px 6px; font-size:13px; font-weight:700; cursor:pointer; background:${activeTab === "language" ? "#2563eb" : "transparent"}; color:${activeTab === "language" ? "white" : "#94a3b8"};">
          ${I18nManager.t("common.language")}
        </button>
      </div>

      <!-- 탭 본문 -->
      <div id="settings-tab-content" style="min-height:220px; display:flex; flex-direction:column; justify-content:center;"></div>
    `;

    // 닫기 이벤트
    card.querySelector("#settings-modal-close")?.addEventListener("click", () => modal.remove());

    // 탭 전환 이벤트
    card.querySelector("#tab-btn-sound")?.addEventListener("click", () => {
      activeTab = "sound";
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
              <div style="font-size:14px; font-weight:700; color:#f8fafc;">${I18nManager.t("common.mute")}</div>
              <div style="font-size:12px; color:#94a3b8; margin-top:2px;">${I18nManager.t("common.muteDesc")}</div>
            </div>
            <input type="checkbox" id="settings-mute-toggle" ${soundSettings.muted ? "checked" : ""} style="width:20px; height:20px; cursor:pointer; accent-color:#3b82f6;" />
          </div>

          <!-- BGM 볼륨 -->
          <div style="background:#0f172a; padding:12px 14px; border-radius:10px; border:1px solid #334155; opacity:${soundSettings.muted ? 0.4 : 1};">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <span style="font-size:13px; font-weight:600; color:#cbd5e1;">${I18nManager.t("common.bgm")}</span>
              <span id="settings-bgm-val" style="font-size:13px; font-weight:700; color:#38bdf8;">${Math.round(soundSettings.bgmVolume * 100)}%</span>
            </div>
            <input type="range" id="settings-bgm-slider" min="0" max="100" value="${Math.round(soundSettings.bgmVolume * 100)}" ${soundSettings.muted ? "disabled" : ""} style="width:100%; cursor:pointer; accent-color:#38bdf8;" />
          </div>

          <!-- SFX 볼륨 -->
          <div style="background:#0f172a; padding:12px 14px; border-radius:10px; border:1px solid #334155; opacity:${soundSettings.muted ? 0.4 : 1};">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <span style="font-size:13px; font-weight:600; color:#cbd5e1;">${I18nManager.t("common.sfx")}</span>
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
    } else {
      // -------------------------------------------------------------
      // 2. 언어 설정 탭 (6개 언어 그리드)
      // -------------------------------------------------------------
      content.innerHTML = `
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
          ${SUPPORTED_LANGUAGES.map((lang) => {
            const isSelected = currentLang === lang.code;
            return `
              <button class="lang-select-btn" data-lang="${lang.code}" style="
                background: ${isSelected ? "#1e3a8a" : "#0f172a"};
                border: 1px solid ${isSelected ? "#3b82f6" : "#334155"};
                color: ${isSelected ? "#ffffff" : "#cbd5e1"};
                border-radius: 10px;
                padding: 14px 12px;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 10px;
                font-weight: 700;
                font-size: 14px;
                text-align: left;
                box-shadow: ${isSelected ? "0 0 10px rgba(59,130,246,0.3)" : "none"};
              ">
                <span style="font-size:20px; line-height:1;">${lang.flag}</span>
                <div style="flex:1;">
                  <div>${lang.nativeLabel}</div>
                  <div style="font-size:11px; font-weight:normal; opacity:0.75; color:${isSelected ? "#93c5fd" : "#94a3b8"};">${lang.label}</div>
                </div>
                ${isSelected ? '<span style="font-size:11px; background:#2563eb; color:white; padding:2px 6px; border-radius:4px;">ON</span>' : ""}
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
  };

  render();
  modal.appendChild(card);
  container.appendChild(modal);
}
