import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const vite = await createServer({
  root: fileURLToPath(new URL("../..", import.meta.url)),
  configFile: false,
  logLevel: "error",
  server: { middlewareMode: true, hmr: false },
});

const originalFetch = globalThis.fetch;
const originalLoadAsync = GLTFLoader.prototype.loadAsync;
const originalDocument = globalThis.document;
const originalWindow = globalThis.window;
const originalConsoleError = console.error;

try {
  const { StartupFailure, startupFailureKind } = await vite.ssrLoadModule("/src/startup-failure.ts");
  const { loadChessAssets } = await vite.ssrLoadModule("/src/assets.ts");
  const { createSceneRuntime } = await vite.ssrLoadModule("/src/scene.ts");
  const { showStartupError } = await vite.ssrLoadModule("/src/startup-error.ts");

  assert.equal(startupFailureKind(new StartupFailure("graphics", new Error("context unavailable"))), "graphics");
  assert.equal(startupFailureKind(new TypeError("Failed to fetch dynamically imported module: main.js")), "download");
  assert.equal(startupFailureKind(new Error("physics invariant failed")), "unknown");

  GLTFLoader.prototype.loadAsync = async () => ({ scene: { traverse() {} } });
  globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
  await assert.rejects(loadChessAssets(), error => startupFailureKind(error) === "download");

  globalThis.fetch = async () => ({ ok: false, status: 404, statusText: "Not Found" });
  await assert.rejects(loadChessAssets(), error => startupFailureKind(error) === "download");

  globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });
  GLTFLoader.prototype.loadAsync = async () => { throw new Error('fetch for "piece.glb" responded with 404: Not Found'); };
  await assert.rejects(loadChessAssets(), error => startupFailureKind(error) === "download");

  GLTFLoader.prototype.loadAsync = async () => { throw new SyntaxError("invalid GLB data"); };
  await assert.rejects(loadChessAssets(), error => startupFailureKind(error) === "unknown");

  GLTFLoader.prototype.loadAsync = async () => ({ scene: { traverse() {} } });
  globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });
  await assert.rejects(loadChessAssets(), error => startupFailureKind(error) === "unknown");

  // Renderer creation fails before any game canvas is appended: no probe context is allocated.
  globalThis.document = { createElementNS: () => ({ style: {}, addEventListener() {}, getContext: () => null }) };
  console.error = () => {};
  assert.throws(() => createSceneRuntime({}, {}, [], 1), error => startupFailureKind(error) === "graphics");

  const app = { replaceChildren(node) { this.child = node; } };
  const element = tag => ({ tag, children: [], setAttribute() {}, append(...nodes) { this.children.push(...nodes); }, addEventListener(_name, handler) { this.click = handler; }, focus() { this.focused = true; } });
  let reloads = 0;
  globalThis.document = { documentElement: { lang: "en" }, querySelector: () => app, createElement: element };
  globalThis.window = { location: { reload: () => reloads++ } };
  showStartupError(new StartupFailure("graphics", new Error("sensitive driver details")));
  const [heading, help, retry] = app.child.children[0].children;
  assert.match(heading.textContent, /graphics/i);
  assert.match(help.textContent, /WebGL/i);
  assert.equal(app.child.children[0].children.length, 3);
  assert.equal(retry.focused, true);
  retry.click();
  assert.equal(reloads, 1);
  assert.doesNotMatch(JSON.stringify(app.child), /sensitive driver details/);
  globalThis.document.documentElement.lang = "ko";
  showStartupError(new StartupFailure("download", new Error("private download URL")));
  assert.match(app.child.children[0].children[0].textContent, /게임 파일/);
  assert.doesNotMatch(JSON.stringify(app.child), /private download URL/);
  console.log("Startup graphics, download, unknown, localized screen, and retry checks passed.");
} finally {
  globalThis.fetch = originalFetch;
  GLTFLoader.prototype.loadAsync = originalLoadAsync;
  globalThis.document = originalDocument;
  globalThis.window = originalWindow;
  console.error = originalConsoleError;
  await vite.close();
}
