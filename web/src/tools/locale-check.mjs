import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const trees = [
  path.resolve(import.meta.dirname, "../.."),
  ...process.argv.slice(2).map(tree => path.resolve(tree)),
];
let caseNumber = 0;

for (const tree of trees) {
  const source = tree === trees[0] && process.env.LOCALE_CHECK_SOURCE
    ? path.resolve(process.env.LOCALE_CHECK_SOURCE)
    : path.join(tree, "src/i18n.ts");
  if (!fs.existsSync(source)) continue;
  const load = async (saved, browser = "ko-KR", blocked = false) => {
    let writes = 0;
    globalThis.document = { documentElement: { lang: "" } };
    Object.defineProperty(globalThis, "navigator", {
      configurable: true, value: { languages: [browser], language: browser },
    });
    globalThis.localStorage = {
      getItem: () => { if (blocked) throw Error("blocked"); return saved; },
      setItem: () => { writes++; },
    };
    const module = await import(`${pathToFileURL(source)}?locale-check=${caseNumber++}`);
    return { ...module, writes: () => writes };
  };
  const normalize = (await load(null)).normalizeLanguage;
  for (const [raw, expected] of Object.entries({
    "ja-JP": "ja", "ko-KR": "ko", "fr-FR": "fr", "fr-CA": "fr",
    "en-US": "en", "de-DE": "de", "es-ES": "es", "ru-RU": "ru",
    "pt-BR": "pt-BR", "zh-CN": "zh-CN", "zh-Hans": "zh-CN",
  })) assert.equal(normalize(raw), expected, `${tree}: ${raw}`);
  for (const raw of ["zh", "zh-TW", "zh-Hant", "zh-HK", "pt-PT", "it-IT", null, ""]) {
    assert.equal(normalize(raw), null, `${tree}: ${raw}`);
  }
  const first = await load(null);
  first.I18nManager.init(normalize("ja-JP") || "en");
  assert.equal(first.I18nManager.getLanguage(), "ja");
  assert.equal(first.writes(), 0);
  const saved = await load("fr");
  saved.I18nManager.init("ja");
  assert.equal(saved.I18nManager.getLanguage(), "fr");
  const invalid = await load("invalid");
  invalid.I18nManager.init("en");
  assert.equal(invalid.I18nManager.getLanguage(), "en");
  const blocked = await load(null, "ko-KR", true);
  blocked.I18nManager.init("en");
  assert.equal(blocked.I18nManager.getLanguage(), "en");
  assert.equal((await load(null, "ja-JP")).I18nManager.getLanguage(), "ja");
  assert.equal((await load(null, "zh-TW")).I18nManager.getLanguage(), "zh-CN");
  assert.equal((await load(null, "pt-PT")).I18nManager.getLanguage(), "pt-BR");
  console.log(`locale-check passed: ${tree}`);
}
