import type { SupabaseClient } from "@supabase/supabase-js";
import { progressStorage } from "./progress-storage";
import { I18nManager } from "./i18n";

export function formatAuthError(error: string | undefined | null): string {
  if (!error) return I18nManager.t("auth.generic_error");
  const lower = error.toLowerCase();
  if (lower.includes("invalid login credentials") || lower.includes("invalid credentials")) {
    return I18nManager.t("auth.invalid_credentials");
  }
  if (lower.includes("user already registered") || lower.includes("already registered")) {
    return I18nManager.t("auth.user_already_registered");
  }
  if (lower.includes("email not confirmed") || lower.includes("not confirmed")) {
    return I18nManager.t("auth.email_not_confirmed");
  }
  if (lower.includes("password should be at least") || lower.includes("password")) {
    if (lower.includes("least 6")) return I18nManager.t("auth.password_min_length");
  }
  if (lower.includes("rate limit") || lower.includes("too many requests")) {
    return I18nManager.t("auth.rate_limit_exceeded");
  }
  if (lower.includes("invalid email") || lower.includes("unable to validate email")) {
    return I18nManager.t("auth.invalid_email");
  }
  return I18nManager.t("auth.generic_error");
}

let pendingAuthChange: Promise<unknown> = Promise.resolve();
export function waitForAuthChange(): Promise<unknown> { return pendingAuthChange.catch(() => undefined); }

export function signUpWithEmail(...args: Parameters<typeof performSignUpWithEmail>) {
  const operation = performSignUpWithEmail(...args);
  pendingAuthChange = operation;
  return operation;
}

export function signInWithEmail(...args: Parameters<typeof performSignInWithEmail>) {
  const operation = performSignInWithEmail(...args);
  pendingAuthChange = operation;
  return operation;
}

export function signOutUser(...args: Parameters<typeof performSignOutUser>) {
  const operation = performSignOutUser(...args);
  pendingAuthChange = operation;
  return operation;
}

