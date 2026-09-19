import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabaseClient } from "./supabase-client";
import type { UserProfile } from "./supabase-auth";
import { KING_MMR } from "./tier";
import { getFriendlyCopy } from "./friendly-copy";

export type UserStatus = "online" | "in_game" | "in_queue" | "offline";

export interface FriendProfile {
  id: string;
  nickname: string;
  classicMmr: number;
  strategyMmr: number;
  status: UserStatus;
  friendshipId?: string;
  isRequester?: boolean;
}

export interface FriendRequestItem {
  friendshipId: string;
  senderId: string;
  senderNickname: string;
  senderClassicMmr: number;
  senderStrategyMmr: number;
  createdAt: string;
}

export interface LeaderboardEntry {
  rank: number;
  id: string;
  nickname: string;
  mmr: number;
  wins: number;
  losses: number;
  draws?: number;
}

export interface MyRankResult {
  rank: number;
  mmr: number;
  totalPlayers: number;
}

export interface ChallengeRequestPayload {
  challengerId: string;
  challengerNickname: string;
  challengerMmr: number;
  mode: "classic" | "strategy";
  roomId: string;
}

export interface ChallengeResponsePayload {
  responderId: string;
  roomId: string;
  accepted: boolean;
}

export class SocialService {
  private static userNotificationChannel: RealtimeChannel | null = null;
  private static globalPresenceChannel: RealtimeChannel | null = null;
  private static myProfile: UserProfile | null = null;
  private static currentStatus: UserStatus = "online";
  private static presenceUsers: Map<string, UserStatus> = new Map();
  private static presenceListeners: Set<() => void> = new Set();
  private static onChallengeCallback: ((payload: ChallengeRequestPayload) => void) | null = null;
  private static challengeResponseCallbacks: Map<string, (accepted: boolean) => void> = new Map();

  public static setChallengeHandler(handler: (payload: ChallengeRequestPayload) => void): void {
    this.onChallengeCallback = handler;
  }

  public static cancelChallenge(roomId: string): void {
    this.challengeResponseCallbacks.get(roomId)?.(false);
    this.challengeResponseCallbacks.delete(roomId);
  }

