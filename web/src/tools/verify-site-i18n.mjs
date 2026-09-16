import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  SUPPORTED_LANGUAGES,
  SITE_NAV_TRANSLATIONS,
  ABOUT_TRANSLATIONS,
  GUIDE_TRANSLATIONS,
  TIERS_TRANSLATIONS,
  UPDATES_TRANSLATIONS,
} from "../site-text.ts";

console.log("=== Checking Public Informational Pages i18n ===");

const expectedLangs = ["ko", "en", "ja", "zh-CN", "de", "fr", "es", "ru", "pt-BR"];

// 1. Check supported languages
if (SUPPORTED_LANGUAGES.length !== 9) {
  throw new Error(`Expected 9 supported languages, got ${SUPPORTED_LANGUAGES.length}`);
}

for (const lang of expectedLangs) {
  if (!SUPPORTED_LANGUAGES.some(l => l.code === lang)) {
    throw new Error(`Missing language code: ${lang}`);
  }
}

// 2. Check site-text dictionary coverage
for (const lang of expectedLangs) {
  const nav = SITE_NAV_TRANSLATIONS[lang];
  if (!nav || !nav.brand || !nav.navPlay || !nav.navAbout || !nav.navGuide || !nav.navTiers || !nav.navUpdates) {
    throw new Error(`Incomplete nav text for ${lang}`);
  }

  const about = ABOUT_TRANSLATIONS[lang];
  if (!about || !about.title || !about.h1 || !about.lead || about.sec2Items.length !== 4) {
    throw new Error(`Incomplete about text for ${lang}`);
  }

  const guide = GUIDE_TRANSLATIONS[lang];
  if (!guide || !guide.title || !guide.h1 || guide.sec1Steps.length !== 4 || guide.sec5Items.length !== 4) {
    throw new Error(`Incomplete guide text for ${lang}`);
  }

  const tiers = TIERS_TRANSLATIONS[lang];
  if (!tiers || !tiers.title || !tiers.h1 || tiers.tiers.length !== 6) {
    throw new Error(`Incomplete tiers text for ${lang}`);
  }

  const updates = UPDATES_TRANSLATIONS[lang];
  if (!updates || !updates.title || !updates.h1 || updates.entries.length !== 4) {
    throw new Error(`Incomplete updates text for ${lang}`);
  }
}
console.log("✓ All 9 languages thoroughly verified in site-text.ts");

// 3. Check public static HTML files
const privacyHtml = readFileSync(resolve("public/privacy.html"), "utf-8");
const deleteAccountHtml = readFileSync(resolve("public/delete-account.html"), "utf-8");

for (const lang of expectedLangs) {
  if (!privacyHtml.includes(`value="${lang}"`)) {
    throw new Error(`privacy.html missing selector option for ${lang}`);
  }
  if (!deleteAccountHtml.includes(`value="${lang}"`)) {
    throw new Error(`delete-account.html missing selector option for ${lang}`);
  }
}

// Verify localStorage app_language key usage
if (!privacyHtml.includes("app_language") || !deleteAccountHtml.includes("app_language")) {
  throw new Error("Missing localStorage app_language key in static pages");
}

console.log("✓ public/privacy.html & public/delete-account.html 9-language verified");
console.log("=== All Public Informational Pages i18n checks PASSED! ===");
