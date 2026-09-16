import { showContentAd } from "./web-ads";
import {
  type LanguageCode,
  SUPPORTED_LANGUAGES,
  SITE_NAV_TRANSLATIONS,
  ABOUT_TRANSLATIONS,
  GUIDE_TRANSLATIONS,
  TIERS_TRANSLATIONS,
  UPDATES_TRANSLATIONS,
} from "./site-text";

function detectLanguage(): LanguageCode {
  try {
    const saved = localStorage.getItem("app_language") as LanguageCode | null;
    if (saved && SUPPORTED_LANGUAGES.some((l) => l.code === saved)) {
      return saved;
    }
  } catch {
    // Ignore localStorage access errors
  }

  const browserLangs =
    Array.isArray(navigator.languages) && navigator.languages.length > 0
      ? navigator.languages
      : [navigator.language || ""];

  for (const rawLang of browserLangs) {
    if (!rawLang) continue;
    const lower = rawLang.toLowerCase();
    const code = lower.split("-")[0];

    if (code === "ko") return "ko";
    if (code === "ja") return "ja";
    if (code === "zh" || lower.includes("zh")) return "zh-CN";
    if (code === "de") return "de";
    if (code === "fr") return "fr";
    if (code === "es") return "es";
    if (code === "ru") return "ru";
    if (code === "pt" || lower.includes("pt")) return "pt-BR";
    if (code === "en") return "en";
  }

  return "en";
}

let currentLang: LanguageCode = detectLanguage();

function saveLanguage(lang: LanguageCode): void {
  currentLang = lang;
  try {
    localStorage.setItem("app_language", lang);
  } catch {
    // Ignore localStorage write errors
  }
  document.documentElement.lang = lang;
  renderCurrentPage();
}

function renderHeaderAndFooter(): void {
  const navText = SITE_NAV_TRANSLATIONS[currentLang] || SITE_NAV_TRANSLATIONS.ko;

  document.querySelector("header nav")?.setAttribute("aria-label", navText.brand);
  document.querySelector("[data-display-ad]")?.setAttribute("aria-label", navText.adLabel);

  // Skip link
  const skipLink = document.querySelector<HTMLAnchorElement>(".skip-link");
  if (skipLink) {
    skipLink.textContent = navText.skipLink;
  }

  // Brand
  const brand = document.querySelector<HTMLAnchorElement>(".brand");
  if (brand) {
    brand.textContent = navText.brand;
  }

  // Navigation Links
  const navLinks = document.querySelectorAll<HTMLAnchorElement>("header nav a");
  if (navLinks.length >= 5) {
    navLinks[0].textContent = navText.navPlay;
    navLinks[1].textContent = navText.navAbout;
    navLinks[2].textContent = navText.navGuide;
    navLinks[3].textContent = navText.navTiers;
    navLinks[4].textContent = navText.navUpdates;
  }

  // Footer Links
  const footerLinks = document.querySelectorAll<HTMLAnchorElement>("footer a");
  if (footerLinks.length >= 3) {
    footerLinks[0].textContent = navText.footerPrivacy;
    footerLinks[1].textContent = navText.footerDeleteAccount;
    footerLinks[2].textContent = navText.footerContact;
  }

  // Language Selector in header
  let langSelect = document.getElementById("site-lang-select") as HTMLSelectElement | null;
  if (!langSelect) {
    const header = document.querySelector("header");
    if (header) {
      const container = document.createElement("div");
      container.className = "site-lang-container";
      container.style.cssText = "display: flex; justify-content: flex-end; align-items: center; margin-bottom: 8px;";

      const select = document.createElement("select");
      select.id = "site-lang-select";
      select.setAttribute("aria-label", navText.langSelectLabel);
      select.style.cssText = "background: #1b1612; color: #ead092; border: 1px solid #54493a; border-radius: 6px; padding: 4px 10px; font-size: 13px; cursor: pointer; outline: none;";

      SUPPORTED_LANGUAGES.forEach((opt) => {
        const option = document.createElement("option");
        option.value = opt.code;
        option.textContent = opt.label;
        select.appendChild(option);
      });

      select.value = currentLang;
      select.addEventListener("change", (e) => {
        const target = e.target as HTMLSelectElement;
        saveLanguage(target.value as LanguageCode);
      });

      container.appendChild(select);
      header.insertBefore(container, header.firstChild);
      langSelect = select;
    }
  } else {
    langSelect.setAttribute("aria-label", navText.langSelectLabel);
    langSelect.value = currentLang;
  }
}

