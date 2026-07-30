import { fileURLToPath } from "node:url";
import {
  CylinderGeometry,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from "three";
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

/**
 * 부동소수 방향·세기가 기대값 오차 안인지 판정한다.
 */
function nearlyEqual(actual, expected, tolerance = 1e-9) {
  return Math.abs(actual - expected) <= tolerance;
}

try {
  const [capability, config, input, strikePanel] = await Promise.all([
    vite.ssrLoadModule("/src/input-capability.ts"),
    vite.ssrLoadModule("/src/config.ts"),
    vite.ssrLoadModule("/src/input.ts"),
    vite.ssrLoadModule("/src/strike-panel.ts"),
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

  const basis = {
    right: new Vector3(1, 0, 0),
    forward: new Vector3(0, 0, -1),
  };
  const horizontalPull = input.computeTouchSlingshotAim(
    { pointerType: "touch", clientX: 190, clientY: 100 },
    100,
    100,
    basis,
  );
  const clampedPull = input.computeTouchSlingshotAim(
    { pointerType: "touch", clientX: 100, clientY: 460 },
    100,
    100,
    basis,
  );
  const launchDecision = input.decideTouchSlingshotRelease(
    horizontalPull,
    null,
  );
  assertCondition(
    horizontalPull !== null &&
      nearlyEqual(horizontalPull.direction.x, -1) &&
      nearlyEqual(horizontalPull.direction.y, 0) &&
      nearlyEqual(horizontalPull.direction.z, 0) &&
      nearlyEqual(horizontalPull.normalizedPower, 0.5) &&
      !horizontalPull.cancelsLaunch &&
      launchDecision.shouldLaunch === true &&
      launchDecision.reselectPieceId === null &&
      clampedPull !== null &&
      nearlyEqual(clampedPull.direction.x, 0) &&
      nearlyEqual(clampedPull.direction.y, 0) &&
      nearlyEqual(clampedPull.direction.z, -1) &&
      clampedPull.normalizedPower === 1,
    `슬링샷 pull-back 방향·세기가 다릅니다: horizontal=${JSON.stringify(horizontalPull)}, clamped=${JSON.stringify(clampedPull)}`,
  );

  const cancelRadius =
    config.TOUCH_SLINGSHOT_CANCEL_RADIUS_PIXELS;
  const cancelAim = input.computeTouchSlingshotAim(
    {
      pointerType: "touch",
      clientX: 100 + cancelRadius,
      clientY: 100,
    },
    100,
    100,
    basis,
  );
  const tapCandidate = input.findNearestTouchPieceInScreenSpace(
    { pointerType: "touch", clientX: 100, clientY: 100 },
    [
      {
        pieceId: "white-knight-b1",
        clientX: 110,
        clientY: 100,
      },
    ],
  );
  const cancelDecision = input.decideTouchSlingshotRelease(
    cancelAim,
    tapCandidate,
  );
  const mouseAim = input.computeTouchSlingshotAim(
    { pointerType: "mouse", clientX: 190, clientY: 100 },
    100,
    100,
    basis,
  );
  const mouseDecision = input.decideTouchSlingshotRelease(
    mouseAim,
    tapCandidate,
  );
  assertCondition(
    cancelRadius === 24 &&
      cancelAim?.cancelsLaunch === true &&
      cancelDecision.shouldLaunch === false &&
      cancelDecision.reselectPieceId === "white-knight-b1" &&
      mouseAim === null &&
      mouseDecision.shouldLaunch === false &&
      mouseDecision.reselectPieceId === null,
    `슬링샷 취소·재선택·마우스 격리가 다릅니다: cancel=${JSON.stringify(cancelDecision)}, mouse=${JSON.stringify(mouseDecision)}`,
  );
  console.log(
    `[통과 c] 터치 슬링샷: pull=(90,0)→direction=(-1,0,0),power=${horizontalPull.normalizedPower.toFixed(3)},launch=${launchDecision.shouldLaunch}; 360px power=${clampedPull.normalizedPower.toFixed(3)}; cancel=${cancelRadius}px→launch=${cancelDecision.shouldLaunch},reselect=${cancelDecision.reselectPieceId}; mouseAim=${String(mouseAim)}`,
  );

  const cylinderGeometry = new CylinderGeometry(1, 1, 2, 64);
  const cylinderMaterial = new MeshBasicMaterial();
  const cylinder = new Mesh(cylinderGeometry, cylinderMaterial);
  cylinder.updateMatrixWorld(true);
  const projection = {
    center: new Vector3(0, 0, 0),
    cameraRight: new Vector3(1, 0, 0),
    worldUp: new Vector3(0, 1, 0),
    viewDirection: new Vector3(0, 0, 1),
    halfWidth: 1,
    halfHeight: 1,
    rayMargin: 3,
  };
  const centerHit = strikePanel.pickStrikePanelWorldPoint(
    cylinder,
    projection,
    0,
    0,
  );
  const rightHit = strikePanel.pickStrikePanelWorldPoint(
    cylinder,
    projection,
    0.5,
    0,
  );
  const highHit = strikePanel.pickStrikePanelWorldPoint(
    cylinder,
    projection,
    0,
    0.5,
  );
  const outsideHit = strikePanel.pickStrikePanelWorldPoint(
    cylinder,
    projection,
    1.2,
    0,
  );
  const projectedRight =
    rightHit === null
      ? null
      : strikePanel.projectStrikePointToPanel(
          rightHit,
          projection,
        );
  assertCondition(
    centerHit !== null &&
      nearlyEqual(centerHit.x, 0) &&
      nearlyEqual(centerHit.y, 0) &&
      rightHit !== null &&
      nearlyEqual(rightHit.x, 0.5) &&
      highHit !== null &&
      nearlyEqual(highHit.y, 0.5) &&
      outsideHit === null &&
      projectedRight !== null &&
      nearlyEqual(projectedRight.u, 0.5) &&
      nearlyEqual(projectedRight.v, 0),
    `타점 패널 직교 매핑이 다릅니다: center=${JSON.stringify(centerHit)}, right=${JSON.stringify(rightHit)}, high=${JSON.stringify(highHit)}, outside=${JSON.stringify(outsideHit)}, projected=${JSON.stringify(projectedRight)}`,
  );
  console.log(
    `[통과 d] 타점 패널 직교 매핑: center=(${centerHit.x.toFixed(3)},${centerHit.y.toFixed(3)}), +u x=${rightHit.x.toFixed(3)}, +v y=${highHit.y.toFixed(3)}, outside=${String(outsideHit)}, markerU=${projectedRight.u.toFixed(3)}`,
  );
  cylinderGeometry.dispose();
  cylinderMaterial.dispose();
} finally {
  await vite.close();
}
