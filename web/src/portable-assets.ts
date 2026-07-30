/**
 * portable 빌드가 한 HTML 안에 넣는 런타임 자산의 안정적인 식별자다.
 */
export type PortableAssetId =
  | "chessGlb"
  | "chessMeta"
  | "bgm"
  | "button"
  | "hit"
  | "wood"
  | "rock"
  | "iron"
  | "power10"
  | "power50"
  | "power90";

declare const __PORTABLE_BUILD__: boolean;
declare const __PORTABLE_ASSET_URLS__: Readonly<
  Record<PortableAssetId, string>
>;
declare const __NORMAL_ASSET_PATHS__: Readonly<
  Record<PortableAssetId, string>
>;

// configFile 없이 모듈을 읽는 Node 헤드리스 도구는 Vite define이 없으므로 정상 경로로 안전하게 폴백한다.
const FALLBACK_NORMAL_ASSET_PATHS: Readonly<
  Record<PortableAssetId, string>
> = {
  chessGlb: "assets/chess-pieces.glb",
  chessMeta: "assets/chess-set.meta.json",
  bgm: "assets/sound/bgm1.mp3",
  button: "assets/sound/buttonclick_sound.mp3",
  hit: "assets/sound/hit_sound.mp3",
  wood: "assets/sound/wood_hit_sound.mp3",
  rock: "assets/sound/rock_hit_sound.mp3",
  iron: "assets/sound/iron_hit_sound.mp3",
  power10: "assets/sound/power_10.mp3",
  power50: "assets/sound/power_50.mp3",
  power90: "assets/sound/power_90.mp3",
};

const portableBuild =
  typeof __PORTABLE_BUILD__ !== "undefined" &&
  __PORTABLE_BUILD__;
const portableAssetUrls =
  typeof __PORTABLE_ASSET_URLS__ !== "undefined"
    ? __PORTABLE_ASSET_URLS__
    : null;
const normalAssetPaths =
  typeof __NORMAL_ASSET_PATHS__ !== "undefined"
    ? __NORMAL_ASSET_PATHS__
    : FALLBACK_NORMAL_ASSET_PATHS;

/**
 * portable에서는 내장 data URI를, 정상 빌드에서는 기존 BASE_URL 상대 주소를 돌려준다.
 */
export function resolveRuntimeAssetUrl(
  assetId: PortableAssetId,
): string {
  if (portableBuild) {
    const embeddedUrl = portableAssetUrls?.[assetId];
    if (
      typeof embeddedUrl !== "string" ||
      !embeddedUrl.startsWith("data:")
    ) {
      throw new Error(
        `portable 자산 ${assetId}가 빌드 결과에 포함되지 않았습니다.`,
      );
    }
    return embeddedUrl;
  }
  return `${import.meta.env.BASE_URL}${normalAssetPaths[assetId]}`;
}
