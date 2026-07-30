import {
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "../..");
const outputDirectory = resolve(projectRoot, "dist-portable");
const sourceHtmlPath = resolve(outputDirectory, "index.html");
const portableHtmlPath = resolve(
  outputDirectory,
  "체스알까기_체험판.html",
);

/**
 * 빌드 HTML의 상대 참조가 portable 출력 디렉터리 밖을 가리키지 않는지 확인한다.
 */
function resolveOutputReference(reference) {
  const resolvedPath = resolve(outputDirectory, reference);
  const relativePath = relative(outputDirectory, resolvedPath);
  if (
    relativePath.startsWith("..") ||
    relativePath.includes(":")
  ) {
    throw new Error(
      `portable 빌드 참조가 출력 디렉터리를 벗어났습니다: ${reference}`,
    );
  }
  return resolvedPath;
}

/**
 * HTML 파서가 인라인 코드 안의 닫는 태그 문자열을 실제 태그로 오인하지 않도록 막는다.
 */
function escapeInlineClosingTag(source, tagName) {
  return source.replaceAll(
    new RegExp(`</${tagName}`, "giu"),
    () => `<\\/${tagName}`,
  );
}

/**
 * Vite의 preload 도우미가 남긴 module 메타데이터를 같은 HTML 기준의 일반 스크립트 표현으로 바꾼다.
 */
function convertModuleMetadataForInlineScript(source) {
  return source
    .replaceAll("import.meta.resolve", () => "undefined")
    .replaceAll("import.meta.url", () => "document.baseURI");
}

let html = await readFile(sourceHtmlPath, "utf8");
const scriptMatch = html.match(
  /<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/u,
);
const stylesheetMatch = html.match(
  /<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*>/u,
);
if (scriptMatch === null || stylesheetMatch === null) {
  throw new Error(
    "portable 후처리에 필요한 단일 JS 또는 CSS 참조를 찾지 못했습니다.",
  );
}

const javascriptPath = resolveOutputReference(scriptMatch[1]);
const stylesheetPath = resolveOutputReference(stylesheetMatch[1]);
const [javascript, stylesheet] = await Promise.all([
  readFile(javascriptPath, "utf8"),
  readFile(stylesheetPath, "utf8"),
]);
const inlineJavascript =
  convertModuleMetadataForInlineScript(javascript);
const inlineScriptTag =
  `<script>${escapeInlineClosingTag(inlineJavascript, "script")}</script>`;

html = html.replace(
  scriptMatch[0],
  // head의 module 태그 자리에서는 제거해 classic 스크립트가 #app보다 먼저 실행되지 않게 한다.
  () => "",
);
html = html.replace(
  stylesheetMatch[0],
  // CSS도 같은 조립 규칙을 적용해 이후 생성기에 $ 패턴이 생겨도 안전하게 유지한다.
  () => `<style>${escapeInlineClosingTag(stylesheet, "style")}</style>`,
);
const closingBodyIndex = html.lastIndexOf("</body>");
if (closingBodyIndex < 0) {
  throw new Error(
    "portable 인라인 게임 스크립트를 배치할 </body>를 찾지 못했습니다.",
  );
}
// module의 지연 실행과 같은 순서를 보장하도록 모든 body 마크업 뒤에 게임 코드를 둔다.
html =
  `${html.slice(0, closingBodyIndex)}${inlineScriptTag}\n` +
  html.slice(closingBodyIndex);

// Vite 중간 청크를 지우고 완성된 HTML 하나만 남겨 비개발자 전달 실수를 방지한다.
for (const entry of await readdir(outputDirectory, {
  withFileTypes: true,
})) {
  if (entry.name === "index.html") {
    continue;
  }
  await rm(resolve(outputDirectory, entry.name), {
    recursive: true,
    force: true,
  });
}
await writeFile(sourceHtmlPath, html, "utf8");
await rename(sourceHtmlPath, portableHtmlPath);

console.log(
  `[portable] ${portableHtmlPath} 단일 파일 생성을 완료했습니다.`,
);