function renderAboutPage(): void {
  const data = ABOUT_TRANSLATIONS[currentLang] || ABOUT_TRANSLATIONS.ko;
  document.title = data.title;
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) metaDesc.setAttribute("content", data.description);

  const main = document.getElementById("content");
  if (!main) return;

  const h1 = main.querySelector("h1");
  if (h1) h1.textContent = data.h1;

  const lead = main.querySelector(".lead");
  if (lead) lead.textContent = data.lead;

  const sections = main.querySelectorAll("section");
  if (sections.length >= 4) {
    // Section 1: 어떤 게임인가요?
    const s1H2 = sections[0].querySelector("h2");
    if (s1H2) s1H2.textContent = data.sec1Title;
    const s1Ps = sections[0].querySelectorAll("p");
    if (s1Ps.length >= 2) {
      s1Ps[0].textContent = data.sec1P1;
      s1Ps[1].textContent = data.sec1P2;
    }

    // Section 2: 플레이 방식
    const s2H2 = sections[1].querySelector("h2");
    if (s2H2) s2H2.textContent = data.sec2Title;
    const s2Lis = sections[1].querySelectorAll("li");
    s2Lis.forEach((li, idx) => {
      if (data.sec2Items[idx]) {
        li.innerHTML = data.sec2Items[idx];
      }
    });

    // Section 3: 계정과 기록
    const s3H2 = sections[2].querySelector("h2");
    if (s3H2) s3H2.textContent = data.sec3Title;
    const s3P = sections[2].querySelector("p");
    if (s3P) s3P.innerHTML = data.sec3P;

    // Section 4: 문의와 오류 제보
    const s4H2 = sections[3].querySelector("h2");
    if (s4H2) s4H2.textContent = data.sec4Title;
    const s4P = sections[3].querySelector("p");
    if (s4P) s4P.innerHTML = data.sec4P;
  }
}

function renderGuidePage(): void {
  const data = GUIDE_TRANSLATIONS[currentLang] || GUIDE_TRANSLATIONS.ko;
  document.title = data.title;
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) metaDesc.setAttribute("content", data.description);

  const main = document.getElementById("content");
  if (!main) return;

  const h1 = main.querySelector("h1");
  if (h1) h1.textContent = data.h1;

  const lead = main.querySelector(".lead");
  if (lead) lead.textContent = data.lead;

  const sections = main.querySelectorAll("section");
  if (sections.length >= 5) {
    // Section 1: 한 번의 발사
    const s1H2 = sections[0].querySelector("h2");
    if (s1H2) s1H2.textContent = data.sec1Title;
    const s1Lis = sections[0].querySelectorAll("ol li");
    s1Lis.forEach((li, idx) => {
      if (data.sec1Steps[idx]) li.textContent = data.sec1Steps[idx];
    });
    const s1P = sections[0].querySelector("p");
    if (s1P) s1P.textContent = data.sec1P;

    // Section 2: 승리와 장외
    const s2H2 = sections[1].querySelector("h2");
    if (s2H2) s2H2.textContent = data.sec2Title;
    const s2Ps = sections[1].querySelectorAll("p");
    if (s2Ps.length >= 2) {
      s2Ps[0].textContent = data.sec2P1;
      s2Ps[1].textContent = data.sec2P2;
    }

    // Section 3: 말을 선택할 때 볼 것
    const s3H2 = sections[2].querySelector("h2");
    if (s3H2) s3H2.textContent = data.sec3Title;
    const s3Ps = sections[2].querySelectorAll("p");
    if (s3Ps.length >= 2) {
      s3Ps[0].textContent = data.sec3P1;
      s3Ps[1].textContent = data.sec3P2;
    }

    // Section 4: 클래식과 전략
    const s4H2 = sections[3].querySelector("h2");
    if (s4H2) s4H2.textContent = data.sec4Title;
    const s4P = sections[3].querySelector("p");
    if (s4P) s4P.textContent = data.sec4P;

    // Section 5: 연습 순서
    const s5H2 = sections[4].querySelector("h2");
    if (s5H2) s5H2.textContent = data.sec5Title;
    const s5Lis = sections[4].querySelectorAll("ul li");
    s5Lis.forEach((li, idx) => {
      if (data.sec5Items[idx]) li.textContent = data.sec5Items[idx];
    });
  }
}

