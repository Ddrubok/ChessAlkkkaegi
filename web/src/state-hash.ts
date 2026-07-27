import type { PhysicsRuntime } from "./physics";

export interface RawPieceState {
  // 두 런타임에서 같은 바디를 짝짓는 고유 id다.
  pieceId: string;
  // x, y, z를 각각 16자리 빅엔디언 Float64 비트로 직렬화한다.
  positionBits: [string, string, string];
  // x, y, z, w를 각각 16자리 빅엔디언 Float64 비트로 직렬화한다.
  rotationBits: [string, string, string, string];
}

export interface PhysicsStateHash {
  // 말 id 정렬 뒤 위치·회전 비트만 이어 붙인 바이트열의 SHA-256이다.
  sha256: string;
  // 낙하 제거까지 반영된 현재 물리 말 개수다.
  pieceCount: number;
  // 해시 불일치 때 최초 차이를 찾을 수 있는 전체 원시 상태다.
  pieces: RawPieceState[];
}

/**
 * Float64 하나를 네트워크 바이트 순서의 16자리 원시 비트 문자열로 바꾼다.
 */
export function encodeFloat64Bits(value: number): string {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, value, false);
  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * SHA-256 구현을 브라우저와 Node가 함께 제공하는 Web Crypto 계약으로 제한한다.
 */
export async function computeSha256(
  bytes: Uint8Array,
): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) {
    throw new Error("물리 상태 해시에 필요한 Web Crypto SHA-256을 찾지 못했습니다.");
  }
  const digestInput = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(digestInput).set(bytes);
  const digest = await subtle.digest("SHA-256", digestInput);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * 현재 바디를 id 순서로 읽어 원시 Float64 비트와 동일 바이트열 해시를 만든다.
 */
export async function capturePhysicsStateHash(
  runtime: PhysicsRuntime,
): Promise<PhysicsStateHash> {
  const bindings = [...runtime.pieces.values()].sort((left, right) => {
    if (left.instance.id < right.instance.id) {
      return -1;
    }
    if (left.instance.id > right.instance.id) {
      return 1;
    }
    return 0;
  });
  const byteStream = new Uint8Array(bindings.length * 7 * 8);
  const view = new DataView(byteStream.buffer);
  let byteOffset = 0;
  const pieces = bindings.map((binding): RawPieceState => {
    const translation = binding.body.translation();
    const rotation = binding.body.rotation();
    const values = [
      translation.x,
      translation.y,
      translation.z,
      rotation.x,
      rotation.y,
      rotation.z,
      rotation.w,
    ];
    if (!values.every(Number.isFinite)) {
      throw new Error(
        `${binding.instance.id} 물리 상태에 NaN 또는 Infinity가 있습니다.`,
      );
    }
    for (const value of values) {
      view.setFloat64(byteOffset, value, false);
      byteOffset += 8;
    }
    return {
      pieceId: binding.instance.id,
      positionBits: [
        encodeFloat64Bits(translation.x),
        encodeFloat64Bits(translation.y),
        encodeFloat64Bits(translation.z),
      ],
      rotationBits: [
        encodeFloat64Bits(rotation.x),
        encodeFloat64Bits(rotation.y),
        encodeFloat64Bits(rotation.z),
        encodeFloat64Bits(rotation.w),
      ],
    };
  });
  return {
    sha256: await computeSha256(byteStream),
    pieceCount: bindings.length,
    pieces,
  };
}
