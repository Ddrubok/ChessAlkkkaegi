import { applyCosmeticAppearance, getCosmeticBadgeImage } from './cosmetics-view';
import { formatTier } from './tier-view';
import type { UserProfile } from './supabase-auth';
import { COSMETIC_OPTIONS, ownsCosmetic as ownsAccountCosmetic, equipCosmeticLoadout as equipAccountCosmetics } from './cosmetics';
import { getPlayerCosmetics, setLocalCosmeticPreview } from './banner-theme';
const getCosmeticLoadout = (_storage: unknown) => getPlayerCosmetics(Boolean(progressStorage.owner));
const ownsCosmetic = (_storage: unknown, slot: CosmeticSlot, id: string | null) => isLocalBannerPreview || ownsAccountCosmetic(progressStorage, slot, id);
const equipCosmeticLoadout = (_storage: unknown, value: CosmeticLoadout) => isLocalBannerPreview ? setLocalCosmeticPreview(value) : equipAccountCosmetics(progressStorage, value);
import { I18nManager, type LanguageCode } from "./i18n";
import { progressStorage } from "./progress-storage";
import {
  isLocalBannerPreview,
  bannerImageUrl,
  type BannerTheme,
  type BannerAppearance,
} from "./banner-theme";
import {
  getCosmeticsCopy,
  type CosmeticSlot,
  type CosmeticLoadout,
  type CosmeticCopyDict,
} from "./cosmetics-copy";
import { escapeHtml } from "./html";

export type { CosmeticSlot, CosmeticLoadout };

export const COSMETIC_SLOTS: readonly CosmeticSlot[] = [
  "banner",
  "frame",
  "badge",
  "badgeFrame",
  "title",
  "titleFrame",
] as const;

const BADGE_GLYPHS: Record<string, string> = {
  "badge:mastery-m01": "♟",
  "badge:mastery-m02": "♞",
  "badge:mastery-m03": "♝",
  "badge:mastery-m04": "♜",
  "badge:mastery-m05": "♛",
  "badge:mastery-m06": "♚",
  "badge:mastery-m07": "⚔",
  "badge:mastery-m08": "👑",
};

/**
 * Mounts the production 6-slot cosmetics settings UI panel.
 */
