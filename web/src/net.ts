import {
  NET_HEARTBEAT_INTERVAL_MS,
  NET_ICE_GATHER_TIMEOUT_MS,
  NET_TRAFFIC_TIMEOUT_MS,
} from "./config";

export type PeerLinkState =
  | "idle"
  | "waiting-answer"
  | "connecting"
  | "connected"
  | "disconnected"
  | "failed";

export type PeerDisconnectCause =
  | "graceful-close"
  | "data-channel-error"
  | "peer-connection-failed"
  | "traffic-timeout"
  | null;

export interface DecodedConnectionCode {
  // WebRTC에 그대로 적용할 제안 또는 응답 종류다.
  type: "offer" | "answer";
  // 데이터 채널 연결에 필요한 줄만 남긴 SDP다.
  sdp: string;
}

export interface PeerLink {
  // 사용자에게는 끊김 하나로 보이되 디버그 화면이 원래 종료 원인을 읽게 한다.
  readonly disconnectCause: PeerDisconnectCause;
  // 방장용 제안을 만들고 모든 ICE 후보가 포함된 초대 코드를 반환한다.
  createHost(): Promise<string>;
  // 참가자가 초대 코드를 적용하고 모든 ICE 후보가 포함된 응답 코드를 반환한다.
  joinWithInvite(code: string): Promise<string>;
  // 방장이 응답 코드를 적용해 최종 연결을 진행한다.
  acceptAnswer(code: string): Promise<void>;
  // 연결된 신뢰성 데이터 채널로 JSON 객체 하나를 보낸다.
  send(payload: object): void;
  // 상대가 보낸 일반 JSON 객체를 받을 구독 함수를 등록한다.
  onMessage(handler: (payload: object) => void): () => void;
  // 현재 상태를 즉시 받고 이후 상태 변화를 구독한다.
  onStateChange(handler: (state: PeerLinkState) => void): () => void;
  // 데이터 채널과 피어 연결 및 실시간 타이머를 모두 닫는다.
  close(): void;
}

export interface PeerLinkTimingOptions {
  // 생략하면 배포 기본값을 쓰는 테스트용 ping 간격이다.
  heartbeatIntervalMs?: number;
  // 생략하면 배포 기본값을 쓰는 테스트용 무수신 판정 시간이다.
  trafficTimeoutMs?: number;
}

export interface NetDevelopmentRuntime {
  // 개발 패널이 사용하는 게임 비종속 피어 링크다.
  link: PeerLink;
  // 개발 패널의 루트 요소다.
  element: HTMLElement;
  // 이벤트 구독과 연결을 닫고 패널을 제거한다.
  destroy(): void;
}

interface ConnectionCodeEnvelope {
  // 다른 문자열을 연결 코드로 오인하지 않게 하는 짧은 스키마 태그다.
  s: "ca-net";
  // 호환되지 않는 후속 형식을 조용히 읽지 않게 하는 버전이다.
  v: 1;
  // 압축 크기를 줄인 제안·응답 종류 표기다.
  t: "o" | "a";
  // 데이터 채널 연결에 필요한 줄만 남긴 SDP다.
  d: string;
}

interface PeerControlMessage {
  // 사용자 payload와 충돌하기 어려운 내부 하트비트 표식이다.
  __chessAlkkagiPeerLink: "ping" | "pong";
}

type PeerRole = "host" | "guest";

const CONNECTION_CODE_PREFIX_DEFLATE = "CA1D.";
const CONNECTION_CODE_PREFIX_PLAIN = "CA1P.";
const STUN_URL = "stun:stun.l.google.com:19302";
const DATA_CHANNEL_LABEL = "peer-link-v1";

const DATA_CHANNEL_SDP_PREFIXES = [
  "v=",
  "o=",
  "s=",
  "t=",
  "c=",
  "m=application ",
  "a=group:BUNDLE",
  "a=ice-lite",
  "a=ice-ufrag:",
  "a=ice-pwd:",
  "a=ice-options:",
  "a=fingerprint:",
  "a=setup:",
  "a=mid:",
  "a=sctp-port:",
  "a=sctpmap:",
  "a=max-message-size:",
  "a=candidate:",
  "a=end-of-candidates",
] as const;

