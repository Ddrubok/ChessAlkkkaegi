import { spawnSync } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "../..");
const portableDirectory = resolve(projectRoot, "dist-portable");
const portableFilename = "체스알까기_체험판.html";
const portableHtmlPath = resolve(
  portableDirectory,
  portableFilename,
);
const normalHtmlPath = resolve(projectRoot, "dist/index.html");
const maximumPortableBytes = 12 * 1024 * 1024;

const embeddedAssets = [
  {
    label: "GLB",
    path: "public/assets/chess-pieces.glb",
    mimeType: "model/gltf-binary",
  },
  {
    label: "meta JSON",
    path: "public/assets/chess-set.meta.json",
    mimeType: "application/json",
  },
  {
    label: "BGM",
    path: "public/assets/sound/bgm1.mp3",
    mimeType: "audio/mpeg",
  },
  {
    label: "button",
    path: "public/assets/sound/buttonclick_sound.mp3",
    mimeType: "audio/mpeg",
  },
  {
    label: "piece hit",
    path: "public/assets/sound/hit_sound.mp3",
    mimeType: "audio/mpeg",
  },
  {
    label: "wood hit",
    path: "public/assets/sound/wood_hit_sound.mp3",
    mimeType: "audio/mpeg",
  },
  {
    label: "rock hit",
    path: "public/assets/sound/rock_hit_sound.mp3",
    mimeType: "audio/mpeg",
  },
  {
    label: "iron hit",
    path: "public/assets/sound/iron_hit_sound.mp3",
    mimeType: "audio/mpeg",
  },
  {
    label: "power 10",
    path: "public/assets/sound/power_10.mp3",
    mimeType: "audio/mpeg",
  },
  {
    label: "power 50",
    path: "public/assets/sound/power_50.mp3",
    mimeType: "audio/mpeg",
  },
  {
    label: "power 90",
    path: "public/assets/sound/power_90.mp3",
    mimeType: "audio/mpeg",
  },
];

/**
 * 검사 실패를 어느 portable 불변식에서 났는지 바로 알 수 있게 중단한다.
 */
function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * portable 출력 아래 실제 파일을 재귀적으로 모아 단일 파일 조건을 확인한다.
 */
async function collectFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, {
    withFileTypes: true,
  })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

const [portableHtml, normalHtml, portableInfo, outputFiles] =
  await Promise.all([
    readFile(portableHtmlPath, "utf8"),
    readFile(normalHtmlPath, "utf8"),
    stat(portableHtmlPath),
    collectFiles(portableDirectory),
  ]);

