import { AdManager } from "./ad-manager";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 행동력/코인 경제 순환 및 서버 검증 추천인(Referral) 시스템
 * - 최초 가입: 10 코인 지급
 * - 매칭 진입 시: 잔액 확인 (코인 차감 없음)
 * - 인게임 대전 확정 시: 1 코인 소모
 * - 자연 시간 충전: 20분당 +1 코인 (최대 5개까지 누적)
 * - 보상형 광고 시청: +2 코인 (1일 최대 10회)
 * - 친구 초대 보상: 신규 가입자가 추천 링크(?ref=CODE)로 가입 완료 시 Supabase RPC 검증을 거쳐 양측 +5 코인 지급 (복사 시 즉시 지급 취약점 완전 제거)
 */

const STORAGE_KEY = "ca_unified_energy_v1";
const MAX_AUTO_RECHARGE_COINS = 5;
const INITIAL_FREE_COINS = 10;
const RECHARGE_INTERVAL_MS = 20 * 60 * 1000; // 20분 (1200초)
const MAX_DAILY_ADS = 10;
const PENDING_REF_KEY = "pending_referrer_code";

export const SVG_COIN_ICON = `
<svg class="coin-icon-svg" viewBox="0 0 24 24" width="18" height="18" style="vertical-align: middle; flex-shrink: 0;">
  <circle cx="12" cy="12" r="10" fill="#F59E0B" stroke="#B45309" stroke-width="1.5" />
  <circle cx="12" cy="12" r="7.5" fill="#FBBF24" />
  <path d="M12 7.5v9M9.5 9.5h5a1.5 1.5 0 0 1 0 3h-5a1.5 1.5 0 0 0 0 3h5" 
        fill="none" stroke="#78350F" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
</svg>
`;

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
   * 1. 잔액 체크 (대전 시도 시 코인 보유 여부 확인)
   */
  hasEnoughCoin: (): boolean => {
    const state = EnergySystem.getState();
    return state.coins >= 1;
  },

  /**
   * 2. 인게임 진입 확정 시점에 1코인 차감
   */
  consumeCoinOnGameStart: (): boolean => {
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
   * 친구 초대 링크 생성 (고유 추천 코드 포함)
   */
  getInviteLink: (referralCode?: string): string => {
    const base = window.location.origin + window.location.pathname;
    const code = referralCode || localStorage.getItem("ca_referral_code") || "CHESS888";
    return `${base}?ref=${encodeURIComponent(code)}`;
  },

  /**
   * 초대 링크 복사 (★ 클라이언트 즉시 코인 증가 로직 완전 제거)
   */
  copyInviteLink: async (referralCode?: string): Promise<boolean> => {
    const inviteUrl = EnergySystem.getInviteLink(referralCode);
    try {
      await navigator.clipboard.writeText(inviteUrl);
      alert(`초대 링크가 복사되었습니다!\n\n친구가 이 링크로 접속하여 가입/닉네임 생성을 완료하면 두 분 모두에게 5코인이 지급됩니다.`);
      return true;
    } catch (err) {
      console.warn("클립보드 복사 실패:", err);
      prompt("아래 초대 링크를 복사하여 친구에게 공유하세요:", inviteUrl);
      return true;
    }
  },

  /**
   * 앱 진입 시 URL의 ?ref= 추천인 코드 감지 및 세션 스토리지 임시 저장
   */
  initReferralTracker: (): void => {
    if (typeof window === "undefined") return;
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const refCode = urlParams.get("ref");
      if (refCode && refCode.trim()) {
        sessionStorage.setItem(PENDING_REF_KEY, refCode.trim().toUpperCase());
        console.log(`[Referral] 추천인 코드 감지: ${refCode.trim()}`);
        // URL 주소창에서 파라미터 노출 제거
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    } catch (e) {
      console.warn("[Referral] Tracker init error:", e);
    }
  },

  /**
   * 신규 가입/프로필 생성 완료 시점에 백엔드 RPC를 호출하여 추천 보상 청구
   */
  claimPendingReferralReward: async (
    newUserId: string,
    client?: SupabaseClient | null,
  ): Promise<boolean> => {
    if (typeof window === "undefined") return false;
    const pendingCode = sessionStorage.getItem(PENDING_REF_KEY);
    if (!pendingCode) return false;

    console.log(`[Referral] 추천 보상 청구 시작: referee=${newUserId}, code=${pendingCode}`);

    if (client) {
      try {
        const { data, error } = await client.rpc("claim_referral_reward", {
          p_referee_id: newUserId,
          p_referrer_code: pendingCode,
        });

        if (!error && data && data.success) {
          const reward = Number(data.reward_coins ?? 5);
          alert(`🎉 친구 초대 링크로 가입하셨습니다!\n보너스 ${reward} 코인이 지급되었습니다.`);
          EnergySystem.addCoins(reward);
          sessionStorage.removeItem(PENDING_REF_KEY);
          return true;
        } else if (data && !data.success) {
          console.warn("[Referral] RPC 거절:", data.message);
          sessionStorage.removeItem(PENDING_REF_KEY);
          return false;
        }
      } catch (err) {
        console.warn("[Referral] RPC 호출 예외 (오프라인/미설치 폴백):", err);
      }
    }

    // 로컬 폴백 (RPC 미설정 환경)
    const CLAIMED_LOCAL_KEY = `ca_ref_claimed_${newUserId}`;
    if (!localStorage.getItem(CLAIMED_LOCAL_KEY)) {
      localStorage.setItem(CLAIMED_LOCAL_KEY, pendingCode);
      alert(`🎉 친구 초대 링크로 가입하셨습니다!\n보너스 5 코인이 지급되었습니다.`);
      EnergySystem.addCoins(5);
      sessionStorage.removeItem(PENDING_REF_KEY);
      return true;
    }

    sessionStorage.removeItem(PENDING_REF_KEY);
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

// 앱 로드 시 추천인 코드 감지기 자동 가동
if (typeof window !== "undefined") {
  EnergySystem.initReferralTracker();
}
