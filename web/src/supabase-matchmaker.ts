import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type { PieceSide } from "./layout";
import type { OnlineTransport } from "./online";
import type { PeerDisconnectCause, PeerLinkState } from "./net";
import type { UserProfile } from "./supabase-auth";

const STUN_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];
const DATA_CHANNEL_LABEL = "chess-alkkaegi-p2p";

export type MatchmakingPhase =
  | "idle"
  | "joining-queue"
  | "searching"
  | "match-found"
  | "signaling"
  | "connected"
  | "cancelled"
  | "error";

export interface MatchmakingStatus {
  phase: MatchmakingPhase;
  message: string;
  waitTimeSeconds: number;
  allowedMmrDiff: number;
  opponent?: {
    id: string;
    nickname: string;
    mmr: number;
  };
}

export interface MatchResultPayload {
  winnerId: string | null;
  loserId: string | null;
  isDraw: boolean;
  whitePlayerId: string;
  blackPlayerId: string;
  whiteIsWinner: boolean;
}

export interface EloDeltaResult {
  winnerDelta: number;
  loserDelta: number;
  isDraw: boolean;
}

interface PresencePayload {
  id: string;
  nickname: string;
  mmr: number;
  joinedAt: number;
  targetMatchId?: string;
}

type SignalMessage =
  | {
      type: "match-proposal";
      matchId: string;
      fromId: string;
      toId: string;
      hostId: string;
      guestId: string;
    }
  | {
      type: "offer";
      matchId: string;
      fromId: string;
      toId: string;
      sdp: string;
    }
  | {
      type: "answer";
      matchId: string;
      fromId: string;
      toId: string;
      sdp: string;
    }
  | {
      type: "ice";
      matchId: string;
      fromId: string;
      toId: string;
      candidate: RTCIceCandidateInit;
    };

/**
 * WebRTC DataChannel을 OnlineTransport 인터페이스로 래핑하는 어댑터 클래스
 */
class WebRtcOnlineTransport implements OnlineTransport {
  public disconnectCause: PeerDisconnectCause = null;
  private peerConnection: RTCPeerConnection;
  private dataChannel: RTCDataChannel;
  private messageListeners = new Set<(payload: object) => void>();
  private stateListeners = new Set<(state: PeerLinkState) => void>();
  private currentState: PeerLinkState = "connected";
  private bufferedMessages: object[] = [];

  constructor(pc: RTCPeerConnection, dc: RTCDataChannel) {
    this.peerConnection = pc;
    this.dataChannel = dc;

    this.setupDataChannel(dc);
    this.setupPeerConnection(pc);
  }

  private setupDataChannel(dc: RTCDataChannel): void {
    dc.onopen = () => {
      this.setState("connected");
    };

    dc.onclose = () => {
      if (this.disconnectCause === null) {
        this.disconnectCause = "graceful-close";
      }
      this.setState("disconnected");
    };

    dc.onerror = () => {
      this.disconnectCause = "data-channel-error";
      this.setState("failed");
    };

    dc.onmessage = (event: MessageEvent) => {
      if (typeof event.data !== "string") return;
      try {
        const payload = JSON.parse(event.data);
        if (typeof payload === "object" && payload !== null) {
          if (this.messageListeners.size === 0) {
            this.bufferedMessages.push(payload);
          } else {
            for (const listener of this.messageListeners) {
              listener(payload);
            }
          }
        }
      } catch (err) {
        console.warn("P2P 메시지 파싱 오류:", err);
      }
    };
  }

  private setupPeerConnection(pc: RTCPeerConnection): void {
    pc.onconnectionstatechange = () => {
      switch (pc.connectionState) {
        case "connected":
          this.setState("connected");
          break;
        case "disconnected":
          if (this.disconnectCause === null) {
            this.disconnectCause = "traffic-timeout";
          }
          this.setState("disconnected");
          break;
        case "failed":
          this.disconnectCause = "peer-connection-failed";
          this.setState("failed");
          break;
        case "closed":
          this.setState("disconnected");
          break;
      }
    };
  }

  private setState(state: PeerLinkState): void {
    if (this.currentState === state) return;
    this.currentState = state;
    for (const listener of this.stateListeners) {
      listener(state);
    }
  }

  public send(payload: object): void {
    if (this.dataChannel.readyState === "open") {
      this.dataChannel.send(JSON.stringify(payload));
    }
  }

