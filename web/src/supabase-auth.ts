import type { SupabaseClient } from "@supabase/supabase-js";

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
export async function ensureAuthUser(client: SupabaseClient): Promise<{ id: string; email?: string }> {
  try {
    const { data: sessionData } = await client.auth.getSession();
    if (sessionData?.session?.user) {
      return sessionData.session.user;
    }

    // 익명 로그인 시도 (Supabase Auth Anonymous)
    const { data: anonData, error: anonErr } = await client.auth.signInAnonymously();
    if (!anonErr && anonData?.user) {
      return anonData.user;
    }
  } catch (err) {
    console.warn("Supabase Auth 세션 조회 예외:", err);
  }

  // Auth가 비활성화되었거나 미인증 정책인 경우 로컬 게스트 UUID로 폴백
  return { id: getOrCreateGuestUuid() };
}

/**
 * 유저 프로필을 조회하거나 없으면 새로 생성하여 반환한다.
 */
export async function getOrCreateUserProfile(client: SupabaseClient): Promise<UserProfile> {
  const user = await ensureAuthUser(client);

  const { data: existing, error: fetchErr } = await client
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (fetchErr) {
    console.warn("프로필 조회 경고:", fetchErr.message);
  }

  if (existing) {
    const localClassicMmr = localStorage.getItem("ca_local_classic_mmr") ? Number(localStorage.getItem("ca_local_classic_mmr")) : null;
    const dbClassicMmr = existing.classic_mmr !== null && existing.classic_mmr !== undefined ? Number(existing.classic_mmr) : (existing.mmr !== null && existing.mmr !== undefined ? Number(existing.mmr) : null);
    const classicMmr = localClassicMmr ?? dbClassicMmr ?? 1200;

    const localStrategyMmr = localStorage.getItem("ca_local_strategy_mmr") ? Number(localStorage.getItem("ca_local_strategy_mmr")) : null;
    const dbStrategyMmr = existing.strategy_mmr !== null && existing.strategy_mmr !== undefined ? Number(existing.strategy_mmr) : (existing.mmr !== null && existing.mmr !== undefined ? Number(existing.mmr) : null);
    const strategyMmr = localStrategyMmr ?? dbStrategyMmr ?? 1200;

    const localClassicWins = localStorage.getItem("ca_local_classic_wins") ? Number(localStorage.getItem("ca_local_classic_wins")) : null;
    const classicWins = localClassicWins ?? Number(existing.classic_wins ?? 0);

    const localClassicDraws = localStorage.getItem("ca_local_classic_draws") ? Number(localStorage.getItem("ca_local_classic_draws")) : null;
    const classicDraws = localClassicDraws ?? Number(existing.classic_draws ?? 0);

    const localClassicLosses = localStorage.getItem("ca_local_classic_losses") ? Number(localStorage.getItem("ca_local_classic_losses")) : null;
    const classicLosses = localClassicLosses ?? Number(existing.classic_losses ?? 0);

    const localStrategyWins = localStorage.getItem("ca_local_strategy_wins") ? Number(localStorage.getItem("ca_local_strategy_wins")) : null;
    const strategyWins = localStrategyWins ?? Number(existing.strategy_wins ?? 0);

    const localStrategyDraws = localStorage.getItem("ca_local_strategy_draws") ? Number(localStorage.getItem("ca_local_strategy_draws")) : null;
    const strategyDraws = localStrategyDraws ?? Number(existing.strategy_draws ?? 0);

    const localStrategyLosses = localStorage.getItem("ca_local_strategy_losses") ? Number(localStorage.getItem("ca_local_strategy_losses")) : null;
    const strategyLosses = localStrategyLosses ?? Number(existing.strategy_losses ?? 0);

    const totalWins = classicWins + strategyWins;
    const totalDraws = classicDraws + strategyDraws;
    const totalLosses = classicLosses + strategyLosses;

    // 로컬 스토리지에 동기화 저장
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

    const synchronizedProfile: UserProfile = {
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
      createdAt: existing.created_at,
      updatedAt: existing.updated_at,
    };

    // DB에 최신 상태 백그라운드 동기화
    void client.from("profiles").upsert({
      id: synchronizedProfile.id,
      nickname: synchronizedProfile.nickname,
      mmr: classicMmr,
      classic_mmr: classicMmr,
      strategy_mmr: strategyMmr,
      wins: totalWins,
      losses: totalLosses,
      draws: totalDraws,
      classic_wins: classicWins,
      classic_draws: classicDraws,
      classic_losses: classicLosses,
      strategy_wins: strategyWins,
      strategy_draws: strategyDraws,
      strategy_losses: strategyLosses,
    });

    return synchronizedProfile;
  }

  // 신규 프로필 생성
  const savedNick = localStorage.getItem(NICKNAME_STORAGE_KEY) || generateRandomNickname();
  const savedClassicMmr = Number(localStorage.getItem("ca_local_classic_mmr") || localStorage.getItem("ca_local_mmr") || 1200);
  const savedStrategyMmr = Number(localStorage.getItem("ca_local_strategy_mmr") || localStorage.getItem("ca_local_mmr") || 1200);
  const savedClassicWins = Number(localStorage.getItem("ca_local_classic_wins") || 0);
  const savedClassicDraws = Number(localStorage.getItem("ca_local_classic_draws") || 0);
  const savedClassicLosses = Number(localStorage.getItem("ca_local_classic_losses") || 0);
  const savedStrategyWins = Number(localStorage.getItem("ca_local_strategy_wins") || 0);
  const savedStrategyDraws = Number(localStorage.getItem("ca_local_strategy_draws") || 0);
  const savedStrategyLosses = Number(localStorage.getItem("ca_local_strategy_losses") || 0);
  const savedWins = savedClassicWins + savedStrategyWins;
  const savedDraws = savedClassicDraws + savedStrategyDraws;
  const savedLosses = savedClassicLosses + savedStrategyLosses;

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
  };

  try {
    const { data: created, error: insertErr } = await client
      .from("profiles")
      .upsert(initialProfile, { onConflict: "id" })
      .select()
      .single();

    if (!insertErr && created) {
      const classicMmr = Number(created.classic_mmr ?? created.mmr ?? 1200);
      const strategyMmr = Number(created.strategy_mmr ?? created.mmr ?? 1200);
      return {
        id: created.id,
        nickname: created.nickname,
        mmr: classicMmr,
        classicMmr,
        strategyMmr,
        wins: Number(created.wins ?? savedWins),
        losses: Number(created.losses ?? savedLosses),
        draws: Number(created.draws ?? savedDraws),
        classicWins: Number(created.classic_wins ?? savedClassicWins),
        classicDraws: Number(created.classic_draws ?? savedClassicDraws),
        classicLosses: Number(created.classic_losses ?? savedClassicLosses),
        strategyWins: Number(created.strategy_wins ?? savedStrategyWins),
        strategyDraws: Number(created.strategy_draws ?? savedStrategyDraws),
        strategyLosses: Number(created.strategy_losses ?? savedStrategyLosses),
        createdAt: created.created_at,
        updatedAt: created.updated_at,
      };
    }
  } catch (err) {
    console.warn("프로필 DB 동기화 경고:", err);
  }

  return initialProfile;
}