function renderTiersPage(): void {
  const data = TIERS_TRANSLATIONS[currentLang] || TIERS_TRANSLATIONS.ko;
  document.title = data.title;
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) metaDesc.setAttribute("content", data.description);

  const main = document.getElementById("content");
  if (!main) return;

  const h1 = main.querySelector("h1");
  if (h1) h1.textContent = data.h1;

  const lead = main.querySelector(".lead");
  if (lead) lead.textContent = data.lead;

  const sections = main.querySelectorAll("section");
  if (sections.length >= 3) {
    // Section 1: 승급 순서 & 표
    const s1H2 = sections[0].querySelector("h2");
    if (s1H2) s1H2.textContent = data.sec1Title;
    const s1Ps = sections[0].querySelectorAll("p");
    if (s1Ps.length >= 2) {
      s1Ps[0].textContent = data.sec1P1;
      s1Ps[1].textContent = data.sec1P2;
    }

    const caption = sections[0].querySelector("caption");
    if (caption) caption.textContent = data.tableCaption;

    const ths = sections[0].querySelectorAll("th");
    if (ths.length >= 2) {
      ths[0].textContent = data.thTier;
      ths[1].textContent = data.thRange;
    }

    const trs = sections[0].querySelectorAll("tbody tr");
    trs.forEach((tr, idx) => {
      const tds = tr.querySelectorAll("td");
      if (tds.length >= 2 && data.tiers[idx]) {
        tds[0].textContent = data.tiers[idx].tier;
        tds[1].textContent = data.tiers[idx].range;
      }
    });

    // Section 2: 승급과 강등
    const s2H2 = sections[1].querySelector("h2");
    if (s2H2) s2H2.textContent = data.sec2Title;
    const s2Ps = sections[1].querySelectorAll("p");
    if (s2Ps.length >= 2) {
      s2Ps[0].textContent = data.sec2P1;
      s2Ps[1].textContent = data.sec2P2;
    }

    // Section 3: 킹 점수와 랭킹
    const s3H2 = sections[2].querySelector("h2");
    if (s3H2) s3H2.textContent = data.sec3Title;
    const s3Ps = sections[2].querySelectorAll("p");
    if (s3Ps.length >= 2) {
      s3Ps[0].textContent = data.sec3P1;
      s3Ps[1].textContent = data.sec3P2;
    }
  }
}

function renderUpdatesPage(): void {
  const data = UPDATES_TRANSLATIONS[currentLang] || UPDATES_TRANSLATIONS.ko;
  document.title = data.title;
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) metaDesc.setAttribute("content", data.description);

  const main = document.getElementById("content");
  if (!main) return;

  const h1 = main.querySelector("h1");
  if (h1) h1.textContent = data.h1;

  const lead = main.querySelector(".lead");
  if (lead) lead.textContent = data.lead;

  const sections = main.querySelectorAll("section");
  // The first 4 sections are update entries, the last is the help section
  for (let i = 0; i < 4 && i < sections.length; i++) {
    const entry = data.entries[i];
    if (!entry) continue;

    const h2 = sections[i].querySelector("h2");
    if (h2) h2.textContent = entry.dateTitle;

    if (entry.items) {
      const lis = sections[i].querySelectorAll("li");
      lis.forEach((li, lIdx) => {
        if (entry.items && entry.items[lIdx]) {
          li.textContent = entry.items[lIdx];
        }
      });
    }

    if (entry.paragraphs) {
      const p = sections[i].querySelector("p");
      if (p && entry.paragraphs[0]) {
        p.textContent = entry.paragraphs[0];
      }
    }
  }

  if (sections.length >= 5) {
    const helpSec = sections[sections.length - 1];
    const helpH2 = helpSec.querySelector("h2");
    if (helpH2) helpH2.textContent = data.helpTitle;
    const helpP = helpSec.querySelector("p");
    if (helpP) helpP.innerHTML = data.helpP;
  }
}

function renderCurrentPage(): void {
  document.documentElement.lang = currentLang;
  renderHeaderAndFooter();

  const path = window.location.pathname.toLowerCase();
  if (path.includes("about") || document.querySelector("h1")?.textContent?.includes("소개") || document.querySelector("h1")?.textContent?.includes("About")) {
    renderAboutPage();
  } else if (path.includes("guide") || document.querySelector("h1")?.textContent?.includes("조작법") || document.querySelector("h1")?.textContent?.includes("Controls") || document.querySelector("h1")?.textContent?.includes("Guide")) {
    renderGuidePage();
  } else if (path.includes("tiers") || document.querySelector("h1")?.textContent?.includes("티어") || document.querySelector("h1")?.textContent?.includes("Tier") || document.querySelector("h1")?.textContent?.includes("Rang")) {
    renderTiersPage();
  } else if (path.includes("updates") || document.querySelector("h1")?.textContent?.includes("업데이트") || document.querySelector("h1")?.textContent?.includes("Update")) {
    renderUpdatesPage();
  }
}

// Initial render
document.documentElement.lang = currentLang;
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    renderCurrentPage();
  });
} else {
  renderCurrentPage();
}

// Display Ad handler
const placement = document.querySelector<HTMLElement>("[data-display-ad]");
if (placement) void showContentAd(placement).catch(() => { placement.hidden = true; });