  public onMessage(handler: (payload: object) => void): () => void {
    this.messageListeners.add(handler);
    // 버퍼된 메시지 즉시 방출
    if (this.bufferedMessages.length > 0) {
      const pending = [...this.bufferedMessages];
      this.bufferedMessages = [];
      for (const msg of pending) {
        handler(msg);
      }
    }
    return () => {
      this.messageListeners.delete(handler);
    };
  }

  public onStateChange(handler: (state: PeerLinkState) => void): () => void {
    this.stateListeners.add(handler);
    handler(this.currentState);
    return () => {
      this.stateListeners.delete(handler);
    };
  }

  public close(): void {
    try {
      this.dataChannel.close();
    } catch {}
    try {
      this.peerConnection.close();
    } catch {}
    this.setState("disconnected");
  }
}

export class SupabaseMatchmaker {
  private client: SupabaseClient;
  private user: UserProfile;
  private channel: RealtimeChannel | null = null;
  private evalTimer: number | null = null;
  private startTime = 0;
  private activeMatchId: string | null = null;
  private isHost = false;
  private opponentProfile: { id: string; nickname: string; mmr: number } | null = null;
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private statusCallback: ((status: MatchmakingStatus) => void) | null = null;
  private matchReadyCallback:
    | ((transport: OnlineTransport, mySide: PieceSide, matchId: string, opponent: { id: string; nickname: string; mmr: number }) => void)
    | null = null;
  private errorCallback: ((error: Error) => void) | null = null;
  private isCancelled = false;

  constructor(client: SupabaseClient, user: UserProfile) {
    this.client = client;
    this.user = user;
  }