  /**
   * 소셜 서비스 초기화 (로그인 시 1회 호출)
   */
  public static init(
    profile: UserProfile,
    onChallengeReceived?: (payload: ChallengeRequestPayload) => void,
  ): void {
    this.myProfile = profile;
    if (onChallengeReceived) this.onChallengeCallback = onChallengeReceived;

    const sb = getSupabaseClient();
    if (!sb) return;

    // 1. 개인 알림 채널 (1:1 대전 신청 / 응답 수신)
    if (this.userNotificationChannel) {
      void this.userNotificationChannel.unsubscribe();
    }

    this.userNotificationChannel = sb.channel(`user_notify:${profile.id}`, {
      config: { broadcast: { self: false } },
    });

    this.userNotificationChannel
      .on("broadcast", { event: "challenge_request" }, ({ payload }) => {
        if (this.onChallengeCallback) {
          this.onChallengeCallback(payload as ChallengeRequestPayload);
        }
      })
      .on("broadcast", { event: "challenge_response" }, ({ payload }) => {
        const resp = payload as ChallengeResponsePayload;
        const cb = this.challengeResponseCallbacks.get(resp.roomId);
        if (cb) {
          cb(resp.accepted);
          this.challengeResponseCallbacks.delete(resp.roomId);
        }
      })
      .subscribe();

    // 2. 글로벌 로비 실시간 Presence (온라인 / 인게임 상태 공유)
    if (this.globalPresenceChannel) {
      void this.globalPresenceChannel.unsubscribe();
    }

    this.globalPresenceChannel = sb.channel("global_presence", {
      config: { presence: { key: profile.id } },
    });

    this.globalPresenceChannel
      .on("presence", { event: "sync" }, () => {
        const state = this.globalPresenceChannel?.presenceState() || {};
        this.presenceUsers.clear();
        Object.keys(state).forEach((userId) => {
          const presences = state[userId];
          if (Array.isArray(presences) && presences.length > 0) {
            const p = presences[0] as { status?: UserStatus };
            this.presenceUsers.set(userId, p.status || "online");
          }
        });
        this.presenceListeners.forEach((listener) => listener());
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await this.updateMyStatus(this.currentStatus);
        }
      });
  }

  /**
   * 내 실시간 상태 변경 (온라인, 인게임, 매칭 중)
   */
  public static async updateMyStatus(status: UserStatus): Promise<void> {
    this.currentStatus = status;
    if (!this.globalPresenceChannel || !this.myProfile) return;

    await this.globalPresenceChannel.track({
      userId: this.myProfile.id,
      nickname: this.myProfile.nickname,
      status: this.currentStatus,
    });
  }

  /**
   * Presence 변경 리스너 등록
   */
  public static subscribePresence(listener: () => void): () => void {
    this.presenceListeners.add(listener);
    return () => this.presenceListeners.delete(listener);
  }

  /**
   * 유저의 실시간 상태 조회
   */
  public static getUserStatus(userId: string): UserStatus {
    return this.presenceUsers.get(userId) || "offline";
  }

  /**
   * 랭킹 리더보드 조회 (클래식 / 전략 / 킹 필터)
   */
  public static async getLeaderboard(
    mode: "classic" | "strategy" = "classic",
    limit: number = 50,
    kingOnly: boolean = false,
  ): Promise<LeaderboardEntry[] | null> {
    const sb = getSupabaseClient();
    if (!sb) return null;

    try {
      const mmrCol = mode === "classic" ? "classic_mmr" : "strategy_mmr";
      const winsCol = mode === "classic" ? "classic_wins" : "strategy_wins";
      const lossesCol = mode === "classic" ? "classic_losses" : "strategy_losses";
      const drawsCol = mode === "classic" ? "classic_draws" : "strategy_draws";

      let query = sb
        .from("profiles")
        .select(`id, nickname, ${mmrCol}, ${winsCol}, ${lossesCol}, ${drawsCol}`);

      if (kingOnly) {
        query = query.gte(mmrCol, KING_MMR);
      }

      const { data: rows, error: qErr } = await query
        .order(mmrCol, { ascending: false })
        .order(winsCol, { ascending: false })
        .order("id", { ascending: true })
        .limit(limit);

      if (qErr || !rows) return null;

      let currentRank = 1;
      return rows.map((r: Record<string, unknown>, idx: number) => {
        const mmr = Number(r[mmrCol] ?? 1000);
        if (idx > 0) {
          const prevRow = rows[idx - 1] as Record<string, unknown>;
          const prevMmr = Number(prevRow[mmrCol] ?? 1000);
          if (mmr < prevMmr) {
            currentRank = idx + 1;
          }
        }
        return {
          rank: currentRank,
          id: String(r.id),
          nickname: String(r.nickname || "플레이어"),
          mmr,
          wins: Number(r[winsCol] ?? 0),
          losses: Number(r[lossesCol] ?? 0),
          draws: Number(r[drawsCol] ?? 0),
        };
      });
    } catch (err) {
      console.error("getLeaderboard error:", err);
      return null;
    }
  }

  /**
   * 내 순위 조회 (클래식 / 전략 / 킹 필터)
   */
  public static async getMyRank(
    userId: string,
    mode: "classic" | "strategy" = "classic",
    kingOnly: boolean = false,
  ): Promise<MyRankResult | null> {
    if (!userId || userId === "local_guest") return null;
    const sb = getSupabaseClient();
    if (!sb) return null;

    try {
      const mmrCol = mode === "classic" ? "classic_mmr" : "strategy_mmr";

      // 1. 내 MMR 조회
      const { data: me, error: meErr } = await sb
        .from("profiles")
        .select(`id, ${mmrCol}`)
        .eq("id", userId)
        .maybeSingle();

      if (meErr || !me) {
        return null;
      }

      const myMmr = Number((me as Record<string, unknown>)[mmrCol] ?? 1200);

      // 2. 킹 랭킹 모드인데 내 MMR이 킹 기준 미만이면 킹 순위 없음
      if (kingOnly && myMmr < KING_MMR) {
        return null;
      }

      // 3. 나보다 MMR이 엄격히 높은(#people strictly higher) 플레이어 수 카운트
      // (kingOnly 모드라도 myMmr >= KING_MMR이 보장되므로 gt(mmrCol, myMmr) 대상은 자동으로 킹)
      const higherQuery = sb
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .gt(mmrCol, myMmr);

      const { count: higherCount, error: higherErr } = await higherQuery;
      if (higherErr) return null;

      // 4. 전체 플레이어 수 카운트 (킹 모드면 킹 기준 이상만)
      let totalQuery = sb
        .from("profiles")
        .select("id", { count: "exact", head: true });

      if (kingOnly) {
        totalQuery = totalQuery.gte(mmrCol, KING_MMR);
      }

      const { count: totalCount, error: totalErr } = await totalQuery;
      if (totalErr) return null;

      const higher = higherCount ?? 0;
      const total = totalCount ?? 0;

      return {
        rank: higher + 1,
        mmr: myMmr,
        totalPlayers: Math.max(higher + 1, total),
      };
    } catch (err) {
      console.error("getMyRank error:", err);
      return null;
    }
  }

  /**
   * 친구 목록 조회
   */
  public static async getFriendsList(myUserId: string): Promise<FriendProfile[] | null> {
    const sb = getSupabaseClient();
    if (!sb) return null;

    try {
      const { data, error } = await sb
        .from("friendships")
        .select("id, requester_id, addressee_id, status, requester:profiles!requester_id(*), addressee:profiles!addressee_id(*)")
        .eq("status", "accepted")
        .or(`requester_id.eq.${myUserId},addressee_id.eq.${myUserId}`);

      if (error || !data) return null;

      const list: FriendProfile[] = [];
      for (const row of data as any[]) {
        const isRequester = row.requester_id === myUserId;
        const friendData = isRequester ? row.addressee : row.requester;
        if (!friendData) continue;

        list.push({
          id: friendData.id,
          nickname: friendData.nickname || "친구",
          classicMmr: friendData.classic_mmr ?? friendData.mmr ?? 1000,
          strategyMmr: friendData.strategy_mmr ?? friendData.mmr ?? 1000,
          status: this.getUserStatus(friendData.id),
          friendshipId: row.id,
        });
      }
      return list;
    } catch (err) {
      console.error("getFriendsList error:", err);
      return null;
    }
  }

  /**
   * 받은 친구 요청 목록 조회
   */
  public static async getPendingRequests(myUserId: string): Promise<FriendRequestItem[] | null> {
    const sb = getSupabaseClient();
    if (!sb) return null;

    try {
      const { data, error } = await sb
        .from("friendships")
        .select("id, requester_id, created_at, requester:profiles!requester_id(*)")
        .eq("addressee_id", myUserId)
        .eq("status", "pending");

      if (error || !data) return null;

      return (data as any[]).map((row) => ({
        friendshipId: row.id,
        senderId: row.requester_id,
        senderNickname: row.requester?.nickname || "플레이어",
        senderClassicMmr: row.requester?.classic_mmr ?? 1000,
        senderStrategyMmr: row.requester?.strategy_mmr ?? 1000,
        createdAt: row.created_at,
      }));
    } catch (err) {
      console.error("getPendingRequests error:", err);
      return null;
    }
  }

  /**
   * 닉네임으로 유저 검색 및 친구 요청 보내기
   */
  public static async sendFriendRequest(
    myUserId: string,
    targetNickname: string,
    targetUserId?: string,
  ): Promise<{ success: boolean; error?: string }> {
    const sb = getSupabaseClient();
    if (!sb) return { success: false, error: "Supabase 연결 없음" };

    try {
      // 1. 닉네임으로 타겟 유저 찾기
      const query = sb.from("profiles").select("id, nickname");
      const { data: targetUser, error: searchErr } = await (targetUserId
        ? query.eq("id", targetUserId)
        : query.ilike("nickname", targetNickname.trim())).single();

      if (searchErr || !targetUser) {
        return { success: false, error: "user_not_found" };
      }

      if (targetUser.id === myUserId) {
        return { success: false, error: "cannot_add_self" };
      }

      // 2. 이미 존재하는 요청인지 확인
      const { data: existing } = await sb
        .from("friendships")
        .select("id, status")
        .or(`and(requester_id.eq.${myUserId},addressee_id.eq.${targetUser.id}),and(requester_id.eq.${targetUser.id},addressee_id.eq.${myUserId})`)
        .maybeSingle();

      if (existing) {
        return { success: false, error: "request_already_sent" };
      }

      // 3. 친구 요청 생성
      const { error: insertErr } = await sb.from("friendships").insert({
        requester_id: myUserId,
        addressee_id: targetUser.id,
        status: "pending",
      });

      if (insertErr) {
        return { success: false, error: insertErr.message };
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  /**
   * 친구 요청 수락 / 거절
   */
  public static async respondFriendRequest(
    friendshipId: string,
    accept: boolean,
  ): Promise<boolean> {
    const sb = getSupabaseClient();
    if (!sb) return false;

    try {
      if (accept) {
        const { error } = await sb
          .from("friendships")
          .update({ status: "accepted", updated_at: new Date().toISOString() })
          .eq("id", friendshipId);
        return !error;
      } else {
        const { error } = await sb
          .from("friendships")
          .delete()
          .eq("id", friendshipId);
        return !error;
      }
    } catch (err) {
      console.error("respondFriendRequest error:", err);
      return false;
    }
  }

  /**
   * 친구 삭제
   */
  public static async deleteFriend(friendshipId: string): Promise<boolean> {
    const sb = getSupabaseClient();
    if (!sb) return false;

    try {
      const { error } = await sb
        .from("friendships")
        .delete()
        .eq("id", friendshipId);
      return !error;
    } catch (err) {
      console.error("deleteFriend error:", err);
      return false;
    }
  }

  /**
   * 1:1 대전 신청 전송
   */
  public static async sendChallenge(
    targetUserId: string,
    mode: "classic" | "strategy" = "classic",
  ): Promise<{ roomId: string; responsePromise: Promise<boolean> }> {
    const sb = getSupabaseClient();
    if (!sb || !this.myProfile) {
      throw new Error("소셜 서비스가 초기화되지 않았습니다.");
    }

    const roomId = `friendly_${this.myProfile.id}_${Date.now()}`;
    const myMmr = mode === "classic" ? this.myProfile.classicMmr : this.myProfile.strategyMmr;

    const payload: ChallengeRequestPayload = {
      challengerId: this.myProfile.id,
      challengerNickname: this.myProfile.nickname,
      challengerMmr: myMmr ?? 1000,
      mode,
      roomId,
    };

    const responsePromise = new Promise<boolean>((resolve) => {
      this.challengeResponseCallbacks.set(roomId, resolve);
      // 15초 타임아웃
      setTimeout(() => {
        if (this.challengeResponseCallbacks.has(roomId)) {
          this.challengeResponseCallbacks.delete(roomId);
          resolve(false);
        }
      }, 15000);
    });

    // Register the response before sending: a fast accept must not be dropped.
    const channel = sb.channel(`user_notify:${targetUserId}`);
    try {
      const result = await channel.send({ type: "broadcast", event: "challenge_request", payload });
      if (result !== "ok") throw new Error(getFriendlyCopy('peer_error'));
    } catch (error) {
      this.challengeResponseCallbacks.get(roomId)?.(false);
      this.challengeResponseCallbacks.delete(roomId);
      throw error;
    } finally { await sb.removeChannel(channel); }

    return { roomId, responsePromise };
  }

  /**
   * 1:1 대전 신청 수락 / 거절 응답 전송
   */
  public static async respondChallenge(
    challengerId: string,
    roomId: string,
    isAccepted: boolean,
  ): Promise<void> {
    const sb = getSupabaseClient();
    if (!sb || !this.myProfile) return;

    const channel = sb.channel(`user_notify:${challengerId}`);
    try { const result = await channel.send({
      type: "broadcast",
      event: "challenge_response",
      payload: {
        responderId: this.myProfile.id,
        roomId,
        accepted: isAccepted,
      } as ChallengeResponsePayload,
    });
    if (result !== "ok") throw new Error(getFriendlyCopy('peer_error'));
    } finally { await sb.removeChannel(channel); }
  }

  /**
   * 리소스 정리
   */
  public static cleanup(): void {
    if (this.userNotificationChannel) {
      void this.userNotificationChannel.unsubscribe();
      this.userNotificationChannel = null;
    }
    if (this.globalPresenceChannel) {
      void this.globalPresenceChannel.unsubscribe();
      this.globalPresenceChannel = null;
    }
    this.presenceUsers.clear();
    this.presenceListeners.clear();
    this.challengeResponseCallbacks.forEach(resolve => resolve(false));
    this.challengeResponseCallbacks.clear();
    this.myProfile = null;
  }
}
