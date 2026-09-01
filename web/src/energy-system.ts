import { AdManager } from "./ad-manager";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 행동력/코인 경제 순환 및 서버 검증 추천인(Referral) 시스템
 * 
 * 구글 계정 보호(Anti-Ban Policy) 광고 정책:
 * - 1일 최대 시청 한도: 5회 (과도한 시청 및 무효 트래픽 방지)
 * - 1회 시청당 보상: +2 코인 (하루 최대 +10 코인 무료 충전)
 * - 시청 간격 쿨다운: 60초 (연타/매크로 시청 방지)
 */

const STORAGE_KEY = "ca_unified_energy_v1";
const SYNCED_LOGS_KEY = "ca_synced_referral_log_ids";
const MAX_AUTO_RECHARGE_COINS = 5;
const INITIAL_FREE_COINS = 10;
const RECHARGE_INTERVAL_MS = 20 * 60 * 1000; // 20분 (1200초)
const MAX_DAILY_ADS = 5; // ★ 구글 계정 정지 방지: 1일 최대 5회 권장치
const AD_COOLDOWN_MS = 60 * 1000; // ★ 시청 간격 쿨다운 60초
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
  adAvailable: boolean; // 오늘 광고 시청 가능 여부 (한도 및 쿨다운 모두 통과 시 true)
  adCountToday: number;
  dailyAdLimit: number;
  adCooldownSec: number; // 남은 쿨다운 초 (0이면 쿨다운 없음)
}

