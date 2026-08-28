// Existing i18n initializes at import time. Supply only its browser dependencies;
// these checks do not pretend to run a browser or change production i18n code.
export class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}
globalThis.localStorage = new MemoryStorage();
globalThis.localStorage.setItem("app_language", "ko");
const hudElements = new Set();
globalThis.document = Object.assign(new EventTarget(), {
  documentElement: { lang: "ko" }, hidden: false,
  // online-check exercises network/physics; its new ping HUD only needs these
  // three operations. Unsupported DOM operations still fail explicitly.
  createElement(tag) {
    if (tag !== "div") throw new Error(`Headless HUD does not implement <${tag}>`);
    return { style: {}, className: "", innerHTML: "", remove() { hudElements.delete(this); } };
  },
  body: { appendChild(element) { hudElements.add(element); return element; } },
});
globalThis.window = Object.assign(new EventTarget(), { localStorage, performance, setInterval, clearInterval, setTimeout, clearTimeout });
