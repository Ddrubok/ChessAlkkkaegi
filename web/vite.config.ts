import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const GITHUB_PAGES_BASE = "./";
const PROJECT_ROOT = fileURLToPath(new URL(".", import.meta.url));

interface PortableAssetDefinition {
  // 런타임 코드가 경로 대신 사용하는 안정적인 식별자다.
  id: string;
  // 저장소의 public 디렉터리를 기준으로 한 원본 파일 경로다.
  source: string;
  // data URI가 브라우저 로더에 전달할 정확한 미디어 형식이다.
  mimeType: string;
}

// portable 체험판에 들어가야 하는 모든 런타임 fetch·Audio 자산을 한곳에서 관리한다.
const PORTABLE_ASSET_DEFINITIONS: readonly PortableAssetDefinition[] = [
  {
    id: "chessGlb",
    source: "public/assets/chess-pieces.glb",
    mimeType: "model/gltf-binary",
  },
  {
    id: "chessMeta",
    source: "public/assets/chess-set.meta.json",
    mimeType: "application/json",
  },
  {
    id: "bgm",
    source: "public/assets/sound/bgm1.mp3",
    mimeType: "audio/mpeg",
  },
  {
    id: "button",
    source: "public/assets/sound/buttonclick_sound.mp3",
    mimeType: "audio/mpeg",
  },
  {
    id: "hit",
    source: "public/assets/sound/hit_sound.mp3",
    mimeType: "audio/mpeg",
  },
  {
    id: "wood",
    source: "public/assets/sound/wood_hit_sound.mp3",
    mimeType: "audio/mpeg",
  },
  {
    id: "rock",
    source: "public/assets/sound/rock_hit_sound.mp3",
    mimeType: "audio/mpeg",
  },
  {
    id: "iron",
    source: "public/assets/sound/iron_hit_sound.mp3",
    mimeType: "audio/mpeg",
  },
  {
    id: "power10",
    source: "public/assets/sound/power_10.mp3",
    mimeType: "audio/mpeg",
  },
  {
    id: "power50",
    source: "public/assets/sound/power_50.mp3",
    mimeType: "audio/mpeg",
  },
  {
    id: "power90",
    source: "public/assets/sound/power_90.mp3",
    mimeType: "audio/mpeg",
  },
];

// 정상 빌드는 기존 public 상대 경로만 받으며 portable의 base64 본문과 완전히 분리된다.
const NORMAL_ASSET_PATHS = Object.fromEntries(
  PORTABLE_ASSET_DEFINITIONS.map((definition) => [
    definition.id,
    definition.source.replace(/^public\//u, ""),
  ]),
);

/**
 * portable 모드에서만 원본 바이트를 base64 data URI로 바꿔 Vite 상수 치환에 넘긴다.
 */
function createPortableAssetUrls(): Readonly<Record<string, string>> {
  return Object.fromEntries(
    PORTABLE_ASSET_DEFINITIONS.map((definition) => {
      const sourcePath = resolve(PROJECT_ROOT, definition.source);
      const base64 = readFileSync(sourcePath).toString("base64");
      return [
        definition.id,
        `data:${definition.mimeType};base64,${base64}`,
      ];
    }),
  );
}

export default defineConfig(({ command, isPreview, mode }) => {
  const portableBuild = command === "build" && mode === "portable";
  const portableAssetUrls = portableBuild
    ? createPortableAssetUrls()
    : {};

  return {
    base:
      command === "build" || isPreview === true
        ? GITHUB_PAGES_BASE
        : "/",
    define: {
      __PORTABLE_BUILD__: JSON.stringify(portableBuild),
      __PORTABLE_ASSET_URLS__: JSON.stringify(portableAssetUrls),
      __NORMAL_ASSET_PATHS__: JSON.stringify(
        portableBuild ? {} : NORMAL_ASSET_PATHS,
      ),
    },
    build: {
      rollupOptions: {
        input: "index.html",
        ...(portableBuild
          ? {
              output: {
                // 동적 import도 한 청크로 접어 후처리 뒤 외부 module 요청이 남지 않게 한다.
                codeSplitting: false,
              },
            }
          : {}),
      },
      ...(portableBuild
        ? {
            outDir: "dist-portable",
            copyPublicDir: false,
            cssCodeSplit: false,
            modulePreload: false,
            assetsInlineLimit: Number.MAX_SAFE_INTEGER,
          }
        : {}),
    },
  };
});