/**
 * 데이터 채널과 무관한 미디어용 SDP 줄을 제거해 수동 교환 코드를 줄인다.
 */
export function stripDataChannelSdp(sdp: string): string {
  const lines = sdp
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) =>
      DATA_CHANNEL_SDP_PREFIXES.some((prefix) =>
        line.startsWith(prefix),
      ),
    );
  if (
    !lines.some((line) => line.startsWith("m=application ")) ||
    !lines.some((line) => line.startsWith("a=ice-ufrag:")) ||
    !lines.some((line) => line.startsWith("a=ice-pwd:")) ||
    !lines.some((line) => line.startsWith("a=fingerprint:"))
  ) {
    throw new Error(
      "데이터 채널 연결에 필요한 SDP 줄을 찾지 못했습니다.",
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

/**
 * Uint8Array를 브라우저 간 전달에 안전한 패딩 없는 base64url로 바꾼다.
 */
function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

/**
 * 패딩 없는 base64url 문자열을 원래 바이트로 복원한다.
 */
function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(`${normalized}${padding}`);
  } catch (error: unknown) {
    const detail =
      error instanceof Error ? error.message : String(error);
    throw new Error(`연결 코드 base64url 해석 실패: ${detail}`);
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * 스트림 변환 결과를 다시 하나의 바이트 배열로 모은다.
 */
async function readTransformedBytes(
  bytes: Uint8Array,
  transform: {
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<BufferSource>;
  },
): Promise<Uint8Array> {
  const input = new Uint8Array(bytes.byteLength);
  input.set(bytes);
  const reader = transform.readable.getReader();
  const writer = transform.writable.getWriter();
  const readOutput = async (): Promise<Uint8Array> => {
    const chunks: Uint8Array[] = [];
    let totalLength = 0;
    while (true) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      chunks.push(result.value);
      totalLength += result.value.byteLength;
    }
    const output = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return output;
  };
  const outputPromise = readOutput();
  await writer.write(input.buffer);
  await writer.close();
  return await outputPromise;
}

/**
 * 브라우저가 지원하면 SDP JSON을 헤더 없는 deflate로 압축한다.
 */
async function tryCompress(
  bytes: Uint8Array,
): Promise<Uint8Array | null> {
  if (typeof CompressionStream === "undefined") {
    return null;
  }
  try {
    return await readTransformedBytes(
      bytes,
      new CompressionStream("deflate-raw"),
    );
  } catch (error: unknown) {
    const detail =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.warn(
      `[P2P 연결 코드] deflate-raw 압축을 사용할 수 없어 평문 base64url로 대체합니다.\n${detail}`,
    );
    return null;
  }
}

/**
 * 압축 연결 코드의 원래 JSON 바이트를 복원한다.
 */
async function decompress(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error(
      "이 브라우저는 deflate-raw 연결 코드 해제를 지원하지 않습니다.",
    );
  }
  try {
    return await readTransformedBytes(
      bytes,
      new DecompressionStream("deflate-raw"),
    );
  } catch (error: unknown) {
    const detail =
      error instanceof Error ? error.message : String(error);
    throw new Error(`연결 코드 압축 해제 실패: ${detail}`);
  }
}

/**
 * SDP 제안 또는 응답을 버전이 명시된 압축 base64url 코드로 만든다.
 */
export async function encodeCode(
  description: RTCSessionDescriptionInit,
): Promise<string> {
  if (
    (description.type !== "offer" && description.type !== "answer") ||
    typeof description.sdp !== "string"
  ) {
    throw new Error("연결 코드는 완성된 offer 또는 answer SDP만 인코딩합니다.");
  }
  const envelope: ConnectionCodeEnvelope = {
    s: "ca-net",
    v: 1,
    t: description.type === "offer" ? "o" : "a",
    d: stripDataChannelSdp(description.sdp),
  };
  const source = new TextEncoder().encode(JSON.stringify(envelope));
  const compressed = await tryCompress(source);
  if (compressed === null) {
    return `${CONNECTION_CODE_PREFIX_PLAIN}${encodeBase64Url(source)}`;
  }
  return `${CONNECTION_CODE_PREFIX_DEFLATE}${encodeBase64Url(compressed)}`;
}