export function mountCosmeticsSettingsPanel(
  container: HTMLElement,
  options?: {
    onApplied?: () => void;
    getProfile?: () => UserProfile | null;
    initialDraft?: CosmeticLoadout;
    onDraftChange?: (draft: CosmeticLoadout, isDirty: boolean) => void;
  }
): { cleanup: () => void; render: () => void } {
  let activeSlotTab: CosmeticSlot = "banner";
  let activeLang: LanguageCode = I18nManager.currentLang;
  let equippedLoadout: CosmeticLoadout = getCosmeticLoadout(progressStorage);
  let draftLoadout: CosmeticLoadout = options?.initialDraft ? { ...options.initialDraft } : { ...equippedLoadout };
  let isDirty = false;
  let lastOwner: string | null | undefined = progressStorage?.owner;

  const checkDirty = () => {
    isDirty =
      draftLoadout.banner !== equippedLoadout.banner ||
      draftLoadout.frame !== equippedLoadout.frame ||
      draftLoadout.badge !== equippedLoadout.badge ||
      draftLoadout.badgeFrame !== equippedLoadout.badgeFrame ||
      draftLoadout.title !== equippedLoadout.title ||
      draftLoadout.titleFrame !== equippedLoadout.titleFrame;
    options?.onDraftChange?.(draftLoadout, isDirty);
  };

  checkDirty();

  const render = (): void => {
    // Detect account switch and reset draft
    if (progressStorage?.owner !== lastOwner) {
      lastOwner = progressStorage?.owner;
      equippedLoadout = getCosmeticLoadout(progressStorage);
      draftLoadout = { ...equippedLoadout };
      checkDirty();
    }

    activeLang = I18nManager.currentLang;
    const copy: CosmeticCopyDict = getCosmeticsCopy(activeLang);

    if (!isLocalBannerPreview && !progressStorage.owner) {
      // -------------------------------------------------------------
      // Guest Mode: Read-only Explanation & Plain Banner Preview
      // -------------------------------------------------------------
      container.innerHTML = `
        <div class="cosmetics-panel-container">
          <div class="cosmetics-preview-section">
            <div class="cosmetics-preview-header">
              <span class="cosmetics-preview-title">
                <span>🎨</span> ${escapeHtml(copy.previewHeading)}
              </span>
              <span class="cosmetics-draft-chip" style="background:#334155; color:#94a3b8; border-color:#475569;">
                ${escapeHtml(copy.guestBadge)}
              </span>
            </div>
            <div class="cosmetics-banner-card" data-bg="plain" data-has-badge="false">
              <div class="cosmetics-layer-bg"></div>
              <div class="cosmetics-layer-content" style="left:12%;">
                <div class="cosmetics-player-name">${escapeHtml(options?.getProfile?.()?.nickname || copy.guestBadge)}</div>
              </div>
            </div>
          </div>
          <div style="font-size:13px; color:#94a3b8; text-align:center; line-height:1.6; padding:8px; word-break:keep-all; background:#0f172a; border-radius:10px; border:1px solid #334155;">
            ${escapeHtml(copy.guestNotice)}
          </div>
        </div>
      `;
      return;
    }

    // -------------------------------------------------------------
    // Member Mode: Full 6-Slot Interactive Customizer
    // -------------------------------------------------------------
    const profile = options?.getProfile?.();
    const nickname = profile?.id === progressStorage.owner ? profile.nickname : copy.previewHeading;
    const detail = profile?.id === progressStorage.owner ? formatTier(profile.classicMmr) : copy.previewSubheading;

    container.innerHTML = `
      <div class="cosmetics-panel-container">
        <!-- 1. Live Top Preview Card -->
        <div class="cosmetics-preview-section">
          <div class="cosmetics-preview-header">
            <span class="cosmetics-preview-title">
              <span>🎨</span> ${escapeHtml(copy.previewHeading)}
            </span>
            <div style="display:flex; gap:6px; align-items:center;">
              ${isLocalBannerPreview ? `<span class="cosmetics-dev-chip">${escapeHtml(copy.devPreviewBadge)}</span>` : ""}
              ${isDirty ? `<span class="cosmetics-draft-chip">${escapeHtml(copy.draftBadge)}</span>` : ""}
            </div>
          </div>

          <div class="player-banner cosmetics-live-card" id="cosmetics-live-card">
            <div class="player-banner-text">
              <strong class="player-banner-name">${escapeHtml(nickname)}</strong>
              <span class="player-banner-detail">${escapeHtml(detail)}</span>
            </div>
          </div>

          <!-- Action Bar (Apply / Reset) -->
          <div class="cosmetics-action-bar">
            <button type="button" class="cosmetics-btn-cancel" id="cosmetics-btn-cancel" ${!isDirty ? "disabled" : ""}>
              ${escapeHtml(copy.cancelBtn)}
            </button>
            <button type="button" class="cosmetics-btn-apply" id="cosmetics-btn-apply" ${!isDirty ? "disabled" : ""}>
              ${escapeHtml(copy.applyBtn)}
            </button>
          </div>
        </div>

        <!-- 2. 6-Slot Category Navigation -->
        <div class="cosmetics-slot-nav" role="tablist" aria-label="${escapeHtml(copy.tabTitle)}">
          ${COSMETIC_SLOTS.map((slot) => {
            const isTabActive = activeSlotTab === slot;
            return `
              <button
                type="button"
                role="tab"
                class="cosmetics-slot-tab-btn ${isTabActive ? "active" : ""}"
                data-slot-tab="${escapeHtml(slot)}"
                aria-selected="${isTabActive ? "true" : "false"}"
              >
                ${escapeHtml(copy.slots[slot])}
              </button>
            `;
          }).join("")}
        </div>

        <!-- 3. Slot Options List -->
        <div class="cosmetics-slot-content">
          <p class="cosmetics-slot-desc">${escapeHtml(copy.slotDescriptions[activeSlotTab])}</p>
          ${renderSlotOptions(activeSlotTab, draftLoadout, copy)}
        </div>

        <!-- 4. Storage & Retry Status -->
        ${
          progressStorage?.cosmeticsPending || progressStorage?.masteryPending || progressStorage?.bannersPending || progressStorage?.saveFailed
            ? `
            <div style="display:flex; align-items:center; justify-content:space-between; background:#1e1b2e; border:1px solid #6b21a8; padding:8px 12px; border-radius:8px;">
              <span style="font-size:12px; color:${progressStorage.saveFailed ? "#f87171" : "#c084fc"};">
                ${escapeHtml(progressStorage.status || "Syncing...")}
              </span>
              <button type="button" id="cosmetics-retry-btn" style="background:#7c3aed; color:white; border:none; border-radius:6px; padding:4px 10px; font-size:11px; font-weight:700; cursor:pointer;">
                ${escapeHtml(copy.retryBtn)}
              </button>
            </div>
          `
            : ""
        }

        <!-- 5. Hint & Dev Warning -->
        <div style="font-size:12px; color:#64748b; text-align:center;">
          ${isLocalBannerPreview ? escapeHtml(copy.devPreviewNotice) : escapeHtml(copy.tabHint)}
        </div>
      </div>
    `;

    const previewCard = container.querySelector<HTMLElement>('#cosmetics-live-card');
    if (previewCard) applyCosmeticAppearance(previewCard, draftLoadout);
    bindEvents();
  };

  const renderSlotOptions = (
    slot: CosmeticSlot,
    draft: CosmeticLoadout,
    copy: CosmeticCopyDict
  ): string => {
    const rawOptions = COSMETIC_OPTIONS[slot];
    const canBeNone = slot !== "banner";
    const selectedId = slot === "banner" ? draft.banner : draft[slot];

    let optionsHtml = "";

    // "None / Disabled" option for optional slots
    if (canBeNone) {
      const isNoneSelected = selectedId === null;
      optionsHtml += `
        <button
          type="button"
          class="cosmetics-option-card ${isNoneSelected ? "selected" : ""}"
          data-slot="${escapeHtml(slot)}"
          data-id="none"
          aria-pressed="${isNoneSelected ? "true" : "false"}"
        >
          <div class="cosmetics-option-left">
            <div class="cosmetics-option-thumb">✕</div>
            <div class="cosmetics-option-info">
              <span class="cosmetics-option-name">${escapeHtml(copy.none)}</span>
            </div>
          </div>
          ${isNoneSelected ? `<span class="cosmetics-option-badge cosmetics-badge-equipped">${escapeHtml(copy.equippedBadge)} ✓</span>` : ""}
        </button>
      `;
    }

    // List regular slot options
    optionsHtml += rawOptions
      .map((optId) => {
        const isOwned = ownsCosmetic(progressStorage, slot, optId);
        const isSelected = selectedId === optId;
        const optName = copy.options[optId] || optId;
        const optCond = copy.optionConditions[optId] || "";

        let thumbHtml = "";
        if (slot === "banner") {
          const imgSrc = bannerImageUrl(optId as BannerTheme);
          thumbHtml = `<img src="${escapeHtml(imgSrc)}" alt="" loading="lazy" />`;
        } else if (slot === "badge") {
          const badgeImg = getCosmeticBadgeImage(optId);
          if (badgeImg) {
            thumbHtml = `<img class="cosmetics-badge-thumb" src="${escapeHtml(badgeImg)}" alt="" loading="lazy" /><span style="display:none;">${BADGE_GLYPHS[optId] || "♟"}</span>`;
          } else {
            thumbHtml = `<span>${BADGE_GLYPHS[optId] || "♟"}</span>`;
          }
        } else if (slot === "frame") {
          thumbHtml = optId.includes("gold") ? "🖼️" : "👑";
        } else if (slot === "badgeFrame" || slot === "titleFrame") {
          thumbHtml = optId.includes("gold") ? "🟡" : optId.includes("silver") ? "⚪" : "🟣";
        } else if (slot === "title") {
          thumbHtml = "🏷️";
        }

        if (isOwned) {
          return `
            <button
              type="button"
              class="cosmetics-option-card ${isSelected ? "selected" : ""}"
              data-slot="${escapeHtml(slot)}"
              data-id="${escapeHtml(optId)}"
              aria-pressed="${isSelected ? "true" : "false"}"
            >
              <div class="cosmetics-option-left">
                <div class="cosmetics-option-thumb">${thumbHtml}</div>
                <div class="cosmetics-option-info">
                  <span class="cosmetics-option-name">${escapeHtml(optName)}</span>
                  <span class="cosmetics-option-cond">${escapeHtml(optCond)}</span>
                </div>
              </div>
              ${isSelected ? `<span class="cosmetics-option-badge cosmetics-badge-equipped">${escapeHtml(copy.equippedBadge)} ✓</span>` : ""}
            </button>
          `;
        }

        // Locked option
        return `
          <div class="cosmetics-option-card locked" data-slot="${escapeHtml(slot)}" aria-disabled="true">
            <div class="cosmetics-option-left">
              <div class="cosmetics-option-thumb">${thumbHtml || "🔒"}</div>
              <div class="cosmetics-option-info">
                <span class="cosmetics-option-name">${escapeHtml(optName)}</span>
                <span class="cosmetics-option-cond">${escapeHtml(optCond)}</span>
              </div>
            </div>
            <span class="cosmetics-option-badge cosmetics-badge-locked">${escapeHtml(copy.lockedBadge)}</span>
          </div>
        `;
      })
      .join("");

    let hintHtml = "";
    if (slot === "badgeFrame") {
      hintHtml = `<p class="cosmetics-slot-hint">ℹ️ ${escapeHtml(copy.badgeFrameHint)}</p>`;
    } else if (slot === "titleFrame") {
      hintHtml = `<p class="cosmetics-slot-hint">ℹ️ ${escapeHtml(copy.titleFrameHint)}</p>`;
    }
    if ((slot === 'title' || slot === 'titleFrame') && draft.title) {
      hintHtml += `<div class="cosmetics-title-detail"><span class="cosmetics-title-sample" data-frame="${escapeHtml(draft.titleFrame?.split(':').at(-1) || 'none')}">${escapeHtml(copy.options[draft.title] || '')}</span></div>`;
    }

    return `
      <div class="cosmetics-options-grid">
        ${optionsHtml}
      </div>
      ${hintHtml}
    `;
  };

  const bindEvents = (): void => {
    container.querySelectorAll<HTMLImageElement>('.cosmetics-badge-thumb').forEach(img => {
      const showFallback = () => {
        img.style.display = 'none';
        const fallback = img.nextElementSibling as HTMLElement | null;
        if (fallback) fallback.style.display = 'inline';
      };
      img.addEventListener('error', showFallback, { once: true });
      if (img.complete && img.naturalWidth === 0) showFallback();
    });
    // 1. Slot category navigation tabs
    container.querySelectorAll<HTMLButtonElement>(".cosmetics-slot-tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const slot = btn.dataset.slotTab as CosmeticSlot;
        if (slot && COSMETIC_SLOTS.includes(slot)) {
          activeSlotTab = slot;
          render();
        }
      });
    });

    // 2. Option selection cards
    container.querySelectorAll<HTMLButtonElement>(".cosmetics-option-card:not(.locked)").forEach((btn) => {
      btn.addEventListener("click", () => {
        const slot = btn.dataset.slot as CosmeticSlot;
        const id = btn.dataset.id;
        if (!slot || !id) return;

        const targetValue = id === "none" ? null : id;
        if (slot === "banner") {
          draftLoadout.banner = (targetValue || "classic") as BannerAppearance;
        } else {
          draftLoadout[slot] = targetValue;
        }

        checkDirty();
        render();
      });
    });

    // 3. Apply action button
    container.querySelector<HTMLButtonElement>("#cosmetics-btn-apply")?.addEventListener("click", () => {
      if (!isDirty) return;
      const success = equipCosmeticLoadout(progressStorage, draftLoadout);
      if (success) {
        equippedLoadout = { ...draftLoadout };
        checkDirty();
        render();
        options?.onApplied?.();
      }
    });

    // 4. Cancel / Reset draft button
    container.querySelector<HTMLButtonElement>("#cosmetics-btn-cancel")?.addEventListener("click", () => {
      if (!isDirty) return;
      draftLoadout = { ...equippedLoadout };
      checkDirty();
      render();
    });

    // 5. Storage retry button
    container.querySelector<HTMLButtonElement>("#cosmetics-retry-btn")?.addEventListener("click", () => {
      void progressStorage?.retry?.();
    });
  };

  const unsubProgress = progressStorage.subscribe(() => {
    if (lastOwner !== progressStorage.owner) {
      lastOwner = progressStorage.owner;
      equippedLoadout = getCosmeticLoadout(progressStorage);
      draftLoadout = { ...equippedLoadout };
      checkDirty();
    } else if (!isDirty) {
      equippedLoadout = getCosmeticLoadout(progressStorage);
      draftLoadout = { ...equippedLoadout };
    }
    render();
  });
  const unsubLanguage = I18nManager.subscribe(render);
  render();

  return {
    cleanup: () => {
      unsubProgress(); unsubLanguage();
      container.innerHTML = "";
    },
    render,
  };
}