/**
 * 이메일과 비밀번호로 회원가입한다.
 */
export async function signUpWithEmail(
  client: SupabaseClient,
  email: string,
  password: string,
  nickname: string,
): Promise<{ success: boolean; error?: string; user?: UserProfile }> {
  const cleanEmail = email.trim();
  const cleanNick = nickname.trim();

  if (!cleanEmail || !cleanEmail.includes("@")) {
    return { success: false, error: "올바른 이메일 주소를 입력해주세요." };
  }
  if (password.length < 6) {
    return { success: false, error: "비밀번호는 최소 6자 이상이어야 합니다." };
  }
  if (cleanNick.length < 2 || cleanNick.length > 20) {
    return { success: false, error: "닉네임은 2자 이상 20자 이하이어야 합니다." };
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
    return { success: false, error: signUpErr.message };
  }

  const authUser = signUpData.user;
  if (!authUser) {
    return { success: false, error: "회원가입 세션 생성에 실패했습니다." };
  }

  // 프로필 테이블 등록
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
  };

  await client
    .from("profiles")
    .upsert(newProfile, { onConflict: "id" });

  localStorage.setItem(NICKNAME_STORAGE_KEY, cleanNick);
  localStorage.setItem("ca_guest_user_uuid", authUser.id);
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

  return { success: true, user: newProfile };
}

/**
 * 이메일과 비밀번호로 로그인한다.
 */
export async function signInWithEmail(
  client: SupabaseClient,
  email: string,
  password: string,
): Promise<{ success: boolean; error?: string; user?: UserProfile }> {
  const cleanEmail = email.trim();
  if (!cleanEmail || !password) {
    return { success: false, error: "이메일과 비밀번호를 모두 입력해주세요." };
  }

  const { data: signInData, error: signInErr } = await client.auth.signInWithPassword({
    email: cleanEmail,
    password,
  });

  if (signInErr || !signInData.user) {
    return { success: false, error: signInErr?.message || "로그인 실패" };
  }

  localStorage.setItem("ca_guest_user_uuid", signInData.user.id);
  const profile = await getOrCreateUserProfile(client);
  return { success: true, user: profile };
}

/**
 * 로그아웃을 수행하고 게스트 상태로 전환한다.
 */
export async function signOutUser(client: SupabaseClient): Promise<void> {
  try {
    await client.auth.signOut();
  } catch {}
  localStorage.removeItem("ca_guest_user_uuid");
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
  const trimmed = newNickname.trim();
  if (trimmed.length < 2 || trimmed.length > 20) {
    return { success: false, error: "닉네임은 2자 이상 20자 이하이어야 합니다." };
  }

  const { error } = await client
    .from("profiles")
    .update({ nickname: trimmed, updated_at: new Date().toISOString() })
    .eq("id", userId);

  if (error) {
    if (error.code === "23505") {
      return { success: false, error: "이미 사용 중인 닉네임입니다." };
    }
    return { success: false, error: error.message };
  }

  localStorage.setItem(NICKNAME_STORAGE_KEY, trimmed);
  return { success: true };
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