  /**
   * 대기열 참가 및 자동 매칭 탐색 시작
   */
  public startMatching(
    onStatus: (status: MatchmakingStatus) => void,
    onReady: (transport: OnlineTransport, mySide: PieceSide, matchId: string, opponent: { id: string; nickname: string; mmr: number }) => void,
    onError: (error: Error) => void,
  ): void {
    this.cleanup();
    this.isCancelled = false;
    this.statusCallback = onStatus;
    this.matchReadyCallback = onReady;
    this.errorCallback = onError;
    this.startTime = Date.now();

    this.updateStatus("joining-queue", "매치메이킹 대기열에 접속 중...");

    const channelName = "ca-matchmaking-room";
    this.channel = this.client.channel(channelName, {
      config: {
        presence: { key: this.user.id },
        broadcast: { ack: false },
      },
    });

    this.channel
      .on("presence", { event: "sync" }, () => this.evaluateQueue())
      .on("presence", { event: "join" }, () => this.evaluateQueue())
      .on("broadcast", { event: "webrtc-signal" }, ({ payload }) => {
        this.handleIncomingSignal(payload as SignalMessage);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          this.updateStatus("searching", "적합한 MMR의 상대를 탐색 중...");
          await this.channel?.track({
            id: this.user.id,
            nickname: this.user.nickname,
            mmr: this.user.mmr,
            joinedAt: this.startTime,
          } satisfies PresencePayload);

          // 2초마다 큐 재평가 및 타이머 가동
          this.evalTimer = window.setInterval(() => {
            if (this.isCancelled) return;
            this.evaluateQueue();
          }, 2000);
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          this.handleError(new Error(`매칭 채널 연결 오류: ${status}`));
        }
      });
  }

  /**
   * Expanding Queue 매칭 적합도 검사
   */
  private evaluateQueue(): void {
    if (!this.channel || this.activeMatchId || this.isCancelled) return;

    const presenceState = this.channel.presenceState<PresencePayload>();
    const now = Date.now();
    const waitTimeSeconds = Math.max(0, Math.floor((now - this.startTime) / 1000));
    const allowedMmrDiff = Math.min(1000, 50 + waitTimeSeconds * 10);

    this.updateStatus("searching", `상대 탐색 중... (MMR ±${allowedMmrDiff})`, waitTimeSeconds, allowedMmrDiff);

    // 대기열 내의 후보 탐색
    for (const key in presenceState) {
      const presences = presenceState[key];
      if (!presences || presences.length === 0) continue;
      const candidate = presences[0];

      if (candidate.id === this.user.id) continue;
      if (candidate.targetMatchId) continue; // 이미 다른 매칭 진행 중

      const mmrDiff = Math.abs(this.user.mmr - candidate.mmr);
      if (mmrDiff <= allowedMmrDiff) {
        // 매칭 성사 결정: 오직 UUID가 더 작은 Host만 initiateMatch를 주도적으로 실행
        if (this.user.id < candidate.id) {
          const cleanHost = this.user.id.replace(/[^a-zA-Z0-9]/g, "").substring(0, 8);
          const cleanGuest = candidate.id.replace(/[^a-zA-Z0-9]/g, "").substring(0, 8);
          const matchId = `match-${cleanHost}-${cleanGuest}-${Date.now().toString(36)}`;

          this.initiateMatch(matchId, this.user.id, candidate.id, candidate);
        } else {
          // Guest는 Host로부터 match-proposal 시그널이 오기를 대기
          this.updateStatus("searching", `상대 발견 대기 중 (${candidate.nickname})...`, waitTimeSeconds, allowedMmrDiff);
        }
        break;
      }
    }
  }

  /**
   * 매칭 시작 및 P2P 시그널링 트리거
   */
  private async initiateMatch(
    matchId: string,
    hostId: string,
    guestId: string,
    opponentInfo: { id: string; nickname: string; mmr: number },
  ): Promise<void> {
    if (this.activeMatchId) return;
    this.activeMatchId = matchId;
    this.isHost = this.user.id === hostId;
    this.opponentProfile = opponentInfo;

    this.updateStatus("match-found", `대전 상대 발견: ${opponentInfo.nickname} (${opponentInfo.mmr})`, 0, 0, opponentInfo);

    if (this.isHost) {
      // Host: 제안 브로드캐스트 및 Offer 생성
      await this.sendSignal({
        type: "match-proposal",
        matchId,
        fromId: this.user.id,
        toId: guestId,
        hostId,
        guestId,
      });

      await this.setupHostWebRTC(guestId, matchId);
    }
  }

  /**
   * 시그널링 메시지 수신 핸들러
   */
  private async handleIncomingSignal(signal: SignalMessage): Promise<void> {
    if (this.isCancelled || !signal || signal.toId !== this.user.id) return;

    try {
      if (signal.type === "match-proposal") {
        if (!this.activeMatchId) {
          this.activeMatchId = signal.matchId;
          this.isHost = false;
          const presenceState = this.channel?.presenceState<PresencePayload>() || {};
          const hostPresence = presenceState[signal.hostId]?.[0];
          this.opponentProfile = {
            id: signal.hostId,
            nickname: hostPresence?.nickname || "상대 플레이어",
            mmr: hostPresence?.mmr || 1200,
          };
          this.updateStatus(
            "match-found",
            `대전 상대 발견: ${this.opponentProfile.nickname}`,
            0,
            0,
            this.opponentProfile,
          );
          await this.setupGuestWebRTC(signal.hostId, signal.matchId);
        }
      } else if (signal.type === "offer" && signal.matchId === this.activeMatchId) {
        if (!this.isHost && this.peerConnection) {
          this.updateStatus("signaling", "P2P 연결 수립 중 (Answer 전송)...");
          await this.peerConnection.setRemoteDescription({
            type: "offer",
            sdp: signal.sdp,
          });
          const answer = await this.peerConnection.createAnswer();
          await this.peerConnection.setLocalDescription(answer);

          await this.sendSignal({
            type: "answer",
            matchId: this.activeMatchId,
            fromId: this.user.id,
            toId: signal.fromId,
            sdp: answer.sdp || "",
          });
        }
      } else if (signal.type === "answer" && signal.matchId === this.activeMatchId) {
        if (this.isHost && this.peerConnection) {
          this.updateStatus("signaling", "P2P 연결 확정 중...");
          await this.peerConnection.setRemoteDescription({
            type: "answer",
            sdp: signal.sdp,
          });
        }
      } else if (signal.type === "ice" && signal.matchId === this.activeMatchId) {
        if (this.peerConnection && signal.candidate) {
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate));
        }
      }
    } catch (err: any) {
      console.warn("시그널링 처리 오류:", err);
    }
  }

  /**
   * Host WebRTC RTCPeerConnection 설정 및 DataChannel 생성
   */
  private async setupHostWebRTC(guestId: string, matchId: string): Promise<void> {
    this.updateStatus("signaling", "P2P 연결 준비 중 (Offer 생성)...");
    const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
    this.peerConnection = pc;

    const dc = pc.createDataChannel(DATA_CHANNEL_LABEL, { ordered: true });
    this.dataChannel = dc;

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal({
          type: "ice",
          matchId,
          fromId: this.user.id,
          toId: guestId,
          candidate: event.candidate.toJSON(),
        });
      }
    };

    dc.onopen = () => {
      this.onConnectionEstablished(pc, dc, "white", matchId);
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    await this.sendSignal({
      type: "offer",
      matchId,
      fromId: this.user.id,
      toId: guestId,
      sdp: offer.sdp || "",
    });
  }

  /**
   * Guest WebRTC RTCPeerConnection 설정
   */
  private async setupGuestWebRTC(hostId: string, matchId: string): Promise<void> {
    this.updateStatus("signaling", "P2P 연결 응답 중...");
    const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
    this.peerConnection = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal({
          type: "ice",
          matchId,
          fromId: this.user.id,
          toId: hostId,
          candidate: event.candidate.toJSON(),
        });
      }
    };

    pc.ondatachannel = (event) => {
      const dc = event.channel;
      this.dataChannel = dc;
      dc.onopen = () => {
        this.onConnectionEstablished(pc, dc, "black", matchId);
      };
    };
  }

  /**
   * P2P 연결 성공 시 인게임 런타임 전환
   */
  private onConnectionEstablished(
    pc: RTCPeerConnection,
    dc: RTCDataChannel,
    mySide: PieceSide,
    matchId: string,
  ): void {
    if (this.evalTimer !== null) {
      clearInterval(this.evalTimer);
      this.evalTimer = null;
    }

    // 대기열에서 본인 상태 언트랙
    this.channel?.untrack();

    this.updateStatus("connected", "P2P 연결 성공! 게임을 시작합니다.");

    const transport = new WebRtcOnlineTransport(pc, dc);
    if (this.matchReadyCallback && this.opponentProfile) {
      this.matchReadyCallback(transport, mySide, matchId, this.opponentProfile);
    }
  }

  private async sendSignal(message: SignalMessage): Promise<void> {
    if (!this.channel) return;
    await this.channel.send({
      type: "broadcast",
      event: "webrtc-signal",
      payload: message,
    });
  }

  private updateStatus(
    phase: MatchmakingPhase,
    message: string,
    waitTime = 0,
    allowedMmr = 50,
    opponent?: { id: string; nickname: string; mmr: number },
  ): void {
    if (this.statusCallback) {
      this.statusCallback({
        phase,
        message,
        waitTimeSeconds: waitTime,
        allowedMmrDiff: allowedMmr,
        opponent,
      });
    }
  }

  private handleError(err: Error): void {
    this.cleanup();
    this.updateStatus("error", err.message);
    if (this.errorCallback) {
      this.errorCallback(err);
    }
  }

  /**
   * 매칭 대기열 취소
   */
  public cancel(): void {
    this.isCancelled = true;
    this.cleanup();
    this.updateStatus("cancelled", "매칭이 취소되었습니다.");
  }

  private cleanup(): void {
    if (this.evalTimer !== null) {
      clearInterval(this.evalTimer);
      this.evalTimer = null;
    }
    if (this.channel) {
      try {
        this.channel.untrack();
      } catch {}
      try {
        this.client.removeChannel(this.channel);
      } catch {}
      this.channel = null;
    }
    if (this.dataChannel) {
      try {
        this.dataChannel.close();
      } catch {}
      this.dataChannel = null;
    }
    if (this.peerConnection) {
      try {
        this.peerConnection.close();
      } catch {}
      this.peerConnection = null;
    }
    this.activeMatchId = null;
    this.opponentProfile = null;
    this.isHost = false;
  }

  /**
   * 경기 결과 Supabase RPC (finish_match) 정산 호출
   */
  public static async recordMatchResult(
    client: SupabaseClient,
    result: MatchResultPayload,
  ): Promise<EloDeltaResult | null> {
    try {
      const winnerId = result.winnerId || result.whitePlayerId;
      const loserId = result.loserId || result.blackPlayerId;

      const { data, error } = await client.rpc("finish_match", {
        p_winner_id: winnerId,
        p_loser_id: loserId,
        p_is_draw: result.isDraw,
        p_white_is_winner: result.whiteIsWinner,
      });

      if (error) {
        console.warn("finish_match RPC 호출 실패:", error.message);
        return null;
      }

      return {
        winnerDelta: Number(data?.winner_delta ?? 16),
        loserDelta: Number(data?.loser_delta ?? -16),
        isDraw: Boolean(data?.is_draw ?? false),
      };
    } catch (err) {
      console.warn("MMR 정산 처리 예외:", err);
      return null;
    }
  }
}
