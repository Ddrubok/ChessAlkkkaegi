import { readFile } from "node:fs/promises";

const [leftPath, rightPath] = process.argv.slice(2);
if (leftPath === undefined || rightPath === undefined) {
  console.error(
    "사용법: node src/tools/determinism-compare.mjs <기준.json> <비교.json>",
  );
  process.exitCode = 1;
} else {
  try {
    const [left, right] = await Promise.all([
      readReport(leftPath),
      readReport(rightPath),
    ]);
    compareReports(left, right, leftPath, rightPath);
  } catch (error) {
    const fullError =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error(fullError);
    process.exitCode = 1;
  }
}

/**
 * JSON 파일을 읽고 비교에 필요한 최소 형식을 검증한다.
 */
async function readReport(path) {
  const report = JSON.parse(await readFile(path, "utf8"));
  if (
    report?.schemaVersion !== 1 ||
    !Array.isArray(report.checkpoints)
  ) {
    throw new Error(`${path}는 결정성 프로브 schemaVersion 1 결과가 아닙니다.`);
  }
  return report;
}

/**
 * 16자리 빅엔디언 Float64 비트 문자열을 원래 숫자로 복원한다.
 */
function decodeFloat64Bits(bits) {
  if (typeof bits !== "string" || !/^[0-9a-f]{16}$/u.test(bits)) {
    throw new Error(`잘못된 Float64 비트 문자열입니다: ${String(bits)}`);
  }
  const bytes = Uint8Array.from(
    bits.match(/../gu).map((pair) => Number.parseInt(pair, 16)),
  );
  return new DataView(bytes.buffer).getFloat64(0, false);
}

/**
 * 첫 불일치 체크포인트의 말별 위치·쿼터니언 최대 성분 차이를 계산한다.
 */
function measureCheckpointDelta(left, right) {
  const rightPieces = new Map(
    right.pieces.map((piece) => [piece.pieceId, piece]),
  );
  let maximumPositionDelta = -1;
  let maximumPositionPieceId = "";
  let maximumQuaternionDelta = -1;
  let maximumQuaternionPieceId = "";

  for (const leftPiece of left.pieces) {
    const rightPiece = rightPieces.get(leftPiece.pieceId);
    if (rightPiece === undefined) {
      throw new Error(
        `${right.launchIndex}번 체크포인트에 ${leftPiece.pieceId}가 없습니다.`,
      );
    }
    const positionDelta = Math.max(
      ...leftPiece.positionBits.map((bits, index) =>
        Math.abs(
          decodeFloat64Bits(bits) -
            decodeFloat64Bits(rightPiece.positionBits[index]),
        ),
      ),
    );
    const quaternionDelta = Math.max(
      ...leftPiece.rotationBits.map((bits, index) =>
        Math.abs(
          decodeFloat64Bits(bits) -
            decodeFloat64Bits(rightPiece.rotationBits[index]),
        ),
      ),
    );
    if (positionDelta > maximumPositionDelta) {
      maximumPositionDelta = positionDelta;
      maximumPositionPieceId = leftPiece.pieceId;
    }
    if (quaternionDelta > maximumQuaternionDelta) {
      maximumQuaternionDelta = quaternionDelta;
      maximumQuaternionPieceId = leftPiece.pieceId;
    }
    rightPieces.delete(leftPiece.pieceId);
  }
  if (rightPieces.size > 0) {
    throw new Error(
      `${right.launchIndex}번 체크포인트 기준 파일에 없는 말이 있습니다: ${[
        ...rightPieces.keys(),
      ].join(", ")}`,
    );
  }
  return {
    maximumPositionDelta,
    maximumPositionPieceId,
    maximumQuaternionDelta,
    maximumQuaternionPieceId,
  };
}

/**
 * 열 체크포인트 해시 표와 첫 발산의 실제 수치 크기를 한국어로 출력한다.
 */
function compareReports(left, right, leftLabel, rightLabel) {
  if (left.checkpoints.length !== right.checkpoints.length) {
    throw new Error(
      `체크포인트 개수가 다릅니다: ${left.checkpoints.length} / ${right.checkpoints.length}`,
    );
  }
  console.log(`기준: ${leftLabel}`);
  console.log(`비교: ${rightLabel}`);
  console.log("| 발사 | 해시 일치 | 말 수(기준/비교) |");
  console.log("|---:|:---:|:---:|");
  let firstMismatch = null;
  for (let index = 0; index < left.checkpoints.length; index += 1) {
    const leftCheckpoint = left.checkpoints[index];
    const rightCheckpoint = right.checkpoints[index];
    const matches =
      leftCheckpoint.sha256 === rightCheckpoint.sha256 &&
      leftCheckpoint.pieceCount === rightCheckpoint.pieceCount;
    console.log(
      `| ${leftCheckpoint.launchIndex} | ${matches ? "일치" : "불일치"} | ${leftCheckpoint.pieceCount}/${rightCheckpoint.pieceCount} |`,
    );
    if (!matches && firstMismatch === null) {
      firstMismatch = [leftCheckpoint, rightCheckpoint];
    }
  }
  if (firstMismatch === null) {
    console.log("결론: 모든 체크포인트 해시와 말 수가 일치합니다.");
    return;
  }
  const [leftCheckpoint, rightCheckpoint] = firstMismatch;
  const delta = measureCheckpointDelta(leftCheckpoint, rightCheckpoint);
  console.log(`첫 발산: ${leftCheckpoint.launchIndex}번 발사`);
  console.log(
    `위치 max|Δ|=${delta.maximumPositionDelta.toExponential(9)} (${delta.maximumPositionPieceId})`,
  );
  console.log(
    `쿼터니언 max|Δ|=${delta.maximumQuaternionDelta.toExponential(9)} (${delta.maximumQuaternionPieceId})`,
  );
}