/**
 * 압축 또는 평문 연결 코드를 검증하고 WebRTC 설명으로 복원한다.
 */
export async function decodeCode(
  code: string,
): Promise<DecodedConnectionCode> {
  const trimmed = code.trim();
  let source: Uint8Array;
  if (trimmed.startsWith(CONNECTION_CODE_PREFIX_DEFLATE)) {
    source = await decompress(
      decodeBase64Url(
        trimmed.slice(CONNECTION_CODE_PREFIX_DEFLATE.length),
      ),
    );
  } else if (trimmed.startsWith(CONNECTION_CODE_PREFIX_PLAIN)) {
    source = decodeBase64Url(
      trimmed.slice(CONNECTION_CODE_PREFIX_PLAIN.length),
    );
  } else {
    throw new Error(
      "연결 코드의 스키마 또는 버전 표식이 현재 빌드와 다릅니다.",
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(source)) as unknown;
  } catch (error: unknown) {
    const detail =
      error instanceof Error ? error.message : String(error);
    throw new Error(`연결 코드 JSON 해석 실패: ${detail}`);
  }
  if (
    typeof value !== "object" ||
    value === null ||
    !("s" in value) ||
    value.s !== "ca-net" ||
    !("v" in value) ||
    value.v !== 1
  ) {
    throw new Error(
      "연결 코드 내부 스키마 또는 버전이 현재 빌드와 다릅니다.",
    );
  }
  if (
    !("t" in value) ||
    (value.t !== "o" && value.t !== "a") ||
    !("d" in value) ||
    typeof value.d !== "string"
  ) {
    throw new Error("연결 코드에 올바른 SDP 종류와 본문이 없습니다.");
  }
  return {
    type: value.t === "o" ? "offer" : "answer",
    sdp: value.d,
  };
}

/**
 * 모든 로컬 ICE 후보가 localDescription에 합쳐질 때까지 기다린다.
 */
async function waitForIceGatheringComplete(
  peerConnection: RTCPeerConnection,
): Promise<void> {
  if (peerConnection.iceGatheringState === "complete") {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    let completed = false;
    const finish = (error: Error | null): void => {
      if (completed) {
        return;
      }
      completed = true;
      window.clearTimeout(timeout);
      peerConnection.removeEventListener(
        "icegatheringstatechange",
        handleStateChange,
      );
      if (error === null) {
        resolve();
      } else {
        reject(error);
      }
    };
    const handleStateChange = (): void => {
      if (peerConnection.iceGatheringState === "complete") {
        finish(null);
      }
    };
    const timeout = window.setTimeout(() => {
      finish(
        new Error(
          `${NET_ICE_GATHER_TIMEOUT_MS}ms 안에 ICE 후보 수집이 끝나지 않았습니다. 현재 상태: ${peerConnection.iceGatheringState}`,
        ),
      );
    }, NET_ICE_GATHER_TIMEOUT_MS);
    peerConnection.addEventListener(
      "icegatheringstatechange",
      handleStateChange,
    );
  });
}

/**
 * P3가 게임 규칙 없이 JSON만 연결할 수 있는 피어 링크를 만든다.
 */
