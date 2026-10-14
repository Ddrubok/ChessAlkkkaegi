import { init } from "./poki-sdk";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear() { values.clear(); },
    getItem(key) { return values.get(String(key)) ?? null; },
    key(index) { return [...values.keys()][index] ?? null; },
    removeItem(key) { values.delete(String(key)); },
    setItem(key, value) { values.set(String(key), String(value)); },
  };
}

for (const name of ["localStorage", "sessionStorage"] as const) {
  try {
    const storage = window[name];
    const key = "__poki_storage_probe__";
    const previous = storage.getItem(key);
    storage.setItem(key, "1");
    if (storage.getItem(key) !== "1") throw new Error("Storage unavailable");
    storage.removeItem(key);
    if (previous !== null) storage.setItem(key, previous);
  } catch {
    Object.defineProperty(window, name, { configurable: true, value: memoryStorage() });
  }
}

window.addEventListener("keydown", (event) => {
  if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])")) return;
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();
});
window.addEventListener("wheel", (event) => {
  for (let element = event.target instanceof Element ? event.target : null; element && element !== document.body; element = element.parentElement) {
    const style = getComputedStyle(element);
    const vertical = /auto|scroll/u.test(style.overflowY) &&
      (event.deltaY < 0 ? element.scrollTop > 0 : event.deltaY > 0 && element.scrollTop + element.clientHeight < element.scrollHeight - 1);
    const horizontal = /auto|scroll/u.test(style.overflowX) &&
      (event.deltaX < 0 ? element.scrollLeft > 0 : event.deltaX > 0 && element.scrollLeft + element.clientWidth < element.scrollWidth - 1);
    if (vertical || horizontal) return;
  }
  event.preventDefault();
}, { passive: false });

await init();
await import("./main");
