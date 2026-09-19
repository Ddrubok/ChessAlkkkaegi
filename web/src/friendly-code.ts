import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type { PeerLink, PeerLinkState } from "./net";
import { getFriendlyCopy, type FriendlyCopyKey } from "./friendly-copy";
import type { LanguageCode } from "./i18n";

export type FriendlyCodePhase =
  | "idle"
  | "generating"
  | "waiting-guest"
  | "joining"
  | "signaling"
  | "connected"
  | "cancelled"
  | "error";

export interface FriendlyCodeCallbacks {
  onStatusChange?: (statusText: string, phase: FriendlyCodePhase) => void;
  onRoomCreated?: (roomCode: string) => void;
  onReady?: (link: PeerLink, role: "host" | "guest", roomCode: string) => void;
  onError?: (error: Error) => void;
}

export interface FriendlyCodeOptions {
  timeoutMs?: number;
  retryIntervalMs?: number;
  language?: LanguageCode;
}

export interface FriendlyCodeSession {
  readonly roomCode: string;
  readonly role: "host" | "guest";
  cancel: () => void;
}

const ROOM_CODE_CHARSET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const ROOM_CODE_LENGTH = 12;
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_RETRY_INTERVAL_MS = 1_200;

/**
 * 12자리의 혼동 없는 대문자/숫자 방 코드를 생성한다.
 */
export function generateFriendlyRoomCode(): string {
  let result = "";
  const charsetLength = ROOM_CODE_CHARSET.length;
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const randomBytes = new Uint8Array(ROOM_CODE_LENGTH);
    crypto.getRandomValues(randomBytes);
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      result += ROOM_CODE_CHARSET[randomBytes[i] % charsetLength];
    }
  } else {
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      result += ROOM_CODE_CHARSET[Math.floor(Math.random() * charsetLength)];
    }
  }
  return result;
}

/**
 * 사용자 입력 문자열에서 공백, 하이픈을 제거하고 대문자로 정규화한다.
 */