assertCondition(
  outputFiles.length === 1 &&
    relative(portableDirectory, outputFiles[0]) === portableFilename,
  `portable 출력이 단일 파일이 아닙니다: ${outputFiles.map((path) => relative(portableDirectory, path)).join(", ")}`,
);
assertCondition(
  portableInfo.size < maximumPortableBytes,
  `portable HTML이 12MB 상한을 넘었습니다: ${portableInfo.size} bytes`,
);
assertCondition(
  !/<(?:script|link|img|audio|source)\b[^>]*(?:src|href)=["'](?!data:|#)([^"']+)["']/iu.test(
    portableHtml,
  ),
  "portable HTML에 외부 src 또는 href 참조가 남았습니다.",
);
assertCondition(
  !/<script\b[^>]*\btype=["']module["']/iu.test(portableHtml) &&
    !portableHtml.includes("import.meta"),
  "file:// 실행을 막는 module 스크립트 문법이 남았습니다.",
);

// 조립 과정의 replacement 패턴 손상을 실제 스크립트 파서로 검출한다.
const inlineScriptMatches = [
  ...portableHtml.matchAll(
    /<script\b[^>]*>([\s\S]*?)<\/script>/gu,
  ),
];
assertCondition(
  inlineScriptMatches.length === 1,
  `portable HTML의 인라인 스크립트가 1개가 아닙니다: ${inlineScriptMatches.length}`,
);
const inlineJavascript = inlineScriptMatches[0][1];
const inlineScriptOffset = inlineScriptMatches[0].index ?? -1;
const appStartMatch = portableHtml.match(
  /<main\b[^>]*\bid=["']app["'][^>]*>/u,
);
const appClosingOffset =
  appStartMatch === null
    ? -1
    : portableHtml.indexOf(
        "</main>",
        (appStartMatch.index ?? 0) + appStartMatch[0].length,
      );
const closingBodyOffset = portableHtml.lastIndexOf("</body>");
assertCondition(
  appStartMatch !== null &&
    appClosingOffset >= 0 &&
    inlineScriptOffset > appClosingOffset &&
    inlineScriptOffset < closingBodyOffset,
  `portable 게임 스크립트 실행 순서가 잘못됐습니다: appEnd=${appClosingOffset}, script=${inlineScriptOffset}, bodyEnd=${closingBodyOffset}`,
);
const syntaxCheck = spawnSync(
  process.execPath,
  ["--check", "-"],
  {
    input: inlineJavascript,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  },
);
const syntaxError = [
  syntaxCheck.error?.message,
  syntaxCheck.stderr,
]
  .filter((value) => typeof value === "string" && value.length > 0)
  .join("\n")
  .slice(-2000);
assertCondition(
  syntaxCheck.status === 0,
  `portable 인라인 JS node --check 실패: ${syntaxError}`,
);

// 정적 로딩 화면을 넘기는 bootstrap 단계 문자열이 번들 조립 뒤에도 온전히 남아 있어야 한다.
const bootstrapMarkers = [
  "ChessAlkkagi 에셋을 불러오는 중입니다",
  "물리 월드를 준비하는 중입니다",
  "말의 시작 자세를 안정시키는 중입니다",
];
for (const marker of bootstrapMarkers) {
  assertCondition(
    inlineJavascript.includes(marker),
    `portable 인라인 JS에서 bootstrap 표식이 손상됐습니다: ${marker}`,
  );
}

const roundTripLabels = [];
for (const asset of embeddedAssets) {
  const sourceBytes = await readFile(resolve(projectRoot, asset.path));
  const dataUri =
    `data:${asset.mimeType};base64,${sourceBytes.toString("base64")}`;
  const dataUriIndex = portableHtml.indexOf(dataUri);
  assertCondition(
    dataUriIndex >= 0,
    `${asset.label} data URI가 portable HTML에 없습니다.`,
  );
  const encodedStart =
    dataUriIndex + `data:${asset.mimeType};base64,`.length;
  const encodedEnd = encodedStart + sourceBytes.toString("base64").length;
  const decodedBytes = Buffer.from(
    portableHtml.slice(encodedStart, encodedEnd),
    "base64",
  );
  assertCondition(
    decodedBytes.equals(sourceBytes),
    `${asset.label} data URI가 원본 바이트와 다릅니다.`,
  );
  roundTripLabels.push(`${asset.label}:${sourceBytes.length}`);
}

// 모든 런타임 자산의 상대 경로가 남지 않았는지 확인해 file:// fetch 회귀를 막는다.
for (const asset of embeddedAssets) {
  const assetPath = asset.path.replace(/^public\//u, "");
  assertCondition(
    !portableHtml.includes(assetPath),
    `portable 런타임에 상대 자산 경로가 남았습니다: ${assetPath}`,
  );
}

const normalScriptMatch = normalHtml.match(
  /<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"[^>]*><\/script>/u,
);
const normalStylesheetMatch = normalHtml.match(
  /<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*>/u,
);
assertCondition(
  normalScriptMatch !== null &&
    normalStylesheetMatch !== null &&
    !normalHtml.includes("data:model/gltf-binary") &&
    !normalHtml.includes("data:audio/mpeg"),
  "정상 index.html의 외부 module/CSS 구조가 바뀌었거나 data URI가 섞였습니다.",
);
const normalJavascript = await readFile(
  resolve(projectRoot, "dist", normalScriptMatch[1]),
  "utf8",
);
assertCondition(
  !normalJavascript.includes("data:model/gltf-binary") &&
    !normalJavascript.includes("data:audio/mpeg"),
  "정상 JS 번들에 portable 내장 자산이 섞였습니다.",
);

console.log(
  `[통과 a] 단일 파일: ${portableFilename}, ${portableInfo.size} bytes, externalRef=0, moduleScript=0`,
);
console.log(
  `[통과 b] 자산 round-trip 11/11: ${roundTripLabels.join(", ")}`,
);
console.log(
  `[통과 c] 정상 빌드 분리: module=${normalScriptMatch[1]}, css=${normalStylesheetMatch[1]}, embeddedData=0`,
);
console.log(
  `[통과 d] 인라인 JS 문법과 bootstrap 표식: nodeCheck=0, markers=${bootstrapMarkers.length}/${bootstrapMarkers.length}`,
);
console.log(
  `[통과 e] 실행 순서: appEnd=${appClosingOffset}, script=${inlineScriptOffset}, bodyEnd=${closingBodyOffset}`,
);
