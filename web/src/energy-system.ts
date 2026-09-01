import { AdManager } from "./ad-manager";

/**
 * 행동력/코인 경제 순환 시스템 (Unified Energy Model)
 * - 최초 가입: 10 코인 지급
 * - 매칭 1판당: 1 코인 소모
 * - 자연 시간 충전: 20분당 +1 코인 (최대 5개까지 누적)
 * - 보상형 광고 시청: +2 코인 (1일 최대 10회)
 * - 친구 초대 보상: +5 코인
 */

const STORAGE_KEY = "ca_unified_energy_v1";
const MAX_AUTO_RECHARGE_COINS = 5;
const INITIAL_FREE_COINS = 10;
const RECHARGE_INTERVAL_MS = 20 * 60 * 1000; // 20분 (1200초)
const MAX_DAILY_ADS = 10;

export interface EnergyState {
  coins: number;
  maxCoins: number;
  timeToNextMs: number; // 다음 1 코인 충전까지 남은 밀리초
  adAvailable: boolean; // 오늘 광고 시청 가능 여부
  adCountToday: number;
  dailyAdLimit: number;
}

interface StoredEnergyData {
  coins: number;
  lastRechargeAt: number;
  adCountToday: number;
  lastAdDate: string;
  hasReceivedInitial: boolean;
}

function getTodayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function loadStoredData(): StoredEnergyData {
  const today = getTodayString();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data: StoredEnergyData = JSON.parse(raw);
      if (data.lastAdDate !== today) {
        data.adCountToday = 0;
        data.lastAdDate = today;
      }
      return data;
    }
  } catch {}

  // 최초 생성
  const initialData: StoredEnergyData = {
    coins: INITIAL_FREE_COINS,
    lastRechargeAt: Date.now(),
    adCountToday: 0,
    lastAdDate: today,
    hasReceivedInitial: true,
  };
  saveStoredData(initialData);
  return initialData;
}

function saveStoredData(data: StoredEnergyData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

const listeners = new Set<(state: EnergyState) => void>();

export const EnergySystem = {
  /**
   * 자연 시간 충전을 계산하고 최신 행동력 상태를 반환한다.
   */
  getState: (): EnergyState => {
    const data = loadStoredData();
    const now = Date.now();

    // 자연 시간 충전 계산
    if (data.coins < MAX_AUTO_RECHARGE_COINS) {
      const elapsed = now - data.lastRechargeAt;
      if (elapsed >= RECHARGE_INTERVAL_MS) {
        const gained = Math.floor(elapsed / RECHARGE_INTERVAL_MS);
        data.coins = Math.min(MAX_AUTO_RECHARGE_COINS, data.coins + gained);
        data.lastRechargeAt = now - (elapsed % RECHARGE_INTERVAL_MS);
        saveStoredData(data);
      }
    } else {
      // 5개 이상이면 타이머 리셋
      data.lastRechargeAt = now;
      saveStoredData(data);
    }

    let timeToNextMs = 0;
    if (data.coins < MAX_AUTO_RECHARGE_COINS) {
      timeToNextMs = Math.max(0, RECHARGE_INTERVAL_MS - (now - data.lastRechargeAt));
    }

    return {
      coins: data.coins,
      maxCoins: MAX_AUTO_RECHARGE_COINS,
      timeToNextMs,
      adAvailable: data.adCountToday < MAX_DAILY_ADS,
      adCountToday: data.adCountToday,
      dailyAdLimit: MAX_DAILY_ADS,
    };
  },

  /**
   * 매칭 진입 시 1 코인을 즉시 소모한다. (성공 시 true, 코인 부족 시 false)
   */
  consumeMatchCoin: (): boolean => {
    const state = EnergySystem.getState();
    if (state.coins < 1) {
      return false;
    }
    const data = loadStoredData();
    data.coins -= 1;
    if (data.coins < MAX_AUTO_RECHARGE_COINS && data.coins + 1 >= MAX_AUTO_RECHARGE_COINS) {
      data.lastRechargeAt = Date.now();
    }
    saveStoredData(data);
    EnergySystem.notify();
    return true;
  },

  /**
   * 코인을 추가 지급한다.
   */
  addCoins: (amount: number): void => {
    if (amount <= 0) return;
    const data = loadStoredData();
    data.coins += amount;
    saveStoredData(data);
    EnergySystem.notify();
  },

  /**
   * 보상형 광고 시청 후 +2 코인 지급 (AdManager 연동)
   */
  watchAdForCoins: async (): Promise<boolean> => {
    const state = EnergySystem.getState();
    if (!state.adAvailable) {
      return false;
    }

    return new Promise<boolean>((resolve) => {
      AdManager.showRewardVideo((_rewardAmount) => {
        const data = loadStoredData();
        data.coins += 2;
        data.adCountToday += 1;
        saveStoredData(data);
        EnergySystem.notify();
        resolve(true);
      }).then((success) => {
        if (!success) resolve(false);
      });
    });
  },

  /**
   * 친구 초대 링크 생성 및 클립보드 복사
   */
  getInviteLink: (userId?: string): string => {
    const base = window.location.origin + window.location.pathname;
    const ref = userId || "chess_player";
    return `${base}?ref=${encodeURIComponent(ref)}`;
  },

  /**
   * 레퍼럴 URL(?ref=...)로 접속한 경우 피초대자 보너스 지급 (1회)
   */
  checkReferralBonus: (): boolean => {
    if (typeof window === "undefined") return false;
    const urlParams = new URLSearchParams(window.location.search);
    const ref = urlParams.get("ref");
    const REFERRAL_KEY = "ca_referral_rewarded";

    if (ref && !localStorage.getItem(REFERRAL_KEY)) {
      localStorage.setItem(REFERRAL_KEY, "true");
      EnergySystem.addCoins(5);
      return true;
    }
    return false;
  },

  /**
   * 상태 변경 알림 리스너 등록
   */
  subscribe: (listener: (state: EnergyState) => void): (() => void) => {
    listeners.add(listener);
    listener(EnergySystem.getState());
    return () => listeners.delete(listener);
  },

  notify: (): void => {
    const state = EnergySystem.getState();
    listeners.forEach((l) => l(state));
  },
};