export function createPeerLink(
  timing: PeerLinkTimingOptions = {},
): PeerLink {
  const heartbeatIntervalMs =
    timing.heartbeatIntervalMs ?? NET_HEARTBEAT_INTERVAL_MS;
  const trafficTimeoutMs =
    timing.trafficTimeoutMs ?? NET_TRAFFIC_TIMEOUT_MS;
  if (
    heartbeatIntervalMs <= 0 ||
    trafficTimeoutMs <= heartbeatIntervalMs
  ) {
    throw new Error("P2P 하트비트 시험 시간 값이 유효하지 않습니다.");
  }
  let state: PeerLinkState = "idle";
  let peerConnection: RTCPeerConnection | null = null;
  let dataChannel: RTCDataChannel | null = null;
  let role: PeerRole | null = null;
  let heartbeatTimer: number | null = null;
  let trafficTimer: number | null = null;
  let lastReceivedAt = 0;
  let connectionGeneration = 0;
  let disconnectCause: PeerDisconnectCause = null;
  const messageHandlers = new Set<(payload: object) => void>();
  const stateHandlers = new Set<(nextState: PeerLinkState) => void>();

  // 같은 상태를 중복 알리지 않고 모든 구독자에게 상태를 전달한다.
  const setState = (nextState: PeerLinkState): void => {
    if (state === nextState) {
      return;
    }
    state = nextState;
    for (const handler of stateHandlers) {
      try {
        handler(state);
      } catch (error: unknown) {
        const fullError =
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error);
        console.error(`P2P 상태 구독자 오류\n${fullError}`);
      }
    }
  };

  // 연결 중 종료 원인을 보존하고 게임 계층에는 단일 disconnected 상태만 알린다.
  const disconnect = (cause: Exclude<PeerDisconnectCause, null>): void => {
    disconnectCause = cause;
    setState("disconnected");
  };

  // 하트비트와 연결 객체를 닫되 외부 상태는 호출자가 결정하게 한다.
  const disposeConnection = (): void => {
    connectionGeneration += 1;
    if (heartbeatTimer !== null) {
      window.clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (trafficTimer !== null) {
      window.clearInterval(trafficTimer);
      trafficTimer = null;
    }
    if (dataChannel !== null) {
      dataChannel.close();
      dataChannel = null;
    }
    if (peerConnection !== null) {
      peerConnection.close();
      peerConnection = null;
    }
    role = null;
  };

  // 내부 ping/pong은 사용자 메시지 핸들러에 노출하지 않는다.
  const isControlMessage = (
    payload: unknown,
  ): payload is PeerControlMessage =>
    typeof payload === "object" &&
    payload !== null &&
    "__chessAlkkagiPeerLink" in payload &&
    (payload.__chessAlkkagiPeerLink === "ping" ||
      payload.__chessAlkkagiPeerLink === "pong");

  // 열린 채널에 내부 제어 메시지를 보낸다.
  const sendControl = (kind: "ping" | "pong"): void => {
    if (dataChannel?.readyState !== "open") {
      return;
    }
    const message: PeerControlMessage = {
      __chessAlkkagiPeerLink: kind,
    };
    dataChannel.send(JSON.stringify(message));
  };

  // 3초 ping과 10초 수신 중단 판정을 시작한다.
  const startHeartbeat = (): void => {
    if (heartbeatTimer !== null || trafficTimer !== null) {
      return;
    }
    lastReceivedAt = performance.now();
    heartbeatTimer = window.setInterval(() => {
      sendControl("ping");
    }, heartbeatIntervalMs);
    trafficTimer = window.setInterval(() => {
      if (
        performance.now() - lastReceivedAt >=
        trafficTimeoutMs
      ) {
        disposeConnection();
        disconnect("traffic-timeout");
      }
    }, Math.min(1_000, heartbeatIntervalMs));
  };

  // 한 데이터 채널의 열림·수신·오류·닫힘을 공통으로 연결한다.
  const bindDataChannel = (
    channel: RTCDataChannel,
    generation = connectionGeneration,
  ): void => {
    dataChannel = channel;
    channel.addEventListener("open", () => {
      if (generation !== connectionGeneration) {
        return;
      }
      setState("connected");
      startHeartbeat();
    });
    channel.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (generation !== connectionGeneration) {
        return;
      }
      lastReceivedAt = performance.now();
      if (typeof event.data !== "string") {
        console.error(
          "P2P 데이터 채널에서 문자열이 아닌 메시지를 받았습니다.",
        );
        return;
      }
      let payload: unknown;
      try {
        payload = JSON.parse(event.data) as unknown;
      } catch (error: unknown) {
        const fullError =
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error);
        console.error(
          `P2P JSON 메시지를 해석하지 못했습니다.\n${fullError}`,
        );
        return;
      }
      if (isControlMessage(payload)) {
        if (payload.__chessAlkkagiPeerLink === "ping") {
          sendControl("pong");
        }
        return;
      }
      if (typeof payload !== "object" || payload === null) {
        console.error("P2P 사용자 메시지가 JSON 객체가 아닙니다.");
        return;
      }
      for (const handler of messageHandlers) {
        try {
          handler(payload);
        } catch (error: unknown) {
          const fullError =
            error instanceof Error
              ? (error.stack ?? error.message)
              : String(error);
          console.error(`P2P 메시지 구독자 오류\n${fullError}`);
        }
      }
    });
    channel.addEventListener("error", (event) => {
      if (generation !== connectionGeneration) {
        return;
      }
      console.warn("P2P 데이터 채널 연결이 끊겼습니다.", event);
      disconnect("data-channel-error");
    });
    channel.addEventListener("close", () => {
      if (
        generation === connectionGeneration &&
        state !== "disconnected"
      ) {
        disconnect("graceful-close");
      }
    });
  };

  // 피어 연결 상태를 링크의 단순 상태 집합으로 변환한다.
  const bindPeerConnection = (
    connection: RTCPeerConnection,
    generation = connectionGeneration,
  ): void => {
    connection.addEventListener("connectionstatechange", () => {
      if (generation !== connectionGeneration) {
        return;
      }
      if (connection.connectionState === "failed") {
        disconnect("peer-connection-failed");
      } else if (
        connection.connectionState === "disconnected" ||
        connection.connectionState === "closed"
      ) {
        if (state !== "disconnected") {
          disconnect("graceful-close");
        }
      } else if (
        connection.connectionState === "connected" &&
        dataChannel?.readyState === "open"
      ) {
        setState("connected");
      }
    });
  };

  // Google STUN 및 Metered TURN 릴레이로 NAT 후보를 모으는 새 연결을 만든다.
  const createConnection = (): RTCPeerConnection => {
    if (typeof RTCPeerConnection === "undefined") {
      throw new Error("이 브라우저는 WebRTC RTCPeerConnection을 지원하지 않습니다.");
    }
    const connection = new RTCPeerConnection({
      iceServers: [
        { urls: STUN_URL },
        { urls: "stun:stun1.l.google.com:19302" },
        {
          urls: "turn:openrelay.metered.ca:80",
          username: "openrelay",
          credential: "openrelay",
        },
        {
          urls: "turn:openrelay.metered.ca:443?transport=tcp",
          username: "openrelay",
          credential: "openrelay",
        },
      ],
      iceCandidatePoolSize: 2,
    });
    bindPeerConnection(connection);
    peerConnection = connection;
    return connection;
  };

  return {
    get disconnectCause(): PeerDisconnectCause {
      return disconnectCause;
    },

    async createHost(): Promise<string> {
      disposeConnection();
      disconnectCause = null;
      const connection = createConnection();
      role = "host";
      bindDataChannel(
        connection.createDataChannel(DATA_CHANNEL_LABEL, {
          ordered: true,
        }),
      );
      setState("waiting-answer");
      try {
        await connection.setLocalDescription(
          await connection.createOffer(),
        );
        await waitForIceGatheringComplete(connection);
        if (connection.localDescription === null) {
          throw new Error("ICE 수집 뒤 방장 localDescription이 없습니다.");
        }
        return await encodeCode(connection.localDescription);
      } catch (error: unknown) {
        setState("failed");
        throw error;
      }
    },

    async joinWithInvite(code: string): Promise<string> {
      const invite = await decodeCode(code);
      if (invite.type !== "offer") {
        throw new Error("참가 입력에는 초대 offer 코드가 필요합니다.");
      }
      disposeConnection();
      disconnectCause = null;
      const connection = createConnection();
      role = "guest";
      const generation = connectionGeneration;
      connection.addEventListener("datachannel", (event) => {
        if (generation === connectionGeneration) {
          bindDataChannel(event.channel, generation);
        }
      });
      setState("connecting");
      try {
        await connection.setRemoteDescription(invite);
        await connection.setLocalDescription(
          await connection.createAnswer(),
        );
        await waitForIceGatheringComplete(connection);
        if (connection.localDescription === null) {
          throw new Error("ICE 수집 뒤 참가자 localDescription이 없습니다.");
        }
        return await encodeCode(connection.localDescription);
      } catch (error: unknown) {
        setState("failed");
        throw error;
      }
    },

    async acceptAnswer(code: string): Promise<void> {
      if (
        role !== "host" ||
        peerConnection === null ||
        state !== "waiting-answer"
      ) {
        throw new Error("먼저 방 만들기로 초대 코드를 생성해야 합니다.");
      }
      const answer = await decodeCode(code);
      if (answer.type !== "answer") {
        throw new Error("방장 연결 입력에는 answer 코드가 필요합니다.");
      }
      setState("connecting");
      try {
        await peerConnection.setRemoteDescription(answer);
      } catch (error: unknown) {
        setState("failed");
        throw error;
      }
    },

    send(payload: object): void {
      if (
        typeof payload !== "object" ||
        payload === null ||
        Array.isArray(payload)
      ) {
        throw new Error("P2P send payload는 JSON 객체여야 합니다.");
      }
      if (dataChannel?.readyState !== "open") {
        throw new Error("P2P 데이터 채널이 아직 연결되지 않았습니다.");
      }
      dataChannel.send(JSON.stringify(payload));
    },

    onMessage(handler: (payload: object) => void): () => void {
      messageHandlers.add(handler);
      return () => {
        messageHandlers.delete(handler);
      };
    },

    onStateChange(handler: (nextState: PeerLinkState) => void): () => void {
      stateHandlers.add(handler);
      handler(state);
      return () => {
        stateHandlers.delete(handler);
      };
    },

    close(): void {
      const wasIdle = state === "idle";
      disposeConnection();
      if (wasIdle) {
        setState("idle");
      } else {
        disconnect("graceful-close");
      }
    },
  };
}

