import type { SupabaseClient } from "@supabase/supabase-js";

export interface UserProfile {
  id: string;
  nickname: string;
  mmr: number;
  wins: number;
  losses: number;
  draws: number;
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
    return {
      id: existing.id,
      nickname: existing.nickname,
      mmr: Number(existing.mmr ?? 1200),
      wins: Number(existing.wins ?? 0),
      losses: Number(existing.losses ?? 0),
      draws: Number(existing.draws ?? 0),
      createdAt: existing.created_at,
      updatedAt: existing.updated_at,
    };
  }

  // 신규 프로필 생성
  const savedNick = localStorage.getItem(NICKNAME_STORAGE_KEY) || generateRandomNickname();
  const savedMmr = Number(localStorage.getItem("ca_local_mmr") || 1200);
  const savedWins = Number(localStorage.getItem("ca_local_wins") || 0);
  const savedLosses = Number(localStorage.getItem("ca_local_losses") || 0);
  const savedDraws = Number(localStorage.getItem("ca_local_draws") || 0);

  const initialProfile: UserProfile = {
    id: user.id,
    nickname: savedNick,
    mmr: savedMmr,
    wins: savedWins,
    losses: savedLosses,
    draws: savedDraws,
  };

  try {
    const { data: created, error: insertErr } = await client
      .from("profiles")
      .upsert(initialProfile, { onConflict: "id" })
      .select()
      .single();

    if (!insertErr && created) {
      return {
        id: created.id,
        nickname: created.nickname,
        mmr: Number(created.mmr ?? 1200),
        wins: Number(created.wins ?? 0),
        losses: Number(created.losses ?? 0),
        draws: Number(created.draws ?? 0),
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
    wins: 0,
    losses: 0,
    draws: 0,
  };

  await client
    .from("profiles")
    .upsert(newProfile, { onConflict: "id" });

  localStorage.setItem(NICKNAME_STORAGE_KEY, cleanNick);
  localStorage.setItem("ca_guest_user_uuid", authUser.id);
  localStorage.setItem("ca_local_mmr", "1200");
  localStorage.setItem("ca_local_wins", "0");
  localStorage.setItem("ca_local_losses", "0");
  localStorage.setItem("ca_local_draws", "0");

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
    .select("id, nickname, mmr, wins, losses, draws")
    .order("mmr", { ascending: false })
    .limit(limit);

  if (error || !data) {
    console.warn("랭킹 조회 실패:", error?.message);
    return [];
  }

  return data.map((item) => ({
    id: item.id,
    nickname: item.nickname,
    mmr: Number(item.mmr),
    wins: Number(item.wins),
    losses: Number(item.losses),
    draws: Number(item.draws),
  }));
}
