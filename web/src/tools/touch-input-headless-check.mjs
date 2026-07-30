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
 * 터치 입력 계약이 다르면 측정값을 포함해 즉시 검증을 중단한다.
 */
function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

try {
  const [capability, config, input] = await Promise.all([
    vite.ssrLoadModule("/src/input-capability.ts"),
    vite.ssrLoadModule("/src/config.ts"),
    vite.ssrLoadModule("/src/input.ts"),
  ]);

  assertCondition(
    capability.isCoarsePointerEnvironment() === false &&
      capability.isTouchPointerEvent({ pointerType: "touch" }) &&
      !capability.isTouchPointerEvent({ pointerType: "mouse" }),
    "DOM 없는 입력 역량 기본값 또는 이벤트별 터치 판정이 다릅니다.",
  );
  console.log(
    "[통과 a] 입력 역량: Node coarse=false, touch=true, mouse=false",
  );

  const radius = config.TOUCH_PIECE_HIT_RADIUS_PIXELS;
  const candidates = [
    { pieceId: "white-pawn-a2", clientX: 130, clientY: 100 },
    { pieceId: "white-rook-a1", clientX: 138, clientY: 100 },
  ];
  const touchPiece = input.findNearestTouchPieceInScreenSpace(
    { pointerType: "touch", clientX: 100, clientY: 100 },
    candidates,
  );
  const mousePiece = input.findNearestTouchPieceInScreenSpace(
    { pointerType: "mouse", clientX: 100, clientY: 100 },
    candidates,
  );
  assertCondition(
    radius === 44 &&
      touchPiece === "white-pawn-a2" &&
      mousePiece === null,
    `터치 최근접 또는 마우스 비적용이 다릅니다: radius=${radius}, touch=${touchPiece}, mouse=${mousePiece}`,
  );

  const boundaryPiece = input.findNearestTouchPieceInScreenSpace(
    { pointerType: "touch", clientX: 100, clientY: 100 },
    [
      {
        pieceId: "white-bishop-c1",
        clientX: 100 + radius,
        clientY: 100,
      },
    ],
  );
  const outsidePiece = input.findNearestTouchPieceInScreenSpace(
    { pointerType: "touch", clientX: 100, clientY: 100 },
    [
      {
        pieceId: "white-bishop-c1",
        clientX: 100 + radius + 0.001,
        clientY: 100,
      },
    ],
  );
  assertCondition(
    boundaryPiece === "white-bishop-c1" &&
      outsidePiece === null,
    `44px 경계 판정이 다릅니다: boundary=${boundaryPiece}, outside=${outsidePiece}`,
  );
  console.log(
    `[통과 b] 화면 좌표 폴백: touch=${touchPiece}@30px, mouse=${String(mousePiece)}, boundary=${boundaryPiece}@${radius}px, outside=${String(outsidePiece)}@${(radius + 0.001).toFixed(3)}px`,
  );
} finally {
  await vite.close();
}
