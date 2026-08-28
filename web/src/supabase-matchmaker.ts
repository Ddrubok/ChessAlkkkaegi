import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type { PieceSide } from "./layout";
import type { OnlineTransport } from "./online";
import type { PeerDisconnectCause, PeerLinkState } from "./net";
import type { UserProfile } from "./supabase-auth";

const RTC_CONFIGURATION: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
  ],
  iceCandidatePoolSize: 2,
};
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
  mode: "classic" | "strategy";
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
  private pendingIceCandidates: RTCIceCandidateInit[] = [];
  private isConnectionEstablished = false;
  private signalingTimeoutTimer: number | null = null;
  private failedOpponentsCooldown: Map<string, number> = new Map();

  private queueMode: "classic" | "strategy";

  constructor(client: SupabaseClient, user: UserProfile, queueMode: "classic" | "strategy" = "classic") {
    this.client = client;
    this.user = user;
    this.queueMode = queueMode;
  }

  /**
   * 대기열 참가 및 자동 매칭 탐색 시작
   */
  public async startMatching(
    onStatus: (status: MatchmakingStatus) => void,
    onReady: (transport: OnlineTransport, mySide: PieceSide, matchId: string, opponent: { id: string; nickname: string; mmr: number }) => void,
    onError: (error: Error) => void,
  ): Promise<void> {
    await this.cleanup();
    this.isCancelled = false;
    this.isConnectionEstablished = false;
    this.pendingIceCandidates = [];
    this.statusCallback = onStatus;
    this.matchReadyCallback = onReady;
    this.errorCallback = onError;
    this.startTime = Date.now();

    this.updateStatus("joining-queue", "매치메이킹 대기열에 접속 중...");

    const currentMmr = this.queueMode === "strategy" ? (this.user.strategyMmr ?? this.user.mmr) : (this.user.classicMmr ?? this.user.mmr);
    const channelName = `ca-matchmaking-${this.queueMode}`;
    
    // Supabase 클라이언트에 남아있는 이전 채널 인스턴스 정리
    const existingChannels = this.client.getChannels();
    for (const ch of existingChannels) {
      if (ch.topic === `realtime:${channelName}`) {
        try {
          await this.client.removeChannel(ch);
        } catch {}
      }
    }

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
        void this.handleIncomingSignal(payload as SignalMessage);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          this.updateStatus("searching", "적합한 MMR의 상대를 탐색 중...");
          await this.channel?.track({
            id: this.user.id,
            nickname: this.user.nickname,
            mmr: currentMmr,
            joinedAt: this.startTime,
          } satisfies PresencePayload);

          // 2초마다 큐 재평가 및 타이머 가동
          this.evalTimer = window.setInterval(() => {
            if (this.isCancelled || this.activeMatchId || this.isConnectionEstablished) return;
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
    if (!this.channel || this.activeMatchId || this.opponentProfile || this.isCancelled || this.isConnectionEstablished) return;

    const presenceState = this.channel.presenceState<PresencePayload>();
    const now = Date.now();

    // 쿨다운 만료 정리
    for (const [id, exp] of this.failedOpponentsCooldown.entries()) {
      if (now > exp) this.failedOpponentsCooldown.delete(id);
    }

    const waitTimeSeconds = Math.max(0, Math.floor((now - this.startTime) / 1000));
    const allowedMmrDiff = Math.min(1000, 50 + waitTimeSeconds * 10);

    const currentMmr = this.queueMode === "strategy" ? (this.user.strategyMmr ?? this.user.mmr) : (this.user.classicMmr ?? this.user.mmr);

    this.updateStatus("searching", `상대 탐색 중... (MMR ±${allowedMmrDiff})`, waitTimeSeconds, allowedMmrDiff);

    // 대기열 내의 후보 탐색
    for (const key in presenceState) {
      const presences = presenceState[key];
      if (!presences || presences.length === 0) continue;
      const candidate = presences[0];

      if (candidate.id.toLowerCase() === this.user.id.toLowerCase()) continue;
      if (this.failedOpponentsCooldown.has(candidate.id)) continue;
      if (candidate.targetMatchId) continue; // 이미 다른 매칭 진행 중

      const mmrDiff = Math.abs(currentMmr - candidate.mmr);
      if (mmrDiff <= allowedMmrDiff) {
        // 매칭 성사 결정: 오직 UUID가 사전순으로 더 작은 Host만 initiateMatch를 주도적으로 실행
        if (this.user.id.toLowerCase() < candidate.id.toLowerCase()) {
          const cleanHost = this.user.id.replace(/[^a-zA-Z0-9]/g, "").substring(0, 8);
          const cleanGuest = candidate.id.replace(/[^a-zA-Z0-9]/g, "").substring(0, 8);
          const matchId = `match-${cleanHost}-${cleanGuest}-${Date.now().toString(36)}`;

          void this.initiateMatch(matchId, this.user.id, candidate.id, candidate);
        } else {
          // Guest는 Host로부터 match-proposal 시그널이 오기를 대기 (activeMatchId 세팅 전까지 덮어쓰기 방지용 임시 정보 기록)
          this.opponentProfile = candidate;
          this.updateStatus("match-found", `대전 상대 발견: ${candidate.nickname} (${candidate.mmr})`, waitTimeSeconds, allowedMmrDiff, candidate);
          this.startSignalingTimeout(`pending-${candidate.id}`, candidate.id);
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
    this.isHost = this.user.id.toLowerCase() === hostId.toLowerCase();
    this.opponentProfile = opponentInfo;

    this.updateStatus("match-found", `대전 상대 발견: ${opponentInfo.nickname} (${opponentInfo.mmr})`, 0, 0, opponentInfo);
    this.startSignalingTimeout(matchId, opponentInfo.id);

    if (this.isHost) {
      console.log(`[Matchmaker] Host initiateMatch: ${matchId}, Guest: ${guestId}`);
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

  private startSignalingTimeout(matchId: string, opponentId: string): void {
    this.clearSignalingTimeout();
    this.signalingTimeoutTimer = window.setTimeout(() => {
      if (this.isConnectionEstablished || this.isCancelled) return;
      console.warn(`[Matchmaker] 10초 시그널링 타임아웃 발생 (상대방: ${opponentId}, 매치: ${matchId})`);
      this.failedOpponentsCooldown.set(opponentId, Date.now() + 15000);
      this.resetSignalingState();
      this.updateStatus("searching", "상대방의 응답이 지연되어 대기열을 다시 탐색합니다...");
    }, 10000);
  }

  private clearSignalingTimeout(): void {
    if (this.signalingTimeoutTimer !== null) {
      clearTimeout(this.signalingTimeoutTimer);
      this.signalingTimeoutTimer = null;
    }
  }

  private resetSignalingState(): void {
    this.clearSignalingTimeout();
    if (this.dataChannel) {
      try { this.dataChannel.close(); } catch {}
      this.dataChannel = null;
    }
    if (this.peerConnection) {
      try { this.peerConnection.close(); } catch {}
      this.peerConnection = null;
    }
    this.activeMatchId = null;
    this.opponentProfile = null;
    this.isHost = false;
    this.pendingIceCandidates = [];
  }

  /**
   * 시그널링 메시지 수신 핸들러
   */
  private async handleIncomingSignal(signal: SignalMessage): Promise<void> {
    if (this.isCancelled || !signal || !signal.toId) return;
    if (signal.toId.toLowerCase() !== this.user.id.toLowerCase()) return;

    console.log(`[Matchmaker Signal Received] ${signal.type} from ${signal.fromId}`);

    try {
      if (signal.type === "match-proposal") {
        if (!this.activeMatchId || this.activeMatchId.startsWith("pending-")) {
          this.activeMatchId = signal.matchId;
          this.isHost = false;
          const presenceState = this.channel?.presenceState<PresencePayload>() || {};
          const hostPresence = presenceState[signal.hostId]?.[0];
          this.opponentProfile = {
            id: signal.hostId,
            nickname: hostPresence?.nickname || this.opponentProfile?.nickname || "상대 플레이어",
            mmr: hostPresence?.mmr || this.opponentProfile?.mmr || 1200,
          };
          this.updateStatus(
            "match-found",
            `대전 상대 발견: ${this.opponentProfile.nickname}`,
            0,
            0,
            this.opponentProfile,
          );
          this.startSignalingTimeout(signal.matchId, signal.hostId);
          await this.setupGuestWebRTC(signal.hostId, signal.matchId);
        }
      } else if (signal.type === "offer") {
        if (!this.activeMatchId || this.activeMatchId.startsWith("pending-")) {
          this.activeMatchId = signal.matchId;
          this.isHost = false;
          const presenceState = this.channel?.presenceState<PresencePayload>() || {};
          const hostPresence = presenceState[signal.fromId]?.[0];
          this.opponentProfile = {
            id: signal.fromId,
            nickname: hostPresence?.nickname || this.opponentProfile?.nickname || "상대 플레이어",
            mmr: hostPresence?.mmr || this.opponentProfile?.mmr || 1200,
          };
          this.startSignalingTimeout(signal.matchId, signal.fromId);
        }

        if (!this.isHost) {
          if (!this.peerConnection) {
            await this.setupGuestWebRTC(signal.fromId, signal.matchId);
          }

          if (this.peerConnection) {
            this.updateStatus("signaling", "P2P 연결 수립 중 (Answer 전송)...");
            await this.peerConnection.setRemoteDescription(new RTCSessionDescription({
              type: "offer",
              sdp: signal.sdp,
            }));

            // 버퍼링된 조기 ICE Candidate 적용
            await this.flushPendingIceCandidates();

            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);

            await this.sendSignal({
              type: "answer",
              matchId: this.activeMatchId || signal.matchId,
              fromId: this.user.id,
              toId: signal.fromId,
              sdp: answer.sdp || "",
            });
          }
        }
      } else if (signal.type === "answer") {
        if (this.isHost && this.peerConnection) {
          this.updateStatus("signaling", "P2P 연결 확정 중...");
          await this.peerConnection.setRemoteDescription(new RTCSessionDescription({
            type: "answer",
            sdp: signal.sdp,
          }));

          // 버퍼링된 조기 ICE Candidate 적용
          await this.flushPendingIceCandidates();
        }
      } else if (signal.type === "ice") {
        if (signal.candidate) {
          if (this.peerConnection && this.peerConnection.remoteDescription) {
            try {
              await this.peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate));
            } catch (e) {
              console.warn("ICE Candidate 추가 예외:", e);
            }
          } else {
            // remoteDescription 설정 전이면 큐에 보관
            this.pendingIceCandidates.push(signal.candidate);
          }
        }
      }
    } catch (err: any) {
      console.warn("시그널링 처리 오류:", err);
    }
  }

  private async flushPendingIceCandidates(): Promise<void> {
    if (!this.peerConnection || !this.peerConnection.remoteDescription) return;
    while (this.pendingIceCandidates.length > 0) {
      const cand = this.pendingIceCandidates.shift();
      if (cand) {
        try {
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(cand));
        } catch (e) {
          console.warn("지연된 ICE 후보 추가 실패:", e);
        }
      }
    }
  }

  /**
   * Host WebRTC RTCPeerConnection 설정 및 DataChannel 생성
   */
  private async setupHostWebRTC(guestId: string, matchId: string): Promise<void> {
    this.updateStatus("signaling", "P2P 연결 준비 중 (Offer 생성)...");
    const pc = new RTCPeerConnection(RTC_CONFIGURATION);
    this.peerConnection = pc;

    const dc = pc.createDataChannel(DATA_CHANNEL_LABEL, { ordered: true });
    this.dataChannel = dc;

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        void this.sendSignal({
          type: "ice",
          matchId,
          fromId: this.user.id,
          toId: guestId,
          candidate: event.candidate.toJSON(),
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[Host ICE State] ${pc.iceConnectionState}`);
    };

    pc.onconnectionstatechange = () => {
      console.log(`[Host Peer State] ${pc.connectionState}`);
      if (pc.connectionState === "connected" && dc.readyState === "open") {
        this.onConnectionEstablished(pc, dc, "white", matchId);
      }
    };

    const checkOpen = () => {
      if (dc.readyState === "open") {
        this.onConnectionEstablished(pc, dc, "white", matchId);
      }
    };

    dc.onopen = checkOpen;
    const pollInterval = window.setInterval(() => {
      if (this.isConnectionEstablished || this.isCancelled) {
        clearInterval(pollInterval);
        return;
      }
      checkOpen();
    }, 100);

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
    if (this.peerConnection) return;
    this.updateStatus("signaling", "P2P 연결 응답 중...");
    const pc = new RTCPeerConnection(RTC_CONFIGURATION);
    this.peerConnection = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        void this.sendSignal({
          type: "ice",
          matchId,
          fromId: this.user.id,
          toId: hostId,
          candidate: event.candidate.toJSON(),
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[Guest ICE State] ${pc.iceConnectionState}`);
    };

    pc.onconnectionstatechange = () => {
      console.log(`[Guest Peer State] ${pc.connectionState}`);
      if (pc.connectionState === "connected" && this.dataChannel && this.dataChannel.readyState === "open") {
        this.onConnectionEstablished(pc, this.dataChannel, "black", matchId);
      }
    };

    pc.ondatachannel = (event) => {
      const dc = event.channel;
      this.dataChannel = dc;
      const checkOpen = () => {
        if (dc.readyState === "open") {
          this.onConnectionEstablished(pc, dc, "black", matchId);
        }
      };
      dc.onopen = checkOpen;
      const pollInterval = window.setInterval(() => {
        if (this.isConnectionEstablished || this.isCancelled) {
          clearInterval(pollInterval);
          return;
        }
        checkOpen();
      }, 100);
      checkOpen();
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
    if (this.isConnectionEstablished) return;
    this.isConnectionEstablished = true;
    this.clearSignalingTimeout();

    if (this.evalTimer !== null) {
      clearInterval(this.evalTimer);
      this.evalTimer = null;
    }

    // 대기열에서 본인 상태 언트랙
    try {
      this.channel?.untrack();
    } catch {}

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
    void this.cleanup();
    this.updateStatus("error", err.message);
    if (this.errorCallback) {
      this.errorCallback(err);
    }
  }

  /**
   * 1:1 친구 대전 직접 WebRTC 시그널링 및 P2P 연결
   */
  public async startDirectFriendlyMatch(
    roomId: string,
    isHost: boolean,
    opponent: { id: string; nickname: string; mmr: number },
    onReady: (
      transport: OnlineTransport,
      mySide: PieceSide,
      matchId: string,
      opponent: { id: string; nickname: string; mmr: number },
    ) => void,
    onError?: (error: Error) => void,
  ): Promise<void> {
    await this.cleanup();
    this.isHost = isHost;
    this.opponentProfile = opponent;
    this.activeMatchId = roomId;
    this.isConnectionEstablished = false;
    this.isCancelled = false;
    this.pendingIceCandidates = [];
    this.matchReadyCallback = onReady;
    this.errorCallback = onError || null;

    this.updateStatus(
      "match-found",
      "친구와 1:1 대전을 연결 중입니다...",
      0,
      0,
      opponent,
    );
    this.startSignalingTimeout(roomId, opponent.id);

    // 고유한 방 채널 생성
    const channelName = `ca-friendly-room-${roomId}`;
    this.channel = this.client.channel(channelName, {
      config: { broadcast: { self: false } },
    });

    this.channel
      .on("broadcast", { event: "webrtc-signal" }, ({ payload }) => {
        void this.handleIncomingSignal(payload as SignalMessage);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          this.updateStatus("signaling", "P2P 신호를 교환하는 중입니다...", 0, 0, opponent);
          if (isHost) {
            await this.setupHostWebRTC(opponent.id, roomId);
          } else {
            await this.setupGuestWebRTC(opponent.id, roomId);
          }
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          this.handleError(new Error(`친선전 채널 연결 오류: ${status}`));
        }
      });
  }

  /**
   * 매칭 대기열 취소
   */
  public cancel(): void {
    this.isCancelled = true;
    void this.cleanup();
    this.updateStatus("cancelled", "매칭이 취소되었습니다.");
  }

  private async cleanup(): Promise<void> {
    this.clearSignalingTimeout();
    if (this.evalTimer !== null) {
      clearInterval(this.evalTimer);
      this.evalTimer = null;
    }
    if (this.channel) {
      try {
        await this.channel.untrack();
      } catch {}
      try {
        await this.client.removeChannel(this.channel);
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
    this.pendingIceCandidates = [];
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