interface StoredEnergyData {
  coins: number;
  lastRechargeAt: number;
  adCountToday: number;
  lastAdDate: string;
  lastAdWatchedAt: number;
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
      if (!data.lastAdWatchedAt) {
        data.lastAdWatchedAt = 0;
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
    lastAdWatchedAt: 0,
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

function getSyncedLogIds(): Set<string> {
  try {
    const raw = localStorage.getItem(SYNCED_LOGS_KEY);
    if (raw) {
      return new Set(JSON.parse(raw));
    }
  } catch {}
  return new Set<string>();
}

function saveSyncedLogIds(ids: Set<string>): void {
  try {
    localStorage.setItem(SYNCED_LOGS_KEY, JSON.stringify([...ids]));
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

    // 광고 쿨다운 계산 (60초)
    const adElapsed = now - (data.lastAdWatchedAt || 0);
    const adCooldownRemainingMs = Math.max(0, AD_COOLDOWN_MS - adElapsed);
    const adCooldownSec = Math.ceil(adCooldownRemainingMs / 1000);

    const hasDailyLimitRemaining = data.adCountToday < MAX_DAILY_ADS;
    const adAvailable = hasDailyLimitRemaining && adCooldownSec <= 0;

    return {
      coins: data.coins,
      maxCoins: MAX_AUTO_RECHARGE_COINS,
      timeToNextMs,
      adAvailable,
      adCountToday: data.adCountToday,
      dailyAdLimit: MAX_DAILY_ADS,
      adCooldownSec,
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
   * 보상형 광고 시청 후 +2 코인 지급 (일일 5회 + 60초 쿨다운 검증)
   */
  watchAdForCoins: async (): Promise<boolean> => {
    const state = EnergySystem.getState();
    if (state.adCountToday >= MAX_DAILY_ADS) {
      alert("오늘 광고 시청 한도(5회)를 모두 달성하셨습니다. 내일 다시 이용해주세요!");
      return false;
    }
    if (state.adCooldownSec > 0) {
      alert(`광고 재시청 대기 중입니다. ${state.adCooldownSec}초 후에 다시 시도해주세요.`);
      return false;
    }

    return new Promise<boolean>((resolve) => {
      AdManager.showRewardVideo((_rewardAmount) => {
        const data = loadStoredData();
        data.coins += 2;
        data.adCountToday += 1;
        data.lastAdWatchedAt = Date.now();
        saveStoredData(data);
        EnergySystem.notify();
        resolve(true);
      }).then((success) => {
        if (!success) resolve(false);
      });
    });
  },

  /**
   * 친구 초대 링크 생성 (고유 추천 코드 또는 ID 포함)
   */
  getInviteLink: (referralCodeOrId?: string): string => {
    const base = window.location.origin + window.location.pathname;
    const code = referralCodeOrId || localStorage.getItem("ca_referral_code") || "CHESS888";
    return `${base}?ref=${encodeURIComponent(code)}`;
  },

  /**
   * 초대 링크 복사 (★ 클라이언트 즉시 코인 증가 로직 완전 제거)
   */
  copyInviteLink: async (referralCodeOrId?: string): Promise<boolean> => {
    const inviteUrl = EnergySystem.getInviteLink(referralCodeOrId);
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
        sessionStorage.setItem(PENDING_REF_KEY, refCode.trim());
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
    isNewUser: boolean = true,
  ): Promise<boolean> => {
    if (typeof window === "undefined") return false;
    const pendingCode = sessionStorage.getItem(PENDING_REF_KEY);
    if (!pendingCode) return false;

    // 만약 이미 가입되어 있던 기존 회원인 경우
    if (!isNewUser) {
      alert("이미 가입된 회원이에요.");
      sessionStorage.removeItem(PENDING_REF_KEY);
      return false;
    }

    console.log(`[Referral] 추천 보상 청구 시작: referee=${newUserId}, code=${pendingCode}`);

    if (client) {
      try {
        const { data, error } = await client.rpc("claim_referral_reward", {
          p_referee_id: newUserId,
          p_referrer_code: pendingCode,
          p_is_new_user: true,
        });

        if (error) {
          console.warn("[Referral] RPC 호출 에러:", error.message);
        } else if (data && data.success) {
          const reward = Number(data.reward_coins ?? 5);
          alert(`🎉 친구 초대 링크로 가입하셨습니다!\n가입 축하 보너스로 ${reward} 코인이 지급되었습니다.`);
          EnergySystem.addCoins(reward);
          sessionStorage.removeItem(PENDING_REF_KEY);
          return true;
        } else if (data && !data.success) {
          if (data.code === "ALREADY_MEMBER" || data.code === "ALREADY_REFERRED") {
            alert("이미 가입된 회원이에요.");
          } else if (data.code === "SELF_REFERRAL") {
            alert("자기 자신은 추천할 수 없습니다.");
          } else {
            console.warn("[Referral] RPC 처리 결과:", data.message);
          }
          sessionStorage.removeItem(PENDING_REF_KEY);
          return false;
        }
      } catch (err) {
        console.warn("[Referral] RPC 호출 예외:", err);
      }
    }

    // 로컬 폴백 (RPC 미설정 환경)
    const CLAIMED_LOCAL_KEY = `ca_ref_claimed_${newUserId}`;
    if (!localStorage.getItem(CLAIMED_LOCAL_KEY)) {
      localStorage.setItem(CLAIMED_LOCAL_KEY, pendingCode);
      alert(`🎉 친구 초대 링크로 가입하셨습니다!\n가입 축하 보너스로 5 코인이 지급되었습니다.`);
      EnergySystem.addCoins(5);
      sessionStorage.removeItem(PENDING_REF_KEY);
      return true;
    } else {
      alert("이미 가입된 회원이에요.");
    }

    sessionStorage.removeItem(PENDING_REF_KEY);
    return false;
  },

  /**
   * ★ 초대한 유저(Referrer)의 미지급 추천 보상을 서버와 동기화
   */
  syncReferralRewardsFromServer: async (
    userId: string,
    client: SupabaseClient,
  ): Promise<void> => {
    if (!userId || !client) return;

    try {
      // 1. RPC 함수로 안전하게 추천 보상 조회 (RLS 우회)
      const { data: rpcData, error: rpcErr } = await client.rpc("check_and_claim_referrer_rewards", {
        p_user_id: userId,
      });

      if (!rpcErr && rpcData && rpcData.success) {
        const logIds: string[] = rpcData.log_ids || [];
        const syncedIds = getSyncedLogIds();
        let newCount = 0;

        for (const id of logIds) {
          if (!syncedIds.has(id)) {
            syncedIds.add(id);
            newCount++;
          }
        }

        if (newCount > 0) {
          const rewardAmount = newCount * 5;
          saveSyncedLogIds(syncedIds);
          EnergySystem.addCoins(rewardAmount);
          alert(`🎉 친구 ${newCount}명이 가입을 완료했습니다!\n친구 초대 보너스로 +${rewardAmount} 코인이 지급되었습니다!`);
          return;
        }
      }

      // 2. 폴백: referral_logs 직접 조회
      const { data: logs, error: logErr } = await client
        .from("referral_logs")
        .select("id, reward_coins")
        .eq("referrer_id", userId);

      if (!logErr && logs && logs.length > 0) {
        const syncedIds = getSyncedLogIds();
        let newRewards = 0;
        let newCount = 0;

        for (const log of logs) {
          if (!syncedIds.has(log.id)) {
            syncedIds.add(log.id);
            newRewards += Number(log.reward_coins || 5);
            newCount++;
          }
        }

        if (newCount > 0 && newRewards > 0) {
          saveSyncedLogIds(syncedIds);
          EnergySystem.addCoins(newRewards);
          alert(`🎉 친구 ${newCount}명이 가입을 완료했습니다!\n친구 초대 보너스로 +${newRewards} 코인이 지급되었습니다!`);
        }
      }
    } catch (err) {
      console.warn("[Referral] 서버 추천 보상 동기화 예외:", err);
    }
  },

  /**
   * ★ 초대한 유저(Referrer) 실시간 초대 보상 감지기 등록 (Supabase Realtime)
   */
  subscribeReferralRealtime: (
    userId: string,
    client: SupabaseClient,
  ): (() => void) => {
    if (!userId || !client) return () => {};

    try {
      const channel = client
        .channel(`referral-realtime-${userId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "referral_logs",
            filter: `referrer_id=eq.${userId}`,
          },
          (payload) => {
            console.log("[Referral] Realtime 추천 로그 수신:", payload);
            const newLog = payload.new as { id: string; reward_coins?: number };
            const syncedIds = getSyncedLogIds();

            if (newLog && newLog.id && !syncedIds.has(newLog.id)) {
              syncedIds.add(newLog.id);
              saveSyncedLogIds(syncedIds);
              const reward = Number(newLog.reward_coins || 5);
              EnergySystem.addCoins(reward);
              alert(`🎉 친구가 회원가입을 완료했습니다!\n친구 초대 보너스로 +${reward} 코인이 지급되었습니다!`);
            }
          },
        )
        .subscribe((status) => {
          console.log("[Referral] Realtime 채널 상태:", status);
        });

      return () => {
        void client.removeChannel(channel);
      };
    } catch (err) {
      console.warn("[Referral] Realtime 구독 설정 실패:", err);
      return () => {};
    }
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
