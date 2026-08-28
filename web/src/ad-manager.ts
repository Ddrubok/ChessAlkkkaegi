/**
 * 광고 매니저 모듈 (AdManager)
 * 
 * 구글 계정 정지 방지 원칙 (Anti-Ban Policy) 준수:
 * 1. 로컬/개발 환경(IS_DEV_MODE)에서는 Google 공식 테스트 배너 ID 및 data-adtest="on" 적용 / Mock UI 대체
 * 2. Capacitor 네이티브 플랫폼(Android/iOS) 및 웹(AdSense/Mock UI) 자동 분기
 * 3. 인게임 조작 방해 방지: 게임 중(인게임)에는 모바일 하단 배너 자동 숨김, 메뉴/결과창에서 노출
 */

export interface AdManagerConfig {
  isDevMode: boolean;
  admobProdAndroid?: string;
  admobProdIos?: string;
  adSenseClientId?: string;
  adSenseSlotSide?: string;
  adSenseSlotBottom?: string;
}

const ENV: AdManagerConfig = {
  isDevMode: Boolean(import.meta.env.DEV) || (typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")),
  admobProdAndroid: "ca-app-pub-xxxxxxxxxxxxxxxx/android-id",
  admobProdIos: "ca-app-pub-xxxxxxxxxxxxxxxx/ios-id",
  adSenseClientId: "ca-pub-1173757866262139",
  adSenseSlotSide: "xxxxxxxxxx",
  adSenseSlotBottom: "xxxxxxxxxx",
};

// Google 공식 테스트 배너 ID
const ADMOB_TEST_IDS = {
  ANDROID: "ca-app-pub-3940256099942544/6300978111",
  IOS: "ca-app-pub-3940256099942544/2934735716",
};

declare global {
  interface Window {
    Capacitor?: any;
    adsbygoogle?: any[];
  }
}

export const AdManager = {
  isNative: (): boolean => {
    return typeof window !== "undefined" && typeof window.Capacitor !== "undefined" && typeof window.Capacitor.isNativePlatform === "function" && window.Capacitor.isNativePlatform();
  },

  getAdMobUnitId: (): string => {
    const isAndroid = typeof window !== "undefined" && window.Capacitor?.getPlatform?.() === "android";
    if (ENV.isDevMode) {
      return isAndroid ? ADMOB_TEST_IDS.ANDROID : ADMOB_TEST_IDS.IOS;
    }
    return isAndroid ? (ENV.admobProdAndroid || ADMOB_TEST_IDS.ANDROID) : (ENV.admobProdIos || ADMOB_TEST_IDS.IOS);
  },

  /**
   * 광고 시스템 초기화 및 DOM 컨테이너 마운트
   */
  init: async (): Promise<void> => {
    try {
      if (AdManager.isNative()) {
        const { AdMob } = window.Capacitor.Plugins || {};
        if (AdMob) {
          await AdMob.initialize({
            testingDevices: ["EMULATOR"],
            initializeForTesting: ENV.isDevMode,
          });
        }
      } else {
        // 웹 브라우저 환경: 배너 컨테이너 DOM 생성
        AdManager.ensureWebBannerElements();
        if (!ENV.isDevMode && window.adsbygoogle) {
          try {
            window.adsbygoogle.push({});
          } catch (e) {
            console.warn("[AdManager] AdSense push error:", e);
          }
        }
      }
    } catch (error) {
      console.warn("[AdManager] Init failed (Offline mode):", error);
    }
  },

  /**
   * 배너 광고 노출 (메인 메뉴, 로비, 게임 종료 결과창)
   */
  showBanner: async (): Promise<void> => {
    try {
      if (AdManager.isNative()) {
        const { AdMob, BannerAdPosition, BannerAdSize } = window.Capacitor.Plugins || {};
        if (AdMob) {
          await AdMob.showBanner({
            adId: AdManager.getAdMobUnitId(),
            adSize: BannerAdSize?.ADAPTIVE_BANNER || "ADAPTIVE_BANNER",
            position: BannerAdPosition?.BOTTOM_CENTER || "BOTTOM_CENTER",
            isTesting: ENV.isDevMode,
          });
        }
      } else {
        AdManager.ensureWebBannerElements();
        const isMobile = window.innerWidth <= 1024;
        const mobileBanner = document.querySelector<HTMLElement>(".mobile-ad-bottom");
        const pcBanners = document.querySelectorAll<HTMLElement>(".pc-side-ad");

        if (isMobile) {
          if (mobileBanner) {
            mobileBanner.style.display = "flex";
          }
          pcBanners.forEach((el) => {
            el.style.display = "none";
          });
        } else {
          if (mobileBanner) {
            mobileBanner.style.display = "none";
          }
          pcBanners.forEach((el) => {
            el.style.display = "flex";
          });
        }
      }
    } catch (error) {
      console.warn("[AdManager] Show banner failed:", error);
    }
  },

  /**
   * 배너 광고 숨김 (인게임 진입 시 조작 영역 확보)
   */
  hideBanner: async (): Promise<void> => {
    try {
      if (AdManager.isNative()) {
        const { AdMob } = window.Capacitor.Plugins || {};
        if (AdMob) {
          await AdMob.hideBanner();
        }
      } else {
        // 모바일 웹 뷰포트에서 기물 드래그/발사 조작 영역 확보를 위해 하단 배너 숨김
        const mobileBanner = document.querySelector<HTMLElement>(".mobile-ad-bottom");
        if (mobileBanner) {
          mobileBanner.style.display = "none";
        }
      }
    } catch (error) {
      console.warn("[AdManager] Hide banner failed:", error);
    }
  },

  /**
   * 웹 환경 전용 배너 DOM 컨테이너 보장
   */
  ensureWebBannerElements: (): void => {
    if (document.querySelector(".ad-container")) {
      return;
    }

    const appRoot = document.body;

    // PC 좌측 배너
    const leftAd = document.createElement("aside");
    leftAd.className = "ad-container pc-side-ad left-ad";
    leftAd.innerHTML = AdManager.getBannerMarkup("160px", "600px", "PC 좌측 배너 (160x600)");

    // PC 우측 배너
    const rightAd = document.createElement("aside");
    rightAd.className = "ad-container pc-side-ad right-ad";
    rightAd.innerHTML = AdManager.getBannerMarkup("160px", "600px", "PC 우측 배너 (160x600)");

    // 모바일 웹 전용 하단 배너
    const bottomAd = document.createElement("div");
    bottomAd.className = "ad-container mobile-ad-bottom";
    bottomAd.innerHTML = AdManager.getBannerMarkup("100%", "50px", "모바일 하단 배너 (50px)");

    appRoot.append(leftAd, rightAd, bottomAd);

    // 윈도우 리사이즈 시 배너 표시/숨김 갱신
    window.addEventListener("resize", () => {
      const isMobile = window.innerWidth <= 1024;
      const mb = document.querySelector<HTMLElement>(".mobile-ad-bottom");
      if (isMobile) {
        leftAd.style.display = "none";
        rightAd.style.display = "none";
        if (mb && mb.style.display !== "none") {
          mb.style.display = "flex";
        }
      } else {
        leftAd.style.display = "flex";
        rightAd.style.display = "flex";
        if (mb) {
          mb.style.display = "none";
        }
      }
    });
  },

  /**
   * 환경에 따른 광고 마크업 생성 (개발 시 Mock UI, 상용 시 AdSense ins)
   */
  getBannerMarkup: (width: string, height: string, label: string): string => {
    if (ENV.isDevMode) {
      return `
        <div class="mock-ad-box" style="width:${width}; height:${height};">
          <div class="mock-ad-label">Test Ad</div>
          <div class="mock-ad-desc">${label}</div>
          <div class="mock-ad-sub">Google AdSense / AdMob Mock</div>
        </div>
      `;
    }

    return `
      <ins class="adsbygoogle"
           style="display:inline-block;width:${width};height:${height}"
           data-ad-client="${ENV.adSenseClientId}"
           data-ad-slot="${width === "100%" ? ENV.adSenseSlotBottom : ENV.adSenseSlotSide}"
           data-adtest="${ENV.isDevMode ? "on" : "off"}"></ins>
    `;
  },
};
