import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const webRoot = fileURLToPath(new URL("../..", import.meta.url));
const vite = await createServer({
  root: webRoot,
  configFile: false,
  logLevel: "error",
  appType: "custom",
  server: { middlewareMode: true },
});

/**
 * 조건이 거짓이면 측정 이름과 함께 즉시 중단한다.
 */
function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * 로컬·STUN 후보가 모두 든 일반적인 Chromium 데이터 채널 SDP 표본을 만든다.
 */
function createTypicalSdp(type) {
  const isOffer = type === "offer";
  return [
    "v=0",
    `o=- ${isOffer ? "4819951799453311047" : "8701072562400563943"} 2 IN IP4 127.0.0.1`,
    "s=-",
    "t=0 0",
    "a=group:BUNDLE 0",
    "a=msid-semantic: WMS",
    "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
    "c=IN IP4 0.0.0.0",
    `a=ice-ufrag:${isOffer ? "mP2x" : "G7vq"}`,
    `a=ice-pwd:${isOffer ? "gQ9pYwK4THLuY3s6JdVnA8" : "dN5xKc9QwR2tL7uP4eHsF1"}`,
    "a=ice-options:trickle",
    "a=fingerprint:sha-256 7A:9D:BC:42:A1:96:31:EF:3A:70:DD:80:B8:1A:CB:68:EB:07:9C:71:E2:87:DC:5B:22:3F:05:E1:9A:C8:65:14",
    `a=setup:${isOffer ? "actpass" : "active"}`,
    "a=mid:0",
    "a=sctp-port:5000",
    "a=max-message-size:262144",
    `a=candidate:2292933246 1 udp 2122260223 192.168.0.${isOffer ? "12" : "18"} ${isOffer ? "53705" : "60122"} typ host generation 0 network-cost 999`,
    `a=candidate:842163049 1 udp 1686052607 203.0.113.${isOffer ? "20" : "21"} ${isOffer ? "53705" : "60122"} typ srflx raddr 192.168.0.${isOffer ? "12" : "18"} rport ${isOffer ? "53705" : "60122"} generation 0 network-cost 999`,
    "a=end-of-candidates",
    "",
  ].join("\r\n");
}

try {
  const net = await vite.ssrLoadModule("/src/net.ts");
  const measurements = {};
  for (const type of ["offer", "answer"]) {
    const description = {
      type,
      sdp: createTypicalSdp(type),
    };
    const stripped = net.stripDataChannelSdp(description.sdp);
    const code = await net.encodeCode(description);
    const decoded = await net.decodeCode(code);
    assertCondition(
      code.startsWith("CA1D."),
      `${type} 코드가 deflate-raw 형식이 아닙니다: ${code.slice(0, 5)}`,
    );
    assertCondition(
      decoded.type === type && decoded.sdp === stripped,
      `${type} 연결 코드 왕복 결과가 다릅니다.`,
    );
    const envelope = JSON.stringify({
      s: "ca-net",
      v: 1,
      t: type === "offer" ? "o" : "a",
      d: stripped,
    });
    const plainCode =
      `CA1P.${Buffer.from(envelope, "utf8").toString("base64url")}`;
    const plainDecoded = await net.decodeCode(plainCode);
    assertCondition(
      plainDecoded.type === type && plainDecoded.sdp === stripped,
      `${type} 평문 대체 연결 코드 왕복 결과가 다릅니다.`,
    );
    measurements[type] = {
      sourceSdpChars: description.sdp.length,
      strippedSdpChars: stripped.length,
      plainCodeChars: plainCode.length,
      compressedCodeChars: code.length,
      compressedVsPlainPercent: Number(
        ((code.length / plainCode.length) * 100).toFixed(1),
      ),
    };
  }

  let versionMismatchDetected = false;
  try {
    await net.decodeCode("CA2D.invalid");
  } catch (error) {
    versionMismatchDetected =
      error instanceof Error &&
      error.message.includes("스키마 또는 버전");
  }
  assertCondition(
    versionMismatchDetected,
    "다른 연결 코드 버전을 명확한 오류로 거부하지 않았습니다.",
  );

  console.log(
    `[통과] 연결 코드 왕복·버전 거부: ${JSON.stringify(measurements)}`,
  );
} finally {
  await vite.close();
}
