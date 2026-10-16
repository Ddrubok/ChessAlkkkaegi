import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig, loadEnv } from "vite";
import type { Rule } from "postcss";

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
  {
    id: "lobbyHeroStage",
    source: "public/assets/lobby/hero-stage.jpg",
    mimeType: "image/jpeg",
  },
  {
    id: "lobbyHeroTutorial",
    source: "public/assets/lobby/hero-tutorial.jpg",
    mimeType: "image/jpeg",
  },
  {
    id: "lobbyAvatar",
    source: "public/assets/lobby/avatar-knight.jpg",
    mimeType: "image/jpeg",
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
  const staging = mode === "staging";
  const pokiBuild = mode === "poki";
  const pokiEnv = pokiBuild ? Object.fromEntries(
    [...new Set([
      ...Object.keys(loadEnv(mode, PROJECT_ROOT, "VITE_")),
      "VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY", "VITE_METERED_APP_NAME",
      "VITE_METERED_API_KEY", "VITE_WEB_ADS_MODE", "VITE_ADSENSE_CLIENT_ID", "VITE_ADSENSE_SLOT_ID",
    ])].filter((key) => /^VITE_(?:SUPABASE|METERED|WEB_ADS|ADSENSE)/u.test(key))
      .map((key) => [`import.meta.env.${key}`, JSON.stringify("")]),
  ) : {};
  if (staging) {
    const env = loadEnv(mode, PROJECT_ROOT, "VITE_");
    // A staging build must never silently inherit the production .env backend.
    if (env.VITE_SUPABASE_URL !== "https://eohasrpzjwtzexoogwdt.supabase.co"
      || !env.VITE_SUPABASE_ANON_KEY?.startsWith("sb_publishable_")) {
      throw new Error("Staging requires the chessalkkagi-dev URL and publishable key in environment variables or web/.env.staging.local.");
    }
  }
  const portableBuild = command === "build" && mode === "portable";
  const portableAssetUrls = portableBuild
    ? createPortableAssetUrls()
    : {};

  return {
    ...(pokiBuild ? {
      resolve: { alias: [
        { find: "@supabase/supabase-js", replacement: resolve(PROJECT_ROOT, "src/poki-stubs/backend.ts") },
        { find: /^\.\/ad-manager$/u, replacement: resolve(PROJECT_ROOT, "src/poki-stubs/ads.ts") },
        { find: /^\.\/web-ads$/u, replacement: resolve(PROJECT_ROOT, "src/poki-stubs/web-ads.ts") },
      ] },
      css: { postcss: { plugins: [{
        postcssPlugin: "poki-no-debug-styles",
        Rule(rule: Rule) {
          const selectors = rule.selectors.filter((selector) => !/\.(?:tuning-|card-tuning-|debug-overlay)/u.test(selector));
          if (selectors.length === 0) rule.remove();
          else if (selectors.length !== rule.selectors.length) rule.selectors = selectors;
        },
      }] } },
    } : {}),
    plugins: [{
      name: "platform-features",
      enforce: "pre",
      transform(code, id) {
        if (!id.replaceAll("\\", "/").startsWith(`${resolve(PROJECT_ROOT, "src").replaceAll("\\", "/")}/`) || !id.endsWith(".ts")) return;
        // Vite define does not replace properties of an imported binding.
        // Resolve these known feature reads before bundling so disabled imports disappear.
        return code.replace(/\bPLATFORM\.features\.(?:online|accounts|externalLinks|debugTools)\b/gu, String(!pokiBuild));
      },
    }, ...(pokiBuild ? [{
      name: "poki-build",
      transformIndexHtml: {
        order: "pre" as const,
        handler: (html: string) => html
          .replace(/\s*<meta name="google-adsense-account"[^>]*>/u, "")
          .replace(/\s*<nav aria-label="게임 안내">[\s\S]*?<\/nav>/u, "")
          .replace(/\s*<link rel="preload"[^>]*href="\/assets\/banners\/classic\.webp"[^>]*>/u, "")
          .replace('src="/src/main.ts"', 'src="/src/poki-entry.ts"'),
      },
      writeBundle(options: { dir?: string }) {
        const output = resolve(PROJECT_ROOT, options.dir ?? "dist-poki");
        cpSync(resolve(PROJECT_ROOT, "public/assets"), resolve(output, "assets"), { recursive: true });
        // Poki removes the boot nav; keep the shared source and other builds unchanged.
        const language = readFileSync(resolve(PROJECT_ROOT, "public/boot-language.js"), "utf8")
          .replace("card.querySelector('nav').setAttribute", "card.querySelector('nav')?.setAttribute");
        writeFileSync(resolve(output, "boot-language.js"), language);
      },
    }] : [])],
    ...(staging ? {
      server: { host: "127.0.0.1", port: 5204, strictPort: true },
      preview: { host: "127.0.0.1", port: 5204, strictPort: true },
    } : {}),
    base:
      command === "build" || isPreview === true
        ? GITHUB_PAGES_BASE
        : "/",
    define: {
      __POKI_BUILD__: JSON.stringify(pokiBuild),
      ...pokiEnv,
      __PORTABLE_BUILD__: JSON.stringify(portableBuild),
      __PORTABLE_ASSET_URLS__: JSON.stringify(portableAssetUrls),
      __NORMAL_ASSET_PATHS__: JSON.stringify(
        portableBuild ? {} : NORMAL_ASSET_PATHS,
      ),
    },
    build: {
      ...(pokiBuild ? { outDir: "dist-poki", copyPublicDir: false } : {}),
      ...(staging ? { outDir: "dist-staging" } : {}),
      rollupOptions: {
        ...(pokiBuild ? { treeshake: { manualPureFunctions: ["console.log", "console.info", "console.debug"] } } : {}),
        input: portableBuild || pokiBuild ? "index.html" : ["index.html", "about.html", "guide.html", "tiers.html", "updates.html"],
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