/**
 * ?net=1에서만 쓰는 수동 시그널링·echo 검증 패널을 만든다.
 */
export function createNetDevelopmentRuntime(
  parent: HTMLElement,
): NetDevelopmentRuntime {
  const link = createPeerLink();
  const element = document.createElement("section");
  element.className = "net-panel";
  element.setAttribute("aria-label", "P2P 연결 시험");

  const title = document.createElement("h2");
  title.textContent = "P2P 연결 시험";
  const stateText = document.createElement("p");
  stateText.className = "net-state";

  // 긴 코드를 붙여넣을 수 있는 행을 반복 생성한다.
  const createCodeRow = (
    labelText: string,
    readOnly: boolean,
  ): {
    container: HTMLDivElement;
    label: HTMLLabelElement;
    textarea: HTMLTextAreaElement;
  } => {
    const container = document.createElement("div");
    container.className = "net-code-row";
    const label = document.createElement("label");
    label.textContent = labelText;
    const textarea = document.createElement("textarea");
    textarea.rows = 3;
    textarea.readOnly = readOnly;
    textarea.spellcheck = false;
    label.append(textarea);
    container.append(label);
    return { container, label, textarea };
  };

  const createButton = (label: string): HTMLButtonElement => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    return button;
  };

  const hostButton = createButton("방 만들기");
  const inviteOutput = createCodeRow("초대 코드", true);
  const copyInviteButton = createButton("초대 코드 복사");
  inviteOutput.container.append(copyInviteButton);

  const inviteInput = createCodeRow("초대 코드 붙여넣기", false);
  const joinButton = createButton("참가");
  inviteInput.container.append(joinButton);

  const answerOutput = createCodeRow("응답 코드", true);
  const copyAnswerButton = createButton("응답 코드 복사");
  answerOutput.container.append(copyAnswerButton);

  const answerInput = createCodeRow("응답 코드 붙여넣기", false);
  const acceptButton = createButton("연결");
  answerInput.container.append(acceptButton);

  const messageRow = document.createElement("div");
  messageRow.className = "net-message-row";
  const messageInput = document.createElement("input");
  messageInput.type = "text";
  messageInput.placeholder = "보낼 메시지";
  const sendButton = createButton("메시지 보내기");
  messageRow.append(messageInput, sendButton);

  const logTitle = document.createElement("p");
  logTitle.textContent = "받은 메시지";
  const log = document.createElement("pre");
  log.className = "net-log";
  log.textContent = "아직 받은 메시지가 없습니다.";

  element.append(
    title,
    stateText,
    hostButton,
    inviteOutput.container,
    inviteInput.container,
    answerOutput.container,
    answerInput.container,
    messageRow,
    logTitle,
    log,
  );
  parent.append(element);

  const stateLabels: Record<PeerLinkState, string> = {
    idle: "대기",
    "waiting-answer": "응답 코드 대기",
    connecting: "연결 중",
    connected: "연결됨",
    disconnected: "연결 끊김",
    failed: "연결 실패",
  };
  const appendLog = (message: string): void => {
    const entry = `[${new Date().toLocaleTimeString()}] ${message}`;
    log.textContent =
      log.textContent === "아직 받은 메시지가 없습니다."
        ? entry
        : `${log.textContent}\n${entry}`;
    log.scrollTop = log.scrollHeight;
  };
  const reportError = (error: unknown): void => {
    const fullError =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error(fullError);
    appendLog(`오류: ${error instanceof Error ? error.message : String(error)}`);
  };
  const runAction = (action: () => Promise<void>): void => {
    void action().catch(reportError);
  };
  const copyCode = async (value: string, name: string): Promise<void> => {
    if (value.length === 0) {
      throw new Error(`${name}가 아직 생성되지 않았습니다.`);
    }
    await navigator.clipboard.writeText(value);
    appendLog(`${name} ${value.length}자를 복사했습니다.`);
  };

  const removeStateHandler = link.onStateChange((nextState) => {
    stateText.textContent = `연결 상태: ${stateLabels[nextState]}`;
    element.dataset.state = nextState;
  });
  const removeMessageHandler = link.onMessage((payload) => {
    appendLog(JSON.stringify(payload));
  });

  hostButton.addEventListener("click", () => {
    runAction(async () => {
      inviteOutput.textarea.value = await link.createHost();
      inviteOutput.label.firstChild!.textContent =
        `초대 코드 (${inviteOutput.textarea.value.length}자)`;
      appendLog(`초대 코드 ${inviteOutput.textarea.value.length}자를 생성했습니다.`);
    });
  });
  joinButton.addEventListener("click", () => {
    runAction(async () => {
      answerOutput.textarea.value = await link.joinWithInvite(
        inviteInput.textarea.value,
      );
      answerOutput.label.firstChild!.textContent =
        `응답 코드 (${answerOutput.textarea.value.length}자)`;
      appendLog(`응답 코드 ${answerOutput.textarea.value.length}자를 생성했습니다.`);
    });
  });
  acceptButton.addEventListener("click", () => {
    runAction(async () => {
      await link.acceptAnswer(answerInput.textarea.value);
      appendLog("응답 코드를 적용했습니다.");
    });
  });
  copyInviteButton.addEventListener("click", () => {
    runAction(() =>
      copyCode(inviteOutput.textarea.value, "초대 코드"),
    );
  });
  copyAnswerButton.addEventListener("click", () => {
    runAction(() =>
      copyCode(answerOutput.textarea.value, "응답 코드"),
    );
  });
  sendButton.addEventListener("click", () => {
    try {
      link.send({ echo: messageInput.value });
      appendLog(`보냄: ${JSON.stringify({ echo: messageInput.value })}`);
      messageInput.value = "";
    } catch (error: unknown) {
      reportError(error);
    }
  });
  messageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      sendButton.click();
    }
  });

  return {
    link,
    element,
    destroy(): void {
      removeStateHandler();
      removeMessageHandler();
      link.close();
      element.remove();
    },
  };
}