export interface UserProfile {
  id: string;
  nickname: string;
  mmr: number;
  classicMmr: number;
  strategyMmr: number;
  wins: number;
  losses: number;
  draws: number;
  classicWins: number;
  classicDraws: number;
  classicLosses: number;
  strategyWins: number;
  strategyDraws: number;
  strategyLosses: number;
  referralCode?: string;
  referredBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

const NICKNAME_STORAGE_KEY = "ca_local_nickname";

/**
 * 랜덤 닉네임 생성기 (예: "알까기장인_4821", "체스마스터_1092")
 */
function generateRandomNickname(): string {
  const prefixes = [
    "체스킹", "알까기장인", "흑마술사", "백기사", "번개알",
    "포탄폰", "질풍룩", "도약나이트", "사선비숍", "여왕의일격",
  ];
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const num = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}_${num}`;
}

export function generateReferralCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "CHESS";
  for (let i = 0; i < 4; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function getOrCreateGuestUuid(): string {
  const KEY = "ca_guest_user_uuid";
  let id = localStorage.getItem(KEY);
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    // RFC4122 v4 규격 UUID 생성
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      id = crypto.randomUUID();
    } else {
      id = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
    }
    localStorage.setItem(KEY, id);
  }
  return id;
}

/**
 * 현재 로그인된 유저 세션을 보장하고 익명 계정 또는 로컬 게스트 ID로 세션을 활성화한다.
 */
export async function ensureAuthUser(client: SupabaseClient): Promise<{ id: string; email?: string; isGuest?: boolean; app_metadata?: { provider?: string; providers?: string[] } }> {
  try {
    if (client?.auth?.getSession) {
      const { data: sessionData } = await client.auth.getSession();
      if (sessionData?.session?.user) {
        return { ...sessionData.session.user, isGuest: false };
      }
    }

    // 익명 로그인 시도 (Supabase Auth Anonymous)
    if (client?.auth?.signInAnonymously) {
      const { data: anonData, error: anonErr } = await client.auth.signInAnonymously();
      if (!anonErr && anonData?.user) {
        return { ...anonData.user, isGuest: false };
      }
    }
  } catch (err) {
    console.warn("Supabase Auth 세션 조회 예외:", err);
  }

  // Auth가 비활성화되었거나 미인증 정책인 경우 로컬 게스트 UUID로 폴백
  return { id: getOrCreateGuestUuid(), isGuest: true };
}

/**
 * 유저 프로필을 조회하거나 없으면 새로 생성하여 반환한다.
 */
export async function getOrCreateUserProfile(client: SupabaseClient): Promise<UserProfile> {
  const user = await ensureAuthUser(client);
  const assertCurrentUser = async () => {
    if (user.isGuest) return;
    const { data } = await client.auth.getSession();
    if (data.session?.user.id !== user.id) throw new Error("계정이 변경되었습니다. 다시 로그인해주세요.");
  };

  const { data: existing, error: fetchErr } = await client
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (fetchErr) {
    if (!user.isGuest) throw fetchErr;
    console.warn("프로필 조회 경고:", fetchErr.message);
  }
  await assertCurrentUser();

  if (existing) {
    // 인증 계정의 전적은 항상 서버 권위 값을 사용 (이전 계정의 로컬 캐시 유입 차단)
    const classicMmr = existing.classic_mmr !== null && existing.classic_mmr !== undefined
      ? Number(existing.classic_mmr)
      : (existing.mmr !== null && existing.mmr !== undefined ? Number(existing.mmr) : 1200);

    const strategyMmr = existing.strategy_mmr !== null && existing.strategy_mmr !== undefined
      ? Number(existing.strategy_mmr)
      : (existing.mmr !== null && existing.mmr !== undefined ? Number(existing.mmr) : 1200);

    const classicWins = Number(existing.classic_wins ?? 0);
    const classicDraws = Number(existing.classic_draws ?? 0);
    const classicLosses = Number(existing.classic_losses ?? 0);

    const strategyWins = Number(existing.strategy_wins ?? 0);
    const strategyDraws = Number(existing.strategy_draws ?? 0);
    const strategyLosses = Number(existing.strategy_losses ?? 0);

    const totalWins = Number(existing.wins ?? (classicWins + strategyWins));
    const totalDraws = Number(existing.draws ?? (classicDraws + strategyDraws));
    const totalLosses = Number(existing.losses ?? (classicLosses + strategyLosses));

    // 로컬 스토리지에 서버 기준 상태 동기화 (이전 계정 캐시 덮어쓰기)
    localStorage.setItem("ca_local_classic_mmr", String(classicMmr));
    localStorage.setItem("ca_local_strategy_mmr", String(strategyMmr));
    localStorage.setItem("ca_local_mmr", String(classicMmr));
    localStorage.setItem("ca_local_classic_wins", String(classicWins));
    localStorage.setItem("ca_local_classic_draws", String(classicDraws));
    localStorage.setItem("ca_local_classic_losses", String(classicLosses));
    localStorage.setItem("ca_local_strategy_wins", String(strategyWins));
    localStorage.setItem("ca_local_strategy_draws", String(strategyDraws));
    localStorage.setItem("ca_local_strategy_losses", String(strategyLosses));
    localStorage.setItem("ca_local_wins", String(totalWins));
    localStorage.setItem("ca_local_draws", String(totalDraws));
    localStorage.setItem("ca_local_losses", String(totalLosses));
    if (existing.nickname) {
      localStorage.setItem(NICKNAME_STORAGE_KEY, existing.nickname);
    }

    let referralCode = existing.referral_code;
    if (!referralCode) {
      referralCode = generateReferralCode();
      try {
        const { error: refErr } = await client
          .from("profiles")
          .update({ referral_code: referralCode, updated_at: new Date().toISOString() })
          .eq("id", existing.id);
        if (refErr) {
          throw refErr;
        }
      } catch (err) {
        console.warn("추천 코드 동기화 예외:", err);
        throw err;
      }
    }
    await assertCurrentUser();
    localStorage.setItem("ca_referral_code", referralCode);

    return {
      id: existing.id,
      nickname: existing.nickname,
      mmr: classicMmr,
      classicMmr,
      strategyMmr,
      wins: totalWins,
      losses: totalLosses,
      draws: totalDraws,
      classicWins,
      classicDraws,
      classicLosses,
      strategyWins,
      strategyDraws,
      strategyLosses,
      referralCode,
      referredBy: existing.referred_by,
      createdAt: existing.created_at,
      updatedAt: existing.updated_at,
    };
  }

  // 신규 프로필 생성 또는 오프라인 게스트 처리
  const isGuest = Boolean(user.isGuest);
  // OAuth profiles must not inherit the previous player/device's cached name.
  const googleMember = !isGuest && (user.app_metadata?.provider === 'google' || user.app_metadata?.providers?.includes('google'));
  const savedNick = googleMember ? `Player_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}` : localStorage.getItem(NICKNAME_STORAGE_KEY) || generateRandomNickname();
  const savedClassicMmr = isGuest
    ? Number(localStorage.getItem("ca_guest_classic_mmr") || localStorage.getItem("ca_local_classic_mmr") || 1200)
    : 1200;
  const savedStrategyMmr = isGuest
    ? Number(localStorage.getItem("ca_guest_strategy_mmr") || localStorage.getItem("ca_local_strategy_mmr") || 1200)
    : 1200;
  const savedClassicWins = isGuest
    ? Number(localStorage.getItem("ca_guest_classic_wins") || localStorage.getItem("ca_local_classic_wins") || 0)
    : 0;
  const savedClassicDraws = isGuest
    ? Number(localStorage.getItem("ca_guest_classic_draws") || localStorage.getItem("ca_local_classic_draws") || 0)
    : 0;
  const savedClassicLosses = isGuest
    ? Number(localStorage.getItem("ca_guest_classic_losses") || localStorage.getItem("ca_local_classic_losses") || 0)
    : 0;
  const savedStrategyWins = isGuest
    ? Number(localStorage.getItem("ca_guest_strategy_wins") || localStorage.getItem("ca_local_strategy_wins") || 0)
    : 0;
  const savedStrategyDraws = isGuest
    ? Number(localStorage.getItem("ca_guest_strategy_draws") || localStorage.getItem("ca_local_strategy_draws") || 0)
    : 0;
  const savedStrategyLosses = isGuest
    ? Number(localStorage.getItem("ca_guest_strategy_losses") || localStorage.getItem("ca_local_strategy_losses") || 0)
    : 0;
  const savedWins = savedClassicWins + savedStrategyWins;
  const savedDraws = savedClassicDraws + savedStrategyDraws;
  const savedLosses = savedClassicLosses + savedStrategyLosses;
  const referralCode = (isGuest && localStorage.getItem("ca_referral_code")) || generateReferralCode();
  localStorage.setItem("ca_referral_code", referralCode);

  if (isGuest) {
    localStorage.setItem("ca_guest_classic_mmr", String(savedClassicMmr));
    localStorage.setItem("ca_guest_strategy_mmr", String(savedStrategyMmr));
    localStorage.setItem("ca_guest_classic_wins", String(savedClassicWins));
    localStorage.setItem("ca_guest_classic_draws", String(savedClassicDraws));
    localStorage.setItem("ca_guest_classic_losses", String(savedClassicLosses));
    localStorage.setItem("ca_guest_strategy_wins", String(savedStrategyWins));
    localStorage.setItem("ca_guest_strategy_draws", String(savedStrategyDraws));
    localStorage.setItem("ca_guest_strategy_losses", String(savedStrategyLosses));
  }

  const initialProfile: UserProfile = {
    id: user.id,
    nickname: savedNick,
    mmr: savedClassicMmr,
    classicMmr: savedClassicMmr,
    strategyMmr: savedStrategyMmr,
    wins: savedWins,
    losses: savedLosses,
    draws: savedDraws,
    classicWins: savedClassicWins,
    classicDraws: savedClassicDraws,
    classicLosses: savedClassicLosses,
    strategyWins: savedStrategyWins,
    strategyDraws: savedStrategyDraws,
    strategyLosses: savedStrategyLosses,
    referralCode,
  };

  if (!isGuest) {
    try {
      // RLS 및 서버 전적 권한 격리에 맞추어 camelCase 및 전적 컬럼을 제외하고 비-전적 컬럼만 전달
      const { data: created, error: insertErr } = await client
        .from("profiles")
        .upsert(
          {
            id: user.id,
            nickname: savedNick,
            referral_code: referralCode,
          },
          { onConflict: "id" }
        )
        .select()
        .single();

      if (insertErr) {
        throw insertErr;
      } else if (created) {
        await assertCurrentUser();
        const classicMmr = Number(created.classic_mmr ?? created.mmr ?? 1200);
        const strategyMmr = Number(created.strategy_mmr ?? created.mmr ?? 1200);
        const classicWins = Number(created.classic_wins ?? 0);
        const classicDraws = Number(created.classic_draws ?? 0);
        const classicLosses = Number(created.classic_losses ?? 0);
        const strategyWins = Number(created.strategy_wins ?? 0);
        const strategyDraws = Number(created.strategy_draws ?? 0);
        const strategyLosses = Number(created.strategy_losses ?? 0);
        const wins = Number(created.wins ?? (classicWins + strategyWins));
        const draws = Number(created.draws ?? (classicDraws + strategyDraws));
        const losses = Number(created.losses ?? (classicLosses + strategyLosses));

        localStorage.setItem("ca_local_classic_mmr", String(classicMmr));
        localStorage.setItem("ca_local_strategy_mmr", String(strategyMmr));
        localStorage.setItem("ca_local_mmr", String(classicMmr));
        localStorage.setItem("ca_local_classic_wins", String(classicWins));
        localStorage.setItem("ca_local_classic_draws", String(classicDraws));
        localStorage.setItem("ca_local_classic_losses", String(classicLosses));
        localStorage.setItem("ca_local_strategy_wins", String(strategyWins));
        localStorage.setItem("ca_local_strategy_draws", String(strategyDraws));
        localStorage.setItem("ca_local_strategy_losses", String(strategyLosses));
        localStorage.setItem("ca_local_wins", String(wins));
        localStorage.setItem("ca_local_draws", String(draws));
        localStorage.setItem("ca_local_losses", String(losses));
        if (created.nickname) {
          localStorage.setItem(NICKNAME_STORAGE_KEY, created.nickname);
        }

        return {
          id: created.id,
          nickname: created.nickname,
          mmr: classicMmr,
          classicMmr,
          strategyMmr,
          wins,
          losses,
          draws,
          classicWins,
          classicDraws,
          classicLosses,
          strategyWins,
          strategyDraws,
          strategyLosses,
          referralCode: created.referral_code ?? referralCode,
          referredBy: created.referred_by,
          createdAt: created.created_at,
          updatedAt: created.updated_at,
        };
      }
      throw new Error("생성된 프로필을 조회하지 못했습니다.");
    } catch (err) {
      console.warn("프로필 DB 동기화 예외:", err);
      throw err;
    }
  }

  return initialProfile;
}

/**
 * 이메일과 비밀번호로 회원가입한다.
 */
async function performSignUpWithEmail(
  client: SupabaseClient,
  email: string,
  password: string,
  nickname: string,
): Promise<{ success: boolean; error?: string; user?: UserProfile; needsEmailConfirmation?: boolean }> {
  const cleanEmail = email.trim();
  const cleanNick = nickname.trim();

  if (!cleanEmail || !cleanEmail.includes("@")) {
    return { success: false, error: I18nManager.t("auth.invalid_email") };
  }
  if (password.length < 6) {
    return { success: false, error: I18nManager.t("auth.password_min_length") };
  }
  if (cleanNick.length < 2 || cleanNick.length > 20) {
    return { success: false, error: I18nManager.t("auth.nickname_length") };
  }

  const { data: signUpData, error: signUpErr } = await client.auth.signUp({
    email: cleanEmail,
    password,
    options: {
      data: {
        nickname: cleanNick,
      },
    },
  });

  if (signUpErr) {
    return { success: false, error: formatAuthError(signUpErr.message) };
  }

  const authUser = signUpData.user;
  if (!authUser) {
    return { success: false, error: I18nManager.t("auth.signup_session_failed") };
  }

  // 이메일 확인 대기 상태 (session 없음): 인증되지 않은 상태를 로그인 완료처럼 표시하지 않음
  if (!signUpData.session) {
    return {
      success: false,
      needsEmailConfirmation: true,
      error: I18nManager.t("auth.email_confirmation_sent"),
    };
  }

  // 세션이 활성화된 경우: 프로필 테이블 등록
  // RLS 제한(비-전적 컬럼 허용) 및 SQL 가입 트리거와 호환되도록 camelCase/전적 컬럼 제외
  const referralCode = generateReferralCode();
  const { error: profileErr } = await client
    .from("profiles")
    .upsert(
      {
        id: authUser.id,
        nickname: cleanNick,
        referral_code: referralCode,
      },
      { onConflict: "id" }
    );

  if (profileErr) {
    return { success: false, error: formatAuthError(profileErr.message) };
  }

  // 로컬 스토리지에 신규 계정 정보 동기화 (기존 전적 오염 방지)
  localStorage.setItem(NICKNAME_STORAGE_KEY, cleanNick);
  localStorage.setItem("ca_guest_user_uuid", authUser.id);
  localStorage.setItem("ca_referral_code", referralCode);
  localStorage.setItem("ca_local_mmr", "1200");
  localStorage.setItem("ca_local_classic_mmr", "1200");
  localStorage.setItem("ca_local_strategy_mmr", "1200");
  localStorage.setItem("ca_local_wins", "0");
  localStorage.setItem("ca_local_losses", "0");
  localStorage.setItem("ca_local_draws", "0");
  localStorage.setItem("ca_local_classic_wins", "0");
  localStorage.setItem("ca_local_classic_draws", "0");
  localStorage.setItem("ca_local_classic_losses", "0");
  localStorage.setItem("ca_local_strategy_wins", "0");
  localStorage.setItem("ca_local_strategy_draws", "0");
  localStorage.setItem("ca_local_strategy_losses", "0");

  const newProfile: UserProfile = {
    id: authUser.id,
    nickname: cleanNick,
    mmr: 1200,
    classicMmr: 1200,
    strategyMmr: 1200,
    wins: 0,
    losses: 0,
    draws: 0,
    classicWins: 0,
    classicDraws: 0,
    classicLosses: 0,
    strategyWins: 0,
    strategyDraws: 0,
    strategyLosses: 0,
    referralCode,
  };

  return { success: true, user: newProfile };
}

/**
 * 이메일과 비밀번호로 로그인한다.
 */
async function performSignInWithEmail(
  client: SupabaseClient,
  email: string,
  password: string,
): Promise<{ success: boolean; error?: string; user?: UserProfile }> {
  const cleanEmail = email.trim();
  if (!cleanEmail || !password) {
    return { success: false, error: I18nManager.t("auth.email_password_required") };
  }

  const { data: signInData, error: signInErr } = await client.auth.signInWithPassword({
    email: cleanEmail,
    password,
  });

  if (signInErr || !signInData.user) {
    return { success: false, error: formatAuthError(signInErr?.message) || I18nManager.t("lobby.login_failed") };
  }

  localStorage.setItem("ca_guest_user_uuid", signInData.user.id);
  const profile = await getOrCreateUserProfile(client);
  return { success: true, user: profile };
}

/**
 * 로그아웃을 수행하고 게스트 상태로 전환한다.
 */
async function performSignOutUser(client: SupabaseClient): Promise<void> {
  await progressStorage.flush();
  try {
    if (client?.auth?.signOut) {
      await client.auth.signOut();
    }
  } catch {}
  localStorage.removeItem("ca_guest_user_uuid");
  localStorage.removeItem("ca_logged_in_user");

  // 이전 계정 전적 격리를 위해 로컬 전적 캐시 정리
  const statKeys = [
    "ca_local_classic_mmr",
    "ca_local_strategy_mmr",
    "ca_local_mmr",
    "ca_local_classic_wins",
    "ca_local_classic_draws",
    "ca_local_classic_losses",
    "ca_local_strategy_wins",
    "ca_local_strategy_draws",
    "ca_local_strategy_losses",
    "ca_local_wins",
    "ca_local_draws",
    "ca_local_losses",
    "ca_referral_code",
  ];
  for (const key of statKeys) {
    localStorage.removeItem(key);
  }
}

/**
 * 현재 로그인된 세션 이메일을 조회한다.
 */
export async function getSessionEmail(client: SupabaseClient): Promise<string | null> {
  try {
    const { data } = await client.auth.getSession();
    return data.session?.user?.email ?? null;
  } catch {
    return null;
  }
}

/**
 * 닉네임을 변경한다.
 */
export async function updateNickname(
  client: SupabaseClient,
  userId: string,
  newNickname: string,
): Promise<{ success: boolean; error?: string }> {
  const trimmed = newNickname.normalize('NFKC').trim();
  if ([...trimmed].length < 2 || [...trimmed].length > 20) {
    return { success: false, error: I18nManager.t("auth.nickname_length") };
  }

  try {
    const { changeNickname } = await import('./nickname');
    await changeNickname(client, userId, trimmed, crypto.randomUUID());
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : I18nManager.t('auth.generic_error') };
  }
}

/**
 * 랭킹 상위 유저 목록을 조회한다.
 */
export async function fetchTopRankings(
  client: SupabaseClient,
  limit = 20,
): Promise<UserProfile[]> {
  const { data, error } = await client
    .from("profiles")
    .select("id, nickname, mmr, classic_mmr, strategy_mmr, wins, losses, draws, classic_wins, classic_draws, classic_losses, strategy_wins, strategy_draws, strategy_losses")
    .order("mmr", { ascending: false })
    .limit(limit);

  if (error || !data) {
    console.warn("랭킹 조회 실패:", error?.message);
    return [];
  }

  return data.map((item) => {
    const classicMmr = Number(item.classic_mmr ?? item.mmr ?? 1200);
    const strategyMmr = Number(item.strategy_mmr ?? item.mmr ?? 1200);
    const classicWins = Number(item.classic_wins ?? 0);
    const classicDraws = Number(item.classic_draws ?? 0);
    const classicLosses = Number(item.classic_losses ?? 0);
    const strategyWins = Number(item.strategy_wins ?? 0);
    const strategyDraws = Number(item.strategy_draws ?? 0);
    const strategyLosses = Number(item.strategy_losses ?? 0);
    return {
      id: item.id,
      nickname: item.nickname,
      mmr: classicMmr,
      classicMmr,
      strategyMmr,
      wins: Number(item.wins ?? (classicWins + strategyWins)),
      losses: Number(item.losses ?? (classicLosses + strategyLosses)),
      draws: Number(item.draws ?? (classicDraws + strategyDraws)),
      classicWins,
      classicDraws,
      classicLosses,
      strategyWins,
      strategyDraws,
      strategyLosses,
    };
  });
}
