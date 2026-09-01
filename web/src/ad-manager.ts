/**
 * 광고 매니저 모듈 (AdManager)
 * 
 * 구글 계정 정지 방지 원칙 (Anti-Ban Policy) 준수:
 * 1. 로컬/개발 환경(IS_DEV_MODE)에서는 Google 공식 테스트 광고 단위 ID 자동 적용
 * 2. Capacitor 네이티브 플랫폼(Android/iOS) 및 웹(AdSense/Mock UI) 자동 분기
 * 3. 인게임 조작 방해 방지: 게임 중(인게임)에는 모바일 하단 배너 자동 숨김, 메뉴/결과창에서 노출
 * 4. 보안 원칙: 실제 AdMob Key는 .env(Git 미추적)에서 로드하여 코드베이스 노출 차단
 */

export interface AdManagerConfig {
  isDevMode: boolean;
  admobAppId?: string;
  admobRewardedId?: string;
  admobInterstitialId?: string;
  adSenseClientId?: string;
  adSenseSlotSide?: string;
  adSenseSlotBottom?: string;
}

const ENV: AdManagerConfig = {
  isDevMode:
    Boolean(import.meta.env.DEV) ||
    (typeof window !== "undefined" &&
      (window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1")),
  admobAppId: (import.meta as any).env?.VITE_ADMOB_APP_ID || "",
  admobRewardedId: (import.meta as any).env?.VITE_ADMOB_REWARDED_ID || "",
  admobInterstitialId: (import.meta as any).env?.VITE_ADMOB_INTERSTITIAL_ID || "",
  adSenseClientId: "ca-pub-1173757866262139",
  adSenseSlotSide: "xxxxxxxxxx",
  adSenseSlotBottom: "xxxxxxxxxx",
};

// Google 공식 테스트 광고 단위 ID (개발 및 테스트 시 계정 정지 방지용)
const ADMOB_TEST_IDS = {
  BANNER_ANDROID: "ca-app-pub-3940256099942544/6300978111",
  BANNER_IOS: "ca-app-pub-3940256099942544/2934735716",
  INTERSTITIAL_ANDROID: "ca-app-pub-3940256099942544/1033173712",
  REWARDED_ANDROID: "ca-app-pub-3940256099942544/5224354917",
};

declare global {
  interface Window {
    Capacitor?: any;
    adsbygoogle?: any[];
  }
}

// Capacitor Community AdMob 동적 로더
async function getAdMobPlugin(): Promise<any | null> {
  if (typeof window === "undefined" || !AdManager.isNative()) {
    return null;
  }
  try {
    const mod = await import("@capacitor-community/admob");
    return mod.AdMob;
  } catch {
    return (window.Capacitor?.Plugins?.AdMob) || null;
  }
}

export const AdManager = {
  isNative: (): boolean => {
    return (
      typeof window !== "undefined" &&
      typeof window.Capacitor !== "undefined" &&
      typeof window.Capacitor.isNativePlatform === "function" &&
      window.Capacitor.isNativePlatform()
    );
  },

  getBannerUnitId: (): string => {
    if (ENV.isDevMode) {
      return ADMOB_TEST_IDS.BANNER_ANDROID;
    }
    return ENV.admobInterstitialId ? ADMOB_TEST_IDS.BANNER_ANDROID : ADMOB_TEST_IDS.BANNER_ANDROID;
  },

  getInterstitialUnitId: (): string => {
    if (ENV.isDevMode || !ENV.admobInterstitialId) {
      return ADMOB_TEST_IDS.INTERSTITIAL_ANDROID;
    }
    return ENV.admobInterstitialId;
  },

  getRewardedUnitId: (): string => {
    if (ENV.isDevMode || !ENV.admobRewardedId) {
      return ADMOB_TEST_IDS.REWARDED_ANDROID;
    }
    return ENV.admobRewardedId;
  },

  /**
   * 광고 시스템 초기화 및 DOM 컨테이너 마운트
   */
  init: async (): Promise<void> => {
    try {
      if (AdManager.isNative()) {
        const AdMob = await getAdMobPlugin();
        if (AdMob) {
          await AdMob.initialize({
            testingDevices: ["EMULATOR"],
            initializeForTesting: ENV.isDevMode,
          });
          console.log("[AdManager] AdMob Native SDK 초기화 완료");
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
        const AdMob = await getAdMobPlugin();
        if (AdMob) {
          const mod = await import("@capacitor-community/admob").catch(() => null);
          const BannerAdPosition = mod?.BannerAdPosition;
          const BannerAdSize = mod?.BannerAdSize;

          await AdMob.showBanner({
            adId: AdManager.getBannerUnitId(),
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
          if (mobileBanner) mobileBanner.style.display = "flex";
          pcBanners.forEach((el) => (el.style.display = "none"));
        } else {
          if (mobileBanner) mobileBanner.style.display = "none";
          pcBanners.forEach((el) => (el.style.display = "flex"));
        }
      }
    } catch (error) {
      console.warn("[AdManager] Show banner failed:", error);
    }
  },

  /**
   * 배너 광고 숨김 (인게임 진입 시 터치 영역 확보)
   */
  hideBanner: async (): Promise<void> => {
    try {
      if (AdManager.isNative()) {
        const AdMob = await getAdMobPlugin();
        if (AdMob) {
          await AdMob.hideBanner();
        }
      } else {
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
   * 전면 광고 (GameEnd: 대국 종료 후 메뉴 이동 시 1회 송출)
   */
  showInterstitial: async (): Promise<boolean> => {
    try {
      if (!AdManager.isNative()) {
        console.log("[AdManager] 웹 환경에서는 전면 광고가 생략됩니다.");
        return true;
      }
      const AdMob = await getAdMobPlugin();
      if (!AdMob) return false;

      const adId = AdManager.getInterstitialUnitId();
      await AdMob.prepareInterstitial({
        adId,
        isTesting: ENV.isDevMode,
      });
      await AdMob.showInterstitial();
      return true;
    } catch (error) {
      console.warn("[AdManager] 전면 광고 로드 실패:", error);
      return false;
    }
  },

  /**
   * 보상형 비디오 광고 (Reward_Gold: 시청 완료 시 보상 콜백 실행)
   */
  showRewardVideo: async (onRewarded: (rewardAmount: number) => void): Promise<boolean> => {
    try {
      if (!AdManager.isNative()) {
        // 웹 브라우저 테스트 환경: 모의 보상 즉시 지급
        console.log("[AdManager] 웹 테스트 환경: 모의 보상 500 Gold 지급");
        onRewarded(500);
        return true;
      }

      const AdMob = await getAdMobPlugin();
      if (!AdMob) return false;

      const adId = AdManager.getRewardedUnitId();
      await AdMob.prepareRewardVideoAd({
        adId,
        isTesting: ENV.isDevMode,
      });

      // 보상 획득 이벤트 리스너
      const rewardListener = await AdMob.addListener(
        "onRewarded",
        (reward: { type: string; amount: number }) => {
          console.log("[AdManager] 보상형 광고 시청 완료:", reward);
          onRewarded(reward.amount || 500);
          rewardListener.remove();
        },
      );

      await AdMob.showRewardVideoAd();
      return true;
    } catch (error) {
      console.warn("[AdManager] 보상형 광고 표시 실패:", error);
      return false;
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