export function normalizeFriendlyRoomCode(input: string): string {
  return (input || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

/**
 * 12자리 정규화 코드가 유효한지 검증한다.
 */
export function isValidFriendlyRoomCode(input: string): boolean {
  const normalized = normalizeFriendlyRoomCode(input);
  if (normalized.length !== ROOM_CODE_LENGTH) {
    return false;
  }
  for (let i = 0; i < normalized.length; i++) {
    if (!ROOM_CODE_CHARSET.includes(normalized[i])) {
      return false;
    }
  }
  return true;
}

/**
 * 12자리 코드를 `XXXX-XXXX-XXXX` 형식으로 가독성 있게 포맷한다.
 */
export function formatFriendlyRoomCode(code: string): string {
  const normalized = normalizeFriendlyRoomCode(code);
  if (normalized.length !== ROOM_CODE_LENGTH) {
    return normalized;
  }
  return `${normalized.slice(0, 4)}-${normalized.slice(4, 8)}-${normalized.slice(8, 12)}`;
}

interface FriendlyBroadcastPayload {
  type: "room-ready" | "guest-join" | "offer" | "answer" | "cancelled" | "connected-ack";
  roomCode: string;
  senderId: string;
  toId?: string;
  offer?: string;
  answer?: string;
}

/**
 * Supabase Realtime Broadcast 채널을 이용해 방 코드 기반의 1:1 WebRTC 연결을 수립한다.
 *
 * @param client Supabase 클라이언트 (익명/게스트 지원)
 * @param link net.ts의 PeerLink 인스턴스
 * @param code 참가 시 입력한 12자리 코드 (생략 또는 빈 값이면 방장 모드로 방 생성)
 * @param callbacks 상태 변화 및 연결 완료 콜백
 * @param options 타임아웃 및 재시도 옵션
 */
export function connectFriendlyCode(
  client: SupabaseClient,
  link: PeerLink,
  code?: string | null,
  callbacks?: FriendlyCodeCallbacks,
  options?: FriendlyCodeOptions,
): FriendlyCodeSession {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryIntervalMs = options?.retryIntervalMs ?? DEFAULT_RETRY_INTERVAL_MS;
  const lang = options?.language;

  const isHost = code == null;
  let roomCode = "";

  if (isHost) {
    roomCode = generateFriendlyRoomCode();
  } else {
    const raw = code!;
    if (!isValidFriendlyRoomCode(raw)) {
      const err = new Error(getFriendlyCopy("invalid_code", lang));
      callbacks?.onError?.(err);
      callbacks?.onStatusChange?.(err.message, "error");
      return {
        roomCode: normalizeFriendlyRoomCode(raw),
        role: "guest",
        cancel: () => {},
      };
    }
    roomCode = normalizeFriendlyRoomCode(raw);
  }

  const senderId = `user_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
  const channelName = `ca-friendly-code-${roomCode}`;
  let channel: RealtimeChannel | null = client.channel(channelName, {
    config: { broadcast: { self: false } },
  });

  let isCleanedUp = false;
  let isConnected = false;
  let retryTimer: number | null = null;
  let timeoutTimer: number | null = null;
  let hostOfferSdp: string | null = null;
  let guestAnswerSdp: string | null = null;
  let unbindStateChange: (() => void) | null = null;
  let peerId: string | null = null;
  let joining = false, accepting = false, answerAccepted = false, subscribed = false;

  const cleanup = (sendCancel = false) => {
    if (isCleanedUp) return;
    isCleanedUp = true;

    if (retryTimer !== null) {
      clearInterval(retryTimer);
      retryTimer = null;
    }
    if (timeoutTimer !== null) {
      clearTimeout(timeoutTimer);
      timeoutTimer = null;
    }
    if (unbindStateChange !== null) {
      unbindStateChange();
      unbindStateChange = null;
    }

    if (channel) {
      const ch = channel;
      channel = null;
      if (sendCancel) {
        try {
          void ch.send({
            type: "broadcast",
            event: "friendly-signal",
            payload: {
              type: "cancelled",
              roomCode,
              senderId,
              toId: peerId ?? undefined,
            } satisfies FriendlyBroadcastPayload,
          });
        } catch {}
      }
      setTimeout(() => {
        try {
          void client.removeChannel(ch);
        } catch {}
      }, 100);
    }
  };

  const updateStatus = (key: FriendlyCopyKey, phase: FriendlyCodePhase, extraParams?: Record<string, string | number>) => {
    if (isCleanedUp && phase !== "cancelled" && phase !== "error") return;
    const msg = getFriendlyCopy(key, lang, extraParams);
    callbacks?.onStatusChange?.(msg, phase);
  };

  const sendBroadcast = async (payload: FriendlyBroadcastPayload) => {
    if (!channel || isCleanedUp) return;
    try {
      await channel.send({
        type: "broadcast",
        event: "friendly-signal",
        payload,
      });
    } catch (err) {
      console.warn("[FriendlyCode] broadcast send failed:", err);
    }
  };

  // PeerLink 상태 변화 감지
  unbindStateChange = link.onStateChange((state: PeerLinkState) => {
    if (isCleanedUp) return;
    if (state === "connected") {
      isConnected = true;
      updateStatus("connected", "connected");
      cleanup(false);
      callbacks?.onReady?.(link, isHost ? "host" : "guest", roomCode);
    } else if (state === "failed" || state === "disconnected") {
      cleanup(false);
      link.close();
      const err = new Error(getFriendlyCopy("peer_error", lang));
      updateStatus("peer_error", "error");
      callbacks?.onError?.(err);
    }
  });

  // 타임아웃 타이머
  timeoutTimer = window.setTimeout(() => {
    if (isConnected || isCleanedUp) return;
    cleanup(true);
    link.close();
    const err = new Error(getFriendlyCopy("room_timeout", lang));
    updateStatus("room_timeout", "error");
    callbacks?.onError?.(err);
  }, timeoutMs);

  // 메시지 핸들러
  const handleSignal = async (payload: FriendlyBroadcastPayload) => {
    if (isCleanedUp || isConnected || !payload || payload.roomCode !== roomCode) return;
    if (payload.senderId === senderId) return;
    if (typeof payload.senderId !== 'string' || (payload.toId && payload.toId !== senderId)) return;
    if (peerId && payload.senderId !== peerId) return;
    if (!peerId && (isHost ? payload.type === 'guest-join' || payload.type === 'answer' : payload.type === 'offer' || payload.type === 'room-ready')) peerId = payload.senderId;

    if (payload.type === "cancelled") {
      if (!peerId) return;
      cleanup(false);
      link.close();
      const err = new Error(getFriendlyCopy("cancelled_by_host", lang));
      updateStatus("cancelled_by_host", "cancelled");
      callbacks?.onError?.(err);
      return;
    }

    if (isHost) {
      if (payload.type === "guest-join") {
        // 게스트가 참가했으므로 오퍼 즉시 재전송
        if (hostOfferSdp) {
          updateStatus("handshake_signaling", "signaling");
          void sendBroadcast({
            type: "offer",
            roomCode,
            senderId,
            toId: peerId ?? undefined,
            offer: hostOfferSdp,
          });
        }
      } else if (payload.type === "answer" && payload.answer) {
        if (!peerId || accepting || answerAccepted) return;
        accepting = true;
        // 게스트의 응답 수신
        updateStatus("handshake_signaling", "signaling");
        try {
          await link.acceptAnswer(payload.answer);
          answerAccepted = true;
          void sendBroadcast({
            type: "connected-ack",
            roomCode,
            senderId,
          });
        } catch (err) {
          console.warn("[FriendlyCode Host] acceptAnswer error:", err);
        } finally { accepting = false; }
      }
    } else {
      // Guest
      if ((payload.type === "offer" || payload.type === "room-ready") && payload.offer) {
        if (!guestAnswerSdp && !joining) {
          joining = true;
          updateStatus("handshake_signaling", "signaling");
          try {
            guestAnswerSdp = await link.joinWithInvite(payload.offer);
            if (isCleanedUp) return;
            void sendBroadcast({
              type: "answer",
              roomCode,
              senderId,
              toId: peerId ?? undefined,
              answer: guestAnswerSdp,
            });
          } catch (err) {
            console.warn("[FriendlyCode Guest] joinWithInvite error:", err);
          } finally { joining = false; }
        }
      }
    }
  };

  // 채널 이벤트 등록 및 구독
  channel
    .on("broadcast", { event: "friendly-signal" }, ({ payload }) => {
      void handleSignal(payload as FriendlyBroadcastPayload);
    })
    .subscribe(async (status) => {
      if (isCleanedUp || isConnected) return;

      if (status === "SUBSCRIBED") {
        if (subscribed) return;
        subscribed = true;
        if (isHost) {
          updateStatus("host_waiting", "waiting-guest", { code: formatFriendlyRoomCode(roomCode) });
          callbacks?.onRoomCreated?.(roomCode);

          try {
            hostOfferSdp = await link.createHost();
            if (isCleanedUp || isConnected) return;

            // 방 생성 직후 오퍼 브로드캐스트
            void sendBroadcast({
              type: "room-ready",
              roomCode,
              senderId,
              toId: peerId ?? undefined,
              offer: hostOfferSdp,
            });

            // 주기적으로 room-ready/offer 재전송하여 게스트 참가 신호 유실 방지
            retryTimer = window.setInterval(() => {
              if (isConnected || isCleanedUp) return;
              if (hostOfferSdp) {
                void sendBroadcast({
                  type: "room-ready",
                  roomCode,
                  senderId,
                  toId: peerId ?? undefined,
                  offer: hostOfferSdp,
                });
              }
            }, retryIntervalMs);
          } catch (err) {
            cleanup(false);
            link.close();
            const error = new Error(getFriendlyCopy("peer_error", lang));
            updateStatus("peer_error", "error");
            callbacks?.onError?.(error);
          }
        } else {
          // Guest
          updateStatus("guest_connecting", "joining");

          // 게스트 참가 알림 전송
          void sendBroadcast({
            type: "guest-join",
            roomCode,
            senderId,
          });

          // 오퍼를 받을 때까지 guest-join 재전송, 또는 앤서 생성 후 answer 재전송
          retryTimer = window.setInterval(() => {
            if (isConnected || isCleanedUp) return;
            if (guestAnswerSdp) {
              void sendBroadcast({
                type: "answer",
                roomCode,
                senderId,
                toId: peerId ?? undefined,
                answer: guestAnswerSdp,
              });
            } else {
              void sendBroadcast({
                type: "guest-join",
                roomCode,
                senderId,
              });
            }
          }, retryIntervalMs);
        }
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        cleanup(false);
        link.close();
        const err = new Error(getFriendlyCopy("peer_error", lang));
        updateStatus("peer_error", "error");
        callbacks?.onError?.(err);
      }
    });

  return {
    roomCode,
    role: isHost ? "host" : "guest",
    cancel: () => {
      cleanup(true);
      link.close();
      updateStatus("cancelled_by_user", "cancelled");
    },
  };
}
