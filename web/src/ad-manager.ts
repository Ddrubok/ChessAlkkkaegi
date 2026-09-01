/**
 * 광고 매니저 모듈 (AdManager)
 * 
 * 구글 정책 및 멀티플랫폼 지원:
 * 1. 앱(Android/iOS): Google AdMob 네이티브 SDK 연동 (보상형 비디오, 전면 광고, 배너)
 * 2. 웹(Web Browser): Google AdSense 및 5초 보상형 스폰서 광고 모달 뷰어 연동
 * 3. 로컬/개발 환경(isDevMode): 구글 계정 보호를 위한 공식 테스트 모드 가동
 * 4. 보안 원칙: 실제 AdMob Key는 .env에서만 로드 (코드베이스 미노출)
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
    adBreak?: (options: any) => void;
    adConfig?: (options: any) => void;
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
    return ADMOB_TEST_IDS.BANNER_ANDROID;
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
   * 모바일 하단 배너 광고 노출 (인게임 외 메뉴/로비)
   */
  showBanner: async (): Promise<void> => {
    try {
      if (AdManager.isNative()) {
        const AdMob = await getAdMobPlugin();
        if (!AdMob) return;

        const adId = AdManager.getBannerUnitId();
        await AdMob.showBanner({
          adId,
          position: "BOTTOM_CENTER",
          margin: 0,
          isTesting: ENV.isDevMode,
        });
      } else {
        const bottomAd = document.querySelector<HTMLElement>(".mobile-ad-bottom");
        if (bottomAd && window.innerWidth <= 1024) {
          bottomAd.style.display = "flex";
        }
      }
    } catch (error) {
      console.warn("[AdManager] 배너 광고 노출 실패:", error);
    }
  },

  /**
   * 모바일 하단 배너 광고 숨김 (인게임 진입 시)
   */
  hideBanner: async (): Promise<void> => {
    try {
      if (AdManager.isNative()) {
        const AdMob = await getAdMobPlugin();
        if (AdMob) {
          await AdMob.hideBanner();
        }
      } else {
        const bottomAd = document.querySelector<HTMLElement>(".mobile-ad-bottom");
        if (bottomAd) {
          bottomAd.style.display = "none";
        }
      }
    } catch (error) {
      console.warn("[AdManager] 배너 광고 숨김 실패:", error);
    }
  },

  /**
   * 전면 광고 (GameEnd: 대국 종료 후 노출)
   */
  showInterstitial: async (): Promise<boolean> => {
    try {
      if (AdManager.isNative()) {
        const AdMob = await getAdMobPlugin();
        if (!AdMob) return false;

        const adId = AdManager.getInterstitialUnitId();
        await AdMob.prepareInterstitial({
          adId,
          isTesting: ENV.isDevMode,
        });
        await AdMob.showInterstitial();
        return true;
      }

      // 웹 브라우저 환경: 전면 광고 모달 노출
      return AdManager.showWebInterstitialModal();
    } catch (error) {
      console.warn("[AdManager] 전면 광고 로드 실패:", error);
      return false;
    }
  },

  /**
   * 보상형 광고 (Reward_Gold: 시청 완료 시 보상 콜백 실행)
   * - 앱: Google AdMob 네이티브 보상형 비디오 재생
   * - 웹: Google AdSense 5초 보상형 스폰서 광고 모달 재생
   */
  showRewardVideo: async (onRewarded: (rewardAmount: number) => void): Promise<boolean> => {
    try {
      // 1. 앱 (Capacitor Android/iOS) 환경
      if (AdManager.isNative()) {
        const AdMob = await getAdMobPlugin();
        if (!AdMob) return false;

        const adId = AdManager.getRewardedUnitId();
        await AdMob.prepareRewardVideoAd({
          adId,
          isTesting: ENV.isDevMode,
        });

        const rewardListener = await AdMob.addListener(
          "onRewarded",
          (reward: { type: string; amount: number }) => {
            console.log("[AdManager] AdMob 보상형 광고 시청 완료:", reward);
            onRewarded(reward.amount || 500);
            rewardListener.remove();
          },
        );

        await AdMob.showRewardVideoAd();
        return true;
      }

      // 2. 웹 브라우저 환경: Google H5 Games Ads 또는 AdSense 5초 보상형 모달 실행
      if (typeof window.adBreak === "function") {
        return new Promise<boolean>((resolve) => {
          window.adBreak!({
            type: "reward",
            name: "recharge_coins",
            beforeReward: (showAdFn: () => void) => { showAdFn(); },
            adDismissed: () => { resolve(false); },
            adViewed: () => {
              onRewarded(500);
              resolve(true);
            },
          });
        });
      }

      // 3. 웹 애드센스 5초 보상형 모달 뷰어 실행
      return await AdManager.showWebRewardedAdModal(onRewarded);
    } catch (error) {
      console.warn("[AdManager] 보상형 광고 표시 실패:", error);
      return false;
    }
  },

  /**
   * 웹 브라우저 전용 Google AdSense 5초 보상형 광고 모달 뷰어
   */
  showWebRewardedAdModal: (onRewarded: (rewardAmount: number) => void): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      if (document.querySelector(".web-reward-ad-overlay")) {
        resolve(false);
        return;
      }

      const overlay = document.createElement("div");
      overlay.className = "web-reward-ad-overlay";
      overlay.style.cssText = `
        position: fixed;
        inset: 0;
        background: rgba(15, 23, 42, 0.96);
        z-index: 10000;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 20px;
        box-sizing: border-box;
        animation: tutorialModalPop 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      `;

      let remainingSec = 5;

      overlay.innerHTML = `
        <div class="web-ad-modal-card" style="
          width: 100%;
          max-width: 400px;
          background: #1e293b;
          border: 1px solid #475569;
          border-radius: 16px;
          padding: 20px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
          text-align: center;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
        ">
          <div style="display:flex; justify-content:space-between; align-items:center; width:100%; border-bottom:1px solid #334155; padding-bottom:10px;">
            <span style="font-size:13px; font-weight:700; color:#ffd54a; display:flex; align-items:center; gap:6px;">
              🎬 스폰서 광고
            </span>
            <span id="web-ad-timer-text" style="font-size:12px; font-weight:700; color:#38bdf8; background:#0f172a; padding:3px 8px; border-radius:10px;">
              ⏳ ${remainingSec}초 후 보상 지급
            </span>
          </div>

          <!-- Google AdSense 광고 영역 -->
          <div class="web-ad-content-box" style="
            width: 100%;
            min-height: 250px;
            background: #0f172a;
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
          ">
            ${
              ENV.isDevMode
                ? `
                  <div style="padding:20px; color:#94a3b8; font-size:13px;">
                    <div style="font-size:32px; margin-bottom:8px;">📢</div>
                    <strong style="color:#f8fafc; font-size:15px;">Google AdSense Preview</strong><br>
                    <span>체스알까기 웹 스폰서 광고 영역</span><br>
                    <small style="color:#64748b; font-size:11px;">(배포 환경에서는 실제 구글 배너가 송출됩니다)</small>
                  </div>
                `
                : `
                  <ins class="adsbygoogle"
                       style="display:block; width:100%; height:250px;"
                       data-ad-client="${ENV.adSenseClientId}"
                       data-ad-format="rectangle"
                       data-full-width-responsive="true"></ins>
                `
            }
          </div>

          <!-- 하단 보상 획득 버튼 -->
          <button id="web-ad-claim-btn" disabled style="
            width: 100%;
            background: #334155;
            color: #94a3b8;
            border: none;
            border-radius: 10px;
            padding: 12px;
            font-size: 14px;
            font-weight: 700;
            cursor: not-allowed;
            transition: all 0.2s ease;
          ">
            광고 시청 중... (${remainingSec}초)
          </button>
        </div>
      `;

      document.body.appendChild(overlay);

      // 애드센스 인스턴스 렌더링 시도
      if (!ENV.isDevMode && window.adsbygoogle) {
        try {
          window.adsbygoogle.push({});
        } catch (e) {
          console.warn("[AdManager] AdSense push error in modal:", e);
        }
      }

      const timerText = overlay.querySelector<HTMLElement>("#web-ad-timer-text");
      const claimBtn = overlay.querySelector<HTMLButtonElement>("#web-ad-claim-btn")!;

      const timerInterval = setInterval(() => {
        remainingSec -= 1;
        if (timerText) {
          timerText.textContent = remainingSec > 0 ? `⏳ ${remainingSec}초 후 보상 지급` : "✓ 시청 완료!";
        }

        if (remainingSec <= 0) {
          clearInterval(timerInterval);
          claimBtn.disabled = false;
          claimBtn.style.background = "#2563eb";
          claimBtn.style.color = "#ffffff";
          claimBtn.style.cursor = "pointer";
          claimBtn.innerHTML = "🎉 보상 받기 (+2 코인)";
        } else {
          claimBtn.textContent = `광고 시청 중... (${remainingSec}초)`;
        }
      }, 1000);

      claimBtn.onclick = () => {
        clearInterval(timerInterval);
        overlay.remove();
        onRewarded(500);
        resolve(true);
      };
    });
  },

  /**
   * 웹 브라우저 전용 전면 광고 모달 (3초)
   */
  showWebInterstitialModal: (): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "web-interstitial-ad-overlay";
      overlay.style.cssText = `
        position: fixed;
        inset: 0;
        background: rgba(15, 23, 42, 0.96);
        z-index: 10000;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 20px;
        box-sizing: border-box;
      `;

      let sec = 3;
      overlay.innerHTML = `
        <div style="width:100%; max-width:380px; background:#1e293b; border:1px solid #475569; border-radius:16px; padding:20px; text-align:center; display:flex; flex-direction:column; gap:14px;">
          <div style="font-size:12px; color:#94a3b8; text-align:right;">
            <button id="web-interstitial-close-btn" disabled style="background:#334155; color:#94a3b8; border:none; border-radius:6px; padding:4px 10px; font-size:11px; cursor:not-allowed;">
              닫기 (${sec}초)
            </button>
          </div>
          <div style="min-height:200px; background:#0f172a; border-radius:10px; display:flex; align-items:center; justify-content:center; color:#94a3b8; font-size:13px;">
            <div>
              <div style="font-size:28px;">♟️</div>
              <strong style="color:#f8fafc;">ChessAlkkagi Sponsor</strong>
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      const closeBtn = overlay.querySelector<HTMLButtonElement>("#web-interstitial-close-btn")!;
      const interval = setInterval(() => {
        sec -= 1;
        if (sec <= 0) {
          clearInterval(interval);
          closeBtn.disabled = false;
          closeBtn.style.background = "#ef4444";
          closeBtn.style.color = "#ffffff";
          closeBtn.style.cursor = "pointer";
          closeBtn.textContent = "✕ 닫기";
        } else {
          closeBtn.textContent = `닫기 (${sec}초)`;
        }
      }, 1000);

      closeBtn.onclick = () => {
        clearInterval(interval);
        overlay.remove();
        resolve(true);
      };
    });
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
